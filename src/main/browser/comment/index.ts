// Comment mode in main (E4d execution document, Design §1; Interfaces "Main"; Decision Log 26(b)), started from
// `startBrowser`'s E4d block: the mode and its gate (mode.ts) over E4a's tab store, `browser.comment.set`, the listener
// on the preload's channel, the context menu's Comment (menu.ts), the crops' directory and its boot sweep (crop.ts), and
// under MAWS_E2E=1 the e2e's seam `globalThis.__maws_browser_comment`.
//
// The preload's channel is heard from any webContents; the mode resolves the sender through the tab map (E4a Design
// §14: a `browser:preload:*` message counts only from a loaded tab's own page) and drops the rest.
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ipcMain, type IpcMainEvent, type WebContents } from 'electron';
import { COMMENT_CHANNEL } from '@shared/browser/comment-protocol';
import type { BrowserControl } from '@shared/browser/tab';
import type { registerMainHandler } from '../../ipc/router';
import { registerContextMenuExtras } from '../context-menu';
import type { BrowserEmit, TabStore } from '../tabs';
import { withIgnoredAcks } from './ack-filter';
import { captureCrop, sweepCrops } from './crop';
import { commentMenuExtra } from './menu';
import { CommentMode, type CommentTabState } from './mode';

export interface CommentModeStartDeps {
  store: TabStore;
  emit: BrowserEmit;
  register: typeof registerMainHandler;
  userData: string;
  env: NodeJS.ProcessEnv;
}

export interface CommentModeService {
  stop(): void; // at will-quit, with the browser's own stop
}

// The e2e's hands on comment mode (Interfaces "Main"): what a person does natively (`sendInput`: Esc through
// `webContents.sendInputEvent`, the path `before-input-event` hears, which Playwright's CDP keys never raise), the
// context menu's pick (`pickAt`, CSS px), a report fed through the gate as if the preload sent it (`replayReport`:
// the stale, duplicate and oversize cases), the agent taking the page (`setControl`: E4a's `TabStore.setControl`, while
// E4c's own setter is absent), the tab's mode with its page's webContents id (M5 reads the page through main by it),
// and a tab whose arm acknowledgements main never hears (`ignoreAcks`: a page without the preload, made durably, for the
// "armed means acknowledged" defence, Decision Log 34).
export interface CommentModeSeam {
  pickAt(tabId: string, x: number, y: number): boolean;
  state(tabId: string): (CommentTabState & { webContentsId: number | null }) | null;
  sendInput(tabId: string, event: Parameters<WebContents['sendInputEvent']>[0]): boolean;
  replayReport(tabId: string, report: unknown): Promise<boolean>;
  setControl(tabId: string, control: BrowserControl): void;
  ignoreAcks(tabId: string, on: boolean): void;
}

declare global {
  var __maws_browser_comment: CommentModeSeam | undefined;
}

export function startCommentMode({ store, emit, register, userData, env }: CommentModeStartDeps): CommentModeService {
  const dir = join(userData, 'browser', 'crops'); // E4a's layout reserves it (its Design §9)
  const mode = new CommentMode({
    store,
    emit,
    capture: (entry, rect) => (entry.view ? captureCrop(entry.view, rect, { dir, tabId: entry.tab.tabId }) : Promise.resolve({ crop: 'failed' })),
    discard: (path) => void unlink(path).catch(() => {}),
  });
  register('browser.comment.set', ({ tabId, on }) => mode.set(tabId, on));
  const ignoredAcks = new Set<string>(); // filled only by the e2e seam's `ignoreAcks`
  const receive = withIgnoredAcks(ignoredAcks, (sender: WebContents) => store.entryOf(sender)?.tab.tabId, (sender, message) => void mode.receive(sender, message));
  const onPreload = (event: IpcMainEvent, message: unknown) => receive(event.sender, message);
  ipcMain.on(COMMENT_CHANNEL.fromPreload, onPreload);
  const zoomOf = (tabId: string) => {
    const contents = store.entry(tabId)?.view?.webContents;
    return contents && !contents.isDestroyed() ? contents.getZoomFactor() : undefined;
  };
  const offMenu = registerContextMenuExtras(commentMenuExtra((tabId, x, y) => void mode.pickAt(tabId, x, y), zoomOf));
  void sweepCrops(dir, Date.now());

  const seam = env.MAWS_E2E === '1' ? commentSeam(store, mode, ignoredAcks) : null;
  if (seam) globalThis.__maws_browser_comment = seam;

  return {
    stop: () => {
      if (seam && globalThis.__maws_browser_comment === seam) delete globalThis.__maws_browser_comment;
      offMenu();
      ipcMain.removeListener(COMMENT_CHANNEL.fromPreload, onPreload);
      mode.dispose();
    },
  };
}

function commentSeam(store: TabStore, mode: CommentMode, ignoredAcks: Set<string>): CommentModeSeam {
  const page = (tabId: string) => {
    const contents = store.entry(tabId)?.view?.webContents;
    return contents && !contents.isDestroyed() ? contents : null;
  };
  return {
    pickAt: (tabId, x, y) => mode.pickAt(tabId, x, y),
    state: (tabId) => {
      const state = mode.state(tabId);
      return state && { ...state, webContentsId: page(tabId)?.id ?? null };
    },
    sendInput: (tabId, event) => {
      const contents = page(tabId);
      contents?.sendInputEvent(event);
      return contents !== null;
    },
    replayReport: async (tabId, report) => {
      const contents = page(tabId);
      if (contents === null) return false;
      await mode.receive(contents, report);
      return true;
    },
    setControl: (tabId, control) => store.setControl(tabId, control),
    ignoreAcks: (tabId, on) => void (on ? ignoredAcks.add(tabId) : ignoredAcks.delete(tabId)),
  };
}
