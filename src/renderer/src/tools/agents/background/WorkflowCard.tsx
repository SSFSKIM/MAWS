// A workflow run's card (C8b execution document, M3; mockup 03 study 03; compact since E7, Design §2): the task's
// description as its title (the progress frame's `summary` is not on X1 for a workflow), `workflow <name> · <elapsed> ·
// <n> agents · <tokens>`, then one summary line (`<phase> · <done>/<total> agents`, `Queued` before any start, `Done`
// after) where its per-phase tables were: those live in the run's widget, which the title and the chevron open.
// `Stop workflow` asks no confirmation (Codex stops a workflow in one click) and reads `stopping…` at once.
import type { TaskId } from '@shared/graph/ids';
import { Icon } from '../../../app/IconButton';
import { BACKGROUND_COPY } from '../copy';
import type { TaskNode } from '../model/task-graph';
import { runSummary, type RunSummary, type RunView } from '../model/workflow-run';
import { RunBadge, runLine } from './run-parts';
import { StopButton, StopError } from './TaskRows';

interface Props {
  node: TaskNode;
  view: RunView;
  live: boolean;
  selected: boolean;
  stopError: string | null;
  onOpen: (taskId: TaskId) => void;
  onStop: (taskId: TaskId) => void;
}

const summaryText = (summary: RunSummary | null): string =>
  summary === null
    ? BACKGROUND_COPY.phasesPending
    : summary.kind === 'phase'
      ? BACKGROUND_COPY.runSummary.phase(summary.title, summary.done, summary.total)
      : BACKGROUND_COPY.runSummary[summary.kind];

export function WorkflowCard({ node, view, live, selected, stopError, onOpen, onStop }: Props) {
  return (
    <article
      data-workflow={node.taskId}
      data-task-id={node.taskId}
      data-selected={selected}
      className={`mx-3 mb-2 flex flex-col gap-1 rounded-sm border px-2.5 pt-2 pb-2 ${selected ? 'border-accent' : 'border-border'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="min-w-0 truncate text-ui font-semibold">
          <button type="button" onClick={() => onOpen(node.taskId)} className="max-w-full truncate rounded-sm text-left outline-accent hover:underline focus-visible:outline-2">
            {node.description}
          </button>
        </h4>
        <div className="flex shrink-0 items-center gap-1.5">
          <RunBadge node={node} />
          <button
            type="button"
            aria-label={BACKGROUND_COPY.openRun(node.description)}
            onClick={() => onOpen(node.taskId)}
            className="rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
          >
            <Icon className="size-3.5">
              <path d="M6 3.5l4.5 4.5L6 12.5" />
            </Icon>
          </button>
        </div>
      </div>
      <p data-part="line" className="truncate text-ui-sm text-fg-muted tabular-nums">
        {runLine(node, view)}
      </p>
      <p data-part="summary" className="truncate text-ui-sm tabular-nums">
        {summaryText(runSummary(view.phases))}
      </p>
      {node.status === 'running' && live && (
        <div className="mt-1 flex flex-col items-start gap-1">
          <StopButton node={node} label={BACKGROUND_COPY.stopWorkflow} onStop={onStop} />
        </div>
      )}
      <StopError message={stopError} />
    </article>
  );
}
