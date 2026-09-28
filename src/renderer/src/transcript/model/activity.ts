// What a subagent is doing now, for its row's working detail line (Copy: `{A} · {lastTool} · {t}`; Derivation,
// *Child traffic*): read from the turn that owns the row, whose `children` hold the child's own events (never rendered
// in the parent) and whose events hold the `subagent.progress` and completion events of its task.
import type { TurnState } from './reduce';
import type { SubagentRef } from './rows';

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
