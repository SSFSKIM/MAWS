// L197: the agents a transcript's rows may name beyond its loaded turns, as MAWS supplies them (the desk supplies its
// own tree through the same `setAgents`): every agent node of the session's task graph (C8b's store), by its task id
// (an agent's task id is its agent id) and by the real name its sidecar gave. A child transcript holds none of its
// siblings' Agent calls, and a nested agent's call is in its parent's transcript, so a message to one is named from here.
// The graph read is what the store holds: the session's agent surfaces (the Agents tool's lists and summaries) watch it,
// and a transcript opens no `session.events` subscription of its own for it. A lookup is pushed only when the agents it
// names change, since each push re-derives the turns that read it; an empty one is none.
import { useEffect } from 'react';
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import { useTranscriptStore } from '../../stores/transcript';
import type { TaskGraph } from '../../tools/agents/model/task-graph';
import { useTaskGraph } from '../../tools/agents/store';
import { glyphFor } from '../model/glyphs';
import type { AgentLookup } from '../model/reduce';
import type { SubagentRef } from '../model/rows';

export function agentLookupOf(graph: TaskGraph): AgentLookup | undefined {
  const lookup = new Map<string, SubagentRef>();
  for (const taskId of graph.order) {
    const node = graph.tasks.get(taskId);
    if (node?.kind !== 'agent') continue;
    const ref: SubagentRef = {
      taskId: node.taskId, agentId: node.taskId as string as AgentId, toolUseId: node.toolUseId, name: node.description, glyph: glyphFor(node.toolUseId ?? node.taskId), kind: 'agent',
      subagentType: node.agent?.subagentType ?? null,
    };
    lookup.set(node.taskId, ref);
    const name = node.agent?.name;
    if (name && !lookup.has(name)) lookup.set(name, ref);
  }
  return lookup.size === 0 ? undefined : lookup;
}

const sameRef = (a: SubagentRef, b: SubagentRef | undefined) =>
  b !== undefined && a.taskId === b.taskId && a.agentId === b.agentId && a.toolUseId === b.toolUseId && a.name === b.name && a.glyph === b.glyph && a.subagentType === b.subagentType;
const sameLookup = (a: AgentLookup | undefined, b: AgentLookup | undefined) =>
  a === b || (a !== undefined && b !== undefined && a.size === b.size && [...a].every(([key, ref]) => sameRef(ref, b.get(key))));

// The session's agents into the transcript store's key, for as long as the transcript is mounted.
export function useAgentLookup(storeKey: string, appSessionId: AppSessionId): void {
  useEffect(() => {
    let graph: TaskGraph | undefined;
    let pushed: AgentLookup | undefined;
    const follow = () => {
      const next = useTaskGraph.getState().entries.get(appSessionId)?.graph;
      if (next === graph) return;
      graph = next;
      const lookup = next === undefined ? undefined : agentLookupOf(next);
      if (lookup === undefined || sameLookup(pushed, lookup)) return; // what was pushed stands until the graph names agents again
      pushed = lookup;
      useTranscriptStore.getState().setAgents(storeKey, lookup);
    };
    follow();
    return useTaskGraph.subscribe(follow);
  }, [storeKey, appSessionId]);
}
