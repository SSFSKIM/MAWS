// RED STUB (replaced by the implementation in the next commit)
import type { FileHandle } from 'node:fs/promises';
import type { AppSessionId } from '@shared/graph/ids';
import type { StoredRun } from '@shared/owner/folds';
import type { SessionStore } from '../index/sessions';
export interface StoredFoldsDeps { sessions: Pick<SessionStore, 'get'>; configHome: () => Promise<string>; open?: (path: string) => Promise<FileHandle> }
export async function storedFolds(_deps: StoredFoldsDeps, _id: AppSessionId): Promise<{ runs: StoredRun[] | null }> { throw new Error('not built'); }
