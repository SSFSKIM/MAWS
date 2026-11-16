// M7's red step: the names the tests import, not yet built (UX wave U2b; the execution document, Interfaces §M).
import type { StoredRun } from '@shared/owner/folds';
import type { TurnState } from '../../transcript/model/reduce';
import type { Row, TurnId } from '../../transcript/model/rows';
import type { Stretch } from './mirror';

export interface StretchLabels { stored: readonly StoredRun[]; running: boolean; turns?: ReadonlyMap<TurnId, TurnState> }
const unbuilt = (): never => {
  throw new Error('M7: not built');
};
export const keptIdsOf = (_row: Row, _turn: TurnState | undefined): string[] => unbuilt();
export const lineOf = (_tool: string, _input: unknown): string => unbuilt();
export const runOf = (_stretch: Stretch, _rows: readonly Row[], _runs: readonly StoredRun[], _turns?: ReadonlyMap<TurnId, TurnState>): StoredRun | undefined => unbuilt();
export const liveLine = (_stretch: Stretch, _covered: StoredRun | undefined, _last: boolean, _running: boolean, _turns?: ReadonlyMap<TurnId, TurnState>): string | undefined => unbuilt();
export const recordLabel = (_stretch: Stretch, _rows: readonly Row[], _labels: StretchLabels, _last: boolean): string | undefined => unbuilt();
export const labelsOf = (_rows: readonly Row[], _labels: StretchLabels | undefined): ((stretch: Stretch, last: boolean) => string | undefined) | undefined => unbuilt();
