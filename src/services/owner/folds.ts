// The one place MAWS opens the to-human mod's file of fold summaries (the UX wave, U2b: docs/doperpowers/plans/2026-11-15-
// ux-wave-U2b-to-human-view.md, Interfaces §M, "The file: a contract, and its reader"; ./register.ts answers
// `ownerChannel.folds` with it). It takes a session, never a path: the name is the session's engine session id as the
// index records it, under the engine's configuration directory the owner service resolves. It opens that one name and no
// temporary beside it, and reads the whole file in one read through the handle it opened, so a rename over the file
// between the open and the read (the contract's atomic replacement) answers the old file whole. Whatever it cannot read
// answers `runs: null`, which a window reads as "keep what you had"; no file, and no engine session id yet, answer an
// empty list. Never an error a window would show.
import { open as openFile, type FileHandle } from 'node:fs/promises';
import type { AppSessionId } from '@shared/graph/ids';
import { FOLDS_FILE_MAX_BYTES, foldsFileOf, storedRunsOf, type StoredRun } from '@shared/owner/folds';
import type { SessionStore } from '../index/sessions';

export interface StoredFoldsDeps {
  sessions: Pick<SessionStore, 'get'>;
  configHome: () => Promise<string>; // the engine's configuration directory (the captured login-shell environment's)
  open?: (path: string) => Promise<FileHandle>; // the tests' seam: the order between the open and the read held open
}

export async function storedFolds(deps: StoredFoldsDeps, appSessionId: AppSessionId): Promise<{ runs: StoredRun[] | null }> {
  let engineSessionId: string | null;
  try {
    engineSessionId = deps.sessions.get(appSessionId)?.engineSessionId ?? null;
  } catch {
    return { runs: null }; // the index cannot be read
  }
  if (engineSessionId === null) return { runs: [] };
  const path = foldsFileOf(await deps.configHome(), engineSessionId);
  if (path === null) return { runs: null };
  let handle: FileHandle;
  try {
    handle = await (deps.open ?? ((at: string) => openFile(at, 'r')))(path);
  } catch (error) {
    return { runs: (error as NodeJS.ErrnoException).code === 'ENOENT' ? [] : null };
  }
  try {
    if ((await handle.stat()).size > FOLDS_FILE_MAX_BYTES) return { runs: null };
    const bytes = await handle.readFile();
    if (bytes.byteLength > FOLDS_FILE_MAX_BYTES) return { runs: null };
    return { runs: storedRunsOf(bytes.toString('utf8')) };
  } catch {
    return { runs: null };
  } finally {
    await handle.close().catch(() => {});
  }
}
