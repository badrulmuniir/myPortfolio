// Technologies (Requirements 14.1, 14.2, 14.3).
//
// All SQL for the technologies table lives here. Every statement is parameterized.
// - `list()` serves GET /api/technologies (14.3).
// - `ensureByNames(tx, names)` is called by the project save transaction (14.4) to turn the
//   submitted Technology names into ids. Names that match an existing Technology
//   case-insensitively reuse it and leave its stored name and category unchanged (14.1). Other
//   names are inserted with the submitted letter case and an empty category (14.2).

/** Columns sent in every Technology response (design: API Data Shapes). */
export const TECHNOLOGY_COLUMNS = 'id, name, category';

export const SQL = Object.freeze({
  // 14.3: name ascending, case-insensitive. COLLATE "C" gives code-point order, so the SQL order
  // equals a plain JS reference sort; id breaks ties between names that differ only in case.
  list: `SELECT ${TECHNOLOGY_COLUMNS} FROM technologies
          ORDER BY lower(name) COLLATE "C" ASC, id ASC`,
  // One statement for every unknown name. The unique index technologies_name_lower_key makes a
  // name that already exists (or is inserted by a concurrent transaction) a no-op.
  insertMissing:
    'INSERT INTO technologies (name) SELECT unnest($1::text[]) ON CONFLICT ((lower(name))) DO NOTHING',
  // Ids in the order of the submitted names. lower() runs in SQL on both sides, so matching uses
  // exactly the same case folding as the unique index.
  selectByNames: `SELECT t.id, t.name, t.category
                    FROM unnest($1::text[]) WITH ORDINALITY AS n(name, ord)
                    JOIN technologies t ON lower(t.name) = lower(n.name)
                   ORDER BY n.ord`,
});

/**
 * @typedef {{ id: number, name: string, category: string }} Technology
 * @typedef {{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }} Queryable
 */

/**
 * Trims every name, drops empty ones and keeps the first spelling of each case-insensitive name.
 * The projectBody schema already does this; it is repeated so a caller cannot create duplicates.
 * @param {unknown[]} names
 * @returns {string[]}
 */
export function uniqueNames(names) {
  const seen = new Set();
  const result = [];
  for (const raw of names ?? []) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    const key = name.toLowerCase();
    if (name === '' || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

/**
 * Makes sure a Technology exists for every name and returns their rows in input order.
 * Must run inside the caller's transaction (`tx`), so a later failure rolls the inserts back (14.5).
 * @param {Queryable} tx a transaction client (anything with `query`)
 * @param {string[]} names Technology names
 * @returns {Promise<Technology[]>} one row per distinct name, in the order of `names`
 */
export async function ensureTechnologyRows(tx, names) {
  const unique = uniqueNames(names);
  if (unique.length === 0) return [];
  await tx.query(SQL.insertMissing, [unique]);
  const { rows } = await tx.query(SQL.selectByNames, [unique]);
  // Safety net: two names that JS sees as different but lower() folds together map to one row.
  const seen = new Set();
  return rows.filter((row) => !seen.has(row.id) && seen.add(row.id));
}

/**
 * Same as `ensureTechnologyRows`, returning only the ids.
 * @param {Queryable} tx
 * @param {string[]} names
 * @returns {Promise<number[]>} ids in the order of `names`, without duplicates
 */
export async function ensureTechnologiesByNames(tx, names) {
  return (await ensureTechnologyRows(tx, names)).map((row) => row.id);
}

/** @param {{ db: Queryable }} deps */
export function createTechnologyService({ db }) {
  return Object.freeze({
    /** @returns {Promise<Technology[]>} every Technology in the documented order; [] when none exist */
    async list() {
      const { rows } = await db.query(SQL.list);
      return rows;
    },

    /**
     * @param {Queryable} tx the project save transaction
     * @param {string[]} names
     * @returns {Promise<number[]>} ids in the order of `names`
     */
    ensureByNames: ensureTechnologiesByNames,

    /** Like `ensureByNames`, returning `{ id, name, category }` rows. */
    ensureRowsByNames: ensureTechnologyRows,
  });
}
