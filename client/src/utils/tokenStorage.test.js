import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_STORAGE_KEY, clearToken, getToken, setToken } from './tokenStorage.js';

afterEach(() => {
  vi.restoreAllMocks();
  clearToken();
  window.sessionStorage.clear();
});

describe('tokenStorage', () => {
  it('stores, reads and clears the token under portfolio.admin.token in sessionStorage', () => {
    expect(TOKEN_STORAGE_KEY).toBe('portfolio.admin.token');
    expect(getToken()).toBeNull();

    setToken('abc.def.ghi');
    expect(window.sessionStorage.getItem('portfolio.admin.token')).toBe('abc.def.ghi');
    expect(getToken()).toBe('abc.def.ghi');

    clearToken();
    expect(window.sessionStorage.getItem('portfolio.admin.token')).toBeNull();
    expect(getToken()).toBeNull();
  });

  it('treats an empty value as clearing the token', () => {
    setToken('abc');
    setToken('');
    expect(getToken()).toBeNull();
  });

  it('falls back to memory when sessionStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError');
    });

    expect(() => setToken('memory-token')).not.toThrow();
    expect(getToken()).toBe('memory-token');
    expect(() => clearToken()).not.toThrow();
    expect(getToken()).toBeNull();
  });
});
