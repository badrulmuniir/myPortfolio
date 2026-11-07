// Safe descriptions of the Database target and of connection errors (Requirements 36.7, 5.8).
// Nothing produced here contains the Database password, the user name or the full DATABASE_URL.

const DB_URL_RE = /postgres(?:ql)?:\/\/[^\s'"]+/gi;
export const REDACTED_URL = '[REDACTED_URL]';

function parseUrl(connectionString) {
  try {
    return new URL(connectionString);
  } catch {
    return null;
  }
}

/**
 * Returns `host:port/database` for logs, without credentials.
 * @param {{ connectionString?: string, host?: string, port?: number, database?: string }} dbConfig
 */
export function describeTarget(dbConfig = {}) {
  if (dbConfig.connectionString) {
    const url = parseUrl(dbConfig.connectionString);
    if (!url) return 'database (unparseable DATABASE_URL)';
    const host = url.hostname || url.searchParams.get('host') || 'localhost';
    const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || '(default)';
    return `${host}:${url.port || 5432}/${database}`;
  }
  return `${dbConfig.host ?? 'localhost'}:${dbConfig.port ?? 5432}/${dbConfig.database ?? '(default)'}`;
}

/** Collects every secret string in the config that must never appear in output. */
export function collectSecrets(dbConfig = {}) {
  const secrets = [];
  if (dbConfig.password) secrets.push(dbConfig.password);
  if (dbConfig.connectionString) {
    secrets.push(dbConfig.connectionString);
    const url = parseUrl(dbConfig.connectionString);
    if (url?.password) {
      secrets.push(url.password);
      try {
        secrets.push(decodeURIComponent(url.password));
      } catch {
        // Malformed percent-encoding: the raw form is already covered.
      }
    }
  }
  // Longest first, so a full URL is replaced before the password inside it.
  return [...new Set(secrets.filter((s) => typeof s === 'string' && s !== ''))].sort(
    (a, b) => b.length - a.length,
  );
}

/** Removes every secret and every postgres:// URL from `text`. */
export function sanitizeMessage(text, secrets = []) {
  let out = String(text);
  for (const secret of secrets) out = out.split(secret).join('[REDACTED]');
  return out.replace(DB_URL_RE, REDACTED_URL);
}

function rawMessage(err) {
  if (err === null || err === undefined) return 'Unknown error';
  if (typeof err !== 'object') return String(err);
  // Node reports a refused dual-stack localhost connection as an AggregateError with no message.
  if (!err.message && Array.isArray(err.errors) && err.errors.length > 0) {
    return err.errors.map((e) => e?.message ?? String(e)).join('; ');
  }
  return err.message || err.name || 'Unknown error';
}

/**
 * Returns a log-safe reason for a Database error, such as `ECONNREFUSED: connect ECONNREFUSED ...`.
 * A ServiceUnavailableError is unwrapped to its cause, because its own message is generic.
 * @param {unknown} err
 * @param {string[]} [secrets]
 */
export function describeDbError(err, secrets = []) {
  let source = err;
  if (source?.code === 'SERVICE_UNAVAILABLE' && source.cause !== undefined) source = source.cause;
  const code = typeof source?.code === 'string' ? source.code : undefined;
  const message = sanitizeMessage(rawMessage(source), secrets);
  return code && !message.startsWith(code) ? `${code}: ${message}` : message;
}
