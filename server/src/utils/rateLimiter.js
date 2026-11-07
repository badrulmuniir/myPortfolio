// In-memory fixed-window Rate_Limiter (Requirements 8.1, 8.2, 8.3, 8.7; design: "Rate_Limiter").
//
// - Each key (a client IP address) has at most one open window: `{ start, count }`.
// - A window opens at the first *counted* request (`record`) when none is open, lasts `windowMs`,
//   and its count is gone once it ends. `check` never opens a window or changes a count.
// - A key is blocked while its open window holds `max` counted requests.
// - One limiter instance per endpoint (login, contact), so endpoints never share counts.
//
// Counters live in process memory, so the API_Server runs as a single instance (risk R3).

export const MINUTE_MS = 60 * 1000;

/** Login: 5 failed attempts per 15-minute window per IP (8.1). */
export const LOGIN_LIMIT = Object.freeze({ windowMs: 15 * MINUTE_MS, max: 5 });

/** Contact: 5 counted submissions per 60-minute window per IP (8.2). */
export const CONTACT_LIMIT = Object.freeze({ windowMs: 60 * MINUTE_MS, max: 5 });

/** How often expired windows are removed from memory. */
export const SWEEP_INTERVAL_MS = 5 * MINUTE_MS;

const systemNow = () => Date.now();

/**
 * @param {{ windowMs: number, max: number, now?: () => number | Date, sweepIntervalMs?: number }} options
 *   `now` returns the current time as milliseconds or a Date (an injected clock in tests).
 *   `sweepIntervalMs` of 0 disables the background sweep timer.
 */
export function createFixedWindowLimiter({ windowMs, max, now = systemNow, sweepIntervalMs = SWEEP_INTERVAL_MS }) {
  if (!Number.isInteger(windowMs) || windowMs <= 0) throw new TypeError('windowMs must be a positive integer');
  if (!Number.isInteger(max) || max <= 0) throw new TypeError('max must be a positive integer');

  const maxRetryAfterSeconds = Math.ceil(windowMs / 1000);
  const entries = new Map(); // key → { start, count }
  const time = () => new Date(now()).getTime();

  /** The key's window if it is still open at time `t`, otherwise null. */
  const live = (key, t) => {
    const entry = entries.get(key);
    return entry !== undefined && t < entry.start + windowMs ? entry : null;
  };

  /** @returns {{ blocked: false } | { blocked: true, retryAfterSeconds: number }} */
  function check(key) {
    const t = time();
    const entry = live(key, t);
    if (entry === null || entry.count < max) return { blocked: false };
    const seconds = Math.ceil((entry.start + windowMs - t) / 1000);
    return { blocked: true, retryAfterSeconds: Math.min(Math.max(seconds, 1), maxRetryAfterSeconds) };
  }

  /** Counts one request for `key`, opening a new window when none is open. */
  function record(key) {
    const t = time();
    const entry = live(key, t);
    if (entry !== null) entry.count += 1;
    else entries.set(key, { start: t, count: 1 });
  }

  /** Deletes every window that has ended. */
  function sweep() {
    const t = time();
    for (const key of entries.keys()) if (live(key, t) === null) entries.delete(key);
  }

  // unref() so the timer never keeps the process (or a test worker) alive.
  let timer = null;
  if (sweepIntervalMs > 0) {
    timer = setInterval(sweep, sweepIntervalMs);
    timer.unref?.();
  }

  /** Stops the sweep timer. The limiter keeps working; expired windows are just not swept. */
  function stop() {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  return Object.freeze({
    windowMs,
    max,
    check,
    record,
    sweep,
    stop,
    /** Number of keys currently held in memory (open or not yet swept). */
    get size() {
      return entries.size;
    },
  });
}

/**
 * Converts an injected clock (`{ now: () => number | Date }`) to the limiter's `now` option.
 * @param {{ now: () => number | Date } | undefined} clock
 */
const nowFrom = (clock) => (clock ? () => clock.now() : systemNow);

/** The login Rate_Limiter: 15-minute windows, 5 failed attempts. */
export const createLoginLimiter = ({ clock, ...options } = {}) =>
  createFixedWindowLimiter({ ...LOGIN_LIMIT, now: nowFrom(clock), ...options });

/** The contact Rate_Limiter: 60-minute windows, 5 counted submissions. */
export const createContactLimiter = ({ clock, ...options } = {}) =>
  createFixedWindowLimiter({ ...CONTACT_LIMIT, now: nowFrom(clock), ...options });
