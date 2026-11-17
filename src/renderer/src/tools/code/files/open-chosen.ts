// Open File… in the window (UX wave U6e, docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §D;
// decisions 13 to 16, sequence W1). `openChosen` asks main's chooser for a session; the file chosen (its real path, which
// the daemon granted) opens beside the chat as a kept tab. A refusal or an error is a notice at level danger; a cancel,
// and an answer that lands after its session left the page's records, open nothing and say nothing. `connectOpenFile`
// keeps `file.open` (File menu, ⌘O) registered exactly while a session's chat of this Mac is in front: no page and no
// Overview covers the tab and the session in front is one the page knows (R10); otherwise it is disabled as every
// unregistered action.
//
// UX wave U6f (docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, §E; sequences C3, C4, C6
// and R10): `openChosenFor` is the one way Open File… opens for a session. A session of this Mac gets main's chooser
// (`openChosen`); one that takes the remote route gets MAWS's own sheet of that machine's files (`openChosenElsewhere`),
// mounted in a root of its own under the document's body, so ⌘O works with no Files tab mounted. One sheet at a time: asked
// again while it is open, the open sheet takes the keyboard (C6). The file granted there opens as the one chosen here
// does, and only while the page still knows the session (C4); a Cancel while the choice is in flight opens nothing (C3).
// `file.open` is registered also while the chat in front takes the remote route and the window's helper has no
// sentence for `files.chooseOutside` (R10).
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppSessionId } from '@shared/graph/ids';
import { machineOf } from '@shared/machine/address';
import { ipc } from '../../../ipc/client';
import { machineFor } from '../../../ipc/machine';
import { registerAction } from '../../../keymap/actions-runtime';
import { useRemoteLaneB } from '../../../lane-b/remote-session';
import { remoteStandingOf } from '../../../lane-b/remote-standing';
import { remoteUnavailableOf } from '../../../lane-b/remote-unavailable';
import { shownSession } from '../../../panel/host';
import { pageOpen, useLayout } from '../../../stores/layout';
import { useMachines } from '../../../stores/machines';
import { toast } from '../../../stores/notices';
import { useSessions } from '../../../stores/sessions';
import { OPEN_FILE_COPY } from '../copy';
import { openFile } from '../open-file';
import { useViewer } from '../viewer/viewer-store';
import { takesRemoteRoute } from './elsewhere';
import { RemoteChooser } from './RemoteChooser';
import { chooserCalls, createRemoteChooser, startOf } from './remote-chooser';

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
  opened(appSessionId, result.path);
}

// The granted file opens beside the chat as a kept tab. Decision 18: a tab pinned to it whose edits stand under a lock
// (W4) is not read over; its admission is read again, so the grant makes it savable where it is.
function opened(appSessionId: AppSessionId, path: string): void {
  openFile(appSessionId, path, null, { keep: true });
  useViewer.getState().readAdmission(appSessionId, path);
}

// The one sheet open, if any.
let sheet: { closed: Promise<void> } | null = null;
const sheetElement = () => document.querySelector<HTMLElement>('[data-remote-chooser]');

/** MAWS's own chooser of the files on the session's machine; resolves when the sheet closes. */
function openChosenElsewhere(appSessionId: AppSessionId): Promise<void> {
  if (sheet !== null) {
    sheetElement()?.focus(); // C6: no second sheet; the open one takes the keyboard
    return sheet.closed;
  }
  const chooser = createRemoteChooser(appSessionId, { ...chooserCalls(), machine: () => remoteStandingOf(appSessionId)?.machine ?? '', startAt: startOf(machineOf(appSessionId)) });
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  let done = () => {};
  const closed = new Promise<void>((resolve) => (done = resolve));
  const close = () => {
    if (sheet?.closed !== closed) return;
    sheet = null;
    chooser.cancel();
    // the sheet's own handler is still running: the root goes once it returns
    queueMicrotask(() => {
      root.unmount();
      host.remove();
      done();
    });
  };
  const chosen = (path: string) => {
    close();
    // C4: the session went from the page's records while the sheet was open; its tab is gone, so nothing opens
    if (useLayout.getState().knownSession(appSessionId)) opened(appSessionId, path);
  };
  sheet = { closed };
  root.render(createElement(RemoteChooser, { appSessionId, chooser, onClose: close, onChosen: chosen }));
  return closed;
}

/** Open File… for a session: main's chooser for a session of this Mac, MAWS's own sheet for one that takes the remote route. */
export function openChosenFor(appSessionId: AppSessionId): Promise<void> {
  return takesRemoteRoute(appSessionId) ? openChosenElsewhere(appSessionId) : openChosen(appSessionId);
}

// The session whose chat is in front, or null: none under a page, nor while the Overview is open over the chat (decision
// 15; a file opened then would land beside a chat the Overview covers). A session of this Mac, or one that takes the
// remote route while the window's helper has no sentence for the chooser there (U6f, R10).
function frontSession(): AppSessionId | null {
  const state = useLayout.getState();
  if (pageOpen(state) || state.overviewOpen) return null;
  const session = shownSession(state.main);
  if (session === null || !state.knownSession(session)) return null;
  if (machineFor(session) === ipc.localMachine) return session;
  return takesRemoteRoute(session) && remoteUnavailableOf(session, 'files.chooseOutside') === null ? session : null;
}

/** Keeps `file.open` registered while a chat Open File… serves is in front; returns its removal. */
export function connectOpenFile(): () => void {
  let unregister: (() => void) | null = null;
  const sync = () => {
    const has = frontSession() !== null;
    if (has && unregister === null) {
      unregister = registerAction('file.open', () => {
        const session = frontSession();
        if (session !== null) void openChosenFor(session);
      });
    } else if (!has && unregister !== null) {
      unregister();
      unregister = null;
    }
  };
  sync();
  // the tab in front, a page or the Overview over it, and the sessions the page knows; for a session there, its route and
  // its machine's standing
  const unsubscribes = [useLayout.subscribe(sync), useSessions.subscribe(sync), useRemoteLaneB.subscribe(sync), useMachines.subscribe(sync)];
  return () => {
    unsubscribes.forEach((unsubscribe) => unsubscribe());
    unregister?.();
    unregister = null;
  };
}
