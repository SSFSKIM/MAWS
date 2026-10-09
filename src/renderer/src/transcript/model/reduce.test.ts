import type { SessionEvent } from '@shared/graph/events';
import { describe, expect, it } from 'vitest';
import { loadEventFixture } from '../../../../../test/support/fixtures';
import { turnActivity } from './activity';
import { dividerCopy } from './copy';
import { rowsOf, withAllExpanded } from './derive';
import { rowId, turnId } from './keys';
import { applyEvents, createState } from './reduce';
import type { Row } from './rows';
import { serializeRows } from './serialize';
import { api, builder, request, task, tool, uuid, USAGE, type Builder } from './test-events';
import { parent } from './test-events'; // E7

const reduce = (events: SessionEvent[]) => applyEvents(createState(null, null), events);
const rows = (events: SessionEvent[]) => rowsOf(withAllExpanded(reduce(events)));
const kinds = (list: Row[]) => list.map((row) => row.kind);
const find = <K extends Row['kind']>(list: Row[], kind: K, n = 0) => list.filter((row): row is Extract<Row, { kind: K }> => row.kind === kind)[n];

describe('turn boundaries', () => {
  it('turn.started opens a turn keyed on the user message uuid and turn.ended closes it', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'Hello');
    b.end(['u1']);
    const state = reduce(b.events);
    expect(state.order).toEqual([turnId.ofMessage(uuid('u1'))]);
    const turn = state.turns.get(turnId.ofMessage(uuid('u1')))!;
    expect(turn.state).toBe('closed');
    expect(turn.origin).toBe('human');
    expect(turn.ended?.kind).toBe('turn.ended');
    expect(kinds(rows(b.events))).toEqual(['time', 'user', 'assistant_text']);
  });

  it('a turn.started naming an echo uuid is dropped, and the echo receipt closes nothing', () => {
    const b = builder();
    b.emit('user.message', { messageUuid: uuid('echo'), content: '<bash-input>ls</bash-input>', isReplay: false, isSynthetic: true, origin: 'bash_echo', bash: null });
    b.emit('turn.started', { userMessageUuid: uuid('echo'), origin: 'engine' });
    b.end(['echo'], { isEchoReceipt: true, numTurns: 0, terminalReason: null });
    b.turn('u1');
    b.text('m1', 0, 'Hi');
    b.end(['u1']);
    const state = reduce(b.events);
    expect(state.echoUuids.has(uuid('echo'))).toBe(true);
    expect(state.order).toEqual([turnId.ofMessage(uuid('u1'))]);
    expect(kinds(rows(b.events))).toEqual(['time', 'user', 'assistant_text']);
  });

  it('a top-level user message opens a turn implicitly when none is open; bash, echo and synthetic ones never do', () => {
    const b = builder();
    b.emit('user.message', { messageUuid: uuid('bash-in'), content: '', isReplay: true, isSynthetic: false, origin: null, bash: { part: 'input', command: 'printf OK' } });
    b.emit('user.message', { messageUuid: uuid('bash-out'), content: '', isReplay: true, isSynthetic: false, origin: null, bash: { part: 'output', stdout: 'OK', stderr: '', exitCode: 0 } });
    b.emit('user.message', { messageUuid: uuid('synthetic'), content: 'x', isReplay: false, isSynthetic: true, origin: null, bash: null });
    b.emit('user.message', { messageUuid: uuid('u1'), content: 'Do it', isReplay: false, isSynthetic: false, origin: null, bash: null });
    b.text('m1', 0, 'Done');
    b.end(['u1']);
    const state = reduce(b.events);
    expect(state.order).toEqual([turnId.ofMessage(uuid('u1'))]);
    const list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'bash', 'user', 'assistant_text']);
    expect(find(list, 'bash')).toMatchObject({ id: rowId.bash(uuid('bash-in')), command: 'printf OK', stdout: 'OK', exitCode: 0, turnId: null });
  });

  it('an assistant block with no turn open opens a human turn keyed on the event', () => {
    const b = builder();
    b.text('m1', 0, 'Unprompted');
    const state = reduce(b.events);
    expect(state.order).toEqual([turnId.ofEvent(b.events[0].id)]);
    expect(state.turns.get(state.order[0])!.origin).toBe('human');
  });

  // *Turn boundaries on this engine* (C3's live acceptance): the bubble shows at the write, the turn is accepted at
  // `command_lifecycle started`, a `now` prompt never folds (a `next` prompt folds at its `started`), and a prompt the
  // engine drops closes without work.
  const prompt = (b: ReturnType<typeof builder>, u: string, text = `prompt ${u}`) =>
    b.emit('user.message', { messageUuid: uuid(u), content: text, isReplay: false, isSynthetic: false, origin: 'human', bash: null });

  it('a prompt shows its bubble before its turn.started, and the same turn gains its divider when it starts', () => {
    const b = builder();
    prompt(b, 'u1', 'Hello?');
    let state = reduce(b.events);
    const id = turnId.ofMessage(uuid('u1'));
    expect(state.order).toEqual([id]);
    let list = rowsOf(state);
    expect(kinds(list)).toEqual(['time', 'user']);
    expect(find(list, 'user')).toMatchObject({ id: rowId.user(uuid('u1')), turnId: id, text: 'Hello?', steer: false, dropped: false });
    state = applyEvents(state, [b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' })]);
    expect(state.order).toEqual([id]);
    list = rowsOf(state);
    expect(kinds(list)).toEqual(['time', 'user', 'divider']);
    expect(find(list, 'divider')).toMatchObject({ turnId: id, state: 'working', origin: 'human' });
    b.text('m1', 0, 'Hi');
    b.end(['u1']);
    state = applyEvents(state, b.events.slice(-2));
    expect(kinds(rowsOf(state))).toEqual(['time', 'user', 'assistant_text']); // closed without work: no divider
  });

  it('a prompt sent while a turn runs is a pending turn of its own after the running one, opened in place by its turn.started', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'sleep 1' });
    prompt(b, 'u2', 'next');
    let state = reduce(b.events);
    const [one, two] = [turnId.ofMessage(uuid('u1')), turnId.ofMessage(uuid('u2'))];
    expect(state.order).toEqual([one, two]);
    expect(state.current).toBe(one);
    let list = rowsOf(state);
    expect(list.filter((row) => row.turnId === two).map((row) => row.kind)).toEqual(['user']); // no divider while pending
    expect(find(list, 'user', 1)).toMatchObject({ id: rowId.user(uuid('u2')), turnId: two, steer: false, dropped: false });
    b.result('t1', 'ok');
    b.end(['u1'], { terminalReason: 'aborted_streaming' }); // preempted
    b.emit('turn.started', { userMessageUuid: uuid('u2'), origin: 'human' });
    b.text('m2', 0, 'Next done');
    state = applyEvents(state, b.events.slice(-4));
    expect(state.order).toEqual([one, two]);
    expect(state.current).toBe(two);
    list = rowsOf(state);
    expect(list.filter((row) => row.turnId === two).map((row) => row.kind)).toEqual(['user', 'divider', 'assistant_text']);
    expect(list.filter((row) => row.kind === 'user')).toHaveLength(2);
  });

  // `priority: 'next'` (C3's live run): the engine takes a queued prompt at the next tool boundary of the running turn,
  // its `started` arrives inside that open turn, and one result names both prompts.
  it('a started inside an open turn folds the pending prompt into it: one turn, a steer bubble, no second divider', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'sleep 1' });
    prompt(b, 'u2', 'also check the logs');
    let state = reduce(b.events);
    const [one, two] = [turnId.ofMessage(uuid('u1')), turnId.ofMessage(uuid('u2'))];
    expect(state.order).toEqual([one, two]); // pending until the engine takes it
    b.result('t1', 'ok');
    b.emit('turn.started', { userMessageUuid: uuid('u2'), origin: 'human' });
    b.toolUse('t2', 'Bash', { command: 'tail log' });
    b.result('t2', 'ok');
    b.text('m1', 0, 'Both done');
    state = applyEvents(state, b.events.slice(-6));
    expect(state.order).toEqual([one]);
    expect(state.turns.has(two)).toBe(false);
    expect(state.current).toBe(one);
    let list = rowsOf(state); // open: expanded
    expect(list.filter((row) => row.kind === 'divider')).toHaveLength(1);
    const users = list.filter((row): row is Extract<Row, { kind: 'user' }> => row.kind === 'user');
    expect(users.map((row) => [row.id, row.turnId, row.steer, row.dropped])).toEqual([
      [rowId.user(uuid('u1')), one, false, false],
      [rowId.user(uuid('u2')), one, true, false],
    ]);
    b.end(['u1', 'u2']); // one result names both prompts
    state = applyEvents(state, [b.events.at(-1)!]);
    expect(state.turns.get(one)!.state).toBe('closed');
    expect(state.current).toBeNull();
    list = rowsOf(state); // closed and collapsed: the steer bubble stays, outside the work area
    expect(kinds(list)).toEqual(['time', 'user', 'divider', 'user', 'assistant_text']);
    expect(find(list, 'user', 1)).toMatchObject({ steer: true, text: 'also check the logs' });
    // The engine's inbound replay of the folded prompt adds nothing.
    const before = rowsOf(state);
    state = applyEvents(state, [prompt(b, 'u2', 'also check the logs')]);
    expect(rowsOf(state)).toEqual(before);
    expect(state.order).toEqual([one]);
  });

  // C3's normaliser emits no turn.started for a `started` that arrives inside an open turn (it adds the uuid to that
  // turn): the fold happens at the `command.lifecycle started` itself (rebase equivalence gate, pass3/steer-next seq 71).
  it("a command.lifecycle started inside an open turn folds the pending prompt, with no turn.started to follow (C3's shape)", () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'sleep 1' });
    prompt(b, 'u2', 'also check the logs');
    b.result('t1', 'ok');
    b.emit('command.lifecycle', { commandUuid: uuid('u2'), state: 'started' });
    b.text('m1', 0, 'Both done');
    let state = reduce(b.events);
    const one = turnId.ofMessage(uuid('u1'));
    expect(state.order).toEqual([one]);
    expect(state.turns.has(turnId.ofMessage(uuid('u2')))).toBe(false);
    b.end(['u1', 'u2']);
    state = applyEvents(state, [b.events.at(-1)!]);
    expect(state.turns.get(one)!.state).toBe('closed');
    const users = rowsOf(state).filter((row): row is Extract<Row, { kind: 'user' }> => row.kind === 'user');
    expect(users.map((row) => [row.id, row.turnId, row.steer, row.dropped])).toEqual([
      [rowId.user(uuid('u1')), one, false, false],
      [rowId.user(uuid('u2')), one, true, false],
    ]);
  });

  it('a command.lifecycle started with no turn open leaves the pending prompt for its turn.started', () => {
    const b = builder();
    prompt(b, 'u1', 'Hello?');
    b.emit('command.lifecycle', { commandUuid: uuid('u1'), state: 'started' });
    const state = reduce(b.events);
    const id = turnId.ofMessage(uuid('u1'));
    expect(state.order).toEqual([id]);
    expect(state.turns.get(id)!.accepted).toBe(false);
  });

  it('a started with no turn open still opens the pending turn in place', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'sleep 1' });
    prompt(b, 'u2', 'now');
    b.end(['u1'], { terminalReason: 'aborted_streaming' });
    b.emit('turn.started', { userMessageUuid: uuid('u2'), origin: 'human' });
    const state = reduce(b.events);
    expect(state.order).toEqual([turnId.ofMessage(uuid('u1')), turnId.ofMessage(uuid('u2'))]);
    expect(state.current).toBe(turnId.ofMessage(uuid('u2')));
    expect(rowsOf(state).filter((row) => row.kind === 'user').map((row) => (row as Extract<Row, { kind: 'user' }>).steer)).toEqual([false, false]);
  });

  it('a pending prompt hidden by a rewind stays unfolded when its started arrives inside an open turn', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'sleep 1' });
    prompt(b, 'u2', 'queued');
    b.emit('boundary.rewind', { targetMessageUuid: uuid('u2'), precedingAssistantUuid: null, prefillText: 'queued' });
    b.emit('turn.started', { userMessageUuid: uuid('u2'), origin: 'human' });
    const state = reduce(b.events);
    const [one, two] = [turnId.ofMessage(uuid('u1')), turnId.ofMessage(uuid('u2'))];
    expect(state.order).toEqual([one]);
    expect(state.hidden?.turns).toEqual([two]);
    expect(state.turns.has(two)).toBe(true);
    expect(state.turns.get(one)!.events.some((event) => event.kind === 'user.message' && event.messageUuid === uuid('u2'))).toBe(false);
  });

  // The ordering ruling: at acceptance a pending prompt keeps its written place unless another turn opened after it
  // was written and has run since, in which case it moves to the end, so the transcript reads in run order.
  it('a prompt accepted after another turn ran in between moves to the end of order; with nothing in between it stays', () => {
    const b = builder();
    prompt(b, 'p');
    b.emit('turn.started', { userMessageUuid: null, origin: 'engine' });
    b.text('e1', 0, 'The engine continued');
    b.end([], { origin: 'task-notification' });
    const engine = b.events.find((event) => event.kind === 'turn.started')!;
    b.emit('turn.started', { userMessageUuid: uuid('p'), origin: 'human' });
    b.text('m1', 0, 'Answer to p');
    let state = reduce(b.events);
    expect(state.order).toEqual([turnId.ofEvent(engine.id), turnId.ofMessage(uuid('p'))]);
    expect(state.current).toBe(turnId.ofMessage(uuid('p')));
    expect(find(rowsOf(state), 'assistant_text', 1)).toMatchObject({ turnId: turnId.ofMessage(uuid('p')), markdown: 'Answer to p' });

    const quiet = builder();
    quiet.turn('u0');
    quiet.text('m0', 0, 'Earlier');
    quiet.end(['u0']);
    prompt(quiet, 'q');
    quiet.emit('turn.started', { userMessageUuid: uuid('q'), origin: 'human' });
    state = reduce(quiet.events);
    expect(state.order).toEqual([turnId.ofMessage(uuid('u0')), turnId.ofMessage(uuid('q'))]);
  });

  // E11 (W-C): why the turn closed, so its divider can say who stopped it. A crash the reader had already stopped (the
  // interruption marker on the turn) stays the reader's; a stop, a quit and a child's parent exit are no crash of the turn.
  it('records a crash as the cause of a turn the exit closed, and no cause for a stop or a turn the reader interrupted', () => {
    const exit = (b: Builder, reason: 'crash' | 'stop' | 'quit') => b.emit('process.exited', { code: null, signal: reason === 'crash' ? 'SIGKILL' : null, reason, lostAttentionCount: 0, budget: null });
    for (const reason of ['stop', 'quit'] as const) {
      const b = builder();
      b.turn('u1');
      b.toolUse('t1', 'Bash', { command: 'sleep 60' });
      exit(b, reason);
      const state = reduce(b.events);
      expect(state.turns.get(turnId.ofMessage(uuid('u1'))), reason).toMatchObject({ closedBy: 'stopped', closedCause: null });
      expect(find(rowsOf(state), 'divider'), reason).toMatchObject({ state: 'stopped' });
      expect(find(rowsOf(state), 'divider'), reason).not.toHaveProperty('cause');
    }
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'sleep 60' });
    b.emit('user.message', { messageUuid: uuid('int'), content: '[Request interrupted by user]', isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    exit(b, 'crash');
    expect(reduce(b.events).turns.get(turnId.ofMessage(uuid('u1')))).toMatchObject({ closedBy: 'stopped', closedCause: null });
  });

  // Whole-branch review: C3 synthesises no turn.ended for a killed process, only process.exited (its acceptance step
  // 14: kill -9 mid-turn, resume, send a prompt).
  it('a session process exit closes the running turn as stopped, so the next prompt is its own turn', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'sleep 60' });
    prompt(b, 'u2', 'waiting'); // pending when the process dies: it stays pending
    b.emit('process.exited', { code: null, signal: 'SIGKILL', reason: 'crash', lostAttentionCount: 0, budget: null /* C12 */ });
    let state = reduce(b.events);
    const [one, two] = [turnId.ofMessage(uuid('u1')), turnId.ofMessage(uuid('u2'))];
    expect(state.turns.get(one)).toMatchObject({ state: 'closed', closedBy: 'stopped', closedCause: 'crash' });
    expect(state.turns.get(two)).toMatchObject({ state: 'open', accepted: false });
    expect(find(rowsOf(state), 'divider')).toMatchObject({ turnId: one, state: 'stopped', cause: 'crash' });
    prompt(b, 'u3', 'after the resume');
    b.emit('turn.started', { userMessageUuid: uuid('u3'), origin: 'human' });
    b.text('m3', 0, 'Resumed answer');
    b.end(['u3']);
    state = applyEvents(state, b.events.slice(-4));
    const three = turnId.ofMessage(uuid('u3'));
    expect(state.order).toEqual([one, two, three]);
    expect(state.turns.get(three)!.state).toBe('closed');
    expect(find(rowsOf(state), 'assistant_text')).toMatchObject({ turnId: three, markdown: 'Resumed answer' });
    expect(rowsOf(state).filter((row) => row.kind === 'user' && row.steer)).toEqual([]);
  });

  // Final rebase: C4 answers the ask for a holder-less session whose last turn never ended (SDK entrypoints write no
  // turn_duration) with `process.exited { reason: 'unknown' }` at the last record: the process was not seen to go, so
  // the exit is no evidence of a stop, and the turn closes by the superseding start's rule.
  it('an exit whose reason is unknown closes the running turn as completed, or as stopped on interrupt evidence', () => {
    const quiet = builder();
    quiet.turn('u1');
    quiet.toolUse('t1', 'Bash', { command: 'ls' });
    quiet.result('t1', 'a.ts');
    quiet.text('m1', 0, 'Done.');
    quiet.emit('process.exited', { code: null, signal: null, reason: 'unknown', lostAttentionCount: 0, budget: null /* C12 */ });
    let state = reduce(quiet.events);
    expect(state.turns.get(turnId.ofMessage(uuid('u1')))).toMatchObject({ state: 'closed', closedBy: 'completed' });
    expect(find(rowsOf(state), 'divider')).toMatchObject({ state: 'completed' });
    const denied = builder();
    denied.turn('u1');
    denied.toolUse('t1', 'Bash', { command: 'rm -rf x' });
    denied.result('t1', 'User rejected tool use', { isError: true, denial: 'user-rejected' });
    denied.emit('process.exited', { code: null, signal: null, reason: 'unknown', lostAttentionCount: 0, budget: null /* C12 */ });
    state = reduce(denied.events);
    expect(state.turns.get(turnId.ofMessage(uuid('u1')))).toMatchObject({ state: 'closed', closedBy: 'stopped' });
  });

  // Coordinator ruling (final rebase fix wave): C4's synthesised exit is disk-derived (`seq: null`) and was never
  // witnessed, so it leaves no notice; C3's live exits carry a seq and keep theirs, `unknown` included (C3 journals a
  // clean exit with no stop reason as `unknown`).
  it('a disk-synthesised unknown exit (seq null) renders no notice row; a live one keeps its row', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'Done.');
    b.emit('process.exited', { code: null, signal: null, reason: 'unknown', lostAttentionCount: 0, budget: null /* C12 */ });
    const live = rowsOf(reduce(b.events)).filter((row) => row.kind === 'error');
    expect(live.map((row) => (row as Extract<Row, { kind: 'error' }>).text)).toEqual(['Session process exited (unknown)']);
    const disk = rowsOf(reduce(b.events.map((event) => (event.kind === 'process.exited' ? { ...event, seq: null } : event))));
    expect(disk.filter((row) => row.kind === 'error')).toEqual([]);
    expect(reduce(b.events.map((event) => (event.kind === 'process.exited' ? { ...event, seq: null } : event))).current).toBeNull();
  });

  // Whole-branch review: C4's disk backfill emits turn.ended only from system/turn_duration, which an interrupted turn
  // lacks, and writes turn.started before the prompt's user.message.
  // Whole-branch review: C4's disk backfill emits turn.ended only from system/turn_duration, which SDK-entrypoint
  // sessions (MAWS launches with sdk-ts) never write, and an interrupted turn lacks too. A superseded turn closes as
  // completed unless it carries interrupt evidence the reducer retains.
  it('a turn.started for a prompt with no pending turn closes the previous open turn, completed without interrupt evidence, and takes over', () => {
    const b = builder();
    for (const n of [1, 2, 3]) {
      b.emit('turn.started', { userMessageUuid: uuid(`u${n}`), origin: null });
      b.emit('user.message', { messageUuid: uuid(`u${n}`), content: `From disk ${n}`, isReplay: false, isSynthetic: false, origin: null, bash: null });
      b.toolUse(`t${n}`, 'Bash', { command: `step ${n}` }, `m${n}a`, 0);
      b.result(`t${n}`, 'ok');
      b.text(`m${n}`, 0, `Answer ${n}`);
    }
    const state = reduce(b.events);
    const ids = ['u1', 'u2', 'u3'].map((u) => turnId.ofMessage(uuid(u)));
    expect(state.order).toEqual(ids);
    expect(ids.map((id) => [state.turns.get(id)!.state, state.turns.get(id)!.closedBy])).toEqual([['closed', 'completed'], ['closed', 'completed'], ['open', null]]);
    const list = rowsOf(withAllExpanded(state));
    expect(list.filter((row) => row.kind === 'divider').map((row) => (row as Extract<Row, { kind: 'divider' }>).state)).toEqual(['completed', 'completed', 'working']);
    expect(list.filter((row) => row.kind === 'assistant_text').map((row) => [row.turnId, (row as Extract<Row, { kind: 'assistant_text' }>).markdown])).toEqual([
      [ids[0], 'Answer 1'], [ids[1], 'Answer 2'], [ids[2], 'Answer 3'],
    ]);
    expect(list.filter((row) => row.kind === 'user').map((row) => [row.turnId, (row as Extract<Row, { kind: 'user' }>).steer])).toEqual([[ids[0], false], [ids[1], false], [ids[2], false]]);
  });

  it('a superseded turn with interrupt evidence (the marker, or a user-rejected denial) closes as stopped', () => {
    const marker = builder();
    marker.turn('u1');
    marker.toolUse('t1', 'Bash', { command: 'sleep 9' });
    marker.emit('user.message', { messageUuid: uuid('im'), content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }], isReplay: false, isSynthetic: false, origin: null, bash: null });
    marker.turn('u2');
    let state = reduce(marker.events);
    expect(state.turns.get(turnId.ofMessage(uuid('u1')))).toMatchObject({ state: 'closed', closedBy: 'stopped' });
    const denied = builder();
    denied.turn('u1');
    denied.toolUse('t1', 'Bash', { command: 'rm -rf x' });
    denied.result('t1', 'User rejected tool use', { isError: true, denial: 'user-rejected' });
    denied.turn('u2');
    state = reduce(denied.events);
    expect(state.turns.get(turnId.ofMessage(uuid('u1')))).toMatchObject({ state: 'closed', closedBy: 'stopped' });
  });

  // Whole-branch review round 3: on disk the interrupt marker is an ordinary user record, which C4's backfill gives a
  // turn.started of its own before its user.message (array text content). It folds back onto the interrupted turn.
  const diskPrompt = (b: ReturnType<typeof builder>, u: string, content: string | { type: string; text: string }[]) => {
    b.emit('turn.started', { userMessageUuid: uuid(u), origin: null });
    b.emit('user.message', { messageUuid: uuid(u), content: content as never, isReplay: false, isSynthetic: false, origin: null, bash: null });
  };

  it('a disk interrupt marker with its own turn.started folds back onto the interrupted turn: stopped, no marker bubble', () => {
    for (const marker of ['[Request interrupted by user]', '[Request interrupted by user for tool use]']) {
      const b = builder();
      diskPrompt(b, 'u1', 'Count slowly');
      b.toolUse('t1', 'Bash', { command: 'sleep 9' });
      diskPrompt(b, 'im', [{ type: 'text', text: marker }]);
      diskPrompt(b, 'u2', 'Next prompt');
      b.text('m2', 0, 'Next answer');
      const state = reduce(b.events);
      const [one, two] = [turnId.ofMessage(uuid('u1')), turnId.ofMessage(uuid('u2'))];
      expect(state.order).toEqual([one, two]);
      expect(state.turns.has(turnId.ofMessage(uuid('im')))).toBe(false);
      expect(state.turns.get(one)).toMatchObject({ state: 'closed', closedBy: 'stopped' });
      const list = rowsOf(withAllExpanded(state));
      expect(find(list, 'divider')).toMatchObject({ turnId: one, state: 'stopped' });
      expect(list.filter((row) => row.kind === 'user').map((row) => [row.turnId, (row as Extract<Row, { kind: 'user' }>).text])).toEqual([[one, 'Count slowly'], [two, 'Next prompt']]);
      expect(find(list, 'assistant_text')).toMatchObject({ turnId: two, markdown: 'Next answer' });
    }
  });

  it('a marker that cannot fold back (nothing before it) still never renders as a user row', () => {
    const b = builder();
    diskPrompt(b, 'im', [{ type: 'text', text: '[Request interrupted by user]' }]);
    expect(rowsOf(withAllExpanded(reduce(b.events))).filter((row) => row.kind === 'user')).toEqual([]);
  });

  it('the message-first order still retains the marker on the running turn, which the next prompt closes as stopped', () => {
    const b = builder();
    diskPrompt(b, 'u1', 'Count slowly');
    b.toolUse('t1', 'Bash', { command: 'sleep 9' });
    b.emit('user.message', { messageUuid: uuid('im'), content: [{ type: 'text', text: '[Request interrupted by user]' }], isReplay: false, isSynthetic: false, origin: null, bash: null });
    diskPrompt(b, 'u2', 'Next prompt');
    const state = reduce(b.events);
    expect(state.order).toEqual([turnId.ofMessage(uuid('u1')), turnId.ofMessage(uuid('u2'))]);
    expect(state.turns.get(turnId.ofMessage(uuid('u1')))).toMatchObject({ state: 'closed', closedBy: 'stopped' });
    expect(rowsOf(state).filter((row) => row.kind === 'user')).toHaveLength(2);
  });

  it('a prompt that merely begins with the marker text, started first, is a prompt with its bubble', () => {
    const b = builder();
    diskPrompt(b, 'u1', 'Count slowly');
    b.text('m1', 0, 'One, two');
    diskPrompt(b, 'u2', '[Request interrupted by user] please continue anyway');
    const state = reduce(b.events);
    expect(state.order).toEqual([turnId.ofMessage(uuid('u1')), turnId.ofMessage(uuid('u2'))]);
    expect(find(rowsOf(state), 'user', 1)).toMatchObject({ turnId: turnId.ofMessage(uuid('u2')), text: '[Request interrupted by user] please continue anyway' });
  });

  it('a cancel naming a pending prompt marks its bubble dropped and closes its turn without work; later lifecycles change nothing', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'sleep 1' });
    prompt(b, 'u2', 'queued');
    b.emit('command.lifecycle', { commandUuid: uuid('u2'), state: 'cancelled' });
    b.result('t1', 'ok');
    b.text('m1', 0, 'Done');
    b.end(['u1']);
    let state = reduce(b.events);
    const two = turnId.ofMessage(uuid('u2'));
    expect(state.turns.get(two)).toMatchObject({ state: 'closed' });
    expect(state.turns.get(turnId.ofMessage(uuid('u1')))).toMatchObject({ state: 'closed' });
    const list = rowsOf(state);
    expect(list.filter((row) => row.turnId === two).map((row) => row.kind)).toEqual(['user']);
    expect(find(list, 'user', 1)).toMatchObject({ turnId: two, dropped: true, steer: false });
    expect(find(list, 'user', 0)).toMatchObject({ dropped: false });
    state = applyEvents(state, [b.emit('command.lifecycle', { commandUuid: uuid('u1'), state: 'cancelled' }), b.emit('command.lifecycle', { commandUuid: uuid('u2'), state: 'discarded' })]);
    expect(rowsOf(state)).toEqual(list);
  });

  it('an idle prompt the engine drops before it starts: its bubble is dropped, its turn closed, no divider', () => {
    const b = builder();
    prompt(b, 'u1');
    b.emit('command.lifecycle', { commandUuid: uuid('u1'), state: 'cancelled' });
    const state = reduce(b.events);
    expect(state.turns.get(turnId.ofMessage(uuid('u1')))!.state).toBe('closed');
    expect(state.current).toBeNull();
    const list = rowsOf(state);
    expect(kinds(list)).toEqual(['time', 'user']);
    expect(find(list, 'user')).toMatchObject({ dropped: true, steer: false });
  });

  it('states form one lineage: an older state still derives its own rows, and applying to a superseded state throws', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'One');
    b.end(['u1']);
    const first = reduce(b.events);
    const before = rowsOf(first);
    const b2 = builder();
    b2.at = b.at;
    b2.turn('u2');
    b2.text('m2', 0, 'Two');
    b2.end(['u2']);
    const more = b2.events.map((event, i) => ({ ...event, id: `x${i}`, seq: b.events.length + i }) as SessionEvent);
    const second = applyEvents(first, more);
    expect(kinds(rowsOf(second))).toEqual(['time', 'user', 'assistant_text', 'user', 'assistant_text']);
    expect(rowsOf(first)).toEqual(before);
    expect(kinds(rowsOf(first))).toEqual(['time', 'user', 'assistant_text']);
    expect(() => applyEvents(first, more)).toThrow(/lineage/);
    expect(() => applyEvents(second, [])).not.toThrow();
  });

  it('the untagged interrupt fallback matches the complete marker only', () => {
    const b = builder();
    b.emit('user.message', { messageUuid: uuid('m0'), content: '[Request interrupted by user]', isReplay: false, isSynthetic: false, origin: null, bash: null });
    expect(reduce(b.events).order).toEqual([]);
    b.emit('user.message', { messageUuid: uuid('m1'), content: '[Request interrupted by user] please continue anyway', isReplay: false, isSynthetic: false, origin: null, bash: null });
    const state = reduce(b.events);
    expect(state.order).toEqual([turnId.ofMessage(uuid('m1'))]);
    expect(find(rowsOf(state), 'user').text).toBe('[Request interrupted by user] please continue anyway');
  });

  // The engine's tool-use variant (`pass2/per-task-stop-off` seq 71, untagged): a marker too, never a prompt's bubble
  // (as a bubble it would open a pending turn that no `turn.started` ever accepts).
  it('the tool-use interrupt marker is a marker as well', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'sleep 9' });
    b.emit('user.message', { messageUuid: uuid('im'), content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }], isReplay: false, isSynthetic: false, origin: null, bash: null });
    const state = reduce(b.events);
    expect(state.order).toEqual([turnId.ofMessage(uuid('u1'))]);
    expect(rowsOf(state).filter((row) => row.kind === 'user')).toHaveLength(1);
  });

  // Informative outputs (`/cost`, `/status`, `/context`, `/help`) keep their card (W1); see the next case for echoes that
  // only confirm a setting change.
  it('a local-command echo never opens a turn and renders as a local_command row, tags stripped, loose outside a turn and in the work area inside one', () => {
    const b = builder();
    b.emit('user.message', { messageUuid: uuid('lc1'), content: '<local-command-stdout>Total cost: $0.0123</local-command-stdout>', isReplay: true, isSynthetic: false, origin: 'local-command', bash: null });
    let state = reduce(b.events);
    expect(state.order).toEqual([]);
    let list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'local_command']);
    expect(find(list, 'local_command')).toMatchObject({ id: rowId.local(uuid('lc1')), messageUuid: 'lc1', text: 'Total cost: $0.0123', turnId: null });
    // Untagged by C4's backfill: the wrapper is still recognised.
    b.emit('user.message', { messageUuid: uuid('lc2'), content: '<local-command-stdout>Current model: sonnet</local-command-stdout>', isReplay: true, isSynthetic: false, origin: null, bash: null });
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'ok');
    b.emit('user.message', { messageUuid: uuid('lc3'), content: '<local-command-stdout>Context usage: 12k / 200k tokens</local-command-stdout>', isReplay: true, isSynthetic: false, origin: 'local-command', bash: null });
    b.text('m1', 0, 'Done');
    b.end(['u1']);
    state = reduce(b.events);
    expect(state.order).toEqual([turnId.ofMessage(uuid('u1'))]);
    list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'local_command', 'local_command', 'user', 'divider', 'cell', 'local_command', 'assistant_text']);
    expect(find(list, 'local_command', 2)).toMatchObject({ turnId: turnId.ofMessage(uuid('u1')), text: 'Context usage: 12k / 200k tokens' });
    expect(find(list, 'user').text).toBe('prompt u1');
  });

  // E11's sitting (owner-notes 00-consolidated-plan §2.3): an echo that only confirms a setting change draws nothing,
  // since the chip already shows it; the lines are 2.1.293's own (its `/model`, `/fast`, `/effort`, `/output-style`,
  // `/plan`, `/theme` and `/color` messages, read from the binary) and 2.1.283's recorded `Set model to` echoes. One
  // that carries anything more (a save that failed, an override still in force) keeps its card.
  it('an echo that only confirms a setting change draws nothing, loose or inside a turn; one carrying more keeps its card', () => {
    const confirmations = [
      'Set model to `haiku (claude-haiku-4-5-20251001)`', // pass2/auto-routed seq 153 (2.1.283)
      'Set model to `opus (claude-opus-5-5[1m])` for this session only',
      'Set model to `fable` and saved as your default for new sessions with high effort · Fast mode OFF',
      'Kept model as `sonnet`',
      'Fast mode ON · Draws from usage credits',
      'Fast mode OFF',
      '\u001b[33m↯\u001b[0m Kept Fast mode ON',
      'Set effort level to high (this session only): Comprehensive implementation with extensive testing and documentation',
      'Set effort level to xhigh (this session only): Deeper reasoning than high, just below maximum (on supported models)',
      'Effort level set to auto',
      'Output style set to Explanatory',
      'Enabled plan mode',
      'Theme set to dark',
      'Session color set to: blue',
    ];
    const informative = [
      "Set model to `opus` for this session only · couldn't save it as your default: settings.json isn't valid JSON",
      'Effort set to auto for this session, but CLAUDE_CODE_EFFORT_LEVEL=high still controls this session',
      "Effort 'max' exceeds the cap for opus set by your settings or organization; set to 'high' instead (this session only): Deep",
      'Set effort level to high (saved, though your organization starts new sessions on opus at medium effort): Comprehensive',
      'Current model: opus',
      'Session renamed to: C4 acceptance',
      'Set effort level to high (this session only): Comprehensive implementation with extensive testing and documentation\nWarning: settings could not be saved',
    ];
    const b = builder();
    confirmations.forEach((text, i) => b.emit('user.message', { messageUuid: uuid(`c${i}`), content: `<local-command-stdout>${text}</local-command-stdout>`, isReplay: true, isSynthetic: false, origin: i % 2 === 0 ? 'local-command' : null, bash: null }));
    expect(rows(b.events)).toEqual([]);
    b.turn('u1');
    b.emit('user.message', { messageUuid: uuid('in-turn'), content: '<local-command-stdout>Set model to `haiku`</local-command-stdout>', isReplay: true, isSynthetic: false, origin: 'local-command', bash: null });
    informative.forEach((text, i) => b.emit('user.message', { messageUuid: uuid(`i${i}`), content: `<local-command-stdout>${text}</local-command-stdout>`, isReplay: true, isSynthetic: false, origin: 'local-command', bash: null }));
    b.text('m1', 0, 'Done');
    b.end(['u1']);
    const list = rows(b.events);
    expect(list.filter((row) => row.kind === 'local_command').map((row) => (row as Extract<Row, { kind: 'local_command' }>).text)).toEqual(informative);
    expect(reduce(b.events).order).toEqual([turnId.ofMessage(uuid('u1'))]);
  });

  it('an interrupt marker yields no row and opens no turn; the turn’s stopped disposition carries the interruption', () => {
    const b = builder();
    b.emit('user.message', { messageUuid: uuid('im0'), content: [{ type: 'text', text: '[Request interrupted by user]' }], isReplay: false, isSynthetic: false, origin: 'interrupt-marker', bash: null });
    expect(reduce(b.events).order).toEqual([]);
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'sleep 9' });
    b.result('t1', 'User rejected tool use', { isError: true, denial: 'user-rejected' });
    b.emit('user.message', { messageUuid: uuid('im1'), content: [{ type: 'text', text: '[Request interrupted by user]' }], isReplay: false, isSynthetic: false, origin: 'interrupt-marker', bash: null });
    b.end(['u1'], { isError: true, result: 'error_during_execution', terminalReason: 'aborted_streaming' });
    const list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'user', 'divider', 'cell']);
    expect(find(list, 'divider').state).toBe('stopped');
    expect(find(list, 'cell').status).toBe('stopped');
  });
});

