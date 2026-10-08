// E13 (the in-app browser spec of 2026-10-08, "Action rows"): what an agent did in the in-app browser through
// cua_repl, attached to the session's `js` call it happened under. The attachment rule (in flight, else the latest of
// the turn, else standalone), the js calls and turns a transcript state holds, the classification that keeps a `js`
// call out of an MCP group, and the standalone rows placed in the flat list by time.
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import { describe, expect, it } from 'vitest';
import { attachBrowserActivity, attachmentOf, browserActivityRow, turnSpansOf, withBrowserActivityRows, type BrowserActivityEntry, type TurnSpan } from './browser-activity';
import { classifyTool, CUA_JS_TOOLS, isCuaJsTool, presentationOf } from './classify';
import { rowsOf, withAllExpanded } from './derive';
import { applyEvents, createState } from './reduce';
import type { Row, RowId, TurnId } from './rows';
import { builder, tool, uuid } from './test-events';

const APP = 'app-e13' as AppSessionId;
const OTHER = 'app-other' as AppSessionId;
const TAB = 'b_000000000001';
const T0 = Date.parse('2026-10-08T10:00:00.000Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const ms = (s: number) => T0 + s * 1000;
const call = (id: string, start: number, end: number | null) => ({ toolUseId: id as ToolUseId, startedAt: ms(start), endedAt: end === null ? null : ms(end) });
const turn = (id: string, start: number, end: number | null, calls: ReturnType<typeof call>[]): TurnSpan => ({ turnId: id as TurnId, startedAt: ms(start), endedAt: end === null ? null : ms(end), calls });
let seq = 0;
const activity = (s: number, over: Partial<BrowserActivityEntry> = {}): BrowserActivityEntry => ({ seq: ++seq, appSessionId: APP, tabId: TAB, at: at(s), activity: { kind: 'screenshot' }, ...over });
const attachedTo = (result: ReturnType<typeof attachBrowserActivity>, id: string) => (result.byCall.get(id as ToolUseId) ?? []).map((entry) => entry.seq);

describe('attaching an activity to a js call', () => {
  it('attaches to the call in flight: started at or before it, with no result yet', () => {
    const a = activity(5);
    const result = attachBrowserActivity(APP, [turn('t1', 0, null, [call('c1', 1, 3), call('c2', 4, null)])], [a]);
    expect(attachedTo(result, 'c2')).toEqual([a.seq]);
    expect(result.standalone).toEqual([]);
  });

  it('attaches to the call that ended at or after it, not to a later call of the turn', () => {
    const a = activity(3);
    const edge = activity(5); // the result's own instant still counts as in flight
    const result = attachBrowserActivity(APP, [turn('t1', 0, null, [call('c1', 1, 5), call('c2', 6, 9)])], [a, edge]);
    expect(attachedTo(result, 'c1')).toEqual([a.seq, edge.seq]);
    expect(attachedTo(result, 'c2')).toEqual([]);
  });

  it('else attaches to the latest call of its turn started before it (a download completing after the call returned)', () => {
    const between = activity(5);
    const after = activity(12);
    const result = attachBrowserActivity(APP, [turn('t1', 0, null, [call('c1', 1, 3), call('c2', 6, 9)])], [between, after]);
    expect(attachedTo(result, 'c1')).toEqual([between.seq]);
    expect(attachedTo(result, 'c2')).toEqual([after.seq]);
  });

  it('is standalone when no call of its turn started before it, outside any turn, or after the turn closed', () => {
    const before = activity(1); // the turn's only call starts later
    const between = activity(25); // after turn 1 closed, before turn 2 started
    const afterAll = activity(60); // after the last turn closed (the 30 s dialog default)
    const noCalls = activity(35); // in a turn with no js call
    const turns = [turn('t1', 0, 20, [call('c1', 2, 10)]), turn('t2', 30, 40, [])];
    const result = attachBrowserActivity(APP, turns, [before, between, afterAll, noCalls]);
    expect(result.byCall.size).toBe(0);
    expect(result.standalone.map((entry) => entry.seq)).toEqual([before.seq, between.seq, afterAll.seq, noCalls.seq]);
  });

  it('never reaches across turns: a call of an earlier turn does not take a later turn’s activity', () => {
    const a = activity(35);
    const result = attachBrowserActivity(APP, [turn('t1', 0, 20, [call('c1', 2, 10)]), turn('t2', 30, null, [])], [a]);
    expect(result.standalone.map((entry) => entry.seq)).toEqual([a.seq]);
  });

  it('ignores another session’s activity', () => {
    const mine = activity(5);
    const theirs = activity(5, { appSessionId: OTHER });
    const theirsLoose = activity(50, { appSessionId: OTHER });
    const result = attachBrowserActivity(APP, [turn('t1', 0, 20, [call('c1', 1, null)])], [mine, theirs, theirsLoose]);
    expect(attachedTo(result, 'c1')).toEqual([mine.seq]);
    expect(result.standalone).toEqual([]);
  });
});

describe('the js calls and turns of a transcript', () => {
  it('reads each turn’s span and its cua_repl js calls (both names), a call with no result ending with its closed turn', () => {
    const b = builder('2026-10-08T10:00:00.000Z');
    b.turn('u1');
    b.toolUse('j1', 'mcp__plugin_cua_cua_repl__js', { code: 'await cua.getBrowser()' });
    b.result('j1', 'ok');
    b.toolUse('r1', 'Read', { file_path: '/tmp/a' });
    b.result('r1', 'a');
    b.toolUse('j2', 'mcp__cua_repl__js', { code: 'await tab.goto()' }); // registered by hand; never answered
    b.end(['u1']);
    b.turn('u2');
    b.toolUse('j3', 'mcp__plugin_cua_cua_repl__js', { code: '1' });
    const state = applyEvents(createState(null, null), b.events);
    const spans = turnSpansOf(state);
    expect(spans).toHaveLength(2);
    const [first, second] = spans;
    expect(first.calls.map((c) => c.toolUseId)).toEqual(['j1', 'j2']);
    const ended = Date.parse(state.turns.get(first.turnId)!.endedAt!);
    expect(first.endedAt).toBe(ended);
    expect(first.calls[1].endedAt).toBe(ended); // not in flight forever
    expect(first.calls[0].endedAt).toBeLessThan(first.calls[1].startedAt);
    expect(second.endedAt).toBeNull();
    expect(second.calls.map((c) => [c.toolUseId, c.endedAt])).toEqual([['j3', null]]);
  });

  it('leaves out a prompt still waiting for the engine, so the running turn keeps its later activity', () => {
    const b = builder('2026-10-08T10:00:00.000Z');
    b.turn('u1');
    b.toolUse('j1', 'mcp__plugin_cua_cua_repl__js', { code: '1' });
    b.result('j1', 'ok');
    b.emit('user.message', { messageUuid: uuid('u2'), content: 'queued', isReplay: false, isSynthetic: false, origin: 'human', bash: null }); // written, not started
    const state = applyEvents(createState(null, null), b.events);
    expect(state.order).toHaveLength(2);
    expect(turnSpansOf(state).map((span) => span.calls.map((c) => c.toolUseId))).toEqual([['j1']]);
    const late = activity(3600);
    expect(attachmentOf(state, APP, [late]).byCall.get(tool('j1'))).toEqual([late]);
  });

  it('memoises the attachment on the state and the activity list, and keeps unchanged lists by reference', () => {
    const b = builder('2026-10-08T10:00:00.000Z');
    b.turn('u1');
    b.toolUse('j1', 'mcp__plugin_cua_cua_repl__js', { code: '1' });
    const state = applyEvents(createState(null, null), b.events);
    const list = [activity(1), activity(3600)];
    const first = attachmentOf(state, APP, list);
    expect(attachmentOf(state, APP, list)).toBe(first);
    expect(first.byCall.get(tool('j1'))!.map((e) => e.seq)).toEqual([list[0].seq, list[1].seq]); // the turn is open: the call is still in flight
    // a new state with the same attachment keeps the same arrays, so a row reading them does not re-render
    b.text('m1', 0, 'thinking about it');
    const next = applyEvents(state, b.events.slice(-1));
    const second = attachmentOf(next, APP, list);
    expect(second.byCall.get(tool('j1'))).toBe(first.byCall.get(tool('j1')));
    expect(second.standalone).toBe(first.standalone);
  });
});

describe('the classification of a cua_repl js call', () => {
  it('is a standalone MCP cell under both of its names, never folded into a group; the browser tools keep their row', () => {
    expect(CUA_JS_TOOLS).toEqual(['mcp__plugin_cua_cua_repl__js', 'mcp__cua_repl__js']);
    for (const name of CUA_JS_TOOLS) {
      expect(isCuaJsTool(name)).toBe(true);
      expect(presentationOf(name)).toBe('cell');
      const c = classifyTool(name, {}, { denial: null, terminalReason: null, turnClosed: false, humanDecision: false, safeguard: 'not_evaluated', imageResult: false, isError: false });
      expect(c.groupable).toBe(false);
      expect(c.category).toBe('mcp');
    }
    expect(isCuaJsTool('mcp__plugin_cua_cua_repl__js_reset')).toBe(false);
    expect(isCuaJsTool('mcp__maws__browser_act')).toBe(false);
    expect(presentationOf('mcp__maws__browser_act')).toBe('browser_action');
  });

  it('stands between MCP calls as a cell row of its own', () => {
    const b = builder();
    b.turn('u1');
    for (const id of ['m1', 'm2']) {
      b.toolUse(id, 'mcp__docs__search', { q: id });
      b.result(id, id);
    }
    b.toolUse('j1', 'mcp__plugin_cua_cua_repl__js', { code: '1' });
    b.result('j1', 'ok');
    for (const id of ['m3', 'm4']) {
      b.toolUse(id, 'mcp__docs__search', { q: id });
      b.result(id, id);
    }
    b.end(['u1']);
    const rows = rowsOf(withAllExpanded(applyEvents(createState(null, null), b.events)));
    const work = rows.filter((row) => row.kind === 'group' || row.kind === 'cell').map((row) => (row.kind === 'cell' ? `cell:${row.toolUseId}` : 'group'));
    expect(work).toEqual(['group', 'cell:j1', 'group']);
  });
});

describe('standalone activity rows in the flat list', () => {
  const plain = (id: string, s: number): Row => ({ id: id as RowId, turnId: null, at: at(s), kind: 'time', label: id });

  it('returns the rows themselves when nothing stands alone', () => {
    const rows = [plain('a', 0), plain('b', 10)];
    expect(withBrowserActivityRows(rows, [])).toBe(rows);
  });

  it('places each after the last row at or before its time, in time order, keeping its row object', () => {
    const rows = [plain('a', 0), plain('b', 10), plain('c', 5) /* a receipt-like row out of order */, plain('d', 20)];
    const early = activity(-5);
    const mid = activity(12);
    const tie = activity(20);
    const late = activity(30);
    const out = withBrowserActivityRows(rows, [late, mid, early, tie]);
    const ids = out.map((row) => (row.kind === 'browser_activity' ? `act${[early, mid, tie, late].findIndex((e) => e.seq === Number(row.id.split(':')[1]))}` : row.id));
    expect(ids).toEqual(['act0', 'a', 'b', 'c', 'act1', 'd', 'act2', 'act3']);
    expect(out.find((row) => row.kind === 'browser_activity' && row.id === browserActivityRow(late).id)).toBe(browserActivityRow(late));
  });

  it('makes a row outside any turn that carries the activity as main sent it', () => {
    const entry = activity(3, { activity: { kind: 'download', filename: 'cua-report.pdf', state: 'complete' } });
    expect(browserActivityRow(entry)).toEqual({ id: `browser-activity:${entry.seq}`, turnId: null, at: entry.at, kind: 'browser_activity', appSessionId: APP, tabId: TAB, activity: entry.activity });
  });
});
