// Password hashing with bcrypt (Requirements 3.1, 5.2).
//
// The hasher is injectable: production code uses cost 12, while tests inject a cost-4 hasher to
// keep runs fast. Neither method logs or echoes the password.
import bcrypt from 'bcryptjs';

export const DEFAULT_BCRYPT_COST = 12;

/**
 * @param {{ cost?: number }} [options]
 * @returns {Readonly<{ cost: number, hash: (password: string) => Promise<string>,
 *   compare: (password: string, hash: string) => Promise<boolean> }>}
 */
export function createHasher({ cost = DEFAULT_BCRYPT_COST } = {}) {
  if (!Number.isInteger(cost) || cost < 4 || cost > 31) {
    throw new RangeError('bcrypt cost must be an integer from 4 to 31');
  }
  return Object.freeze({
    cost,
    hash: (password) => bcrypt.hash(password, cost),
    compare: (password, hash) => bcrypt.compare(password, hash),
  });
}

/** The production hasher (cost 12). */
export const hasher = createHasher();