describe('turn origin', () => {
  it('is engine only on positive evidence from turn.started or turn.ended', () => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: null, origin: 'engine' });
    b.text('m1', 0, 'Continuing');
    b.end([], { origin: 'task-notification' });
    b.turn('u2', 'hi', null);
    b.text('m2', 0, 'Reply');
    b.end(['u2'], { origin: null });
    b.emit('turn.started', { userMessageUuid: null, origin: null });
    b.text('m3', 0, 'Reply');
    b.end([], { origin: 'task-notification' });
    const state = reduce(b.events);
    expect(state.order.map((id) => state.turns.get(id)!.origin)).toEqual(['engine', 'human', 'engine']);
    const list = rows(b.events);
    // Engine turns: no user row, and a divider even without a work area, so the reader sees whose turn it was.
    expect(kinds(list)).toEqual(['time', 'divider', 'assistant_text', 'user', 'assistant_text', 'divider', 'assistant_text']);
    expect(list.filter((row) => row.kind === 'divider').map((row) => { const d = row as Extract<Row, { kind: 'divider' }>; return dividerCopy({ ...d, durationMs: d.summary.durationMs ?? 0 }); })).toEqual(['Continued for 1s', 'Continued for 1s']);
  });

  // Final rebase: C4's backfill gives a disk `<task-notification>` user record its own turn.started and user.message,
  // both with origin 'task-notification'; that message is the engine's trigger, never the owner's bubble.
  it('an engine turn opened by a task-notification record shows no bubble for it: its divider reads Continued', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'Dispatched.');
    b.end(['u1']);
    b.emit('turn.started', { userMessageUuid: uuid('n1'), origin: 'task-notification' });
    b.emit('user.message', { messageUuid: uuid('n1'), content: '<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n</task-notification>', isReplay: false, isSynthetic: false, origin: 'task-notification', bash: null });
    b.text('m2', 0, 'The agent finished.');
    b.end(['n1'], { origin: null });
    const list = rows(b.events);
    expect(list.filter((row) => row.kind === 'user').map((row) => (row as Extract<Row, { kind: 'user' }>).text)).toEqual(['prompt u1']);
    expect(find(list.filter((row) => row.turnId === turnId.ofMessage(uuid('n1'))), 'divider')).toMatchObject({ origin: 'engine' });
  });

  it('null on both events is human (C4 backfill), and a missing user message is not evidence', () => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: null });
    b.emit('user.message', { messageUuid: uuid('u1'), content: 'From disk', isReplay: false, isSynthetic: false, origin: null, bash: null });
    b.text('m1', 0, 'Reply');
    b.end(['u1'], { origin: null });
    b.emit('turn.started', { userMessageUuid: null, origin: null });
    b.text('m2', 0, 'No user message');
    b.end([], { origin: null });
    const state = reduce(b.events);
    expect(state.order.map((id) => state.turns.get(id)!.origin)).toEqual(['human', 'human']);
    const list = rows(b.events);
    expect(find(list, 'user')).toMatchObject({ text: 'From disk' });
    expect(kinds(list)).toEqual(['time', 'user', 'assistant_text', 'assistant_text']);
  });

  it('peer is its own origin, from turn.started or turn.ended, never folded into engine', () => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: uuid('p1'), origin: 'peer' });
    b.emit('user.message', { messageUuid: uuid('p1'), content: 'From the peer session', isReplay: false, isSynthetic: false, origin: 'peer', bash: null });
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'ok');
    b.text('m1', 0, 'Done');
    b.end(['p1'], { origin: 'peer' });
    b.emit('turn.started', { userMessageUuid: null, origin: null });
    b.text('m2', 0, 'Peer again');
    b.end([], { origin: 'peer' });
    const state = reduce(b.events);
    expect(state.order.map((id) => state.turns.get(id)!.origin)).toEqual(['peer', 'peer']);
    const list = rows(b.events);
    const dividers = list.filter((row): row is Extract<Row, { kind: 'divider' }> => row.kind === 'divider');
    expect(dividers.map((d) => d.origin)).toEqual(['peer', 'peer']); // a peer turn without work keeps its divider too
    expect(dividers.map((d) => dividerCopy({ ...d, durationMs: d.summary.durationMs ?? 0 }))).toEqual(['Peer session worked for 1s · 1 tool call', 'Peer session worked for 1s']);
    expect(find(list, 'user')).toMatchObject({ text: 'From the peer session' });
    expect(turnActivity(state).map((turn) => turn.origin)).toEqual(['peer', 'peer']);
  });
});

