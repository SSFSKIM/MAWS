// carried from C3 until rebase ----------------------------------------------------------------------------------------
// C3's `toSessionRecordPatch(status)` (C3 execution document, Interfaces "Process table and status",
// `src/shared/engine/status.ts`): what the index applies to a record from a live engine process's status. C3's document
// fixes the signature (a partial of the record's engine id, version, gateway, model, effort, permission mode and
// holder) but not the body; this is C4's reading of it, and C3's own function replaces it at rebase.
import type { SessionRecord } from '@shared/graph/session';
import type { EngineSessionStatus } from '@shared/ipc/schema/session';

export type EngineStatusPatch = Partial<Pick<SessionRecord, 'engineSessionId' | 'engineVersion' | 'gateway' | 'model' | 'effort' | 'permissionMode' | 'holder'>>;

export function toSessionRecordPatch(status: EngineSessionStatus): EngineStatusPatch {
  const patch: EngineStatusPatch = {
    // A process MAWS runs holds its session (`self`) until it has exited; then nothing does.
    holder: status.process === 'exited' ? { kind: 'none' } : { kind: 'self' },
    gateway: { routed: status.gateway.mode === 'gateway', baseUrl: status.gateway.baseUrl, autoModeServer: status.gateway.autoModeServer },
    model: status.model,
    effort: status.effort,
    permissionMode: status.permissionMode,
  };
  // Facts the engine has not reported yet (before its first frame) leave the record's own value standing.
  if (status.engineSessionId !== null) patch.engineSessionId = status.engineSessionId;
  if (status.engineVersion !== null) patch.engineVersion = status.engineVersion;
  return patch;
}
// end carried from C3 --------------------------------------------------------------------------------------------------
