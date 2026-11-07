import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  NETWORK_ERROR_MESSAGE,
  REQUEST_TIMEOUT_MS,
  buildQuery,
  request,
  requestWithMeta,
  setUnauthorizedHandler,
} from './apiClient.js';
import { getHealth } from './healthApi.js';
import { clearToken, setToken } from '../utils/tokenStorage.js';

const BASE = 'https://api.example.com/api';

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const errorBody = (code, message, details) => ({
  success: false,
  error: details ? { code, message, details } : { code, message },
});

/** A fetch mock that never settles until its signal aborts, then rejects like real fetch. */
const hangingFetch = () =>
  vi.fn(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        );
      }),
  );

const stubFetch = (impl) => {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', BASE);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setUnauthorizedHandler(null);
  clearToken();
});

describe('apiClient.request: URL, headers and body', () => {
  it('prefixes the path with VITE_API_BASE_URL and returns data from a Success_Response', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, { success: true, data: { status: 'ok' } }));

    await expect(getHealth()).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/health`);
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });

  it('reads the base URL at call time', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, { success: true, data: null }));
    vi.stubEnv('VITE_API_BASE_URL', 'http://other.test/api');
    await request('/skills');
    expect(fetchMock.mock.calls[0][0]).toBe('http://other.test/api/skills');
  });

  it('sends a JSON body with Content-Type and the given method', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(201, { success: true, data: { id: 1 } }));
    await expect(request('/skills', { method: 'POST', body: { name: 'Go' } })).resolves.toEqual({ id: 1 });

    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"name":"Go"}');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('sends no body and no Content-Type when body is undefined', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, { success: true, data: [] }));
    await request('/skills');
    const init = fetchMock.mock.calls[0][1];
    expect(init.body).toBeUndefined();
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('attaches the Bearer token only when auth is true and a token is stored', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, { success: true, data: null }));

    await request('/auth/me', { auth: true });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();

    setToken('tok-1');
    await request('/auth/me', { auth: true });
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer tok-1');

    await request('/skills');
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBeUndefined();

    clearToken();
    await request('/auth/me', { auth: true });
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBeUndefined();
  });
});

describe('apiClient: responses', () => {
  it('requestWithMeta returns data and meta; meta is undefined when absent', async () => {
    stubFetch(async () =>
      jsonResponse(200, { success: true, data: [{ id: 1 }], meta: { total: 1, page: 1, limit: 20 } }),
    );
    await expect(requestWithMeta('/contact')).resolves.toEqual({
      data: [{ id: 1 }],
      meta: { total: 1, page: 1, limit: 20 },
    });

    stubFetch(async () => jsonResponse(200, { success: true, data: [] }));
    const result = await requestWithMeta('/skills');
    expect(result.data).toEqual([]);
    expect(result.meta).toBeUndefined();
  });

  it('throws an ApiError with status, code, message and details for an Error_Response', async () => {
    const details = [{ field: 'name', reason: 'required', message: 'Name is required' }];
    stubFetch(async () => jsonResponse(400, errorBody('VALIDATION_ERROR', 'Request validation failed', details)));

    const err = await request('/skills', { method: 'POST', body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details,
    });
  });

  it('throws an ApiError without details when the Error_Response has none', async () => {
    stubFetch(async () => jsonResponse(503, errorBody('SERVICE_UNAVAILABLE', 'Service temporarily unavailable')));
    const err = await request('/health').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' });
    expect(err.details).toBeUndefined();
  });

  it.each([
    ['fetch rejects', async () => { throw new TypeError('Failed to fetch'); }],
    ['non-JSON body', async () => new Response('<html>oops</html>', { status: 502 })],
    ['JSON of another shape', async () => jsonResponse(200, { ok: true })],
    ['success without data', async () => jsonResponse(200, { success: true })],
    ['error without a code', async () => jsonResponse(500, { success: false, error: { message: 'x' } })],
    ['error with an empty message', async () => jsonResponse(500, errorBody('X', ''))],
    ['JSON array', async () => jsonResponse(200, [1, 2])],
  ])('throws NETWORK_ERROR when %s', async (_label, impl) => {
    stubFetch(impl);
    const err = await request('/health').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE });
  });
});

describe('apiClient: timeout and abort', () => {
  it('aborts after 15 s, throws NETWORK_ERROR and leaves no timer behind', async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);

    expect(REQUEST_TIMEOUT_MS).toBe(15000);
    let settled = null;
    const pending = request('/health').then(
      () => { settled = 'resolved'; },
      (e) => { settled = e; },
    );

    await vi.advanceTimersByTimeAsync(14999);
    expect(settled).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBeInstanceOf(ApiError);
    expect(settled).toMatchObject({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out even when fetch ignores the abort signal', async () => {
    vi.useFakeTimers();
    stubFetch(() => new Promise(() => {}));
    const pending = request('/health').catch((e) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await expect(pending).resolves.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('clears the timer after a successful response', async () => {
    vi.useFakeTimers();
    stubFetch(async () => jsonResponse(200, { success: true, data: 1 }));
    await expect(request('/health')).resolves.toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rethrows an AbortError (not an ApiError) when the caller aborts, and clears the timer', async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const pending = request('/health', { signal: controller.signal }).catch((e) => e);
    controller.abort();
    const err = await pending;

    expect(err).not.toBeInstanceOf(ApiError);
    expect(err.name).toBe('AbortError');
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with an AbortError without calling fetch when the signal is already aborted', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, { success: true, data: 1 }));
    const controller = new AbortController();
    controller.abort();
    const err = await request('/health', { signal: controller.signal }).catch((e) => e);
    expect(err.name).toBe('AbortError');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('apiClient: unauthorized handler', () => {
  const unauthorized = async () => jsonResponse(401, errorBody('UNAUTHORIZED', 'Authentication required'));

  it('calls the handler once with the used token before throwing, for a 401 to a request that carried a token', async () => {
    stubFetch(unauthorized);
    const calls = [];
    setUnauthorizedHandler((token) => calls.push(token));
    setToken('tok-used');

    const err = await request('/auth/me', { auth: true }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(calls).toEqual(['tok-used']);
  });

  it('does not call the handler with skipUnauthorizedHandler, without a token, or for other statuses', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    stubFetch(unauthorized);
    await request('/auth/me', { auth: true }).catch(() => {}); // no token stored
    setToken('tok');
    await request('/auth/me', { auth: true, skipUnauthorizedHandler: true }).catch(() => {});
    await request('/auth/login', { method: 'POST', body: {} }).catch(() => {}); // auth false

    stubFetch(async () => jsonResponse(403, errorBody('FORBIDDEN', 'Forbidden')));
    await request('/auth/me', { auth: true }).catch(() => {});

    expect(handler).not.toHaveBeenCalled();
  });

  it('still throws the ApiError when the handler throws', async () => {
    stubFetch(unauthorized);
    setUnauthorizedHandler(() => { throw new Error('handler failed'); });
    setToken('tok');
    await expect(request('/auth/me', { auth: true })).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
  });
});

describe('buildQuery', () => {
  it('omits undefined and null values and returns an empty string when nothing remains', () => {
    expect(buildQuery({})).toBe('');
    expect(buildQuery({ a: undefined, b: null })).toBe('');
    expect(buildQuery({ page: 2, limit: undefined, is_read: false })).toBe('?page=2&is_read=false');
    expect(buildQuery({ category: 'Web & Mobile' })).toBe('?category=Web+%26+Mobile');
  });
});
