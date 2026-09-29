// What a subagent is doing now, for its row's working detail line (Copy: `{A} · {lastTool} · {t}`; Derivation,
// *Child traffic*): read from the turn that owns the row, whose `children` hold the child's own events (never rendered
// in the parent) and whose events hold the `subagent.progress` and completion events of its task. And what each turn
// did, whatever the reader disclosed (`turnActivity`, C8's summary).
import { turnWork } from './derive';
import type { TranscriptState, TurnState, TurnWork } from './reduce';
import type { SubagentRef, TurnId } from './rows';

export interface SubagentActivity {
  lastTool: string | null; // the child's latest tool call, else the latest progress report's
  finished: boolean;
}

export function subagentActivity(turn: TurnState, ref: SubagentRef): SubagentActivity {
  let lastTool: string | null = null;
  let finished = false;
  for (const event of turn.events) {
    if ((event.kind === 'subagent.finished' || event.kind === 'task.notification') && event.taskId === ref.taskId) finished = true;
    else if (event.kind === 'subagent.progress' && event.taskId === ref.taskId && event.lastToolName !== null) lastTool = event.lastToolName;
  }
  const child = ref.toolUseId === null ? undefined : turn.children.get(ref.toolUseId);
  const use = child?.findLast((event) => event.kind === 'tool.use');
  if (use?.kind === 'tool.use') lastTool = use.toolName;
  return { lastTool, finished };
}

// What a turn did, whatever the reader disclosed (C8's ask, Public surface): the files it read and edited, the tools it
// used, its children. The disclosed rows drop cells and subagent rows when a turn collapses; this projection does not.
// A selector over the per-turn derivation: the work is computed with the turn's rows and memoised beside them
// (derive.ts, `turnWork`); here it gains the turn's identity and is kept per turn id and version, so a ui change that
// re-derives the rows leaves the entry as it was.
export interface TurnActivity extends TurnWork {
  turnId: TurnId;
  origin: 'human' | 'engine';
  state: TurnState['state'];
}

// Both memos hang off the lineage's shared per-turn memo map, so every state of one lineage shares them.
const byTurn = new WeakMap<TranscriptState['memo'], Map<TurnId, { version: number; activity: TurnActivity }>>();
const lists = new WeakMap<TranscriptState['memo'], TurnActivity[]>();

// One entry per turn in `state.order`; an unchanged turn keeps its entry, and an unchanged list is the same array.
export function turnActivity(state: TranscriptState): TurnActivity[] {
  let memo = byTurn.get(state.memo);
  if (!memo) byTurn.set(state.memo, (memo = new Map()));
  const list = state.order.map((id) => {
    const turn = state.turns.get(id)!;
    let entry = memo.get(id);
    if (!entry || entry.version !== turn.version) {
      memo.set(id, (entry = { version: turn.version, activity: { turnId: turn.id, origin: turn.origin, state: turn.state, ...turnWork(state, turn) } }));
    }
    return entry.activity;
  });
  const previous = lists.get(state.memo);
  if (previous && previous.length === list.length && previous.every((entry, i) => entry === list[i])) return previous;
  lists.set(state.memo, list);
  return list;
}