describe('ANSI escapes in assistant text', () => {
  it('are stripped in the reducer, streamed (a sequence split across deltas included) and completed, thinking blocks too', () => {
    const events = loadEventFixture('ansi-text');
    const byId = (id: string) => events.findIndex((event) => event.id === id);
    let state = applyEvents(createState(null, null), events.slice(0, byId('x2') + 1));
    const live = () => find(rowsOf(state), 'assistant_text');
    expect(live().markdown.startsWith('Build: ')).toBe(true);
    state = applyEvents(state, events.slice(byId('x2') + 1, byId('x3') + 1));
    expect(state.turns.get(state.order[0])!.live.get('msg_ansi_1:0')!.buffer).toBe('Build: failed');
    state = applyEvents(state, events.slice(byId('x3') + 1, byId('x4') + 1));
    expect(state.turns.get(state.order[0])!.live.get('msg_ansi_1:0')!.buffer).toBe('Build: failed on step 2.');
    state = applyEvents(state, events.slice(byId('x4') + 1));
    expect(live()).toMatchObject({ live: false, markdown: 'Build: failed on step 2.\n\ndocs are linked.' });
    expect(serializeRows(rowsOf(state))).not.toContain('\u001b');
    const b = builder();
    b.turn('u1');
    b.thinking('m1', 0, 'plain \u001b[2mthought\u001b[0m');
    expect(find(rows(b.events), 'thinking').text).toBe('plain thought');
  });

  it('an OSC hyperlink split across deltas never leaves its parameters in the live row', () => {
    const b = builder();
    b.turn('u1');
    const piece = (text: string) =>
      b.emit('assistant.block.delta', { apiMessageId: api('m9'), blockIndex: 0, blockType: 'text', textDelta: text, thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });
    piece('See \u001b]8;;https://ex');
    piece('ample.com\u001b\\docs');
    piece('\u001b]8;;\u001b\\ now.');
    const state = reduce(b.events);
    expect(find(rowsOf(state), 'assistant_text')).toMatchObject({ live: true, markdown: 'See docs now.' });
  });
});

