// securityHeaders (Requirement 9.5; design: Middleware table).
//
// Mounted first in createApp, before cors, so every response carries these headers: successes,
// Error_Responses, unknown routes, rate-limited responses and the 204 preflight that cors sends
// itself. `X-Powered-By` is removed by `app.disable('x-powered-by')` in createApp.

export const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
});

/** @type {import('express').RequestHandler} */
export function securityHeaders(req, res, next) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  next();
}
