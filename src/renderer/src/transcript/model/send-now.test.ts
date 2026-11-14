// UX wave U4a (docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md, M1; Interfaces B and C; decisions 7, 32 and
// 33): what the transcript draws of a message sent now, over the probes' recorded sessions mapped by the engine host's
// own normaliser (spikes/protocol-probe/fixtures/uxwave/). The turn a sent-now message ended reads "Ended for your
// message after …"; a call the engine moved reads "Moved … to the background after …" and runs until its task's end is
// heard, across its turn's close, and only while its process lives; the messages the engine joins are one bubble, at the
// place of the first and under the last one's uuid.
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { MessageUuid } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { loadUxwaveJournal } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../dev/journal';
import { dividerCopy } from './copy';
import { rowsOf, withAllExpanded } from './derive';
import { turnId } from './keys';
import { applyEvents, createState, type TranscriptState } from './reduce';
import type { Cell, Row } from './rows';
import { BASH_RESULT, builder, task, tool } from './test-events';

type RowOf<K extends Row['kind']> = Extract<Row, { kind: K }>;

const journal = (name: string) => loadUxwaveJournal(name);
const through = (rows: JournalRow[], seq: number) => rows.filter((row) => row.seq <= seq);
const reduce = (events: SessionEvent[]): TranscriptState => applyEvents(createState(null, null), events);
const drawn = (state: TranscriptState): Row[] => rowsOf(withAllExpanded(state));
const rowsAt = (name: string, seq = Number.POSITIVE_INFINITY) => drawn(reduce(journalToEvents(through(journal(name), seq))));
const dividers = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'divider' ? [dividerCopy({ ...row, durationMs: row.summary.durationMs ?? Date.parse(row.endedAt ?? row.startedAt) - Date.parse(row.startedAt) })] : []));
const cells = (rows: Row[]): Cell[] => rows.flatMap((row) => (row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []));
const cellOf = (rows: Row[], toolUseId: string) => cells(rows).find((cell) => cell.toolUseId === toolUseId);
const users = (rows: Row[]) => rows.filter((row): row is RowOf<'user'> => row.kind === 'user');
const uuidAt = (name: string, seq: number) => (journal(name).find((row) => row.seq === seq)!.frame as { uuid: MessageUuid }).uuid;
const exitRow = (seq: number): JournalRow => ({ seq, direction: 'meta', at: '2026-11-13T00:50:00.000Z', frame: { event: 'exit', code: 0, signal: null, reason: 'quit' } });

const A_BASH = 'toolu_01UK719ATPuRjLtWeTEn9rZ1'; // u4p1-a-seeded-1: `node wait.cjs a1 40`, moved at 45
const MCP_CALL = 'toolu_01UFS9wFBAFW85EKmXuDepTL'; // u4p2-k-mcp-1: `slow_wait`, moved as a task at 54 and 55

describe('the turn a sent-now message ended (Interfaces B, the turn’s line)', () => {
  it('u4p1-a-seeded-1: the cut turn reads “Ended for your message after …”, and its own prompt is no “Not sent” though the engine cancelled it after it started (47)', () => {
    const rows = rowsAt('u4p1-a-seeded-1', 50);
    expect(dividers(rows)[0]).toMatch(/^Ended for your message after [\dhms ]+ · 1 tool call$/);
    expect(dividers(rows).some((line) => line.startsWith('You stopped'))).toBe(false);
    const prompt = users(rows).find((row) => row.messageUuid === uuidAt('u4p1-a-seeded-1', 12));
    expect(prompt).toMatchObject({ dropped: false });
  });

  it('u4p1-c-seeded-1: the interrupt marker closes the turn before its result; the result gives it the cause, and nothing reads “You stopped”', () => {
    const rows = rowsAt('u4p1-c-seeded-1', 140);
    expect(dividers(rows)[0]).toMatch(/^Ended for your message after [\dhms ]+$/);
    expect(dividers(rows).some((line) => line.startsWith('You stopped'))).toBe(false);
  });

  it('u4p1-c0-seeded-1, a Stop: “You stopped after …”, as today', () => {
    expect(dividers(rowsAt('u4p1-c0-seeded-1', 145))[0]).toMatch(/^You stopped after [\dhms ]+$/);
  });

  it('u4p2-stop-inflight-1: a plain interrupt before the move reads “You stopped after …”, then the message’s own turn; u4p2-stop-moved-hold-1: the Stop square after the move, “You stopped”', () => {
    expect(dividers(rowsAt('u4p2-stop-inflight-1', 60))[0]).toMatch(/^You stopped after /);
    expect(dividers(rowsAt('u4p2-stop-moved-hold-1', 60))[0]).toMatch(/^You stopped after /);
    expect(dividers(rowsAt('u4p2-stop-moved-1', 60))[0]).toMatch(/^Ended for your message after /);
  });
});

