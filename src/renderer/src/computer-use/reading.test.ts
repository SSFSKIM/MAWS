// The computer-use plugin's calls as the session's transcript shows them (the UX wave's U12a, Interfaces §E): which
// turn matters now, whether it runs, and each call's state, over the main agent's events and a subagent's, on the live
// wire and from a terminal session's transcript file alike.
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { ToolUseId } from '@shared/graph/ids';
import { loadJournal, type FixturePass } from '../../../../test/support/fixtures';
import { freshSource, subagentLookupOf } from '../lane-a/plane-transcript';
import { createTranscriptStore } from '../stores/transcript';
import { journalToEvents } from '../transcript/dev/journal';
import { applyEvents, createState, type TranscriptState } from '../transcript/model/reduce';
import { builder, parent, tool, uuid, type Builder } from '../transcript/model/test-events';
import { readComputerUse } from './reading';

const JS = 'mcp__plugin_cua_cua_repl__js';
const JS_BARE = 'mcp__cua_repl__js';
const NONE: ReadonlySet<ToolUseId> = new Set();
const MARKER = '[Request interrupted by user for tool use]';
const REJECTED = "The user doesn't want to proceed with this tool use. The tool use was rejected.";

const stateOf = (b: Builder): TranscriptState => applyEvents(createState(null, null), b.events);
const calls = (state: TranscriptState | null, waiting: ReadonlySet<ToolUseId> = NONE, runs = true) => readComputerUse(state, waiting, runs).calls.map((c) => [c.toolUseId, c.tool, c.state]);
const marker = (b: Builder) => b.emit('user.message', { messageUuid: uuid(`marker-${b.events.length}`), content: [{ type: 'text', text: MARKER }], isReplay: false, isSynthetic: false, origin: null, bash: null });

