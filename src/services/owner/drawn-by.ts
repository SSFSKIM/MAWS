// RED STUB (replaced by the implementation in the next commit)
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { DrawnBy, Reservation } from '@shared/owner/draws';
import type { ContractSource } from '@shared/owner/state';
export interface DrawRow { launchId: string | null; desired: ContractSource | null; advertised: Reservation | null }
export interface WhoDrawsDeps { row: (id: AppSessionId) => DrawRow | null; declares: (path: string) => Promise<boolean>; changed: (id: AppSessionId) => void }
export class WhoDraws {
  constructor(readonly deps: WhoDrawsDeps) {}
  status(_s: Pick<EngineSessionStatus, 'appSessionId' | 'launchId' | 'process' | 'plugins' | 'pluginsObservedAt'>): void { throw new Error('not built'); }
  bound(_id: AppSessionId, _launchId: string): void { throw new Error('not built'); }
  primed(): void { throw new Error('not built'); }
  drawnBy(_id: AppSessionId): DrawnBy { throw new Error('not built'); }
  async settled(): Promise<void> {}
  stop(): void {}
}
