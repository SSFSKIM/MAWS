// The task graph (C8b execution document, Interfaces *The task graph*): one pure reducer family over the X1 task and
// subagent events, the status's background-task list and the engine store's sidecars and workflow runs, keyed by task
// id (an agent's task id and its sidecar's agent id are one string). Immutable by convention: every function returns
// the same graph object when nothing changed, so selectors memoise on it and tests assert identity. Wire facts and
// disk facts are kept apart: the disk half fills what the wire did not give and never overwrites a wire fact.
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionEvent } from '@shared/graph/events';
import { toolUseOf, type AgentId, type TaskId, type ToolUseId } from '@shared/graph/ids';
import type { SubagentEntry, WorkflowRun } from '@shared/ipc/schema/fs';
import type { WorkflowSnapshot } from '@shared/wire/store';
import { SUBAGENTS_COPY } from '../copy';

export type TaskKind = 'agent' | 'workflow' | 'shell' | 'monitor' | 'other'; // local_agent, local_workflow, local_bash, /^monitor/, the rest
export type TaskStatus = 'running' | 'completed' | 'failed' | 'stopped' | 'exited' | 'unknown';
//   running: started and not ended; completed/failed/stopped: the terminal task.notification's (or subagent.finished's) status, or task.updated.patch.status with killed → stopped;
//   exited: the parent process exited while the task was running (a fact: process.exited); unknown: known only from disk, and the sidecar says nothing

export interface AgentFacts {
  subagentType: string | null;
  spawnDepth: number | null;
  parentAgentId: AgentId | null;
  model: string | null;
  name: string | null; // the sidecar's `name` (1 of 3,000 real sidecars carries one), never the description
  prompt: string | null;
  stoppedByUser: boolean | null;
  runId: string | null; // set for a workflow's agent
  transcript: { path: string; size: number; mtimeMs: number } | null;
}

export interface WorkflowFacts {
  workflowName: string | null;
  progress: unknown[] | null; // the latest whole snapshot (wire or disk)
  runId: string | null;
  snapshot: WorkflowSnapshot | null;
}

export interface TaskNode {
  taskId: TaskId;
  kind: TaskKind;
  taskType: string | null;
  toolUseId: ToolUseId | null;
  description: string; // the name: task.started/subagent.started description, else the sidecar's description, else the task id; progress never overwrites it
  status: TaskStatus;
  stopping: boolean; // stopping: session.stopTask sent, no terminal event yet
  startedAt: string | null; // the start event's `at`; null when the task was only ever seen in a snapshot or on disk
  endedAt: string | null; // task.updated.patch.endTime as ISO, else the terminal event's `at`
  usage: { totalTokens: number; toolUses: number; durationMs: number } | null; // subagent.progress, latest
  lastToolName: string | null;
  activity: string | null; // the latest subagent.progress description: what the agent is doing now ("Reading one.txt"), not its dispatch description
  summary: string | null;
  reason: string | null;
  outputFile: string | null;
  isBackground: boolean | null; // the start event's, then task.updated.patch.isBackground; null for a node with no start event
  agent: AgentFacts | null; // agents only
  workflow: WorkflowFacts | null; // workflows only
  provenance: { wire: boolean; disk: boolean; snapshot: boolean };
}

// order: first seen. byToolUse: every tool-use id that started a task (a resumed agent keeps both of its own). issuer:
// the dispatching agent of each `Agent`/`Task` call a child made (Gate G1 verdict (7): C3's subagent.started carries no
// parent field, but the child's own `tool.use` names it and arrives first), read when that call's task starts.
export interface TaskGraph {
  tasks: Map<TaskId, TaskNode>;
  order: TaskId[];
  byToolUse: Map<ToolUseId, TaskId>;
  issuer: Map<ToolUseId, AgentId>;
}

export function emptyGraph(): TaskGraph {
  return { tasks: new Map(), order: [], byToolUse: new Map(), issuer: new Map() };
}