describe('the computer-use calls of a session', () => {
  it('reads nothing without a transcript, and nothing of a turn with no computer-use call', () => {
    expect(readComputerUse(null, NONE, true)).toEqual({ turn: null, running: false, calls: [] });
    const b = builder();
    b.turn('u1');
    b.toolUse('r1', 'Read', { file_path: '/tmp/a' });
    const state = stateOf(b);
    expect(readComputerUse(state, NONE, true)).toEqual({ turn: state.order[0], running: true, calls: [] });
  });

  it('reads the main agent’s call in flight in the running turn, under both server names, and a result ends it', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('j1', JS, { code: '1' });
    let state = stateOf(b);
    expect(readComputerUse(state, NONE, true)).toMatchObject({ turn: state.order[0], running: true });
    expect(calls(state)).toEqual([['j1', 'js', 'flight']]);
    b.result('j1', 'ok');
    b.toolUse('j2', JS_BARE, { code: '2' });
    state = stateOf(b);
    expect(calls(state)).toEqual([['j1', 'js', 'done'], ['j2', 'js', 'flight']]);
  });

  it('reads a subagent’s call, which the turn keeps among its children, in the order the calls started', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('a1', 'Agent', { description: 'look', prompt: 'look' });
    b.toolUse('j1', JS, { code: 'main' });
    b.emit('tool.use', { toolUseId: tool('j2'), toolName: JS, input: { code: 'child' }, apiMessageId: null, messageUuid: null }, { parentToolUseId: parent('a1') });
    let state = stateOf(b);
    expect(state.turns.get(state.order[0])!.children.get(tool('a1'))).toHaveLength(1);
    expect(calls(state)).toEqual([['j1', 'js', 'flight'], ['j2', 'js', 'flight']]);
    b.emit('tool.result', { toolUseId: tool('j2'), content: 'ok', isError: false, structured: null, spillPath: null, denial: null, safeguard: 'not_evaluated', messageUuid: null }, { parentToolUseId: parent('a1') });
    state = stateOf(b);
    expect(calls(state)).toEqual([['j1', 'js', 'flight'], ['j2', 'js', 'done']]);
  });

  it('reads js_reset and end_task with their own tool, never as js', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('r1', 'mcp__plugin_cua_cua_repl__js_reset', {});
    b.result('r1', 'reset');
    b.toolUse('e1', 'mcp__cua_repl__end_task', {});
    b.toolUse('x1', 'mcp__plugin_cua_cua_repl__other', {});
    expect(calls(stateOf(b))).toEqual([['r1', 'reset', 'done'], ['e1', 'end', 'flight']]);
  });

  it('reads a call waiting while a waiting permission item names it, and not for another call’s item', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('j1', JS, { code: '1' });
    const state = stateOf(b);
    expect(calls(state, new Set([tool('j1')]))).toEqual([['j1', 'js', 'waiting']]);
    expect(calls(state, new Set([tool('other')]))).toEqual([['j1', 'js', 'flight']]);
  });

  it('reads a call withdrawn at a user-rejected result, at an error result the interruption marker follows, and at its turn’s close with no result', () => {
    const rejected = builder();
    rejected.turn('u1');
    rejected.toolUse('j1', JS, { code: '1' });
    rejected.result('j1', REJECTED, { isError: true, denial: 'user-rejected' });
    expect(calls(stateOf(rejected))).toEqual([['j1', 'js', 'withdrawn']]);

    const marked = builder();
    marked.turn('u1');
    marked.toolUse('j1', JS, { code: '1' });
    marked.result('j1', REJECTED, { isError: true }); // a transcript file's row carries no denial
    expect(calls(stateOf(marked))).toEqual([['j1', 'js', 'failed']]); // until the marker's row arrives
    marker(marked);
    expect(calls(stateOf(marked))).toEqual([['j1', 'js', 'withdrawn']]);

    const closed = builder();
    closed.turn('u1');
    closed.toolUse('j1', JS, { code: '1' });
    closed.end(['u1']);
    const state = stateOf(closed);
    expect(readComputerUse(state, NONE, true)).toMatchObject({ turn: state.order[0], running: false });
    expect(calls(state)).toEqual([['j1', 'js', 'withdrawn']]);
  });

  it('reads an error result with no marker after it as failed, apart from an ordinary result, which is done', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('j1', JS, { code: 'throw 1' });
    b.result('j1', 'Error: 1', { isError: true });
    b.toolUse('j2', JS, { code: '2' });
    b.result('j2', 'ok');
    b.toolUse('j3', JS, { code: '' });
    b.result('j3', 'js expects non-empty JavaScript source', { isError: true }); // the plugin's answer before it queues a cell
    b.end(['u1']);
    expect(calls(stateOf(b))).toEqual([['j1', 'js', 'failed'], ['j2', 'js', 'done'], ['j3', 'js', 'failed']]);
  });

  it('withdraws only the calls an interruption cut: a js call that ended with an error before an interrupted Bash call stays failed', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('j1', JS, { code: 'page.click()' });
    b.result('j1', 'ReferenceError: page is not defined', { isError: true });
    b.toolUse('b1', 'Bash', { command: 'sleep 30' });
    b.result('b1', REJECTED, { isError: true }); // a transcript file's row: no denial
    marker(b);
    b.end(['u1']);
    expect(calls(stateOf(b))).toEqual([['j1', 'js', 'failed']]);
  });

  it('withdraws every error result the interruption wrote together, up to the last event before them that is not a result', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('j0', JS, { code: '0' });
    b.result('j0', 'Error: 0', { isError: true });
    b.toolUse('j1', JS, { code: '1' }, 'msg-pair', 0);
    b.toolUse('j2', JS, { code: '2' }, 'msg-pair', 1);
    b.result('j1', REJECTED, { isError: true });
    b.result('j2', REJECTED, { isError: true });
    marker(b);
    expect(calls(stateOf(b))).toEqual([['j0', 'js', 'failed'], ['j1', 'js', 'withdrawn'], ['j2', 'js', 'withdrawn']]);
  });

  it('in a subagent’s list, the turn’s marker withdraws only the trailing error results, not one an event of another kind follows', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('a1', 'Agent', { description: 'act', prompt: 'act' });
    const inChild = { parentToolUseId: parent('a1') };
    const childUse = (id: string) => b.emit('tool.use', { toolUseId: tool(id), toolName: JS, input: { code: id }, apiMessageId: null, messageUuid: null }, inChild);
    const childError = (id: string, content: string) => b.emit('tool.result', { toolUseId: tool(id), content, isError: true, structured: null, spillPath: null, denial: null, safeguard: 'not_evaluated', messageUuid: null }, inChild);
    childUse('j1');
    childError('j1', 'ReferenceError: page is not defined'); // over: the child's next call follows it
    childUse('j2');
    childError('j2', REJECTED); // the interruption's
    b.result('a1', REJECTED, { isError: true });
    marker(b);
    expect(calls(stateOf(b))).toEqual([['j1', 'js', 'failed'], ['j2', 'js', 'withdrawn']]);
  });

  it('reads no running turn when the store or the controls port says the turn is not running: the open turn reads closed', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('j1', JS, { code: '1' });
    const state = stateOf(b);
    expect(readComputerUse(state, NONE, false)).toMatchObject({ turn: state.order[0], running: false });
    expect(calls(state, NONE, false)).toEqual([['j1', 'js', 'withdrawn']]);
  });

  it('reads a prompt not yet accepted as no running turn: the latest turn with a call is the one that matters', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('j1', JS, { code: '1' });
    b.result('j1', 'ok');
    b.end(['u1']);
    b.turn('u2');
    b.end(['u2']);
    b.emit('user.message', { messageUuid: uuid('u3'), content: 'queued', isReplay: false, isSynthetic: false, origin: 'human', bash: null }); // written, not started
    const state = stateOf(b);
    expect(state.order).toHaveLength(3);
    expect(readComputerUse(state, NONE, true)).toEqual({ turn: state.order[0], running: false, calls: [{ toolUseId: 'j1', tool: 'js', state: 'done' }] });
  });

  it('reads the running turn even with no call yet, so an earlier turn’s calls are not the running one’s', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('j1', JS, { code: '1' });
    b.result('j1', 'ok');
    b.end(['u1']);
    b.turn('u2');
    const state = stateOf(b);
    expect(readComputerUse(state, NONE, true)).toEqual({ turn: state.order[1], running: true, calls: [] });
  });

  it('keeps the running turn’s call in flight when a prompt queued behind it is cancelled, discarded or refused', () => {
    for (const dropped of ['cancelled', 'discarded', 'refused'] as const) {
      const b = builder();
      b.turn('u1');
      b.toolUse('j1', JS, { code: '1' });
      b.emit('user.message', { messageUuid: uuid('u2'), content: 'queued', isReplay: false, isSynthetic: false, origin: 'human', bash: null }); // written, not started
      b.emit('command.lifecycle', { commandUuid: uuid('u2'), state: dropped }); // its turn closes, never accepted
      const state = stateOf(b);
      expect(state.turns.get(state.order[1])!, dropped).toMatchObject({ state: 'closed', accepted: false });
      expect(readComputerUse(state, NONE, true), dropped).toEqual({ turn: state.order[0], running: true, calls: [{ toolUseId: 'j1', tool: 'js', state: 'flight' }] });
    }
  });

  it('is memoised on its inputs, and a batch that leaves the turn alone keeps its calls by reference', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('j1', JS, { code: '1' });
    b.result('j1', 'ok');
    b.end(['u1']);
    const state = stateOf(b);
    const first = readComputerUse(state, NONE, true);
    expect(readComputerUse(state, NONE, true)).toBe(first);
    b.emit('user.message', { messageUuid: uuid('u2'), content: 'queued', isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    const next = applyEvents(state, b.events.slice(-1));
    expect(next.turns.get(state.order[0])).toBe(state.turns.get(state.order[0]));
    expect(readComputerUse(next, NONE, true).calls).toBe(first.calls);
  });
});

