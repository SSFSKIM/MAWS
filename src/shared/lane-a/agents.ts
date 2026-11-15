// The subagents of a terminal session this Mac drives, as main derives them (src/services/lane-a/jobs.ts, by DX4's
// rules) and a watch carries them to the window (UX wave U8d, Interfaces §A and §B).
import type { SubagentStatusFacts } from 'desk-hub/protocol';
import type { SessionRecord } from '@shared/graph/session';

/** One listed agent: its id and its sidecar meta ({} when the meta cannot be read). */
export interface AgentMeta { agentId: string; meta: Record<string, unknown> }

/** The bridge's record of one agent as folded: its spawn's keys, and `running`. */
export type BridgeAgent = { agentId: string; running: boolean } & Record<string, unknown>;

/** DX4's entry as this Mac derives it: every fact but `file`. */
export type DerivedAgent = AgentMeta & Omit<SubagentStatusFacts, 'file'>;

/** What a watch of this Mac carries: DX4's entry and, beside it, when the agent's call was made (§B). */
export type LaneAAgent = DerivedAgent & { startedAt?: string };

/**
 * The process a foreign holder names, as a body's origin: `terminal:<pid>`, `background_job:<pid>:<jobId>`; null for
 * this app and for none. This Mac's driver puts the origin of the bridge child whose facts a body carries beside its
 * agents list (`origin`, a key inside the plane message's unknown body), and the window fences the statuses it keeps on
 * it against the session's holder (the fence review's ruling, UX wave U8d).
 */
export function holderOrigin(holder: SessionRecord['holder']): string | null {
  if (holder.kind === 'terminal') return `terminal:${holder.pid}`;
  if (holder.kind === 'background_job') return `background_job:${holder.pid}:${holder.jobId}`;
  return null;
}
