// A workflow run's card (C8b execution document, M3; mockup 03 study 03): the task's description as its title (the
// progress frame's `summary` is not on X1 for a workflow), `workflow <name> · <elapsed> · <n> agents · <tokens>`, then
// its phases from the latest whole progress snapshot (wire or disk), each `<title> <done>/<total>` (or `· Queued` while
// no agent of it has started) over an Agent, Model, Tokens, Time table whose rows with an agent id open the drill-in.
// `Stop workflow` asks no confirmation (Codex stops a workflow in one click) and reads `stopping…` at once.
import type { AgentId, TaskId } from '@shared/graph/ids';
import { Icon } from '../../../app/IconButton';
import { BACKGROUND_COPY, SUBAGENTS_COPY } from '../copy';
import { formatElapsed, formatTokenCount, formatTokens } from '../model/elapsed';
import type { TaskNode } from '../model/task-graph';
import { agentTableOf, phasesOf, workflowTotals, type WorkflowAgentTableRow, type WorkflowPhase } from '../model/workflow-progress';
import { ACTION, StopButton, StopError, statusWord } from './TaskRows';

interface Props {
  node: TaskNode;
  now: number;
  live: boolean;
  selected: boolean;
  collapsed: boolean;
  stopError: string | null;
  onToggle: (taskId: string) => void;
  onStop: (taskId: TaskId) => void;
  onOpenAgent: (agentId: AgentId) => void;
}

export function WorkflowCard({ node, now, live, selected, collapsed, stopError, onToggle, onStop, onOpenAgent }: Props) {
  const progress = node.workflow?.progress ?? null;
  const phases = phasesOf(progress);
  const totals = workflowTotals(node, progress);
  const running = node.status === 'running';
  const elapsedMs = running && node.startedAt !== null ? Math.max(0, now - Date.parse(node.startedAt)) : totals.elapsedMs;
  const line = BACKGROUND_COPY.workflowLine(
    node.workflow?.workflowName ?? null,
    elapsedMs === null ? SUBAGENTS_COPY.elapsedUnavailable : formatElapsed(elapsedMs),
    totals.agents,
    totals.tokens === null ? SUBAGENTS_COPY.tokensUnavailable : formatTokens(totals.tokens),
  );
  const phasesId = `workflow-phases-${node.taskId}`;
  return (
    <article
      data-workflow={node.taskId}
      data-task-id={node.taskId}
      data-selected={selected}
      className={`mx-3 mb-2 flex flex-col gap-1 rounded-sm border px-2.5 pt-2 pb-2 ${selected ? 'border-accent' : 'border-border'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="min-w-0 truncate text-ui font-semibold">{node.description}</h4>
        {!running && (
          <span data-part="status" className={`shrink-0 text-ui-sm ${node.status === 'failed' ? 'text-danger' : 'text-fg-muted'}`}>
            {statusWord(node.status)}
          </span>
        )}
      </div>
      <p data-part="line" className="truncate text-ui-sm text-fg-muted tabular-nums">
        {line}
      </p>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={collapsed ? undefined : phasesId}
        onClick={() => onToggle(node.taskId)}
        className="mt-1 self-start rounded-sm text-ui-sm text-fg-muted outline-accent hover:text-fg focus-visible:outline-2"
      >
        {BACKGROUND_COPY.phasesLabel}
      </button>
      {!collapsed && (
        <div id={phasesId} className="flex flex-col gap-1.5">
          {phases.length === 0 ? (
            <p className="text-ui-sm text-fg-muted">{BACKGROUND_COPY.phasesPending}</p>
          ) : (
            phases.map((phase) => <Phase key={phase.index} phase={phase} now={now} onOpenAgent={onOpenAgent} />)
          )}
        </div>
      )}
      {running && live && (
        <div className="mt-1 flex flex-col items-start gap-1">
          <StopButton node={node} label={BACKGROUND_COPY.stopWorkflow} onStop={onStop} />
        </div>
      )}
      <StopError message={stopError} />
    </article>
  );
}

function Phase({ phase, now, onOpenAgent }: { phase: WorkflowPhase; now: number; onOpenAgent: (agentId: AgentId) => void }) {
  const rows = agentTableOf(phase);
  const label = phase.state === 'queued' ? BACKGROUND_COPY.phaseQueued(phase.title) : BACKGROUND_COPY.phase(phase.title, phase.done, phase.total);
  const columns = BACKGROUND_COPY.columns;
  return (
    <div className="flex flex-col">
      <p data-phase={phase.index} className="text-ui-sm font-medium">
        {label}
      </p>
      {rows.length > 0 && (
        <table aria-label={phase.title} className="w-full table-fixed border-collapse text-ui-sm tabular-nums">
          <thead>
            <tr className="border-b border-border text-fg-muted">
              <th className="w-[45%] py-0.5 text-left font-normal">{columns.agent}</th>
              <th className="w-[23%] py-0.5 text-right font-normal">{columns.model}</th>
              <th className="py-0.5 text-right font-normal">{columns.tokens}</th>
              <th className="py-0.5 text-right font-normal">{columns.time}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <AgentRow key={`${row.label}:${i}`} row={row} startedAt={phase.agents[i]?.startedAt ?? null} now={now} onOpenAgent={onOpenAgent} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// The engine's own count once the agent reports one; a running agent's time from its start; nothing otherwise.
function timeOf(row: WorkflowAgentTableRow, startedAt: number | null, now: number): string {
  if (row.durationMs !== null) return formatElapsed(row.durationMs);
  if (row.state !== 'done' && startedAt !== null) return formatElapsed(now - startedAt);
  return '';
}

function AgentRow({ row, startedAt, now, onOpenAgent }: { row: WorkflowAgentTableRow; startedAt: number | null; now: number; onOpenAgent: (agentId: AgentId) => void }) {
  const mark =
    row.state === 'done' ? (
      <span role="img" aria-label={row.state} className="text-success">
        <Icon className="size-3">
          <path d="M3.5 8.5l3 3 6-7" />
        </Icon>
      </span>
    ) : startedAt !== null ? (
      <span role="img" aria-label={row.state} className="size-2.5 shrink-0 animate-spin rounded-full border border-border-strong border-t-accent" />
    ) : null;
  const label = (
    <span className="flex min-w-0 items-center gap-1.5">
      {mark}
      <span className="truncate">{row.label}</span>
    </span>
  );
  return (
    <tr className="h-5">
      <td className="truncate py-0.5 text-left">
        {row.agentId !== null ? (
          <button type="button" onClick={() => onOpenAgent(row.agentId!)} className={`${ACTION} -ml-1 max-w-full border-transparent px-1`}>
            {label}
          </button>
        ) : (
          label
        )}
      </td>
      <td className="truncate py-0.5 text-right text-fg-muted" title={row.model ?? undefined}>
        {row.model ?? ''}
      </td>
      <td className="py-0.5 text-right">{row.tokens === null ? '' : formatTokenCount(row.tokens)}</td>
      <td className="py-0.5 text-right">{timeOf(row, startedAt, now)}</td>
    </tr>
  );
}
