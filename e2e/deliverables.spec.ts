// E2's `deliverables` group (docs/doperpowers/plans/2026-10-06-e2-deliverables.md; P1 spec §9 E2, gates G1 to G6): the
// deliverable store, its scheme, its frames and the agent's screenshot in the product app. M3 laid down its first two
// cases on the real Electron, with the scheme handler and the frame policies installed: the PDF trial (Design §3,
// Decision Log 14), which decides the PDF frame's sandbox by loading a hand-written PDF through the scheme into frames
// (a) `sandbox="allow-scripts"`, (b) `sandbox="allow-scripts allow-same-origin"` and (c) no sandbox, and the capture
// (Design §7): `artifact_screenshot`'s offscreen render of a scheme-served page, run in main through the e2e seam, and the
// same page in a viewer frame, whose inline script runs (the app-wide policy leaves the handler's alone) and whose console
// error main attributes to the deliverable. M6 added the bridge script's pick on the real Chromium.
//
// M7's seven cases drive the product as the owner does, over a scratch project the sidebar shows (support/
// deliverables-scene.ts): (1) the `p1-maws-artifacts` replay, its rows and cells, the screenshot main captured for it and
// the console chip; (2) the Deliverables tool's list, viewer, versions and main tab; (3) a delivered file of every kind
// and the frame policies on the real session; (4) `show_pane 'deliverable'`, found and not; (5) comment mode into E3's
// composer; (6) a relaunch over the same profile and the All scope; (7) a capture beside the attention relay. Records
// are written straight into the store's layout (`<userData>/deliverables/<appSessionId>/<id>.json`, the reader's format)
// where no replay writes them; main's reader has no cache. MAWS_E2_SHOTS=1 also writes the evidence shots in both themes
// under docs/doperpowers/evidence/p1-e2/ (`e2-<surface>-<theme>.png`).
// Runs under `pnpm e2e:deliverables` (a harness build, MAWS_HARNESS=1 for playwright.config.ts's list); each launch
// passes MAWS_HARNESS=0, so the window is the product app.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsArtifactCapture, MawsArtifactCapturedResult } from '@shared/ipc/schema/maws';
import { deliverableUrl, type DeliverableRecord } from '../src/shared/maws/deliverable';
import { TOOL_ERRORS } from '../src/shared/maws/tools';
import { invoke, value } from './support/c7-replay';
import {
  allowNext, closeScene, frameAt, idle, launchScene, listOf, mcpCalls, mcpResultOf, ofKind, openDeliverables, PASS3, recordedCwd, recordPath, replay, rowOf,
  scene, scratchProject, seamLines, seedArtifact, seedFile, shoot, show, unfoldWork, viewerOf, type Scene,
} from './support/deliverables-scene';
import { launchMaws, type MawsLaunch } from './support/launch';
import { solidPng } from './support/side-replay';

test.describe.configure({ timeout: 120_000 });

const APP = 'app-e2-deliverables' as AppSessionId;

