// The only module in the Frontend that performs HTTP requests (Requirements 1.2, 32.1).
//
// Exported API:
//   request(path, options)         → Promise<data>               Success_Response `data`
//   requestWithMeta(path, options) → Promise<{ data, meta }>     `meta` is undefined when absent (32.4)
//   setUnauthorizedHandler(fn)     → registers fn(usedToken), or null to remove it
//   ApiError, NETWORK_ERROR_MESSAGE, REQUEST_TIMEOUT_MS
//
// options = { method = 'GET', body, auth = false, signal, skipUnauthorizedHandler = false }
//   auth: true marks a protected endpoint. The stored JWT is attached as
//     `Authorization: Bearer <token>` only then, and only when a token is stored (32.3).
//     Public endpoints (auth: false) never carry the token.
//   body: any JSON-serializable value; sent with `Content-Type: application/json`.
//   signal: a caller AbortSignal. A caller abort rejects with the AbortError unchanged, so
//     hooks can tell it apart from failures and ignore it.
//   skipUnauthorizedHandler: true for login and the bootstrap /auth/me request.
//
// Failures:
//   Error_Response               → ApiError { status, code, message, details } (32.5)
//   network failure, a body that is neither a Success_Response nor an Error_Response,
//   or no complete response within 15 s (the request is aborted)
//                                → ApiError { status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE } (32.6)
//   401 Error_Response to a request that carried a token, with skipUnauthorizedHandler false
//                                → the unauthorized handler is called with the token that was sent,
//                                  then the ApiError is thrown (6.4)

import { getToken } from '../utils/tokenStorage.js';

export const NETWORK_ERROR_MESSAGE = 'The server could not be reached. Please try again.';
export const REQUEST_TIMEOUT_MS = 15000;

export class ApiError extends Error {
  constructor({ status, code, message, details }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const networkError = () =>
  new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE });

const abortError = () => new DOMException('The operation was aborted.', 'AbortError');

const isNonEmptyString = (v) => typeof v === 'string' && v !== '';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

let unauthorizedHandler = null;

/**
 * Registers the function called when a request that carried a token receives a 401
 * Error_Response. It receives the token that request sent. Pass null to remove it.
 * @param {((usedToken: string) => void) | null} handler
 */
export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = typeof handler === 'function' ? handler : null;
}

/**
 * Sends one request and returns the parsed Success_Response as { data, meta }.
 * @param {string} path Path below the API base URL, for example '/projects'.
 * @param {{ method?: string, body?: unknown, auth?: boolean, signal?: AbortSignal, skipUnauthorizedHandler?: boolean }} [options]
 * @returns {Promise<{ data: unknown, meta: unknown }>}
 */
async function send(
  path,
  { method = 'GET', body, auth = false, signal, skipUnauthorizedHandler = false } = {},
) {
  // Read at call time so the configured base URL is always used (32.2, 36.2).
  const url = `${import.meta.env.VITE_API_BASE_URL ?? ''}${path}`;

  if (signal?.aborted) throw abortError();

  const headers = { Accept: 'application/json' };
  const usedToken = auth ? getToken() : null;
  if (usedToken) headers.Authorization = `Bearer ${usedToken}`;

  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  // One internal controller aborts the fetch on timeout or when the caller aborts.
  const controller = new AbortController();
  init.signal = controller.signal;
  let timedOut = false;
  let callerAborted = false;

  // Rejects as soon as the internal controller aborts, even if fetch or body parsing
  // ignores the signal, so a request never outlives the 15 s limit.
  let rejectOnAbort;
  const aborted = new Promise((_, reject) => {
    rejectOnAbort = reject;
  });
  controller.signal.addEventListener('abort', () => rejectOnAbort(abortError()), { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  const onCallerAbort = () => {
    callerAborted = true;
    controller.abort();
  };
  signal?.addEventListener('abort', onCallerAbort, { once: true });

  let response;
  let parsed;
  try {
    const work = (async () => {
      const res = await fetch(url, init);
      let json;
      try {
        json = await res.json();
      } catch {
        json = undefined; // not JSON: handled below as an unexpected body
      }
      return { res, json };
    })();
    work.catch(() => {}); // the loser of the race must not raise an unhandled rejection
    ({ res: response, json: parsed } = await Promise.race([work, aborted]));
  } catch {
    if (callerAborted && !timedOut) throw abortError();
    throw networkError();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }

  if (isPlainObject(parsed) && parsed.success === true && Object.hasOwn(parsed, 'data')) {
    return { data: parsed.data, meta: parsed.meta };
  }

  const error = isPlainObject(parsed) && parsed.success === false ? parsed.error : undefined;
  if (isPlainObject(error) && isNonEmptyString(error.code) && isNonEmptyString(error.message)) {
    if (response.status === 401 && usedToken && !skipUnauthorizedHandler && unauthorizedHandler) {
      try {
        unauthorizedHandler(usedToken);
      } catch {
        // A failing handler must not replace the ApiError the caller expects.
      }
    }
    throw new ApiError({
      status: response.status,
      code: error.code,
      message: error.message,
      details: error.details,
    });
  }

  throw networkError();
}

/**
 * Sends a request and resolves with the `data` of the Success_Response.
 * @param {string} path
 * @param {Parameters<typeof send>[1]} [options]
 */
export async function request(path, options) {
  const { data } = await send(path, options);
  return data;
}

/**
 * Sends a request and resolves with `{ data, meta }`. Use it for paged lists.
 * @param {string} path
 * @param {Parameters<typeof send>[1]} [options]
 */
export function requestWithMeta(path, options) {
  return send(path, options);
}

/**
 * Builds `?a=1&b=2` from an object, omitting undefined and null values.
 * Returns '' when no value remains.
 * @param {Record<string, unknown>} params
 */
export function buildQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) search.append(key, String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

/** Encodes one path segment such as an id or a Slug. */
export const segment = (value) => encodeURIComponent(String(value));
