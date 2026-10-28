// The browser's own database for a unit test (P5 O3-A; src/main/browser/data/): a BrowserData over
// `<dir>/browser/browser.sqlite`, whose readiness is the user_version of `<dir>/index.sqlite`, a bare file standing in
// for the index at the version the test asks.
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BROWSER_DATA_PATH, BROWSER_HANDOFF_INDEX_VERSION } from '@shared/browser/data-schema';
import { BrowserData } from '../../src/main/browser/data';

export const browserDataFile = (dir: string): string => join(dir, ...BROWSER_DATA_PATH);

// `<dir>/index.sqlite`, made to answer `version`.
export function indexAt(dir: string, version: number): string {
  const path = join(dir, 'index.sqlite');
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA user_version = ${version}`);
  } finally {
    db.close();
  }
  return path;
}

// The browser's data in use: the index at the handoff version, and `sessions` the spine's snapshot (null: none, so no
// activity is kept).
export function browserDataIn(dir: string, sessions: Iterable<string> | null = []): BrowserData {
  const data = new BrowserData({ file: browserDataFile(dir), index: indexAt(dir, BROWSER_HANDOFF_INDEX_VERSION) });
  data.reattach(sessions);
  return data;
}

// The browser's data waiting on an index below the handoff (a pre-O3-A build's, version 13): inert.
export function waitingBrowserDataIn(dir: string): BrowserData {
  return new BrowserData({ file: browserDataFile(dir), index: indexAt(dir, BROWSER_HANDOFF_INDEX_VERSION - 1) });
}