// One record, written as the engine host writes it.
function seed(userData: string, record: DeliverableRecord): void {
  const dir = join(userData, 'deliverables', record.appSessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${record.id}.json`), `${JSON.stringify(record)}\n`);
}

// A one-page PDF whose page is mostly a filled black square, so a drawn page is told from a blank or blocked frame by its
// dark pixels; the cross-reference offsets are computed, so the file is valid as written. With `link`, the square is
// also a /URI link annotation to that URL.
function minimalPdf(link?: string): Buffer {
  const content = '0 0 0 rg 20 20 160 160 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << >>${link ? ' /Annots [5 0 R]' : ''} >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...(link ? [`<< /Type /Annot /Subtype /Link /Rect [20 20 180 180] /Border [0 0 0] /A << /Type /Action /S /URI /URI (${link}) >> >>`] : []),
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, k) => {
    offsets.push(body.length);
    body += `${k + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const FRAME = { width: 600, height: 500 };

// An iframe at the window's top-left corner, above everything, pointed at `src`; resolves once its load event fired.
async function mountFrame(maws: MawsLaunch, src: string, sandbox: string | null): Promise<void> {
  await maws.page.evaluate(
    ({ src, sandbox, size }) =>
      new Promise<void>((resolve) => {
        document.getElementById('e2-frame')?.remove();
        const frame = document.createElement('iframe');
        frame.id = 'e2-frame';
        if (sandbox !== null) frame.setAttribute('sandbox', sandbox);
        frame.style.cssText = `position:fixed;left:0;top:0;width:${size.width}px;height:${size.height}px;border:0;z-index:2147483647;background:#fff`;
        frame.addEventListener('load', () => resolve(), { once: true });
        frame.src = src;
        document.body.appendChild(frame);
      }),
    { src, sandbox, size: FRAME },
  );
}

// What main sees of the frame's rect: how many near-black pixels it paints, every frame URL in the window, and the parent
// URL of each frame of Chromium's PDF viewer (the ancestry the frame policies judge it by).
async function frameView(maws: MawsLaunch): Promise<{ dark: number; frames: string[]; viewerParents: (string | null)[] }> {
  return maws.app.evaluate(async ({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!;
    const bitmap = (await win.webContents.capturePage({ x: 0, y: 0, ...size })).toBitmap(); // BGRA
    let dark = 0;
    for (let i = 0; i < bitmap.length; i += 4) if (bitmap[i] < 40 && bitmap[i + 1] < 40 && bitmap[i + 2] < 40) dark++;
    const frames = win.webContents.mainFrame.framesInSubtree;
    const viewerParents = frames.filter((frame) => frame.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')).map((frame) => frame.parent?.url ?? null);
    return { dark, frames: frames.map((frame) => frame.url), viewerParents };
  }, FRAME);
}

// The PDF frame's sandbox, as the trial chose it (Decision Log 14; docs/doperpowers/evidence/p1-e2/pdf-trial.txt).
const PDF_TRIAL = [
  { mode: 'a', sandbox: 'allow-scripts' },
  { mode: 'b', sandbox: 'allow-scripts allow-same-origin' },
  { mode: 'c', sandbox: null },
] as const;
const PDF_CHOSEN: (typeof PDF_TRIAL)[number]['mode'] = 'c';

test('the PDF trial: which frame sandbox draws a scheme-served PDF in Chromium’s viewer', async () => {
  const testInfo = test.info();
  const maws = await launchMaws({ env: { MAWS_HARNESS: '0' } });
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'maws-e2-pdf-')));
  try {
    const path = join(scratch, 'trial.pdf');
    writeFileSync(path, minimalPdf());
    const id = randomUUID();
    seed(maws.userData, { id, appSessionId: APP, kind: 'file', path, title: 'trial.pdf', versions: [{ path, at: new Date().toISOString() }], createdAt: new Date().toISOString() });
    const results: { mode: string; sandbox: string | null; draws: boolean; dark: number; frames: string[]; viewerParents: (string | null)[] }[] = [];
    for (const { mode, sandbox } of PDF_TRIAL) {
      await mountFrame(maws, deliverableUrl(APP, id, 1), sandbox);
      let view = await frameView(maws);
      // Chromium's viewer draws a moment after the frame's load; a frame that never draws is given 8 s
      for (const until = Date.now() + 8_000; view.dark < 2_000 && Date.now() < until; ) {
        await maws.page.waitForTimeout(250);
        view = await frameView(maws);
      }
      results.push({ mode, sandbox, draws: view.dark >= 2_000, ...view });
      await testInfo.attach(`pdf-trial-${mode}.png`, { body: await maws.page.screenshot({ clip: { x: 0, y: 0, ...FRAME } }), contentType: 'image/png' });
    }
    const report = results
      .map((r) => `${r.mode} sandbox=${JSON.stringify(r.sandbox)} draws=${r.draws} darkPixels=${r.dark} frames=${JSON.stringify(r.frames)} viewerParents=${JSON.stringify(r.viewerParents)}`)
      .join('\n');
    console.log(`[pdf-trial]\n${report}`);
    await testInfo.attach('pdf-trial.txt', { body: report, contentType: 'text/plain' });
    expect(results.find((r) => r.mode === PDF_CHOSEN)?.draws, report).toBe(true);
    // the policies' premise (policies.ts): the viewer's frame lies beneath the PDF's own scheme frame, so its links and
    // requests are judged as a deliverable's
    const viewerParents = results.find((r) => r.mode === PDF_CHOSEN)!.viewerParents;
    expect(viewerParents.length, report).toBeGreaterThan(0);
    for (const parent of viewerParents) expect(parent, report).toMatch(/^maws-deliverable:\/\//);
    for (const earlier of PDF_TRIAL.slice(0, PDF_TRIAL.findIndex((t) => t.mode === PDF_CHOSEN))) {
      expect(results.find((r) => r.mode === earlier.mode)?.draws, `${earlier.mode} would have been chosen first\n${report}`).toBe(false);
    }
  } finally {
    await maws.cleanup();
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('the capture renders a scheme-served artifact offscreen at the asked size; the same page’s inline script runs in a viewer frame', async () => {
  const maws = await launchMaws({ env: { MAWS_HARNESS: '0' } });
  try {
    const id = randomUUID();
    const copy = join(maws.userData, 'deliverables', APP, id, 'v1.html');
    mkdirSync(join(copy, '..'), { recursive: true });
    writeFileSync(
      copy,
      '<!doctype html><html><head><title>E2</title></head><body style="margin:0;background:#ff0000">' +
        "<script>parent.postMessage('e2-inline-ran', '*'); console.error('E2_CONSOLE_ERROR');</script></body></html>",
    );
    const at = new Date().toISOString();
    seed(maws.userData, { id, appSessionId: APP, kind: 'artifact', artifactId: 'dash', title: 'Dashboard', path: copy, versions: [{ path: copy, at }], createdAt: at, updatedAt: at });

    // main's deliverables.console events for this page, from before the capture runs, so a capture's would show too
    await maws.page.evaluate(() => {
      const w = window as unknown as { __e2Console?: unknown[] };
      w.__e2Console = [];
      window.maws.on('deliverables.console', (payload) => void w.__e2Console!.push(payload));
    });

    const request: MawsArtifactCapture = { appSessionId: APP, requestId: 'e2-capture' as MawsArtifactCapture['requestId'], deliverableId: id, version: 1, width: 640, height: 480 };
    const result = await maws.app.evaluate(
      (_electron, request) => (globalThis as unknown as { __maws_deliverables: { capture(r: unknown): Promise<MawsArtifactCapturedResult> } }).__maws_deliverables.capture(request),
      request,
    );
    expect(result, JSON.stringify(result).slice(0, 300)).toMatchObject({ ok: true, width: 640, height: 480 });
    if (!result.ok) return;
    const png = Buffer.from(result.png, 'base64');
    expect(png.length).toBeGreaterThan(0);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([640, 480]); // IHDR
    expect(result.consoleErrors).toContain('E2_CONSOLE_ERROR');
    const centre = await maws.app.evaluate(({ nativeImage }, base64) => {
      const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'));
      const { width, height } = image.getSize();
      const bitmap = image.toBitmap();
      const at = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
      return [bitmap[at + 2], bitmap[at + 1], bitmap[at]]; // BGRA to RGB
    }, result.png);
    expect(centre).toEqual([255, 0, 0]); // the page rendered, not a blank window
    // the capture window is gone, and was never an app window the renderer heard from
    expect(await maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

    const ran = maws.page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), 10_000);
          window.addEventListener('message', (event) => {
            if (event.data === 'e2-inline-ran') {
              clearTimeout(timer);
              resolve(true);
            }
          });
        }),
    );
    await mountFrame(maws, deliverableUrl(APP, id, 1), 'allow-scripts');
    expect(await ran, 'the inline script ran under the handler’s policy, not the app’s').toBe(true);
    await expect
      .poll(() => maws.page.evaluate(() => (window as unknown as { __e2Console: unknown[] }).__e2Console))
      .toEqual([expect.objectContaining({ appSessionId: APP, deliverableId: id, version: 1, level: 'error', message: 'E2_CONSOLE_ERROR' })]);
  } finally {
    await maws.cleanup();
  }
});

// M6: the bridge script on the real Chromium (Design §10): served into an artifact whose doctype follows a comment that
// mentions `<head>` (the placement M3's review found wrong: the page must stay in standards mode and the script must
// run), it picks in a scripts-only sandboxed frame when the app asks, swallows the click it picks with, posts the pick to
// the app, and gives the page its clicks back. The viewer's Comment action and the composer are M7's comment case.
test('the bridge script picks an element of an artifact in a sandboxed frame and posts the pick to the app', async () => {
  const maws = await launchMaws({ env: { MAWS_HARNESS: '0' } });
  try {
    const id = randomUUID();
    const copy = join(maws.userData, 'deliverables', APP, id, 'v1.html');
    mkdirSync(join(copy, '..'), { recursive: true });
    writeFileSync(
      copy,
      '<!-- made by the agent; a <head> in a comment --><!doctype html><html><head><title>E2</title></head><body style="margin:0">' +
        '<h1 id="hero" style="margin:0;height:200px">Sales overview</h1><p class="lead">more</p>' +
        "<script>document.addEventListener('click', () => parent.postMessage('e2-page-click', '*'));</script></body></html>",
    );
    const at = new Date().toISOString();
    seed(maws.userData, { id, appSessionId: APP, kind: 'artifact', artifactId: 'dash', title: 'Dashboard', path: copy, versions: [{ path: copy, at }], createdAt: at, updatedAt: at });

    await mountFrame(maws, deliverableUrl(APP, id, 1), 'allow-scripts');
    const frame = maws.page.frames().find((f) => f.url().startsWith('maws-deliverable://'))!;
    expect(await frame.evaluate(() => [document.compatMode, document.head.firstElementChild?.hasAttribute('data-maws-bridge') ?? false])).toEqual(['CSS1Compat', true]);

    // what the frame posts to the app, as the viewer hears it (source checked)
    await maws.page.evaluate(() => {
      const w = window as unknown as { __e2Posted: unknown[] };
      const element = document.getElementById('e2-frame') as HTMLIFrameElement;
      w.__e2Posted = [];
      window.addEventListener('message', (event) => {
        if (event.source === element.contentWindow) w.__e2Posted.push(event.data);
      });
      element.contentWindow!.postMessage({ type: 'maws:pick', on: true }, '*');
    });
    const posted = () => maws.page.evaluate(() => (window as unknown as { __e2Posted: unknown[] }).__e2Posted);
    await maws.page.mouse.move(100, 100);
    await expect.poll(() => frame.locator('[data-maws-pick-overlay]').count()).toBe(1);
    await maws.page.mouse.click(100, 100);
    await expect.poll(posted).toEqual([
      { type: 'maws:picked', selector: '#hero', label: 'h1#hero', text: 'Sales overview', rect: { x: 0, y: 0, width: FRAME.width, height: 200 } },
    ]); // the page never heard the click it was picked with
    expect(await frame.locator('[data-maws-pick-overlay]').count()).toBe(0);
    await maws.page.mouse.click(100, 300);
    await expect.poll(posted).toHaveLength(2);
    expect((await posted())[1]).toBe('e2-page-click'); // picking ended with the pick: the page has its clicks back
  } finally {
    await maws.cleanup();
  }
});

// ---- M7: the product, as the owner drives it ------------------------------------------------------------------------

const ARTIFACTS = `${PASS3}/p1-maws-artifacts.jsonl`;
const SEND_FILE = `${PASS3}/p1-maws-send-file.jsonl`;
const SHOW_PANE = `${PASS3}/p1-maws-show-pane.jsonl`;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_VIEWER = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/';

// A self-contained page: a full-height block of one colour holding `text`, and `extra` before `</body>`.
const pageOf = (text: string, background: string, extra = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${text}</title></head><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:${background};color:#fff;font:600 28px system-ui"><h1 id="heading" style="margin:0;font-size:inherit">${text}</h1>${extra}</body></html>`;

// The window rect of an element, and what main paints there: how many near-black pixels, and the centre of the widest
// run of columns holding them, in window coordinates (the PDF page's black square, which is its link; the viewer's
// thumbnail of it, when its sidebar shows, is the narrower run).
async function darkIn(s: Scene, element: Locator): Promise<{ dark: number; centre: { x: number; y: number } | null }> {
  const rect = (await element.boundingBox())!;
  const clip = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  return s.maws.app.evaluate(async ({ BrowserWindow }, clip) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!;
    const bitmap = (await win.webContents.capturePage(clip)).toBitmap(); // BGRA, at the display's scale
    const scale = Math.sqrt(bitmap.length / 4 / (clip.width * clip.height));
    const width = Math.round(clip.width * scale);
    const isDark = (i: number) => bitmap[i] < 40 && bitmap[i + 1] < 40 && bitmap[i + 2] < 40;
    const columns: number[][] = Array.from({ length: width }, () => []);
    let dark = 0;
    for (let i = 0; i < bitmap.length; i += 4) {
      if (!isDark(i)) continue;
      dark++;
      columns[(i / 4) % width]!.push(Math.floor(i / 4 / width));
    }
    let best: [number, number] | null = null;
    for (let x = 0, start = -1; x <= width; x++) {
      const inRun = x < width && columns[x]!.length > 0;
      if (inRun && start < 0) start = x;
      if (!inRun && start >= 0) {
        if (!best || x - start > best[1] - best[0]) best = [start, x];
        start = -1;
      }
    }
    if (!best) return { dark, centre: null };
    const middle = columns[Math.floor((best[0] + best[1]) / 2)]!;
    const y = (Math.min(...middle) + Math.max(...middle)) / 2;
    return { dark, centre: { x: clip.x + (best[0] + best[1]) / 2 / scale, y: clip.y + y / scale } };
  }, clip);
}

// What main saw the app window navigate, from now on: starts and failed loads of any frame, and top-level commits.
async function recordNavigations(s: Scene): Promise<() => Promise<string[]>> {
  await s.maws.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!;
    const log: string[] = [];
    (globalThis as unknown as { __e2Navigations: string[] }).__e2Navigations = log;
    win.webContents.on('did-start-navigation', (event) => log.push(`start ${event.isMainFrame ? 'window' : 'frame'} ${event.url}`));
    win.webContents.on('did-fail-load', (_event, code, _description, url, main) => log.push(`fail ${main ? 'window' : 'frame'} ${code} ${url}`));
    win.webContents.on('did-navigate', (_event, url) => log.push(`navigated window ${url}`));
  });
  return () => s.maws.app.evaluate(() => [...(globalThis as unknown as { __e2Navigations: string[] }).__e2Navigations]);
}

