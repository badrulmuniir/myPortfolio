// Dashboard statistics (Requirements 20.1, 20.4, 20.6).
//
// All seven counts come from one statement, so they are read from one snapshot of the Database
// (20.4). `count(*)::int` makes pg return JS numbers instead of the strings it uses for bigint.
// A query failure is thrown to the caller unchanged, so no partial counts are ever returned (20.6).

/** Keys of the DashboardStats shape (design: API Data Shapes), in response order. */
export const STAT_KEYS = Object.freeze([
  'projects_total',
  'projects_published',
  'skills',
  'experiences',
  'education',
  'messages_total',
  'messages_unread',
]);

export const SQL = Object.freeze({
  stats: `SELECT
            (SELECT count(*)::int FROM projects) AS projects_total,
            (SELECT count(*)::int FROM projects WHERE is_published) AS projects_published,
            (SELECT count(*)::int FROM skills) AS skills,
            (SELECT count(*)::int FROM experiences) AS experiences,
            (SELECT count(*)::int FROM education) AS education,
            (SELECT count(*)::int FROM contact_messages) AS messages_total,
            (SELECT count(*)::int FROM contact_messages WHERE NOT is_read) AS messages_unread`,
});

/**
 * @typedef {{ projects_total: number, projects_published: number, skills: number,
 *   experiences: number, education: number, messages_total: number, messages_unread: number }} DashboardStats
 */

/** @param {{ db: { query: Function } }} deps */
export function createDashboardService({ db }) {
  return Object.freeze({
    /** @returns {Promise<DashboardStats>} */
    async stats() {
      const { rows } = await db.query(SQL.stats);
      const row = rows[0];
      return Object.fromEntries(STAT_KEYS.map((key) => [key, row[key]]));
    },
  });
}
