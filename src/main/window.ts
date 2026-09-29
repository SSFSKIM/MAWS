import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, session } from 'electron';
import type { WindowState } from '@shared/ipc/schema/layout';
import { buildCsp } from './csp';
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

export function installContentSecurityPolicy(): void {
  if (devServerUrl && __MAWS_DEV_CSP_NONCE__ === null) {
    throw new Error('ELECTRON_RENDERER_URL is set but main was built without the dev CSP nonce');
  }
  const csp = buildCsp(devServerUrl ? { nonce: __MAWS_DEV_CSP_NONCE__!, devServerUrl } : null);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
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
      preload: join(__dirname, '../preload/index.js'),
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => {
    if (placement?.maximized) win.maximize(); // C5
    win.show();
  });

  if (pageUrl) void win.loadURL(pageUrl);
  else void win.loadFile(pageFile);
  return win;
}

export function applyWindowBackground(theme: ResolvedTheme): void {
  for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(THEME_BACKGROUND[theme]);
}
