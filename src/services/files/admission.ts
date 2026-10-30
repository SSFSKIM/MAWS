// Main's admission of a delivered file from the library's index (the P3-L document, M6b; Decision Log 16 and 36i; E2's
// `DeliverableReader.admitted` before the cutover): the files service reads, opens or reveals a file outside a session's
// directories only when a live File artifact names it, one linked to the session or a side thread's ancestor of it (an
// agent's delivery), or one no session is linked to (the owner's own "Add a file…", read by its own viewer under
// whichever session the window reads it). Each named path is realpathed now and compared with the file's realpath, so
// exactly that file is admitted, never its directory. P5 O3-C (reader R14): the paths are read through the spine's view
// (in process, the library's index; at O3-D, an internal `machine` command until O3-E), which answers none while the
// spine's data cannot be read (a run refused the spine), so nothing is admitted then.
import { realpath } from 'node:fs/promises';
import type { AppSessionId } from '@shared/graph/ids';
import type { SpineView } from '@shared/spine/view';

export function fileAdmission(view: Pick<SpineView, 'fileLinkedPaths'>): (appSessionId: AppSessionId, real: string) => Promise<boolean> {
  return async (appSessionId, real) => {
    for (const path of await view.fileLinkedPaths(appSessionId)) {
      if ((await realpath(path).catch(() => null)) === real) return true;
    }
    return false;
  };
}
