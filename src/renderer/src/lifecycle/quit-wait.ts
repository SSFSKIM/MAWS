// "Quit when idle" in the page (C12 execution document, Interfaces "The quit question"; charter §3 P0 quit line, D8):
// main holds the quit and waits for the busy work its question named; the page shows one app-wide banner through C5's
// banner host saying how many things remain, with Quit now and Cancel, and withdraws it when main stops waiting.
// Subscribed first, then the snapshot (C1's ordering rule), so a reload while main waits shows the banner again.
import type { MawsBridge } from '@shared/ipc/schema';
import type { QuitWait } from '@shared/ipc/schema/layout';
import { ipc } from '../ipc/client';
import { useNotices } from '../stores/notices';
import { EDITOR_COPY } from '../tools/code/copy'; // E5 (M5)

export const QUIT_WAIT_BANNER_ID = 'quit:when-idle';

export function quitWaitText(r: NonNullable<QuitWait['waiting']>): string {
  const n = r.midTurn + r.backgroundWork + r.busyTerminals;
  // E5 (M5): a file dirtied during the wait holds it too, until it is saved
  const unsaved = r.unsavedFiles.length;
  const parts = [
    n > 0 ? `${n} ${n === 1 ? 'thing finishes' : 'things finish'}` : null,
    unsaved > 0 ? `${EDITOR_COPY.unsavedFilesPart(unsaved)} ${unsaved === 1 ? 'is' : 'are'} saved` : null,
  ].filter((part): part is string => part !== null);
  return `MAWS will quit when ${parts.join(' and ')}`;
}

export function connectQuitWait(client: MawsBridge = ipc): () => void {
  let live = true;
  let heard = false; // an event came first: the snapshot on its way is older
  const answer = (action: 'quitNow' | 'cancel') =>
    void client.invoke('layout.quitWaitAnswer', { action }).then((result) => {
      if (!result.ok) console.warn('[quit] layout.quitWaitAnswer failed', result.error);
    });
  const show = ({ waiting }: QuitWait) => {
    const notices = useNotices.getState();
    if (waiting === null) return notices.dismiss(QUIT_WAIT_BANNER_ID);
    notices.banner({
      id: QUIT_WAIT_BANNER_ID,
      level: 'info',
      text: quitWaitText(waiting),
      actions: [
        { label: 'Quit now', run: () => answer('quitNow') },
        { label: 'Cancel', run: () => answer('cancel') },
      ],
      dismissible: false,
    });
  };
  const off = client.on('layout.quitWait', (wait) => {
    if (!live) return;
    heard = true;
    show(wait);
  });
  void client.invoke('layout.quitWait', undefined).then((result) => {
    if (!live || heard) return;
    if (result.ok) show(result.value);
    else console.warn('[quit] layout.quitWait unavailable', result.error);
  });
  return () => {
    live = false;
    off();
  };
}
