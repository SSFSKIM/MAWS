// E13 (the in-app browser spec of 2026-10-08, "Action rows"): what an agent did in the in-app browser through cua_repl,
// attached to the session's `js` call it happened under. The agent's browser work arrives as `js` calls, opaque to MAWS;
// main synthesizes the activity from the CDP stream (`browser.agent.activity`) and the window keeps it as live state
// (tools/browser/agent/activity.ts). It is never an X1 event and never enters TranscriptState or the per-turn derive:
// the view reads it beside the rows (a hook under a `js` cell, the standalone rows the transcript places by time), so
// the derive memo and the snapshot suite are untouched, and old journals render exactly as before.
//
// The rule: an activity goes to the session's `js` call in flight at its time (started at or before it, with no result
// yet or a result at or after it), else to the latest `js` call of the turn it fell in that started before it, else it
// stands alone (a download completing after the turn, the 30 s dialog default, cua driven from a terminal).
import type { BrowserAgentActivity } from '@shared/browser/activity';
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import { isCuaJsTool } from './classify';
import { rowId } from './keys';
import type { TranscriptState, TurnState } from './reduce';
import type { Row, TurnId } from './rows';

// One activity as the window keeps it: numbered on arrival, for a stable row id.
export type BrowserActivityEntry = BrowserAgentActivity & { seq: number };

// A `js` call's span, in epoch ms: `endedAt` null while it has no result (in flight).
export interface JsCallSpan {
  toolUseId: ToolUseId;
  startedAt: number;
  endedAt: number | null;
}
// A turn's span and its `js` calls in call order: `endedAt` null while the turn is open.
export interface TurnSpan {
  turnId: TurnId;
  startedAt: number;
  endedAt: number | null;
  calls: readonly JsCallSpan[];
}

export interface BrowserActivityAttachment {
  byCall: ReadonlyMap<ToolUseId, readonly BrowserActivityEntry[]>; // in arrival order
  standalone: readonly BrowserActivityEntry[];
}

const covers = (start: number, end: number | null, t: number) => start <= t && (end === null || t <= end);

// The attachment of a session's activities (another session's are ignored) to the `js` calls of its turns.
export function attachBrowserActivity(appSessionId: AppSessionId, turns: readonly TurnSpan[], activities: readonly BrowserActivityEntry[]): BrowserActivityAttachment {
  const byCall = new Map<ToolUseId, BrowserActivityEntry[]>();
  const standalone: BrowserActivityEntry[] = [];
  for (const entry of activities) {
    if (entry.appSessionId !== appSessionId) continue;
    const t = Date.parse(entry.at);
    let target: JsCallSpan | null = null;
    for (const turn of turns) {
      for (const call of turn.calls) if (covers(call.startedAt, call.endedAt, t) && (target === null || call.startedAt >= target.startedAt)) target = call;
    }
    if (target === null) {
      const turn = turns.findLast((span) => covers(span.startedAt, span.endedAt, t));
      target = turn?.calls.findLast((call) => call.startedAt <= t) ?? null;
    }
    if (target === null) standalone.push(entry);
    else byCall.set(target.toolUseId, [...(byCall.get(target.toolUseId) ?? []), entry]);
  }
  return { byCall, standalone };
}

// A turn's span and its `js` calls, memoised on the turn object (a changed turn is a new object). A call whose turn
// closed with no result ended with it, so it is not in flight forever.
const spans = new WeakMap<TurnState, TurnSpan>();
function turnSpanOf(turn: TurnState): TurnSpan {
  const kept = spans.get(turn);
  if (kept) return kept;
  const calls: JsCallSpan[] = [];
  const byId = new Map<ToolUseId, JsCallSpan>();
  for (const event of turn.events) {
    if (event.kind === 'tool.use' && isCuaJsTool(event.toolName)) {
      const call = { toolUseId: event.toolUseId, startedAt: Date.parse(event.at), endedAt: null };
      calls.push(call);
      byId.set(event.toolUseId, call);
    } else if (event.kind === 'tool.result') {
      const call = byId.get(event.toolUseId);
      if (call) call.endedAt = Date.parse(event.at);
    }
  }
  const closedAt = turn.state === 'closed' ? Date.parse(turn.endedAt ?? turn.events.at(-1)?.at ?? turn.startedAt) : null;
  if (closedAt !== null) for (const call of calls) call.endedAt ??= closedAt;
  const span: TurnSpan = { turnId: turn.id, startedAt: Date.parse(turn.startedAt), endedAt: closedAt, calls };
  spans.set(turn, span);
  return span;
}

