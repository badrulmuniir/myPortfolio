// Login request schema (Requirements 5.2, 5.4, 9.6).
import { email, object, password } from './rules.js';

/**
 * `POST /api/auth/login` body.
 * - `email`: Valid_Email, normalized by trimming and lowercasing (5.2).
 * - `password`: 1 character to 72 UTF-8 bytes, never trimmed (5.2, 5.4).
 * Unknown keys are rejected (9.6).
 */
export const loginBody = object({
  email: email({ lowercase: true }),
  password: password(),
});
