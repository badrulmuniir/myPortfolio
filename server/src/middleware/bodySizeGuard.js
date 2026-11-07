// bodySizeGuard and the JSON body parser (Requirements 4.5, 4.6, 4.12, 9.10; design: Middleware
// table, "Request Pipeline").
//
// Order in createApp: bodySizeGuard → jsonBody → /api router. That gives the precedence of 4.12:
// body size (413) is decided before JSON syntax (400), and both before path ids and validation,
// which run inside the routers.
//
// - bodySizeGuard rejects a declared `Content-Length` above 102,400 bytes before any of the body
//   is read. Exactly 102,400 bytes is accepted.
// - jsonBody is `express.json({ limit: '100kb' })`. body-parser reads 'kb' as 1024 bytes, so the
//   limit is the same 102,400 bytes. It also covers chunked bodies with no Content-Length: it stops
//   reading at the limit and reports `entity.too.large` (→ 413 PAYLOAD_TOO_LARGE) before parsing,
//   so an oversized malformed body still gets 413. A body that does not parse reports
//   `entity.parse.failed` (→ 400 MALFORMED_JSON). The Error_Handler does both mappings.
//
// Parser choices:
// - `strict: true` (the default): only an object or array is accepted at the top level. A body of
//   `"abc"` or `123` gets 400 MALFORMED_JSON. Every endpoint expects an object, so no valid request
//   is lost, and the Validator never sees a top-level primitive.
// - `type: 'application/json'` (the default, charset parameters allowed): a body with any other
//   Content-Type is not read and `req.body` stays undefined. The Validator then reports the
//   missing fields with 400 VALIDATION_ERROR. A request with no body (for example a GET) passes
//   through untouched.
import express from 'express';
import { PayloadTooLargeError } from '../utils/errors.js';

/** 100 KB as defined in Requirement 4.6. */
export const MAX_BODY_BYTES = 102_400;

/** body-parser limit; '100kb' parses to 102,400 bytes. */
export const JSON_BODY_LIMIT = '100kb';

const DIGITS = /^[0-9]+$/;

/**
 * Returns the declared body length, or undefined when the header is absent or not plain digits.
 * Node's HTTP parser already rejects malformed Content-Length values with 400 before Express runs,
 * so the undefined case is defensive; body-parser still enforces its own limit there.
 * @param {import('express').Request} req
 */
export function declaredLength(req) {
  const raw = req.headers['content-length'];
  if (typeof raw !== 'string' || !DIGITS.test(raw)) return undefined;
  // Compared as a number; a value too long for exact integer precision is still far above the limit.
  return Number(raw);
}

/** @type {import('express').RequestHandler} */
export function bodySizeGuard(req, res, next) {
  const length = declaredLength(req);
  if (length !== undefined && length > MAX_BODY_BYTES) return next(new PayloadTooLargeError());
  return next();
}

/** JSON body parser with the 100 KB limit. */
export const jsonBody = express.json({ limit: JSON_BODY_LIMIT });
