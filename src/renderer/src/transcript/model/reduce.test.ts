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
import { api, builder, request, task, tool, uuid, USAGE } from './test-events';

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
  // `command_lifecycle started`, nothing folds into a running turn, and a prompt the engine drops closes without work.
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

  it('a local-command echo never opens a turn and renders as a local_command row, tags stripped, loose outside a turn and in the work area inside one', () => {
    const b = builder();
    b.emit('user.message', { messageUuid: uuid('lc1'), content: '<local-command-stdout>Set model to `opus`</local-command-stdout>', isReplay: true, isSynthetic: false, origin: 'local-command', bash: null });
    let state = reduce(b.events);
    expect(state.order).toEqual([]);
    let list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'local_command']);
    expect(find(list, 'local_command')).toMatchObject({ id: rowId.local(uuid('lc1')), messageUuid: 'lc1', text: 'Set model to `opus`', turnId: null });
    // Untagged by C4's backfill: the wrapper is still recognised.
    b.emit('user.message', { messageUuid: uuid('lc2'), content: '<local-command-stdout>Set model to `sonnet`</local-command-stdout>', isReplay: true, isSynthetic: false, origin: null, bash: null });
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'ok');
    b.emit('user.message', { messageUuid: uuid('lc3'), content: '<local-command-stdout>Set model to `haiku`</local-command-stdout>', isReplay: true, isSynthetic: false, origin: 'local-command', bash: null });
    b.text('m1', 0, 'Done');
    b.end(['u1']);
    state = reduce(b.events);
    expect(state.order).toEqual([turnId.ofMessage(uuid('u1'))]);
    list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'local_command', 'local_command', 'user', 'divider', 'cell', 'local_command', 'assistant_text']);
    expect(find(list, 'local_command', 2)).toMatchObject({ turnId: turnId.ofMessage(uuid('u1')), text: 'Set model to `haiku`' });
    expect(find(list, 'user').text).toBe('prompt u1');
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
    b.emit('assistant.block.complete', { messageUuid: uuid('cu'), apiMessageId: api('cm2'), blockIndex: 0, block: { type: 'text', text: 'Child answer' }, model: 'm', supersedes: null, aborted: false, userMessageUuids: [] }, { parentToolUseId: 'agent1' as never });
    const state = applyEvents(createState(null, 'agent-1' as never), b.events);
    expect(state.order).toHaveLength(1);
    const list = rowsOf(withAllExpanded(state));
    expect(kinds(list)).toEqual(['time', 'divider', 'group', 'assistant_text']); // the slice never closes its turn, so its group stays active
    expect(find(list, 'group').cells[0].id).toBe('cell:c1');
  });
});

describe('revisable log', () => {
  it('retraction removes the retracted message’s rows and leaves a boundary at its position', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'Refused answer');
    b.emit('boundary.retraction', { retractedMessageUuids: [uuid('m1-u0')], reason: 'refusal', fallbackModel: 'fallback' });
    b.text('m2', 0, 'Fallback answer');
    b.end(['u1']);
    const list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'user', 'divider', 'boundary', 'assistant_text']);
    expect(list.some((row) => row.kind === 'assistant_text' && row.markdown === 'Refused answer')).toBe(false);
    expect(find(list, 'boundary')).toMatchObject({ boundaryKind: 'retraction', text: 'Response retracted · refusal · switched to fallback' });
  });

  it('supersedes replaces the superseded message’s rows', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'First try');
    b.text('m2', 0, 'Second try', { supersedes: uuid('m1-u0') });
    b.end(['u1']);
    const list = rows(b.events);
    expect(list.filter((row) => row.kind === 'assistant_text').map((row) => (row as Extract<Row, { kind: 'assistant_text' }>).markdown)).toEqual(['Second try']);
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