export function kindOf(taskType: string): TaskKind {
  if (taskType === 'local_agent') return 'agent';
  if (taskType === 'local_workflow') return 'workflow';
  if (taskType === 'local_bash') return 'shell';
  if (taskType.startsWith('monitor')) return 'monitor';
  return 'other';
}

const TERMINAL: ReadonlySet<TaskStatus> = new Set(['completed', 'failed', 'stopped', 'exited']);
export const isEnded = (status: TaskStatus) => TERMINAL.has(status);

const blankAgent = (): AgentFacts => ({
  subagentType: null, spawnDepth: null, parentAgentId: null, model: null, name: null, prompt: null, stoppedByUser: null, runId: null, transcript: null,
});
const blankWorkflow = (): WorkflowFacts => ({ workflowName: null, progress: null, runId: null, snapshot: null });

function blankNode(taskId: TaskId, kind: TaskKind, status: TaskStatus): TaskNode {
  return {
    taskId, kind, taskType: null, toolUseId: null, description: taskId, status, stopping: false, startedAt: null, endedAt: null, usage: null,
    lastToolName: null, activity: null, summary: null, reason: null, outputFile: null, isBackground: null,
    agent: kind === 'agent' ? blankAgent() : null, workflow: kind === 'workflow' ? blankWorkflow() : null,
    provenance: { wire: false, disk: false, snapshot: false },
  };
}

// Copy-on-write over one graph: the maps and the order are cloned on the first write, a node is replaced only when a
// field actually differs, and `result()` hands back the original object when nothing did.
class Draft {
  private tasks: Map<TaskId, TaskNode> | null = null;
  private order: TaskId[] | null = null;
  private byToolUse: Map<ToolUseId, TaskId> | null = null;
  private issuer: Map<ToolUseId, AgentId> | null = null;

  constructor(private readonly base: TaskGraph) {}

  get(taskId: TaskId): TaskNode | undefined {
    return (this.tasks ?? this.base.tasks).get(taskId);
  }

  toolUse(toolUseId: ToolUseId): TaskId | undefined {
    return (this.byToolUse ?? this.base.byToolUse).get(toolUseId);
  }

  issuerOf(toolUseId: ToolUseId): AgentId | undefined {
    return (this.issuer ?? this.base.issuer).get(toolUseId);
  }

  nodes(): TaskNode[] {
    return (this.order ?? this.base.order).map((taskId) => this.get(taskId)!);
  }

  put(next: TaskNode): void {
    const current = this.get(next.taskId);
    if (current && sameNode(current, next)) return;
    this.tasks ??= new Map(this.base.tasks);
    if (!current) {
      this.order ??= [...this.base.order];
      this.order.push(next.taskId);
    }
    this.tasks.set(next.taskId, next);
  }

  // A patch over the node, nested `agent`/`workflow` merged one level deep.
  patch(taskId: TaskId, patch: Partial<Omit<TaskNode, 'agent' | 'workflow' | 'provenance'>> & { agent?: Partial<AgentFacts>; workflow?: Partial<WorkflowFacts>; provenance?: Partial<TaskNode['provenance']> }): void {
    const current = this.get(taskId);
    if (!current) return;
    const { agent, workflow, provenance, ...rest } = patch;
    this.put({
      ...current,
      ...rest,
      agent: agent ? { ...(current.agent ?? blankAgent()), ...agent } : current.agent,
      workflow: workflow ? { ...(current.workflow ?? blankWorkflow()), ...workflow } : current.workflow,
      provenance: provenance ? { ...current.provenance, ...provenance } : current.provenance,
    });
  }

  remove(taskId: TaskId): void {
    if (!this.get(taskId)) return;
    this.tasks ??= new Map(this.base.tasks);
    this.tasks.delete(taskId);
    this.order = (this.order ?? this.base.order).filter((t) => t !== taskId);
    const byToolUse = this.byToolUse ?? this.base.byToolUse;
    if ([...byToolUse.values()].includes(taskId)) this.byToolUse = new Map([...byToolUse].filter(([, t]) => t !== taskId));
  }

