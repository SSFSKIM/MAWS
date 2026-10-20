// R-1's Electron main: one hidden window (show: false, never focused at the OS level) loading the bundled page, which
// runs the three suites (DOM, React, editor) and reports one JSON object. The page asks main for trusted input
// (webContents.insertText, sendInputEvent) through the preload. Results land in results/run.json; console lines from
// the page in results/console.txt. Run through run.sh (it builds the bundle and holds a heavy-run slot).
import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
app.setPath('userData', mkdtempSync(join(tmpdir(), 'maws-r1-')));
Menu.setApplicationMenu(null); // no Edit menu: ⌘Z must reach the page, not a menu role
const consoleLines = [];
const flushConsole = () => writeFileSync(join(here, 'results', 'console.txt'), consoleLines.join('\n') + '\n');

ipcMain.handle('insertText', (e, text) => e.sender.insertText(text));
ipcMain.handle('key', (e, keyCode, modifiers = []) => {
  e.sender.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  e.sender.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
});
ipcMain.handle('focusContents', (e) => e.sender.focus());
ipcMain.handle('report', (_e, result) => {
  const out = { main: { versions: process.versions, platform: process.platform, arch: process.arch }, ...result };
  writeFileSync(join(here, 'results', 'run.json'), JSON.stringify(out, null, 2) + '\n');
  flushConsole();
  console.log('[r1] wrote results/run.json');
  // Two of five runs hung in Electron's shutdown after the report (main thread parked in mach_msg, no CPU, through
  // app.quit() and app.exit(0) alike); the files are written synchronously above, so end the process outright.
  process.kill(process.pid, 'SIGKILL');
});

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 1000,
    webPreferences: { preload: join(here, 'preload.cjs'), backgroundThrottling: false, contextIsolation: true },
  });
  win.webContents.on('console-message', (e) => consoleLines.push(`[${e.level}] ${e.message}`));
  win.webContents.on('render-process-gone', (_e, d) => {
    console.error('[r1] renderer gone', d);
    app.exit(2);
  });
  setTimeout(() => {
    console.error('[r1] timed out');
    flushConsole();
    app.exit(3);
  }, 120_000);
  await win.loadFile(join(here, 'out', 'index.html'));
});
