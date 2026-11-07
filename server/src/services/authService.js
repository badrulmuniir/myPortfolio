// Administrator login (Requirements 5.1, 5.2, 5.3, 5.5, 5.6, 5.7, 5.8).
//
// `login` always runs one bcrypt comparison: against the stored hash when the email matches an
// admin, otherwise against DUMMY_HASH, so an unknown email costs about as much time as a wrong
// password (5.5). Both failures throw the same InvalidCredentialsError (5.3).
//
// Neither the password, the password hash nor the token is logged or put in an error.
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { InvalidCredentialsError } from '../utils/errors.js';
import { hasher as defaultHasher } from '../utils/password.js';

export const JWT_ALGORITHM = 'HS256';

const systemClock = { now: () => Date.now() };

export const SQL = Object.freeze({
  // The app stores emails trimmed and lowercased; lower() also matches a row stored otherwise.
  // ORDER BY keeps the choice deterministic if two rows differ only in case.
  findByEmail: 'SELECT id, email, role, password_hash FROM admins WHERE lower(email) = $1 ORDER BY id LIMIT 1',
  // Used by the Auth_Middleware existence check (7.5) and GET /api/auth/me (6.1).
  findById: 'SELECT id, email, role FROM admins WHERE id = $1',
});

/**
 * @param {{ db: { query: Function },
 *   config: { jwtSecret: string, jwtExpiresInSeconds: number },
 *   hasher?: { hash: (p: string) => Promise<string>, compare: (p: string, h: string) => Promise<boolean> },
 *   clock?: { now: () => number | Date } }} deps
 */
export function createAuthService({ db, config, hasher = defaultHasher, clock = systemClock }) {
  // DUMMY_HASH: a hash of random bytes made once with the same hasher (and cost) as real hashes.
  // It is created on first use so building an app costs nothing; a failed attempt is retried.
  let dummyHash = null;
  const getDummyHash = () => {
    dummyHash ??= hasher.hash(randomBytes(32).toString('base64')).catch((err) => {
      dummyHash = null;
      throw err;
    });
    return dummyHash;
  };

  const sign = (admin) => {
    const iat = Math.floor(new Date(clock.now()).getTime() / 1000);
    return jwt.sign({ email: admin.email, role: admin.role, iat }, config.jwtSecret, {
      algorithm: JWT_ALGORITHM,
      subject: String(admin.id),
      // A number is read as seconds by jsonwebtoken (5.7).
      expiresIn: config.jwtExpiresInSeconds,
    });
  };

  return Object.freeze({
    /**
     * @param {string} email already trimmed and lowercased by the Validator (5.2)
     * @param {string} password exactly as received (5.2)
     * @returns {Promise<{ token: string, admin: { id: number, email: string, role: string } }>}
     * @throws {InvalidCredentialsError}
     */
    async login(email, password) {
      // Started before the lookup so the first request waits for it on both paths. The no-op
      // catch keeps an unused rejection from becoming an unhandled rejection.
      const dummy = getDummyHash();
      dummy.catch(() => {});
      const { rows } = await db.query(SQL.findByEmail, [email]);
      const row = rows[0];
      const hash = row?.password_hash ?? (await dummy);
      const matches = await hasher.compare(password, hash);
      if (!row || matches !== true) throw new InvalidCredentialsError();

      const admin = { id: row.id, email: row.email, role: row.role };
      return { token: sign(admin), admin };
    },

    /**
     * The admin account as currently stored, for GET /api/auth/me (6.1).
     * @param {number} id
     * @returns {Promise<{ id: number, email: string, role: string } | null>} null when no row exists
     */
    async getAdmin(id) {
      const { rows } = await db.query(SQL.findById, [id]);
      const row = rows[0];
      return row ? { id: row.id, email: row.email, role: row.role } : null;
    },
  });
}
