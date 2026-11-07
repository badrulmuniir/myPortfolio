// Skills (Requirements 15.1, 15.2, 15.7, 15.8).
//
// All SQL for the skills table lives here. Every statement is parameterized and writes return
// the stored row with RETURNING, so a response always shows what the Database holds.
// Input values come from the `skillBody` schema: trimmed, validated, and with omitted optional
// fields already set to '' (15.7).

/** Columns sent in every Skill response (design: API Data Shapes). */
export const SKILL_COLUMNS = 'id, name, category, proficiency_level, icon_url, display_order';

export const SQL = Object.freeze({
  // 15.1: category (case-insensitive), display_order, name (case-insensitive), id. COLLATE "C"
  // gives code-point order, so the SQL order equals a plain JS reference sort.
  list: `SELECT ${SKILL_COLUMNS} FROM skills
          ORDER BY lower(category) COLLATE "C" ASC, display_order ASC, lower(name) COLLATE "C" ASC, id ASC`,
  create: `INSERT INTO skills (name, category, proficiency_level, icon_url, display_order)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING ${SKILL_COLUMNS}`,
  update: `UPDATE skills
              SET name = $2, category = $3, proficiency_level = $4, icon_url = $5, display_order = $6
            WHERE id = $1
           RETURNING ${SKILL_COLUMNS}`,
  remove: 'DELETE FROM skills WHERE id = $1 RETURNING id',
});

/**
 * @typedef {{ name: string, category: string, proficiency_level: string, icon_url: string,
 *   display_order: number }} SkillInput
 * @typedef {SkillInput & { id: number }} Skill
 */

const values = (input) => [input.name, input.category, input.proficiency_level, input.icon_url, input.display_order];

/** @param {{ db: { query: Function } }} deps */
export function createSkillService({ db }) {
  return Object.freeze({
    /** @returns {Promise<Skill[]>} every Skill in the documented order; [] when none exist */
    async list() {
      const { rows } = await db.query(SQL.list);
      return rows;
    },

    /** @param {SkillInput} input @returns {Promise<Skill>} */
    async create(input) {
      const { rows } = await db.query(SQL.create, values(input));
      return rows[0];
    },

    /**
     * Replaces every field (15.7).
     * @param {number} id @param {SkillInput} input
     * @returns {Promise<Skill | null>} null when no Skill has this id
     */
    async update(id, input) {
      const { rows } = await db.query(SQL.update, [id, ...values(input)]);
      return rows[0] ?? null;
    },

    /** @param {number} id @returns {Promise<boolean>} false when no Skill has this id */
    async remove(id) {
      const { rows } = await db.query(SQL.remove, [id]);
      return rows.length > 0;
    },
  });
}