  mapToolUse(toolUseId: ToolUseId, taskId: TaskId): void {
    if (this.toolUse(toolUseId) === taskId) return;
    this.byToolUse ??= new Map(this.base.byToolUse);
    this.byToolUse.set(toolUseId, taskId);
  }

  setIssuer(toolUseId: ToolUseId, agentId: AgentId): void {
    if (this.issuerOf(toolUseId) === agentId) return;
    this.issuer ??= new Map(this.base.issuer);
    this.issuer.set(toolUseId, agentId);
  }

  result(): TaskGraph {
    if (!this.tasks && !this.order && !this.byToolUse && !this.issuer) return this.base;
    return { tasks: this.tasks ?? this.base.tasks, order: this.order ?? this.base.order, byToolUse: this.byToolUse ?? this.base.byToolUse, issuer: this.issuer ?? this.base.issuer };
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
// Arrays (a workflow's progress, a snapshot) compare by identity: each frame is a new whole snapshot.
const sameNode = (a: TaskNode, b: TaskNode) => sameValue(a, b);

const statusOfPatch = (status: string): TaskStatus | null => {
  if (status === 'killed' || status === 'stopped') return 'stopped';
  if (status === 'completed' || status === 'failed') return status;
  if (status === 'running' || status === 'pending') return 'running';
  return null;
};

function textOf(content: string | { type: string; [key: string]: unknown }[]): string {
  if (typeof content === 'string') return content;
  return content.map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : '')).join('');
}

// `Output is being written to: <path>` in the background Bash tool's result (pass2/per-task-stop-on seq 44): the path
// runs to the next whitespace and the sentence's own period is dropped.
export function parseOutputPath(resultText: string): string | null {
  const match = /Output is being written to: (\S+)/.exec(resultText);
  if (!match) return null;
  const path = match[1].endsWith('.') ? match[1].slice(0, -1) : match[1];
  return path.length > 0 ? path : null;
}

// A start creates the node, fills a snapshot-born or disk-born one, and restarts an ended one (Gate G1 verdict (6): a
// `SendMessage` to a finished agent resumes it under the same task id, announced by a second start): running again,
// not stopping, no end, the new tool use and background flag, the usage and summary kept until progress replaces them.
function applyStart(draft: Draft, e: Extract<SessionEvent, { kind: 'subagent.started' | 'task.started' }>): void {
  const taskType = e.kind === 'subagent.started' ? 'local_agent' : e.taskType;
  const kind = e.kind === 'subagent.started' ? 'agent' : kindOf(e.taskType);
  const current = draft.get(e.taskId) ?? blankNode(e.taskId, kind, 'running');
  const restarted = current.status !== 'running';
  let agent = current.agent;
  if (kind === 'agent') {
    agent = { ...(current.agent ?? blankAgent()) };
    if (e.kind === 'subagent.started') Object.assign(agent, { subagentType: e.subagentType, spawnDepth: e.spawnDepth, prompt: e.prompt });
    const viaIssuer = e.toolUseId === null ? undefined : draft.issuerOf(e.toolUseId);
    const viaLane = e.parentToolUseId === null ? undefined : draft.toolUse(toolUseOf(e.parentToolUseId));
    const parent = viaIssuer ?? (viaLane !== undefined && viaLane !== e.taskId ? (viaLane as unknown as AgentId) : undefined);
    if (parent !== undefined) agent.parentAgentId = parent;
  }
  const workflow = kind === 'workflow' ? { ...(current.workflow ?? blankWorkflow()), ...(e.kind === 'task.started' && e.workflowName !== null ? { workflowName: e.workflowName } : {}) } : current.workflow;
  draft.put({
    ...current,
    kind,
    taskType,
    toolUseId: e.toolUseId ?? current.toolUseId,
    description: e.description || current.description,
    status: 'running',
    stopping: restarted ? false : current.stopping,
    startedAt: e.at,
    endedAt: null,
    isBackground: e.isBackground,
    agent,
    workflow,
    provenance: { ...current.provenance, wire: true },
  });
  if (e.toolUseId !== null) draft.mapToolUse(e.toolUseId, e.taskId);
}

