// CORS with exact origin matching (Requirement 9.2).
//
// `origins` is the normalized FRONTEND_URL list from loadAppConfig (each entry is `URL.origin`).
// - Matching Origin: Access-Control-Allow-Origin echoes it. A preflight also gets the allowed
//   methods, headers and max age, then 204.
// - Any other Origin: no allow headers at all. A preflight still gets 204, so the browser
//   blocks the real request.
// - No Origin header: the request passes through unchanged.
// Every response gets `Vary: Origin`, because the headers depend on the Origin value.
// No credentials mode: the JWT travels in the Authorization header, not in cookies.

export const ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE';
export const ALLOWED_HEADERS = 'Authorization, Content-Type';
export const PREFLIGHT_MAX_AGE_SECONDS = '600';

/**
 * @param {{ origins: readonly string[] }} options
 * @returns {import('express').RequestHandler}
 */
export function createCors({ origins }) {
  const allowed = new Set(origins);

  return function cors(req, res, next) {
    res.vary('Origin');
    const origin = req.headers.origin;
    if (origin === undefined) return next();

    const isAllowed = allowed.has(origin);
    if (isAllowed) res.setHeader('Access-Control-Allow-Origin', origin);

    if (req.method !== 'OPTIONS') return next();

    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      res.setHeader('Access-Control-Max-Age', PREFLIGHT_MAX_AGE_SECONDS);
    }
    res.status(204).end();
  };
}
