// UX wave U2 (O-29, O-27, ticket 479; the U2a execution document, M4 and Interfaces §C): what a run hands on and what it
// draws. Where a thought goes (decision 19: a thought after a run's last call is that run's; the single call's unwrap
// keeps event order), the run's id (decision 4: its first call's), a textless thought's travel (ticket 479), the opened run's
// segments (`runSegments`: thoughts merged, then tested on the engine's recorded time, ten seconds and more), and what
// its one line reads (`runLine`, `heldByPermission`: decision 21), and a call the engine moved, in its run (the chain merge
// with U4a). Every word and every number is invented, but the composer landing's probe recording.
import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, AttentionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { loadUxwaveJournal } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../dev/journal';
import { dividerCopy } from './copy';
import { rowsOf, withAllExpanded } from './derive';
import { heldByPermission, runLine, runSegments, THOUGHT_LINE_MS } from './groups';
import { rowId } from './keys';
import { applyEvents, createState } from './reduce';
import type { Cell, Row } from './rows';
import { api, BASH_RESULT, builder, task, tool, uuid, type Builder } from './test-events';

const drawn = (events: SessionEvent[]): Row[] => rowsOf(withAllExpanded(applyEvents(createState(null, null), events)));
const work = (rows: Row[]) => rows.filter((row) => row.kind !== 'time' && row.kind !== 'user' && row.kind !== 'divider');
const runs = (rows: Row[]) => rows.filter((row): row is Extract<Row, { kind: 'group' }> => row.kind === 'group');
// A finished thought, with the engine's recorded duration when `ms` is given (X1's `thinkingDurationMs`)
const thought = (b: Builder, apiId: string, index: number, text: string, ms?: number) => b.emit('assistant.block.complete', {
  messageUuid: uuid(`${apiId}-u${index}`), apiMessageId: api(apiId), blockIndex: index, block: { type: 'thinking', thinking: text, signature: '' }, model: 'claude-test',
  supersedes: [], aborted: false, userMessageUuids: [], ...(ms !== undefined && { thinkingDurationMs: ms }),
});
const streams = (b: Builder, apiId: string, index: number, text: string) => b.emit('assistant.block.delta', {
  apiMessageId: api(apiId), blockIndex: index, blockType: 'thinking', textDelta: null, thinkingDelta: text, inputJsonDelta: null, userMessageUuid: null,
});
const command = (b: Builder, id: string, apiId = `msg-${id}`, index = 0) => {
  b.toolUse(id, 'Bash', { command: `make ${id}` }, apiId, index);
  b.result(id, 'ok', { structured: BASH_RESULT('ok') });
};
const shape = (rows: Row[]) => work(rows).map((row) => (row.kind === 'group' ? `run ${row.cells.map((cell) => cell.toolUseId ?? cell.id).join(',')}` : row.kind === 'cell' ? `call ${row.toolUseId}` : row.kind === 'thinking' ? `thought ${row.text}` : row.kind));
const segmentsOf = (cells: readonly Cell[], active: boolean) => runSegments(cells, active).map((segment) => (segment.kind === 'calls' ? `calls ${segment.cells.map((cell) => cell.toolUseId).join(',')}` : `thought ${segment.recordedMs} ${JSON.stringify(segment.text)}${segment.live ? ' live' : ''}`));

