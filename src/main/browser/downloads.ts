// Downloads (E4a execution document, Design §8; A-31; Decision Log 18): a download is the human's, through the native
// save dialog (Electron's, drawn above every view) opened at the Downloads folder with the file's name; one started while
// the agent holds the page with no cua lease on it is cancelled and reported (`browser.download.refused` and the
// chrome's notice). Each tab shows one download line at a time (a second replaces it), following the item to done, cancelled or
// failed; Reveal in Finder shows the saved file. Under the e2e alone, `MAWS_E2E_SAVE_PATH` names the folder the file is
// saved into without the dialog. A download from no tab of ours is cancelled.
//
// E13 (the in-app browser spec of 2026-10-08, "Downloads"): a download from a tab under a cua lease is the agent's,
// saved without a dialog in the Downloads folder under its own name, " (1)", " (2)"… before its extension when the name
// is taken there or by a download still in flight, and reported through `agent` (cua/downloads.ts: the host, the
// windows, the deliverable). Its line and Reveal in Finder are a person's download's.
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { DownloadItem, Session, WebContents } from 'electron';
import type { BrowserTab } from '@shared/browser/tab';
import type { AgentDownloads } from './cua/downloads';
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
  agent?: AgentDownloads; // E13: the agent's downloads through cua
  exists?(path: string): boolean; // E13: a file is in the folder (tests)
}

// E13: the first free path for `filename` in `dir`: the name itself, else Chrome's macOS " (1)", " (2)"… before the
// extension.
export function uniqueDownloadPath(dir: string, filename: string, taken: (path: string) => boolean): string {
  const extension = filename.startsWith('.') && extname(filename.slice(1)) === '' ? '' : extname(filename);
  const stem = filename.slice(0, filename.length - extension.length);
  for (let n = 0; ; n++) {
    const path = join(dir, n === 0 ? filename : `${stem} (${n})${extension}`);
    if (!taken(path)) return path;
  }
}

const DONE_STATES = { completed: 'done', cancelled: 'cancelled', interrupted: 'failed' } as const;

export class Downloads {
  private readonly current = new WeakMap<TabEntry, DownloadItem>();
  private readonly inFlight = new Set<string>(); // E13: the paths the agent's downloads are being saved to

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
    // E13: the agent's, through cua: no dialog, the folder's next free name, reported as it goes
    const agent = this.deps.agent?.owns(tabId) ? this.deps.agent : undefined;
    if (agent) {
      const exists = this.deps.exists ?? existsSync;
      const path = uniqueDownloadPath(this.deps.saveDir ?? this.deps.downloadsDir(), filename, (candidate) => this.inFlight.has(candidate) || exists(candidate));
      this.inFlight.add(path);
      item.setSavePath(path);
      const chain = typeof item.getURLChain === 'function' ? item.getURLChain() : [];
      const ended = agent.started(entry, { url: chain[0] ?? item.getURL(), finalUrl: chain.at(-1) ?? item.getURL(), path });
      item.once('done', (_event, state) => {
        this.inFlight.delete(path);
        ended({ state, path: item.getSavePath() || path, bytes: item.getReceivedBytes() });
      });
    } else if (entry.tab.control === 'agent') {
      item.cancel();
      emit('browser.download.refused', { tabId, url: item.getURL(), filename });
      emit('browser.notice', { appSessionId, tabId, kind: 'downloadRefusedAgent' });
      return;
    }
    if (!agent) {
      if (this.deps.saveDir !== null) item.setSavePath(join(this.deps.saveDir, filename));
      else item.setSaveDialogOptions({ defaultPath: join(this.deps.downloadsDir(), filename) });
    }

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
}
