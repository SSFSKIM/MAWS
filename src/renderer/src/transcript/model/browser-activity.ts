// E13 (the in-app browser spec of 2026-10-08, "Action rows"): what an agent did in the in-app browser through cua_repl,
// attached to the session's `js` call it happened under. The agent's browser work arrives as `js` calls, opaque to MAWS;
// main synthesizes the activity from the CDP stream (`browser.agent.activity`) and the window keeps it as live state
// (tools/browser/agent/activity.ts). It is never an X1 event and never enters TranscriptState or the per-turn derive:
// the transcript view places its rows among the derived ones (`withBrowserActivityRows`), so the derive memo and the
// snapshot suite are untouched, and old journals render exactly as before.
//
// The rule: an activity goes to the session's `js` call in flight at its time (started at or before it, with no result
// yet or a result at or after it), else to the latest `js` call of the turn it fell in that started before it, else it
// stands alone (a download completing after the turn, the 30 s dialog default, cua driven from a terminal).
//
// Every activity is a persistent row of its own kind (M3 fix wave), as the old browser action rows were: an attached one
// sits directly under its call's cell while the turn's work shows, and at the call's place among the turn's persistent
// rows once it folds (the cell folds with the work and keeps counting in the divider); a standalone one at its time.
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

// Where a `js` call that carries activity is: its turn, and when it started (epoch ms).
export interface CallAnchor {
  turnId: TurnId;
  startedAt: number;
}

export interface BrowserActivityAttachment {
  byCall: ReadonlyMap<ToolUseId, readonly BrowserActivityEntry[]>; // in arrival order
  calls: ReadonlyMap<ToolUseId, CallAnchor>; // every call of `byCall`
  standalone: readonly BrowserActivityEntry[];
}

const covers = (start: number, end: number | null, t: number) => start <= t && (end === null || t <= end);