describe('streaming block identity', () => {
  const delta = (b: ReturnType<typeof builder>, apiId: string, index: number, type: 'text' | 'thinking', piece: string) =>
    b.emit('assistant.block.delta', {
      apiMessageId: api(apiId), blockIndex: index, blockType: type, textDelta: type === 'text' ? piece : null, thinkingDelta: type === 'thinking' ? piece : null,
      inputJsonDelta: null, userMessageUuid: null,
    });

  it('a live row exists after the first delta, keeps its id through completion, and later deltas do not re-derive the turn', () => {
    const b = builder();
    b.turn('u1');
    delta(b, 'm1', 0, 'text', 'Hel');
    let state = reduce(b.events);
    const id = turnId.ofMessage(uuid('u1'));
    const afterFirst = rowsOf(state);
    const live = find(afterFirst, 'assistant_text');
    expect(live).toMatchObject({ id: rowId.text(api('m1'), 0), live: true, messageUuid: null, markdown: 'Hel' });
    const version = state.turns.get(id)!.version;

    state = applyEvents(state, [delta(b, 'm1', 0, 'text', 'lo')]);
    expect(state.turns.get(id)!.version).toBe(version);
    expect(state.turns.get(id)!.live.get('m1:0')!.buffer).toBe('Hello');
    const afterSecond = rowsOf(state);
    state = applyEvents(state, [delta(b, 'm1', 0, 'text', ' world')]);
    const afterThird = rowsOf(state);
    expect(afterThird).toBe(afterSecond); // same array reference between the second and third delta

    b.text('m1', 0, 'Hello world');
    state = applyEvents(state, [b.events.at(-1)!]);
    const completed = find(rowsOf(state), 'assistant_text');
    expect(completed).toMatchObject({ id: rowId.text(api('m1'), 0), live: false, messageUuid: uuid('m1-u0'), markdown: 'Hello world' });
    expect(state.turns.get(id)!.version).toBeGreaterThan(version);
  });

  it('the split-envelope gate: a complete carrying a local block index pairs with the earliest uncompleted block of its type', () => {
    const b = builder();
    b.turn('u1');
    delta(b, 'm1', 0, 'thinking', 'Let me think');
    b.thinking('m1', 0, 'Let me think');
    delta(b, 'm1', 1, 'text', 'DONE');
    b.text('m1', 0, 'DONE'); // envelope-local index 0, streamed at index 1
    b.end(['u1']);
    const list = rows(b.events);
    expect(find(list, 'thinking')).toMatchObject({ id: rowId.think(api('m1'), 0), text: 'Let me think', live: false });
    expect(find(list, 'assistant_text')).toMatchObject({ id: rowId.text(api('m1'), 1), markdown: 'DONE', live: false });
    expect(list.filter((row) => row.kind === 'assistant_text')).toHaveLength(1);
  });

  it('a delta with a null api message id takes the turn’s most recent one', () => {
    const b = builder();
    b.turn('u1');
    delta(b, 'm1', 0, 'text', 'a');
    b.emit('assistant.block.delta', { apiMessageId: null, blockIndex: 0, blockType: 'text', textDelta: 'b', thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });
    const state = reduce(b.events);
    expect(state.turns.get(turnId.ofMessage(uuid('u1')))!.live.get('m1:0')!.buffer).toBe('ab');
  });
});

