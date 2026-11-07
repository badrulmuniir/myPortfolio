// Auth_Context (design: Frontend > Auth_Context; Requirements 6.2-6.4, 6.6-6.8, 30.3, 32.10).
//
// Must be rendered inside a Router: it reads the current location to decide whether a
// session expiry shows a message, and `logout()` navigates to /admin/login.
//
// useAuth() returns:
//   status              one of AUTH_STATUS
//   admin               { id, email, role } while authenticated, otherwise null
//   sessionMessage      SESSION_EXPIRED_MESSAGE after an expiry on an admin page, otherwise null
//   sessionFrom         path + search remembered at that expiry, otherwise null
//   login(email, pw)    → Promise<admin>; rethrows the ApiError and stores nothing on failure
//   logout()            clears the token and identity and navigates to /admin/login; sends no request
//   retryVerification() repeats the GET /auth/me check after an `error` status
//   clearSessionMessage()
//
// Only this module and the API_Client import tokenStorage (32.10).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as authApi from '../api/authApi.js';
import { setUnauthorizedHandler } from '../api/apiClient.js';
import { clearToken, getToken, setToken } from '../utils/tokenStorage.js';
import { LOGIN_PATH_NAME, isAdminPath, isLoginPath, resolvePostLoginPath } from './authPaths.js';

export { resolvePostLoginPath };

export const AUTH_STATUS = Object.freeze({
  CHECKING: 'checking',
  AUTHENTICATED: 'authenticated',
  UNAUTHENTICATED: 'unauthenticated',
  ERROR: 'error',
});

export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please sign in again.';

const AuthContext = createContext(null);

/** Keeps only the identity fields the Auth_Context exposes (6.2). */
const pickAdmin = (value) => ({ id: value?.id, email: value?.email, role: value?.role });

const isAbortError = (err) => err?.name === 'AbortError';

const initialState = () => ({
  status: getToken() ? AUTH_STATUS.CHECKING : AUTH_STATUS.UNAUTHENTICATED, // 6.6
  admin: null,
  sessionMessage: null,
  sessionFrom: null,
});

export function AuthProvider({ children }) {
  const [state, setState] = useState(initialState);
  // Incremented by retryVerification(); every value runs the GET /auth/me check once.
  const [verifyAttempt, setVerifyAttempt] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();

  // Read inside callbacks so they always see the location at the time of the event.
  const locationRef = useRef(location);
  locationRef.current = location;

  /** Ends the session after a 401. Shows the message only on admin pages other than login (6.4, 6.7). */
  const expireSession = useCallback(() => {
    clearToken();
    const { pathname, search } = locationRef.current;
    const onAdminPage = isAdminPath(pathname) && !isLoginPath(pathname);
    setState({
      status: AUTH_STATUS.UNAUTHENTICATED,
      admin: null,
      sessionMessage: onAdminPage ? SESSION_EXPIRED_MESSAGE : null,
      sessionFrom: onAdminPage ? `${pathname}${search}` : null,
    });
  }, []);

  // Session verification at load and on retry (6.2, 6.6, 6.7, 6.8).
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setState((s) =>
        s.status === AUTH_STATUS.UNAUTHENTICATED ? s : { ...s, status: AUTH_STATUS.UNAUTHENTICATED, admin: null },
      );
      return undefined;
    }

    // Aborted on cleanup, so a StrictMode re-run or an unmount never applies a stale result.
    const controller = new AbortController();
    authApi
      .me({ signal: controller.signal, skipUnauthorizedHandler: true })
      .then((data) => {
        if (controller.signal.aborted || getToken() !== token) return;
        setState((s) => ({ ...s, status: AUTH_STATUS.AUTHENTICATED, admin: pickAdmin(data) }));
      })
      .catch((err) => {
        if (controller.signal.aborted || isAbortError(err) || getToken() !== token) return;
        if (err?.status === 401) {
          expireSession();
        } else {
          // Network error or another status: keep the token, stay not authenticated (6.8).
          setState((s) => ({ ...s, status: AUTH_STATUS.ERROR, admin: null }));
        }
      });
    return () => controller.abort();
  }, [verifyAttempt, expireSession]);

  // Session expiry from any request that carried the token (6.4). Only a 401 for the token
  // that is still stored counts: the first one clears it, so later in-flight 401s and 401s
  // for a token replaced by a new login do nothing.
  useEffect(() => {
    setUnauthorizedHandler((usedToken) => {
      if (!usedToken || usedToken !== getToken()) return;
      expireSession();
    });
    return () => setUnauthorizedHandler(null);
  }, [expireSession]);

  const login = useCallback(async (email, password) => {
    const result = await authApi.login({ email, password });
    if (typeof result?.token !== 'string' || result.token === '') {
      throw new Error('The login response did not contain a token.');
    }
    setToken(result.token);
    const admin = pickAdmin(result.admin);
    setState({ status: AUTH_STATUS.AUTHENTICATED, admin, sessionMessage: null, sessionFrom: null });
    return admin;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setState({ status: AUTH_STATUS.UNAUTHENTICATED, admin: null, sessionMessage: null, sessionFrom: null });
    navigate(LOGIN_PATH_NAME); // 6.3: no request is sent
  }, [navigate]);

  const retryVerification = useCallback(() => {
    setState((s) => ({ ...s, status: getToken() ? AUTH_STATUS.CHECKING : AUTH_STATUS.UNAUTHENTICATED }));
    setVerifyAttempt((n) => n + 1);
  }, []);

  const clearSessionMessage = useCallback(() => {
    setState((s) => (s.sessionMessage === null && s.sessionFrom === null ? s : { ...s, sessionMessage: null, sessionFrom: null }));
  }, []);

  const value = useMemo(
    () => ({ ...state, login, logout, retryVerification, clearSessionMessage }),
    [state, login, logout, retryVerification, clearSessionMessage],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Returns the Auth_Context value. Throws when used outside an AuthProvider. */
export function useAuth() {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth must be used inside an AuthProvider.');
  return value;
}
