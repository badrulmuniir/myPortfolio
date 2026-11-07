// Request validation middleware (Requirements 4.2, 4.10, 4.12, 9.6).
import { InvalidIdError, ValidationError } from '../utils/errors.js';

/**
 * Builds a middleware that checks `req.params`, `req.query` and `req.body` against the given
 * rules (see `validators/rules.js`). Each schema is optional.
 *
 * Order (4.12): params run first. A params failure passes a 400 INVALID_ID error to `next` and
 * skips query and body. Query and body then run together, and every failing entry from both is
 * collected into one 400 VALIDATION_ERROR (4.2). An error reported on the whole query or body
 * (field '') is named `query` or `body`, for example a missing JSON body or a Settings body with
 * no allowed key.
 *
 * On success the normalized values are stored in `req.valid = { params, query, body }` (only the
 * segments that have a schema). `req.query` and `req.body` are left untouched; in Express 5
 * `req.query` is a getter and cannot be reassigned.
 *
 * @param {{ params?: Function, query?: Function, body?: Function }} schemas
 * @returns {import('express').RequestHandler}
 */
export function validate({ params, query, body } = {}) {
  return function validateRequest(req, res, next) {
    const valid = {};

    if (params) {
      const result = params(req.params ?? {}, '');
      if (!result.ok) {
        const [first] = result.errors;
        return next(new InvalidIdError({ field: first.field || 'id', reason: first.reason }));
      }
      valid.params = result.value;
    }

    const details = [];
    for (const [segment, schema, input] of [
      ['query', query, req.query],
      ['body', body, req.body],
    ]) {
      if (!schema) continue;
      const result = schema(input, '');
      if (result.ok) valid[segment] = result.value;
      else details.push(...result.errors.map((e) => (e.field === '' ? { ...e, field: segment } : e)));
    }
    if (details.length > 0) return next(new ValidationError(details));

    req.valid = { ...req.valid, ...valid };
    return next();
  };
}
