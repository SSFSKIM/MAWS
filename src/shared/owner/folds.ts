// RED STUB (replaced by the implementation in the next commit)
export const FOLDS_SHAPE = 2;
export const FOLD_SUMMARIES_ENV = 'TO_HUMAN_FOLD_SUMMARIES';
export const FOLDS_FILE_MAX_BYTES = 4 * 1024 * 1024;
export const STORED_RUNS_MAX = 5000;
export interface StoredRun { first: string; last: string; summary: string }
export function storedRunsOf(_text: string): StoredRun[] | null { throw new Error('not built'); }
export function foldsFileOf(_configHome: string, _id: string): string | null { throw new Error('not built'); }
