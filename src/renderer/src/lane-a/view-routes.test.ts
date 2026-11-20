// The to-human view agrees by every route (UX wave U2b; the execution document, Acceptance A13 and §H's row 2; the
// wave's law 5): one recorded session, drawn from its wire as a session MAWS runs draws it (the journal through the
// engine host's `Normalizer`), from its transcript file as the chain follower answers `session.events` for it on this Mac
// (a session at rest, or one an earlier build's session wrote), and from the same rows as another machine sends them
// (`freshSource`), gives the same mirrored rows, closed and opened, compared at rest as every window draws a session at
// rest. The session is P4-R7's recorded `p4-r7-tool-stages` (engine 2.1.304): four commands with a message-tool call
// (`mcp__maws__message`, the former tool's name, as recorded sessions carry it) between each two, then a closing span.
// It lives beside `run-routes.test.ts` and not in the transcript's model, for the reason that test gives; the readers are
// written again here because neither that test nor the model's `to-human.test.ts` exports one.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import { ChainFollower } from '../../../engine-host/fs/chain-follower';
import { FIXTURE_DIR } from '../../../../test/support/fixtures';
import { MemoryFileReader } from '../../../../test/support/memory-reader';
import { storedRunsOf, type StoredRun } from '@shared/owner/folds';
import { labelsOf } from '../owner/view/label'; // UX wave U2b, M7
import { liveMarkedRowIds, mirrorRows, stretchesOf } from '../owner/view/mirror';
import { createTranscriptStore } from '../stores/transcript';
import { journalToEvents } from '../transcript/dev/journal';
import { restingRows } from '../transcript/model/derive';
import type { Row } from '../transcript/model/rows';
import { freshSource, subagentLookupOf } from './plane-transcript';

