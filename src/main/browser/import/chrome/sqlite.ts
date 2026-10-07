// Reading MAWS's private copies of Chrome's SQLite stores (E4b Design §4; E0b's stores.mjs `rows`): Chrome's microsecond
// timestamps exceed 2^53, so statements read BigInts and everything that fits a safe integer comes back as a Number.
import type { DatabaseSync } from 'node:sqlite';

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export function allRows(db: DatabaseSync, sql: string): Record<string, unknown>[] {
  const statement = db.prepare(sql);
  statement.setReadBigInts(true);
  return (statement.all() as Record<string, unknown>[]).map((row) => {
    const out: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(row)) out[column] = typeof value === 'bigint' && value <= SAFE && value >= -SAFE ? Number(value) : value;
    return out;
  });
}

// The store's `meta.version`; a store without one is not a Chrome store this import can read (Design §4).
export function storeVersion(db: DatabaseSync): number {
  const missing = () => Object.assign(new Error('the store has no meta version'), { code: 'NO_META_VERSION' });
  let rows;
  try {
    rows = allRows(db, "SELECT value FROM meta WHERE key = 'version'");
  } catch (error) {
    throw (error as { errcode?: unknown }).errcode === 1 ? missing() : error; // SQLITE_ERROR: no `meta` table; a corrupt file keeps its own code
  }
  const version = Number(rows[0]?.value);
  if (!Number.isInteger(version)) throw missing();
  return version;
}

export function countOf(db: DatabaseSync, sql: string): number {
  return Number(allRows(db, sql)[0]?.n ?? 0);
}
