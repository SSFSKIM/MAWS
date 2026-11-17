// UX wave U4b (docs/doperpowers/plans/2026-11-15-ux-wave-U4b-composer-integrations.md, M3; the Decision Log's line on
// the probe's result, P3): a Send now on an after-the-turn row is a frame at `next` and then the engine's send-now
// request (M3, "The conditional step"). The probe (spikes/protocol-probe/findings-uxwave-u4b-send-now-early.txt) found
// that how the turn reads afterwards depends on the timing: while the shell call is not yet a task the turn is cut and
// the message is a turn of its own (one waiting before it joins it, one bubble); once the call is a task nothing is cut
// and the messages are read in the running turn, each its own replay. These replay the recordings through the engine
// host's normaliser, the transcript's model and the stack's model, one early and one late of each of `u4b-pair` and
// `u4b-two`: the end is marked for the message only early, and at both timings the stack's rows leave at their own
// `started`.
import { afterEach, describe, expect, it } from 'vitest';
import type { PendingSteer } from '@shared/engine/session-state-store';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { loadUxwaveJournal } from '../../../../../test/support/fixtures';
import type { SessionQueue } from '../../stores/queue';
import { useTranscriptStore } from '../../stores/transcript';
import { dividerCopy } from '../../transcript/model/copy';
import { rowsOf, withAllExpanded } from '../../transcript/model/derive';
import { turnId } from '../../transcript/model/keys';
import { applyEvents, createState, type TranscriptState } from '../../transcript/model/reduce';
import type { Row } from '../../transcript/model/rows';
import { journalToEvents } from '../../transcript/dev/journal';
import { stackRows } from './stack';
import { readOf } from './stack-acts';

type UserRow = Extract<Row, { kind: 'user' }>;
type Ended = Extract<SessionEvent, { kind: 'turn.ended' }>;

const APP = 'app-u4b' as AppSessionId;
const PINEAPPLE = 'Reply with the single word PINEAPPLE, then carry on with what you were doing.';
const MANGO = 'Reply with the single word MANGO, then carry on with what you were doing.';

const through = (rows: JournalRow[], seq: number) => rows.filter((row) => row.seq <= seq);
const stateAt = (name: string, seq = Number.POSITIVE_INFINITY): TranscriptState => applyEvents(createState(null, null), journalToEvents(through(loadUxwaveJournal(name), seq)));
const drawn = (state: TranscriptState): Row[] => rowsOf(withAllExpanded(state));
const users = (rows: Row[]) => rows.filter((row): row is UserRow => row.kind === 'user');
const dividers = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'divider' ? [dividerCopy({ ...row, durationMs: row.summary.durationMs ?? Date.parse(row.endedAt ?? row.startedAt) - Date.parse(row.startedAt) })] : []));
const uuidAt = (name: string, seq: number) => (loadUxwaveJournal(name).find((row) => row.seq === seq)!.frame as { uuid: MessageUuid }).uuid;
/** The main lane's end at the `result` row's seq, as the normaliser emits it. */
const endAt = (name: string, seq: number): Ended => {
  const end = journalToEvents(loadUxwaveJournal(name)).find((event): event is Ended => event.kind === 'turn.ended' && event.seq === seq && event.parentToolUseId === null);
  expect(end, `${name}: no turn.ended at seq ${seq}`).toBeDefined();
  return end!;
};

/** The stack's rows for the session at `seq`, with the queue's snapshot still listing `steers` (it and the transcript
 *  arrive on different channels), read through the store as the window reads it. */
function stackAt(name: string, seq: number, steers: readonly { uuid: MessageUuid; text: string }[]): string[] {
  const state = stateAt(name, seq);
  useTranscriptStore.setState({ entries: { [APP]: { state, rows: rowsOf(state) } as never } });
  const listed: PendingSteer[] = steers.map(({ uuid, text }) => ({ messageUuid: uuid, content: text, createdAt: '2026-11-15T10:00:00.000Z' }));
  const queue: SessionQueue = { entries: [], paused: false, pauseReason: null, steers: listed, withdrawn: [], loaded: true };
  return stackRows(queue, new Set(), readOf(APP)).map((row) => `${row.kind}:${row.key}`);
}

afterEach(() => useTranscriptStore.setState({ entries: {} }));

