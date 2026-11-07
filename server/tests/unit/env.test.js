import { describe, expect, it } from 'vitest';
import { ConfigError, loadAppConfig, loadDbConfig, parseOrigins } from '../../src/config/env.js';

const SECRET = 'S3cret-value-that-is-long-enough-1234567890';
const DB_URL = 'postgres://portfolio_user:db-pass-xyz@db.example.com:5432/portfolio';

const validEnv = (overrides = {}) => ({
  JWT_SECRET: SECRET,
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: DB_URL,
  ...overrides,
});

const pgEnv = (overrides = {}) => ({
  JWT_SECRET: SECRET,
  FRONTEND_URL: 'http://localhost:5173',
  PGHOST: 'db.local',
  PGUSER: 'portfolio_user',
  PGPASSWORD: 'pg-pass-xyz',
  PGDATABASE: 'portfolio',
  ...overrides,
});

/** Runs the loader and returns the ConfigError it throws. */
function configError(load, env) {
  try {
    load(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return err;
  }
  throw new Error('expected a ConfigError');
}

describe('loadAppConfig', () => {
  it('applies defaults for a minimal valid environment', () => {
    const config = loadAppConfig(validEnv());
    expect(config).toMatchObject({
      port: 5000,
      nodeEnv: 'development',
      isProduction: false,
      jwtSecret: SECRET,
      jwtExpiresInSeconds: 7200,
      frontendOrigins: ['http://localhost:5173'],
      trustProxy: false,
    });
    expect(config.db).toEqual({ connectionString: DB_URL, ssl: false, poolMax: 10 });
  });

  it('reads every supported variable', () => {
    const config = loadAppConfig(
      validEnv({
        PORT: '8080',
        NODE_ENV: 'production',
        JWT_EXPIRES_IN: '30m',
        TRUST_PROXY: 'TRUE',
        DB_SSL: 'true',
        DB_SSL_REJECT_UNAUTHORIZED: 'False',
        DB_POOL_MAX: '25',
      }),
    );
    expect(config.port).toBe(8080);
    expect(config.isProduction).toBe(true);
    expect(config.jwtExpiresInSeconds).toBe(1800);
    expect(config.trustProxy).toBe(true);
    expect(config.db.ssl).toEqual({ rejectUnauthorized: false });
    expect(config.db.poolMax).toBe(25);
  });

  it('treats a bare JWT_EXPIRES_IN number as seconds', () => {
    expect(loadAppConfig(validEnv({ JWT_EXPIRES_IN: '120' })).jwtExpiresInSeconds).toBe(120);
  });

  it('treats empty variables as unset', () => {
    const config = loadAppConfig(validEnv({ PORT: '', JWT_EXPIRES_IN: '', DB_POOL_MAX: '', TRUST_PROXY: '' }));
    expect(config.port).toBe(5000);
    expect(config.jwtExpiresInSeconds).toBe(7200);
    expect(config.db.poolMax).toBe(10);
    expect(config.trustProxy).toBe(false);
  });

  it('normalizes FRONTEND_URL entries to distinct origins', () => {
    const config = loadAppConfig(
      validEnv({ FRONTEND_URL: ' https://example.com/ , http://localhost:5173,https://example.com,' }),
    );
    expect(config.frontendOrigins).toEqual(['https://example.com', 'http://localhost:5173']);
  });

  it.each([
    ['JWT_SECRET', { JWT_SECRET: undefined }],
    ['JWT_SECRET', { JWT_SECRET: '' }],
    ['JWT_SECRET', { JWT_SECRET: 'x'.repeat(31) }],
    ['JWT_EXPIRES_IN', { JWT_EXPIRES_IN: '0' }],
    ['JWT_EXPIRES_IN', { JWT_EXPIRES_IN: '2 hours' }],
    ['JWT_EXPIRES_IN', { JWT_EXPIRES_IN: '-1' }],
    ['FRONTEND_URL', { FRONTEND_URL: undefined }],
    ['FRONTEND_URL', { FRONTEND_URL: ' , ' }],
    ['FRONTEND_URL', { FRONTEND_URL: 'localhost:5173' }],
    ['FRONTEND_URL', { FRONTEND_URL: 'http://ok.example.com, ftp://files.example.com' }],
    ['PORT', { PORT: '0' }],
    ['PORT', { PORT: '70000' }],
    ['PORT', { PORT: '50a' }],
    ['TRUST_PROXY', { TRUST_PROXY: 'yes' }],
    ['DB_SSL', { DB_SSL: '1' }],
    ['DB_SSL_REJECT_UNAUTHORIZED', { DB_SSL_REJECT_UNAUTHORIZED: 'no' }],
    ['DB_POOL_MAX', { DB_POOL_MAX: '0' }],
    ['DB_POOL_MAX', { DB_POOL_MAX: '101' }],
    ['DB_POOL_MAX', { DB_POOL_MAX: '10.5' }],
    ['DB_POOL_MAX', { DB_POOL_MAX: 'ten' }],
    ['DATABASE_URL', { DATABASE_URL: 'not a url' }],
  ])('rejects an invalid %s', (variable, overrides) => {
    const err = configError(loadAppConfig, validEnv(overrides));
    expect(err.variables).toEqual([variable]);
    expect(err.message).toContain(variable);
  });

  it('accepts a 32-character JWT_SECRET and DB_POOL_MAX bounds 1 and 100', () => {
    expect(loadAppConfig(validEnv({ JWT_SECRET: 'x'.repeat(32) })).jwtSecret).toHaveLength(32);
    expect(loadAppConfig(validEnv({ DB_POOL_MAX: '1' })).db.poolMax).toBe(1);
    expect(loadAppConfig(validEnv({ DB_POOL_MAX: '100' })).db.poolMax).toBe(100);
  });

  it('names every invalid variable in one error', () => {
    const err = configError(loadAppConfig, {
      JWT_SECRET: 'short-secret',
      JWT_EXPIRES_IN: '0',
      DB_POOL_MAX: '500',
      TRUST_PROXY: 'maybe',
      PGPORT: 'abc',
    });
    expect(err.variables.sort()).toEqual(
      [
        'DB_POOL_MAX',
        'FRONTEND_URL',
        'JWT_EXPIRES_IN',
        'JWT_SECRET',
        'PGDATABASE',
        'PGHOST',
        'PGPORT',
        'PGUSER',
        'TRUST_PROXY',
      ].sort(),
    );
  });

  it('never includes variable values in the error', () => {
    const values = {
      JWT_SECRET: 'tiny-secret-value',
      JWT_EXPIRES_IN: 'forever-value',
      FRONTEND_URL: 'bogus-frontend-value',
      DATABASE_URL: 'mysql://root:leaked-db-pass@host/db',
      DB_POOL_MAX: '987654',
      TRUST_PROXY: 'bogus-bool-value',
      PORT: '99999999',
    };
    const err = configError(loadAppConfig, values);
    const text = `${err.message} ${JSON.stringify(err.issues)} ${err.stack}`;
    for (const value of Object.values(values)) {
      expect(text).not.toContain(value);
    }
    expect(text).not.toContain('leaked-db-pass');
  });
});

describe('loadDbConfig', () => {
  it('prefers DATABASE_URL and ignores the PG* variables', () => {
    const db = loadDbConfig(pgEnv({ DATABASE_URL: DB_URL, PGPORT: 'not-a-port' }));
    expect(db).toEqual({ connectionString: DB_URL, ssl: false, poolMax: 10 });
  });

  it('falls back to the PG* variables with PGPORT defaulting to 5432', () => {
    expect(loadDbConfig(pgEnv())).toEqual({
      host: 'db.local',
      port: 5432,
      user: 'portfolio_user',
      password: 'pg-pass-xyz',
      database: 'portfolio',
      ssl: false,
      poolMax: 10,
    });
    expect(loadDbConfig(pgEnv({ PGPORT: '6543' })).port).toBe(6543);
  });

  it('allows PGPASSWORD to be unset', () => {
    expect(loadDbConfig(pgEnv({ PGPASSWORD: undefined })).password).toBeUndefined();
  });

  it('names each missing PGHOST, PGUSER and PGDATABASE when DATABASE_URL is unset', () => {
    const err = configError(loadDbConfig, { PGPASSWORD: 'pg-pass-xyz' });
    expect(err.variables).toEqual(['PGHOST', 'PGUSER', 'PGDATABASE']);
    expect(err.message).not.toContain('pg-pass-xyz');

    expect(configError(loadDbConfig, pgEnv({ PGUSER: '' })).variables).toEqual(['PGUSER']);
  });

  it('enables SSL with certificate verification by default when DB_SSL is true', () => {
    expect(loadDbConfig(pgEnv({ DB_SSL: 'true' })).ssl).toEqual({ rejectUnauthorized: true });
    expect(loadDbConfig(pgEnv({ DB_SSL: 'false' })).ssl).toBe(false);
  });

  it('does not require JWT or HTTP variables', () => {
    expect(() => loadDbConfig({ DATABASE_URL: DB_URL })).not.toThrow();
  });
});

describe('parseOrigins', () => {
  it('keeps only the origin of each entry', () => {
    expect(parseOrigins('https://example.com:8443/app/')).toEqual(['https://example.com:8443']);
  });

  it('returns null for an invalid list', () => {
    expect(parseOrigins('')).toBeNull();
    expect(parseOrigins('javascript:alert(1)')).toBeNull();
  });
});