describe('where a thought goes, and the run’s id', () => {
  it('a thought after a run’s last call is that run’s last cell, before the answer; the run’s id is its first call’s, not the thought’s that leads it', () => {
    const b = builder();
    b.turn('u1');
    thought(b, 'm1', 0, 'Plan the build.', 3_000);
    command(b, 't1', 'm1', 1);
    command(b, 't2', 'm2', 0);
    thought(b, 'm3', 0, 'Both passed.', 12_000);
    b.text('m3', 1, 'Done.');
    b.end(['u1']);
    const rows = drawn(b.events);
    expect(shape(rows)).toEqual(['run cell:think:m1:0,t1,t2,cell:think:m3:0', 'assistant_text']);
    expect(runs(rows)[0].id).toBe(rowId.group('cell:t1' as never));
  });

  it('after work that is not a run, a thought is a row, as before', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('a1', 'Agent', { description: 'Survey', prompt: 'look' });
    b.emit('subagent.started', { taskId: task('k1'), toolUseId: tool('a1'), description: 'Survey', subagentType: null, isBackground: false, spawnDepth: 1, prompt: null });
    thought(b, 'm2', 0, 'Waiting on the survey.', 12_000);
    b.text('m2', 1, 'Started.');
    b.end(['u1']);
    expect(shape(drawn(b.events))).toEqual(['subagent', 'thought Waiting on the survey.', 'assistant_text']);
  });

  it('a single call with a thought after it: an active run of one while the turn runs, the call’s row and then the thought’s at its close', () => {
    const b = builder();
    b.turn('u1');
    command(b, 't1');
    thought(b, 'm2', 0, 'One more look.', 4_000);
    expect(shape(drawn(b.events))).toEqual(['run t1,cell:think:m2:0']);
    b.text('m2', 1, 'Done.');
    b.end(['u1']);
    expect(shape(drawn(b.events))).toEqual(['call t1', 'thought One more look.', 'assistant_text']);
  });

  it('a textless thought with a recorded duration travels into its run, and where it leaves the machine as a row it has none (W1)', () => {
    const inRun = builder();
    inRun.turn('u1');
    command(inRun, 't1');
    thought(inRun, 'm2', 0, '', 12_000);
    command(inRun, 't2', 'm2', 1);
    inRun.end(['u1']);
    expect(shape(drawn(inRun.events))).toEqual(['run t1,cell:think:m2:0,t2']);
    const single = builder();
    single.turn('u1');
    command(single, 't1');
    thought(single, 'm2', 0, '', 12_000);
    single.text('m2', 1, 'Done.');
    single.end(['u1']);
    expect(shape(drawn(single.events))).toEqual(['call t1', 'assistant_text']);
    const alone = builder();
    alone.turn('u1');
    thought(alone, 'm1', 0, '', 12_000);
    alone.text('m1', 1, 'Hello.');
    alone.end(['u1']);
    expect(shape(drawn(alone.events))).toEqual(['assistant_text']);
    const unrecorded = builder();
    unrecorded.turn('u1');
    command(unrecorded, 't1');
    thought(unrecorded, 'm2', 0, '');
    command(unrecorded, 't2', 'm2', 1);
    unrecorded.end(['u1']);
    expect(shape(drawn(unrecorded.events)), 'with no recorded duration it can never earn a line, so it does not travel').toEqual(['run t1,t2']);
  });
});

describe('runSegments: an opened run’s blocks and thought lines', () => {
  const runOf = (fill: (b: Builder) => void, open = false) => {
    const b = builder();
    b.turn('u1');
    fill(b);
    if (!open) b.end(['u1']);
    return runs(drawn(b.events))[0];
  };

  it('a run whose every thought is under ten seconds opens to one block', () => {
    const run = runOf((b) => { command(b, 't1'); thought(b, 'm2', 0, 'Short.', 4_000); command(b, 't2', 'm2', 1); thought(b, 'm3', 0, 'Shorter.', 9_999); command(b, 't3', 'm3', 1); });
    expect(segmentsOf(run.cells, false)).toEqual(['calls t1,t2,t3']);
  });

  it('a thought of ten seconds or more stands between the two blocks it fell between, or under the last when it followed the last call', () => {
    const run = runOf((b) => { command(b, 't1'); thought(b, 'm2', 0, 'Between.', THOUGHT_LINE_MS); command(b, 't2', 'm2', 1); thought(b, 'm3', 0, 'After.', 12_000); });
    expect(segmentsOf(run.cells, false)).toEqual(['calls t1', 'thought 10000 "Between."', 'calls t2', 'thought 12000 "After."']);
  });

  it('thoughts with no call between them are one line, merged before the test: two of 6 s are one of 12 s, their texts in order', () => {
    const run = runOf((b) => { command(b, 't1'); thought(b, 'm2', 0, 'First half.', 6_000); thought(b, 'm2', 1, '', 0); thought(b, 'm2', 2, 'Second half.', 6_000); command(b, 't2', 'm2', 3); });
    expect(segmentsOf(run.cells, false)).toEqual(['calls t1', 'thought 12000 "First half.\\n\\nSecond half."', 'calls t2']);
    const [, line] = runSegments(run.cells, false);
    expect(line).toMatchObject({ kind: 'thought', id: 'cell:think:m2:0', live: null });
  });

  it('a textless thought of 12 s is kept with no text; one with no recorded duration is never kept, whether or not it streamed', () => {
    const textless = runOf((b) => { command(b, 't1'); thought(b, 'm2', 0, '', 12_000); command(b, 't2', 'm2', 1); });
    expect(segmentsOf(textless.cells, false)).toEqual(['calls t1', 'thought 12000 ""', 'calls t2']);
    const measured = runOf((b) => { command(b, 't1'); streams(b, 'm2', 0, 'Long'); b.tick(12_000); thought(b, 'm2', 0, 'Long look.'); command(b, 't2', 'm2', 1); });
    expect(measured.cells.find((cell) => cell.toolName === 'thinking')?.detail).toMatchObject({ recordedMs: null, durationMs: 12_100 });
    expect(segmentsOf(measured.cells, false)).toEqual(['calls t1,t2']);
  });

  it('a thought streaming in an active run is live and kept as the last segment, its text the settled members’; left unfinished in a closed turn it is not live and has no line', () => {
    const live = runOf((b) => { command(b, 't1'); command(b, 't2'); thought(b, 'm3', 0, 'Settled.', 2_000); streams(b, 'm3', 1, 'Still going'); }, true);
    expect(live.state).toBe('active');
    expect(segmentsOf(live.cells, true)).toEqual(['calls t1,t2', 'thought 2000 "Settled." live']);
    expect(runSegments(live.cells, true).at(-1)).toMatchObject({ kind: 'thought', id: 'cell:think:m3:0', live: { block: 'm3:1', at: live.cells.at(-1)!.startedAt } });
    expect(segmentsOf(live.cells, false), 'the same cells in a run that is not active').toEqual(['calls t1,t2']);
  });
});