// The turns an activity can fall in: a prompt still waiting for the engine (open, not accepted) has not started, so it
// must not take the running turn's later activity.
export function turnSpansOf(state: TranscriptState): TurnSpan[] {
  return [...state.order, ...(state.hidden?.turns ?? [])].map((id) => state.turns.get(id)!).filter((turn) => turn.accepted || turn.state === 'closed').map(turnSpanOf);
}

const sameList = <T,>(a: readonly T[] | undefined, b: readonly T[]): a is readonly T[] => a !== undefined && a.length === b.length && a.every((item, i) => item === b[i]);

// The attachment for a transcript state and the session's activity, memoised on both. A list whose entries did not
// change keeps the previous result's array (the latest one computed for the session), so a row reading it, and the
// transcript placing the standalone rows, see the same reference across event batches that did not change it.
const memo = new WeakMap<TranscriptState, { appSessionId: AppSessionId; activities: readonly BrowserActivityEntry[]; result: BrowserActivityAttachment }>();
const latest = new Map<AppSessionId, BrowserActivityAttachment>();
const NONE: BrowserActivityAttachment = { byCall: new Map(), standalone: [] };

export function attachmentOf(state: TranscriptState | null, appSessionId: AppSessionId | null, activities: readonly BrowserActivityEntry[]): BrowserActivityAttachment {
  if (state === null || appSessionId === null || activities.length === 0) return NONE;
  const kept = memo.get(state);
  if (kept && kept.appSessionId === appSessionId && kept.activities === activities) return kept.result;
  const fresh = attachBrowserActivity(appSessionId, turnSpansOf(state), activities);
  const previous = latest.get(appSessionId);
  const byCall = new Map<ToolUseId, readonly BrowserActivityEntry[]>();
  for (const [id, list] of fresh.byCall) {
    const before = previous?.byCall.get(id);
    byCall.set(id, sameList(before, list) ? before : list);
  }
  const result = { byCall, standalone: sameList(previous?.standalone, fresh.standalone) ? previous.standalone : fresh.standalone };
  memo.set(state, { appSessionId, activities, result });
  latest.set(appSessionId, result);
  return result;
}

// A standalone activity's row, one object per entry (so the list's row slot keeps it by reference).
const rows = new WeakMap<BrowserActivityEntry, Extract<Row, { kind: 'browser_activity' }>>();
export function browserActivityRow(entry: BrowserActivityEntry): Extract<Row, { kind: 'browser_activity' }> {
  let row = rows.get(entry);
  if (!row) {
    row = { id: rowId.browserActivity(entry.seq), turnId: null, at: entry.at, kind: 'browser_activity', appSessionId: entry.appSessionId, tabId: entry.tabId, activity: entry.activity };
    rows.set(entry, row);
  }
  return row;
}

// The flat list with each standalone activity after the last row at or before its time (rows are in reading order,
// and a receipt or a loose row may carry an earlier time than the row above it), in time order among themselves.
const times = new WeakMap<Row, number>();
const timeOf = (row: Row) => {
  let t = times.get(row);
  if (t === undefined) {
    t = Date.parse(row.at);
    times.set(row, t);
  }
  return t;
};

export function withBrowserActivityRows(list: Row[], standalone: readonly BrowserActivityEntry[]): Row[] {
  if (standalone.length === 0) return list;
  const entries = [...standalone].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const before = new Map<number, Row[]>(); // by the index of the row they go before (list.length: at the end)
  let j = list.length - 1;
  for (let k = entries.length - 1; k >= 0; k--) {
    const t = Date.parse(entries[k].at);
    while (j >= 0 && timeOf(list[j]) > t) j--;
    const at = j + 1;
    before.set(at, [browserActivityRow(entries[k]), ...(before.get(at) ?? [])]);
  }
  const out: Row[] = [];
  for (let i = 0; i <= list.length; i++) {
    out.push(...(before.get(i) ?? []));
    if (i < list.length) out.push(list[i]);
  }
  return out;
}
