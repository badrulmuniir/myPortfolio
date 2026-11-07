// Fixed-window Rate_Limiter model and the rateLimit middleware (Requirements 8.1, 8.3, 8.7).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rateLimit } from '../../src/middleware/rateLimit.js';
import {
  CONTACT_LIMIT,
  LOGIN_LIMIT,
  SWEEP_INTERVAL_MS,
  createContactLimiter,
  createFixedWindowLimiter,
  createLoginLimiter,
} from '../../src/utils/rateLimiter.js';

const fakeClock = (t = 1_700_000_000_000) => ({ t, now() { return this.t; } });

function limiterWith(clock, options = {}) {
  return createFixedWindowLimiter({ windowMs: 60_000, max: 3, now: () => clock.now(), sweepIntervalMs: 0, ...options });
}

describe('createFixedWindowLimiter', () => {
  afterEach(() => vi.useRealTimers());

  it('does not block a key with no window and check never opens one', () => {
    const clock = fakeClock();
    const limiter = limiterWith(clock);
    for (let i = 0; i < 10; i += 1) expect(limiter.check('a')).toEqual({ blocked: false });
    expect(limiter.size).toBe(0);
  });

  it('blocks once the open window holds max counted requests', () => {
    const clock = fakeClock();
    const limiter = limiterWith(clock);
    limiter.record('a');
    limiter.record('a');
    expect(limiter.check('a').blocked).toBe(false);
    limiter.record('a');
    expect(limiter.check('a')).toEqual({ blocked: true, retryAfterSeconds: 60 });
  });

  it('opens the window at the first record, not at an earlier check', () => {
    const clock = fakeClock();
    const limiter = limiterWith(clock);
    limiter.check('a');
    clock.t += 30_000;
    for (let i = 0; i < 3; i += 1) limiter.record('a');
    clock.t += 59_999; // 1 ms before the window that opened at the first record ends
    expect(limiter.check('a')).toEqual({ blocked: true, retryAfterSeconds: 1 });
    clock.t += 1;
    expect(limiter.check('a')).toEqual({ blocked: false });
  });

  it('resets the count when the window ends; the next record opens a new window', () => {
    const clock = fakeClock();
    const limiter = limiterWith(clock);
    for (let i = 0; i < 3; i += 1) limiter.record('a');
    clock.t += 60_000;
    expect(limiter.check('a').blocked).toBe(false);
    limiter.record('a');
    limiter.record('a');
    expect(limiter.check('a').blocked).toBe(false);
    limiter.record('a');
    expect(limiter.check('a').blocked).toBe(true);
  });

  it('counts records spread across the window in the same window', () => {
    const clock = fakeClock();
    const limiter = limiterWith(clock);
    limiter.record('a');
    clock.t += 59_000;
    limiter.record('a');
    limiter.record('a');
    expect(limiter.check('a')).toEqual({ blocked: true, retryAfterSeconds: 1 });
  });

  it('keeps keys and limiter instances separate', () => {
    const clock = fakeClock();
    const login = limiterWith(clock);
    const contact = limiterWith(clock);
    for (let i = 0; i < 3; i += 1) login.record('1.1.1.1');
    expect(login.check('1.1.1.1').blocked).toBe(true);
    expect(login.check('2.2.2.2').blocked).toBe(false);
    expect(contact.check('1.1.1.1').blocked).toBe(false);
  });

  it('rounds Retry-After seconds up and keeps them between 1 and the window length', () => {
    const clock = fakeClock();
    const limiter = limiterWith(clock);
    for (let i = 0; i < 3; i += 1) limiter.record('a');
    const cases = [
      [0, 60],
      [1, 60],
      [999, 60],
      [1_000, 59],
      [1_001, 59],
      [58_999, 2],
      [59_000, 1],
      [59_999, 1],
    ];
    const start = clock.t;
    for (const [elapsed, expected] of cases) {
      clock.t = start + elapsed;
      expect(limiter.check('a').retryAfterSeconds).toBe(expected);
    }
  });

  it('accepts a clock that returns a Date', () => {
    const clock = { t: new Date('2024-01-01T00:00:00Z'), now() { return this.t; } };
    const limiter = createFixedWindowLimiter({ windowMs: 1_000, max: 1, now: () => clock.now(), sweepIntervalMs: 0 });
    limiter.record('a');
    expect(limiter.check('a').blocked).toBe(true);
    clock.t = new Date('2024-01-01T00:00:01Z');
    expect(limiter.check('a').blocked).toBe(false);
  });

  it('sweep removes only windows that have ended', () => {
    const clock = fakeClock();
    const limiter = limiterWith(clock);
    limiter.record('old');
    clock.t += 30_000;
    limiter.record('new');
    clock.t += 30_000; // 'old' ended exactly now, 'new' is still open
    limiter.sweep();
    expect(limiter.size).toBe(1);
    limiter.record('new');
    limiter.record('new');
    expect(limiter.check('new').blocked).toBe(true);
  });

  it('runs sweep on an unref()ed timer that stop() clears', () => {
    vi.useFakeTimers();
    const clock = fakeClock();
    const limiter = createFixedWindowLimiter({ windowMs: 60_000, max: 3, now: () => clock.now() });
    limiter.record('a');
    clock.t += 60_000;
    vi.advanceTimersByTime(SWEEP_INTERVAL_MS);
    expect(limiter.size).toBe(0);

    limiter.stop();
    limiter.record('b');
    clock.t += 60_000;
    vi.advanceTimersByTime(SWEEP_INTERVAL_MS * 2);
    expect(limiter.size).toBe(1);
  });

  it('unrefs its sweep timer', () => {
    const unref = vi.fn();
    const spy = vi.spyOn(globalThis, 'setInterval').mockReturnValue({ unref });
    const clear = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
    try {
      const limiter = createFixedWindowLimiter({ windowMs: 1_000, max: 1 });
      expect(spy).toHaveBeenCalledWith(expect.any(Function), SWEEP_INTERVAL_MS);
      expect(unref).toHaveBeenCalledTimes(1);
      limiter.stop();
      expect(clear).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      clear.mockRestore();
    }
  });

  it('rejects invalid options', () => {
    expect(() => createFixedWindowLimiter({ windowMs: 0, max: 1 })).toThrow(TypeError);
    expect(() => createFixedWindowLimiter({ windowMs: 1_000, max: 0 })).toThrow(TypeError);
  });

  it('uses 15 min / 5 for login and 60 min / 5 for contact', () => {
    expect(LOGIN_LIMIT).toEqual({ windowMs: 900_000, max: 5 });
    expect(CONTACT_LIMIT).toEqual({ windowMs: 3_600_000, max: 5 });
    const clock = fakeClock();
    const login = createLoginLimiter({ clock, sweepIntervalMs: 0 });
    const contact = createContactLimiter({ clock, sweepIntervalMs: 0 });
    for (let i = 0; i < 5; i += 1) {
      login.record('a');
      contact.record('a');
    }
    expect(login.check('a')).toEqual({ blocked: true, retryAfterSeconds: 900 });
    expect(contact.check('a')).toEqual({ blocked: true, retryAfterSeconds: 3600 });
  });
});