describe('runLine: what a run’s one line reads', () => {
  const SESSION = 'session-1' as AppSessionId;
  const item = (call: string, at: string, kind: AttentionItem['kind'] = 'permission', agent: string | null = null): AttentionItem => ({
    id: `att-${call}-${at}` as AttentionId, appSessionId: SESSION, sessionId: null, kind, request: { requestId: `req-${call}` as RequestId, toolUseId: call as ToolUseId, taskId: null, agentId: agent as never },
    summary: 'invented', createdAt: at, state: 'pending', stateChangedAt: at, expiresAt: null,
  });
  const waitingOf = (...items: AttentionItem[]) => new Map(items.map((entry) => [entry.request.toolUseId!, entry]));
  const NONE = new Map<ToolUseId, AttentionItem>();
  const cellsOf = (fill: (b: Builder) => void) => {
    const b = builder();
    b.turn('u1');
    fill(b);
    return runs(drawn(b.events))[0].cells;
  };
  const read = (line: ReturnType<typeof runLine>) => (line.kind === 'caption' ? 'caption' : `${line.kind} ${line.cell.toolUseId}`);

  it('the foreground call that started last of those running; none running, the caption', () => {
    const cells = cellsOf((b) => { command(b, 't1'); b.toolUse('t2', 'Bash', { command: 'make two' }, 'm2', 0); b.toolUse('t3', 'Bash', { command: 'make three' }, 'm2', 1); });
    expect(read(runLine(cells, NONE, false))).toBe('running t3');
    const done = cellsOf((b) => { command(b, 't1'); command(b, 't2'); });
    expect(read(runLine(done, NONE, false))).toBe('caption');
  });

  it('a call in the background never takes the line: only background calls running, the caption', () => {
    const cells = cellsOf((b) => { command(b, 't1'); b.toolUse('t2', 'Bash', { command: 'make two' }, 'm2', 0); });
    const moved = cells.map((cell) => (cell.toolUseId === 't2' ? { ...cell, background: true } : cell));
    expect(read(runLine(moved, NONE, false))).toBe('caption');
  });

  it('a call waiting for permission takes the line over a running one; of several, the request created first, call order between equals', () => {
    const cells = cellsOf((b) => { b.toolUse('t1', 'Bash', { command: 'make one' }, 'm1', 0); b.toolUse('t2', 'Bash', { command: 'make two' }, 'm1', 1); b.toolUse('t3', 'Bash', { command: 'make three' }, 'm1', 2); });
    expect(read(runLine(cells, waitingOf(item('t2', '2026-09-28T10:00:05.000Z')), false))).toBe('waiting t2');
    expect(read(runLine(cells, waitingOf(item('t3', '2026-09-28T10:00:05.000Z'), item('t2', '2026-09-28T10:00:06.000Z')), false))).toBe('waiting t3');
    expect(read(runLine(cells, waitingOf(item('t3', '2026-09-28T10:00:05.000Z'), item('t2', '2026-09-28T10:00:05.000Z')), false))).toBe('waiting t2');
    expect(read(runLine(cells, waitingOf(item('t2', '2026-09-28T10:00:05.000Z', 'question')), false)), 'only a permission request words the line').toBe('running t3');
  });

  it('held by a permission that names no call of the turn: the caption, never a running label', () => {
    const cells = cellsOf((b) => { command(b, 't1'); b.toolUse('t2', 'Bash', { command: 'make two' }, 'm2', 0); });
    expect(read(runLine(cells, NONE, true))).toBe('caption');
  });
});