// Every frame URL in the app window, and the window's own URL.
const framesOfWindow = (s: Scene) =>
  s.maws.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!;
    return { app: win.webContents.getURL(), frames: win.webContents.mainFrame.framesInSubtree.map((frame) => frame.url) };
  });

// Every file under `dir` whose name `match` accepts.
function filesUnder(dir: string, match: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && match(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

// A second of 8 kHz mono 16-bit silence: a valid WAV the audio element loads.
function silentWav(seconds = 1, rate = 8_000): Buffer {
  const data = seconds * rate * 2;
  const wav = Buffer.alloc(44 + data);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + data, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(data, 40);
  return wav;
}

// Two seconds of a canvas whose colour cycles, recorded in the app's page with MediaRecorder: a real `.webm` without a
// checked-in asset.
async function recordedWebm(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const context = canvas.getContext('2d')!;
    const recorder = new MediaRecorder(canvas.captureStream(25), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    const start = performance.now();
    recorder.start(100);
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        const elapsed = performance.now() - start;
        context.fillStyle = `hsl(${Math.round(elapsed / 8) % 360} 70% 45%)`;
        context.fillRect(0, 0, canvas.width, canvas.height);
        if (elapsed > 2_000) {
          clearInterval(timer);
          resolve();
        }
      }, 40);
    });
    recorder.stop();
    await stopped;
    const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return Buffer.from(base64, 'base64');
}

// ---- (1) the artifact replay --------------------------------------------------------------------------------------

// The page the host copies as v1: red, its heading, and an uncaught error on line BOOM_LINE (the console chip must name
// the agent's own line: the bridge script is one line inside <head>, Decision Log 39). v2 is what the recorded Edit made
// of it: blue, and no error.
const BOOM_LINE = 6;
const DASHBOARD_V1 = [
  '<!doctype html>',
  '<html>',
  '<head><meta charset="utf-8"><title>Dashboard</title></head>',
  '<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#d32f2f;color:#fff;font:600 28px system-ui">',
  '<h1 id="heading" style="margin:0;font-size:inherit">HELLO_E2 v1</h1>',
  "<script>throw new Error('E2_BOOM')</script>",
  '</body>',
  '</html>',
].join('\n');
const DASHBOARD_V2 = DASHBOARD_V1.replace('#d32f2f', '#1565c0').replace('HELLO_E2 v1', 'HELLO_E2 v2').replace("<script>throw new Error('E2_BOOM')</script>\n", '');

