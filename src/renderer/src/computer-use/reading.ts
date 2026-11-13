// The computer-use plugin's calls as a session's transcript shows them (the UX wave's U12a, Interfaces §E): the strip
// at the top of a session reads them here. A reading of its own, not the browser activity's spans (`turnSpansOf`),
// because those leave out a subagent's calls: this one scans a turn's events and its children's, and is memoised per
// turn object, so an event batch that leaves a turn alone costs nothing for it. It reads the plugin's three tools: `js`,
// which the strip draws, and `js_reset` and `end_task`, read only as evidence that nothing runs any more.
//
// A call is in `flight` from its `tool.use` until its result or its turn's close; `waiting` instead while a waiting
// permission request names it; `done` at an ordinary result; `failed` at an error result the interruption did not write
// (a cell that ran and threw, or the plugin's answer before it queued one: every such answer of the plugin's is an error
// result, so only `done` shows that a cell ran); `withdrawn` at a result whose denial is `user-rejected`, at an error
// result the engine's interruption marker cut, or at its turn's close with no result. A turn the store or the controls
// port says is not running reads closed, since a terminal session's file can leave a turn open that nothing ends.
//
// What the marker cut (a transcript file's rows carry no denial): the engine writes an error result for each call the
// interrupt withdrew and then its marker, with nothing between (the recorded `queue-and-interrupt` and
// `pass3/p1-maws-ask-interrupt`), so a marker withdraws the error results that stand between it and the last event before
// it that is not a tool result, and no earlier one: a call that ended with an error before an unrelated interrupt stays
// `failed`. A subagent's list has no order against the turn's, so when the turn holds a marker it withdraws the list's
// trailing error results alone, those no event of another kind in that list follows.
import type { SessionEvent } from '@shared/graph/events';
import type { ToolUseId } from '@shared/graph/ids';
import { CUA_JS_TOOLS } from '../transcript/model/classify';
import type { TranscriptState, TurnState } from '../transcript/model/reduce';
import type { TurnId } from '../transcript/model/rows';
import { isInterruptionMarker } from '../transcript/model/user-text';

export interface ComputerUseCall {
  toolUseId: ToolUseId;
  tool: 'js' | 'reset' | 'end'; // the plugin's js, js_reset and end_task, under either server name
  state: 'flight' | 'waiting' | 'done' | 'failed' | 'withdrawn';
}

export interface ComputerUseReading {
  turn: TurnId | null;
  running: boolean;
  calls: readonly ComputerUseCall[];
}

// The plugin's tools under both names the engine gives its server: `mcp__plugin_cua_cua_repl__` and `mcp__cua_repl__`.
const TOOLS: ReadonlyMap<string, ComputerUseCall['tool']> = new Map(
  CUA_JS_TOOLS.flatMap((js) => {
    const server = js.slice(0, -'js'.length);
    return [[js, 'js'], [`${server}js_reset`, 'reset'], [`${server}end_task`, 'end']] as const;
  }),
);

// A call as its turn's events show it, before the turn's running and the waiting requests are laid over it.
interface Seen {
  toolUseId: ToolUseId;
  tool: ComputerUseCall['tool'];
  startedAt: number;
  outcome: 'none' | 'done' | 'failed' | 'withdrawn';
}

const isMarker = (event: SessionEvent) => event.kind === 'user.message' && isInterruptionMarker(event.origin, event.content);

// The indices of the results an interruption wrote in one list: those right before each marker, and, for a child's list
// of a turn that holds one (`trailingCut`), those at the list's end.
function cutResults(events: readonly SessionEvent[], trailingCut: boolean): ReadonlySet<number> {
  const cut = new Set<number>();
  const back = (from: number) => {
    for (let i = from; i >= 0 && events[i].kind === 'tool.result'; i--) cut.add(i);
  };
  events.forEach((event, i) => {
    if (isMarker(event)) back(i - 1);
  });
  if (trailingCut) back(events.length - 1);
  return cut;
}