describe('heldByPermission', () => {
  const at = '2026-09-28T10:00:05.000Z';
  const entry = (key: string, kind: AttentionItem['kind'], agent: string | null): [ToolUseId, AttentionItem] => [key as ToolUseId, {
    id: `att-${key}` as AttentionId, appSessionId: 'session-1' as AppSessionId, sessionId: null, kind, request: { requestId: key as RequestId, toolUseId: key as ToolUseId, taskId: null, agentId: agent as never },
    summary: 'invented', createdAt: at, state: 'pending', stateChangedAt: at, expiresAt: null,
  }];
  const calls = new Set(['t1', 't2'] as ToolUseId[]);

  it('holds for a permission keyed by no call of the turn that names no agent, and for nothing else', () => {
    expect(heldByPermission(new Map([entry('req-9', 'permission', null)]), calls)).toBe(true);
    expect(heldByPermission(new Map([entry('req-9', 'permission', 'agent-1')]), calls), 'a subagent’s own request').toBe(false);
    expect(heldByPermission(new Map([entry('t2', 'permission', null)]), calls), 'a call of the turn').toBe(false);
    expect(heldByPermission(new Map([entry('req-9', 'question', null)]), calls), 'not a permission').toBe(false);
    expect(heldByPermission(new Map(), calls)).toBe(false);
  });
});

// The chain merge with the composer landing (U4a, decision 33): a call the engine moved to the background, so a message
// sent now could be read, is a call of its run like any other. It is in the background (decision 20), so it never takes
// the run's line; it is a step whose outcome waits while it runs, so the caption marks nothing for it, and once its
// process exits it is a stopped step. Opened, its row reads the model's moved label. The turn's line is U4a's verb with
// U2a's caption after it.
describe('a call the engine moved, in its run', () => {
  const A_BASH = 'toolu_01UK719ATPuRjLtWeTEn9rZ1'; // u4p1-a-seeded-1: `node wait.cjs a1 40`, moved at 45
  const MOVED = /^Moved `node wait\.cjs w1 40` to the background after [\dhms ]+$/;
  const lineOf = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'divider' ? [dividerCopy({ ...row, durationMs: row.summary.durationMs ?? 0 })] : []));
  const movedInRun = () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('r1', 'Read', { file_path: 'notes/plan.md' }, 'm1', 0);
    b.result('r1', 'The plan, in three steps.');
    b.toolUse('t1', 'Bash', { command: 'node wait.cjs w1 40', description: 'Wait for the sample job' }, 'm2', 0);
    b.result('t1', 'Command was moved to the background', { structured: { ...BASH_RESULT(''), backgroundedToDeliverMessage: true } });
    b.end(['u1'], { result: 'success', terminalReason: 'aborted_tools', endedForMessage: true });
    return b;
  };

  it('u4p1-a-seeded-1 at the move (45), its turn still open: the run of one holds the moved call, in the background and running, and its line is the caption', () => {
    const [run] = runs(drawn(journalToEvents(loadUxwaveJournal('u4p1-a-seeded-1').filter((row) => row.seq <= 45))));
    expect(run.cells.map((cell) => cell.toolUseId)).toEqual([A_BASH]);
    expect(run.cells[0]).toMatchObject({ moved: true, status: 'running', background: true });
    expect(run.cells[0].label).toMatch(/^Moved `node wait\.cjs a1 40` to the background after [\dhms ]+$/);
    expect(runLine(run.cells, new Map(), false)).toEqual({ kind: 'caption' });
    expect(run.summary).toBe('Ran a command');
  });

  it('a run of two whose turn a message sent now ended: the moved call runs on with no mark in the caption, its row reads its moved label, and the turn reads “Ended for your message after …” and what it did', () => {
    const rows = drawn(movedInRun().events);
    const [run] = runs(rows);
    expect(run.cells.map((cell) => cell.toolUseId)).toEqual(['r1', 't1']);
    expect(run.cells[1]).toMatchObject({ moved: true, status: 'running', background: true });
    expect(run.cells[1].label).toMatch(MOVED);
    expect(runLine(run.cells, new Map(), false)).toEqual({ kind: 'caption' });
    expect(run.summary).toBe('Read plan.md, ran a command');
    expect(lineOf(rows)).toEqual([expect.stringMatching(/^Ended for your message after [\dhms ]+ · Read plan.md, ran a command$/)]);
  });

  it('once its process exits before its task’s end: the moved call is a stopped step under the same words, on the run’s line and the turn’s', () => {
    const b = movedInRun();
    b.emit('process.exited', { code: null, signal: null, reason: 'unknown', lostAttentionCount: 0, budget: null }, { atMs: Date.parse(b.events.at(-1)!.at) });
    const rows = drawn(b.events.map((event) => (event.kind === 'process.exited' ? { ...event, seq: null } : event)));
    const [run] = runs(rows);
    expect(run.cells[1]).toMatchObject({ moved: true, status: 'stopped', background: false });
    expect(run.cells[1].label).toMatch(MOVED);
    expect(run.summary).toBe('Read plan.md, ran a command (1 stopped)');
    expect(lineOf(rows)).toEqual([expect.stringMatching(/^Ended for your message after [\dhms ]+ · Read plan.md, ran a command \(1 stopped\)$/)]);
  });
});
