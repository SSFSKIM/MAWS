// Open File… in the window (UX wave U6e, docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §D;
// decisions 13 to 16, sequence W1). `openChosen` asks main's chooser for a session; the file chosen (its real path, which
// the daemon granted) opens beside the chat as a kept tab. A refusal or an error is a notice at level danger; a cancel,
// and an answer that lands after its session left the page's records, open nothing and say nothing. `connectOpenFile`
// keeps `file.open` (File menu, ⌘O) registered exactly while a session's chat of this Mac is in front: no page and no
// Overview covers the tab and the session in front is one the page knows (R10); otherwise it is disabled as every
// unregistered action.
import type { AppSessionId } from '@shared/graph/ids';
import { ipc } from '../../../ipc/client';
import { machineFor } from '../../../ipc/machine';
import { registerAction } from '../../../keymap/actions-runtime';
import { shownSession } from '../../../panel/host';
import { pageOpen, useLayout } from '../../../stores/layout';
import { toast } from '../../../stores/notices';
import { OPEN_FILE_COPY } from '../copy';
import { openFile } from '../open-file';
import { useViewer } from '../viewer/viewer-store';

const refuse = (text: string) => toast({ level: 'danger', text, actions: [], dismissible: true });

export async function openChosen(appSessionId: AppSessionId): Promise<void> {
  const answer = await ipc.invoke('layout.openFile', { appSessionId }).catch(() => null); // a bridge that threw: as an error
  // W1: the session went from the page's records while the chooser was open; its tab is gone, so nothing is said either.
  if (!useLayout.getState().knownSession(appSessionId)) return;
  // An error of the command (a daemon of an older build, a grant that could not be recorded): the sentence of a refusal
  // for want of the service, since its message is no sentence for a person.
  if (answer === null || !answer.ok) return void refuse(OPEN_FILE_COPY.unavailable);
  const result = answer.value;
  if (result.status === 'cancelled') return;
  if (result.status === 'refused') return void refuse(result.reason === 'not-a-file' ? OPEN_FILE_COPY.notAFile : OPEN_FILE_COPY.unavailable);
  openFile(appSessionId, result.path, null, { keep: true });
  // Decision 18: a tab pinned to the chosen file whose edits stand under a lock (W4) is not read over; its admission is
  // read again, so the grant makes it savable where it is
  useViewer.getState().readAdmission(appSessionId, result.path);
}

// The session whose chat is in front on this Mac, or null: none under a page, nor while the Overview is open over the
// chat (decision 15; a file opened then would land beside a chat the Overview covers).
function frontSession(): AppSessionId | null {
  const state = useLayout.getState();
  if (pageOpen(state) || state.overviewOpen) return null;
  const session = shownSession(state.main);
  return session !== null && machineFor(session) === ipc.localMachine && state.knownSession(session) ? session : null;
}

/** Keeps `file.open` registered while a session's chat of this Mac is in front; returns its removal. */
export function connectOpenFile(): () => void {
  let unregister: (() => void) | null = null;
  const sync = () => {
    const has = frontSession() !== null;
    if (has && unregister === null) {
      unregister = registerAction('file.open', () => {
        const session = frontSession();
        if (session !== null) void openChosen(session);
      });
    } else if (!has && unregister !== null) {
      unregister();
      unregister = null;
    }
  };
  sync();
  const unsubscribe = useLayout.subscribe(sync); // the tab in front, a page or the Overview over it, and the sessions the page knows
  return () => {
    unsubscribe();
    unregister?.();
    unregister = null;
  };
}
