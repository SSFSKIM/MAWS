import { join } from 'node:path';
import { BrowserWindow, session } from 'electron';
import { buildCsp } from './csp';

const LIGHT_BG = '#faf9f6'; // --bg of the light theme, so the first frame matches the page (M3 follows the resolved theme)

// electron-vite sets ELECTRON_RENDERER_URL under `electron-vite dev`; a build loads the page from disk.
const devServerUrl = process.env.ELECTRON_RENDERER_URL ?? null;

export function installContentSecurityPolicy(): void {
  if (devServerUrl && __MAWS_DEV_CSP_NONCE__ === null) {
    throw new Error('ELECTRON_RENDERER_URL is set but main was built without the dev CSP nonce');
  }
  const csp = buildCsp(devServerUrl ? { nonce: __MAWS_DEV_CSP_NONCE__!, devServerUrl } : null);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
}

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: 'MAWS',
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: LIGHT_BG,
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

  if (devServerUrl) void win.loadURL(devServerUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}
