// The history decoder over the synthetic Chrome profile (E4b Design §6; Acceptance G1): the `urls` rows with Chrome
// time converted and Chrome's counts carried, and which rows an import takes.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildChromeUserData, type ChromeUserData } from '../../../../../test/support/chrome-profile';
import { classifyHistoryRow, historyStoreCounts, readHistoryRows, type ChromeHistoryRow } from './history';

let root: string;
let fixture: ChromeUserData;
let rows: ChromeHistoryRow[];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-e4b-history-'));
  fixture = buildChromeUserData(join(root, 'Chrome'));
  const db = new DatabaseSync(fixture.profiles.Default.history.file);
  try {
    rows = readHistoryRows(db);
  } finally {
    db.close();
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const base: ChromeHistoryRow = { url: 'https://example.test/a', title: 'A', visitCount: 1, typedCount: 0, lastVisitMs: 1, hidden: false };

describe('readHistoryRows', () => {
  it('reads the six rows with Chrome time converted to Unix ms and the counts carried', () => {
    const entries = fixture.profiles.Default.history.entries;
    expect(rows).toEqual(
      entries.map((entry) => ({ url: entry.url, title: entry.title, visitCount: entry.visitCount, typedCount: entry.typedCount, lastVisitMs: entry.lastVisitMs, hidden: entry.hidden })),
    );
  });

  it('counts the rows and reads the store version for the consent sheet', () => {
    const db = new DatabaseSync(fixture.profiles.Default.history.file);
    try {
      expect(historyStoreCounts(db)).toEqual({ rows: 6, storeVersion: 70 });
    } finally {
      db.close();
    }
  });
});

describe('classifyHistoryRow', () => {
  it('takes 4 of the six rows and skips 1 hidden and 1 chrome:// page', () => {
    const decided = rows.map(classifyHistoryRow);
    expect(decided.map((d) => (d.kind === 'skipped' ? d.reason : d.kind))).toEqual(fixture.profiles.Default.history.entries.map((entry) => entry.expected === 'imported' ? 'import' : entry.expected));
    const imported = decided.flatMap((d) => (d.kind === 'import' ? [d.row] : []));
    expect(imported).toHaveLength(4);
    expect(imported[0]).toEqual({ url: rows[0]!.url, title: rows[0]!.title, visitCount: 12, typedCount: 3, lastVisitMs: rows[0]!.lastVisitMs });
  });

  it('names a skipped row by its host only', () => {
    expect(classifyHistoryRow({ ...base, hidden: true })).toEqual({ kind: 'skipped', reason: 'hidden', host: 'example.test' });
    expect(classifyHistoryRow({ ...base, url: 'file:///Users/someone/secret.txt' })).toEqual({ kind: 'skipped', reason: 'unsupportedScheme', host: null });
    expect(classifyHistoryRow({ ...base, url: 'chrome://settings/x' })).toEqual({ kind: 'skipped', reason: 'unsupportedScheme', host: 'settings' });
    // Unparsable is one of the refusals validateBrowserUrl names (Design §6).
    expect(classifyHistoryRow({ ...base, url: 'not a url' })).toEqual({ kind: 'skipped', reason: 'unsupportedScheme', host: null });
  });

  it('calls a row without a URL or with impossible counts invalid', () => {
    for (const over of [{ url: null }, { url: '' }, { visitCount: -1 }, { lastVisitMs: Number.NaN }])
      expect(classifyHistoryRow({ ...base, ...over }), JSON.stringify(over)).toMatchObject({ kind: 'skipped', reason: 'invalid' });
  });

  it('stores the URL as the browser serialises it and an empty title as none', () => {
    expect(classifyHistoryRow({ ...base, url: 'HTTPS://Example.TEST', title: '' })).toEqual({
      kind: 'import',
      row: { url: 'https://example.test/', title: null, visitCount: 1, typedCount: 0, lastVisitMs: 1 },
    });
  });
});
