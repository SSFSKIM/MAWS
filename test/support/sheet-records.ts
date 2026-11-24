// Question sheet records for tests (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §E): a fixture of
// the pinned set seeded under a scratch sminos home, and a fixture's outcome staged for the stand-in door
// (test/support/fake-sminos-cli.mjs) to replay. The fixtures are read in place and never edited.
import { copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SHEET_FIXTURES = join(__dirname, '../fixtures/sheet/set/fixtures');
export const FAKE_SMINOS = join(__dirname, 'fake-sminos-cli.mjs');

export const fixtureCases = (): string[] => readdirSync(SHEET_FIXTURES).sort();
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
export const fixtureSession = (name: string): string => (readJson(join(SHEET_FIXTURES, name, 'case.json')) as { session: string }).session;

/**
 * A seeded record: a fixture's `before` record under `<home>/sheet/`, its inbox cut to the offset its `state.json`
 * records. A fixture's `before` holds the inbox lines its step is about to apply; copied whole, those answers would
 * already stand queued. Answers the record's session.
 */
export function seedRecord(home: string, name: string, side: 'before' | 'after' = 'before'): string {
  const session = fixtureSession(name);
  const from = join(SHEET_FIXTURES, name, side, 'sheet', session);
  const record = join(home, 'sheet', session);
  mkdirSync(join(home, 'sheet'), { recursive: true });
  cpSync(from, record, { recursive: true });
  const { inbox } = readJson(join(record, 'state.json')) as { inbox: { offset: number } };
  try {
    truncateSync(join(record, 'inbox.jsonl'), inbox.offset);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return session;
}

/** A fixture's `after` staged for the stand-in door: its `state.json`, and its own keys in inbox order (`keys.json`). */
export function stageOutcome(home: string, name: string, keys: readonly string[]): void {
  const session = fixtureSession(name);
  const next = join(home, 'sheet', `${session}.next`);
  mkdirSync(next, { recursive: true });
  copyFileSync(join(SHEET_FIXTURES, name, 'after', 'sheet', session, 'state.json'), join(next, 'state.json'));
  writeFileSync(join(next, 'keys.json'), JSON.stringify(keys));
}
