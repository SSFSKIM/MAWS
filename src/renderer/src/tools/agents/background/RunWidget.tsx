// The workflow widget (E7 execution document, Design §2; the vault's widget layout, advisory): one run in Background
// work's drill-in view. A header with the run's description, its line, the badge once ended or `Stop workflow` while it
// runs and the session is live here; below, phases on the left (`All phases` first, each `<title>` with `<done>/<total>`
// or `Queued` and a state mark) and the selected phase's agents on the right (glyph, label, model, state, time, tokens),
// stacked below 360 px of width. A row with an agent id opens its transcript in the Subagents drill-in; one without is
// inert. The same model draws a live run (each `workflow.progress`) and one from disk (each `fs.workflowChanged` read).
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { AgentId, AppSessionId, TaskId } from '@shared/graph/ids';
import { Icon } from '../../../app/IconButton';
import type { PanelToolContext } from '../../../panel/tool';
import { glyphFor, SubagentGlyph } from '../../../transcript';
import { BACKGROUND_COPY } from '../copy';
import { formatElapsed, formatTokenCount } from '../model/elapsed';
import { emptyGraph } from '../model/task-graph';
import { agentsOf, defaultPhase, resolveRun, runView, type PhaseSelection, type RunAgent, type RunPhase } from '../model/workflow-run';
import { useTaskGraph } from '../store';
import { useTicker } from '../subagents/shared';
import { AGENT_TOOL_IDS } from '../tool-ids';
import type { BackgroundHandle } from './BackgroundTool';
import { StopButton, StopError } from './TaskRows';
import { RunBadge, runLine } from './WorkflowCard';

const EMPTY_GRAPH = emptyGraph();

interface Props {
  appSessionId: AppSessionId;
  handle: BackgroundHandle;
  openedOn: string; // the id the view was opened on: the node's task id, or a run id a later read folds into a task id
  phase: PhaseSelection | null; // null: the default, following the run
  stopError: (taskId: TaskId) => string | null;
  ctx: PanelToolContext;
}

export function RunWidget({ appSessionId, handle, openedOn, phase, stopError, ctx }: Props) {
  const graph = useTaskGraph((s) => s.entries.get(appSessionId)?.graph ?? EMPTY_GRAPH);
  const runs = useTaskGraph((s) => s.entries.get(appSessionId)?.disk.runs ?? null);
  const taskId = resolveRun(graph, [openedOn]);
  const node = taskId === null ? undefined : graph.tasks.get(taskId);
  const now = useTicker(ctx.visible && node?.status === 'running');
  const back = (
    <button type="button" onClick={handle.back} className="self-start rounded-sm text-ui-sm text-fg-muted outline-accent hover:text-fg focus-visible:outline-2">
      {BACKGROUND_COPY.back}
    </button>
  );
  if (!node) {
    return (
      <div data-view="run" className="flex h-full min-h-0 flex-col gap-2 overflow-auto px-3.5 py-2">
        {back}
        <p className="text-ui-sm text-fg-muted">{BACKGROUND_COPY.runNotFound}</p>
      </div>
    );
  }
  const run = runs?.find((r) => r.runId === node.workflow?.runId) ?? null;
  const view = runView(node, run, now);
  // the owner's pick while the snapshot still has it, else the default (a phase a later snapshot dropped)
  const kept = phase === 'all' || view.phases.some((p) => p.index === phase) ? phase : null;
  const selection = kept ?? defaultPhase(view.phases);
  const live = ctx.status !== null;
  // the selection names its session, so a pinned Subagents tab still on another session follows this one first
  const openAgent = (agentId: AgentId) => ctx.openTool(AGENT_TOOL_IDS.subagents, { appSessionId, params: { agentId, appSessionId } });
  return (
    <div data-view="run" data-run={node.taskId} data-task-id={node.taskId} className="@container flex h-full min-h-0 flex-col overflow-auto">
      <header className="flex shrink-0 flex-col gap-1 border-b border-border px-3.5 pt-2 pb-2">
        {back}
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 truncate text-ui font-semibold">{node.description}</h2>
          <RunBadge node={node} />
        </div>
        <p data-part="line" className="truncate text-ui-sm text-fg-muted tabular-nums">
          {runLine(node, view)}
        </p>
        {node.status === 'running' && live && (
          <div className="mt-1 flex flex-col items-start gap-1">
            <StopButton node={node} label={BACKGROUND_COPY.stopWorkflow} onStop={handle.stop} />
          </div>
        )}
        <StopError message={stopError(node.taskId)} />
      </header>
      {view.phases.length === 0 ? (
        <p className="px-3.5 pt-3 text-ui-sm text-fg-muted">{BACKGROUND_COPY.phasesPending}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col @min-[360px]:flex-row">
          <PhaseList phases={view.phases} selection={selection} running={view.running} onSelect={handle.selectPhase} />
          <AgentTable phases={view.phases} selection={selection} onOpenAgent={openAgent} />
        </div>
      )}
    </div>
  );
}

