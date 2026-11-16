// M7's red step: the names the tests import, not yet built (UX wave U2b; the execution document, Interfaces §M).
import type { AppSessionId } from '@shared/graph/ids';
import type { StoredRun } from '@shared/owner/folds';
import type { Row } from '../transcript/model/rows';

export const ROUND_AFTER_MS: readonly number[] = [];
export interface FoldReads {
  store: { getState(): { runs: ReadonlyMap<AppSessionId, readonly StoredRun[]> } };
  mount(appSessionId: AppSessionId): () => void;
  round(appSessionId: AppSessionId): void;
  reset(): void;
}
const unbuilt = (): never => {
  throw new Error('M7: not built');
};
export const createFoldReads = (_deps?: unknown): FoldReads => unbuilt();
export const useStoredFolds = (_appSessionId: AppSessionId | null, _enabled: boolean, _reads?: FoldReads): readonly StoredRun[] | undefined => unbuilt();
export const lastStretchClosed = (_drawn: readonly Row[]): boolean => unbuilt();
