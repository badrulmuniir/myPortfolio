// pg type parser overrides.
// DATE columns are returned as the stored 'YYYY-MM-DD' string. The default parser builds a
// local-time JS Date, which shifts the day when the server time zone is not UTC (27.3).
import pg from 'pg';

export const DATE_OID = 1082;

/** Registers the overrides on `types` (the global pg.types by default). Safe to call repeatedly. */
export function registerTypeParsers(types = pg.types) {
  types.setTypeParser(DATE_OID, (value) => value);
}
