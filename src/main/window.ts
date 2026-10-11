import { mkdirSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, session } from 'electron';
import type { WindowState } from '@shared/ipc/schema/layout';
import { buildCsp } from './csp';
import { appWindows, registerAppWindow } from './windows'; // E2
import { recordImeTrace } from './ime-trace'; // P2-F S ime-trace, temporary
import { showAppWindow } from './window-show';
// E2 start
import { attributeConsole, guardFrames, isCspExempt } from './deliverables/policies';
import { emit } from './ipc/events';
// E2 end
import type { ResolvedTheme } from './settings/store';

// Each theme's `--bg` (X7), so the window's first frame and any area the page has not painted match the page.
export const THEME_BACKGROUND: Record<ResolvedTheme, string> = { light: '#faf9f6', dark: '#131313' };

// electron-vite sets ELECTRON_RENDERER_URL under `electron-vite dev`; a build loads the page from disk.
const devServerUrl = process.env.ELECTRON_RENDERER_URL ?? null;
const rendererFile = join(__dirname, '../renderer/index.html');

// What the app window loads; the IPC router accepts invokes only from a top frame at this URL's origin.
export const appUrl = devServerUrl ?? pathToFileURL(rendererFile).href;

// C6: under MAWS_HARNESS=1 the window loads the development harness (harness.html, same origin) instead of the app.
const harness = process.env.MAWS_HARNESS === '1';
const pageFile = harness ? join(__dirname, '../renderer/harness.html') : rendererFile;
const pageUrl = devServerUrl && harness ? new URL('harness.html', devServerUrl).href : devServerUrl;
// end C6

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
    if (isCspExempt(details.url)) return callback({}); // E2: a deliverable's answer carries its own policy (Design §3)
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
}

// ---- C5: window chrome and restored placement ---------------------------------------------------------------------
// The toolbar is the title bar (C5 execution document, "Window state"): the traffic lights are centred in its 44 px
// (`--toolbar-h`), and the window opens where it was left (`window-state.ts` validates the saved bounds against the
// displays before they get here). Maximized is applied just before the first show, so the window never flashes small.
const TRAFFIC_LIGHTS = { x: 16, y: 15 };

function placementOptions(placement: WindowState | null) {
  if (!placement) return {};
  return { ...placement.bounds, fullscreen: placement.fullscreen };
}
// ---- end C5 -----------------------------------------------------------------------------------------------------------

export function createWindow(theme: ResolvedTheme, placement: WindowState | null = null): BrowserWindow {
  const win = new BrowserWindow({
    title: 'MAWS',
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: THEME_BACKGROUND[theme],
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: TRAFFIC_LIGHTS, // C5
    ...placementOptions(placement), // C5
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      plugins: true, // E2: Chromium's own PDF viewer, for a delivered PDF's frame (Design §3); Chromium ships no other plugin
      preload: join(__dirname, '../preload/index.js'),
    },
  });
  // E2 start: an app window (a capture window is not one), its deliverable frames guarded and their console attributed
  registerAppWindow(win);
  guardFrames(win.webContents, process.env);
  attributeConsole(win.webContents, emit);
  // E2 end

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => {
    if (placement?.maximized) win.maximize(); // C5
    showAppWindow(win, process.env); // quiet under MAWS_E2E unless MAWS_E2E_QUIET=0 (owner's rulings 2026-10-06, 2026-10-10)
  });

  // P2-F S ime-trace, temporary: the page learns the flag from its own URL (renderer/src/terminal/ime-trace.ts)
  const traced = process.env.MAWS_IME_TRACE === '1';
  if (traced) {
    mkdirSync(app.getPath('logs'), { recursive: true });
    recordImeTrace(win.webContents, (line) => appendFile(join(app.getPath('logs'), 'ime-trace.log'), line));
  }
  if (pageUrl) void win.loadURL(traced ? `${pageUrl}${pageUrl.includes('?') ? '&' : '?'}imeTrace=1` : pageUrl);
  else void win.loadFile(pageFile, traced ? { query: { imeTrace: '1' } } : {});
  return win;
}

export function applyWindowBackground(theme: ResolvedTheme): void {
  for (const win of appWindows()) win.setBackgroundColor(THEME_BACKGROUND[theme]); // E2
}
