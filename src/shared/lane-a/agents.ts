// The subagents of a terminal session this Mac drives, as main derives them (src/services/lane-a/jobs.ts, by DX4's
// rules) and a watch carries them to the window (UX wave U8d, Interfaces §A and §B).
import type { SubagentStatusFacts } from 'desk-hub/protocol';

/** One listed agent: its id and its sidecar meta ({} when the meta cannot be read). */
export interface AgentMeta { agentId: string; meta: Record<string, unknown> }

/** The bridge's record of one agent as folded: its spawn's keys, and `running`. */
export type BridgeAgent = { agentId: string; running: boolean } & Record<string, unknown>;

/** DX4's entry as this Mac derives it: every fact but `file`. */
export type DerivedAgent = AgentMeta & Omit<SubagentStatusFacts, 'file'>;

/** What a watch of this Mac carries: DX4's entry and, beside it, when the agent's call was made (§B). */
export type LaneAAgent = DerivedAgent & { startedAt?: string };
