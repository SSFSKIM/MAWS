// Chrome's history store, decoded (E4b Design §6; E0b findings :223-234). Pure over an opened copy: the `urls` rows with
// Chrome time converted and Chrome's counts carried (Decision Log 16), and which of them an import takes. A skipped row
// is named by its host only (Decision Log 22).
import type { DatabaseSync } from 'node:sqlite';
import type { HistorySkipReason } from '@shared/browser/import';
import { validateBrowserUrl } from '@shared/browser/url';
import { chromeTimeToUnixMs } from './crypto';
import { allRows, countOf, storeVersion } from './sqlite';

export interface ChromeHistoryRow {
  url: string | null;
  title: string | null;
  visitCount: number;
  typedCount: number;
  lastVisitMs: number; // Unix ms
  hidden: boolean;
}

// One row as `BrowserHistoryStore.importRows` takes it: the URL as the browser serialises it, no empty title.
export interface ImportedHistoryRow {
  url: string;
  title: string | null;
  visitCount: number;
  typedCount: number;
  lastVisitMs: number;
}

export type HistoryDecision = { kind: 'import'; row: ImportedHistoryRow } | { kind: 'skipped'; reason: HistorySkipReason; host: string | null };

export function readHistoryRows(db: DatabaseSync): ChromeHistoryRow[] {
  return allRows(db, 'SELECT url, title, visit_count, typed_count, last_visit_time, hidden FROM urls ORDER BY id').map((row) => ({
    url: typeof row.url === 'string' ? row.url : null,
    title: typeof row.title === 'string' ? row.title : null,
    visitCount: Number(row.visit_count),
    typedCount: Number(row.typed_count),
    lastVisitMs: chromeTimeToUnixMs((row.last_visit_time as bigint | number | null) ?? 0),
    hidden: Boolean(row.hidden),
  }));
}

// What the consent sheet shows: "17,554 pages" (Design §3).
export function historyStoreCounts(db: DatabaseSync): { rows: number; storeVersion: number } {
  return { rows: countOf(db, 'SELECT count(*) AS n FROM urls'), storeVersion: storeVersion(db) };
}

const isCount = (n: number) => Number.isSafeInteger(n) && n >= 0;

export function classifyHistoryRow(row: ChromeHistoryRow): HistoryDecision {
  if (!row.url || !isCount(row.visitCount) || !isCount(row.typedCount) || !Number.isFinite(row.lastVisitMs)) return { kind: 'skipped', reason: 'invalid', host: hostOf(row.url) };
  if (row.hidden) return { kind: 'skipped', reason: 'hidden', host: hostOf(row.url) };
  const check = validateBrowserUrl(row.url); // refuses all but http(s): chrome://, file:, an unparsable URL
  if (!check.ok) return { kind: 'skipped', reason: 'unsupportedScheme', host: hostOf(row.url) };
  return { kind: 'import', row: { url: check.url, title: row.title || null, visitCount: row.visitCount, typedCount: row.typedCount, lastVisitMs: row.lastVisitMs } };
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}
