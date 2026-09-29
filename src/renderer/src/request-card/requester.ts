// Who is asking (C7 execution document, Request card, permission row): the main session, or the subagent the request
// names by `agentId` (C3 sets it from `can_use_tool.agent_id`), by its name in the transcript's subagent rows, else "A
// subagent" when the transcript does not know it. Pure.
import type { AgentId } from '@shared/graph/ids';
import type { Row } from '../transcript';

export function requesterName(rows: readonly Row[], agentId: AgentId | null): string {
  if (agentId === null) return 'Main session';
  for (const row of rows) {
    if (row.kind !== 'subagent') continue;
    const agent = row.agents.find((a) => a.agentId === agentId);
    if (agent) return agent.name;
  }
  return 'A subagent';
}
