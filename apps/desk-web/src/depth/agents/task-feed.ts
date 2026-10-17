// The subagent tree of a transcript (the DC6 plan's M2): MAWS's task graph (`tools/agents/model/task-graph.ts`) fed the
// two ways MAWS's own store feeds it, from what a DX4 subscription carries. Its disk half is the sidecars, here the
// `subagents` metas (each `subagents/*.meta.json` verbatim): a node per agent with its description, type, and depth.
// Its wire half is the transcript's X1 events, here the held rows mapped by MAWS's backfill, which starts an agent at
// the `Agent` call the meta names and ends it at the call's result or, for a background agent, at the
// `<task-notification>` naming the call. MAWS's store takes the wire half from the live `session.events` stream, whose
// `seq` and launch ids the desk has no source for (the renderer survey's wrinkle); the backfill's events need neither.
//
// Status (DC9; the composite's §9.3, DX4's precedence). The held rows give a status only to an agent whose start or end
// they hold, so an agent that ran before them, or a nested one (its spawn is in its parent's transcript), would sit
// under "On disk / status unavailable". A producer of DC8 or later sends each agent's status with what it rests on;
// `withStatuses` patches it onto the graph the held rows built, on the desk side and never in MAWS's `mergeSidecars`.
// DX4's status is authoritative for every entry that carries one, `unknown` included: the machine derives it over the
// whole transcript with DX4's precedence (the parent's transcript, the bridge, the process's end), while the web holds a
// window of rows, and MAWS's backfill reads some of them otherwise (an older launch written without a `toolUseResult`
// is a finished Agent call to it; a sidecar's `stoppedByUser` makes an agent stopped). Where the held rows ended an agent
// DX4 does not, the end's time and summary go with it. The graph it patches is kept apart (the caller holds both), so a
// body that changes later is laid over the rows' own graph again, not over its own earlier patch. A producer older than
// DC8 sends no status: the held rows' events give it, and the graph is the one DC6 drew.
import type { SubagentEntry } from '@shared/ipc/schema/fs';
import type { AgentId, TaskId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import { SubagentMetaSchema } from '@shared/wire/store';
import type { SubagentMeta } from 'desk-hub/protocol';
import { applyTaskEvents, emptyGraph, isEnded, mergeSidecars, type TaskGraph, type TaskNode } from '../../../../../src/renderer/src/tools/agents/model/task-graph';

/** DX4's metas as the sidecar entries the graph merges; a meta that is not a sidecar's shape is a node with no facts. */
export function sidecarsOf(metas: readonly SubagentMeta[]): SubagentEntry[] {
  return metas.map(({ agentId, meta }) => {
    const parsed = SubagentMetaSchema.safeParse(meta);
    return { agentId: agentId as AgentId, meta: parsed.success ? parsed.data : null, transcriptPath: '', size: 0, mtimeMs: 0, runId: null };
  });
}

/**
 * The tree of a transcript's metas and events. The metas go first, as a subscription delivers them (the snapshot's,
 * then its rows), so a rebuilt tree is the one live play built: an agent whose end is held but whose start is not (an
 * older page away) ends as a known node, never a node the events could not find.
 */
export const taskGraphOf = (metas: readonly SubagentMeta[], events: readonly SessionEvent[]): TaskGraph =>
  applyTaskEvents(mergeSidecars(emptyGraph(), sidecarsOf(metas)), [...events]);

/** The tree with one more row's events. */
export const withEvents = (graph: TaskGraph, events: readonly SessionEvent[]): TaskGraph => applyTaskEvents(graph, [...events]);

/** The tree with the metas as they now stand (a meta only adds or fills; a wire fact is never overwritten). */
export const withMetas = (graph: TaskGraph, metas: readonly SubagentMeta[]): TaskGraph => mergeSidecars(graph, sidecarsOf(metas));

type StatusEntry = Extract<SubagentMeta, { status: string }>;
const text = (value: string | null | undefined): string | null => (value ? value : null);

/** One agent's node with DX4's facts laid over what the held rows and its meta gave. */
function patchedNode(node: TaskNode, { status, spawn, outcome, file }: StatusEntry): TaskNode {
  const agent = node.agent;
  const next: TaskNode = {
    ...node,
    description: node.description === node.taskId ? (text(spawn?.description) ?? node.description) : node.description,
    startedAt: node.startedAt ?? file?.firstAt ?? null,
    summary: node.summary ?? text(outcome?.summary),
    outputFile: node.outputFile ?? text(outcome?.outputFile),
    agent: agent && {
      ...agent,
      parentAgentId: agent.parentAgentId ?? ((spawn?.parentAgentId ?? null) as AgentId | null),
      subagentType: agent.subagentType ?? text(spawn?.subagentType),
      name: agent.name ?? text(spawn?.name),
      model: agent.model ?? text(spawn?.model),
    },
  };
  // DX4's status stands. An end the held rows claimed for another status is not this one's: its time and summary go.
  if (status !== node.status) {
    next.status = status;
    next.endedAt = isEnded(status) ? (outcome?.at ?? null) : null;
    next.summary = text(outcome?.summary);
    next.stopping = false;
  }
  return sameNode(node, next) ? node : next;
}

const sameShallow = (a: object | null, b: object | null): boolean =>
  a === b || (a !== null && b !== null && Object.keys(b).every((key) => (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key]));
const sameNode = (a: TaskNode, b: TaskNode): boolean => (Object.keys(b) as (keyof TaskNode)[]).every((key) => (key === 'agent' ? sameShallow(a.agent, b.agent) : a[key] === b[key]));

/**
 * The graph the held rows built, with each agent's status as a producer of DC8 or later carries it (above). The same
 * graph when nothing changes, so MAWS's selectors, memoised on it, keep their answers.
 */
export function withStatuses(held: TaskGraph, metas: readonly SubagentMeta[]): TaskGraph {
  let tasks: Map<TaskId, TaskNode> | null = null;
  for (const entry of metas) {
    if (entry.status === undefined) continue;
    const taskId = entry.agentId as TaskId;
    const node = (tasks ?? held.tasks).get(taskId);
    if (node === undefined) continue;
    const next = patchedNode(node, entry);
    if (next === node) continue;
    tasks ??= new Map(held.tasks);
    tasks.set(taskId, next);
  }
  return tasks === null ? held : { ...held, tasks };
}
