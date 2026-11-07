// Website Settings (Requirements 11.1, 11.2, 11.3, 11.8; design: "Settings storage", Services table).
//
// Storage: one `settings` row per key, `setting_value JSONB`. The text keys are stored as JSON
// strings and `social_links` as a JSON array of `{ label, url }`.
//
// Reads return exactly the four keys, with stored values merged over the defaults the Seed_Script
// creates (11.1). A stored value of the wrong type (which only a direct Database edit could cause)
// falls back to the default instead of leaking an unexpected shape to the Public_Site.
//
// Writes upsert only the supplied keys, all in one transaction, so a failure leaves every key
// unchanged (11.2, 11.7). Key names come only from SETTINGS_KEYS; any other key is ignored here,
// and the Validator has already rejected it with 400 (11.3).
import { SETTINGS_KEYS } from '../validators/settings.schemas.js';
import { DEFAULT_SETTINGS } from './seedService.js';

export { DEFAULT_SETTINGS };

export const SQL = Object.freeze({
  selectAll: 'SELECT setting_key, setting_value FROM settings WHERE setting_key = ANY ($1::text[])',
  upsert:
    'INSERT INTO settings (setting_key, setting_value) VALUES ($1, $2::jsonb) ' +
    'ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value',
});

const TEXT_KEYS = Object.freeze(['site_title', 'hero_introduction', 'footer_text']);

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keeps only well-formed `{ label, url }` entries, in stored order, with no other keys. */
function normalizeSocialLinks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((e) => isPlainObject(e) && typeof e.label === 'string' && typeof e.url === 'string')
    .map(({ label, url }) => ({ label, url }));
}

/**
 * Builds the full Settings object from stored rows.
 * @param {Array<{ setting_key: string, setting_value: unknown }>} rows
 * @returns {{ site_title: string, hero_introduction: string, footer_text: string,
 *   social_links: Array<{ label: string, url: string }> }}
 */
export function mergeSettings(rows) {
  const stored = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
  const result = {};
  for (const key of TEXT_KEYS) {
    const value = stored.get(key);
    result[key] = typeof value === 'string' ? value : DEFAULT_SETTINGS[key];
  }
  result.social_links = stored.has('social_links') ? normalizeSocialLinks(stored.get('social_links')) : [];
  return result;
}

/**
 * @param {{ db: { query: Function, withTransaction: Function } }} deps
 */
export function createSettingsService({ db }) {
  const read = async (q) => {
    const { rows } = await q.query(SQL.selectAll, [SETTINGS_KEYS]);
    return mergeSettings(rows);
  };

  return {
    /** Returns the full Settings object (11.1). */
    getAll() {
      return read(db);
    },

    /**
     * Stores the supplied keys and returns the full Settings object (11.2). `partial` holds
     * validated, trimmed values. Omitted keys are left unchanged.
     * @param {Partial<Record<'site_title' | 'hero_introduction' | 'footer_text' | 'social_links', unknown>>} partial
     */
    update(partial) {
      const keys = SETTINGS_KEYS.filter((k) => Object.hasOwn(partial ?? {}, k) && partial[k] !== undefined);
      return db.withTransaction(async (tx) => {
        for (const key of keys) {
          // JSON.stringify + ::jsonb, because pg would send a JS array as a PostgreSQL array.
          await tx.query(SQL.upsert, [key, JSON.stringify(partial[key])]);
        }
        return read(tx);
      });
    },
  };
}
