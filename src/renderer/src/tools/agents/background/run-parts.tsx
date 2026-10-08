// What a workflow run's card and its widget both draw (C8b M3, E7 Design §2): the run's line and its ended state's badge.
// Kept apart from either component's module (E11 W-D, E7 housekeeping).
import { BACKGROUND_COPY, SUBAGENTS_COPY } from '../copy';
import { formatElapsed, formatTokens } from '../model/elapsed';
import type { TaskNode } from '../model/task-graph';
import type { RunView } from '../model/workflow-run';
import { statusWord } from './TaskRows';

// The run's `workflow <name> · <elapsed> · <n> agents · <tokens>`, shared with the widget's header.
export function runLine(node: TaskNode, view: RunView): string {
  return BACKGROUND_COPY.workflowLine(
    node.workflow?.workflowName ?? null,
    view.elapsedMs === null ? SUBAGENTS_COPY.elapsedUnavailable : formatElapsed(view.elapsedMs),
    view.agents,
    view.tokens === null ? SUBAGENTS_COPY.tokensUnavailable : formatTokens(view.tokens),
  );
}

// An ended run's state word (the card's and the widget's badge); nothing while it runs.
export function RunBadge({ node }: { node: TaskNode }) {
  if (node.status === 'running') return null;
  return (
    <span data-part="status" className={`shrink-0 text-ui-sm ${node.status === 'failed' ? 'text-danger' : 'text-fg-muted'}`}>
      {statusWord(node.status)}
    </span>
  );
}
