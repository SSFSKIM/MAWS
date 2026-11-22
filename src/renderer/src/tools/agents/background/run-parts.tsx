// What a workflow run's card and its widget both draw (C8b M3, E7 Design §2): the run's line and its ended state's badge.
// Kept apart from either component's module (E11 W-D, E7 housekeeping).
import { Icon } from '../../../app/IconButton';
import { BACKGROUND_COPY } from '../copy';
import { formatElapsed } from '../model/elapsed';
import type { TaskNode } from '../model/task-graph';
import type { RunView } from '../model/workflow-run';
import { statusWord } from './TaskRows';

// The run's `<name> · <elapsed> · <n> agents`, shared with the widget's header (the word cut, T210: no kind word, no
// tokens, and no words for a time no frame gave).
export function runLine(node: TaskNode, view: RunView): string {
  return BACKGROUND_COPY.workflowLine(node.workflow?.workflowName ?? null, view.elapsedMs === null ? null : formatElapsed(view.elapsedMs), view.agents);
}

// An ended run's state (the card's and the widget's badge); nothing while it runs. The word cut (T213, P126): a
// completed run is a green check named by the word, a failed or stopped one keeps its word, an unknown outcome shows none.
export function RunBadge({ node }: { node: TaskNode }) {
  if (node.status === 'running' || node.status === 'unknown') return null;
  if (node.status === 'completed') {
    return (
      <span data-part="status" role="img" aria-label={statusWord(node.status)} className="shrink-0 text-success">
        <Icon className="size-3.5">
          <path d="M3.5 8.5l3 3 6-7" />
        </Icon>
      </span>
    );
  }
  return (
    <span data-part="status" className={`shrink-0 text-ui-sm ${node.status === 'failed' ? 'text-danger' : 'text-fg-muted'}`}>
      {statusWord(node.status)}
    </span>
  );
}
