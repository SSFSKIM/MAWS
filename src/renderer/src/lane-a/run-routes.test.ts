// The routes agree on what M1 makes a file say as the wire does (UX wave U2, first landing; the U2a execution document,
// M1, Interfaces §F and Acceptance 1 and 6; the wave's law 5): a thought's recorded duration, and a refused call's kind
// and reading. One recorded session is drawn from its journal as a session MAWS runs draws it (the journal through the
// engine host's `Normalizer`), from its transcript file as the chain follower answers `session.events` for it on this
// Mac, and from the same rows as another machine sends them (`freshSource`). It lives beside U3a's
// `arrival-routes.test.ts` and not in the transcript's model, for the reason that test gives: the node project
// typechecks the model's directory, and the graph of the reader of another machine's rows is the renderer's. The three
// readers are written again here because that test exports none.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { ChainFollower } from '../../../engine-host/fs/chain-follower';
import { FIXTURE_DIR, loadJournal, loadUxwaveJournal, TRANSCRIPT_FIXTURE_DIR } from '../../../../test/support/fixtures';
import { MemoryFileReader } from '../../../../test/support/memory-reader';
import { journalToEvents } from '../transcript/dev/journal';
import { rowsOf, withAllExpanded } from '../transcript/model/derive';
import { applyEvents, createState } from '../transcript/model/reduce';
import type { Cell, Row } from '../transcript/model/rows';
import { freshSource, subagentLookupOf } from './plane-transcript';

const SESSION = '0f0e0d0c-0000-4000-8000-00000000c0de';

const rowsIn = (text: string): JsonObject[] => text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as JsonObject);

/** The file route: the chain follower over the file's bytes, as `session.events` answers for a session nobody holds. */
async function fromFile(text: string): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  const follower = new ChainFollower(new MemoryFileReader(text), SESSION as SessionId, null, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0 });
  await follower.start();
  follower.stop();
  return events;
}

/** The link route: the same rows, each with its uuid, through the reader of another machine's rows. */
const fromRows = (text: string): Promise<SessionEvent[]> =>
  freshSource(rowsIn(text).filter((row) => typeof row.uuid === 'string'), SESSION, subagentLookupOf([])).snapshot();

/** The live route: the session's journal through the engine host's normaliser. */
const fromJournal = (rows: JournalRow[]): SessionEvent[] => journalToEvents(rows);

const drawn = (events: SessionEvent[]): Row[] => rowsOf(withAllExpanded(applyEvents(createState(null, null), events)));
const callsOf = (rows: Row[]): Cell[] => rows.flatMap((row) => (row.kind === 'cell' ? [row] : row.kind === 'group' ? row.cells.filter((cell) => cell.toolUseId !== null) : []));

/** What M1 makes a route say: each refused call (its label, status and reading) and each turn's line (its state and its counts). */
function refusals(rows: Row[]): string[] {
  return rows.flatMap((row): string[] => {
    if (row.kind === 'divider') return [`turn ${row.state} · ${row.denied} denied · ${row.autoDenied} auto-denied`];
    if (row.kind === 'ask') return [`ask ${row.state}`];
    return callsOf([row]).flatMap((cell) => (cell.classification.denial === null ? [] : [`${cell.status} ${cell.classification.denial.disposition}: ${cell.label}`]));
  });
}

/** Every thought's recorded duration, as a row outside a run or a cell inside one. */
const recordedDurations = (rows: Row[]): (number | null)[] => rows.flatMap((row) =>
  row.kind === 'thinking' ? [row.recordedMs] : row.kind === 'group' ? row.cells.flatMap((cell) => (cell.detail.kind === 'thinking' ? [cell.detail.recordedMs] : [])) : []);

describe('a call the person’s Stop interrupted is the same refused call by every route (M1’s route proof, before M2)', () => {
  const routes = async (journal: string, file: string) => {
    const text = readFileSync(join(TRANSCRIPT_FIXTURE_DIR, `${file}.jsonl`), 'utf8');
    const events = { live: fromJournal(loadJournal('pass3', journal)), file: await fromFile(text), link: await fromRows(text) };
    return Object.entries(events).map(([route, of]) => ({ route, events: of, rows: drawn(of) }));
  };
  const rejectedResults = (events: SessionEvent[]) => events.flatMap((e) => (e.kind === 'tool.result' && e.denial !== null ? [`${e.toolUseId} ${e.denial}`] : []));
  const refusedCalls = (rows: Row[]) => refusals(rows).filter((line) => !line.startsWith('turn '));
  const firstLine = (rows: Row[]) => refusals(rows).find((line) => line.startsWith('turn '));

  it('steer-next-interrupted: the shell call reads `Stopped: …` on all three, and the turn the Stop cut reads stopped with no denied count', async () => {
    for (const { route, events, rows } of await routes('steer-next-interrupted', 'w1-steer-next-interrupted')) {
      expect(rejectedResults(events), route).toEqual(['toolu_018A2pQ8opsSUGLt6bscFJ4R user-rejected']);
      expect(refusedCalls(rows), route).toEqual(['stopped stopped: Stopped: `sleep 6 && echo 1`']);
      expect(firstLine(rows), route).toBe('turn stopped · 0 denied · 0 auto-denied');
    }
  });

  it('p1-maws-ask-interrupt: the ask’s result carries user-rejected on all three, and the turn the Stop cut reads stopped with no denied count', async () => {
    const drawn = await routes('p1-maws-ask-interrupt', 'p1-maws-ask-interrupt');
    for (const { route, events, rows } of drawn) {
      expect(rejectedResults(events).map((line) => line.split(' ')[1]), route).toEqual(['user-rejected']);
      expect(refusedCalls(rows).filter((line) => !line.startsWith('ask ')), route).toEqual([]); // the ask is a row of its own kind, no cell
      expect(firstLine(rows), route).toBe('turn stopped · 0 denied · 0 auto-denied');
    }
    // Reported to the architect with M1 (a statement of the document the code does not bear out): the ask's row is not
    // the same by every route, before M1 as after it. Live, MAWS's own `maws_ask_cancelled` meta row (seq 97) makes it
    // `cancelled`; the file has no such row and the ask's error result makes it `error`. The ask's row is U1's (UC-3).
    expect(drawn.map(({ route, rows }) => `${route}: ${refusedCalls(rows).join(', ')}`)).toEqual(['live: ask cancelled', 'file: ask error', 'link: ask error']);
  });
});

describe('a thought’s recorded duration is the same by every route (Acceptance 6’s number)', () => {
  it('u3-cron-r1: the last turn’s thought carries 10,192 ms from the wire journal, from the transcript file and from the file’s rows', async () => {
    const text = readFileSync(join(FIXTURE_DIR, 'uxwave', 'u3-cron-r1.transcript.jsonl'), 'utf8');
    expect(recordedDurations(drawn(fromJournal(loadUxwaveJournal('u3-cron-r1'))))).toEqual([10_192]);
    expect(recordedDurations(drawn(await fromFile(text)))).toEqual([10_192]);
    expect(recordedDurations(drawn(await fromRows(text)))).toEqual([10_192]);
  });
});