describe('child traffic', () => {
  it('is indexed under the parent tool use and never rendered in the parent', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('agent1', 'Agent', { description: 'Survey', prompt: 'p' });
    b.emit('subagent.started', { taskId: task('task1'), toolUseId: tool('agent1'), description: 'Survey', subagentType: 'general-purpose', isBackground: true, spawnDepth: 1, prompt: null });
    b.emit('tool.use', { toolUseId: tool('c1'), toolName: 'Read', input: { file_path: '/a' }, apiMessageId: api('cm'), messageUuid: null }, { parentToolUseId: 'agent1' as never });
    b.emit('tool.result', { toolUseId: tool('c1'), content: 'x', isError: false, structured: null, spillPath: null, denial: null, safeguard: 'not_evaluated', messageUuid: null }, { parentToolUseId: 'agent1' as never });
    b.emit('subagent.finished', { taskId: task('task1'), status: 'completed', summary: 'ok', outputFile: null, reason: null });
    b.text('m2', 0, 'Summary');
    b.end(['u1']);
    const state = reduce(b.events);
    const turn = state.turns.get(turnId.ofMessage(uuid('u1')))!;
    expect(turn.children.get(tool('agent1'))).toHaveLength(2);
    const list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'user', 'divider', 'subagent', 'assistant_text']);
    expect(find(list, 'subagent')).toMatchObject({ sentence: 'Survey finished', status: 'finished' });
    expect(find(list, 'subagent').agents[0]).toMatchObject({ taskId: 'task1', toolUseId: 'agent1', name: 'Survey', kind: 'agent' });
  });

  it('a child transcript treats its own events as top level', () => {
    const b = builder();
    b.emit('tool.use', { toolUseId: tool('c1'), toolName: 'Read', input: { file_path: '/a' }, apiMessageId: api('cm'), messageUuid: null }, { parentToolUseId: 'agent1' as never });
    b.emit('tool.result', { toolUseId: tool('c1'), content: 'x', isError: false, structured: null, spillPath: null, denial: null, safeguard: 'not_evaluated', messageUuid: null }, { parentToolUseId: 'agent1' as never });
    b.emit('assistant.block.complete', { messageUuid: uuid('cu'), apiMessageId: api('cm2'), blockIndex: 0, block: { type: 'text', text: 'Child answer' }, model: 'm', supersedes: [], aborted: false, userMessageUuids: [] }, { parentToolUseId: 'agent1' as never });
    const state = applyEvents(createState(null, 'agent-1' as never), b.events);
    expect(state.order).toHaveLength(1);
    const list = rowsOf(withAllExpanded(state));
    // the slice never closes its turn; the answer after the read completes the read's group, which unwraps (W1: the
    // answer is in the turn's event order, after the work it follows)
    expect(kinds(list)).toEqual(['time', 'divider', 'cell', 'assistant_text']);
    expect(find(list, 'cell').id).toBe('cell:c1');
  });
});

