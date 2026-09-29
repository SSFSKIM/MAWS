// A workflow's progress as the Background work card reads it (C8b execution document, Interfaces *Background work's
// data*): each `workflow.progress` frame, and a run's disk snapshot, is one whole array of phase and agent rows (C2's
// finding; pass2/workflow.jsonl seq 82, workflow-disk/wf_*.json). Rows that fail the parse are dropped, never thrown.
import * as z from 'zod';
import type { AgentId } from '@shared/graph/ids';
import { BACKGROUND_COPY } from '../copy';
import type { TaskNode } from './task-graph';

export const WorkflowProgressRowSchema = z.union([
  z.looseObject({ type: z.literal('workflow_phase'), index: z.number(), title: z.string() }),
  z.looseObject({ type: z.literal('workflow_agent'), index: z.number(), label: z.string(), phaseIndex: z.number(), phaseTitle: z.string().optional(), agentId: z.string().optional(), model: z.string().optional(), state: z.string(), startedAt: z.number().optional(), queuedAt: z.number().optional(), attempt: z.number().optional(), tokens: z.number().optional(), toolCalls: z.number().optional(), durationMs: z.number().optional(), resultPreview: z.string().optional(), promptPreview: z.string().optional(), lastProgressAt: z.number().optional() }),
]); // pass2/workflow.jsonl seq 82 and workflow-disk/wf_*.json; rows that fail the parse are dropped, never thrown
export type WorkflowProgressRow = z.infer<typeof WorkflowProgressRowSchema>;
export type WorkflowAgentRow = Extract<WorkflowProgressRow, { type: 'workflow_agent' }>;

export interface WorkflowPhase {
  index: number;
  title: string;
  agents: WorkflowAgentRow[];
  done: number;
  total: number;
  state: 'queued' | 'running' | 'done';
}

// The parsed rows, one per agent index (the latest row wins, so a retried agent is counted once).
function rowsOf(progress: unknown[] | null): { phases: Map<number, string>; agents: WorkflowAgentRow[] } {
  const phases = new Map<number, string>();
  const agents = new Map<number, WorkflowAgentRow>();
  for (const raw of progress ?? []) {
    const parsed = WorkflowProgressRowSchema.safeParse(raw);
    if (!parsed.success) continue;
    if (parsed.data.type === 'workflow_phase') phases.set(parsed.data.index, parsed.data.title);
    else agents.set(parsed.data.index, parsed.data);
  }
  return { phases, agents: [...agents.values()].sort((a, b) => a.index - b.index) };
}

// Agents grouped by phaseIndex under their phase row (a phase with no row takes an agent's phaseTitle, else `Phase <n>`);
// done counts state `done`; queued while no agent has started, done when every agent is, running otherwise.
export function phasesOf(progress: unknown[] | null): WorkflowPhase[] {
  const { phases, agents } = rowsOf(progress);
  const indices = new Set([...phases.keys(), ...agents.map((a) => a.phaseIndex)]);
  return [...indices]
    .sort((a, b) => a - b)
    .map((index) => {
      const members = agents.filter((a) => a.phaseIndex === index);
      const done = members.filter((a) => a.state === 'done').length;
      const started = members.some((a) => a.startedAt !== undefined);
      const title = phases.get(index) ?? members.find((a) => a.phaseTitle)?.phaseTitle ?? BACKGROUND_COPY.phaseUntitled(index);
      const state = !started ? 'queued' : done === members.length ? 'done' : 'running';
      return { index, title, agents: members, done, total: members.length, state };
    });
}

export interface WorkflowAgentTableRow {
  label: string;
  model: string | null;
  state: string;
  tokens: number | null;
  durationMs: number | null;
  agentId: AgentId | null; // a queued agent has none, so its row opens nothing
}

export function agentTableOf(phase: WorkflowPhase): WorkflowAgentTableRow[] {
  return phase.agents.map((a) => ({
    label: a.label, model: a.model ?? null, state: a.state, tokens: a.tokens ?? null, durationMs: a.durationMs ?? null, agentId: (a.agentId as AgentId | undefined) ?? null,
  }));
}

// agents: the distinct agent rows; tokens: the snapshot's totalTokens, else the rows' sum, null when no row has tokens;
// elapsedMs: the snapshot's durationMs, else the node's end minus its start, null while it runs (the view ticks it).
export function workflowTotals(node: TaskNode, progress: unknown[] | null): { agents: number; tokens: number | null; elapsedMs: number | null } {
  const { agents } = rowsOf(progress);
  const snapshot = node.workflow?.snapshot as { totalTokens?: unknown; durationMs?: unknown } | null | undefined;
  const counted = agents.filter((a) => a.tokens !== undefined);
  const rowTokens = counted.length === 0 ? null : counted.reduce((sum, a) => sum + (a.tokens ?? 0), 0);
  const span = node.startedAt !== null && node.endedAt !== null ? Math.max(0, Date.parse(node.endedAt) - Date.parse(node.startedAt)) : null;
  return {
    agents: agents.length,
    tokens: typeof snapshot?.totalTokens === 'number' ? snapshot.totalTokens : rowTokens,
    elapsedMs: typeof snapshot?.durationMs === 'number' ? snapshot.durationMs : span,
  };
}
