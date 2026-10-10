// Presentation-model snapshots (C6 execution document, residue *Testing*; M2 decisions): one file per probe fixture
// of the three passes (through C3's normaliser since the rebase), per synthetic journal, per event fixture and for synthetic/500, holding the `Row[]` of `rowsOf`
// with every turn, group and cell expanded, keys sorted, timestamps as they are, `structured` and `input` verbatim.
// Time labels are pinned (now, locale, zone) so a snapshot never depends on the machine. A mismatch names the first
// differing row and field; `pnpm test -- -u src/renderer/src/transcript/model` accepts an intended change, and is the
// only run that writes a new fixture's snapshot (E11 W-E: any other run fails on a missing one).
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_PASSES, listEventFixtures, listJournals, listSyntheticJournals, loadEngineJournal /* P2-C (2026-10-09) */, loadEventFixture, loadJournal, loadSyntheticJournal } from '../../../../../test/support/fixtures';
import { synthesise } from '../../../../../test/support/synth-transcript';
import { journalToEvents } from '../dev/journal';
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

// Why a snapshot cannot be compared: its baseline is not committed and this run does not update snapshots (vitest's
// update state: `all` under `-u`, `new` by default outside CI, `none` in CI); null when the comparison may go ahead.
function missingBaseline(path: string, update: 'all' | 'new' | 'none'): string | null {
  return existsSync(path) || update === 'all' ? null : `${relative(SNAPSHOT_DIR, path)}: no committed snapshot; write it with \`-u\` and commit it`;
}

async function snapshot(file: string, events: SessionEvent[]): Promise<Row[]> {
  const rows = rowsOf(withAllExpanded(applyEvents(createState(null, null), events)));
  const invalid = rows.map((row, i) => [i, RowSchema.safeParse(row)] as const).filter(([, parsed]) => !parsed.success);
  expect(invalid.map(([i, parsed]) => `row ${i} (${rows[i].id}): ${parsed.error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)).toEqual([]);
  const json = `${JSON.stringify(rows.map(sortKeys), null, 2)}\n`;
  const path = join(SNAPSHOT_DIR, `${file}.rows.json`);
  const missing = missingBaseline(path, expect.getState().snapshotState.snapshotUpdateState);
  if (missing !== null) throw new Error(missing);
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
  for (const pass of FIXTURE_PASSES) {
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

  // A turn paused mid-work (C6 M4 pin): the first turn of pass1/permission-roundtrip after its Bash tool use (seq 47)
  // and before the result (seq 53). Its one running call is still a group, active, with the thinking before it inside:
  // an active group never unwraps (it unwraps once completed, in the full fixture's snapshot).
  it('paused/pass1-permission-roundtrip-47', async () => {
    const events = journalToEvents(loadJournal('pass1', 'permission-roundtrip')).filter((event) => event.seq !== null && event.seq <= 47);
    const rows = await snapshot('paused/pass1-permission-roundtrip-47', events);
    const group = rows.find((row) => row.kind === 'group');
    expect(group).toMatchObject({ state: 'active', activeLabel: expect.stringMatching(/^Running `.+` for /) });
    expect(group?.kind === 'group' && group.cells.map((cell) => [cell.toolName, cell.status])).toEqual([['thinking', 'done'], ['Bash', 'running']]);
    expect(rows.filter((row) => row.kind === 'cell')).toEqual([]);
  });

  // pass2/workflow mid-turn (seq 82): the Workflow call is a subagent row, working, with no tool cell of the parent.
  it('paused/pass2-workflow-82', async () => {
    const events = journalToEvents(loadJournal('pass2', 'workflow')).filter((event) => event.seq !== null && event.seq <= 82);
    const rows = await snapshot('paused/pass2-workflow-82', events);
    expect(rows.find((row) => row.kind === 'divider')).toMatchObject({ state: 'working' });
    expect(rows.find((row) => row.kind === 'subagent')).toMatchObject({ status: 'working' });
  });

  // P2-C start (2026-10-09): the report view's synthetic replay (test/fixtures/engine/p2c-report-marks.jsonl, M5)
  it('engine/p2c-report-marks', async () => {
    const rows = await snapshot('engine/p2c-report-marks', journalToEvents(loadEngineJournal('p2c-report-marks')));
    expect(rows.filter((row) => row.kind === 'user').length).toBe(3);
  });
  // P2-C end

  it('synthetic/500', async () => {
    const rows = await snapshot('synthetic/500', synthesise({ turns: 500, seed: 1 }));
    expect(rows.length).toBeGreaterThan(1000);
  });
});

// E11 W-E: a fixture lands with its committed snapshot. Vitest writes a missing file snapshot by itself outside CI, so a
// missing baseline fails here instead, unless the run updates snapshots (`-u`), the one way to write it.
describe('a missing baseline', () => {
  const missing = join(SNAPSHOT_DIR, 'pass1', 'no-such-fixture.rows.json');
  const committed = join(SNAPSHOT_DIR, 'synthetic', '500.rows.json');
  it('fails a run that does not update snapshots, CI or not', () => {
    for (const update of ['new', 'none'] as const) expect(missingBaseline(missing, update)).toBe('pass1/no-such-fixture.rows.json: no committed snapshot; write it with `-u` and commit it');
  });
  it('is written only by an update (-u), and a committed baseline is compared as before', () => {
    expect(missingBaseline(missing, 'all')).toBeNull();
    for (const update of ['new', 'none', 'all'] as const) expect(missingBaseline(committed, update)).toBeNull();
  });
});