test('the artifact replay: two artifact rows and a refusal, the list and screenshot cells, main’s real capture in the journal, and the console chip once on the row and in the viewer', async () => {
  test.setTimeout(180_000);
  // The host stats and copies the agent's file in the recording's working directory (the engine's cwd is the recorded
  // `system/init.cwd`, seq 30): the directory is recreated with v1 before the launch and rewritten as v2 before the
  // update is allowed (the recorded Write and Edit are the engine's, replayed, and write nothing).
  const repo = recordedCwd(ARTIFACTS);
  const existed = existsSync(repo);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'dashboard.html'), DASHBOARD_V1);
  try {
    await scene({ titles: ['E2: the dashboard artifact'], repo }, async (s) => {
      const [id] = s.ids;
      await show(s, id);
      await replay(s, id, ARTIFACTS);
      await allowNext(s, id); // Write (seq 154)
      await allowNext(s, id); // mcp__maws__artifact_create (seq 176)
      await allowNext(s, id); // mcp__maws__artifact_screenshot (seq 200): main's capture of v1 answers it
      await allowNext(s, id); // Edit (seq 338)
      writeFileSync(join(repo, 'dashboard.html'), DASHBOARD_V2);
      await allowNext(s, id); // mcp__maws__artifact_update (seq 359)
      await allowNext(s, id); // mcp__maws__artifact_list (seq 381)
      await allowNext(s, id); // mcp__maws__artifact_update "nope" (seq 408)
      await idle(s, id);

      // what the host answered, call by call
      const rows = s.journal(id);
      const calls = mcpCalls(rows);
      expect(calls.map((c) => [c.name, c.args])).toEqual([
        ['artifact_create', { id: 'dash', html_path: 'dashboard.html', title: 'Dashboard' }],
        ['artifact_screenshot', { id: 'dash' }],
        ['artifact_update', { id: 'dash', html_path: 'dashboard.html' }],
        ['artifact_list', {}],
        ['artifact_update', { id: 'nope', html_path: 'dashboard.html' }],
      ]);
      const text = (k: number) => {
        const block = mcpResultOf(rows, calls[k]!.requestId)!.content.find((b) => b.type === 'text')!;
        return JSON.parse((block as { text: string }).text) as Record<string, unknown>;
      };
      const created = text(0);
      expect(created).toMatchObject({ status: 'created', id: 'dash', version: 1, title: 'Dashboard', externalReferences: 0 });
      const deliverableId = created.deliverableId as string;
      // the screenshot: main rendered v1 offscreen at the default size; the PNG block first, then the result
      const shot = mcpResultOf(rows, calls[1]!.requestId)!;
      expect(shot.isError).toBeUndefined();
      expect(shot.content.map((b) => b.type)).toEqual(['image', 'text']);
      const image = shot.content[0] as { type: 'image'; data: string; mimeType: string };
      expect(image.mimeType).toBe('image/png');
      const png = Buffer.from(image.data, 'base64');
      expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1280, 800]); // IHDR
      const captured = text(1);
      expect(captured).toMatchObject({ status: 'captured', id: 'dash', deliverableId, title: 'Dashboard', version: 1, width: 1280, height: 800, bytes: png.length });
      expect((captured.consoleErrors as string[]).some((line) => line.includes('E2_BOOM')), JSON.stringify(captured.consoleErrors)).toBe(true);
      expect(text(2)).toMatchObject({ status: 'updated', id: 'dash', deliverableId, version: 2, title: 'Dashboard' });
      expect(text(3)).toMatchObject({ status: 'listed', artifacts: [{ id: 'dash', deliverableId, title: 'Dashboard', versions: 2 }] });
      expect(mcpResultOf(rows, calls[4]!.requestId)).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.noArtifact('artifact_update', 'nope') }], isError: true });
      expect(ofKind(await s.events(id), 'maws.delivery.artifact').map((e) => [e.action, e.artifactId, e.deliverableId, e.version])).toEqual([
        ['create', 'dash', deliverableId, 1],
        ['update', 'dash', deliverableId, 2],
      ]);

      // the store: one record, two copies, the source left where the agent wrote it (G1)
      const record = JSON.parse(readFileSync(join(s.maws.userData, 'deliverables', id, `${deliverableId}.json`), 'utf8')) as DeliverableRecord;
      expect(record).toMatchObject({ id: deliverableId, appSessionId: id, kind: 'artifact', artifactId: 'dash', title: 'Dashboard' });
      expect(record.versions.map((v) => v.path)).toEqual([1, 2].map((n) => join(s.maws.userData, 'deliverables', id, deliverableId, `v${n}.html`)));
      expect(record.path).toBe(record.versions[1]!.path);
      expect(record.versions.map((v) => readFileSync(v.path, 'utf8'))).toEqual([DASHBOARD_V1, DASHBOARD_V2]);

      // the rows (G4, G5): persistent, so in view with the turn folded
      const artifactRows = s.pane.locator('section.transcript-artifact');
      await expect(artifactRows.locator('[data-artifact-heading]')).toHaveText(['Artifact Dashboard · v1', 'Updated artifact Dashboard · v2', 'Could not register artifact nope: no artifact "nope" in this session']);
      await expect(artifactRows.nth(2).getByRole('button', { name: 'Open' })).toHaveCount(0);

      // v1 from its row: the viewer in the panel draws it, the frame throws once, and the chip counts it on the row and in
      // the viewer, once however many captures ran (the capture's console went into its result alone, Design §8)
      const v1Row = artifactRows.nth(0);
      await v1Row.getByRole('button', { name: 'Open' }).click();
      const viewer = viewerOf(s.panel);
      await expect(viewer).toHaveAttribute('data-deliverable-id', deliverableId);
      await expect(viewer).toHaveAttribute('data-version', '1');
      const frame = await frameAt(s.page, deliverableUrl(id, deliverableId, 1));
      await expect(frame.locator('#heading')).toHaveText('HELLO_E2 v1');
      await expect(viewer.locator('[data-console-chip]')).toHaveText('1 console error');
      await expect(v1Row.locator('[data-console-chip]')).toHaveText('1 console error');
      await expect(artifactRows.nth(1).locator('[data-console-chip]')).toHaveCount(0);
      await s.page.waitForTimeout(1_000);
      await expect(viewer.locator('[data-console-chip]')).toHaveText('1 console error');
      await artifactRows.nth(2).scrollIntoViewIfNeeded();
      await shoot(s, 'artifact-row');

      // the popover names the agent's own line
      const entry = s.page.locator('[data-console-entry]');
      const openPopover = async () => {
        if ((await entry.count()) === 0) await viewer.locator('[data-console-chip]').click();
        await expect(entry).toHaveCount(1);
      };
      await openPopover();
      await expect(entry).toHaveAttribute('data-console-entry', 'error');
      await expect(entry).toContainText(`error · line ${BOOM_LINE}`);
      await expect(entry).toContainText('E2_BOOM');
      await shoot(s, 'console', openPopover);
      await s.page.keyboard.press('Escape');
      await expect(entry).toHaveCount(0);

      // the cells, from the engine's recorded tool_result (the recording's synthetic 64-pixel answer)
      await unfoldWork(s.pane);
      await expect(s.pane.getByText('Listed 1 artifact', { exact: true })).toBeVisible();
      await expect(s.pane.getByText('Screenshot of Dashboard v1 (64 × 64)', { exact: true })).toBeVisible();
    });
  } finally {
    if (!existed) rmSync(repo, { recursive: true, force: true });
  }
});

// ---- (2) the Deliverables tool ---------------------------------------------------------------------------------------

