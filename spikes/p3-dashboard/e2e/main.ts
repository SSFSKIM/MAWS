// P3-E2 M1 spike: the Electron main the export proof launches. It is not MAWS's app: a dashboard kind does not exist
// yet (M2 to M5), so the proof drives MAWS's real export primitives directly. `printHtmlToPdf` (src/main/artifacts/
// export.ts) prints exactly as B's PDF export does (hidden window on the capture partition, JavaScript off, `@page`
// sized), behind the same request policy (`installFramePolicies` on that partition), whose `blocked` callback names
// every request the page tried to make. `capture` is the same window's picture (its preferences copied from
// printHtmlToPdf), the HTML export's screenshot. The test process calls these through `app.evaluate`.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, nativeImage, session } from 'electron';
import { CAPTURE_PARTITION } from '../../../src/main/artifacts/capture';
import { printHtmlToPdf } from '../../../src/main/artifacts/export';
import { installFramePolicies, restrictRequests } from '../../../src/main/artifacts/policies';

app.setPath('userData', mkdtempSync(join(tmpdir(), 'maws-dashboard-spike-')));
const scratch = mkdtempSync(join(tmpdir(), 'maws-dashboard-spike-pages-'));
let pages = 0;

async function print(html: string): Promise<{ pdf: string; blocked: string[] }> {
  const blocked: string[] = [];
  const pdf = await printHtmlToPdf(html, { signal: new AbortController().signal, blocked: (url) => void blocked.push(url) });
  return { pdf: Buffer.from(pdf).toString('base64'), blocked };
}

async function capture(html: string, width: number, height: number): Promise<{ png: string; blocked: string[]; scale: number }> {
  const blocked: string[] = [];
  const file = join(scratch, `page-${(pages += 1)}.html`);
  writeFileSync(file, html, 'utf8');
  const url = pathToFileURL(file).href;
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, partition: CAPTURE_PARTITION, backgroundThrottling: false, disableDialogs: true, spellcheck: false },
  });
  const unrestrict = restrictRequests(win.webContents.id, (u) => (u === url || ['data:', 'blob:', 'about:'].some((s) => u.startsWith(s)) ? false : (blocked.push(u), true)));
  try {
    await win.loadURL(url);
    const image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
    return { png: image.toPNG().toString('base64'), blocked, scale: image.getSize().width / width };
  } finally {
    unrestrict();
    win.destroy();
  }
}

/** Mean absolute difference per channel (0 to 1) of two PNGs, both scaled to `width`×`height`. */
function compare(a: string, b: string, width: number, height: number): number {
  const bitmap = (png: string) => nativeImage.createFromBuffer(Buffer.from(png, 'base64')).resize({ width, height, quality: 'best' }).toBitmap();
  const [x, y] = [bitmap(a), bitmap(b)];
  let sum = 0;
  let n = 0;
  for (let i = 0; i < x.length; i += 4) for (let c = 0; c < 3; c += 1) (sum += Math.abs(x[i + c] - y[i + c])), (n += 1);
  return sum / n / 255;
}

const writeTemp = (name: string, text: string) => {
  const file = join(scratch, name);
  writeFileSync(file, text, 'utf8');
  return pathToFileURL(file).href;
};

Object.assign(globalThis, { spike: { print, capture, compare, writeTemp } });

void app.whenReady().then(() => {
  installFramePolicies(session.fromPartition(CAPTURE_PARTITION), process.env);
  // The page the tests measure, hover and key through: JavaScript on (the host's handlers), default partition.
  const host = new BrowserWindow({ show: false, width: 1000, height: 900, webPreferences: { sandbox: true, contextIsolation: true } });
  void host.loadURL('about:blank');
});
app.on('window-all-closed', () => {});
