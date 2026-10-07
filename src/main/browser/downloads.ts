// Downloads (E4a execution document, Design §8; A-31; Decision Log 18): a download is the human's, through the native
// save dialog (Electron's, drawn above every view) opened at the Downloads folder with the file's name; one started while
// the agent holds the page is cancelled and reported (`browser.download.refused`, E4c's tool error, and the chrome's
// notice). Each tab shows one download line at a time (a second replaces it), following the item to done, cancelled or
// failed; Reveal in Finder shows the saved file. Under the e2e alone, `MAWS_E2E_SAVE_PATH` names the folder the file is
// saved into without the dialog. A download from no tab of ours is cancelled.
import { basename, join } from 'node:path';
import type { DownloadItem, Session, WebContents } from 'electron';
import type { BrowserTab } from '@shared/browser/tab';
import type { PreparePartition } from './partition';
import type { BrowserEmit, TabEntry, TabStore } from './tabs';

export function e2eSaveDir(env: NodeJS.ProcessEnv): string | null {
  return env.MAWS_E2E === '1' && env.MAWS_E2E_SAVE_PATH ? env.MAWS_E2E_SAVE_PATH : null;
}

export interface DownloadsDeps {
  store: Pick<TabStore, 'entry' | 'entryOf' | 'update' | 'require'>;
  emit: BrowserEmit;
  downloadsDir(): string;
  saveDir: string | null; // e2eSaveDir(env)
  reveal(path: string): void; // Reveal in Finder (the seam's under the e2e)
}

const DONE_STATES = { completed: 'done', cancelled: 'cancelled', interrupted: 'failed' } as const;

export class Downloads {
  private readonly current = new WeakMap<TabEntry, DownloadItem>();

  constructor(private readonly deps: DownloadsDeps) {}

  // The partition's `will-download` (Partitions' preparation).
  prepare(): PreparePartition {
    return (ses: Pick<Session, 'on'>) => {
      ses.on('will-download', (_event, item, webContents) => this.handle(item, webContents));
    };
  }

  handle(item: DownloadItem, webContents: WebContents | null): void {
    const { store, emit } = this.deps;
    const entry = webContents ? store.entryOf(webContents) : undefined;
    const filename = item.getFilename();
    if (!entry) return item.cancel();
    const { tabId, appSessionId } = entry.tab;
    if (entry.tab.control === 'agent') {
      item.cancel();
      emit('browser.download.refused', { tabId, url: item.getURL(), filename });
      // E4c start: told in main too, beside the IPC emission: the agent's call that started it answers downloadRefused
      this.notifyRefused({ tabId, url: item.getURL(), filename });
      // E4c end
      emit('browser.notice', { appSessionId, tabId, kind: 'downloadRefusedAgent' });
      return;
    }
    if (this.deps.saveDir !== null) item.setSavePath(join(this.deps.saveDir, filename));
    else item.setSaveDialogOptions({ defaultPath: join(this.deps.downloadsDir(), filename) });

    this.current.set(entry, item);
    const line = (download: BrowserTab['download']) => {
      if (store.entry(tabId) === entry && this.current.get(entry) === item) store.update(tabId, { download });
    };
    const progress = (): BrowserTab['download'] => ({ name: filename, state: 'progressing', received: item.getReceivedBytes(), total: item.getTotalBytes(), path: null });
    line(progress());
    item.on('updated', () => line(progress()));
    item.once('done', (_event, state) => {
      const path = state === 'completed' ? item.getSavePath() : null;
      line({ name: path ? basename(path) : filename, state: DONE_STATES[state], received: item.getReceivedBytes(), total: item.getTotalBytes(), path });
    });
  }

  // `browser.tabs.revealDownload`: the tab's finished download in Finder.
  reveal(tabId: string): { revealed: boolean } {
    const { download } = this.deps.store.require(tabId).tab;
    if (download?.state !== 'done' || !download.path) return { revealed: false };
    this.deps.reveal(download.path);
    return { revealed: true };
  }

  // E4c start: the in-process hook for `browser.download.refused` (E4c execution document, Design §6; Decision Log 36,
  // 43): main's browser tools listen for the refusal of the tab they act on and turn it into their call's error.
  private readonly refusedListeners = new Set<(refused: { tabId: string; url: string; filename: string }) => void>();

  onRefused(listener: (refused: { tabId: string; url: string; filename: string }) => void): () => void {
    this.refusedListeners.add(listener);
    return () => void this.refusedListeners.delete(listener);
  }

  private notifyRefused(refused: { tabId: string; url: string; filename: string }): void {
    for (const listener of [...this.refusedListeners]) {
      try {
        listener(refused);
      } catch (error) {
        console.error('[browser] a download-refusal listener failed:', error);
      }
    }
  }
  // E4c end
}