test('the Deliverables tool: groups newest first, Back to the list’s scroll, the version switcher, Open in tab, the tab across a reload and after its record is deleted', async () => {
  await scene({ titles: ['E2: the tool'] }, async (s) => {
    const [id] = s.ids;
    const userData = s.maws.userData;
    // thirty notes a minute apart in the session's directory, then a two-version artifact newer than all of them
    const t0 = Date.parse('2026-10-06T08:00:00.000Z');
    const notes = Array.from({ length: 30 }, (_, k) => {
      const path = join(s.repo, `note-${String(k + 1).padStart(2, '0')}.txt`);
      writeFileSync(path, `NOTE ${k + 1}\n`);
      return seedFile(userData, id, path, new Date(t0 + k * 60_000).toISOString(), k === 0 ? 'the first note' : undefined);
    });
    const artifact = seedArtifact(userData, id, 'sales', 'Sales dashboard', [pageOf('VERSION_ONE', '#00695c'), pageOf('VERSION_TWO', '#4527a0')], new Date(t0 + 3_600_000).toISOString());

    await show(s, id);
    await openDeliverables(s);
    const list = listOf(s);
    await expect(list.locator('[data-group]')).toHaveCount(2);
    expect(await list.locator('[data-group]').evaluateAll((els) => els.map((el) => el.getAttribute('data-group')))).toEqual(['artifact', 'file']);
    await expect(list.locator('[data-group="artifact"] [data-part="title"]')).toHaveText(['Sales dashboard']);
    await expect(list.locator('[data-group="artifact"] [data-part="line"]')).toContainText('v2 · ');
    await expect(list.locator('[data-group="file"] [data-part="title"]')).toHaveText(notes.map((n) => n.title!).reverse());
    await expect(rowOf(list, notes[0]!).locator('[data-part="line"]')).toHaveText('the first note');

    // a row further down opens its viewer; Back returns to the list where it was
    await list.evaluate((el) => (el.scrollTop = 420));
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(420);
    const visible = await list.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const rows = Array.from(el.querySelectorAll<HTMLElement>('[data-deliverable-row]'));
      return rows.find((row) => row.getBoundingClientRect().top >= box.top + 40 && row.getBoundingClientRect().bottom <= box.bottom)!.dataset.deliverableId!;
    });
    await rowOf(list, { id: visible }).click();
    const viewer = viewerOf(s.panel);
    await expect(viewer).toHaveAttribute('data-deliverable-id', visible);
    const note = notes.find((n) => n.id === visible)!;
    await expect(viewer.locator('[data-file-viewer]')).toContainText(readFileSync(note.path, 'utf8').trim());
    await viewer.getByRole('button', { name: 'Back' }).click();
    await expect(list).toBeVisible();
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(420);

    // the artifact opens on its latest version; the switcher offers both, and v1 is another document
    await list.evaluate((el) => (el.scrollTop = 0));
    await rowOf(list, artifact).click();
    await expect(viewer).toHaveAttribute('data-version', '2');
    const versions = viewer.getByRole('combobox', { name: 'Version' });
    await expect(versions.locator('option')).toHaveText(['v1', 'v2 · latest']);
    await expect((await frameAt(s.page, deliverableUrl(id, artifact.id, 2))).locator('#heading')).toHaveText('VERSION_TWO');
    await versions.selectOption('1');
    await expect(viewer).toHaveAttribute('data-version', '1');
    await expect((await frameAt(s.page, deliverableUrl(id, artifact.id, 1))).locator('#heading')).toHaveText('VERSION_ONE');
    await expect.poll(() => s.page.frames().some((f) => f.url() === deliverableUrl(id, artifact.id, 2)), { message: 'the v2 frame is gone' }).toBe(false);
    await shoot(s, 'versions');

    // Open in tab: the same viewer as a main tab, on the record's latest version
    await viewer.getByRole('button', { name: 'Open in tab' }).click();
    const tab = s.page.locator('[data-region="main"] [data-deliverable-tab]');
    await expect(viewerOf(tab)).toHaveAttribute('data-deliverable-id', artifact.id);
    await expect(viewerOf(tab).getByRole('button', { name: 'Open in tab' })).toHaveCount(0);
    await expect(viewerOf(tab).getByRole('button', { name: 'Back' })).toHaveCount(0);
    await shoot(s, 'tab');

    // the tab is restored after a reload of the window
    await s.page.reload();
    await expect(viewerOf(tab)).toHaveAttribute('data-deliverable-id', artifact.id, { timeout: 20_000 });
    await expect((await frameAt(s.page, deliverableUrl(id, artifact.id, 2))).locator('#heading')).toHaveText('VERSION_TWO');

    // the record deleted: the restored tab shows the session's list, headed by the notice
    rmSync(recordPath(userData, artifact));
    await s.page.reload();
    await expect(tab.locator('[data-notice]')).toHaveText(`No deliverable ${artifact.id} in this session`, { timeout: 20_000 });
    await expect(tab.locator('[data-deliverables-list] [data-group]')).toHaveCount(1);
    await expect(rowOf(tab, artifact)).toHaveCount(0);
    await expect(tab.locator('[data-deliverable-row]')).toHaveCount(notes.length);
  });
});

// ---- (3) delivered files -------------------------------------------------------------------------------------------