function applyTerminal(draft: Draft, taskId: TaskId, status: TaskStatus, e: { at: string; summary: string | null; outputFile: string | null; reason: string | null }): void {
  const current = draft.get(taskId);
  if (!current) return;
  draft.patch(taskId, {
    status,
    stopping: false,
    summary: e.summary || current.summary,
    outputFile: e.outputFile || current.outputFile,
    reason: e.reason ?? current.reason,
    endedAt: current.endedAt ?? e.at,
    provenance: { wire: true },
  });
}

function applyEvent(draft: Draft, e: SessionEvent): void {
  switch (e.kind) {
    case 'subagent.started':
    case 'task.started':
      applyStart(draft, e);
      return;
    case 'subagent.progress': {
      if (!draft.get(e.taskId)) draft.put({ ...blankNode(e.taskId, 'agent', 'running'), taskType: 'local_agent', provenance: { wire: true, disk: false, snapshot: false } });
      draft.patch(e.taskId, { usage: e.usage, lastToolName: e.lastToolName, summary: e.summary, activity: e.description || draft.get(e.taskId)!.activity, provenance: { wire: true } });
      return;
    }
    case 'task.updated': {
      const current = draft.get(e.taskId);
      if (!current) return;
      const status = e.patch.status === undefined ? null : statusOfPatch(e.patch.status);
      const ended = status !== null && isEnded(status);
      draft.patch(e.taskId, {
        ...(status !== null ? { status } : {}),
        ...(ended ? { stopping: false } : {}),
        ...(e.patch.description ? { description: e.patch.description } : {}),
        ...(e.patch.endTime !== undefined ? { endedAt: new Date(e.patch.endTime).toISOString() } : {}),
        ...(e.patch.error !== undefined ? { reason: e.patch.error } : {}),
        ...(e.patch.isBackground !== undefined ? { isBackground: e.patch.isBackground } : {}),
        provenance: { wire: true },
      });
      return;
    }
    case 'subagent.finished':
      applyTerminal(draft, e.taskId, e.status, e);
      return;
    case 'task.notification':
      applyTerminal(draft, e.taskId, e.status, e);
      return;
    case 'workflow.progress': {
      if (!draft.get(e.taskId)) draft.put({ ...blankNode(e.taskId, 'workflow', 'running'), taskType: 'local_workflow' });
      const current = draft.get(e.taskId)!;
      draft.patch(e.taskId, {
        workflow: { progress: Array.isArray(e.progress) ? e.progress : (current.workflow?.progress ?? null), workflowName: e.workflowName ?? current.workflow?.workflowName ?? null },
        provenance: { wire: true },
      });
      return;
    }
    case 'tasks.snapshot':
      snapshotInto(draft, e.tasks);
      return;
    case 'tool.use': {
      // A child's own Agent/Task call names its dispatcher (R5); the parent's calls (agentId null) and every other tool
      // are not the graph's.
      if ((e.toolName !== 'Agent' && e.toolName !== 'Task') || e.agentId === null) return;
      draft.setIssuer(e.toolUseId, e.agentId);
      const started = draft.toolUse(e.toolUseId);
      const child = started === undefined ? undefined : draft.get(started);
      if (child?.agent && child.agent.parentAgentId === null && child.taskId !== (e.agentId as unknown as TaskId)) draft.patch(child.taskId, { agent: { parentAgentId: e.agentId } });
      return;
    }
    case 'tool.result': {
      const structured = e.structured as { backgroundTaskId?: unknown } | null;
      const taskId = structured && typeof structured === 'object' && typeof structured.backgroundTaskId === 'string' ? (structured.backgroundTaskId as TaskId) : null;
      if (taskId === null || !draft.get(taskId)) return;
      const path = parseOutputPath(textOf(e.content));
      if (path !== null) draft.patch(taskId, { outputFile: path });
      return;
    }
    case 'process.exited':
      if (e.agentId === null) exitInto(draft, e.at);
      return;
    default:
      return;
  }
}

