import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AUTH_STATUS, useAuth } from '../context/AuthContext.jsx';
import { resolvePostLoginPath } from '../context/authPaths.js';
import { LoadingIndicator } from '../components/common/LoadingIndicator.jsx';
import { AuthStatusScreen } from './AuthStatusScreen.jsx';
import { VERIFYING_LABEL } from './ProtectedRoute.jsx';

/**
 * Wraps `/admin/login` (Requirement 30.7).
 *
 * - `checking`: loading indicator, so the login form does not flash before a redirect.
 * - `authenticated`: redirects to `resolvePostLoginPath(location.state?.from)`. A normal visit
 *   to `/admin/login` carries no remembered path, so this is `/admin` (30.7). Right after a
 *   successful login the remembered path from ProtectedRoute is used instead (30.3), so the
 *   result does not depend on whether this guard or the login page navigates first.
 * - `unauthenticated` or `error`: renders the login page.
 */
export function GuestOnlyRoute({ children }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === AUTH_STATUS.CHECKING) {
    return (
      <AuthStatusScreen>
        <LoadingIndicator label={VERIFYING_LABEL} />
      </AuthStatusScreen>
    );
  }

  if (status === AUTH_STATUS.AUTHENTICATED) {
    return <Navigate to={resolvePostLoginPath(location.state?.from)} replace />;
  }

  return children ?? <Outlet />;
}

export default GuestOnlyRoute;