// The phase column: a listbox whose ↑/↓ move the selection (`All phases` first), each option a click target too.
function PhaseList({ phases, selection, running, onSelect }: { phases: RunPhase[]; selection: PhaseSelection; running: boolean; onSelect: (selection: PhaseSelection) => void }) {
  const order: PhaseSelection[] = ['all', ...phases.map((p) => p.index)];
  const list = useRef<HTMLDivElement>(null);
  const base = useId(); // option ids unique per widget, for `aria-activedescendant`
  const optionId = (option: PhaseSelection) => `${base}phase-${option}`;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const at = Math.max(0, order.indexOf(selection));
    const next = order[Math.min(order.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))];
    onSelect(next);
    list.current?.querySelector(`[data-phase-option="${next}"]`)?.scrollIntoView?.({ block: 'nearest' });
  };
  return (
    <div
      ref={list}
      role="listbox"
      tabIndex={0}
      aria-label={BACKGROUND_COPY.phasesLabel}
      aria-activedescendant={optionId(selection)}
      onKeyDown={onKeyDown}
      className="flex shrink-0 flex-col border-b border-border py-1 outline-accent focus-visible:outline-2 @min-[360px]:w-2/5 @min-[360px]:max-w-60 @min-[360px]:border-r @min-[360px]:border-b-0"
    >
      <PhaseOption id={optionId('all')} selection="all" selected={selection === 'all'} title={BACKGROUND_COPY.allPhases} count="" mark={null} onSelect={onSelect} />
      {phases.map((phase) => (
        <PhaseOption
          key={phase.index}
          id={optionId(phase.index)}
          selection={phase.index}
          selected={selection === phase.index}
          state={phase.state}
          title={phase.title}
          count={phase.state === 'queued' ? BACKGROUND_COPY.phaseCountQueued : BACKGROUND_COPY.phaseCount(phase.done, phase.total)}
          mark={<PhaseMark state={phase.state} running={running} />}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function PhaseOption({
  id, selection, selected, state, title, count, mark, onSelect,
}: { id: string; selection: PhaseSelection; selected: boolean; state?: RunPhase['state']; title: string; count: string; mark: ReactNode; onSelect: (selection: PhaseSelection) => void }) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      data-phase-option={selection}
      data-state={state}
      onClick={() => onSelect(selection)}
      className={`flex h-7 cursor-default items-center gap-2 px-3.5 text-ui-sm ${selected ? 'bg-bg-hover font-medium text-fg' : 'text-fg hover:bg-bg-hover'}`}
    >
      <span className="flex size-3 shrink-0 items-center justify-center">{mark}</span>
      <span data-part="title" className="min-w-0 flex-1 truncate">
        {title}
      </span>
      <span data-part="count" className="shrink-0 text-fg-muted tabular-nums">
        {count}
      </span>
    </div>
  );
}

// Queued: a hollow dot; running: a spinner while the run runs (a dot once it ended unfinished); done: a check.
function PhaseMark({ state, running }: { state: RunPhase['state']; running: boolean }) {
  if (state === 'done') return <Check />;
  if (state === 'running' && running) return <Spinner label={state} />;
  return <span role="img" aria-label={state} className={`size-1.5 rounded-full ${state === 'queued' ? 'border border-border-strong' : 'bg-border-strong'}`} />;
}

const Check = ({ hidden = false }: { hidden?: boolean }) => (
  <span role={hidden ? undefined : 'img'} aria-label={hidden ? undefined : BACKGROUND_COPY.phaseDone} aria-hidden={hidden || undefined} className="text-success">
    <Icon className="size-3">
      <path d="M3.5 8.5l3 3 6-7" />
    </Icon>
  </span>
);
const Spinner = ({ label }: { label: string | null }) => <span role={label === null ? undefined : 'img'} aria-label={label ?? undefined} aria-hidden={label === null || undefined} className="size-2.5 shrink-0 animate-spin rounded-full border border-border-strong border-t-accent" />;

function AgentTable({ phases, selection, onOpenAgent }: { phases: RunPhase[]; selection: PhaseSelection; onOpenAgent: (agentId: AgentId) => void }) {
  const agents = agentsOf(phases, selection);
  const title = selection === 'all' ? BACKGROUND_COPY.allPhases : (phases.find((p) => p.index === selection)?.title ?? '');
  const columns = BACKGROUND_COPY.columns;
  if (agents.length === 0) return <p className="min-w-0 flex-1 px-3.5 pt-2 text-ui-sm text-fg-muted">{BACKGROUND_COPY.noAgentsInPhase}</p>;
  return (
    <div className="min-w-0 flex-1 px-3 py-1">
      <table aria-label={BACKGROUND_COPY.agentsLabel(title)} className="w-full table-fixed border-collapse text-ui-sm tabular-nums">
        <thead>
          <tr className="border-b border-border text-fg-muted">
            <th className="w-[38%] py-0.5 text-left font-normal">{columns.agent}</th>
            <th className="w-[20%] py-0.5 text-left font-normal">{columns.model}</th>
            <th className="py-0.5 text-left font-normal">{columns.state}</th>
            <th className="py-0.5 text-right font-normal">{columns.time}</th>
            <th className="py-0.5 text-right font-normal">{columns.tokens}</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <AgentRow key={agent.key} agent={agent} onOpenAgent={onOpenAgent} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgentRow({ agent, onOpenAgent }: { agent: RunAgent; onOpenAgent: (agentId: AgentId) => void }) {
  const { agentId } = agent;
  const label = (
    <span className="flex min-w-0 items-center gap-1.5">
      {agentId !== null && (
        <SubagentGlyph
          agent={{ taskId: agentId as unknown as TaskId, agentId, toolUseId: null, name: agent.label, glyph: glyphFor(agentId), kind: 'agent', subagentType: null }}
          className="shrink-0 text-accent"
        />
      )}
      <span data-part="agent-label" className="truncate">
        {agent.label}
      </span>
    </span>
  );
  return (
    <tr data-run-agent={agent.key} className="h-6">
      <td data-part="label" className="truncate py-0.5 text-left">
        {agentId !== null ? (
          <button type="button" onClick={() => onOpenAgent(agentId)} className="-ml-1 max-w-full rounded-sm px-1 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2">
            {label}
          </button>
        ) : (
          <span title={agent.state === 'queued' ? BACKGROUND_COPY.notStarted : BACKGROUND_COPY.noTranscript} className="block">
            {label}
          </span>
        )}
      </td>
      <td data-part="model" className="truncate py-0.5 text-left text-fg-muted" title={agent.model ?? undefined}>
        {agent.model ?? ''}
      </td>
      <td data-part="state" className="truncate py-0.5 text-left">
        <span className="flex min-w-0 items-center gap-1.5">
          {agent.state === 'done' ? <Check hidden /> : agent.live ? <Spinner label={null} /> : null}
          <span className={`truncate ${agent.state === 'done' ? 'text-fg-muted' : ''}`}>{agent.state}</span>
        </span>
      </td>
      <td data-part="time" className="py-0.5 text-right">
        {agent.elapsedMs === null ? '' : formatElapsed(agent.elapsedMs)}
      </td>
      <td data-part="tokens" className="py-0.5 text-right">
        {agent.tokens === null ? '' : formatTokenCount(agent.tokens)}
      </td>
    </tr>
  );
}