// The kinds the reducer reads; every other kind returns the same graph (turn.* of any origin among them).
export const TASK_EVENT_KINDS: ReadonlySet<SessionEvent['kind']> = new Set([
  'subagent.started', 'subagent.progress', 'subagent.finished', 'task.started', 'task.updated', 'task.notification', 'tasks.snapshot',
  'workflow.progress', 'tool.use', 'tool.result', 'process.exited',
]);

export function applyTaskEvents(graph: TaskGraph, events: SessionEvent[]): TaskGraph {
  if (events.length === 0) return graph;
  const draft = new Draft(graph);
  for (const e of events) if (TASK_EVENT_KINDS.has(e.kind)) applyEvent(draft, e);
  return draft.result();
}

function snapshotInto(draft: Draft, tasks: EngineSessionStatus['backgroundTasks']): void {
  for (const t of tasks) {
    if (draft.get(t.taskId)) continue;
    draft.put({ ...blankNode(t.taskId, kindOf(t.taskType), 'running'), taskType: t.taskType, description: t.description || t.taskId, provenance: { wire: false, disk: false, snapshot: true } });
  }
}

// tasks.snapshot and the status's backgroundTasks: creates, never removes (the engine's stop emits the absent snapshot
// before the terminal frames; removal is the store's resolution rule).
export function applySnapshot(graph: TaskGraph, tasks: EngineSessionStatus['backgroundTasks']): TaskGraph {
  const draft = new Draft(graph);
  snapshotInto(draft, tasks);
  return draft.result();
}

function exitInto(draft: Draft, at: string): void {
  for (const n of draft.nodes()) if (n.status === 'running') draft.patch(n.taskId, { status: 'exited', stopping: false, endedAt: n.endedAt ?? at });
}

export function markExited(graph: TaskGraph, at: string): TaskGraph {
  const draft = new Draft(graph);
  exitInto(draft, at);
  return draft.result();
}

export function removeTask(graph: TaskGraph, taskId: TaskId): TaskGraph {
  const draft = new Draft(graph);
  draft.remove(taskId);
  return draft.result();
}

// The store's mark between `session.stopTask` and the terminal frames.
export function setStopping(graph: TaskGraph, taskId: TaskId, stopping: boolean): TaskGraph {
  const draft = new Draft(graph);
  draft.patch(taskId, { stopping });
  return draft.result();
}

// The sidecars (`fs.subagents`): a node per entry the graph lacks, `unknown` unless the sidecar says `stoppedByUser`
// (the one status fact a sidecar carries); every agent gains the disk-only facts and keeps its wire ones.
export function mergeSidecars(graph: TaskGraph, agents: SubagentEntry[]): TaskGraph {
  const draft = new Draft(graph);
  for (const entry of agents) {
    const taskId = entry.agentId as unknown as TaskId;
    const meta = entry.meta;
    if (!draft.get(taskId)) draft.put({ ...blankNode(taskId, 'agent', 'unknown'), provenance: { wire: false, disk: true, snapshot: false } });
    const current = draft.get(taskId)!;
    const agent = current.agent ?? blankAgent();
    const transcript = agent.transcript && agent.transcript.path === entry.transcriptPath && agent.transcript.size === entry.size && agent.transcript.mtimeMs === entry.mtimeMs
      ? agent.transcript
      : { path: entry.transcriptPath, size: entry.size, mtimeMs: entry.mtimeMs };
    draft.patch(taskId, {
      ...(current.description === current.taskId && meta?.description ? { description: meta.description } : {}),
      ...(current.status === 'unknown' && meta?.stoppedByUser === true ? { status: 'stopped' as const } : {}),
      agent: {
        model: agent.model ?? meta?.model ?? null,
        spawnDepth: agent.spawnDepth ?? meta?.spawnDepth ?? null,
        parentAgentId: agent.parentAgentId ?? ((meta?.parentAgentId as AgentId | undefined) ?? null),
        subagentType: agent.subagentType ?? meta?.agentType ?? null,
        name: meta?.name ?? agent.name,
        stoppedByUser: meta?.stoppedByUser ?? agent.stoppedByUser,
        runId: agent.runId ?? entry.runId,
        transcript,
      },
      provenance: { disk: true },
    });
  }
  return draft.result();
}

