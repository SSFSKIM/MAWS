// Migration 14's step before its SQL (P5 O3-A; docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §4, binding): the
// browser's tables leave the index, and their rows go first to the staging tables of the browser's own database,
// `<profile>/browser/browser.sqlite` beside the index (§1: the client's file; the browser promotes staging into its live
// tables, src/main/browser/data/). The opener runs this inside its migration transaction (BEGIN IMMEDIATE on the index,
// so no other writer can add a row between this copy and the drop), after the earlier pending entries, so the three
// tables exist here even for an index below version 5, empty, and are staged empty. Every time an opener finds the index
// below 14 it replaces staging whole with a full copy, in one transaction in the browser's database, committed before the
// index's own commit: a crash anywhere repeats an idempotent step, and rows a build from before O3-A wrote to a
// version-13 index in between are in the next copy. Staging is therefore final once the index is at 14. The rows pass
// through this connection (the index's, in its transaction), not an ATTACH, which SQLite refuses inside a transaction.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BROWSER_COLUMNS, BROWSER_DATA_PATH, BROWSER_TABLES, browserTableSql, stagingTable } from '@shared/browser/data-schema';
import { isBrokenFile, moveAside } from './db';

// The browser's database beside an index file.
export const browserDataBeside = (indexPath: string): string => join(dirname(indexPath), ...BROWSER_DATA_PATH);

export function stageBrowserTables(index: DatabaseSync, indexPath: string): void {
  const path = browserDataBeside(indexPath);
  mkdirSync(dirname(path), { recursive: true });
  const db = openStaging(path);
  try {
    db.exec('BEGIN IMMEDIATE');
    for (const table of BROWSER_TABLES) {
      const columns = BROWSER_COLUMNS[table];
      const staging = stagingTable(table);
      db.exec(`DROP TABLE IF EXISTS ${staging}; ${browserTableSql(table, staging)}`);
      const read = index.prepare(`SELECT ${columns.join(', ')} FROM ${table}`);
      read.setReadBigInts(true); // every integer exactly, whatever its size
      const write = db.prepare(`INSERT INTO ${staging} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
      for (const row of read.iterate()) write.run(...columns.map((column) => row[column]!));
    }
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}

// Before the index reaches 14 the file holds nothing staging cannot rebuild, so one SQLite reports as not a database is
// moved aside (never deleted) and a fresh one made, rather than stopping the index's migration for good.
function openStaging(path: string): DatabaseSync {
  try {
    return prepared(path);
  } catch (error) {
    if (!isBrokenFile(error)) throw error;
    const aside = moveAside(path);
    console.error(`[index] ${path} is not a usable database (${error instanceof Error ? error.message : String(error)}); moved aside as ${aside}`);
    return prepared(path);
  }
}

function prepared(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout = 2000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