describe('revisable log', () => {
  it('a real fork stays outside folded work without blaming a second process', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Read', { file_path: '/sample' });
    b.result('t1', 'Sample');
    b.text('m1', 0, 'Previous path');
    b.emit('boundary.retraction', { retractedMessageUuids: [uuid('m1-u0')], reason: 'transcript_branch', fallbackModel: null });
    b.end(['u1']);
    const state = applyEvents(createState(null, null), b.events);
    const folded = rowsOf(state);
    const boundary = find(folded, 'boundary');
    expect(boundary).toMatchObject({ text: 'Conversation continued from an earlier point', secondary: 'Later messages from the previous path are no longer part of the current conversation history', detail: 'transcript_branch · m1-u0' });
    expect(find(rowsOf(withAllExpanded(state)), 'boundary')).toEqual(boundary);
    expect(folded.some((row) => row.kind === 'assistant_text' && row.markdown === 'Previous path')).toBe(false);
    expect(folded.some((row) => row.kind === 'error')).toBe(false);
  });

  it('retraction removes the retracted message’s rows and leaves a boundary at its position', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'Refused answer');
    b.emit('boundary.retraction', { retractedMessageUuids: [uuid('m1-u0')], reason: 'refusal', fallbackModel: 'fallback' });
    b.text('m2', 0, 'Fallback answer');
    b.end(['u1']);
    const list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'user', 'boundary', 'assistant_text']); // W1: a boundary is no work, so this turn has no divider
    expect(list.some((row) => row.kind === 'assistant_text' && row.markdown === 'Refused answer')).toBe(false);
    expect(find(list, 'boundary')).toMatchObject({ boundaryKind: 'retraction', text: 'Response retracted · refusal · switched to fallback' });
  });

  it('supersedes replaces the superseded message’s rows', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'First try');
    b.text('m2', 0, 'Second try', { supersedes: [uuid('m1-u0')] });
    b.end(['u1']);
    const list = rows(b.events);
    expect(list.filter((row) => row.kind === 'assistant_text').map((row) => (row as Extract<Row, { kind: 'assistant_text' }>).markdown)).toEqual(['Second try']);
  });

  // Synthetic until a live refusal fallback is recorded (debt wave 4): the wire names every block frame of the refused
  // attempt, on the replacement's first frame only (SPEC 45), so the list drops all of them and the later frames of the
  // replacement, which name none, stay.
  it('a supersedes list drops every block of the refused attempt, named on the replacement’s first block only', () => {
    const b = builder();
    b.turn('u1');
    b.thinking('m1', 0, 'Refused reasoning');
    b.text('m1', 1, 'Refused answer');
    b.text('m0', 0, 'Unrelated earlier answer');
    b.text('m2', 0, 'Fallback part one', { supersedes: [uuid('m1-u0'), uuid('m1-u1')] });
    b.text('m2', 1, 'Fallback part two');
    b.end(['u1']);
    const list = rows(b.events);
    const texts = list.filter((row) => row.kind === 'assistant_text').map((row) => (row as Extract<Row, { kind: 'assistant_text' }>).markdown);
    expect(texts).toEqual(['Unrelated earlier answer', 'Fallback part one', 'Fallback part two']);
    expect(JSON.stringify(list)).not.toContain('Refused');
  });

  it('compaction and reset are rows between turns, or inside the turn when they arrive mid-turn', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'One');
    b.end(['u1']);
    b.emit('boundary.compaction', { trigger: 'auto', preTokens: 160_000, postTokens: 24_000, logicalParentUuid: null, historical: false });
    b.turn('u2');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'x');
    b.emit('boundary.reset', { newConversationId: 'c2', trigger: 'clear' });
    b.text('m2', 0, 'Two');
    b.end(['u2']);
    const list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'user', 'assistant_text', 'boundary', 'user', 'divider', 'cell', 'boundary', 'assistant_text']);
    expect(find(list, 'boundary', 0)).toMatchObject({ boundaryKind: 'compaction', turnId: null, text: 'Context compacted · 160k → 24k tokens · auto' });
    expect(find(list, 'boundary', 1)).toMatchObject({ boundaryKind: 'reset', turnId: turnId.ofMessage(uuid('u2')) });
  });

  it('rewind hides the rows after the preceding assistant message, keeps them, and reveals them on request', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'One');
    b.end(['u1']);
    b.turn('u2');
    b.text('m2', 0, 'Two');
    b.end(['u2']);
    b.emit('boundary.rewind', { targetMessageUuid: uuid('u2'), precedingAssistantUuid: uuid('m1-u0'), prefillText: 'prompt u2' });
    b.turn('u3');
    b.text('m3', 0, 'Three');
    b.end(['u3']);
    const state = reduce(b.events);
    expect(state.order).toEqual([turnId.ofMessage(uuid('u1')), turnId.ofMessage(uuid('u3'))]);
    expect(state.turns.has(turnId.ofMessage(uuid('u2')))).toBe(true);
    expect(state.hidden).toMatchObject({ fromTurn: turnId.ofMessage(uuid('u2')), rows: 2 });
    const list = rowsOf(state);
    expect(kinds(list)).toEqual(['time', 'user', 'assistant_text', 'boundary', 'user', 'assistant_text']);
    const boundary = find(list, 'boundary');
    expect(boundary).toMatchObject({ boundaryKind: 'rewind', hiddenRows: 2, revealed: false, text: 'Rewound to here · 2 messages hidden · Show' });
    const revealed = { ...state, ui: { ...state.ui, revealedBoundaries: new Set([boundary.id]), version: state.ui.version + 1 } };
    expect(kinds(rowsOf(revealed))).toEqual(['time', 'user', 'assistant_text', 'boundary', 'user', 'assistant_text', 'user', 'assistant_text']);
    expect(find(rowsOf(revealed), 'user', 1)).toMatchObject({ messageUuid: 'u2' }); // the hidden branch follows the boundary, then the live one
    expect(kinds(rowsOf(withAllExpanded(state)))).toEqual(kinds(rowsOf(revealed))); // the snapshot view reveals rewound branches
  });
});

