// The subagent tree of a transcript (the DC6 plan's M2): MAWS's task graph (`tools/agents/model/task-graph.ts`) fed the
// two ways MAWS's own store feeds it, from what a DX4 subscription carries. Its disk half is the sidecars, here the
// `subagents` metas (each `subagents/*.meta.json` verbatim): a node per agent with its description, type, and depth.
// Its wire half is the transcript's X1 events, here the held rows mapped by MAWS's backfill, which starts an agent at
// the `Agent` call the meta names and ends it at the call's result or, for a background agent, at the
// `<task-notification>` naming the call. MAWS's store takes the wire half from the live `session.events` stream, whose
// `seq` and launch ids the desk has no source for (the renderer survey's wrinkle); the backfill's events need neither.
import type { SubagentEntry } from '@shared/ipc/schema/fs';
import type { AgentId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import { SubagentMetaSchema } from '@shared/wire/store';
import type { SubagentMeta } from 'desk-hub/protocol';
import { applyTaskEvents, emptyGraph, mergeSidecars, type TaskGraph } from '../../../../../src/renderer/src/tools/agents/model/task-graph';

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