describe('a Send now early in a shell call: the turn is cut and the message is a turn of its own', () => {
  it('u4b-pair-1: the end at 46 is marked for the message; the message (36) is its own turn, after the cut turn; its row leaves at its `started` (48)', () => {
    const [prompt, m] = [uuidAt('u4b-pair-1', 12), uuidAt('u4b-pair-1', 36)];
    expect(endAt('u4b-pair-1', 46)).toMatchObject({ terminalReason: 'aborted_tools', endedForMessage: true });
    const rows = drawn(stateAt('u4b-pair-1', 60));
    expect(dividers(rows)[0]).toMatch(/^Ended for your message after /);
    expect(users(rows).map((row) => [row.messageUuid, row.turnId, row.text])).toEqual([
      [prompt, turnId.ofMessage(prompt), expect.any(String)],
      [m, turnId.ofMessage(m), PINEAPPLE],
    ]);
    for (const steers of [[{ uuid: m, text: PINEAPPLE }], []]) {
      const kind = steers.length > 0 ? 'next' : 'handed';
      expect(stackAt('u4b-pair-1', 36, steers)).toEqual([`${kind}:${m}`]);
      expect(stackAt('u4b-pair-1', 47, steers)).toEqual([`${kind}:${m}`]);
      expect(stackAt('u4b-pair-1', 48, steers)).toEqual([]);
    }
  });

  it('u4b-two-1: the end at 50 is marked; the waiting message (37) and the named one (40) are one bubble under the named one’s uuid, its turn after the cut; each row leaves at its own `started` (53, 54)', () => {
    const [prompt, p, m] = [uuidAt('u4b-two-1', 12), uuidAt('u4b-two-1', 37), uuidAt('u4b-two-1', 40)];
    expect(endAt('u4b-two-1', 50)).toMatchObject({ terminalReason: 'aborted_tools', endedForMessage: true });
    const rows = drawn(stateAt('u4b-two-1', 60));
    expect(dividers(rows)[0]).toMatch(/^Ended for your message after /);
    expect(users(rows).map((row) => [row.messageUuid, row.turnId, row.text])).toEqual([
      [prompt, turnId.ofMessage(prompt), expect.any(String)],
      [m, turnId.ofMessage(p), `${MANGO}\n${PINEAPPLE}`],
    ]);
    const both = [{ uuid: p, text: MANGO }, { uuid: m, text: PINEAPPLE }];
    expect(stackAt('u4b-two-1', 52, both)).toEqual([`next:${p}`, `next:${m}`]);
    expect(stackAt('u4b-two-1', 53, both)).toEqual([`next:${m}`]);
    expect(stackAt('u4b-two-1', 54, both)).toEqual([]);
    expect(stackAt('u4b-two-1', 52, [])).toEqual([`handed:${p}`, `handed:${m}`]);
    expect(stackAt('u4b-two-1', 53, [])).toEqual([`handed:${m}`]);
    expect(stackAt('u4b-two-1', 54, [])).toEqual([]);
  });
});

describe('a Send now once the shell call is a task: nothing is cut and the messages are read in the running turn', () => {
  it('u4b-pair-late-1: no end is marked (141 completes the turn); the message (38) is a row of the running turn; its row leaves at its `started` (48)', () => {
    const [prompt, m] = [uuidAt('u4b-pair-late-1', 12), uuidAt('u4b-pair-late-1', 38)];
    const end = endAt('u4b-pair-late-1', 141);
    expect(end.terminalReason).toBe('completed');
    expect(end).not.toHaveProperty('endedForMessage');
    const rows = drawn(stateAt('u4b-pair-late-1', 141));
    expect(dividers(rows).some((line) => line.startsWith('Ended for your message'))).toBe(false);
    expect(users(rows).map((row) => [row.messageUuid, row.turnId, row.text])).toEqual([
      [prompt, turnId.ofMessage(prompt), expect.any(String)],
      [m, turnId.ofMessage(prompt), PINEAPPLE],
    ]);
    for (const steers of [[{ uuid: m, text: PINEAPPLE }], []]) {
      const kind = steers.length > 0 ? 'next' : 'handed';
      expect(stackAt('u4b-pair-late-1', 47, steers)).toEqual([`${kind}:${m}`]);
      expect(stackAt('u4b-pair-late-1', 48, steers)).toEqual([]);
    }
  });

  it('u4b-two-late-1: no end is marked (170 completes the turn); the waiting message (38) and the named one (41) are two rows of the running turn in that order, nothing joined; each row leaves at its own `started` (52, 53)', () => {
    const [prompt, p, m] = [uuidAt('u4b-two-late-1', 12), uuidAt('u4b-two-late-1', 38), uuidAt('u4b-two-late-1', 41)];
    const end = endAt('u4b-two-late-1', 170);
    expect(end.terminalReason).toBe('completed');
    expect(end).not.toHaveProperty('endedForMessage');
    const rows = drawn(stateAt('u4b-two-late-1', 170));
    expect(dividers(rows).some((line) => line.startsWith('Ended for your message'))).toBe(false);
    expect(users(rows).map((row) => [row.messageUuid, row.turnId, row.text])).toEqual([
      [prompt, turnId.ofMessage(prompt), expect.any(String)],
      [p, turnId.ofMessage(prompt), MANGO],
      [m, turnId.ofMessage(prompt), PINEAPPLE],
    ]);
    const both = [{ uuid: p, text: MANGO }, { uuid: m, text: PINEAPPLE }];
    expect(stackAt('u4b-two-late-1', 51, both)).toEqual([`next:${p}`, `next:${m}`]);
    expect(stackAt('u4b-two-late-1', 52, both)).toEqual([`next:${m}`]);
    expect(stackAt('u4b-two-late-1', 53, both)).toEqual([]);
    expect(stackAt('u4b-two-late-1', 51, [])).toEqual([`handed:${p}`, `handed:${m}`]);
    expect(stackAt('u4b-two-late-1', 52, [])).toEqual([`handed:${m}`]);
    expect(stackAt('u4b-two-late-1', 53, [])).toEqual([]);
  });
});