// A terminal session's transcript file, as the engine writes it (shapes as `lane-a/source/interrupt.test.ts` builds
// them), mapped through MAWS's backfill: the same calls read the same way as on the live wire.
describe('a terminal session’s transcript file', () => {
  const SESSION = 'sess-cu';
  let n = 0;
  const envelope = (second: number) => ({ uuid: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, parentUuid: null, timestamp: `2026-11-12T10:00:${String(second).padStart(2, '0')}.000Z`, sessionId: SESSION, isSidechain: false, userType: 'external', cwd: '/work', version: '2.1.322' });
  const prompt = (text: string): JsonObject => ({ ...envelope(0), type: 'user', origin: { kind: 'human' }, promptId: 'p1', message: { role: 'user', content: text } });
  const call = (id: string, second: number): JsonObject => ({ ...envelope(second), type: 'assistant', message: { id: `msg_${id}`, role: 'assistant', model: 'claude-test', type: 'message', content: [{ type: 'tool_use', id, name: JS, input: { code: '1' } }], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
  const result = (id: string, content: string, isError: boolean, second: number): JsonObject => ({ ...envelope(second), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });
  const markerRow = (second: number): JsonObject => ({ ...envelope(second), type: 'user', entrypoint: 'cli', promptId: 'p1', message: { role: 'user', content: [{ type: 'text', text: MARKER }] } });

  it('gives the reading the live wire gives: a call done, then a call withdrawn by an interrupt', async () => {
    const store = createTranscriptStore();
    const rows = [prompt('Act in the app'), call('toolu_cu01', 1), result('toolu_cu01', 'ok', false, 2), call('toolu_cu02', 3), result('toolu_cu02', REJECTED, true, 4), markerRow(4)];
    await store.getState().attach('file', freshSource(rows, SESSION, subagentLookupOf([])), { agentId: null as never });
    const fromFile = store.getState().entries.file.state;

    const live = builder();
    live.turn('u1');
    live.toolUse('toolu_cu01', JS, { code: '1' });
    live.result('toolu_cu01', 'ok');
    live.toolUse('toolu_cu02', JS, { code: '1' });
    live.result('toolu_cu02', REJECTED, { isError: true, denial: 'user-rejected' });
    marker(live);
    live.end(['u1']);

    const expected = [['toolu_cu01', 'js', 'done'], ['toolu_cu02', 'js', 'withdrawn']];
    expect(calls(fromFile)).toEqual(expected);
    expect(calls(stateOf(live))).toEqual(expected);
    expect(readComputerUse(fromFile, NONE, true).running).toBe(readComputerUse(stateOf(live), NONE, true).running);
  });
});

// The interruption's shape on the wire (project rule: a wire claim is checked against a recorded journal): the engine
// writes the cut calls' error results and then its marker, with nothing between, and every call answered before the
// interrupt keeps the result it had. Recorded calls are Bash and MAWS's own tools, so the check renames them to the
// plugin's `js` and drops their denials (as a transcript file's rows carry none): the marker alone must then withdraw
// exactly the cut calls.
describe('an interruption as the engine records it', () => {
  const isMarkerEvent = (e: SessionEvent) => e.kind === 'user.message' && JSON.stringify(e.content).includes('[Request interrupted by user');
  const recorded = (pass: FixturePass, name: string) => {
    const state = applyEvents(createState(null, null), journalToEvents(loadJournal(pass, name)));
    const turn = state.order.map((id) => state.turns.get(id)!).find((t) => t.events.some(isMarkerEvent))!;
    return { state, turn };
  };
  const cutBy = (events: readonly SessionEvent[]) => {
    const at = events.findIndex(isMarkerEvent);
    let start = at;
    while (start > 0 && events[start - 1].kind === 'tool.result') start--;
    return { at, results: events.slice(start, at).map((e) => (e.kind === 'tool.result' ? e.toolUseId : null)) };
  };

  for (const [pass, name, cut, answered] of [
    ['pass1', 'queue-and-interrupt', 4, 0],
    ['pass3', 'p1-maws-ask-interrupt', 1, 1],
  ] as const) {
    it(`${pass}/${name}: the cut calls' error results stand right before the marker, and the marker withdraws them alone`, () => {
      const { state, turn } = recorded(pass, name);
      const { at, results } = cutBy(turn.events);
      expect(at).toBeGreaterThan(0);
      const uses = turn.events.flatMap((e) => (e.kind === 'tool.use' ? [e.toolUseId] : []));
      const resultIndex = (id: ToolUseId) => turn.events.findIndex((e) => e.kind === 'tool.result' && e.toolUseId === id);
      expect(results).toHaveLength(cut);
      expect(new Set(results)).toEqual(new Set(uses.filter((id) => resultIndex(id) >= at - cut))); // every call with no result before the interrupt, and no other
      expect(uses.length - cut).toBe(answered);

      const asJs = (event: SessionEvent): SessionEvent =>
        event.kind === 'tool.use' ? { ...event, toolName: JS } : event.kind === 'tool.result' ? { ...event, denial: null } : event;
      const renamed = { ...state, turns: new Map([...state.turns].map(([id, t]) => [id, { ...t, events: t.events.map(asJs) }])) };
      const read = readComputerUse(renamed, NONE, false);
      expect(read.turn).toBe(turn.id);
      const byId = new Map(read.calls.map((c) => [c.toolUseId, c.state]));
      for (const id of results) expect(byId.get(id!), id!).toBe('withdrawn');
      for (const id of uses.filter((u) => !results.includes(u))) expect(byId.get(id), id).not.toBe('withdrawn');
    });
  }
});
