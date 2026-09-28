// Presentation-model snapshots (C6 execution document, residue *Testing*; M2 decisions): one file per probe fixture
// of both passes, per synthetic journal, per event fixture and for synthetic/500, holding the `Row[]` of `rowsOf`
// with every turn, group and cell expanded, keys sorted, timestamps as they are, `structured` and `input` verbatim.
// Time labels are pinned (now, locale, zone) so a snapshot never depends on the machine. A mismatch names the first
// differing row and field; `pnpm test -- -u src/renderer/src/transcript/model` accepts an intended change.
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listEventFixtures, listJournals, listSyntheticJournals, loadEventFixture, loadJournal, loadSyntheticJournal } from '../../../../../test/support/fixtures';
import { synthesise } from '../../../../../test/support/synth-transcript';
import { journalToEvents } from '../dev/replay-stub';
import { rowsOf, withAllExpanded } from './derive';
import { applyEvents, createState } from './reduce';
import type { Row } from './rows';
import { RowSchema } from './schema';
import { configureTime } from './time';

const SNAPSHOT_DIR = join(__dirname, '../../../../../test/snapshots/transcript');
const PINNED = { now: '2026-09-29T00:00:00.000Z', locale: 'en-US', timeZone: 'UTC' };

beforeAll(() => configureTime(PINNED));
afterAll(() => configureTime(null));

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]));
  return value;
}

// The first path at which two JSON values differ, for the failure message.
function firstDifference(a: unknown, b: unknown, path = ''): string | null {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if (i >= a.length || i >= b.length) return `${path}[${i}]: ${i >= a.length ? 'missing in the snapshot' : 'missing in the derivation'}`;
      const found = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const found = firstDifference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
      if (found) return found;
    }
    return null;
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`;
}

async function snapshot(file: string, events: SessionEvent[]): Promise<Row[]> {
  const rows = rowsOf(withAllExpanded(applyEvents(createState(null, null), events)));
  const invalid = rows.map((row, i) => [i, RowSchema.safeParse(row)] as const).filter(([, parsed]) => !parsed.success);
  expect(invalid.map(([i, parsed]) => `row ${i} (${rows[i].id}): ${parsed.error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)).toEqual([]);
  const json = `${JSON.stringify(rows.map(sortKeys), null, 2)}\n`;
  const path = join(SNAPSHOT_DIR, `${file}.rows.json`);
  try {
    await expect(json).toMatchFileSnapshot(path);
  } catch (error) {
    const previous = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Row[]) : [];
    const where = firstDifference(previous, rows.map(sortKeys)) ?? 'no structural difference found';
    const index = /^\[(\d+)\]/.exec(where)?.[1];
    throw new Error(`${file}: snapshot drift at row ${index ?? '?'}${index ? ` (${previous[Number(index)]?.id ?? rows[Number(index)]?.id})` : ''}, ${where}\n${(error as Error).message}`, { cause: error });
  }
  return rows;
}

describe('presentation model snapshots', () => {
  for (const pass of ['pass1', 'pass2'] as const) {
    for (const name of listJournals(pass)) {
      it(`${pass}/${name}`, async () => {
        const rows = await snapshot(`${pass}/${name}`, journalToEvents(loadJournal(pass, name)));
        expect(rows.length).toBeGreaterThan(0);
      });
    }
  }

  for (const name of listSyntheticJournals()) {
    it(`transcript/${name}`, async () => {
      const events = journalToEvents(loadSyntheticJournal(name));
      // Synthetic journals pass C1's wire validators in the round-trip suite; here their events pass X1 too.
      expect(events.map((event) => SessionEventSchema.safeParse(event).success)).not.toContain(false);
      const rows = await snapshot(`transcript/${name}`, events);
      expect(rows.length).toBeGreaterThan(0);
    });
  }

  for (const name of listEventFixtures()) {
    it(`events/${name}`, async () => {
      const rows = await snapshot(`events/${name}`, loadEventFixture(name));
      expect(rows.length).toBeGreaterThan(0);
    });
  }

  it('synthetic/500', async () => {
    const rows = await snapshot('synthetic/500', synthesise({ turns: 500, seed: 1 }));
    expect(rows.length).toBeGreaterThan(1000);
  });
});
