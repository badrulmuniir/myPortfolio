import { describe, expect, it } from 'vitest';
import { errorBody, ok } from '../../src/utils/response.js';
import { ServiceUnavailableError } from '../../src/utils/errors.js';

/** Minimal Express-like response that records status and JSON body. */
function fakeRes() {
  const res = {
    statusCode: undefined,
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
  };
  return res;
}

describe('ok', () => {
  it('sends status 200 with data by default and no meta key', () => {
    const res = ok(fakeRes(), { a: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { a: 1 } });
    expect(Object.keys(res.body)).toEqual(['success', 'data']);
  });

  it('sends the given status and meta', () => {
    const res = ok(fakeRes(), [1, 2], 201, { total: 2, page: 1, limit: 20 });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ success: true, data: [1, 2], meta: { total: 2, page: 1, limit: 20 } });
  });

  it('keeps the data key when data is undefined', () => {
    expect(ok(fakeRes(), undefined).body).toEqual({ success: true, data: null });
  });
});

describe('errorBody', () => {
  it('builds an Error_Response with code and message only', () => {
    expect(errorBody({ code: 'X', message: 'Y' })).toEqual({ success: false, error: { code: 'X', message: 'Y' } });
  });

  it('includes details when given', () => {
    const details = [{ field: 'name', reason: 'required', message: 'Name is required' }];
    expect(errorBody({ code: 'VALIDATION_ERROR', message: 'Request validation failed', details })).toEqual({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details },
    });
  });

  it('copies no status, stack or cause from an AppError', () => {
    const err = new ServiceUnavailableError({ cause: new Error('connect ECONNREFUSED db.internal:5432') });
    const body = errorBody(err);
    expect(body).toEqual({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' },
    });
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
  });
});
