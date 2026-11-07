// Reads and validates API_Server configuration from an environment object.
// Requirements 5.7, 5.9, 9.3, 9.8, 35.7, 35.8, 36.4, 36.5.
//
// The loaders are pure: they take an env object, never load .env files and never exit the
// process. On invalid input they throw one ConfigError listing every invalid variable.
// Error text is built only from variable names and fixed reasons, never from values,
// because values such as JWT_SECRET, PGPASSWORD and DATABASE_URL carry secrets.
//
// Conventions:
// - A variable that is unset or empty (after trimming) counts as unset and gets its default.
// - Booleans accept `true` or `false`, case-insensitive. Any other value is a ConfigError.

import { DEFAULT_JWT_EXPIRES_IN_SECONDS, parseDurationSeconds } from '../utils/duration.js';
import { EMAIL_MAX_LENGTH, VALID_EMAIL_RE, isValidEmail } from '../validators/rules.js';

export const DEFAULTS = Object.freeze({
  port: 5000,
  nodeEnv: 'development',
  pgPort: 5432,
  dbSsl: false,
  dbSslRejectUnauthorized: true,
  dbPoolMax: 10,
  jwtExpiresInSeconds: DEFAULT_JWT_EXPIRES_IN_SECONDS,
  trustProxy: false,
});

export const JWT_SECRET_MIN_LENGTH = 32;
export const DB_POOL_MAX_RANGE = Object.freeze({ min: 1, max: 100 });

/** Thrown when one or more configuration variables are invalid. Contains no variable values. */
export class ConfigError extends Error {
  /** @param {{ variable: string, reason: string }[]} issues */
  constructor(issues) {
    const list = issues.map((i) => `${i.variable} (${i.reason})`).join('; ');
    super(`Invalid configuration: ${list}`);
    this.name = 'ConfigError';
    this.issues = issues;
    this.variables = issues.map((i) => i.variable);
  }
}

const isUnset = (value) => value === undefined || value === null || String(value).trim() === '';

/** Returns the trimmed value, or undefined when unset or empty. */
function read(env, name) {
  const value = env[name];
  return isUnset(value) ? undefined : String(value).trim();
}

function parseBoolean(env, name, fallback, issues) {
  const value = read(env, name);
  if (value === undefined) return fallback;
  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  issues.push({ variable: name, reason: 'must be true or false' });
  return fallback;
}

function parseIntInRange(env, name, { min, max }, fallback, issues) {
  const value = read(env, name);
  if (value === undefined) return fallback;
  const n = /^[0-9]+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) {
    issues.push({ variable: name, reason: `must be an integer from ${min} to ${max}` });
    return fallback;
  }
  return n;
}

/**
 * Splits FRONTEND_URL on commas and returns the distinct origins.
 * Each entry is trimmed and loses a trailing slash; it must be an absolute http(s) URL.
 * Returns null when any entry is invalid or no entry is present.
 * @param {string} raw
 * @returns {string[] | null}
 */
export function parseOrigins(raw) {
  const entries = String(raw)
    .split(',')
    .map((e) => e.trim().replace(/\/+$/, ''))
    .filter((e) => e !== '');
  if (entries.length === 0) return null;
  const origins = [];
  for (const entry of entries) {
    let url;
    try {
      url = new URL(entry);
    } catch {
      return null;
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '') return null;
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }
  return origins;
}

function isPostgresUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'postgres:' || url.protocol === 'postgresql:';
  } catch {
    return false;
  }
}

/** Collects the Database settings, pushing problems into `issues`. */
function collectDbConfig(env, issues) {
  const ssl = parseBoolean(env, 'DB_SSL', DEFAULTS.dbSsl, issues);
  const rejectUnauthorized = parseBoolean(
    env,
    'DB_SSL_REJECT_UNAUTHORIZED',
    DEFAULTS.dbSslRejectUnauthorized,
    issues,
  );
  const poolMax = parseIntInRange(env, 'DB_POOL_MAX', DB_POOL_MAX_RANGE, DEFAULTS.dbPoolMax, issues);
  const common = { ssl: ssl ? { rejectUnauthorized } : false, poolMax };

  // DATABASE_URL takes precedence; the PG* variables are then ignored entirely (36.4).
  const databaseUrl = read(env, 'DATABASE_URL');
  if (databaseUrl !== undefined) {
    if (!isPostgresUrl(databaseUrl)) {
      issues.push({ variable: 'DATABASE_URL', reason: 'must be a postgres:// or postgresql:// URL' });
    }
    return { connectionString: databaseUrl, ...common };
  }

  const missing = ['PGHOST', 'PGUSER', 'PGDATABASE'].filter((name) => read(env, name) === undefined);
  for (const name of missing) {
    issues.push({ variable: name, reason: 'is required when DATABASE_URL is not set' });
  }
  const port = parseIntInRange(env, 'PGPORT', { min: 1, max: 65535 }, DEFAULTS.pgPort, issues);
  // The password is optional and is not trimmed, because it may legitimately contain spaces.
  const password = isUnset(env.PGPASSWORD) ? undefined : String(env.PGPASSWORD);

  return {
    host: read(env, 'PGHOST'),
    port,
    user: read(env, 'PGUSER'),
    password,
    database: read(env, 'PGDATABASE'),
    ...common,
  };
}

/**
 * Loads the Database connection settings used by the API_Server, Migration_Runner and Seed_Script.
 * @param {Record<string, string | undefined>} env
 * @returns {{ connectionString?: string, host?: string, port?: number, user?: string,
 *   password?: string, database?: string, ssl: false | { rejectUnauthorized: boolean }, poolMax: number }}
 * @throws {ConfigError}
 */