const snapshotStatus = (status: string | undefined): TaskStatus => (status === undefined ? 'unknown' : (statusOfPatch(status) ?? 'unknown'));

// The workflow runs (`fs.workflows`): matched to the wire node by the snapshot's `taskId`, else to the node an earlier
// read made for the run, else a disk node keyed by the snapshot's task id (so a start that arrives later fills it), or by
// the run id when the snapshot is not readable yet. The snapshot's status is a disk fact, taken only by a node the wire
// has not described; its progress fills the node until the wire gives one.
export function mergeRuns(graph: TaskGraph, runs: WorkflowRun[]): TaskGraph {
  const draft = new Draft(graph);
  for (const run of runs) {
    const snapshot = run.snapshot;
    const taskIdOfRun = snapshot?.taskId as TaskId | undefined;
    const existing =
      (taskIdOfRun !== undefined ? draft.get(taskIdOfRun) : undefined) ?? draft.nodes().find((n) => n.workflow?.runId === run.runId);
    const key = existing?.taskId ?? taskIdOfRun ?? (run.runId as TaskId);
    if (!existing) draft.put({ ...blankNode(key, 'workflow', 'unknown'), taskType: 'local_workflow', provenance: { wire: false, disk: true, snapshot: false } });
    const current = draft.get(key)!;
    const workflow = current.workflow ?? blankWorkflow();
    const wireKnown = current.provenance.wire || current.provenance.snapshot;
    const progressFromDisk = workflow.progress === null || workflow.progress === (workflow.snapshot?.workflowProgress ?? null) || !current.provenance.wire;
    draft.patch(key, {
      ...(current.description === current.taskId && snapshot?.summary ? { description: snapshot.summary } : {}),
      ...(!wireKnown ? { status: snapshotStatus(snapshot?.status) } : {}),
      workflow: {
        runId: run.runId,
        snapshot,
        workflowName: workflow.workflowName ?? snapshot?.workflowName ?? null,
        progress: progressFromDisk && snapshot?.workflowProgress ? snapshot.workflowProgress : workflow.progress,
      },
      provenance: { disk: true },
    });
  }
  return draft.result();
}

// ---------------------------------------------------------------------------------------------------------------------
// Selectors, memoised on the graph object.

const memo = new WeakMap<TaskGraph, Map<string, unknown>>();
function memoised<T>(graph: TaskGraph, key: string, compute: () => T): T {
  let cache = memo.get(graph);
  if (!cache) memo.set(graph, (cache = new Map()));
  if (!cache.has(key)) cache.set(key, compute());
  return cache.get(key) as T;
}

const nodesOf = (graph: TaskGraph) => graph.order.map((taskId) => graph.tasks.get(taskId)!);
const endedMs = (n: TaskNode) => (n.endedAt === null ? -Infinity : Date.parse(n.endedAt));
// Newest end first; a node without an end time after the ones with one, each group in first-seen order (a stable sort).
const newestEndFirst = (nodes: TaskNode[]) => [...nodes].sort((a, b) => endedMs(b) - endedMs(a) || 0);
const listedAgent = (n: TaskNode) => n.kind === 'agent' && (n.agent?.runId ?? null) === null;

export type AgentSection = 'active' | 'done' | 'disk';
export interface AgentRow {
  taskId: TaskId;
  depth: number;
  parentTaskId: TaskId | null;
  orphan: boolean; // orphan: the parent is known but sits in another section, or is unknown to the graph; depth 0 then
}

// A row's title and second line, one rule for the lists, the drill-in and the summaries (controller, 2026-09-29, M1 task
// 2's open item 13): the title is the sidecar's real name, else the dispatch description; the second line is the latest
// summary, else the current activity, else the description when the title is a name, else `Working`.
const present = (text: string | null | undefined) => (text ? text : null);
export const rowTitle = (node: TaskNode): string => present(node.agent?.name) ?? node.description;
export function rowSecondLine(node: TaskNode): string {
  return present(node.summary) ?? present(node.activity) ?? (present(node.agent?.name) ? node.description : null) ?? SUBAGENTS_COPY.working;
}

