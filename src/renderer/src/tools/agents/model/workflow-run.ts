// A workflow run as the Background work widget reads it (E7 execution document, Design §2): the phases of the latest
// whole progress snapshot (wire or disk, `phasesOf`), each agent row with the id that opens its transcript, its time and
// tokens; the run's totals; the card's one-line summary; and the resolution of an id a hand-off names (a task id, the
// Workflow call's tool-use id, a run id) to the run's node. Pure: the widget passes the clock.
import type { AgentId, TaskId, ToolUseId } from '@shared/graph/ids';
import type { WorkflowRun } from '@shared/ipc/schema/fs';
import type { TaskGraph, TaskNode } from './task-graph';
import { agentTableOf, phasesOf, workflowTotals, type WorkflowPhase } from './workflow-progress';

export interface RunAgent {
  key: string; // the progress row's agent index: stable across frames
  label: string;
  agentId: AgentId | null; // null: the row opens nothing (a queued agent, or no id on the row nor in the journal)
  model: string | null;
  state: string; // the engine's word (`queued`, `running`, `done`, else as given)
  tokens: number | null;
  elapsedMs: number | null; // the engine's duration once reported, else from the agent's start while the run runs
  live: boolean; // started, not done, and the run still runs: its time ticks
}

export interface RunPhase {
  index: number;
  title: string;
  done: number;
  total: number;
  state: WorkflowPhase['state'];
  agents: RunAgent[];
}

export interface RunView {
  phases: RunPhase[];
  running: boolean;
  agents: number;
  tokens: number | null;
  elapsedMs: number | null; // the run's: from its start while it runs, else the snapshot's or the span's
}

export type PhaseSelection = number | 'all';

const keyOf = (phase: string | undefined, label: string) => `${phase ?? ''}\u0000${label}`;

// The journal's `started`/`result` rows that carry both an agent id and a label, by phase title and label: the last id
// wins (a retried agent's latest attempt). A row without a phase matches on its label alone.
function journalIds(run: WorkflowRun | null): { byPhase: Map<string, AgentId>; byLabel: Map<string, AgentId> } {
  const byPhase = new Map<string, AgentId>();
  const byLabel = new Map<string, AgentId>();
  for (const row of run?.journal ?? []) {
    if ((row.type !== 'started' && row.type !== 'result') || !row.agentId || row.label === undefined) continue;
    if (row.phase === undefined) byLabel.set(row.label, row.agentId as AgentId);
    else byPhase.set(keyOf(row.phase, row.label), row.agentId as AgentId);
  }
  return { byPhase, byLabel };
}

export function runView(node: TaskNode, run: WorkflowRun | null, now: number): RunView {
  const progress = node.workflow?.progress ?? null;
  const phases = phasesOf(progress);
  const totals = workflowTotals(node, progress);
  const running = node.status === 'running';
  const journal = journalIds(run);
  // Two rows sharing a phase and a label cannot be told apart by the journal: they stay inert rather than guess.
  const shared = new Map<string, number>();
  for (const phase of phases) for (const a of phase.agents) shared.set(keyOf(phase.title, a.label), (shared.get(keyOf(phase.title, a.label)) ?? 0) + 1);
  const fromJournal = (phase: WorkflowPhase, label: string): AgentId | null => {
    const key = keyOf(phase.title, label);
    if ((shared.get(key) ?? 0) > 1) return null;
    return journal.byPhase.get(key) ?? journal.byLabel.get(label) ?? null;
  };
  return {
    phases: phases.map((phase) => ({
      index: phase.index,
      title: phase.title,
      done: phase.done,
      total: phase.total,
      state: phase.state,
      agents: agentTableOf(phase).map((row, i) => {
        const startedAt = phase.agents[i].startedAt ?? null;
        const live = running && row.state !== 'done' && startedAt !== null;
        return {
          key: String(phase.agents[i].index),
          label: row.label,
          agentId: row.agentId ?? fromJournal(phase, row.label),
          model: row.model,
          state: row.state,
          tokens: row.tokens,
          elapsedMs: row.durationMs ?? (live ? Math.max(0, now - startedAt) : null),
          live: row.durationMs === null && live,
        };
      }),
    })),
    running,
    agents: totals.agents,
    tokens: totals.tokens,
    elapsedMs: running && node.startedAt !== null ? Math.max(0, now - Date.parse(node.startedAt)) : totals.elapsedMs,
  };
}

// The first running phase, else the last; `all` when there is none.
export function defaultPhase(phases: RunPhase[]): PhaseSelection {
  return (phases.find((p) => p.state === 'running') ?? phases.at(-1))?.index ?? 'all';
}

export function agentsOf(phases: RunPhase[], selection: PhaseSelection): RunAgent[] {
  return selection === 'all' ? phases.flatMap((p) => p.agents) : (phases.find((p) => p.index === selection)?.agents ?? []);
}

// The compact card's line: `Queued` while no phase has started, `Done` once every phase is, else the first unfinished
// phase with its counts. Null with no phases yet (the card says they arrive with the first frame).
export type RunSummary = { kind: 'queued' } | { kind: 'done' } | { kind: 'phase'; title: string; done: number; total: number };
export function runSummary(phases: RunPhase[]): RunSummary | null {
  if (phases.length === 0) return null;
  if (phases.every((p) => p.state === 'queued')) return { kind: 'queued' };
  const current = phases.find((p) => p.state !== 'done');
  return current ? { kind: 'phase', title: current.title, done: current.done, total: current.total } : { kind: 'done' };
}

// The run node an id names, trying each id in order: a workflow node with that task id; the task the Workflow call's
// tool use started; a workflow node whose run id or snapshot's task id it is. Null while no read has brought it.
export function resolveRun(graph: TaskGraph, ids: readonly string[]): TaskId | null {
  const isRun = (node: TaskNode | undefined): node is TaskNode => node?.kind === 'workflow';
  for (const id of ids) {
    const direct = graph.tasks.get(id as TaskId);
    if (isRun(direct)) return direct.taskId;
    const started = graph.byToolUse.get(id as ToolUseId);
    if (started !== undefined && isRun(graph.tasks.get(started))) return started;
    for (const taskId of graph.order) {
      const node = graph.tasks.get(taskId);
      if (isRun(node) && (node.workflow?.runId === id || node.workflow?.snapshot?.taskId === id)) return node.taskId;
    }
  }
  return null;
}
