// E2's `deliverables` group (docs/doperpowers/plans/2026-10-06-e2-deliverables.md; P1 spec §9 E2, gates G1 to G6): the
// deliverable store, its scheme, its frames and the agent's screenshot in the product app. M3 lays down its first two
// cases on the real Electron, with the scheme handler and the frame policies installed: the PDF trial (Design §3,
// Decision Log 14), which decides the PDF frame's sandbox by loading a hand-written PDF through the scheme into frames
// (a) `sandbox="allow-scripts"`, (b) `sandbox="allow-scripts allow-same-origin"` and (c) no sandbox, and the capture
// (Design §7): `artifact_screenshot`'s offscreen render of a scheme-served page, run in main through the e2e seam, and the
// same page in a viewer frame, whose inline script runs (the app-wide policy leaves the handler's alone) and whose console
// error main attributes to the deliverable. M7 grows the group. Records are written straight into the store's layout
// (`<userData>/deliverables/<appSessionId>/<id>.json`, the reader's format); main's reader has no cache.
// Runs under `pnpm e2e:deliverables` (a harness build, MAWS_HARNESS=1 for playwright.config.ts's list); each launch
// passes MAWS_HARNESS=0, so the window is the product app.
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsArtifactCapture, MawsArtifactCapturedResult } from '@shared/ipc/schema/maws';
import { deliverableUrl, type DeliverableRecord } from '../src/shared/maws/deliverable';
import { launchMaws, type MawsLaunch } from './support/launch';

test.describe.configure({ timeout: 120_000 });

const APP = 'app-e2-deliverables' as AppSessionId;

// One record, written as the engine host writes it.
function seed(userData: string, record: DeliverableRecord): void {
  const dir = join(userData, 'deliverables', record.appSessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${record.id}.json`), `${JSON.stringify(record)}\n`);
}

// A one-page PDF whose page is mostly a filled black square, so a drawn page is told from a blank or blocked frame by its
// dark pixels; the cross-reference offsets are computed, so the file is valid as written.
function minimalPdf(): Buffer {
  const content = '0 0 0 rg 20 20 160 160 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
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

// What main sees of the frame's rect: how many near-black pixels it paints, and every frame URL in the window.
async function frameView(maws: MawsLaunch): Promise<{ dark: number; frames: string[] }> {
  return maws.app.evaluate(async ({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!;
    const bitmap = (await win.webContents.capturePage({ x: 0, y: 0, ...size })).toBitmap(); // BGRA
    let dark = 0;
    for (let i = 0; i < bitmap.length; i += 4) if (bitmap[i] < 40 && bitmap[i + 1] < 40 && bitmap[i + 2] < 40) dark++;
    return { dark, frames: win.webContents.mainFrame.framesInSubtree.map((frame) => frame.url) };
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
    const results: { mode: string; sandbox: string | null; draws: boolean; dark: number; frames: string[] }[] = [];
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
    const report = results.map((r) => `${r.mode} sandbox=${JSON.stringify(r.sandbox)} draws=${r.draws} darkPixels=${r.dark} frames=${JSON.stringify(r.frames)}`).join('\n');
    console.log(`[pdf-trial]\n${report}`);
    await testInfo.attach('pdf-trial.txt', { body: report, contentType: 'text/plain' });
    expect(results.find((r) => r.mode === PDF_CHOSEN)?.draws, report).toBe(true);
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