// A delivered page that runs an inline script (the marker), fetches the web, links to it, offers a download and opens a
// WebRTC connection with a public STUN server: each must stay inside its frame.
const DELIVERED_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Delivered page</title></head>
<body style="margin:0;padding:24px;font:16px system-ui;background:#fff8e1;color:#3e2723">
<h1>Quarterly notes</h1>
<p id="marker">waiting</p>
<p><a id="away" href="https://example.invalid/away">A link to the web</a></p>
<p><a id="save" href="data:text/plain,E2_DOWNLOAD" download="e2-download.txt">A download</a></p>
<script>
document.getElementById('marker').textContent = 'SCRIPT_RAN';
fetch('https://example.invalid/fetch').then(() => console.error('E2_FETCH_REACHED'), (error) => console.error('E2_FETCH_FAILED ' + error.message));
(async () => {
  const types = [];
  const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peer.onicecandidate = (event) => { if (event.candidate) types.push(event.candidate.type); };
  peer.createDataChannel('e2');
  await peer.setLocalDescription(await peer.createOffer());
  await new Promise((resolve) => { peer.onicegatheringstatechange = () => peer.iceGatheringState === 'complete' && resolve(); setTimeout(resolve, 8000); });
  document.body.dataset.ice = 'done:' + types.join(',');
  peer.close();
})();
</script>
</body></html>`;

test('delivered files: every kind draws in its body inside and outside the session’s directory, Reveal and Open externally reach the seam, and the frames reach nothing', async () => {
  test.setTimeout(240_000);
  await scene({ titles: ['E2: delivered files'] }, async (s) => {
    const [id] = s.ids;
    const userData = s.maws.userData;
    const outside = join(s.scratch.root, 'elsewhere');
    mkdirSync(outside);
    const at = (k: number) => new Date(Date.parse('2026-10-06T09:00:00.000Z') + k * 60_000).toISOString();
    const put = (dir: string, name: string, bytes: Buffer | string) => {
      writeFileSync(join(dir, name), bytes);
      return join(dir, name);
    };
    // four inside the session's directory, three outside it
    const pdf = seedFile(userData, id, put(s.repo, 'report.pdf', minimalPdf('https://example.invalid/pdf-link')), at(0), 'the report');
    const html = seedFile(userData, id, put(s.repo, 'notes.html', DELIVERED_PAGE), at(1));
    const markdown = seedFile(userData, id, put(s.repo, 'summary.md', '# Summary\n\nThe **quarter** closed above plan.\n\n- revenue up\n- costs flat\n'), at(2));
    const wav = seedFile(userData, id, put(s.repo, 'tone.wav', silentWav()), at(3));
    const webm = seedFile(userData, id, put(outside, 'clip.webm', await recordedWebm(s.page)), at(4), 'a short clip');
    const png = seedFile(userData, id, put(outside, 'chart.png', solidPng(320, 200, [46, 125, 50])), at(5));
    const code = seedFile(userData, id, put(outside, 'util.ts', 'export function total(values: number[]): number {\n  return values.reduce((a, b) => a + b, 0);\n}\n'), at(6));
    const downloads = join(s.scratch.root, 'downloads');
    mkdirSync(downloads);
    await s.maws.app.evaluate(({ app }, dir) => app.setPath('downloads', dir), downloads);

    await show(s, id);
    await openDeliverables(s);
    const list = listOf(s);
    const viewer = viewerOf(s.panel);
    const open = async (record: DeliverableRecord, body: string) => {
      if (await viewer.isVisible()) await viewer.getByRole('button', { name: 'Back' }).click();
      await rowOf(list, record).click();
      await expect(viewer).toHaveAttribute('data-deliverable-id', record.id);
      await expect(viewer).toHaveAttribute('data-body', body);
    };
    const button = (name: string) => viewer.getByRole('button', { name, exact: true });
    // Reveal on every one, Open externally on the kinds main hands to the OS (Decision Log 17), each through the seam
    const expected: string[] = [];
    const opened = () => seamLines(s).filter((l) => !l.startsWith('blocked-'));
    const reach = async (record: DeliverableRecord, external: boolean) => {
      await expect(button('Open externally')).toHaveCount(external ? 1 : 0);
      if (external) {
        await button('Open externally').click();
        expected.push(record.path);
        await expect.poll(opened).toEqual(expected);
      }
      await button('Reveal in Finder').click();
      expected.push(`reveal ${record.path}`);
      await expect.poll(opened).toEqual(expected);
    };

    // the HTML page: its inline script ran in a scripts-only frame; the fetch failed and shows in the chip
    await open(html, 'html');
    await expect(viewer.locator('[data-deliverable-frame="html"]')).toHaveAttribute('sandbox', 'allow-scripts');
    const page = await frameAt(s.page, deliverableUrl(id, html.id, 1));
    await expect(page.locator('#marker')).toHaveText('SCRIPT_RAN');
    await expect(viewer.locator('[data-console-chip]')).toBeVisible();
    await shoot(s, 'viewer-html');
    await viewer.locator('[data-console-chip]').click();
    await expect(s.page.locator('[data-console-entry]').filter({ hasText: 'E2_FETCH_FAILED' })).toHaveCount(1);
    await expect(s.page.locator('[data-console-entry]').filter({ hasText: 'E2_FETCH_REACHED' })).toHaveCount(0);
    await s.page.keyboard.press('Escape');
    // no server-reflexive candidate: WebRTC never left the machine (disable_non_proxied_udp)
    await expect.poll(() => page.evaluate(() => document.body.dataset.ice ?? ''), { timeout: 15_000 }).toMatch(/^done:/);
    const ice = await page.evaluate(() => document.body.dataset.ice!);
    console.log(`[e2-files] ICE candidate types in the frame: ${JSON.stringify(ice)}`);
    expect(ice).not.toContain('srflx');
    // a download link saves nothing: the frame's sandbox (no allow-downloads) refuses it before any download starts
    await page.locator('#save').click();
    await s.page.waitForTimeout(1_500);
    expect(seamLines(s).filter((l) => l.startsWith('blocked-download')), 'no download reached main').toEqual([]);
    expect(filesUnder(downloads, () => true)).toEqual([]);
    expect(filesUnder(userData, (name) => name === 'e2-download.txt' || name.endsWith('.crdownload'))).toEqual([]);
    // a link to the web: the app's own `frame-src` refuses the frame's navigation before any request is made (so main's
    // frame guard is never asked); the frame is left on Chromium's blocked page until Reload, the window stays put
    const navigations = await recordNavigations(s);
    const appUrl = s.page.url();
    await page.locator('#away').click();
    await expect.poll(navigations).toContain('fail frame -30 https://example.invalid/away'); // ERR_BLOCKED_BY_CSP
    expect((await navigations()).filter((line) => line.startsWith('navigated window'))).toEqual([]);
    expect(s.page.url()).toBe(appUrl);
    await button('Reload').click();
    await expect((await frameAt(s.page, deliverableUrl(id, html.id, 1))).locator('#marker')).toHaveText('SCRIPT_RAN');
    await reach(html, true);

    // the PDF: Chromium's viewer draws it in its unsandboxed frame (Decision Log 31)
    await open(pdf, 'pdf');
    const pdfFrame = viewer.locator('[data-deliverable-frame="pdf"]');
    await expect(pdfFrame).not.toHaveAttribute('sandbox');
    await expect.poll(async () => (await darkIn(s, pdfFrame)).dark, { timeout: 15_000, message: 'the PDF frame draws its page' }).toBeGreaterThan(2_000);
    await shoot(s, 'viewer-pdf');
    // its link: Chromium's viewer asks to navigate the window itself; main's top-level guard (`window.ts`) refuses it, so
    // the app stays put and no frame holds anything outside the scheme, the viewer and its resources
    const square = (await darkIn(s, pdfFrame)).centre!;
    await s.page.mouse.click(square.x, square.y);
    await expect.poll(navigations, { timeout: 10_000 }).toContain('start window https://example.invalid/pdf-link');
    await s.page.waitForTimeout(1_000);
    expect((await navigations()).filter((line) => line.startsWith('navigated window'))).toEqual([]);
    const after = await framesOfWindow(s);
    expect(after.app).toBe(appUrl);
    expect(s.page.url()).toBe(appUrl);
    for (const url of after.frames.slice(1)) expect(url, JSON.stringify(after.frames)).toMatch(/^(maws-deliverable:\/\/|chrome-extension:\/\/mhjfbmdgcfjbbpaeojofohoefgiehjai\/|chrome:\/\/resources\/)/);
    // its Download button, pressed in the viewer's own page: main cancels the download, and no file is written anywhere
    const pressed = await s.maws.app.evaluate(async ({ BrowserWindow }, viewerOrigin) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!;
      const script = `(() => {
        const viewer = document.querySelector('pdf-viewer');
        const toolbar = viewer && viewer.shadowRoot && viewer.shadowRoot.querySelector('viewer-toolbar');
        const controls = toolbar && toolbar.shadowRoot && toolbar.shadowRoot.querySelector('viewer-download-controls');
        const download = controls && controls.shadowRoot && controls.shadowRoot.querySelector('#save');
        if (!download) return 'no button';
        download.click();
        return 'pressed';
      })()`;
      const answers: string[] = [];
      for (const frame of win.webContents.mainFrame.framesInSubtree.filter((f) => f.url.startsWith(viewerOrigin))) answers.push(`${frame.url} ${String(await frame.executeJavaScript(script, true))}`);
      return answers;
    }, PDF_VIEWER);
    expect(pressed.some((answer) => answer.endsWith(' pressed')), JSON.stringify(pressed)).toBe(true);
    await expect.poll(() => seamLines(s)).toContain(`blocked-download ${deliverableUrl(id, pdf.id, 1)}`);
    await s.page.waitForTimeout(1_000);
    expect(filesUnder(downloads, () => true)).toEqual([]);
    expect(filesUnder(userData, (name) => name.endsWith('.pdf') || name.endsWith('.crdownload'))).toEqual([]);
    await reach(pdf, true);

    // media: the clip plays and seeks; the tone plays
    await open(webm, 'video');
    const video = viewer.locator('video[data-deliverable-media="video"]');
    await expect(video).toHaveAttribute('controls', '');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
    await video.evaluate(async (v: HTMLVideoElement) => {
      v.muted = true;
      await v.play();
    });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.2);
    const seeked = await video.evaluate(
      (v: HTMLVideoElement) =>
        new Promise<number>((resolve) => {
          v.pause();
          v.addEventListener('seeked', () => resolve(v.currentTime), { once: true });
          v.currentTime = 0.5;
        }),
    );
    expect(seeked).toBeCloseTo(0.5, 0);
    await shoot(s, 'viewer-media');
    await reach(webm, true);
    await open(wav, 'audio');
    const audio = viewer.locator('audio[data-deliverable-media="audio"]');
    await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.duration)).toBeCloseTo(1, 1);
    await audio.evaluate((a: HTMLAudioElement) => a.play());
    await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0);
    await reach(wav, true);

    // the image draws inline, from outside the session's directory; no Open as file for a file the editor could not save
    await open(png, 'file');
    const img = viewer.locator('[data-file-viewer][data-kind="image"] [data-image-view] img');
    await expect(img).toBeVisible();
    expect(await img.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(320);
    await expect(button('Open as file')).toHaveCount(0);
    await shoot(s, 'viewer-image');
    await reach(png, true);

    // markdown renders read-only; inside the session's directory it opens as a file too; not handed to the OS
    await open(markdown, 'file');
    await expect(viewer.locator('[data-file-viewer][data-kind="markdown"] [data-markdown-view] h1')).toHaveText('Summary');
    await expect(button('Open as file')).toHaveCount(1);
    await shoot(s, 'viewer-markdown');
    await reach(markdown, false);

    // code shows read-only, from outside the session's directory; a save through E5's write is refused there
    await open(code, 'file');
    const codeView = viewer.locator('[data-file-viewer][data-kind="code"]');
    await expect(codeView).toHaveAttribute('data-editable', 'false');
    await expect(codeView.locator('.cm-content')).toContainText('export function total');
    await expect(button('Open as file')).toHaveCount(0);
    await reach(code, false);
    const read = value(await invoke(s.page, 'files.read', { appSessionId: id, path: code.path, hash: true }));
    const write = await invoke(s.page, 'files.write', { appSessionId: id, path: code.path, content: 'overwritten', expectedHash: read.hash! });
    expect(write.ok, JSON.stringify(write)).toBe(false);
    expect(readFileSync(code.path, 'utf8')).toContain('export function total');

    // the seam saw exactly the opens and reveals asked for, the outside files' included
    expect(opened()).toEqual(expected);
    for (const record of [webm, png, code]) expect(expected).toContain(`reveal ${record.path}`);
  });
});

// ---- (4) show_pane 'deliverable' -------------------------------------------------------------------------------------

test('show_pane: a target no record answers to is the model’s error; an artifact the target names opens in the Deliverables viewer and answers panel-tool', async () => {
  test.setTimeout(180_000);
  await scene({ titles: ['E2: show_pane, nothing delivered', 'E2: show_pane, an artifact'] }, async (s) => {
    const [bare, seeded] = s.ids;
    // the recording's target is `none`: an artifact may carry that id (Decision Log 34: the model names what it holds)
    const none = seedArtifact(s.maws.userData, seeded, 'none', 'Release notes', [pageOf('RELEASE_NOTES', '#37474f')]);
    const answers = (id: string) => {
      const rows = s.journal(id);
      return mcpCalls(rows).map((c) => mcpResultOf(rows, c.requestId)!);
    };
    const panesShown = async (id: string) => ofKind(await s.events(id), 'maws.pane.shown').map((e) => [e.pane, e.opened?.kind ?? null, e.error]);

    await show(s, bare);
    await replay(s, bare, SHOW_PANE);
    for (let k = 0; k < 3; k++) await allowNext(s, bare); // terminal, deliverable, nope (seqs 68, 85, 100)
    await idle(s, bare);
    expect(answers(bare)[1]).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.deliverableNotFound('none') }], isError: true });
    expect(await panesShown(bare)).toEqual([
      ['terminal', 'panel-tool', null],
      ['deliverable', null, TOOL_ERRORS.deliverableNotFound('none')],
    ]);
    // the cell draws the engine's recorded tool_result, E1's words (Surprises, M4); the replay compares no bodies
    await unfoldWork(s.pane);
    await expect(s.pane.getByText('Could not open pane: the deliverable pane is not available in this build of MAWS')).toBeVisible();

    await show(s, seeded);
    await replay(s, seeded, SHOW_PANE);
    await allowNext(s, seeded); // terminal
    await allowNext(s, seeded); // deliverable "none": the viewer opens on the artifact
    const viewer = viewerOf(s.panel);
    await expect(viewer).toHaveAttribute('data-deliverable-id', none.id);
    await expect(s.panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { name: /Deliverables/ })).toHaveAttribute('aria-selected', 'true');
    await expect((await frameAt(s.page, deliverableUrl(seeded, none.id, 1))).locator('#heading')).toHaveText('RELEASE_NOTES');
    await allowNext(s, seeded); // nope
    await idle(s, seeded);
    const shown = answers(seeded)[1]!;
    expect(shown.isError).toBeUndefined();
    expect(JSON.parse((shown.content[0] as { text: string }).text)).toMatchObject({ status: 'shown', pane: 'deliverable', opened: { kind: 'panel-tool', toolId: 'deliverables', title: 'Deliverables' } });
    expect(await panesShown(seeded)).toEqual([
      ['terminal', 'panel-tool', null],
      ['deliverable', 'panel-tool', null],
    ]);
  });
});

// ---- (5) comment mode -------------------------------------------------------------------------------------------------

const COMMENT_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><title>Dashboard</title></head><body style="margin:0;font:16px system-ui;background:#ffffff;color:#1b1b1b">' +
  '<h1 id="hero" style="margin:0;padding:32px 24px;background:#e3f2fd">Sales overview</h1>' +
  '<p class="lead" style="padding:0 24px">Revenue by region, third quarter.</p>' +
  "<script>console.error('E2_PAGE_LOG')</script></body></html>";

test('comment mode: Escape ends picking and nothing else, picking highlights the element under the pointer, and a click opens E3’s composer on the artifact-element anchor', async () => {
  await scene({ titles: ['E2: comment'] }, async (s) => {
    const [id] = s.ids;
    const record = seedArtifact(s.maws.userData, id, 'dash', 'Dashboard', [COMMENT_PAGE]);
    await show(s, id);
    await openDeliverables(s);
    await rowOf(listOf(s), record).click();
    const viewer = viewerOf(s.panel);
    const frame = await frameAt(s.page, deliverableUrl(id, record.id, 1));
    await expect(frame.locator('#hero')).toHaveText('Sales overview');
    await expect(viewer.locator('[data-console-chip]')).toHaveText('1 console error');
    const comment = viewer.getByRole('button', { name: 'Comment', exact: true });
    const hint = viewer.locator('[data-picking]');
    const deliverablesTab = s.panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { name: /Deliverables/ });

    // Escape while picking ends picking; the viewer, the panel's tab and the session's composer stay as they were
    await comment.click();
    await expect(comment).toHaveAttribute('aria-pressed', 'true');
    await expect(hint).toHaveText('Click an element to comment on it · Esc cancels');
    await s.page.keyboard.press('Escape');
    await expect(hint).toHaveCount(0);
    await expect(comment).toHaveAttribute('aria-pressed', 'false');
    await expect(viewer).toHaveAttribute('data-deliverable-id', record.id);
    await expect(deliverablesTab).toHaveAttribute('aria-selected', 'true');
    await expect(s.pane.locator(`[data-composer="${id}"]`)).toBeVisible();

    // with the console popover open over a picking viewer, one Escape closes the popover alone
    await comment.click();
    await expect(hint).toBeVisible();
    await viewer.locator('[data-console-chip]').click();
    await expect(s.page.locator('[data-console-entry]')).toHaveCount(1);
    await s.page.keyboard.press('Escape');
    await expect(s.page.locator('[data-console-entry]')).toHaveCount(0);
    await expect(hint).toBeVisible();
    await expect(comment).toHaveAttribute('aria-pressed', 'true');

    // the heading under the pointer is highlighted in the page; a click picks it and opens E3's composer
    const box = (await viewer.locator('[data-deliverable-frame="html"]').boundingBox())!;
    await s.page.mouse.move(box.x + 60, box.y + 30);
    await expect(frame.locator('[data-maws-pick-overlay]')).toHaveCount(1);
    await shoot(s, 'comment-picking', () => s.page.mouse.move(box.x + 61, box.y + 31));
    await s.page.mouse.click(box.x + 60, box.y + 30);
    const composer = s.page.getByRole('dialog', { name: 'Comment on Dashboard v1 › h1#hero “Sales overview”' });
    await expect(composer).toBeVisible();
    await expect(composer).toHaveAttribute('data-anchor-kind', 'artifact-element');
    await expect(composer).toHaveAttribute('data-anchor-locator', '#hero');
    await expect(hint).toHaveCount(0); // one pick per Comment
    await expect(frame.locator('[data-maws-pick-overlay]')).toHaveCount(0);
    await composer.getByRole('textbox', { name: 'Comment' }).fill('Make the heading larger.');
    await shoot(s, 'comment');
    await s.page.keyboard.press('Escape');
    await expect(composer).toHaveCount(0);
  });
});

// ---- (6) a relaunch, and the All scope -------------------------------------------------------------------------------

test('a relaunch over the same profile lists every deliverable; the All scope shows another session’s with its title and opens it; a delivered file’s name opens the viewer', async () => {
  test.setTimeout(180_000);
  // send_file stats the file in the recording's working directory, recreated before the launch (as E1's case does)
  const repo = recordedCwd(SEND_FILE);
  const existed = existsSync(repo);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'hello.txt'), 'HELLO_E1');
  const scratch = scratchProject({ titles: ['E2: delivered here', 'E2: the other session'], repo });
  try {
    const first = await launchScene(scratch);
    const [here, other] = first.ids;
    let hello: string;
    let dashboard: DeliverableRecord;
    let report: DeliverableRecord;
    try {
      await show(first, here);
      await replay(first, here, SEND_FILE);
      await allowNext(first, here); // Write (seq 67)
      await allowNext(first, here); // mcp__maws__send_file (seq 99)
      await idle(first, here);
      const [delivered] = ofKind(await first.events(here), 'maws.delivery.file');
      hello = delivered!.deliverables[0]!.id;
      // the delivery row's file name opens the Deliverables viewer on the record (G5)
      const name = first.pane.locator('[data-delivery] button.transcript-delivery-open');
      await expect(name).toHaveText('hello.txt');
      await name.click();
      await expect(viewerOf(first.panel)).toHaveAttribute('data-deliverable-id', hello);
      await expect(viewerOf(first.panel).locator('[data-file-viewer]')).toContainText('HELLO_E1');
      await first.pane.locator('[data-delivery]').scrollIntoViewIfNeeded();
      await shoot(first, 'delivery-row');
      dashboard = seedArtifact(first.maws.userData, here, 'dash', 'Dashboard', [pageOf('DASHBOARD', '#ad1457')]);
      report = seedArtifact(first.maws.userData, other, 'report', 'Other report', [pageOf('OTHER_REPORT', '#283593')]);
    } catch (error) {
      await first.maws.cleanup();
      throw error;
    }
    await closeScene(first);

    const second = await launchScene(scratch, first.ids);
    try {
      await show(second, here);
      // the panel comes back as it was (the Deliverables tool on the viewer), or the tool is opened afresh
      const list = listOf(second);
      const viewer = viewerOf(second.panel);
      await expect(list.or(viewer).or(second.panel.getByRole('button', { name: 'Add a tool' })).first()).toBeVisible();
      if (await viewer.isVisible()) await viewer.getByRole('button', { name: 'Back' }).click();
      else if (!(await list.isVisible())) await openDeliverables(second);
      await expect(list.locator('[data-deliverable-row] [data-part="title"]')).toHaveText(['Dashboard', 'hello.txt']);
      await expect(rowOf(list, { id: hello })).toHaveAttribute('data-kind', 'file');
      await expect(rowOf(list, dashboard)).toHaveAttribute('data-kind', 'artifact');

      await list.getByRole('button', { name: 'All sessions' }).click();
      await expect(list.locator('[data-deliverable-row]')).toHaveCount(3);
      await expect(rowOf(list, report).locator('[data-part="session"]')).toHaveText('E2: the other session');
      await rowOf(list, report).click();
      await expect(viewer).toHaveAttribute('data-deliverable-id', report.id);
      await expect((await frameAt(second.page, deliverableUrl(other, report.id, 1))).locator('#heading')).toHaveText('OTHER_REPORT');
    } catch (error) {
      await second.maws.cleanup();
      throw error;
    }
    await closeScene(second);
  } finally {
    rmSync(scratch.root, { recursive: true, force: true });
    if (!existed) rmSync(repo, { recursive: true, force: true });
  }
});

// ---- (7) the capture and the attention relay ---------------------------------------------------------------------

// A capture window is not an app window (Decision Log 21): its load must not make the app's page un-announced, or a
// notification's click would be queued for a page that already listens and never asks again. A real notification for
// the replay's first permission (posted while the window is blurred; `show` is held in main, so nothing reaches macOS)
// is clicked while a capture window is up: the page hears the navigation at once, and nothing is left queued.
test('a capture while a notification’s navigation is on its way: the page hears the click at once and nothing stays queued', async () => {
  await scene({ titles: ['E2: attention'] }, async (s) => {
    const [id] = s.ids;
    const record = seedArtifact(s.maws.userData, id, 'dash', 'Dashboard', [pageOf('CAPTURED', '#d32f2f')]);
    await show(s, id);
    await s.page.evaluate(() => {
      const w = window as unknown as { __e2Navigate: unknown[] };
      w.__e2Navigate = [];
      window.maws.on('attention.navigate', (payload) => void w.__e2Navigate.push(payload));
    });
    await s.maws.app.evaluate(({ Notification }) => {
      const shown: unknown[] = [];
      (globalThis as unknown as { __e2Notifications: unknown[] }).__e2Notifications = shown;
      Notification.prototype.show = function show(this: unknown) {
        shown.push(this);
      };
    });
    await s.maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.blur());
    expect(await s.maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((win) => win.isFocused())), 'the blur took').toBe(false);

    await replay(s, id, SHOW_PANE);
    const notifications = () => s.maws.app.evaluate(() => (globalThis as unknown as { __e2Notifications: unknown[] }).__e2Notifications.length);
    await expect.poll(notifications, { timeout: 30_000 }).toBe(1);

    // the capture starts; while its window is up the notification is clicked
    const request: MawsArtifactCapture = { appSessionId: id, requestId: 'e2-attention' as MawsArtifactCapture['requestId'], deliverableId: record.id, version: 1, width: 800, height: 600 };
    const capture = s.maws.app.evaluate(
      (_electron, request) => (globalThis as unknown as { __maws_deliverables: { capture(r: unknown): Promise<MawsArtifactCapturedResult> } }).__maws_deliverables.capture(request),
      request,
    );
    await expect.poll(() => s.maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), { timeout: 10_000 }).toBe(2);
    await s.maws.app.evaluate(() => (globalThis as unknown as { __e2Notifications: { emit(event: string): void }[] }).__e2Notifications[0]!.emit('click'));
    expect(await capture).toMatchObject({ ok: true, width: 800, height: 600 });
    await expect
      .poll(() => s.page.evaluate(() => (window as unknown as { __e2Navigate: unknown[] }).__e2Navigate))
      .toEqual([expect.objectContaining({ appSessionId: id, source: 'notification' })]);
    expect(value(await invoke(s.page, 'attention.pendingNavigate', undefined)).navigate).toBeNull();
    expect(await s.maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

    // the replay finishes as recorded
    for (let k = 0; k < 3; k++) await allowNext(s, id);
    await idle(s, id);
  });
});