describe('a call the engine moved (decision 33; Interfaces C)', () => {
  it('u4p1-a-seeded-1: the shell command reads “Moved `…` to the background after …” and runs past its turn’s end until its task’s end (204)', () => {
    const atEnd = cellOf(rowsAt('u4p1-a-seeded-1', 50), A_BASH)!;
    expect(atEnd.label).toMatch(/^Moved `node wait\.cjs a1 40` to the background after [\dhms ]+$/);
    expect(atEnd.status).toBe('running');
    expect(cellOf(rowsAt('u4p1-a-seeded-1', 203), A_BASH)!.status).toBe('running');
    const done = cellOf(rowsAt('u4p1-a-seeded-1', 204), A_BASH)!;
    expect(done.status).toBe('done');
    expect(done.label).toBe(atEnd.label);
  });

  it('the cell carries the model’s fact, not only its words: `moved` on the moved call (u4p1-a-seeded-1) and on no call that was not moved (u4p2-n-never-1)', () => {
    const all = cells(rowsAt('u4p1-a-seeded-1', 50));
    expect(all.filter((cell) => cell.moved === true).map((cell) => cell.toolUseId)).toEqual([A_BASH]);
    expect(cells(rowsAt('u4p2-n-never-1', 50)).some((cell) => 'moved' in cell)).toBe(false);
  });

  it('u4p2-k-mcp-1: an MCP call, moved with no flag, ties by its task; it reads moved from its result (55), runs after the turn’s end (132) and is finished at its task’s end (136)', () => {
    const moved = cellOf(rowsAt('u4p2-k-mcp-1', 55), MCP_CALL)!;
    expect(moved.label).toMatch(/^Moved `slow · slow_wait` to the background after [\dhms ]+$/);
    expect(moved.status).toBe('running');
    expect(cellOf(rowsAt('u4p2-k-mcp-1', 132), MCP_CALL)!.status).toBe('running');
    expect(cellOf(rowsAt('u4p2-k-mcp-1', 136), MCP_CALL)!.status).toBe('done');
  });

  it('u4p2-k-mcp-1 cut after its turn’s end and followed by the process’s exit: the moved call reads stopped under the same words, live and replayed from the start', () => {
    const rows = [...through(journal('u4p2-k-mcp-1'), 132), exitRow(133)];
    const events = journalToEvents(rows);
    let live = createState(null, null);
    for (const row of rows) live = applyEvents(live, events.filter((event) => event.seq === row.seq)); // one batch per row, as the stream delivers
    for (const state of [live, reduce(events)]) {
      const cell = cellOf(drawn(state), MCP_CALL)!;
      expect(cell.status).toBe('stopped');
      expect(cell.label).toMatch(/^Moved `slow · slow_wait` to the background after [\dhms ]+$/);
    }
  });

  it('a foreground shell command that was not moved reads as today (u4p2-n-never-1); a call a hook held is no moved call (u4p2-k-hook-1)', () => {
    const ran = cells(rowsAt('u4p2-n-never-1', 50)).find((cell) => cell.toolName === 'Bash')!;
    expect(ran.label).toMatch(/^Ran `node wait\.cjs nnever1 30` in [\dhms ]+$/);
    expect(ran.status).toBe('done');
    const held = cells(rowsAt('u4p2-k-hook-1', 47)).find((cell) => cell.toolName === 'Bash')!;
    expect(held.label.startsWith('Moved')).toBe(false);
  });
});

