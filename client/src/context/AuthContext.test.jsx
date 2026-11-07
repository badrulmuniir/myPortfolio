import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ApiError, NETWORK_ERROR_MESSAGE, request } from '../api/apiClient.js';
import * as authApi from '../api/authApi.js';
import { clearToken, getToken, setToken } from '../utils/tokenStorage.js';
import {
  AUTH_STATUS,
  AuthProvider,
  SESSION_EXPIRED_MESSAGE,
  resolvePostLoginPath,
  useAuth,
} from './AuthContext.jsx';

vi.mock('../api/authApi.js', () => ({ login: vi.fn(), me: vi.fn() }));

const ADMIN = { id: 1, email: 'admin@example.com', role: 'admin' };

let auth;
function Probe() {
  auth = useAuth();
  const location = useLocation();
  return (
    <div>
      <p data-testid="status">{auth.status}</p>
      <p data-testid="path">{location.pathname}</p>
    </div>
  );
}

const renderAuth = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </MemoryRouter>,
  );

const statusText = () => screen.getByTestId('status').textContent;

const errorResponse = (status, code, message) =>
  new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Sends a real API_Client request that carries the stored token and receives a 401. */
async function protectedRequestGets401() {
  await request('/dashboard/stats', { auth: true }).catch(() => {});
}

beforeEach(() => {
  vi.mocked(authApi.me).mockReset();
  vi.mocked(authApi.login).mockReset();
  clearToken();
  auth = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearToken();
});

describe('AuthProvider session verification at load', () => {
  it('is unauthenticated without a request when no token is stored (6.6)', async () => {
    renderAuth();
    expect(statusText()).toBe(AUTH_STATUS.UNAUTHENTICATED);
    await act(async () => {});
    expect(authApi.me).not.toHaveBeenCalled();
  });

  it('checks once and becomes authenticated with id, email and role on 200 (6.2)', async () => {
    setToken('tok-1');
    let resolveMe;
    vi.mocked(authApi.me).mockImplementation(() => new Promise((r) => (resolveMe = r)));
    renderAuth('/admin');
    expect(statusText()).toBe(AUTH_STATUS.CHECKING);
    await act(async () => resolveMe({ ...ADMIN, extra: 'ignored' }));
    expect(statusText()).toBe(AUTH_STATUS.AUTHENTICATED);
    expect(auth.admin).toEqual(ADMIN);
    expect(authApi.me).toHaveBeenCalledTimes(1);
    expect(authApi.me.mock.calls[0][0]).toMatchObject({ skipUnauthorizedHandler: true });
  });

  it('clears the token and shows no message on 401 on a public page (6.7)', async () => {
    setToken('tok-1');
    vi.mocked(authApi.me).mockRejectedValue(new ApiError({ status: 401, code: 'UNAUTHORIZED', message: 'x' }));
    renderAuth('/projects');
    await waitFor(() => expect(statusText()).toBe(AUTH_STATUS.UNAUTHENTICATED));
    expect(getToken()).toBeNull();
    expect(auth.sessionMessage).toBeNull();
    expect(screen.getByTestId('path').textContent).toBe('/projects');
  });

  it('sets the session message and remembers the path on 401 on an admin page (6.4)', async () => {
    setToken('tok-1');
    vi.mocked(authApi.me).mockRejectedValue(new ApiError({ status: 401, code: 'UNAUTHORIZED', message: 'x' }));
    renderAuth('/admin/projects?page=2');
    await waitFor(() => expect(statusText()).toBe(AUTH_STATUS.UNAUTHENTICATED));
    expect(auth.sessionMessage).toBe(SESSION_EXPIRED_MESSAGE);
    expect(auth.sessionFrom).toBe('/admin/projects?page=2');
  });

  it('keeps the token on a network error and retryVerification repeats the check (6.8)', async () => {
    setToken('tok-1');
    vi.mocked(authApi.me)
      .mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE }))
      .mockResolvedValueOnce(ADMIN);
    renderAuth('/admin');
    await waitFor(() => expect(statusText()).toBe(AUTH_STATUS.ERROR));
    expect(getToken()).toBe('tok-1');
    expect(auth.admin).toBeNull();

    await act(async () => auth.retryVerification());
    await waitFor(() => expect(statusText()).toBe(AUTH_STATUS.AUTHENTICATED));
    expect(authApi.me).toHaveBeenCalledTimes(2);
    expect(auth.admin).toEqual(ADMIN);
  });

  it('treats a 500 as an error, not a sign-out (6.8)', async () => {
    setToken('tok-1');
    vi.mocked(authApi.me).mockRejectedValue(new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'x' }));
    renderAuth('/admin');
    await waitFor(() => expect(statusText()).toBe(AUTH_STATUS.ERROR));
    expect(getToken()).toBe('tok-1');
  });
});

