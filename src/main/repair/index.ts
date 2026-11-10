// The repair window (P5 O15 M2, docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, acceptance 2, Interfaces §B):
// what a launch on the main profile shows when `mawsd` cannot start, and nothing else of MAWS. A page of its own
// (src/renderer/repair.html, its preload src/preload/repair.ts) that reads none of the app's stores or IPC, over three
// channels of its own. It resolves with the launch of the first attempt that succeeds, and the same process goes on
// into the app; closing the window, or Quit MAWS, quits MAWS. The retries are the controller's (./controller.ts).
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { daemonPaths } from '@shared/daemon/files';
import { REPAIR_ACTIONS, REPAIR_CHANNELS, type RepairAction } from '@shared/repair';
import type { LaunchOutcome, LaunchShape, Unavailable } from '../hosts/daemon';
import { installContentSecurityPolicy, THEME_BACKGROUND } from '../window';
import { showAppWindow } from '../window-show';
import { createRepairController } from './controller';
import { readLogTail } from './log-tail';

export const LOGIN_ITEMS_URL = 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension';

const devServerUrl = process.env.ELECTRON_RENDERER_URL ?? null;

export interface RepairOptions {
  packaged: boolean;
  profileDir: string;
  env: NodeJS.ProcessEnv;
  // a second launch of MAWS while the window is up: the window comes forward and one attempt starts
  onSecondLaunch(listener: () => void): void;
}

export function repairLaunch(first: Unavailable, attempt: () => LaunchOutcome | Promise<LaunchOutcome>, { packaged, profileDir, env, onSecondLaunch }: RepairOptions): Promise<LaunchShape> {
  return new Promise((resolve) => {
    installContentSecurityPolicy();
    const paths = daemonPaths(profileDir);
    const win = new BrowserWindow({
      title: 'MAWS',
      width: 560,
      height: 560,
      minWidth: 440,
      minHeight: 360,
      show: false,
      backgroundColor: THEME_BACKGROUND.light,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, preload: join(__dirname, '../preload/repair.js') },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    const quitOnClose = () => app.quit();
    win.on('closed', quitOnClose);
    const controller = createRepairController({
      first,
      packaged,
      attempt,
      readLog: () => readLogTail(paths),
      changed: (state) => {
        if (!win.isDestroyed()) win.webContents.send(REPAIR_CHANNELS.changed, state);
      },
      openLoginItems: () => openLoginItems(env),
      revealLog: (path) => shell.showItemInFolder(path),
      quit: () => app.quit(),
      succeeded: (launch) => {
        ipcMain.removeHandler(REPAIR_CHANNELS.state);
        ipcMain.removeListener(REPAIR_CHANNELS.act, onAct);
        win.off('closed', quitOnClose);
        app.off('activate', onActivate); // now, not at 'closed': Electron closes the window later
        win.close();
        resolve(launch);
      },
    });
    const fromThisPage = (sender: Electron.WebContents) => sender === win.webContents;
    ipcMain.handle(REPAIR_CHANNELS.state, (event) => (fromThisPage(event.sender) ? controller.state() : null));
    const onAct = (event: Electron.IpcMainEvent, action: unknown) => {
      if (fromThisPage(event.sender) && REPAIR_ACTIONS.includes(action as RepairAction)) controller.act(action as RepairAction);
    };
    ipcMain.on(REPAIR_CHANNELS.act, onAct);
    win.on('focus', () => controller.focused());
    const bringBackAndRetry = () => {
      if (win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      controller.secondLaunch();
    };
    onSecondLaunch(bringBackAndRetry);
    // fix wave 5 (the architect's panel): on macOS reopening MAWS from the Dock or Finder while it runs starts no second
    // process but fires the app's `activate`, which startMain's own listener does not hear yet; while the window is up it
    // does what a second launch does. It goes when the window resolves or closes, leaving startMain's listener the only one.
    const onActivate = () => bringBackAndRetry();
    app.on('activate', onActivate);
    win.on('closed', () => app.off('activate', onActivate));
    win.once('ready-to-show', () => showAppWindow(win, env));
    // fix wave 1: a page that fails to load is said in main's log, never a rejection nothing handles
    const loaded = devServerUrl ? win.loadURL(new URL('repair.html', devServerUrl).href) : win.loadFile(join(__dirname, '../renderer/repair.html'));
    loaded.catch((error: unknown) => console.error('[repair] the repair page did not load', error));
  });
}

// System Settings › Login Items; under the e2e harness the URL goes to the suite's record of external opens instead
// (MAWS_E2E_OPEN_LOG, as layout.openExternal's seam), never to the system
function openLoginItems(env: NodeJS.ProcessEnv): void {
  const log = env.MAWS_E2E === '1' ? env.MAWS_E2E_OPEN_LOG : undefined;
  if (log) {
    void appendFile(log, `openExternal ${LOGIN_ITEMS_URL}\n`).catch((error: unknown) => console.warn('[repair] could not write the e2e seam log', error));
    return;
  }
  shell.openExternal(LOGIN_ITEMS_URL).catch((error: unknown) => console.error('[repair] could not open Login Items', error));
}
