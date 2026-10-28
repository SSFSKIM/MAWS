// The browser database's schema history (P5 O3-A; the O3 document §4), its own `user_version` line beside the index's: an
// ordered list, version N the N-th entry, applied once in the transaction that also promotes staging (index.ts). Never
// edit a released entry; append. The staging tables the index's migration 14 writes are not in it: their shape is the
// frozen contract in src/shared/browser/data-schema.ts.
import { BROWSER_INDEXES_SQL, BROWSER_TABLES, browserTableSql } from '@shared/browser/data-schema';

export interface BrowserMigration {
  version: number;
  sql: string;
}

export const BROWSER_MIGRATIONS: readonly BrowserMigration[] = [
  {
    version: 1,
    // The live tables, as the index's migrations 5 to 7 made them less `browser_activity`'s foreign key to `sessions`
    // (the browser deletes a removed session's rows itself), with their indexes.
    sql: `${BROWSER_TABLES.map((table) => `${browserTableSql(table)};`).join('\n')}\n${BROWSER_INDEXES_SQL}`,
  },
];