describe('AuthProvider login and logout', () => {
  it('stores the token and becomes authenticated on login success', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ token: 'new-token', admin: ADMIN });
    renderAuth('/admin/login');
    let result;
    await act(async () => {
      result = await auth.login('admin@example.com', 'secret-password');
    });
    expect(authApi.login).toHaveBeenCalledWith({ email: 'admin@example.com', password: 'secret-password' });
    expect(result).toEqual(ADMIN);
    expect(getToken()).toBe('new-token');
    expect(statusText()).toBe(AUTH_STATUS.AUTHENTICATED);
  });

  it('stores nothing and rethrows the ApiError on login failure', async () => {
    const failure = new ApiError({ status: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    vi.mocked(authApi.login).mockRejectedValue(failure);
    renderAuth('/admin/login');
    let caught;
    await act(async () => {
      await auth.login('admin@example.com', 'wrong').catch((e) => (caught = e));
    });
    expect(caught).toBe(failure);
    expect(getToken()).toBeNull();
    expect(statusText()).toBe(AUTH_STATUS.UNAUTHENTICATED);
  });

  it('logout clears the token and identity, navigates to /admin/login and sends no request (6.3)', async () => {
    setToken('tok-1');
    vi.mocked(authApi.me).mockResolvedValue(ADMIN);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderAuth('/admin/projects');
    await waitFor(() => expect(statusText()).toBe(AUTH_STATUS.AUTHENTICATED));

    act(() => auth.logout());
    expect(getToken()).toBeNull();
    expect(auth.admin).toBeNull();
    expect(statusText()).toBe(AUTH_STATUS.UNAUTHENTICATED);
    expect(screen.getByTestId('path').textContent).toBe('/admin/login');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(authApi.me).toHaveBeenCalledTimes(1);
  });
});

describe('AuthProvider session expiry (6.4)', () => {
  it('handles several 401s for the stored token exactly once', async () => {
    setToken('tok-1');
    vi.mocked(authApi.me).mockResolvedValue(ADMIN);
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(401, 'UNAUTHORIZED', 'Authentication required')));
    const seen = [];
    function MessageLog() {
      const { sessionMessage } = useAuth();
      if (sessionMessage && seen[seen.length - 1] !== sessionMessage) seen.push(sessionMessage);
      return null;
    }
    render(
      <MemoryRouter initialEntries={['/admin/skills']}>
        <AuthProvider>
          <Probe />
          <MessageLog />
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(statusText()).toBe(AUTH_STATUS.AUTHENTICATED));

    await act(async () => {
      await Promise.all([protectedRequestGets401(), protectedRequestGets401(), protectedRequestGets401()]);
    });
    expect(getToken()).toBeNull();
    expect(statusText()).toBe(AUTH_STATUS.UNAUTHENTICATED);
    expect(auth.sessionMessage).toBe(SESSION_EXPIRED_MESSAGE);
    expect(auth.sessionFrom).toBe('/admin/skills');
    expect(seen).toEqual([SESSION_EXPIRED_MESSAGE]);

    act(() => auth.clearSessionMessage());
    expect(auth.sessionMessage).toBeNull();
  });

  it('ignores a 401 for a token that is no longer stored', async () => {
    setToken('old-token');
    vi.mocked(authApi.me).mockResolvedValue(ADMIN);
    let respond;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => (respond = r))));
    renderAuth('/admin');
    await waitFor(() => expect(statusText()).toBe(AUTH_STATUS.AUTHENTICATED));

    const inFlight = protectedRequestGets401(); // carries old-token
    await act(async () => {});
    setToken('new-token'); // a new login replaced the token meanwhile
    await act(async () => {
      respond(errorResponse(401, 'UNAUTHORIZED', 'Authentication required'));
      await inFlight;
    });
    expect(getToken()).toBe('new-token');
    expect(statusText()).toBe(AUTH_STATUS.AUTHENTICATED);
    expect(auth.sessionMessage).toBeNull();
  });
});

describe('useAuth', () => {
  it('throws outside an AuthProvider', () => {
    function Lonely() {
      useAuth();
      return null;
    }
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Lonely />)).toThrow(/AuthProvider/);
    vi.mocked(console.error).mockRestore();
  });
});

describe('resolvePostLoginPath (30.3)', () => {
  it.each([
    ['/admin', '/admin'],
    ['/admin/projects?x=1', '/admin/projects?x=1'],
    ['/admin?tab=1', '/admin?tab=1'],
    ['/admin/messages/5', '/admin/messages/5'],
    ['/admin/login', '/admin'],
    ['/admin/login?x=1', '/admin'],
    ['/admin/login/', '/admin'],
    ['/administrator', '/admin'],
    ['//evil.com', '/admin'],
    ['https://x.example', '/admin'],
    ['/\\evil.com', '/admin'],
    ['', '/admin'],
    [undefined, '/admin'],
    [null, '/admin'],
    [42, '/admin'],
    ['/projects', '/admin'],
  ])('%j → %s', (from, expected) => {
    expect(resolvePostLoginPath(from)).toBe(expected);
  });
});