describe('requests', () => {
  it('a pending question is a slot, and the answer replaces it with the historical row at the same position', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('q1', 'AskUserQuestion', { questions: [{ question: 'Which?', header: 'Pick', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }] });
    b.emit('question.requested', { requestId: request('r1'), toolUseId: tool('q1'), questions: [{ question: 'Which?', header: 'Pick', options: [{ label: 'A', description: null, preview: null }, { label: 'B', description: null, preview: null }], multiSelect: false }] });
    let state = reduce(b.events);
    let list = rowsOf(withAllExpanded(state));
    expect(kinds(list)).toEqual(['time', 'user', 'divider', 'request_slot']);
    expect(find(list, 'request_slot')).toMatchObject({ id: rowId.slot(request('r1')), requestKind: 'question', toolName: 'AskUserQuestion' });
    const answered = b.emit('question.answered', { requestId: request('r1'), toolUseId: tool('q1'), answers: { 'Which?': 'A' } });
    state = applyEvents(state, [answered]);
    list = rowsOf(withAllExpanded(state));
    expect(kinds(list)).toEqual(['time', 'user', 'divider', 'question']);
    expect(find(list, 'question')).toMatchObject({ id: rowId.question(tool('q1')), answers: { 'Which?': 'A' } });
    expect(state.pending.size).toBe(0);
  });

  it('a permission resolved by the human marks the tool standalone; abort and exit leave no row', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.emit('permission.requested', { requestId: request('r1'), toolUseId: tool('t1'), toolName: 'Bash', displayName: null, input: {}, description: null, decisionReasonType: null, suggestions: [], blockedPath: null });
    b.emit('permission.resolved', { requestId: request('r1'), toolUseId: tool('t1'), behavior: 'allow', message: null, updatedInput: null, updatedPermissions: [], resolvedBy: 'user' });
    b.result('t1', 'ok');
    b.toolUse('t2', 'Bash', { command: 'pwd' });
    b.emit('permission.requested', { requestId: request('r2'), toolUseId: tool('t2'), toolName: 'Bash', displayName: null, input: {}, description: null, decisionReasonType: null, suggestions: [], blockedPath: null });
    b.emit('permission.resolved', { requestId: request('r2'), toolUseId: tool('t2'), behavior: 'deny', message: null, updatedInput: null, updatedPermissions: [], resolvedBy: 'abort' });
    b.end(['u1'], { terminalReason: 'aborted_streaming' });
    const list = rows(b.events);
    const cells = list.filter((row) => row.kind === 'cell') as Extract<Row, { kind: 'cell' }>[];
    expect(cells[0]).toMatchObject({ toolUseId: 't1', classification: { humanDecision: true, groupable: false } });
    expect(list.some((row) => row.kind === 'request_slot')).toBe(false);
  });

  it('plan requested then resolved yields a plan row with its outcome', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('p1', 'ExitPlanMode', { plan: '# Plan\n1. do' });
    b.emit('plan.requested', { requestId: request('r1'), toolUseId: tool('p1'), plan: '# Plan\n1. do', input: {} });
    b.emit('plan.resolved', { requestId: request('r1'), toolUseId: tool('p1'), outcome: 'keep_planning', feedback: 'More detail' });
    b.end(['u1']);
    expect(find(rows(b.events), 'plan')).toMatchObject({ id: rowId.plan(tool('p1')), plan: '# Plan\n1. do', outcome: 'keep_planning', feedback: 'More detail' });
  });
});

describe('denial disposition', () => {
  it('pairs a user-rejected denial with an aborted turn as an interruption when the turn closes', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'sleep 9' });
    b.result('t1', 'User rejected tool use', { isError: true, denial: 'user-rejected' });
    let state = reduce(b.events);
    let cell = find(rowsOf(withAllExpanded(state)), 'cell');
    expect(cell.classification.denial).toMatchObject({ disposition: 'denied', interruption: false });
    b.end(['u1'], { isError: true, result: 'error_during_execution', terminalReason: 'aborted_streaming' });
    state = applyEvents(state, [b.events.at(-1)!]);
    const list = rowsOf(withAllExpanded(state));
    cell = find(list, 'cell');
    expect(cell.classification.denial).toMatchObject({ disposition: 'stopped', interruption: true });
    expect(cell.status).toBe('stopped');
    expect(cell.label).toBe('Stopped: `sleep 9`');
    expect(find(list, 'divider')).toMatchObject({ state: 'stopped', denied: 0, autoDenied: 0, firstDeniedCell: null });
    expect(find(list, 'divider').summary.denials).toEqual([{ kind: 'user-rejected', cellId: 'cell:t1', disposition: 'stopped', interruption: true }]);
  });

  it('counts denied and auto-denied separately and links the first denied cell', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'a' });
    b.result('t1', 'ok');
    b.toolUse('t2', 'Bash', { command: 'b' });
    b.result('t2', 'Nope', { isError: true, denial: 'permission-rule' });
    b.toolUse('t3', 'Bash', { command: 'c' });
    b.result('t3', 'blocked', { isError: true, denial: 'automode-blocked' });
    b.toolUse('t4', 'Bash', { command: 'd' });
    b.result('t4', 'unreadable', { isError: true, denial: 'automode-parsing-error' });
    b.end(['u1']);
    const list = rows(b.events);
    expect(find(list, 'divider')).toMatchObject({ toolCalls: 4, denied: 1, autoDenied: 2, firstDeniedCell: 'cell:t2' });
    expect(kinds(list)).toEqual(['time', 'user', 'divider', 'cell', 'cell', 'cell', 'cell']);
    const labels = list.filter((row) => row.kind === 'cell').map((row) => (row as Extract<Row, { kind: 'cell' }>).label);
    expect(labels).toEqual(['Ran `a` in 0s', 'Denied: `b` · Nope', 'Auto mode blocked: `c` · blocked', 'Auto mode blocked: `d` · review unreadable']);
  });
});

describe('hydration deduplication', () => {
  it('drops events whose id was already applied and records every applied id in seen', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'Hi');
    b.end(['u1']);
    const once = reduce(b.events);
    const twice = applyEvents(once, b.events);
    expect(twice.seen.size).toBe(b.events.length);
    expect(rowsOf(twice)).toEqual(rowsOf(once));
    expect(twice.turns.get(once.order[0])!.events).toHaveLength(once.turns.get(once.order[0])!.events.length);
  });
});

describe('determinism and sharing', () => {
  it('derives the same rows twice and shares untouched turns between states', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'One');
    b.end(['u1']);
    const first = reduce(b.events);
    const b2 = builder();
    b2.at = b.at;
    b2.turn('u2');
    b2.text('m2', 0, 'Two');
    b2.end(['u2']);
    const more = b2.events.map((event, i) => ({ ...event, id: `x${i}`, seq: b.events.length + i }) as SessionEvent);
    const second = applyEvents(first, more);
    expect(second.turns.get(first.order[0])).toBe(first.turns.get(first.order[0]));
    expect(rowsOf(second)).toEqual(rowsOf(reduce([...b.events, ...more])));
    expect(rowsOf(second)).toEqual(rowsOf(reduce([...b.events, ...more])));
  });

  it('usage samples and the turn’s result fill the summary', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'One');
    b.end(['u1'], { costUsd: 0.5, usage: { ...USAGE, outputTokens: 500 }, durationMs: 134_000 });
    const state = reduce(b.events);
    const turn = state.turns.get(state.order[0])!;
    expect(turn.ended?.costUsd).toBe(0.5);
  });
});

// C12 start: the memory budget's release and its resume in quiet words (C12 execution document, Interfaces "Surfaces of
// the budget", Transcript): a release is a notice, not an error, and the resume after it stays as one line.
describe('a release and the resume after it', () => {
  const texts = (rows: Row[]) => rows.filter((row) => row.kind === 'error').map((row) => [(row as Extract<Row, { kind: 'error' }>).severity, (row as Extract<Row, { kind: 'error' }>).text]);

  it('a budget exit reads as a release, quietly', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'Done.');
    b.emit('process.exited', { code: 0, signal: null, reason: 'budget', lostAttentionCount: 0, budget: { limitKiB: 8_388_608, totalKiB: 9_100_000 } });
    expect(texts(rowsOf(reduce(b.events)))).toEqual([['notice', 'Released to stay under the memory budget · sending resumes it']]);
  });

  it('an idle exit (the supervisor idle clock) reads as a release too, in its own words (E10)', () => {
    const b = builder();
    b.emit('process.exited', { code: 0, signal: null, reason: 'idle', lostAttentionCount: 0, budget: null });
    expect(texts(rowsOf(reduce(b.events)))).toEqual([['notice', 'Stopped while idle · sending resumes it']]);
  });

  it('a process_exit reconnect reads Resuming… and then stays as Resumed; a user reconnect still leaves no row', () => {
    const b = builder();
    b.emit('process.exited', { code: 0, signal: null, reason: 'budget', lostAttentionCount: 0, budget: { limitKiB: 8_388_608, totalKiB: 9_100_000 } });
    b.emit('session.reconnect', { phase: 'attempting', attempt: 1, maxAttempts: 1, trigger: 'process_exit', reason: null });
    expect(texts(rowsOf(reduce(b.events))).at(-1)).toEqual(['transient', 'Resuming…']);
    b.emit('session.reconnect', { phase: 'reconnected', attempt: 1, maxAttempts: 1, trigger: 'process_exit', reason: null });
    expect(texts(rowsOf(reduce(b.events)))).toEqual([
      ['notice', 'Released to stay under the memory budget · sending resumes it'],
      ['notice', 'Resumed'],
    ]);
    const user = builder();
    user.emit('session.reconnect', { phase: 'attempting', attempt: 1, maxAttempts: 1, trigger: 'user', reason: null });
    user.emit('session.reconnect', { phase: 'reconnected', attempt: 1, maxAttempts: 1, trigger: 'user', reason: null });
    expect(texts(rowsOf(reduce(user.events)))).toEqual([]);
  });

  it('a failed resume after a release says why, as any failed reconnect does', () => {
    const b = builder();
    b.emit('session.reconnect', { phase: 'attempting', attempt: 1, maxAttempts: 1, trigger: 'process_exit', reason: null });
    b.emit('session.reconnect', { phase: 'failed', attempt: 1, maxAttempts: 1, trigger: 'process_exit', reason: 'engine binary missing' });
    expect(texts(rowsOf(reduce(b.events)))).toEqual([['error', 'Could not reconnect · engine binary missing']]);
  });
});
// C12 end