describe('rateLimit middleware', () => {
  /** Minimal response object with an EventEmitter-like `on('finish')`. */
  function fakeRes() {
    const listeners = [];
    const headers = {};
    return {
      headers,
      statusCode: 200,
      set: (k, v) => {
        headers[k] = v;
      },
      on: (event, fn) => {
        if (event === 'finish') listeners.push(fn);
      },
      finish(status) {
        this.statusCode = status;
        for (const fn of listeners) fn();
      },
    };
  }

  it('records on finish only when countWhen is true, keyed by req.ip', () => {
    const clock = fakeClock();
    const limiter = limiterWith(clock, { max: 1 });
    const mw = rateLimit(limiter, { countWhen: (res) => res.statusCode === 401, createError: () => new Error('x') });

    const run = (ip, status) => {
      const res = fakeRes();
      const next = vi.fn();
      mw({ ip }, res, next);
      res.finish(status);
      return { res, next };
    };

    expect(run('a', 200).next).toHaveBeenCalledWith();
    expect(limiter.check('a').blocked).toBe(false);
    run('a', 401);
    expect(limiter.check('a').blocked).toBe(true);
    expect(limiter.check('b').blocked).toBe(false);
  });

  it('sets Retry-After and passes the error when blocked, without recording', () => {
    const clock = fakeClock();
    const limiter = limiterWith(clock, { max: 1 });
    limiter.record('a');
    const record = vi.fn();
    const error = new Error('blocked');
    const mw = rateLimit({ check: limiter.check, record }, { countWhen: () => true, createError: () => error });
    const res = fakeRes();
    const next = vi.fn();
    mw({ ip: 'a' }, res, next);
    res.finish(429);
    expect(next).toHaveBeenCalledWith(error);
    expect(res.headers['Retry-After']).toBe('60');
    expect(record).not.toHaveBeenCalled();
  });

  it('requires a limiter, countWhen and createError', () => {
    const limiter = limiterWith(fakeClock());
    expect(() => rateLimit({}, { countWhen: () => true, createError: () => new Error() })).toThrow(TypeError);
    expect(() => rateLimit(limiter, { createError: () => new Error() })).toThrow(TypeError);
    expect(() => rateLimit(limiter, { countWhen: () => true })).toThrow(TypeError);
  });
});