export const sectionOf = (n: TaskNode): AgentSection => (n.status === 'running' ? 'active' : n.status === 'unknown' ? 'disk' : 'done');

// One render rule for the three lists: active = running agents in first-seen order; done = ended, exited and
// stopped-by-sidecar agents, newest end first; disk = status unknown. Every section nests a child under its parent when
// the parent is in the same section and marks it orphan otherwise. A workflow's agents are in no section.
export function agentRows(graph: TaskGraph, section: AgentSection): AgentRow[] {
  return memoised(graph, `rows:${section}`, () => {
    const members = nodesOf(graph).filter((n) => listedAgent(n) && sectionOf(n) === section);
    const ordered = section === 'done' ? newestEndFirst(members) : members;
    const inSection = new Set(ordered.map((n) => n.taskId));
    const parentOf = (n: TaskNode) => (n.agent?.parentAgentId ?? null) as unknown as TaskId | null;
    const children = new Map<TaskId, TaskNode[]>();
    const roots: TaskNode[] = [];
    for (const n of ordered) {
      const parent = parentOf(n);
      if (parent !== null && parent !== n.taskId && inSection.has(parent)) children.set(parent, [...(children.get(parent) ?? []), n]);
      else roots.push(n);
    }
    const rows: AgentRow[] = [];
    const seen = new Set<TaskId>();
    const visit = (n: TaskNode, depth: number) => {
      if (seen.has(n.taskId)) return;
      seen.add(n.taskId);
      const parent = parentOf(n);
      rows.push({ taskId: n.taskId, depth, parentTaskId: parent, orphan: depth === 0 && parent !== null });
      for (const child of children.get(n.taskId) ?? []) visit(child, depth + 1);
    };
    for (const root of roots) visit(root, 0);
    for (const n of ordered) visit(n, 0); // a parent cycle leaves its members unvisited: list them flat rather than lose them
    return rows;
  });
}

const runningFirst = (nodes: TaskNode[]) => [...nodes.filter((n) => n.status === 'running'), ...newestEndFirst(nodes.filter((n) => n.status !== 'running'))];

export function workflows(graph: TaskGraph): TaskNode[] {
  return memoised(graph, 'workflows', () => runningFirst(nodesOf(graph).filter((n) => n.kind === 'workflow')));
}

// A shell is listed only while it is in the background (Gate G1 verdict (8): every foreground Bash call that runs a few
// seconds registers a `local_bash` task with `isBackground: false`). A shell known only from the engine's background
// task list has no start event and so no flag, but that list is the background one (R1: it never names a foreground call).
const inBackground = (n: TaskNode) => n.isBackground === true || (n.isBackground === null && n.provenance.snapshot);
export function shells(graph: TaskGraph): TaskNode[] {
  return memoised(graph, 'shells', () => runningFirst(nodesOf(graph).filter((n) => n.kind === 'shell' && inBackground(n))));
}

export function monitors(graph: TaskGraph): TaskNode[] {
  return memoised(graph, 'monitors', () => runningFirst(nodesOf(graph).filter((n) => n.kind === 'monitor')));
}

// working: running agents; done: ended, exited and stopped-by-sidecar agents; onDisk: agents known only from disk; the
// last three: what runs now. A workflow's agents are counted nowhere.
export function counts(graph: TaskGraph): { working: number; done: number; onDisk: number; shells: number; workflows: number; monitors: number } {
  return memoised(graph, 'counts', () => {
    const agents = nodesOf(graph).filter(listedAgent);
    const running = (list: TaskNode[]) => list.filter((n) => n.status === 'running').length;
    return {
      working: agents.filter((n) => sectionOf(n) === 'active').length,
      done: agents.filter((n) => sectionOf(n) === 'done').length,
      onDisk: agents.filter((n) => sectionOf(n) === 'disk').length,
      shells: running(shells(graph)),
      workflows: running(workflows(graph)),
      monitors: running(monitors(graph)),
    };
  });
}