// The attachment of a session's activities (another session's are ignored) to the `js` calls of its turns.
export function attachBrowserActivity(appSessionId: AppSessionId, turns: readonly TurnSpan[], activities: readonly BrowserActivityEntry[]): BrowserActivityAttachment {
  const byCall = new Map<ToolUseId, BrowserActivityEntry[]>();
  const calls = new Map<ToolUseId, CallAnchor>();
  const standalone: BrowserActivityEntry[] = [];
  for (const entry of activities) {
    if (entry.appSessionId !== appSessionId) continue;
    const t = Date.parse(entry.at);
    let target: { call: JsCallSpan; turn: TurnSpan } | null = null;
    for (const turn of turns) {
      for (const call of turn.calls) if (covers(call.startedAt, call.endedAt, t) && (target === null || call.startedAt >= target.call.startedAt)) target = { call, turn };
    }
    if (target === null) {
      const turn = turns.findLast((span) => covers(span.startedAt, span.endedAt, t));
      const call = turn?.calls.findLast((c) => c.startedAt <= t);
      if (turn && call) target = { call, turn };
    }
    if (target === null) {
      standalone.push(entry);
      continue;
    }
    const { call, turn } = target;
    byCall.set(call.toolUseId, [...(byCall.get(call.toolUseId) ?? []), entry]);
    calls.set(call.toolUseId, { turnId: turn.turnId, startedAt: call.startedAt });
  }
  return { byCall, calls, standalone };
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
const sameAnchor = (a: CallAnchor | undefined, b: CallAnchor) => a !== undefined && a.turnId === b.turnId && a.startedAt === b.startedAt;

// The attachment for a transcript state and the session's activity, memoised on both. An attachment equal to the
// latest one computed for the session is that one, and a list whose entries did not change keeps its array, so the
// transcript placing the rows sees the same reference across event batches that changed nothing here.
const memo = new WeakMap<TranscriptState, { appSessionId: AppSessionId; activities: readonly BrowserActivityEntry[]; result: BrowserActivityAttachment }>();
const latest = new Map<AppSessionId, BrowserActivityAttachment>();
const NONE: BrowserActivityAttachment = { byCall: new Map(), calls: new Map(), standalone: [] };

export function attachmentOf(state: TranscriptState | null, appSessionId: AppSessionId | null, activities: readonly BrowserActivityEntry[]): BrowserActivityAttachment {
  if (state === null || appSessionId === null || activities.length === 0) return NONE;
  const kept = memo.get(state);
  if (kept && kept.appSessionId === appSessionId && kept.activities === activities) return kept.result;
  const fresh = attachBrowserActivity(appSessionId, turnSpansOf(state), activities);
  const previous = latest.get(appSessionId);
  let same = previous !== undefined && previous.byCall.size === fresh.byCall.size;
  const byCall = new Map<ToolUseId, readonly BrowserActivityEntry[]>();
  for (const [id, list] of fresh.byCall) {
    const before = previous?.byCall.get(id);
    const kept = sameList(before, list);
    same &&= kept && sameAnchor(previous?.calls.get(id), fresh.calls.get(id)!);
    byCall.set(id, kept ? before : list);
  }
  const standalone = sameList(previous?.standalone, fresh.standalone) ? previous.standalone : fresh.standalone;
  const result = same && standalone === previous!.standalone ? previous! : { byCall, calls: fresh.calls, standalone };
  memo.set(state, { appSessionId, activities, result });
  latest.set(appSessionId, result);
  return result;
}

type ActivityRow = Extract<Row, { kind: 'browser_activity' }>;

// An activity's row: under its call (in the call's turn) or standalone (no turn). One object per entry and placement,
// so the list's row slot keeps it by reference.
const rows = new WeakMap<BrowserActivityEntry, ActivityRow>();
export function browserActivityRow(entry: BrowserActivityEntry, call: { toolUseId: ToolUseId; turnId: TurnId } | null = null): ActivityRow {
  const kept = rows.get(entry);
  if (kept && kept.toolUseId === (call?.toolUseId ?? null) && kept.turnId === (call?.turnId ?? null)) return kept;
  const row: ActivityRow = {
    id: rowId.browserActivity(entry.seq), turnId: call?.turnId ?? null, at: entry.at, kind: 'browser_activity', toolUseId: call?.toolUseId ?? null,
    appSessionId: entry.appSessionId, tabId: entry.tabId, activity: entry.activity,
  };
  rows.set(entry, row);
  return row;
}

const times = new WeakMap<Row, number>();
const timeOf = (row: Row) => {
  let t = times.get(row);
  if (t === undefined) {
    t = Date.parse(row.at);
    times.set(row, t);
  }
  return t;
};

// The flat list with the activity rows placed (rows are in reading order; a receipt or a loose row may carry an earlier
// time than the row above it, so a place is "after the last row at or before", never a sort):
// - a call's rows, in order, directly after its cell when the list shows it (the turn's work is open); else after the
//   last row of its turn at or before the call's start, which is the call's place among the turn's persistent rows
//   (a folded turn); a turn the list does not show at all (a rewound branch not revealed) shows none of them;
// - a standalone row after the last row at or before its own time.
export function withBrowserActivityRows(list: Row[], attachment: BrowserActivityAttachment): Row[] {
  const { byCall, calls, standalone } = attachment;
  if (byCall.size === 0 && standalone.length === 0) return list;
  const placed: { at: number; key: number; rows: Row[] }[] = []; // `at`: the index of the row they go before
  // a call's cell, else the last row of its turn at or before its start
  const cells = new Map<ToolUseId, number>();
  const turnPlace = new Map<ToolUseId, number>();
  list.forEach((row, i) => {
    if (row.kind === 'cell' && row.toolUseId !== null && byCall.has(row.toolUseId)) cells.set(row.toolUseId, i);
    if (row.turnId === null) return;
    for (const [id, anchor] of calls) if (anchor.turnId === row.turnId && timeOf(row) <= anchor.startedAt) turnPlace.set(id, i);
  });
  for (const [id, entries] of byCall) {
    const anchor = calls.get(id)!;
    const after = cells.get(id) ?? turnPlace.get(id);
    if (after === undefined) continue;
    placed.push({ at: after + 1, key: anchor.startedAt, rows: entries.map((entry) => browserActivityRow(entry, { toolUseId: id, turnId: anchor.turnId })) });
  }
  // standalone ones, latest first, scanning back from the end
  const alone = [...standalone].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let j = list.length - 1;
  for (let k = alone.length - 1; k >= 0; k--) {
    const t = Date.parse(alone[k].at);
    while (j >= 0 && timeOf(list[j]) > t) j--;
    placed.push({ at: j + 1, key: t, rows: [browserActivityRow(alone[k])] });
  }
  if (placed.length === 0) return list;
  placed.sort((a, b) => a.at - b.at || a.key - b.key);
  const out: Row[] = [];
  let p = 0;
  for (let i = 0; i <= list.length; i++) {
    while (p < placed.length && placed[p].at === i) out.push(...placed[p++].rows);
    if (i < list.length) out.push(list[i]);
  }
  return out;
}
