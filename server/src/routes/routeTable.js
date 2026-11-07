// The API route table (design: "API Endpoint Catalog"; Requirements 4.4, 7.1, 7.6).
//
// One entry per endpoint mounted by routes/index.js. `auth` is 'admin' when the route runs
// `requireAdmin` ([authenticate, requireRole('admin')]) and 'public' when it runs no
// authentication. A unit test walks the mounted Express router and checks that the set of
// (method, path) pairs equals this table and that every `auth` value matches the behavior, so
// the table cannot drift from the code. The authorization table tests and the README
// consistency check read it through `listRoutes()`.

/** @typedef {{ method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, auth: 'public' | 'admin' }} RouteEntry */

/** @type {ReadonlyArray<Readonly<RouteEntry>>} */
export const ROUTES = Object.freeze(
  [
    { method: 'GET', path: '/api/health', auth: 'public' },

    { method: 'POST', path: '/api/auth/login', auth: 'public' },
    { method: 'GET', path: '/api/auth/me', auth: 'admin' },

    { method: 'GET', path: '/api/profile', auth: 'public' },
    { method: 'PUT', path: '/api/profile', auth: 'admin' },

    { method: 'GET', path: '/api/settings', auth: 'public' },
    { method: 'PUT', path: '/api/settings', auth: 'admin' },

    { method: 'GET', path: '/api/projects', auth: 'public' },
    { method: 'GET', path: '/api/projects/:identifier', auth: 'public' },
    { method: 'GET', path: '/api/admin/projects', auth: 'admin' },
    { method: 'GET', path: '/api/admin/projects/:id', auth: 'admin' },
    { method: 'POST', path: '/api/projects', auth: 'admin' },
    { method: 'PUT', path: '/api/projects/:id', auth: 'admin' },
    { method: 'PATCH', path: '/api/projects/:id/publish', auth: 'admin' },
    { method: 'DELETE', path: '/api/projects/:id', auth: 'admin' },

    { method: 'GET', path: '/api/technologies', auth: 'admin' },

    { method: 'GET', path: '/api/skills', auth: 'public' },
    { method: 'POST', path: '/api/skills', auth: 'admin' },
    { method: 'PUT', path: '/api/skills/:id', auth: 'admin' },
    { method: 'DELETE', path: '/api/skills/:id', auth: 'admin' },

    { method: 'GET', path: '/api/experiences', auth: 'public' },
    { method: 'POST', path: '/api/experiences', auth: 'admin' },
    { method: 'PUT', path: '/api/experiences/:id', auth: 'admin' },
    { method: 'DELETE', path: '/api/experiences/:id', auth: 'admin' },

    { method: 'GET', path: '/api/education', auth: 'public' },
    { method: 'POST', path: '/api/education', auth: 'admin' },
    { method: 'PUT', path: '/api/education/:id', auth: 'admin' },
    { method: 'DELETE', path: '/api/education/:id', auth: 'admin' },

    { method: 'POST', path: '/api/contact', auth: 'public' },
    { method: 'GET', path: '/api/contact', auth: 'admin' },
    { method: 'GET', path: '/api/contact/:id', auth: 'admin' },
    { method: 'PATCH', path: '/api/contact/:id/read', auth: 'admin' },
    { method: 'DELETE', path: '/api/contact/:id', auth: 'admin' },

    { method: 'GET', path: '/api/dashboard/stats', auth: 'admin' },
  ].map((entry) => Object.freeze(entry)),
);

/**
 * Returns a fresh copy of the route table, in catalog order.
 * @returns {RouteEntry[]}
 */
export function listRoutes() {
  return ROUTES.map((entry) => ({ ...entry }));
}
