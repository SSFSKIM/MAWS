// What a subagent is doing now, for its row's working detail line (Copy: `{A} · {lastTool} · {t}`; Derivation,
// *Child traffic*): read from the turn that owns the row, whose `children` hold the child's own events (never rendered
// in the parent) and whose events hold the `subagent.progress` and completion events of its task. And what each turn
// did, whatever the reader disclosed (`turnActivity`, C8's summary).
import { turnWork } from './derive';
import type { TranscriptState, TurnState } from './reduce';
import type { ChangedFile, SubagentRef, SubagentStatus, ToolCategory, TurnId } from './rows';

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
// A selector over the per-turn derivation (derive.ts, `turnWork`), memoised per turn id and version.
export interface TurnActivity {
  turnId: TurnId;
  origin: 'human' | 'engine';
  state: TurnState['state'];
  filesRead: string[]; // paths in first-seen order, each once
  filesEdited: ChangedFile[]; // the receipt's files, with its counts
  tools: { name: string; category: ToolCategory; count: number }[]; // every tool cell (a merged read counts each read), first-seen order; the parent's own, never a child agent's
  subagents: (SubagentRef & { status: SubagentStatus })[]; // one per child, glyph as the row shows it, its own derived status
}

// Both memos hang off the lineage's shared per-turn memo map, so every state of one lineage shares them.
const byTurn = new WeakMap<TranscriptState['memo'], Map<TurnId, { version: number; activity: TurnActivity }>>();
const lists = new WeakMap<TranscriptState['memo'], TurnActivity[]>();

function project(turn: TurnState): TurnActivity {
  const { cells, files, agents } = turnWork(turn);
  const filesRead = new Set<string>();
  const tools = new Map<string, { name: string; category: ToolCategory; count: number }>();
  for (const cell of cells) {
    if (cell.detail.kind === 'thinking' || cell.detail.kind === 'hook') continue; // not tool calls
    if (cell.detail.kind === 'read') for (const file of cell.detail.files) filesRead.add(file.path);
    const tool = tools.get(cell.toolName) ?? { name: cell.toolName, category: cell.category, count: 0 };
    tool.count += cell.detail.kind === 'read' ? cell.detail.files.length : 1;
    tools.set(cell.toolName, tool);
  }
  return { turnId: turn.id, origin: turn.origin, state: turn.state, filesRead: [...filesRead], filesEdited: files, tools: [...tools.values()], subagents: agents };
}

// One entry per turn in `state.order`; an unchanged turn keeps its entry, and an unchanged list is the same array.
export function turnActivity(state: TranscriptState): TurnActivity[] {
  let memo = byTurn.get(state.memo);
  if (!memo) byTurn.set(state.memo, (memo = new Map()));
  const list = state.order.map((id) => {
    const turn = state.turns.get(id)!;
    let entry = memo.get(id);
    if (!entry || entry.version !== turn.version) memo.set(id, (entry = { version: turn.version, activity: project(turn) }));
    return entry.activity;
  });
  const previous = lists.get(state.memo);
  if (previous && previous.length === list.length && previous.every((entry, i) => entry === list[i])) return previous;
  lists.set(state.memo, list);
  return list;
}
