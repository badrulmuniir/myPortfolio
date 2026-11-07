import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AUTH_STATUS, useAuth } from '../context/AuthContext.jsx';
import { LOGIN_PATH_NAME } from '../context/authPaths.js';
import { LoadingIndicator } from '../components/common/LoadingIndicator.jsx';
import { ErrorState } from '../components/common/ErrorState.jsx';
import { AuthStatusScreen } from './AuthStatusScreen.jsx';

export const VERIFYING_LABEL = 'Checking your session…';
export const VERIFY_ERROR_MESSAGE = 'Your session could not be verified. Check your connection and try again.';

/**
 * Guards every Admin_Dashboard route except `/admin/login` (Requirements 30.5, 30.6, 6.8).
 *
 * | Auth status       | Renders                                                                  |
 * |-------------------|--------------------------------------------------------------------------|
 * | `checking`        | a loading indicator; no protected content and no redirect (30.5)        |
 * | `error`           | an error message with Retry → `retryVerification()`; no redirect (6.8)  |
 * | `unauthenticated` | `<Navigate to="/admin/login" replace>` with `state.from` = requested    |
 * |                   | path + query string (30.6); no protected content                         |
 * | `authenticated`   | `children`, or the nested routes through `<Outlet />`                    |
 *
 * `state.from` is the path the Auth_Context remembered at a session expiry (6.4) when there is
 * one, otherwise the location being guarded.
 */
export function ProtectedRoute({ children }) {
  const { status, retryVerification, sessionFrom } = useAuth();
  const location = useLocation();

  if (status === AUTH_STATUS.CHECKING) {
    return (
      <AuthStatusScreen>
        <LoadingIndicator label={VERIFYING_LABEL} />
      </AuthStatusScreen>
    );
  }

  if (status === AUTH_STATUS.ERROR) {
    return (
      <AuthStatusScreen>
        <ErrorState message={VERIFY_ERROR_MESSAGE} onRetry={retryVerification} />
      </AuthStatusScreen>
    );
  }

  if (status !== AUTH_STATUS.AUTHENTICATED) {
    const from = sessionFrom ?? `${location.pathname}${location.search}`;
    return <Navigate to={LOGIN_PATH_NAME} replace state={{ from }} />;
  }

  return children ?? <Outlet />;
}

export default ProtectedRoute;