// The architect's ruling on M8's first concern (2026-11-13): the gap the ninth tracker row named is closed for this
// landing's case. Since U8b's X-168 the chain follower supplies `process.exited { reason: 'unknown', seq: null }` for a
// holder-less transcript whether or not its last turn ended (`supplyExit`, `exitAtLeaf` in
// src/engine-host/fs/chain-follower.ts); a live holder supplies none. Fixture-shaped events: the shell call's result
// carries the moved flag as `u4p1-a-seeded-1.jsonl` seq 45 does, beside a background agent whose end never came.
describe('a moved call and an agent in a transcript whose last turn ended (the ninth tracker row, closed)', () => {
  const endedTurn = () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('a1', 'Agent', { description: 'Survey', prompt: 'Read the sample notes' }, 'm1', 0);
    b.emit('subagent.started', { taskId: task('k1'), toolUseId: tool('a1'), description: 'Survey', subagentType: null, isBackground: true, spawnDepth: 1, prompt: null });
    b.result('a1', 'Async agent launched successfully.');
    b.toolUse('t1', 'Bash', { command: 'node wait.cjs w1 40' }, 'm2', 0);
    b.result('t1', 'Command was moved to the background', { structured: { ...BASH_RESULT(''), backgroundedToDeliverMessage: true } });
    b.end(['u1'], { result: 'success', terminalReason: 'aborted_tools', endedForMessage: true });
    return b;
  };
  const agentsRow = (rows: Row[]) => rows.find((row): row is RowOf<'subagent'> => row.kind === 'subagent')!;

  it('holder-less: the synthesised exit (reason unknown, no seq) after the ended turn reads both the moved shell call and the agent stopped', () => {
    const b = endedTurn();
    b.emit('process.exited', { code: null, signal: null, reason: 'unknown', lostAttentionCount: 0, budget: null }, { atMs: Date.parse(b.events.at(-1)!.at) });
    const rows = drawn(reduce(b.events.map((event) => (event.kind === 'process.exited' ? { ...event, seq: null } : event))));
    const cell = cellOf(rows, tool('t1'))!;
    expect(cell.label).toMatch(/^Moved `node wait\.cjs w1 40` to the background after [\dhms ]+$/);
    expect(cell.status).toBe('stopped');
    expect(agentsRow(rows).status).toBe('stopped');
  });

  it('with a live holder, so no exit: the moved shell call and the agent read running', () => {
    const rows = drawn(reduce(endedTurn().events));
    expect(cellOf(rows, tool('t1'))!.status).toBe('running');
    expect(agentsRow(rows).status).toBe('started');
  });
});

describe('the messages the engine joins are one bubble (decision 32 c)', () => {
  const joinedAt = (name: string, seq: number, members: number[]) => {
    const [first, ...rest] = members.map((at) => uuidAt(name, at));
    const last = rest.at(-1)!;
    const state = reduce(journalToEvents(through(journal(name), seq)));
    const rows = drawn(state);
    const bubbles = users(rows).filter((row) => [first, ...rest].includes(row.messageUuid!));
    return { state, rows, bubbles, first: first!, last };
  };

  it('u4p2-two-1-1: before the replay (55) one bubble each; at 60 one bubble, under the second’s uuid with both texts, the opening row of the first’s turn, and none for the first', () => {
    const before = joinedAt('u4p2-two-1-1', 55, [37, 40]);
    expect(before.bubbles.map((row) => row.messageUuid)).toEqual([before.first, before.last]);
    const after = joinedAt('u4p2-two-1-1', 60, [37, 40]);
    expect(after.bubbles).toHaveLength(1);
    expect(after.bubbles[0]).toMatchObject({
      messageUuid: after.last, steer: false, turnId: turnId.ofMessage(after.first),
      text: 'Reply with the single word PINEAPPLE, then carry on with what you were doing.\nReply with the single word MANGO, then carry on with what you were doing.',
    });
    // the turn's opening row: it stands above the turn's divider, where the first stood
    const turnRows = after.rows.filter((row) => row.turnId === turnId.ofMessage(after.first));
    expect(turnRows[0]).toBe(after.bubbles[0]);
    expect(turnRows.findIndex((row) => row.kind === 'divider')).toBeGreaterThan(0);
  });

  it('a turn’s ordinary end: u4p3-end2-1 at 685 and u4p3-end3-1 at 517, one bubble each, under the last uuid', () => {
    const two = joinedAt('u4p3-end2-1', 685, [510, 513]);
    expect(two.bubbles.map((row) => [row.messageUuid, row.steer, row.turnId])).toEqual([[two.last, false, turnId.ofMessage(two.first)]]);
    const three = joinedAt('u4p3-end3-1', 517, [117, 120, 123]);
    expect(three.bubbles.map((row) => [row.messageUuid, row.steer, row.turnId])).toEqual([[three.last, false, turnId.ofMessage(three.first)]]);
    expect(three.bubbles[0]!.text.split('\n')).toHaveLength(3);
  });

  it('the joined turn reads on: the message’s turn ends by the result that names both, and the whole session derives the same replayed from the start', () => {
    const rows = journal('u4p2-two-1-1');
    const events = journalToEvents(rows);
    let live = createState(null, null);
    for (const row of rows) live = applyEvents(live, events.filter((event) => event.seq === row.seq));
    expect(drawn(live).filter((row) => row.kind === 'user').map((row) => (row as RowOf<'user'>).messageUuid)).toEqual(drawn(reduce(events)).filter((row) => row.kind === 'user').map((row) => (row as RowOf<'user'>).messageUuid));
    const turn = live.turns.get(turnId.ofMessage(uuidAt('u4p2-two-1-1', 37)))!;
    expect(turn.state).toBe('closed');
    expect(turn.ended?.seq).toBe(168);
  });
});
