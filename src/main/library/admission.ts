// Main's admission of a delivered file from the library's index (the P3-L document, M6b; Decision Log 16 and 36i; E2's
// `DeliverableReader.admitted` before the cutover): the files service reads, opens or reveals a file outside a session's
// directories only when a live File artifact names it, one linked to the session or a side thread's ancestor of it (an
// agent's delivery), or one no session is linked to (the owner's own "Add a file…", read by its own viewer under
// whichever session the window reads it). Each named path is realpathed now and compared with the file's realpath, so
// exactly that file is admitted, never its directory. The index unavailable admits nothing.
import { realpath } from 'node:fs/promises';
import type { AppSessionId } from '@shared/graph/ids';
import type { LibraryStore } from './store';

export function fileAdmission(library: Pick<LibraryStore, 'fileLinkedPaths'> | null): (appSessionId: AppSessionId, real: string) => Promise<boolean> {
  return async (appSessionId, real) => {
    if (library === null) return false;
    for (const path of library.fileLinkedPaths(appSessionId)) {
      if ((await realpath(path).catch(() => null)) === real) return true;
    }
    return false;
  };
}
