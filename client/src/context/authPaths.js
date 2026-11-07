// Path rules for the Auth_Context (Requirements 6.4, 6.7, 30.3).
//
// "Starts with /admin" is read as the path segment (design: Interpretations): the path is
// `/admin` or begins with `/admin/` or `/admin?`. `/administrator` is not an admin path.
// Every accepted value starts with a single `/admin`, so it can never carry a protocol or a
// host (`//evil.com`, `https://…`): navigation always stays inside the app.

const ADMIN_PATH = /^\/admin(?:[/?]|$)/;
const LOGIN_PATH = /^\/admin\/login(?:[/?#]|$)/;

/** The path the post-login redirect falls back to. */
export const ADMIN_HOME_PATH = '/admin';

/** The Admin_Dashboard login page. */
export const LOGIN_PATH_NAME = '/admin/login';

/**
 * True when `path` is an Admin_Dashboard path (`/admin`, `/admin/…` or `/admin?…`).
 * @param {unknown} path
 */
export const isAdminPath = (path) => typeof path === 'string' && ADMIN_PATH.test(path);

/**
 * True when `path` is the login page, with or without a trailing slash, query or hash.
 * @param {unknown} path
 */
export const isLoginPath = (path) => typeof path === 'string' && LOGIN_PATH.test(path);

/**
 * Returns where to go after a successful login (30.3): the remembered path when it is an
 * Admin_Dashboard path other than the login page (its query string is kept), otherwise `/admin`.
 * @param {unknown} from
 * @returns {string}
 */
export function resolvePostLoginPath(from) {
  return isAdminPath(from) && !isLoginPath(from) ? from : ADMIN_HOME_PATH;
}
