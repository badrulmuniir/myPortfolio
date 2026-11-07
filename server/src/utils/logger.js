// Server logger with key-based redaction (Requirements 5.8, 4.8).
//
// Every metadata object passes through `redact` before it is written. Keys are compared
// case-insensitively at every nesting level, inside arrays and inside Error objects.
// The log message itself is written as given, so callers must never put secrets in it.

export const REDACTED = '[REDACTED]';

/**
 * Keys whose values are always replaced. The first four are required by the design.
 * The rest cover configuration secrets that must never reach a log either.
 */
export const REDACTED_KEYS = Object.freeze(
  new Set([
    'password',
    'password_hash',
    'token',
    'authorization',
    'pgpassword',
    'jwt_secret',
    'jwtsecret',
    'database_url',
    'connectionstring',
  ]),
);

/**
 * Returns a deep copy of `value` with every sensitive key replaced by `[REDACTED]`.
 * @param {unknown} value
 * @returns {unknown}
 */
export function redact(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? value.toString() : value;
  }
  if (value instanceof Date) return value.toISOString();
  // `seen` holds the current ancestors only, so a shared (non-circular) object is copied twice.
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  try {
    return redactObject(value, seen);
  } finally {
    seen.delete(value);
  }
}

function redactObject(value, seen) {
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));

  const source =
    value instanceof Error
      ? {
          name: value.name,
          message: value.message,
          ...(value.code !== undefined ? { code: value.code } : {}),
          stack: value.stack,
          ...value,
        }
      : value;

  const out = {};
  for (const [key, inner] of Object.entries(source)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? REDACTED : redact(inner, seen);
  }
  return out;
}

const LEVELS = ['info', 'warn', 'error'];

/**
 * @param {{ sink?: { info: Function, warn: Function, error: Function }, now?: () => Date }} [options]
 *   `sink` receives one formatted line per call (defaults to `console`).
 */
export function createLogger({ sink = console, now = () => new Date() } = {}) {
  const logger = {};
  for (const level of LEVELS) {
    logger[level] = (message, meta) => {
      let line = `[${now().toISOString()}] ${level.toUpperCase()} ${message}`;
      if (meta !== undefined) line += ` ${JSON.stringify(redact(meta))}`;
      sink[level](line);
    };
  }
  return Object.freeze(logger);
}

/** Default process-wide logger writing to the console. */
export const logger = createLogger();