const SESSION = 'p4-r7-session';
const rows = readFileSync(join(FIXTURE_DIR, 'p4', 'p4-r7-tool-stages.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => parseJournalRow(JSON.parse(line))) as JournalRow[];

// The journal's meta row `{event: "disk"}` holds the session's transcript as the engine wrote it, reduced to its user and
// assistant records in file order (a thinking block's words under `text`); a record whose parent the reduction left out
// is chained to the one before it (as `to-human.test.ts` reads it).
type DiskRecord = { type: 'user' | 'assistant'; uuid: string; parentUuid: string | null; messageId: string | null; blocks: Record<string, unknown>[] };
function transcriptOf(journal: JournalRow[]): string {
  const disk = journal.find((row) => row.direction === 'meta' && (row.frame as { event?: unknown }).event === 'disk')!;
  const records = (disk.frame as { records: DiskRecord[] }).records;
  const kept = new Set(records.map((record) => record.uuid));
  return records
    .map((record, i) => {
      const content = record.blocks.map((block) => (block.type === 'thinking' ? { type: 'thinking', thinking: block.text, signature: '' } : block));
      const parentUuid = record.parentUuid === null || kept.has(record.parentUuid) ? record.parentUuid : records[i - 1].uuid;
      const message = record.type === 'assistant' ? { id: record.messageId, role: 'assistant', model: 'claude-opus-5-5', content } : { role: 'user', content };
      return `${JSON.stringify({ type: record.type, uuid: record.uuid, parentUuid, sessionId: SESSION, message })}\n`;
    })
    .join('');
}

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
  freshSource(text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as JsonObject), SESSION, subagentLookupOf([])).snapshot();

/** A route's events in a store whose lane is on, as the session view holds them: the flag set by the store's own rule. */
async function viewOf(events: SessionEvent[], stored?: readonly StoredRun[]) {
  const store = createTranscriptStore();
  await store.getState().attach('k', { subscribe: () => () => {}, snapshot: () => Promise.resolve(events) });
  store.getState().setToHumanView('k', { lane: true, tailMessage: false });
  const entry = () => store.getState().entries.k;
  const at = (open: 'none' | 'all') => {
    const { state, rows: held } = entry();
    const resting = restingRows(state, held);
    const openStretches = open === 'all' ? new Set(stretchesOf(resting).map((stretch) => stretch.key)) : new Set<string>();
    // UX wave U2b, M7: the record lines' labels, where the mount hands the stored runs in (§M)
    const labels = stored === undefined ? undefined : labelsOf(resting, { stored, running: false, turns: state.turns });
    return mirrorRows(resting, { openStretches }, liveMarkedRowIds(state), labels);
  };
  const resting = restingRows(entry().state, entry().rows);
  return { inForce: entry().state.ui.noTurnFold === true, closed: at('none'), opened: at('all'), keys: stretchesOf(resting).map((stretch) => stretch.key), stretches: stretchesOf(resting) };
}

/**
 * What a person reads of the view: each row by its kind and words, ids aside (the routes key rows differently). An
 * error line is left out: the wire alone carries the process's own lines (its exit), and every error stays in sight on
 * every route, so none is the fold's.
 */
const reading = (drawn: Row[]) =>
  drawn.flatMap((row): string[] => {
    switch (row.kind) {
      case 'record_fold': return [row.open ? '‹ fold to report' : `› ${row.label ?? 'working record'}`];
      case 'to_human': return [`message: ${row.text}`];
      case 'assistant_text': return [`text: ${row.markdown}`];
      case 'user': return [`prompt: ${row.text}`];
      case 'divider': return [`turn ${row.state}`];
      case 'cell': return [`call ${row.toolName}`];
      case 'group': return [`run ${row.cells.map((cell) => cell.toolName).join(' ')}`];
      case 'time': case 'error': return [];
      default: return [row.kind];
    }
  });

describe('the to-human view is the same by every route', () => {
  it('p4-r7-tool-stages: the messages in sight with one record line between each two, the same from the wire, the file and its rows, closed and opened', async () => {
    const text = transcriptOf(rows);
    const routes = { live: await viewOf(journalToEvents(rows)), file: await viewOf(await fromFile(text)), link: await viewOf(await fromRows(text)) };
    const live = routes.live;
    expect(live.inForce).toBe(true);
    const closed = reading(live.closed);
    expect(closed.filter((line) => line.startsWith('message: '))).toHaveLength(3);
    expect(closed.filter((line) => line === '› working record')).toHaveLength(4); // a command before each message, and the last before the span
    expect(closed.some((line) => line.startsWith('call ') || line.startsWith('run '))).toBe(false);
    expect(reading(live.opened).filter((line) => line.startsWith('call ') || line.startsWith('run '))).toHaveLength(4);
    expect(reading(live.opened).filter((line) => line === '‹ fold to report')).toHaveLength(4);
    for (const [route, view] of Object.entries(routes)) {
      expect(view.inForce, route).toBe(true);
      expect(reading(view.closed), route).toEqual(closed);
      expect(reading(view.opened), route).toEqual(reading(live.opened));
      expect(view.keys, route).toEqual(live.keys); // keyed by the calls' own ids, which every route carries
    }
  });

  // UX wave U2b, M7 (the execution document, §M; decisions 27 and 28): the same session with an invented folds file of
  // the contract's shape for it, in the mod's own form, its bounds the calls' own ids as the mod's tracker names them.
  // Every route that reads this machine's file draws the same record lines; another machine's rows, whose file this
  // landing does not read, are handed no stored run and read the live line alone, which at rest is none.
  it('p4-r7-tool-stages with a folds file of shape 2: the same record lines from the wire and the file; from another machine’s rows, working record', async () => {
    const text = transcriptOf(rows);
    const plain = await viewOf(journalToEvents(rows));
    const calls = plain.stretches.map((stretch) => stretch.rows.flatMap((row) => (row.kind === 'cell' ? [row.toolUseId!] : row.kind === 'group' ? row.cells.flatMap((cell) => (cell.toolUseId === null ? [] : [cell.toolUseId])) : [])));
    expect(calls.every((ids) => ids.length > 0)).toBe(true);
    const file = `${JSON.stringify({ shape: 2, runs: calls.map((ids, i) => [ids[0], ids.at(-1), `Ran stage ${i + 1} and checked its output`]) })}\n`;
    const stored = storedRunsOf(file)!;
    const live = reading((await viewOf(journalToEvents(rows), stored)).closed);
    const onFile = reading((await viewOf(await fromFile(text), stored)).closed);
    const fromLink = reading((await viewOf(await fromRows(text), [])).closed);
    expect(live.filter((line) => line.startsWith('› '))).toEqual(calls.map((_, i) => `› Ran stage ${i + 1} and checked its output`));
    expect(onFile).toEqual(live);
    expect(fromLink.filter((line) => line.startsWith('› '))).toEqual(calls.map(() => '› working record'));
    expect(fromLink.filter((line) => !line.startsWith('› '))).toEqual(live.filter((line) => !line.startsWith('› ')));
  });
});
