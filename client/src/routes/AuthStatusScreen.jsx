/**
 * Full-page container for the route guards' loading and error states. Gives the screen its
 * own `main` and a (visually hidden) `h1`, so it still has the landmarks of a page (34.6).
 *
 * @param {{ children: import('react').ReactNode }} props
 */
export function AuthStatusScreen({ children }) {
  return (
    <main id="main" tabIndex={-1} className="admin-status-page">
      <h1 className="visually-hidden">Admin dashboard</h1>
      {children}
    </main>
  );
}

export default AuthStatusScreen;