// One list of events (the turn's own, or one child's): its calls, and how each result reads.
function callsIn(events: readonly SessionEvent[], trailingCut: boolean): Seen[] {
  const seen: Seen[] = [];
  const byId = new Map<ToolUseId, Seen>();
  const cut = cutResults(events, trailingCut);
  events.forEach((event, i) => {
    if (event.kind === 'tool.use') {
      const tool = TOOLS.get(event.toolName);
      if (tool === undefined) return;
      const call: Seen = { toolUseId: event.toolUseId, tool, startedAt: Date.parse(event.at), outcome: 'none' };
      seen.push(call);
      byId.set(event.toolUseId, call);
    } else if (event.kind === 'tool.result') {
      const call = byId.get(event.toolUseId);
      if (call) call.outcome = event.denial === 'user-rejected' || (event.isError && cut.has(i)) ? 'withdrawn' : event.isError ? 'failed' : 'done';
    }
  });
  return seen;
}

// A turn's calls in the order they started (the turn's own and its children's, merged by start time; a stable sort keeps
// the turn's own first at a tie), memoised on the turn object (a changed turn is a new object).
const perTurn = new WeakMap<TurnState, readonly Seen[]>();
function seenIn(turn: TurnState): readonly Seen[] {
  const kept = perTurn.get(turn);
  if (kept) return kept;
  const marked = turn.events.some(isMarker);
  const all = [...callsIn(turn.events, false), ...[...turn.children.values()].flatMap((events) => callsIn(events, marked))];
  const ordered = turn.children.size === 0 ? all : all.sort((a, b) => a.startedAt - b.startedAt);
  perTurn.set(turn, ordered);
  return ordered;
}

// The calls as they stand: in a running turn an unanswered call is in flight or waiting; in any other it was withdrawn.
const callsCache = new WeakMap<readonly Seen[], { running: boolean; waiting: ReadonlySet<ToolUseId>; calls: readonly ComputerUseCall[] }>();
function callsOf(seen: readonly Seen[], running: boolean, waiting: ReadonlySet<ToolUseId>): readonly ComputerUseCall[] {
  const kept = callsCache.get(seen);
  if (kept && kept.running === running && (kept.waiting === waiting || !seen.some((s) => s.outcome === 'none'))) return kept.calls;
  const calls = seen.map(({ toolUseId, tool, outcome }): ComputerUseCall => ({
    toolUseId,
    tool,
    state: outcome !== 'none' ? outcome : !running ? 'withdrawn' : waiting.has(toolUseId) ? 'waiting' : 'flight',
  }));
  callsCache.set(seen, { running, waiting, calls });
  return calls;
}

const NO_CALLS: readonly ComputerUseCall[] = [];
const NOTHING: ComputerUseReading = { turn: null, running: false, calls: NO_CALLS };
const readings = new WeakMap<TranscriptState, { waiting: ReadonlySet<ToolUseId>; runs: boolean; reading: ComputerUseReading }>();

/** The session's computer-use calls of the turn that matters now, in the order they started: the running turn,
 *  else the latest turn that has one. `running` says whether `turn` is the running turn. `waiting` holds the
 *  tool-use ids of the session's waiting permission requests; `runs` is false when the store or the controls port
 *  says the turn is not running. */
export function readComputerUse(state: TranscriptState | null, waiting: ReadonlySet<ToolUseId>, runs: boolean): ComputerUseReading {
  if (state === null) return NOTHING;
  const kept = readings.get(state);
  if (kept && kept.waiting === waiting && kept.runs === runs) return kept.reading;
  const turns = state.order.map((id) => state.turns.get(id)!);
  // the latest turn the engine has taken (accepted): a prompt written but not started is no turn yet, nor is one that
  // was dropped before it started (cancelled, discarded or refused closes its turn unaccepted, reduce.ts `drop`), so a
  // prompt queued and then cancelled behind a running call does not end that call's turn here
  const latest = turns.findLast((turn) => turn.accepted);
  const running = runs && latest !== undefined && latest.state === 'open' ? latest : null;
  const turn = running ?? turns.findLast((t) => t.accepted && seenIn(t).length > 0) ?? null;
  const reading: ComputerUseReading = turn === null ? NOTHING : { turn: turn.id, running: turn === running, calls: seenIn(turn).length === 0 ? NO_CALLS : callsOf(seenIn(turn), turn === running, waiting) };
  readings.set(state, { waiting, runs, reading });
  return reading;
}
