import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, session } from 'electron';
import { buildCsp } from './csp';
import type { ResolvedTheme } from './settings/store';

// Each theme's `--bg` (X7), so the window's first frame and any area the page has not painted match the page.
export const THEME_BACKGROUND: Record<ResolvedTheme, string> = { light: '#faf9f6', dark: '#131313' };

// electron-vite sets ELECTRON_RENDERER_URL under `electron-vite dev`; a build loads the page from disk.
const devServerUrl = process.env.ELECTRON_RENDERER_URL ?? null;

// carried by C9 until the rebase over C6 (wave-2 ledger d.13): MAWS_HARNESS=1 loads the harness page instead of the app
const harness = process.env.MAWS_HARNESS === '1';
const pageFile = harness ? 'harness.html' : 'index.html';
const rendererFile = join(__dirname, '../renderer', pageFile);
const devPageUrl = devServerUrl ? new URL(pageFile, devServerUrl.endsWith('/') ? devServerUrl : `${devServerUrl}/`).href : null;
// carried by C9 until the rebase over C6 (wave-2 ledger d.13)

// What the app window loads; the IPC router accepts invokes only from a top frame at this URL's origin.
export const appUrl = devPageUrl ?? pathToFileURL(rendererFile).href;

// C9 block begin: the fixed directories of the harness's fake sessions (Interfaces *Harness*), created here because
// the sandboxed page cannot. (The harness needed no CSP additions once ghostty-web was discarded at the M1 verdict.)
export const HARNESS_SESSION_DIRS = ['/tmp/maws-harness/a', '/tmp/maws-harness/b'] as const;
export function prepareHarness(): void {
  for (const dir of HARNESS_SESSION_DIRS) mkdirSync(dir, { recursive: true });
}
// C9 block end

export function installContentSecurityPolicy(): void {
  if (devServerUrl && __MAWS_DEV_CSP_NONCE__ === null) {
    throw new Error('ELECTRON_RENDERER_URL is set but main was built without the dev CSP nonce');
  }
  const csp = buildCsp(devServerUrl ? { nonce: __MAWS_DEV_CSP_NONCE__!, devServerUrl } : null);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
}

export function createWindow(theme: ResolvedTheme): BrowserWindow {
  const win = new BrowserWindow({
    title: 'MAWS',
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: THEME_BACKGROUND[theme],
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      preload: join(__dirname, '../preload/index.js'),
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => win.show());

  if (devPageUrl) void win.loadURL(devPageUrl);
  else void win.loadFile(rendererFile);
  return win;
}

export function applyWindowBackground(theme: ResolvedTheme): void {
  for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(THEME_BACKGROUND[theme]);
}
