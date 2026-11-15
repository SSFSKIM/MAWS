// "Fork from here" over the probes' recordings (UX wave U3b, M3; docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-
// rows-find.md, Acceptance 7 and 8, Engine facts 13 to 20; ruled R17): what the action row passes on the routes a
// session reaches the window by, what a fork the engine cut at a typed command's row draws, and what the rewind boundary
// of a fork from a delivered prompt shows. The recordings are probe 5's and probe 6's
// (spikes/protocol-probe/findings-uxwave-u3b-fork-delivered.txt, findings-uxwave-u3b-fork-command.txt).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import { ChainFollower } from '../../../engine-host/fs/chain-follower';
import { FIXTURE_DIR, loadUxwaveJournal } from '../../../../test/support/fixtures';
import { MemoryFileReader } from '../../../../test/support/memory-reader';
import { freshSource, subagentLookupOf } from '../lane-a/plane-transcript';
import { journalToEvents } from './dev/journal';
import { answerActionsOf } from './model/answer-actions';
import { restingRows, rowsOf } from './model/derive';
import { applyEvents, createState } from './model/reduce';
import type { Row } from './model/rows';

const SESSION = '0f0e0d0c-0000-4000-8000-00000000f0c5';
const recorded = (name: string): string => readFileSync(join(FIXTURE_DIR, 'uxwave', `${name}.transcript.jsonl`), 'utf8');

/** The file route: the chain follower over the file's bytes, as `session.events` answers for a session nobody holds. */
async function fromFile(text: string): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  const follower = new ChainFollower(new MemoryFileReader(text), SESSION as SessionId, null, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0 });
  await follower.start();
  follower.stop();
  return events;
}
/** Another machine's rows: the same file's rows, each with its uuid, through the reader of another machine's rows. */
const fromRows = (text: string): Promise<SessionEvent[]> =>
  freshSource(text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as JsonObject).filter((row) => typeof row.uuid === 'string'), SESSION, subagentLookupOf([])).snapshot();
/** The live route: the session's journal through the engine host's normaliser. */
const fromJournal = (name: string): SessionEvent[] => journalToEvents(loadUxwaveJournal(name));

const drawn = (events: SessionEvent[]): Row[] => rowsOf(applyEvents(createState(null, null), events));
/** Another machine's terminal session is drawn at rest while its controls say no turn runs (RemoteTranscriptSlot's `atRest`): its rows carry no turn's end. */
const drawnAtRest = (events: SessionEvent[]): Row[] => {
  const state = applyEvents(createState(null, null), events);
  return restingRows(state, rowsOf(state));
};
/** Each entry as `[the answer's words, rewindTo, fork]`. */
function entries(rows: Row[]) {
  const words = new Map(rows.flatMap((row) => (row.kind === 'assistant_text' ? [[row.id, row.markdown] as const] : [])));
  return [...answerActionsOf(rows)].map(([id, entry]) => [words.get(id), entry.rewindTo, entry.fork]);
}
async function threeRoutes(name: string): Promise<Record<'live' | 'file' | 'rows', Row[]>> {
  const text = recorded(name);
  return { live: drawn(fromJournal(name)), file: drawn(await fromFile(text)), rows: drawnAtRest(await fromRows(text)) };
}

// probe 6's source "commands": ONE typed; "/rename uxw renamed"; "/cost" (run as /usage); TWO typed
const RENAME_COMMAND = '52d4b168-ee4e-4cdb-80fd-f563f28a2922'; // the id /rename was sent with: its replay's and its file row's
const OUTPUTS = ['fb8d7dc8-8a38-457e-8859-7cfa4fa15ad2', 'aa8f8067-6445-48cc-9298-4e46b8d0b8f2']; // the two outputs' ids, which the engine refuses
// probe 6's source "compact": ONE typed; "/compact"; TWO typed
const COMPACT_COMMAND = 'f36c78b5-b2fc-4db5-9f42-67a5bfc33301';

describe('the action row over the recorded sessions, on every route', () => {
  it('a typed command after the answer: Fork passes the command’s own id, never an output’s (Engine facts, 16 and 17)', async () => {
    for (const [route, rows] of Object.entries(await threeRoutes('u3b-forkcmd-source-commands'))) {
      expect(entries(rows), route).toEqual([['ONE', RENAME_COMMAND, true], ['TWO', null, true]]);
      for (const entry of answerActionsOf(rows).values()) expect(OUTPUTS, route).not.toContain(entry.rewindTo);
    }
  });

  it('a typed /compact after the answer: the answer directly above the boundary forks against the /compact command’s row (Engine facts, 20)', async () => {
    for (const [route, rows] of Object.entries(await threeRoutes('u3b-forkcmd-source-compact'))) {
      expect(rows.some((row) => row.kind === 'boundary' && row.boundaryKind === 'compaction'), route).toBe(true);
      expect(entries(rows), route).toEqual([['ONE', COMPACT_COMMAND, true], ['TWO', null, true]]);
    }
  });

  it('a prompt sminos delivered opens a turn as a typed one does (Engine facts, 13)', async () => {
    const delivered = drawn(await fromFile(recorded('u3b-bridge-command-r1'))).find((row) => row.kind === 'user' && row.messageUuid === 'e0820294-4521-4ef0-b4e3-831d4df61ccc');
    expect(delivered).toMatchObject({ kind: 'user', steer: false, dropped: false });
    const before: Row = { id: 'text:before' as Row['id'], turnId: 'turn:before' as Row['turnId'], at: delivered!.at, kind: 'assistant_text', messageUuid: null, blockIndex: 0, markdown: 'READY', live: false, phase: 'answer', model: null };
    expect(entries([before, delivered!])).toEqual([['READY', 'e0820294-4521-4ef0-b4e3-831d4df61ccc', true]]);
  });
});

// Ruled R17: a fork the engine cut at a typed command's row keeps one caveat row of its own above the cut (a meta row,
// file only); the fork's drawn list ends with the answer and draws nothing for it.
describe('a fork cut at a typed command’s row (u3b-forkcmd-rename-command)', () => {
  it('ends with the answer before the probe’s own next prompt, and draws no row for the engine’s caveat', async () => {
    const text = recorded('u3b-forkcmd-rename-command');
    for (const [route, rows] of Object.entries({ file: drawn(await fromFile(text)), rows: drawnAtRest(await fromRows(text)) })) {
      const forked = rows.findIndex((row) => row.kind === 'user' && row.text.includes('FORKED'));
      expect(forked, route).toBeGreaterThan(0);
      expect(rows.slice(0, forked).findLast((row) => row.kind !== 'time' && row.kind !== 'divider'), route).toMatchObject({ kind: 'assistant_text', markdown: 'ONE' });
      for (const row of rows) expect(JSON.stringify(row), route).not.toMatch(/local-command-caveat|The command below was run directly/);
    }
  });
});

// Probes, 5: the rewind's text of a prompt sminos delivered opens with sminos's frame line; the boundary row of the fork,
// the one place that text reaches the fork's window, shows the person's words alone.
describe('the rewind boundary of a fork from a delivered prompt (u3b-fork-delivered, seq 25)', () => {
  it('holds the prompt’s words without sminos’s frame line, through the normaliser and the row', () => {
    const boundary = drawn(fromJournal('u3b-fork-delivered')).find((row) => row.kind === 'boundary' && row.boundaryKind === 'rewind');
    expect(boundary).toMatchObject({ kind: 'boundary', boundaryKind: 'rewind', detail: 'UXW delivered: reply with only the word DELIVERED.' });
  });
});
