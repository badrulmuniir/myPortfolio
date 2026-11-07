// Success_Response and Error_Response builders (Requirements 4.1, 4.11).
//
// Success_Response: { success: true, data, meta? }
// Error_Response:   { success: false, error: { code, message, details? } }

/**
 * Sends a Success_Response.
 * @param {import('express').Response} res
 * @param {unknown} data payload; `undefined` is sent as `null` so the `data` key is always present
 * @param {number} [status] 200 for reads, updates and deletions; 201 for creations
 * @param {object} [meta] optional pagination metadata
 */
export function ok(res, data, status = 200, meta) {
  const body = { success: true, data: data === undefined ? null : data };
  if (meta !== undefined) body.meta = meta;
  return res.status(status).json(body);
}

/**
 * Builds an Error_Response body. Accepts any object with `code`, `message` and optional
 * `details`, so an AppError instance can be passed directly. Other properties (status, stack,
 * cause) are never copied into the body.
 * @param {{ code: string, message: string, details?: object[] }} error
 */
export function errorBody({ code, message, details }) {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  return { success: false, error };
}
