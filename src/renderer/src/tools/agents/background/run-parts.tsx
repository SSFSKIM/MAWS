// What a workflow run's card and its widget both draw (C8b M3, E7 Design §2): the run's line and its ended state's badge.
// Kept apart from either component's module (E11 W-D, E7 housekeeping).
import type { AppSessionId } from '@shared/graph/ids';
import { Icon } from '../../../app/IconButton';
import { QuietSpinner } from '../../../ui/spinner';
import { BACKGROUND_COPY } from '../copy';
import { formatElapsed } from '../model/elapsed';
import { isEnded, type TaskNode } from '../model/task-graph';
import { useTaskGraph } from '../store';
import type { RunView } from '../model/workflow-run';
import { statusWord } from './TaskRows';

// The run's `<name> · <elapsed> · <n> agents`, shared with the widget's header (the word cut, T210: no kind word, no
// tokens, and no words for a time no frame gave).
export function runLine(node: TaskNode, view: RunView): string {
  return BACKGROUND_COPY.workflowLine(node.workflow?.workflowName ?? null, view.elapsedMs === null ? null : formatElapsed(view.elapsedMs), view.agents);
}

// Where a run's phases go before it has any (the word cut, T212). A quiet spinner while they can still arrive: the run
// has not ended and something can still report it (`canArrive`: the session runs here or in a terminal, whose frames
// and run files keep coming, or the disk read has not answered). Settled otherwise: `No phases` for a run that ended
// without any (its badge says how), `No phase data` for one whose answered read held no snapshot. A later read that
// brings one draws its phases.
export function PhasesPending({ node, canArrive }: { node: TaskNode; canArrive: boolean }) {
  if (isEnded(node.status)) return BACKGROUND_COPY.noPhases;
  return canArrive ? <QuietSpinner label={BACKGROUND_COPY.phasesPending} /> : BACKGROUND_COPY.noPhaseData;
}

// A run a link named that no read has brought yet (the word cut, T209). A quiet spinner while a read can still bring it:
// the session is live here (its events), or its disk read has not answered. Settled otherwise: the read's error, said
// once by the list on its own line (`error` draws it here, where nothing else does), or `Run not found` once the read
// answered without it. Either way the run opens when a later read brings it.
export function PendingRun({ appSessionId, live, error, className = '' }: { appSessionId: AppSessionId; live: boolean; error: boolean; className?: string }) {
  const runsRead = useTaskGraph((s) => (s.entries.get(appSessionId)?.disk.runs ?? null) !== null);
  const runsError = useTaskGraph((s) => s.entries.get(appSessionId)?.disk.runsError ?? null);
  if (runsError !== null) return error ? <p className={`text-ui-sm text-danger ${className}`}>{BACKGROUND_COPY.runsUnavailable(runsError)}</p> : null;
  if (live || !runsRead) {
    return (
      <p className={className || undefined}>
        <QuietSpinner label={BACKGROUND_COPY.runNotFound} />
      </p>
    );
  }
  return <p className={`text-ui-sm text-fg-muted ${className}`}>{BACKGROUND_COPY.runMissing}</p>;
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