// E7 start (E7 execution document, Design §2, §4 and §7; M0's recorded texts): peer.message reaches the turn the derive
// draws from; the activity carries the turn's cron calls and listings on both paths; a Workflow ref names its run.
describe('orchestration facts (E7)', () => {
  const peer = (b: ReturnType<typeof builder>) => b.emit('peer.message', {
    messageUuid: uuid('p1'), from: 'uds:/tmp/cc-socks/1.sock', fromSession: null, fromName: 'repo-b', fromMode: 'prompting', fromPlugin: null,
    hopChain: [], text: 'hello from B', midTurn: false, lineage: 'peer', replyable: true,
  });

  it('routes peer.message onto the current turn, bumping it, and keeps it loose with no turn open', () => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: null, origin: 'peer' });
    b.emit('user.message', { messageUuid: uuid('p1'), content: 'Another Claude session sent a message:\n…', isReplay: true, isSynthetic: true, origin: 'peer', bash: null });
    const before = reduce(b.events);
    const version = before.turns.get(before.order[0]!)!.version;
    const event = peer(b);
    const state = applyEvents(before, [event]);
    const turn = state.turns.get(state.order[0]!)!;
    expect(turn.events.at(-1)).toBe(event);
    expect(turn.version).toBeGreaterThan(version);
    const alone = builder();
    peer(alone);
    expect(reduce(alone.events).loose.map((e) => e.kind)).toEqual(['peer.message']);
  });

  it("records each CronCreate and CronDelete of the turn with its outcome, on the turn's activity", () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('c1', 'CronCreate', { cron: '*/2 * * * *', prompt: 'E7 cron tick', recurring: true });
    b.result('c1', 'Scheduled recurring job 481abb0a (Every 2 minutes). Session-only (not written to disk, dies when Claude exits). Auto-expires after 7 days. Use CronDelete to cancel sooner.');
    b.toolUse('c2', 'CronCreate', { cron: '15 4 6 10 *', prompt: 'E7 one-shot', recurring: false });
    b.result('c2', 'Scheduled one-shot task 8d1a2582 (15 4 6 10 *). Session-only (not written to disk, dies when Claude exits). It will fire once then auto-delete.');
    b.toolUse('c3', 'CronCreate', { cron: '0 9 * * 1', prompt: 'E7 durable weekly', durable: true });
    b.result('c3', 'Scheduled recurring job 598b1690 (Every Monday at 9:00 AM). Persisted to .claude/scheduled_tasks.json. Auto-expires after 7 days. Use CronDelete to cancel sooner.');
    b.toolUse('c4', 'CronCreate', { cron: '* *', prompt: 'bad' });
    b.result('c4', "<tool_use_error>Invalid cron expression '* *'. Expected 5 fields: M H DoM Mon DoW.</tool_use_error>", { isError: true });
    b.toolUse('c5', 'CronCreate', { cron: '0 3 * * *', prompt: 'reworded' });
    b.result('c5', 'A wording no engine wrote.', { structured: { id: '1040f3a5', humanSchedule: 'Every day at 3:00 AM', recurring: true, durable: false } });
    b.toolUse('d1', 'CronDelete', { id: '481abb0a' });
    b.result('d1', 'Cancelled job 481abb0a.');
    b.toolUse('d2', 'CronDelete', { id: 'nope' });
    b.result('d2', 'No job with id nope', { isError: true });
    b.toolUse('c6', 'CronCreate', { cron: '0 0 * * *', prompt: 'pending' });
    b.toolUse('l1', 'CronList', {});
    const [activity] = turnActivity(reduce(b.events));
    expect(activity!.crons.map(({ toolUseId, call, result }) => ({ toolUseId, call, result }))).toEqual([
      { toolUseId: 'c1', call: { kind: 'create', cron: '*/2 * * * *', prompt: 'E7 cron tick', recurring: true, durable: false }, result: { ok: true, id: '481abb0a', humanSchedule: 'Every 2 minutes', durable: false } },
      { toolUseId: 'c2', call: { kind: 'create', cron: '15 4 6 10 *', prompt: 'E7 one-shot', recurring: false, durable: false }, result: { ok: true, id: '8d1a2582', humanSchedule: '15 4 6 10 *', durable: false } },
      { toolUseId: 'c3', call: { kind: 'create', cron: '0 9 * * 1', prompt: 'E7 durable weekly', recurring: true, durable: true }, result: { ok: true, id: '598b1690', humanSchedule: 'Every Monday at 9:00 AM', durable: true } },
      { toolUseId: 'c4', call: { kind: 'create', cron: '* *', prompt: 'bad', recurring: true, durable: false }, result: { ok: false, text: "<tool_use_error>Invalid cron expression '* *'. Expected 5 fields: M H DoM Mon DoW.</tool_use_error>" } },
      { toolUseId: 'c5', call: { kind: 'create', cron: '0 3 * * *', prompt: 'reworded', recurring: true, durable: false }, result: { ok: true, id: '1040f3a5', humanSchedule: 'Every day at 3:00 AM', durable: false } },
      { toolUseId: 'd1', call: { kind: 'delete', id: '481abb0a' }, result: { ok: true } },
      { toolUseId: 'd2', call: { kind: 'delete', id: 'nope' }, result: { ok: false, text: 'No job with id nope' } },
      { toolUseId: 'c6', call: { kind: 'create', cron: '0 0 * * *', prompt: 'pending', recurring: true, durable: false }, result: null },
    ]);
    expect(activity!.crons[0]!.at).toBe(b.events.find((e) => e.kind === 'tool.use' && e.toolUseId === 'c1')!.at);
  });

  it('records each ListAgents listing of the turn, parsed once its result arrives; a child lane adds none', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('l1', 'ListAgents', {});
    expect(turnActivity(reduce(b.events))[0]!.listings.map((l) => [l.toolUseId, l.parsed])).toEqual([['l1', null]]);
    b.result('l1', 'This session is repo-a [804260] — the name other sessions use to message it (it is not listed below; a message to it would be a message to yourself).\n\nPeer sessions (1):\n  repo-b [61303a]  ·  interactive  ·  idle  ·  started 2s ago');
    b.emit('tool.use', { toolUseId: tool('child-l'), toolName: 'ListAgents', input: {}, apiMessageId: null, messageUuid: null }, { parentToolUseId: parent('l1') });
    b.emit('tool.use', { toolUseId: tool('child-c'), toolName: 'CronCreate', input: { cron: '* * * * *', prompt: 'x' }, apiMessageId: null, messageUuid: null }, { parentToolUseId: parent('l1') });
    const [activity] = turnActivity(reduce(b.events));
    expect(activity!.listings).toEqual([{
      toolUseId: 'l1', at: b.events.find((e) => e.kind === 'tool.use')!.at,
      parsed: { self: 'repo-a [804260]', sections: [{ title: 'Peer sessions', count: 1, rows: [{ name: 'repo-b', ref: '61303a', extras: ['interactive', 'idle', 'started 2s ago'] }] }], notes: [] },
    }]);
    expect(activity!.crons).toEqual([]);
  });

  it('leaves out a call whose message was retracted or superseded, as the rest of the activity does', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('c1', 'CronCreate', { cron: '0 3 * * *', prompt: 'refused attempt' });
    b.emit('boundary.retraction', { retractedMessageUuids: [uuid('msg-c1-u0')], reason: 'model refusal', fallbackModel: null });
    b.toolUse('l1', 'ListAgents', {});
    b.toolUse('c2', 'CronCreate', { cron: '0 4 * * *', prompt: 'kept' });
    b.emit('assistant.block.complete', {
      messageUuid: uuid('m3-u0'), apiMessageId: api('m3'), blockIndex: 0, block: { type: 'text', text: 'again' }, model: 'claude-test',
      supersedes: [uuid('msg-l1-u0')], aborted: false, userMessageUuids: [],
    });
    const [activity] = turnActivity(reduce(b.events));
    expect(activity!.crons.map((c) => c.toolUseId)).toEqual(['c2']);
    expect(activity!.listings).toEqual([]);
  });

  const WORKFLOW_RESULT = { status: 'async_launched', taskId: 'wayue3on6', taskType: 'local_workflow', workflowName: 'maws-probe', runId: 'wf_7cacbb2d-902', summary: 'Two echo agents in one phase' }; // pass2/workflow seq 80

  it("names a disk-only Workflow ref's task and run from its launch result, keeping the row's id", () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_wf', 'Workflow', { description: 'Two echo agents in one phase' });
    b.result('toolu_wf', 'Workflow launched in the background.', { structured: WORKFLOW_RESULT });
    b.emit('workflow.progress', { taskId: task('wayue3on6'), workflowName: 'maws-probe', progress: [{ type: 'workflow_phase', index: 0, title: 'Echo', status: 'running' }] });
    const state = reduce(b.events);
    expect(turnActivity(state)[0]!.subagents).toEqual([expect.objectContaining({ taskId: 'wayue3on6', runId: 'wf_7cacbb2d-902', toolUseId: 'toolu_wf', kind: 'workflow', status: 'working' })]);
    const row = find(rowsOf(withAllExpanded(state)), 'subagent');
    expect(row.id).toBe(rowId.subagent(task('toolu_wf')));
    expect(row.agents[0]).toMatchObject({ taskId: 'wayue3on6', runId: 'wf_7cacbb2d-902' });
  });

  it('adds the run id to a live Workflow ref its task.started already renamed', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_wf', 'Workflow', { description: 'Two echo agents in one phase' });
    b.emit('task.started', { taskId: task('wayue3on6'), toolUseId: tool('toolu_wf'), taskType: 'local_workflow', description: 'Two echo agents in one phase', isBackground: true, workflowName: 'maws-probe' });
    b.result('toolu_wf', 'Workflow launched in the background.', { structured: WORKFLOW_RESULT });
    const state = reduce(b.events);
    expect(turnActivity(state)[0]!.subagents).toEqual([expect.objectContaining({ taskId: 'wayue3on6', runId: 'wf_7cacbb2d-902', status: 'started' })]);
    expect(find(rowsOf(withAllExpanded(state)), 'subagent').id).toBe(rowId.subagent(task('wayue3on6')));
  });
});
// E7 end