export function loadDbConfig(env = process.env) {
  const issues = [];
  const db = collectDbConfig(env, issues);
  if (issues.length > 0) throw new ConfigError(issues);
  return db;
}

/**
 * Loads and validates the full API_Server configuration.
 * @param {Record<string, string | undefined>} env
 * @throws {ConfigError} naming every invalid variable, without any value
 */
export function loadAppConfig(env = process.env) {
  const issues = [];

  const port = parseIntInRange(env, 'PORT', { min: 1, max: 65535 }, DEFAULTS.port, issues);
  const nodeEnv = read(env, 'NODE_ENV') ?? DEFAULTS.nodeEnv;

  // JWT_SECRET is not trimmed: whitespace is part of the secret. Length counts code points.
  const jwtSecret = isUnset(env.JWT_SECRET) ? undefined : String(env.JWT_SECRET);
  if (jwtSecret === undefined) {
    issues.push({ variable: 'JWT_SECRET', reason: 'is required' });
  } else if ([...jwtSecret].length < JWT_SECRET_MIN_LENGTH) {
    issues.push({ variable: 'JWT_SECRET', reason: `must be at least ${JWT_SECRET_MIN_LENGTH} characters` });
  }

  let jwtExpiresInSeconds = DEFAULTS.jwtExpiresInSeconds;
  const expiresRaw = read(env, 'JWT_EXPIRES_IN');
  if (expiresRaw !== undefined) {
    const parsed = parseDurationSeconds(expiresRaw);
    if (parsed === null) {
      issues.push({
        variable: 'JWT_EXPIRES_IN',
        reason: 'must be a positive whole number of seconds, optionally followed by s, m, h or d',
      });
    } else {
      jwtExpiresInSeconds = parsed;
    }
  }

  let frontendOrigins = [];
  const frontendRaw = read(env, 'FRONTEND_URL');
  if (frontendRaw === undefined) {
    issues.push({ variable: 'FRONTEND_URL', reason: 'is required' });
  } else {
    const parsed = parseOrigins(frontendRaw);
    if (parsed === null) {
      issues.push({ variable: 'FRONTEND_URL', reason: 'must be a comma-separated list of http or https origins' });
    } else {
      frontendOrigins = parsed;
    }
  }

  const trustProxy = parseBoolean(env, 'TRUST_PROXY', DEFAULTS.trustProxy, issues);
  const db = collectDbConfig(env, issues);

  if (issues.length > 0) throw new ConfigError(issues);

  return Object.freeze({
    port,
    nodeEnv,
    isProduction: nodeEnv === 'production',
    jwtSecret,
    jwtExpiresInSeconds,
    frontendOrigins: Object.freeze(frontendOrigins),
    trustProxy,
    db: Object.freeze(db),
  });
}

// --- Seed_Script configuration (Requirements 3.2, 3.9) ---

// Valid_Email is defined once, in the Validator rules, and re-exported here for existing callers.
export { EMAIL_MAX_LENGTH, VALID_EMAIL_RE, isValidEmail };
export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const ADMIN_PASSWORD_MAX_BYTES = 72;

/**
 * Loads and validates the Seed_Script settings. There are no defaults for the admin credentials.
 *
 * - `ADMIN_EMAIL` is trimmed, must be a Valid_Email, and is returned lowercased (the same
 *   normalization login uses).
 * - `ADMIN_PASSWORD` is never trimmed. It needs at least 12 characters (code points) and at most
 *   72 UTF-8 bytes, the bcrypt input limit.
 * - `SEED_SAMPLE_CONTENT` is a boolean, default false.
 *
 * The returned `adminPassword` property is non-enumerable, so serializing or logging the config
 * object (JSON.stringify, the logger, console.log) never includes it.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {Readonly<{ adminEmail: string, adminPassword: string, sampleContent: boolean }>}
 * @throws {ConfigError} naming every invalid variable, without any value
 */
export function loadSeedConfig(env = process.env) {
  const issues = [];

  const email = read(env, 'ADMIN_EMAIL');
  if (email === undefined) {
    issues.push({ variable: 'ADMIN_EMAIL', reason: 'is required' });
  } else if (!isValidEmail(email)) {
    issues.push({ variable: 'ADMIN_EMAIL', reason: 'must be a valid email address of at most 254 characters' });
  }

  const rawPassword = env.ADMIN_PASSWORD;
  const password = rawPassword === undefined || rawPassword === null ? '' : String(rawPassword);
  if (password === '') {
    issues.push({ variable: 'ADMIN_PASSWORD', reason: 'is required' });
  } else if ([...password].length < ADMIN_PASSWORD_MIN_LENGTH) {
    issues.push({ variable: 'ADMIN_PASSWORD', reason: `must be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters` });
  } else if (Buffer.byteLength(password, 'utf8') > ADMIN_PASSWORD_MAX_BYTES) {
    issues.push({ variable: 'ADMIN_PASSWORD', reason: `must be at most ${ADMIN_PASSWORD_MAX_BYTES} bytes` });
  }

  const sampleContent = parseBoolean(env, 'SEED_SAMPLE_CONTENT', false, issues);

  if (issues.length > 0) throw new ConfigError(issues);

  const config = { adminEmail: email.toLowerCase(), sampleContent };
  Object.defineProperty(config, 'adminPassword', { value: password, enumerable: false });
  return Object.freeze(config);
}
