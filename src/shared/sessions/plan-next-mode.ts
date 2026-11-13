// UX wave U1a §F (docs/doperpowers/plans/2026-11-12-ux-wave-U1a-requests.md; l4-approvals-11): the mode an approved plan
// leaves the session in. The engine applies a `setMode` update written beside the plan's allow before the tool's result
// reaches the model (spikes/protocol-probe/findings-uxwave-u1-plan-next-mode.txt); without one it restores the mode the
// session had before Plan.
import type { RequestAnswer } from '../engine/answers';
import type { PermissionMode } from '../graph/enums';
import type { HostStatus } from '../ipc/schema/host';

/** The modes an approved plan may name: those the check of 2026-11-12 ran end to end. */
export const PLAN_NEXT_MODES: readonly PermissionMode[] = ['default', 'acceptEdits'];

/**
 * Whether the engine host that serves this Mac's sessions applies a plan answer's mode: its wire is this build's. The
 * fingerprint covers the plan answer's schema, so an equal one is a host that knows `mode`; one of another build would
 * drop the key (it reads its peers tolerantly) and implement in the earlier mode.
 */
export function hostAppliesPlanMode(status: Pick<HostStatus, 'state' | 'supervisor' | 'appWire'> | null): boolean {
  return status !== null && status.state === 'ready' && status.supervisor !== null && status.supervisor.wire === status.appWire;
}

/** Whether an answer is a plan's approval that names the mode after it. */
export const namesPlanMode = (answer: RequestAnswer): boolean => answer.kind === 'plan' && answer.mode !== undefined;

/**
 * Why such an answer is not sent where `hostAppliesPlanMode` does not hold: the words the card's port gives, and the
 * services' forwarding boundary for a caller that reaches it past the port (the panel's ruling, 2026-11-13).
 */
export const PLAN_MODE_OTHER_HOST = 'The engine host serving this session isn’t this build’s, so it can’t apply a chosen mode';
