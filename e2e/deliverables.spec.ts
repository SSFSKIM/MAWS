// E2's `deliverables` group (docs/doperpowers/plans/2026-10-06-e2-deliverables.md; P1 spec §9 E2, gates G1 to G6): the
// deliverable store, its scheme, its frames and the agent's screenshot in the product app. P3-L M6b (the cutover): the
// same cases on the renamed surface, selectors and labels only: a pre-P3 deliverable is an X12 record written as E2's
// host wrote it, imported as the host imports it at start (`importSeeded`; a record's id is its artifact's), framed on
// `maws-artifact:` at the place of its version (`pageUrlOf`), in the Artifacts tool (E2's Deliverables tool) whose
// actions are the viewer's X32 header's. The assertions on what only the Deliverables tool showed (a list row's version
// count and caption, the All scope's session names, the deleted record's notice over the session's list) are gone with
// it, each named where it stood. M3 laid down its first two
// cases on the real Electron, with the scheme handler and the frame policies installed: the PDF trial (Design §3,
// Decision Log 14), which decides the PDF frame's sandbox by loading a hand-written PDF through the scheme into frames
// (a) `sandbox="allow-scripts"`, (b) `sandbox="allow-scripts allow-same-origin"` and (c) no sandbox, and the capture
// (Design §7): `artifact_screenshot`'s offscreen render of a scheme-served page, run in main through the e2e seam, and the
// same page in a viewer frame, whose inline script runs (the app-wide policy leaves the handler's alone) and whose console
// error main attributes to the deliverable. M6 added the bridge script's pick on the real Chromium.
//
// M7's seven cases drive the product as the owner does, over a scratch project the sidebar shows (support/
// maws-tools.ts): (1) the `p1-maws-artifacts` replay, its rows and cells, the screenshot main captured for it and
// the console chip; (2) the Deliverables tool's list, viewer, versions and main tab; (3) a delivered file of every kind
// and the frame policies on the real session; (4) `show_pane 'deliverable'`, found and not (U6d: refused, opening nothing); (5) comment mode into the
// comment card beside the element (P2-E1; E3's composer before it); (6) a relaunch over the same profile and the All scope; (7) a capture beside the attention relay; P2-F added (8) the media viewers' fit, zoom and actual size (L95). Records
// are written straight into the store's layout (`<userData>/deliverables/<appSessionId>/<id>.json`, the reader's format)
// where no replay writes them; main's reader has no cache. MAWS_E2_SHOTS=1 also writes the evidence shots in both themes
// under docs/doperpowers/evidence/p1-e2/ (`e2-<surface>-<theme>.png`).
// Runs under `pnpm e2e:deliverables` (a harness build, MAWS_HARNESS=1 for playwright.config.ts's list); each launch
// passes MAWS_HARNESS=0, so the window is the product app.
import { addressed } from './support/address';
import { closeSideTab, hideSurface, openSurface, sideColumn, sideGroup, sideTab, surface, surfaceRow, mainTabs as shellMainTabs } from './support/shell';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import type { ArtifactConsole } from '@shared/ipc/schema/artifacts';
import type { MawsArtifactCapture, MawsArtifactCapturedResult } from '@shared/ipc/schema/maws';
import type { DeliverableRecord } from '../src/shared/maws/deliverable';
import { commentsMessage, readAnchoredMessage } from '../src/shared/anchor/message'; // UX wave U5a
import { linkedReadOf } from '../src/shared/maws/linked-read'; // UX wave U5a
import { TOOL_ERRORS } from '../src/shared/maws/tools';
import { invoke, launchReady, turnsJournal, value } from './support/c7-replay';
import { FIRST_CREATED_REVISION } from './support/design-systems'; // Decision Log 67: fresh artifacts follow the seeded defaults.
import {
  allowNext, asPublishReplay, closeScene, frameAt, headerAction, headerActions, idle, importSeeded, launchScene, listOf, mcpCalls, mcpResultOf, ofKind, openArtifacts, PASS3, pageUrlOf,
  recordedCwd, replay, rowOf, scene, scratchProject, seamLines, seedArtifact, seedFile, shoot, show, unfoldWork, viewerOf, pointInFrame, type Scene,
} from './support/maws-tools';
import { launchMaws, type MawsLaunch } from './support/launch';
import { menu } from './support/menu'; // P3-G
import { solidPng } from './support/side-replay';
import { minimalPdf, recordedWebm, silentWav } from './support/media-fixtures'; // P3-L M5b: shared with e2e/library.spec.ts

test.describe.configure({ timeout: 120_000 });

const APP = 'app-e2-deliverables' as AppSessionId;

// One record, written as the engine host writes it.
function seed(userData: string, record: DeliverableRecord): void {
  const dir = join(userData, 'deliverables', record.appSessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${record.id}.json`), `${JSON.stringify(record)}\n`);
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
    await importSeeded(maws.page);
    const url = await pageUrlOf(maws.page, id);
    const results: { mode: string; sandbox: string | null; draws: boolean; dark: number; frames: string[]; viewerParents: (string | null)[] }[] = [];
    for (const { mode, sandbox } of PDF_TRIAL) {
      await mountFrame(maws, url, sandbox);
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
    // requests are judged as a store frame's
    const viewerParents = results.find((r) => r.mode === PDF_CHOSEN)!.viewerParents;
    expect(viewerParents.length, report).toBeGreaterThan(0);
    for (const parent of viewerParents) expect(parent, report).toMatch(/^maws-artifact:\/\//);
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
    await importSeeded(maws.page);
    const url = await pageUrlOf(maws.page, id);
    const revision = Number(url.split('/')[3]);

    // main's artifacts.console events for this page, from before the capture runs, so a capture's would show too
    await maws.page.evaluate(() => {
      const w = window as unknown as { __e2Console?: unknown[] };
      w.__e2Console = [];
      window.maws.on('artifacts.console', (payload) => void w.__e2Console!.push(payload));
    });

    const request: MawsArtifactCapture = { appSessionId: APP, requestId: 'e2-capture' as MawsArtifactCapture['requestId'], artifactId: id, revision, width: 640, height: 480 };
    const result = await maws.app.evaluate(
      (_electron, request) => (globalThis as unknown as { __maws_captures: { capture(r: unknown): Promise<MawsArtifactCapturedResult> } }).__maws_captures.capture(request),
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
    await mountFrame(maws, url, 'allow-scripts');
    expect(await ran, 'the inline script ran under the handler’s policy, not the app’s').toBe(true);
    await expect
      .poll(() => maws.page.evaluate(() => (window as unknown as { __e2Console: unknown[] }).__e2Console))
      .toEqual([expect.objectContaining({ artifactId: id, revision, level: 'error', message: 'E2_CONSOLE_ERROR' } satisfies Partial<ArtifactConsole>)]);
  } finally {
    await maws.cleanup();
  }
});

// Ticket 662: a page in a store frame cannot send data out through DNS. A `<link rel="dns-prefetch">` connected to the
// document makes Chromium resolve the name it holds, past the frame's policy, its sandbox and main's request filter;
// main's `blink-settings` switch (src/main/chromium-features.ts) turns Blink's DNS prefetching off. An HTML artifact,
// framed as the viewer frames it (the handler's policy, a scripts-only sandbox), connects a prefetch link made by script
// and one written as markup into the live document, each for a name of the run's own under example.com. Chromium's net
// log of the window's session records the resolver's jobs; the positive control is a name main resolves on purpose
// through the same resolver after the page's links, so an absent name means no job was asked for, not a log that
// records none. Whether the control resolves does not matter: its job is logged when it starts.
const prefetchPage = (names: { script: string; markup: string }) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Travel notes</title></head><body style="margin:0;padding:24px;font:16px system-ui">
<h1>Travel notes</h1><div id="hints"></div>
<script>
const link = document.createElement('link');
link.rel = 'dns-prefetch';
link.href = '//${names.script}';
document.head.append(link);
document.getElementById('hints').innerHTML = '<link rel="dns-prefetch" href="//${names.markup}">';
parent.postMessage('e2-prefetch-attached', '*');
</script></body></html>`;

test('ticket 662: an HTML artifact’s dns-prefetch links ask the resolver for nothing; a name main resolves on purpose is in the same net log', async () => {
  const maws = await launchMaws({ env: { MAWS_HARNESS: '0' } });
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'maws-e2-dns-')));
  try {
    const label = randomUUID().slice(0, 8);
    const names = { script: `maws-e2e-${label}-script.example.com`, markup: `maws-e2e-${label}-markup.example.com`, control: `maws-e2e-${label}-control.example.com` };
    const id = randomUUID();
    const copy = join(maws.userData, 'deliverables', APP, id, 'v1.html');
    mkdirSync(join(copy, '..'), { recursive: true });
    writeFileSync(copy, prefetchPage(names));
    const at = new Date().toISOString();
    seed(maws.userData, { id, appSessionId: APP, kind: 'artifact', artifactId: 'notes', title: 'Travel notes', path: copy, versions: [{ path: copy, at }], createdAt: at, updatedAt: at });
    await importSeeded(maws.page);
    const url = await pageUrlOf(maws.page, id);

    // the net log of the window's session, the frame's (its default capture mode keeps a request's host)
    const log = join(scratch, 'net-log.json');
    await maws.app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!.webContents.session.netLog.startLogging(path), log);
    const attached = maws.page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), 10_000);
          window.addEventListener('message', (event) => {
            if (event.data === 'e2-prefetch-attached') {
              clearTimeout(timer);
              resolve(true);
            }
          });
        }),
    );
    await mountFrame(maws, url, 'allow-scripts');
    expect(await attached, 'the page’s script ran and connected both links').toBe(true);
    // a prefetch goes from the frame's renderer to the browser process and on to the resolver after the insertion
    await maws.page.waitForTimeout(2_000);
    await maws.app.evaluate(async ({ BrowserWindow }, host) => {
      const { session } = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!.webContents;
      await Promise.race([session.resolveHost(host).catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    }, names.control);
    await maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!.webContents.session.netLog.stopLogging()); // flushed to disk when it resolves

    const { constants, events } = JSON.parse(readFileSync(log, 'utf8')) as { constants: { logEventTypes: Record<string, number> }; events: { type: number; params?: unknown }[] };
    const typeNames = new Map(Object.entries(constants.logEventTypes).map(([name, type]) => [type, name]));
    // each event that names one of the run's names, by its type alone: its other params hold the machine's resolver
    // settings (search domains among them), which a report keeps out
    const mentions = (name: string) => events.filter((event) => JSON.stringify(event.params ?? {}).includes(name)).map((event) => typeNames.get(event.type) ?? String(event.type));
    const found = { control: mentions(names.control), script: mentions(names.script), markup: mentions(names.markup) };
    const report = `net log: ${events.length} events\n${Object.entries(found).map(([which, types]) => `${which} ${names[which as keyof typeof names]}: ${types.length} events ${JSON.stringify(types)}`).join('\n')}`;
    console.log(`[dns-prefetch] ${report}`);
    expect(found.control.length, `the control's resolver job is in the log\n${report}`).toBeGreaterThan(0);
    expect(found.script, `the script-made link asked for no name\n${report}`).toEqual([]);
    expect(found.markup, `the markup link asked for no name\n${report}`).toEqual([]);
  } finally {
    await maws.cleanup();
    rmSync(scratch, { recursive: true, force: true });
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
        '<a id="away" href="https://example.invalid/away" style="position:absolute;left:0;top:440px">away</a>' +
        "<script>document.addEventListener('click', () => parent.postMessage('e2-page-click', '*'));</script></body></html>",
    );
    const at = new Date().toISOString();
    seed(maws.userData, { id, appSessionId: APP, kind: 'artifact', artifactId: 'dash', title: 'Dashboard', path: copy, versions: [{ path: copy, at }], createdAt: at, updatedAt: at });
    await importSeeded(maws.page);

    await mountFrame(maws, await pageUrlOf(maws.page, id), 'allow-scripts');
    const frame = maws.page.frames().find((f) => f.url().startsWith('maws-artifact://'))!;
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
    // The overlay is shown by the pointer, moved until the overlay is up (`pointInFrame`): a click sent before input
    // reached the frame was lost, with the overlay a move dispatched inside the frame had already put up.
    await pointInFrame(maws.page, frame, 100, 100);
    await maws.page.mouse.click(100, 100);
    await expect.poll(posted).toEqual([
      { type: 'maws:picked', selector: '#hero', label: 'h1#hero', text: 'Sales overview', rect: { x: 0, y: 0, width: FRAME.width, height: 200 } },
    ]); // the page never heard the click it was picked with
    expect(await frame.locator('[data-maws-pick-overlay]').count()).toBe(0);
    await maws.page.mouse.click(100, 300);
    await expect.poll(posted).toHaveLength(2);
    expect((await posted())[1]).toBe('e2-page-click'); // picking ended with the pick: the page has its clicks back

    // P2-E1 (M3): re-pin's locate round trip (P2-E1 document, D8): the page answers where an element is now, by selector,
    // null for one it has not or an invalid selector, each answer carrying its ask's id; a locate starts no picking and
    // leaves nothing in the page. The answers are matched by id, not arrival: an invalid selector is answered at once,
    // an absent one only after the page's wait for it (P3-F L198), so the invalid one's answer comes first.
    await maws.page.evaluate(() => {
      const element = document.getElementById('e2-frame') as HTMLIFrameElement;
      ['#hero', 'body > p:nth-of-type(1)', '#gone', 'h1['].forEach((selector, i) => element.contentWindow!.postMessage({ type: 'maws:locate', id: i + 1, selector }, '*'));
    });
    await expect.poll(posted).toHaveLength(6);
    const located = (await posted()).slice(2) as { id: number }[];
    expect([...located].sort((a, b) => a.id - b.id)).toEqual([
      { type: 'maws:located', id: 1, selector: '#hero', rect: { x: 0, y: 0, width: FRAME.width, height: 200 } },
      { type: 'maws:located', id: 2, selector: 'body > p:nth-of-type(1)', rect: { x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) } },
      { type: 'maws:located', id: 3, selector: '#gone', rect: null },
      { type: 'maws:located', id: 4, selector: 'h1[', rect: null },
    ]);
    const arrival = (id: number) => located.findIndex((reply) => reply.id === id);
    expect(arrival(4)).toBeLessThan(arrival(3)); // the invalid selector did not wait behind the absent one
    const lead = located.find((reply) => reply.id === 2) as unknown as { rect: { y: number; height: number } };
    expect(lead.rect.y).toBeGreaterThanOrEqual(200); // under the heading
    expect(lead.rect.height).toBeGreaterThan(0);
    expect(await frame.locator('[data-maws-pick-overlay]').count()).toBe(0);
    await maws.page.mouse.click(100, 300);
    await expect.poll(posted).toHaveLength(7); // the page still hears its clicks: no picking started

    // P4 W2-C (tracker 2026-10-06): a link to the web stays on the page. The bridge keeps the frame from a navigation the
    // app's `frame-src` would refuse (a delivered file, which has no bridge, is left on Chromium's blocked page: case 3);
    // the page still hears the click, so it landed in the frame
    const navigations = await recordNavigations(maws);
    const pageUrl = frame.url();
    await frame.locator('#away').click();
    await expect.poll(posted).toHaveLength(8);
    expect((await posted())[7]).toBe('e2-page-click');
    await maws.page.waitForTimeout(1_000);
    expect((await navigations()).filter((line) => line.includes('example.invalid')), 'no navigation began').toEqual([]);
    expect(frame.url()).toBe(pageUrl);
    await expect(frame.locator('#hero')).toHaveText('Sales overview');
  } finally {
    await maws.cleanup();
  }
});

// ---- M7: the product, as the owner drives it ------------------------------------------------------------------------

const ARTIFACTS = `${PASS3}/p1-maws-artifacts.jsonl`;
const SEND_FILE = `${PASS3}/p1-maws-send-file.jsonl`;
const SHOW_PANE = `${PASS3}/p1-maws-show-pane.jsonl`;
const SHOW_PANE_ARTIFACT = 'e2e/fixtures/derived/p1-maws-show-pane-artifact.jsonl'; // derived, not recorded: SHOW_PANE with its retired `deliverable` pane renamed `artifact`, which (4) needs to open the viewer
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
async function recordNavigations(maws: MawsLaunch): Promise<() => Promise<string[]>> {
  await maws.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!;
    const log: string[] = [];
    (globalThis as unknown as { __e2Navigations: string[] }).__e2Navigations = log;
    win.webContents.on('did-start-navigation', (event) => log.push(`start ${event.isMainFrame ? 'window' : 'frame'} ${event.url}`));
    win.webContents.on('did-fail-load', (_event, code, _description, url, main) => log.push(`fail ${main ? 'window' : 'frame'} ${code} ${url}`));
    win.webContents.on('did-navigate', (_event, url) => log.push(`navigated window ${url}`));
  });
  return () => maws.app.evaluate(() => [...(globalThis as unknown as { __e2Navigations: string[] }).__e2Navigations]);
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
  // P3-A (M6): E2's recording, its retired `artifact_update` calls made `artifact_publish` calls of the v2 page from the
  // revision the create answers (Decision Log 67: the seeded defaults take the first log rows).
  const replayed = asPublishReplay(ARTIFACTS, DASHBOARD_V2, FIRST_CREATED_REVISION); // Decision Log 67: publish from the fresh base.
  const existed = existsSync(repo);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'dashboard.html'), DASHBOARD_V1);
  try {
    await scene({ titles: ['E2: the dashboard artifact'], repo }, async (s) => {
      const [id] = s.ids;
      await show(s, id);
      await replay(s, id, replayed);
      await allowNext(s, id); // Write (seq 154)
      await allowNext(s, id); // mcp__maws__artifact_create (seq 176)
      await allowNext(s, id); // mcp__maws__artifact_screenshot (seq 200): main's capture of v1 answers it
      await allowNext(s, id); // Edit (seq 338)
      writeFileSync(join(repo, 'dashboard.html'), DASHBOARD_V2);
      await allowNext(s, id); // mcp__maws__artifact_publish (seq 359; E2's update)
      await allowNext(s, id); // mcp__maws__artifact_list (seq 381)
      await allowNext(s, id); // mcp__maws__artifact_publish "nope" (seq 408)
      await idle(s, id);

      // what the host answered, call by call
      const rows = s.journal(id);
      const calls = mcpCalls(rows);
      expect(calls.map((c) => [c.name, c.args])).toEqual([
        ['artifact_create', { id: 'dash', html_path: 'dashboard.html', title: 'Dashboard' }],
        ['artifact_screenshot', { id: 'dash' }],
        ['artifact_publish', { artifact: 'dash', baseRevision: FIRST_CREATED_REVISION, files: { 'index.html': DASHBOARD_V2 } }], // Decision Log 67: fresh base.
        ['artifact_list', {}],
        ['artifact_publish', { artifact: 'nope', baseRevision: FIRST_CREATED_REVISION, files: { 'index.html': DASHBOARD_V2 } }], // Decision Log 67: same replay base.
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
      expect(created).toMatchObject({ artifactId: deliverableId, revision: FIRST_CREATED_REVISION }); // Decision Log 67: the artifact keeps the record's uuid, after the seeded revisions.
      expect(text(2)).toMatchObject({ status: 'published', id: 'dash', deliverableId, version: 2, title: 'Dashboard', changed: ['index.html'] });
      expect(text(3)).toMatchObject({ status: 'listed', artifacts: [{ id: deliverableId, handle: 'dash', kind: 'html', title: 'Dashboard' }] });
      expect(mcpResultOf(rows, calls[4]!.requestId)).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.noArtifact('artifact_publish', 'nope') }], isError: true });
      expect(ofKind(await s.events(id), 'maws.delivery.artifact').map((e) => [e.action, e.artifactId, e.deliverableId, e.version])).toEqual([
        ['create', 'dash', deliverableId, 1],
        ['update', 'dash', deliverableId, 2],
      ]);

      // the store: one artifact, two versions, the source left where the agent wrote it (G1; P3-L M6b: the artifact store's
      // versions, X12's record and copies no more)
      const { artifact } = value(await invoke(s.page, 'artifacts.get', { artifactId: deliverableId }));
      expect(artifact).toMatchObject({ id: deliverableId, kind: 'html', handle: 'dash', title: 'Dashboard', createdBy: { kind: 'session', appSessionId: id } });
      const { versions } = value(await invoke(s.page, 'artifacts.versions', { artifactId: deliverableId }));
      const pages = await Promise.all([...versions].sort((a, b) => a.seq - b.seq).map(async (v) => readFileSync(value(await invoke(s.page, 'library.content', { artifactId: deliverableId, revision: v.seq })).path, 'utf8')));
      expect(pages).toEqual([DASHBOARD_V1, DASHBOARD_V2]);
      expect(existsSync(join(s.maws.userData, 'deliverables'))).toBe(false);

      // the rows (G4, G5): persistent, so in view with the turn folded
      const artifactRows = s.pane.locator('section.transcript-artifact');
      await expect(artifactRows.locator('[data-artifact-heading]')).toHaveText(['Artifact Dashboard · v1', 'Updated artifact Dashboard · v2', 'Could not register artifact nope: no artifact "nope" in this session']);
      await expect(artifactRows.nth(2).getByRole('button', { name: 'Open' })).toHaveCount(0);

      // v1 from its row: the viewer in the panel draws it, the frame throws once, and the chip counts it on the row and in
      // the viewer, once however many captures ran (the capture's console went into its result alone, Design §8)
      const v1Row = artifactRows.nth(0);
      await v1Row.getByRole('button', { name: 'Open' }).click();
      const viewer = viewerOf(s.panel);
      await expect(viewer).toHaveAttribute('data-artifact-viewer', deliverableId);
      await expect(viewer).toHaveAttribute('data-version', '1');
      const frame = await frameAt(s.page, await pageUrlOf(s.page, deliverableId, 1));
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

// ---- (2) the Artifacts tool (E2's Deliverables tool) -----------------------------------------------------------------

// P3-L M6b: the tab's case after its record is deleted (the restored tab showing the session's list headed by "No
// deliverable … in this session") was the Deliverables tool's alone and is gone with it; an `artifact` tab's Gone notice
// is M3's (ArtifactTab's units).
test('the Artifacts tool: groups newest first, Back to the list’s scroll, the version switcher, Move to tab, the tab across a reload', async () => {
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
    await importSeeded(s.page);

    await show(s, id);
    await openArtifacts(s);
    const list = listOf(s);
    await expect(list.locator('[data-artifacts-group]')).toHaveCount(2);
    expect(await list.locator('[data-artifacts-group]').evaluateAll((els) => els.map((el) => el.getAttribute('data-artifacts-group')))).toEqual(['html', 'file']);
    // L134: the list is virtualised, so a group's rows are lines after its heading, not inside it; a row names its kind
    await expect(list.locator('[data-artifact-row][data-kind="html"] [data-part="title"]')).toHaveText(['Sales dashboard']);
    // P3-L M6b: the Deliverables list's version count on the row's line ("v2 · …") is gone with it (the line is the
    // library's "Edited … by …")
    // The rows mounted are the list's first, newest first; the rest mount as the list scrolls (L134)
    const newestFirst = notes.map((n) => n.title!).reverse();
    const fileTitles = () => list.locator('[data-artifact-row][data-kind="file"] [data-part="title"]').allTextContents();
    await expect.poll(async () => { const shown = await fileTitles(); return shown.length > 0 && shown.every((title, i) => title === newestFirst[i]); }).toBe(true);
    // P3-L M6b: the row's caption ("the first note") is gone with the Deliverables list (Decision Log 18e: the caption is
    // the transcript's delivery row's)

    // a row further down opens its viewer; Back returns to the list where it was
    await list.evaluate((el) => (el.scrollTop = 420));
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(420);
    const visible = await list.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const rows = Array.from(el.querySelectorAll<HTMLElement>('[data-artifact-row]'));
      return rows.find((row) => row.getBoundingClientRect().top >= box.top + 40 && row.getBoundingClientRect().bottom <= box.bottom)!.dataset.artifactId!;
    });
    await rowOf(list, { id: visible }).click();
    const viewer = viewerOf(s.panel);
    await expect(viewer).toHaveAttribute('data-artifact-viewer', visible);
    const note = notes.find((n) => n.id === visible)!;
    await expect(viewer.locator('[data-file-viewer]')).toContainText(readFileSync(note.path, 'utf8').trim());
    await s.panel.getByRole('button', { name: 'Back' }).click();
    await expect(list).toBeVisible();
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(420);

    // the artifact opens on its latest version; the switcher offers both, and v1 is another document
    await list.evaluate((el) => (el.scrollTop = 0));
    await rowOf(list, artifact).click();
    await expect(viewer).toHaveAttribute('data-version', '2');
    const versions = viewer.getByRole('combobox', { name: 'Version' });
    await expect(versions.locator('option')).toHaveText(['v1', 'v2 · latest']);
    const v2 = await pageUrlOf(s.page, artifact.id, 2);
    await expect((await frameAt(s.page, v2)).locator('#heading')).toHaveText('VERSION_TWO');
    await versions.selectOption('1');
    await expect(viewer).toHaveAttribute('data-version', '1');
    await expect((await frameAt(s.page, await pageUrlOf(s.page, artifact.id, 1))).locator('#heading')).toHaveText('VERSION_ONE');
    await expect.poll(() => s.page.frames().some((f) => f.url() === v2), { message: 'the v2 frame is gone' }).toBe(false);
    await shoot(s, 'versions');

    // Move to tab (P4-B3: it was "Open in tab"): the same viewer as a main tab, its state carried with it (the version
    // the switcher shows comes across; the reload below starts it afresh on the latest)
    await s.panel.getByRole('button', { name: 'Move to tab' }).click();
    const tab = s.page.locator('[data-region="main"] [data-artifact-tab]');
    await expect(viewerOf(tab)).toHaveAttribute('data-artifact-viewer', artifact.id);
    await expect(tab.getByRole('button', { name: 'Move to tab' })).toHaveCount(0);
    await expect(tab.getByRole('button', { name: 'Back' })).toHaveCount(0);
    await shoot(s, 'tab');

    // the tab is restored after a reload of the window
    await s.page.reload();
    await expect(viewerOf(tab)).toHaveAttribute('data-artifact-viewer', artifact.id, { timeout: 20_000 });
    await expect((await frameAt(s.page, v2)).locator('#heading')).toHaveText('VERSION_TWO');
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
    await importSeeded(s.page);

    await show(s, id);
    await openArtifacts(s);
    const list = listOf(s);
    const viewer = viewerOf(s.panel);
    const open = async (record: DeliverableRecord, body: string) => {
      if (await viewer.isVisible()) await s.panel.getByRole('button', { name: 'Back' }).click();
      await rowOf(list, record).click();
      await expect(viewer).toHaveAttribute('data-artifact-viewer', record.id);
      await expect(viewer).toHaveAttribute('data-body', body);
    };
    // the viewer's actions, in its X32 header (P3-L M5b)
    const offers = async (name: string) => (await headerActions(s.page, s.panel)).includes(name);
    // Reveal on every one, Open externally on the kinds main hands to the OS (Decision Log 17), each through the seam
    const expected: string[] = [];
    const opened = () => seamLines(s).filter((l) => !l.startsWith('blocked-'));
    const reach = async (record: DeliverableRecord, external: boolean) => {
      await expect.poll(() => offers('Open externally')).toBe(external);
      if (external) {
        await headerAction(s.page, s.panel, 'Open externally');
        expected.push(record.path);
        await expect.poll(opened).toEqual(expected);
      }
      await headerAction(s.page, s.panel, 'Reveal in Finder');
      expected.push(`reveal ${record.path}`);
      await expect.poll(opened).toEqual(expected);
    };

    // the HTML page: its inline script ran in a scripts-only frame; the fetch failed and shows in the chip
    await open(html, 'html');
    await expect(viewer.locator('[data-artifact-frame="html"]')).toHaveAttribute('sandbox', 'allow-scripts');
    const page = await frameAt(s.page, await pageUrlOf(s.page, html.id));
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
    // frame guard is never asked); the frame is left on Chromium's blocked page until Reload, the window stays put. A
    // delivered file is served byte for byte, without the bridge script, so it keeps this; an HTML artifact's link stays
    // on its page (the bridge script's case)
    const navigations = await recordNavigations(s.maws);
    const appUrl = s.page.url();
    await page.locator('#away').click();
    await expect.poll(navigations).toContain('fail frame -30 https://example.invalid/away'); // ERR_BLOCKED_BY_CSP
    expect((await navigations()).filter((line) => line.startsWith('navigated window'))).toEqual([]);
    expect(s.page.url()).toBe(appUrl);
    await headerAction(s.page, s.panel, 'Reload');
    await expect((await frameAt(s.page, await pageUrlOf(s.page, html.id))).locator('#marker')).toHaveText('SCRIPT_RAN');
    await reach(html, true);

    // the PDF: Chromium's viewer draws it in its unsandboxed frame (Decision Log 31)
    await open(pdf, 'pdf');
    const pdfFrame = viewer.locator('[data-artifact-frame="pdf"]');
    await expect(pdfFrame).not.toHaveAttribute('sandbox');
    await expect.poll(async () => (await darkIn(s, pdfFrame)).dark, { timeout: 15_000, message: 'the PDF frame draws its page' }).toBeGreaterThan(2_000);
    await shoot(s, 'viewer-pdf');
    // its link: Chromium's viewer asks to navigate the window itself; main's top-level guard (`window.ts`) refuses it and
    // writes the seam line a frame's refusal writes, so the app stays put and no frame holds anything outside the scheme,
    // the viewer and its resources
    const square = (await darkIn(s, pdfFrame)).centre!;
    await s.page.mouse.click(square.x, square.y);
    await expect.poll(navigations, { timeout: 10_000 }).toContain('start window https://example.invalid/pdf-link');
    await expect.poll(() => seamLines(s)).toContain('blocked-navigation https://example.invalid/pdf-link');
    await s.page.waitForTimeout(1_000);
    expect((await navigations()).filter((line) => line.startsWith('navigated window'))).toEqual([]);
    const after = await framesOfWindow(s);
    expect(after.app).toBe(appUrl);
    expect(s.page.url()).toBe(appUrl);
    for (const url of after.frames.slice(1)) expect(url, JSON.stringify(after.frames)).toMatch(/^(maws-artifact:\/\/|chrome-extension:\/\/mhjfbmdgcfjbbpaeojofohoefgiehjai\/|chrome:\/\/resources\/)/);
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
    await expect.poll(() => seamLines(s)).toContain(`blocked-download ${await pageUrlOf(s.page, pdf.id)}`);
    await s.page.waitForTimeout(1_000);
    expect(filesUnder(downloads, () => true)).toEqual([]);
    expect(filesUnder(userData, (name) => name.endsWith('.pdf') || name.endsWith('.crdownload'))).toEqual([]);
    await reach(pdf, true);

    // media: the clip plays and seeks; the tone plays
    await open(webm, 'video');
    const video = viewer.locator('video[data-artifact-media="video"]');
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
    const audio = viewer.locator('audio[data-artifact-media="audio"]');
    await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.duration)).toBeCloseTo(1, 1);
    await audio.evaluate((a: HTMLAudioElement) => a.play());
    await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0);
    await reach(wav, true);

    // the image draws inline, from outside the session's directory; no Open as file for a file the editor could not save
    await open(png, 'file');
    const img = viewer.locator('[data-file-viewer][data-kind="image"] [data-image-view] img');
    await expect(img).toBeVisible();
    expect(await img.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(320);
    expect(await offers('Open as file')).toBe(false);
    await shoot(s, 'viewer-image');
    await reach(png, true);

    // markdown renders read-only; inside the session's directory it opens as a file too; not handed to the OS
    await open(markdown, 'file');
    await expect(viewer.locator('[data-file-viewer][data-kind="markdown"] [data-markdown-view] h1')).toHaveText('Summary');
    await expect.poll(() => offers('Open as file')).toBe(true);
    await shoot(s, 'viewer-markdown');
    await reach(markdown, false);

    // code shows read-only, from outside the session's directory; a save through E5's write is refused there
    await open(code, 'file');
    const codeView = viewer.locator('[data-file-viewer][data-kind="code"]');
    await expect(codeView).toHaveAttribute('data-editable', 'false');
    await expect(codeView.locator('.cm-content')).toContainText('export function total');
    expect(await offers('Open as file')).toBe(false);
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

// ---- UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M4 decision 10; A1, R7) ----------
// The scene of record for the owner's check: a scheme handler is told nothing of the window that asks, so main judges the
// asker in the partition's request filter, and nothing in the tree shows that every request the file frames' responder
// answers was decided there first. Under MAWS_E2E=1 the filter writes `frame-decision <pass|cancel> <web contents id |
// none> <method> <url>` for every request of a token host and the responder writes `frame-entry <method> <range | -> <url>`
// at its entry, through one ordered writer; this scene walks those lines. It asks `layout.frameFile` through the page's
// bridge and mounts each URL itself, so it needs nothing of the window's viewer. No byte is judged by what is drawn.

type FrameLine = { kind: 'decision'; answer: 'pass' | 'cancel'; asker: string; method: string; url: string } | { kind: 'entry'; method: string; range: string; url: string };
const withoutFragment = (url: string) => url.replace(/#.*$/s, '');

/** The seam's file frame lines, in the order they were written. */
function frameLines(lines: string[]): FrameLine[] {
  const read: FrameLine[] = [];
  for (const line of lines) {
    const decision = /^frame-decision (pass|cancel) (\S+) (\S+) (.+)$/.exec(line);
    if (decision) read.push({ kind: 'decision', answer: decision[1] as 'pass' | 'cancel', asker: decision[2]!, method: decision[3]!, url: withoutFragment(decision[4]!) });
    const entry = /^frame-entry (\S+) (\S+) (.+)$/.exec(line);
    if (entry) read.push({ kind: 'entry', method: entry[1]!, range: entry[2]!, url: withoutFragment(entry[3]!) });
  }
  return read;
}

/** One URL's lines walked in order: its entries, the entries no passed decision of their method came before, who was passed. */
function walkFrame(lines: FrameLine[], url: string) {
  const passes = new Map<string, number>();
  const passedFor = new Set<string>();
  const ranges: string[] = [];
  let unmatched = 0;
  for (const line of lines.filter((l) => l.url === url)) {
    if (line.kind === 'decision') {
      if (line.answer === 'pass') {
        passes.set(line.method, (passes.get(line.method) ?? 0) + 1);
        passedFor.add(line.asker);
      }
      continue;
    }
    ranges.push(line.range);
    const left = (passes.get(line.method) ?? 0) - 1;
    passes.set(line.method, left);
    if (left < 0) unmatched++;
  }
  return { entries: ranges.length, unmatched, passedFor: [...passedFor], ranges };
}

type FramedKindName = 'pdf' | 'html' | 'video' | 'audio';

/** Each URL mounted in `page` above everything: a PDF or a page in a frame, a video or a sound in a media element. */
async function mountFrames(page: Page, items: Array<{ id: string; kind: FramedKindName; url: string }>): Promise<void> {
  await page.evaluate((list) => {
    for (const { id, kind, url } of list) {
      document.getElementById(id)?.remove();
      const element = kind === 'video' || kind === 'audio' ? document.createElement(kind) : document.createElement('iframe');
      element.id = id;
      if (kind === 'html') element.setAttribute('sandbox', 'allow-scripts');
      if (element instanceof HTMLMediaElement) {
        element.preload = 'metadata';
        element.muted = true;
        element.controls = true;
      }
      element.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:240px;border:0;z-index:2147483647;background:#fff';
      element.setAttribute('src', url);
      document.body.appendChild(element);
    }
  }, items);
}

/**
 * The elements' request producers settled, by state, then the elements gone: each frame navigated to `about:blank` and
 * the blank page seen in it (the document that asked is torn down, its loads ended), each media element's source dropped
 * and its network state empty (it asks for nothing more).
 */
async function settleFrames(page: Page, ids: string[]): Promise<void> {
  await page.evaluate(async (list) => {
    const settled: Array<Promise<void>> = [];
    for (const id of list) {
      const element = document.getElementById(id);
      if (element instanceof HTMLMediaElement) {
        element.pause();
        element.removeAttribute('src');
        element.load();
        settled.push(
          new Promise<void>((resolve) => {
            const check = () => (element.networkState === HTMLMediaElement.NETWORK_EMPTY ? resolve() : requestAnimationFrame(check));
            check();
          }),
        );
      } else if (element instanceof HTMLIFrameElement) {
        // unsandboxed, the blank page is the app page's own origin, so its address is readable once it has replaced the
        // framed document (a load the framed document itself fires first is not taken for it)
        settled.push(
          new Promise<void>((resolve) => {
            const blank = () => {
              try {
                return element.contentWindow?.location.href === 'about:blank';
              } catch {
                return false;
              }
            };
            const loaded = () => (blank() ? resolve() : element.addEventListener('load', loaded, { once: true }));
            element.addEventListener('load', loaded, { once: true });
          }),
        );
        element.removeAttribute('sandbox');
        element.setAttribute('src', 'about:blank');
      }
    }
    await Promise.all(settled);
    for (const id of list) document.getElementById(id)?.remove();
  }, ids);
}

const FRAME_PAGE = '<!doctype html><html><head><title>Invented ledger</title></head><body><p id="marker">waiting</p><script>document.getElementById("marker").textContent = "SCRIPT_RAN";</script></body></html>';

test("a token's requests: every request that occurs for a PDF, a page, a video and a sound, a media seek's range among them, was first passed by the request filter for the owning window; another window and the capture partition deliver no byte", async () => {
  test.setTimeout(240_000);
  await scene({ titles: ['U6b-2: a token’s requests'] }, async (s) => {
    const [id] = s.ids;
    const files: Record<FramedKindName, [string, Buffer | string]> = {
      pdf: ['report.pdf', minimalPdf()],
      html: ['ledger.html', FRAME_PAGE],
      video: ['clip.webm', await recordedWebm(s.page)],
      audio: ['tone.wav', silentWav(120, 44_100)], // two minutes, so a seek near its end asks a range the element has not read
    };
    const kinds = Object.keys(files) as FramedKindName[];
    const urls = {} as Record<FramedKindName, string>;
    for (const kind of kinds) {
      const [name, bytes] = files[kind];
      writeFileSync(join(s.repo, name), bytes);
      const answer = value(await invoke(s.page, 'layout.frameFile', { appSessionId: id, path: join(s.repo, name) }));
      if (answer.status !== 'ready') throw new Error(`${name}: ${JSON.stringify(answer)}`);
      expect(answer.framed).toBe(kind);
      expect(answer.url).toBe(`maws-artifact://${answer.token}/${encodeURIComponent(name)}`);
      urls[kind] = answer.url;
    }
    const owner = String(await s.maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!.webContents.id));
    const lines = () => frameLines(seamLines(s));
    const tokenRoots = kinds.map((kind) => urls[kind].slice(0, urls[kind].indexOf('/', 'maws-artifact://'.length) + 1)); // `maws-artifact://<token>/`
    const onToken = (line: FrameLine) => tokenRoots.some((root) => line.url.startsWith(root));

    // A completion boundary in the seam log: a request main makes for a name under a live token, which the request filter
    // cancels (no web contents asked) and records through the same ordered writer as every decision and entry. Once its
    // line is in the log, so is every line written before it; the answer is the log's length through that line, and a
    // record read up to it is complete through the marker's enqueue point.
    let marks = 0;
    const mark = async (): Promise<number> => {
      const url = `${tokenRoots[0]}u6b2-mark-${++marks}`;
      await s.maws.app.evaluate(async ({ session }, target) => session.defaultSession.fetch(target).then(() => undefined, () => undefined), url);
      let at = -1;
      await expect.poll(() => (at = seamLines(s).findIndex((line) => line.startsWith('frame-decision ') && line.endsWith(` ${url}`))), { message: `the boundary ${marks} reached the log` }).toBeGreaterThanOrEqual(0);
      expect(seamLines(s)[at], 'the boundary’s request is cancelled').toBe(`frame-decision cancel none GET ${url}`);
      return at + 1;
    };
    const record = (from: number, to: number) => frameLines(seamLines(s).slice(from, to));

    // the owning window: each kind mounted; the video and the sound seeked to a time not yet loaded
    const mounted = kinds.map((kind) => ({ id: `u6b2-${kind}`, kind, url: urls[kind] }));
    await mountFrames(s.page, mounted);
    for (const kind of ['pdf', 'html'] as const) await expect.poll(() => walkFrame(lines(), urls[kind]).entries, { message: `${kind}: its request reached the responder` }).toBeGreaterThan(0);
    for (const kind of ['video', 'audio'] as const) {
      const media = s.page.locator(`#u6b2-${kind}`);
      await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.readyState), { message: `${kind}: its metadata loaded` }).toBeGreaterThanOrEqual(1);
      await media.evaluate((element: HTMLMediaElement) => {
        element.currentTime = Number.isFinite(element.duration) ? element.duration * 0.9 : 1.8;
      });
    }
    // every media request carries a range; the sound's seek asks one that does not start at the file's start
    await expect.poll(() => walkFrame(lines(), urls.video).ranges.some((range) => range.startsWith('bytes=')), { message: 'the video asked a range' }).toBe(true);
    await expect.poll(() => walkFrame(lines(), urls.audio).ranges.some((range) => /^bytes=[1-9]\d*-/.test(range)), { message: 'the sound’s seek asked a range past its start' }).toBe(true);
    await expect.poll(() => s.page.locator('#u6b2-audio').evaluate((element: HTMLMediaElement) => element.seeking)).toBe(false);
    await settleFrames(s.page, mounted.map((m) => m.id));
    const ownerEnd = await mark();
    for (const kind of kinds) {
      const walked = walkFrame(record(0, ownerEnd), urls[kind]);
      console.log(`[u6b2-record] ${kind}: entries ${walked.entries}, ranges ${walked.ranges.join(', ')}, passed for ${walked.passedFor.join(',')} (owner ${owner})`);
      expect(walked.entries, kind).toBeGreaterThan(0);
    }

    // a second app window told every URL: its requests are cancelled with its own id, and none reaches the responder
    const [second, windowId] = await Promise.all([s.maws.app.waitForEvent('window'), s.maws.app.evaluate(() => (globalThis as unknown as { __maws_documents: { openWindow(): number } }).__maws_documents.openWindow())]);
    await second.waitForLoadState('domcontentloaded');
    const asker = String(await s.maws.app.evaluate(({ BrowserWindow }, ref) => BrowserWindow.fromId(ref)!.webContents.id, windowId));
    expect(asker).not.toBe(owner);
    const secondStart = ownerEnd;
    const others = kinds.map((kind) => ({ id: `u6b2-other-${kind}`, kind, url: urls[kind] }));
    await mountFrames(second, others);
    for (const kind of kinds) {
      await expect.poll(() => frameLines(seamLines(s).slice(secondStart)).some((line) => line.kind === 'decision' && line.url === urls[kind] && line.answer === 'cancel' && line.asker === asker), { message: `${kind}: the second window’s request cancelled` }).toBe(true);
    }
    await settleFrames(second, others.map((m) => m.id));
    const secondEnd = await mark();
    let phase = record(secondStart, secondEnd).filter(onToken);
    expect(phase.filter((line) => line.kind === 'entry'), 'no entry while the second window asked').toEqual([]);
    expect(phase.filter((line) => line.kind === 'decision' && line.answer === 'pass'), 'no pass while the second window asked').toEqual([]);

    // the capture partition: a request for each live token is cancelled there too, and none reaches a responder
    const captureStart = secondEnd;
    const fromCapture = await s.maws.app.evaluate(
      async ({ session }, list) => Promise.all(list.map((url) => session.fromPartition('maws-capture').fetch(url).then((answer) => `answered ${answer.status}`, () => 'refused'))), // CAPTURE_PARTITION, src/render/capture.ts
      kinds.map((kind) => urls[kind]),
    );
    console.log(`[u6b2-record] the capture partition answered ${fromCapture.join(', ')}`);
    const captureEnd = await mark(); // every fetch above has answered, so the partition asks nothing more
    phase = record(captureStart, captureEnd).filter(onToken);
    for (const kind of kinds) {
      expect(phase.some((line) => line.kind === 'decision' && line.url === urls[kind] && line.answer === 'cancel' && line.asker === 'none'), `${kind}: the capture partition’s request cancelled`).toBe(true);
    }
    expect(phase.filter((line) => line.kind === 'entry'), 'no entry for the capture partition').toEqual([]);
    expect(phase.filter((line) => line.kind === 'decision' && line.answer === 'pass'), 'no pass on the capture partition').toEqual([]);
    expect(fromCapture.filter((answer) => answer === 'answered 200' || answer === 'answered 206')).toEqual([]);

    // the whole completed record, from the scene's start to the last boundary: for each URL and method, its entries never
    // outnumber the passed decisions before them, every pass names the owning window, and nothing under a token's root
    // other than the four URLs reached a responder
    const whole = record(0, captureEnd);
    for (const kind of kinds) {
      const walked = walkFrame(whole, urls[kind]);
      expect(walked.unmatched, `${kind}: an entry with no passed decision before it`).toBe(0);
      expect(walked.passedFor, `${kind}: every passed decision names the owning window`).toEqual([owner]);
    }
    expect(whole.filter((line) => onToken(line) && !kinds.some((kind) => line.url === urls[kind]) && (line.kind === 'entry' || line.answer === 'pass')), 'no boundary request passed or answered').toEqual([]);
  });
});

// ---- UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M6; Interfaces §H) ---------------
// A session's file drawn by a path, held to the artifact frames' assertions (decision 1): the delivered files' hostile
// page and hostile PDF, written into the session's folder as files and opened from Files' tree beside the chat, as a
// person opens them. A file's frame has no console chip (main attributes no console line to it), so the hostile page
// writes what its fetch met into its own document. Each scene waits on states (decision 2) and asserts no duration.

// A file of the session's folder opened from Files' tree beside the chat, with the session shown; the viewer, wherever the
// file's tab is drawn afterwards.
async function openByPath(s: Scene, id: string, path: string): Promise<Locator> {
  await show(s, id);
  await openSurface(s.page, 'Files');
  const row = surface(s.page, 'files').locator(`[role="treeitem"][data-path="${path}"]`).first();
  await expect(row, `${path} in Files' tree`).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(sideColumn(s.page).locator(`[data-file-viewer][data-path="${path}"]`), `${path} beside the chat, as a framed file`).toHaveAttribute('data-kind', 'frame', { timeout: 20_000 });
  return s.page.locator(`[data-file-viewer][data-path="${path}"]`);
}

// The delivered page, and what a page by a path may try beside it: its fetch's outcome written where the scene reads it,
// and three messages to the window in the shapes the artifact frame's bridge posts (a pick, a cancelled pick, a located
// element), which no listener of the window takes from a file's frame
const HOSTILE_PAGE = DELIVERED_PAGE.replace(
  '</body>',
  `<script>
fetch('https://example.invalid/file-fetch').then(() => { document.body.dataset.fetch = 'reached'; }, () => { document.body.dataset.fetch = 'failed'; });
const rect = { x: 1, y: 1, width: 10, height: 10 };
parent.postMessage({ type: 'maws:picked', selector: '#away', label: 'A link', text: 'A link to the web', rect }, '*');
parent.postMessage({ type: 'maws:pick-cancelled' }, '*');
parent.postMessage({ type: 'maws:located', id: 1, selector: '#away', rect }, '*');
document.body.dataset.posted = 'yes';
</script>
</body>`,
);

// The viewer's Download pressed in each frame of Chromium's PDF viewer in the window, as the delivered files' scene
// presses it: one answer per viewer frame, ending in ` pressed` where the button was found and clicked.
const pressPdfDownload = (s: Scene) =>
  s.maws.app.evaluate(async ({ BrowserWindow }, viewerOrigin) => {
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

// Downloads of the scene's window land in a scratch folder of its own, which must stay empty
async function scratchDownloads(s: Scene): Promise<string> {
  const downloads = join(s.scratch.root, 'downloads');
  mkdirSync(downloads);
  await s.maws.app.evaluate(({ app }, dir) => app.setPath('downloads', dir), downloads);
  return downloads;
}

test("a file by a path: a hostile page's fetch fails, its link is refused, it gathers no server-reflexive candidate, saves nothing, and its messages change nothing", async () => {
  test.setTimeout(240_000);
  await scene({ titles: ['U6b-2: a hostile page by a path'] }, async (s) => {
    const [id] = s.ids;
    const path = join(s.repo, 'notes.html');
    writeFileSync(path, HOSTILE_PAGE);
    const downloads = await scratchDownloads(s);
    // every message in the bridge's shapes that reaches the window, as the window hears it
    await s.page.evaluate(() => {
      const heard: string[] = [];
      (window as unknown as { __u6b2Heard: string[] }).__u6b2Heard = heard;
      window.addEventListener('message', (event) => {
        const type = (event.data as { type?: unknown } | null)?.type;
        if (typeof type === 'string' && type.startsWith('maws:')) heard.push(type);
      });
    });
    const heard = () => s.page.evaluate(() => [...(window as unknown as { __u6b2Heard: string[] }).__u6b2Heard]);

    const viewer = await openByPath(s, id, path);
    await expect(viewer).toHaveAttribute('data-frame', 'html');
    const frameElement = viewer.locator('[data-artifact-frame="html"]');
    await expect(frameElement, 'the artifact frame’s sandbox, unchanged').toHaveAttribute('sandbox', 'allow-scripts');
    const src = (await frameElement.getAttribute('src'))!;
    expect(src, 'a token and the file’s name, no folder').toMatch(/^maws-artifact:\/\/[0-9a-f]{32}\/notes\.html$/);
    const page = await frameAt(s.page, src);
    await expect(page.locator('#marker'), 'its inline script ran').toHaveText('SCRIPT_RAN');
    await expect.poll(() => page.evaluate(() => document.body.dataset.fetch ?? ''), { message: 'its fetch has settled' }).toBe('failed');

    // its messages reached the window and changed nothing: no bridge listens to a file's frame (decision 13)
    await expect.poll(() => page.evaluate(() => document.body.dataset.posted ?? ''), { message: 'the page posted its messages' }).toBe('yes');
    await expect.poll(heard, { message: 'the window heard the three messages' }).toEqual(['maws:picked', 'maws:pick-cancelled', 'maws:located']);
    await expect(s.page.locator('[data-comment-card], [data-comment-composer], [data-picking]'), 'no comment card, composer or picking').toHaveCount(0);
    await expect(viewer, 'the viewer still draws the page').toHaveAttribute('data-frame', 'html');
    await expect(frameElement, 'from the same token').toHaveAttribute('src', src);

    // no server-reflexive candidate: WebRTC never left the machine (disable_non_proxied_udp)
    await expect.poll(() => page.evaluate(() => document.body.dataset.ice ?? ''), { timeout: 15_000 }).toMatch(/^done:/);
    const ice = await page.evaluate(() => document.body.dataset.ice!);
    console.log(`[u6b2-file-page] ICE candidate types in the frame: ${JSON.stringify(ice)}`);
    expect(ice).not.toContain('srflx');
    // a download link saves nothing: the frame's sandbox (no allow-downloads) refuses it before any download starts
    await page.locator('#save').click();
    await s.page.waitForTimeout(1_500); // a download that started would have reached main by now; nothing to wait for
    expect(seamLines(s).filter((l) => l.startsWith('blocked-download')), 'no download reached main').toEqual([]);
    expect(filesUnder(downloads, () => true)).toEqual([]);
    expect(filesUnder(s.maws.userData, (name) => name === 'e2-download.txt' || name.endsWith('.crdownload'))).toEqual([]);
    // a link to the web: the app's own `frame-src` refuses the frame's navigation; the window stays where it was
    const navigations = await recordNavigations(s.maws);
    const appUrl = s.page.url();
    await page.locator('#away').click();
    await expect.poll(navigations).toContain('fail frame -30 https://example.invalid/away'); // ERR_BLOCKED_BY_CSP
    expect((await navigations()).filter((line) => line.startsWith('navigated window'))).toEqual([]);
    expect(s.page.url()).toBe(appUrl);
  });
});

test("a file by a path: a hostile PDF's link is a blocked navigation, its Download a blocked download, and every frame beneath it is the scheme's, the viewer's or chrome://resources", async () => {
  test.setTimeout(240_000);
  await scene({ titles: ['U6b-2: a hostile PDF by a path'] }, async (s) => {
    const [id] = s.ids;
    const path = join(s.repo, 'report.pdf');
    writeFileSync(path, minimalPdf('https://example.invalid/pdf-link'));
    const downloads = await scratchDownloads(s);
    await openByPath(s, id, path);
    // moved to the main area, where Chromium's toolbar, and so its Download, shows (decision 15)
    await sideColumn(s.page).locator(`[data-files-tab][data-file="${path}"] [data-move-to-main]`).click();
    const viewer = s.page.locator(`[data-region="main"] [data-file-viewer][data-path="${path}"]`);
    await expect(viewer).toHaveAttribute('data-frame', 'pdf', { timeout: 20_000 });
    const pdfFrame = viewer.locator('[data-artifact-frame="pdf"]');
    await expect(pdfFrame, 'the stored PDF’s frame: no sandbox').not.toHaveAttribute('sandbox');
    await expect(pdfFrame).toHaveAttribute('src', /^maws-artifact:\/\/[0-9a-f]{32}\/report\.pdf#navpanes=0$/);
    const url = withoutFragment((await pdfFrame.getAttribute('src'))!);
    await expect.poll(async () => (await darkIn(s, pdfFrame)).dark, { timeout: 15_000, message: 'the PDF frame draws its page' }).toBeGreaterThan(2_000);

    // its link: the viewer asks to navigate the window, and main's top-level guard refuses it
    const navigations = await recordNavigations(s.maws);
    const appUrl = s.page.url();
    const square = (await darkIn(s, pdfFrame)).centre!;
    await s.page.mouse.click(square.x, square.y);
    await expect.poll(navigations, { timeout: 10_000 }).toContain('start window https://example.invalid/pdf-link');
    await expect.poll(() => seamLines(s)).toContain('blocked-navigation https://example.invalid/pdf-link');
    await s.page.waitForTimeout(1_000); // a commit the guard let through would have landed by now
    expect((await navigations()).filter((line) => line.startsWith('navigated window'))).toEqual([]);
    const after = await framesOfWindow(s);
    expect(after.app).toBe(appUrl);
    expect(s.page.url()).toBe(appUrl);
    for (const frame of after.frames.slice(1)) expect(frame, JSON.stringify(after.frames)).toMatch(/^(maws-artifact:\/\/|chrome-extension:\/\/mhjfbmdgcfjbbpaeojofohoefgiehjai\/|chrome:\/\/resources\/)/);

    // its Download, pressed in the viewer's own page: a download of the token's URL, cancelled by the download filter
    const pressed = await pressPdfDownload(s);
    expect(pressed.some((answer) => answer.endsWith(' pressed')), JSON.stringify(pressed)).toBe(true);
    await expect.poll(() => seamLines(s).filter((line) => line.startsWith(`blocked-download ${url}`)).length, { message: 'the viewer’s save cancelled as a download of the token’s URL' }).toBeGreaterThan(0);
    await s.page.waitForTimeout(1_000); // a download let through would have written its first bytes by now
    expect(filesUnder(downloads, () => true)).toEqual([]);
    expect(filesUnder(s.maws.userData, (name) => name.endsWith('.pdf') || name.endsWith('.crdownload'))).toEqual([]);
  });
});

test("ticket 662 on a file's frame: its dns-prefetch links ask the resolver for nothing", async () => {
  test.setTimeout(180_000);
  await scene({ titles: ['U6b-2: dns-prefetch on a file'] }, async (s) => {
    const [id] = s.ids;
    const label = randomUUID().slice(0, 8);
    const names = { script: `maws-e2e-${label}-script.example.com`, markup: `maws-e2e-${label}-markup.example.com`, control: `maws-e2e-${label}-control.example.com` };
    const path = join(s.repo, 'travel.html');
    writeFileSync(path, prefetchPage(names));
    await s.page.evaluate(() => window.addEventListener('message', (event) => void (event.data === 'e2-prefetch-attached' && ((window as unknown as { __u6b2Prefetch: boolean }).__u6b2Prefetch = true))));

    // the net log of the window's session, the frame's (its default capture mode keeps a request's host)
    const log = join(s.scratch.root, 'net-log.json');
    await s.maws.app.evaluate(({ BrowserWindow }, at) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!.webContents.session.netLog.startLogging(at), log);
    const viewer = await openByPath(s, id, path);
    await expect(viewer).toHaveAttribute('data-frame', 'html');
    await expect.poll(() => s.page.evaluate(() => (window as unknown as { __u6b2Prefetch?: boolean }).__u6b2Prefetch === true), { message: 'the page’s script ran and connected both links' }).toBe(true);
    // a prefetch goes from the frame's renderer to the browser process and on to the resolver after the insertion
    await s.page.waitForTimeout(2_000);
    await s.maws.app.evaluate(async ({ BrowserWindow }, host) => {
      const { session } = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!.webContents;
      await Promise.race([session.resolveHost(host).catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    }, names.control);
    await s.maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!.webContents.session.netLog.stopLogging()); // flushed to disk when it resolves

    const { constants, events } = JSON.parse(readFileSync(log, 'utf8')) as { constants: { logEventTypes: Record<string, number> }; events: { type: number; params?: unknown }[] };
    const typeNames = new Map(Object.entries(constants.logEventTypes).map(([name, type]) => [type, name]));
    // each event that names one of the run's names, by its type alone: its other params hold the machine's resolver
    // settings (search domains among them), which a report keeps out
    const mentions = (name: string) => events.filter((event) => JSON.stringify(event.params ?? {}).includes(name)).map((event) => typeNames.get(event.type) ?? String(event.type));
    const found = { control: mentions(names.control), script: mentions(names.script), markup: mentions(names.markup) };
    const report = `net log: ${events.length} events\n${Object.entries(found).map(([which, types]) => `${which} ${names[which as keyof typeof names]}: ${types.length} events ${JSON.stringify(types)}`).join('\n')}`;
    console.log(`[u6b2-dns-prefetch] ${report}`);
    expect(found.control.length, `the control's resolver job is in the log\n${report}`).toBeGreaterThan(0);
    expect(found.script, `the script-made link asked for no name\n${report}`).toEqual([]);
    expect(found.markup, `the markup link asked for no name\n${report}`).toEqual([]);
  });
});

type Completion = { url: string; method: string; status: number; contents: number | null };

test("a token's URL: its own name's path is the file; another name, a longer path and a query are 404; a POST is 405; a closed tab's is 404", async () => {
  test.setTimeout(180_000);
  await scene({ titles: ['U6b-2: a token’s URL'] }, async (s) => {
    const [id] = s.ids;
    const path = join(s.repo, 'ledger.html');
    writeFileSync(path, FRAME_PAGE);
    const owner = await s.maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!.webContents.id);
    // what the window's partition completed for the scheme: each request's status as the responder answered it, and the
    // web contents that asked (the scene's own listener: the app sets none on this event)
    await s.maws.app.evaluate(({ session }) => {
      const done: Completion[] = [];
      (globalThis as unknown as { __u6b2Completed: Completion[] }).__u6b2Completed = done;
      session.defaultSession.webRequest.onCompleted({ urls: ['<all_urls>'] }, (details) => {
        if (details.url.startsWith('maws-artifact://')) done.push({ url: details.url, method: details.method, status: details.statusCode, contents: details.webContentsId ?? null });
      });
    });
    const completed = () => s.maws.app.evaluate(() => [...(globalThis as unknown as { __u6b2Completed: Completion[] }).__u6b2Completed]);
    let probes = 0;
    // `url` loaded by the owning window as a person's frame would load it, by a GET in a frame of its own, or by a form's
    // POST into one; its completion, once the partition has one for it
    const probe = async (url: string, method: 'GET' | 'POST' = 'GET'): Promise<Completion> => {
      const before = (await completed()).length;
      const frame = `u6b2-probe-${++probes}`;
      if (method === 'GET') await mountFrames(s.page, [{ id: frame, kind: 'html', url }]);
      else {
        await s.page.evaluate(({ frame, url }) => {
          const target = document.createElement('iframe');
          target.id = frame;
          target.name = frame;
          target.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:240px;border:0;z-index:2147483647;background:#fff';
          document.body.appendChild(target);
          const form = document.createElement('form');
          form.method = 'post';
          form.action = url;
          form.target = frame;
          form.style.display = 'none';
          const field = document.createElement('input');
          field.type = 'hidden';
          field.name = 'u6b2';
          field.value = 'posted';
          form.append(field);
          document.body.appendChild(form);
          form.submit();
          form.remove();
        }, { frame, url });
      }
      let found: Completion | undefined;
      await expect.poll(async () => (found = (await completed()).slice(before).find((c) => c.url === url && c.method === method)) !== undefined, { message: `${method} ${url} completed` }).toBe(true);
      await s.page.evaluate((frame) => document.getElementById(frame)?.remove(), frame);
      expect(found!.contents, `${method} ${url}: asked by the owning window`).toBe(owner);
      return found!;
    };

    const viewer = await openByPath(s, id, path);
    await expect(viewer).toHaveAttribute('data-frame', 'html');
    const url = (await viewer.locator('[data-artifact-frame="html"]').getAttribute('src'))!;
    expect(url).toMatch(/^maws-artifact:\/\/[0-9a-f]{32}\/ledger\.html$/);
    const root = url.slice(0, url.lastIndexOf('/') + 1); // `maws-artifact://<token>/`

    // its own name's path: the file, whose script runs
    expect((await probe(url)).status, 'its own name').toBe(200);
    await expect((await frameAt(s.page, url)).locator('#marker')).toHaveText('SCRIPT_RAN');
    // every other path under the token, and any query: 404, the same for each
    expect((await probe(`${root}other`)).status, 'another name').toBe(404);
    expect((await probe(`${root}nested/ledger.html`)).status, 'a longer path').toBe(404);
    expect((await probe(`${url}?view=1`)).status, 'a query').toBe(404);
    // a method other than GET and HEAD
    expect((await probe(url, 'POST')).status, 'a POST').toBe(405);

    // the tab closed: its entry goes, its token is released, and its URL answers 404
    await closeSideTab(s.page, 'ledger.html');
    await expect(s.page.locator(`[data-file-viewer][data-path="${path}"]`)).toHaveCount(0);
    await expect.poll(async () => (await probe(url)).status, { message: 'the closed tab’s URL, once its token is released' }).toBe(404);
    await s.maws.app.evaluate(({ session }) => session.defaultSession.webRequest.onCompleted(null));
  });
});

test("a read that fails before a PDF's first byte shows the sentence and Open again; pressed while it still fails, the same body; nothing reads again by itself; pressed once the file is readable, the PDF is drawn", async () => {
  test.setTimeout(240_000);
  // A PDF outside the session's folder that the session's transcript links (U6c): no watch follows it, so its removal and
  // its return are seen by nobody until a person asks (sequence 12)
  const scratch = scratchProject({ titles: ['U6b-2: a read that fails'] });
  try {
    const outside = join(scratch.root, 'elsewhere');
    mkdirSync(outside);
    const path = join(outside, 'report.pdf');
    const bytes = minimalPdf();
    writeFileSync(path, bytes);
    const transcript = join(scratch.config, 'projects', scratch.repo.replace(/[^a-zA-Z0-9]/g, '-'), `${scratch.engineIds[0]}.jsonl`);
    const first = JSON.parse(readFileSync(transcript, 'utf8').split('\n')[0]!) as { uuid: string; sessionId: string };
    const reply = `The report is [here](${path}).`;
    appendFileSync(transcript, `${JSON.stringify({
      parentUuid: first.uuid, isSidechain: false, userType: 'external', type: 'assistant', uuid: randomUUID(), timestamp: '2026-10-06T00:00:30.000Z', cwd: scratch.repo, sessionId: first.sessionId, version: '2.1.291',
      message: { id: 'msg_u6b2m6b15', type: 'message', role: 'assistant', model: 'claude-opus-4-5', content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 } },
    })}\n`);
    const s = await launchScene(scratch);
    try {
      const [id] = s.ids;
      await show(s, id);
      const chip = s.page.locator(`[data-region="main"] [data-chip="path"][title="${path}"]`);
      await expect(chip, 'the transcript’s link').toBeVisible({ timeout: 20_000 });
      await chip.click();
      const viewer = sideColumn(s.page).locator(`[data-file-viewer][data-path="${path}"]`);
      await expect(viewer, 'the linked PDF drawn beside the chat').toHaveAttribute('data-frame', 'pdf', { timeout: 20_000 });
      const firstUrl = (await viewer.locator('[data-artifact-frame="pdf"]').getAttribute('src'))!;
      // kept, so another tab can be shown in its place and it shown again
      await sideTab(sideColumn(s.page), 'report.pdf').dblclick();
      await expect(sideColumn(s.page).locator('[data-side-strip] [data-tab-id][data-preview="true"]'), 'the tab kept').toHaveCount(0);

      // the file removed where no watch sees it; the tab hidden and shown again, so its frame asks its URL once more
      rmSync(path);
      await sideGroup(s.page, 'upper').getByRole('button', { name: 'Add a tool', exact: true }).click();
      await s.page.getByRole('menuitem', { name: 'Files', exact: true }).click();
      await expect(sideColumn(s.page).locator('[data-files-tab][data-file=""]'), 'another tab in its place').toBeVisible({ timeout: 20_000 });
      await sideTab(sideColumn(s.page), 'report.pdf').click();
      const stopped = viewer.locator('[data-frame-stopped]');
      const again = stopped.getByRole('button', { name: 'Open again', exact: true });
      await expect(viewer, 'the read for the frame failed before its first byte').toHaveAttribute('data-frame', 'failed', { timeout: 20_000 });
      await expect(stopped.getByText('This file stopped loading: it changed, or it can no longer be read.', { exact: true })).toBeVisible();
      await expect(viewer.locator('iframe'), 'no blank or broken frame').toHaveCount(0);
      await again.focus();
      await expect(again, 'the button takes the focus').toBeFocused();
      // the read the showing made (a named file is read again when shown) has failed too, and is over
      await expect(viewer.locator('[role="status"][data-notice="File removed"]')).toBeVisible({ timeout: 20_000 });
      await expect(viewer).toHaveAttribute('data-pending', '0');

      // pressed while the file is still gone: one read, which fails, and the same body; no token asked, so no request
      const frameRequests = () => seamLines(s).filter((line) => line.startsWith('frame-')).length;
      const loads = Number(await viewer.getAttribute('data-loads'));
      const asked = frameRequests();
      await again.click();
      await expect(viewer, 'the read the button made has completed').toHaveAttribute('data-loads', String(loads + 1), { timeout: 20_000 });
      await expect(viewer).toHaveAttribute('data-frame', 'failed');
      await expect(stopped.getByText('This file stopped loading: it changed, or it can no longer be read.', { exact: true })).toBeVisible();
      await expect(again).toBeVisible();
      expect(frameRequests(), 'no frame asked for its URL').toBe(asked);

      // the file back, and time passing: nothing reads it again by itself
      writeFileSync(path, bytes);
      await s.page.waitForTimeout(3_000); // what a clock or a watch would have read by now; nothing should
      await expect(viewer).toHaveAttribute('data-loads', String(loads + 1));
      await expect(viewer).toHaveAttribute('data-frame', 'failed');
      expect(frameRequests(), 'no request for the file').toBe(asked);

      // pressed once the file is readable: a new token, and the PDF drawn
      await again.click();
      await expect(viewer, 'drawn again').toHaveAttribute('data-frame', 'pdf', { timeout: 20_000 });
      const pdfFrame = viewer.locator('[data-artifact-frame="pdf"]');
      await expect(pdfFrame).toHaveAttribute('src', /^maws-artifact:\/\/[0-9a-f]{32}\/report\.pdf#toolbar=0&navpanes=0$/);
      expect(await pdfFrame.getAttribute('src'), 'from a new token').not.toBe(firstUrl);
      await expect.poll(async () => (await darkIn(s, pdfFrame)).dark, { timeout: 15_000, message: 'the PDF frame draws its page' }).toBeGreaterThan(2_000);
    } catch (error) {
      await s.maws.cleanup();
      throw error;
    }
    await closeScene(s);
  } finally {
    rmSync(scratch.root, { recursive: true, force: true });
  }
});

// ---- P2-F W-V (L95, §2 item 6): the media viewers' sizing ------------------------------------------------------------

test('a 64 px image and a short video fill the pane, in the panel and in a main tab; zoom in, actual size, and fit again', async () => {
  test.setTimeout(180_000);
  await scene({ titles: ['P2-F: media sizing'] }, async (s) => {
    const [id] = s.ids;
    const at = (k: number) => new Date(Date.parse('2026-10-09T09:00:00.000Z') + k * 60_000).toISOString();
    const put = (name: string, bytes: Buffer) => {
      writeFileSync(join(s.repo, name), bytes);
      return join(s.repo, name);
    };
    const png = seedFile(s.maws.userData, id, put('dot.png', solidPng(64, 64, [21, 101, 192])), at(0));
    const webm = seedFile(s.maws.userData, id, put('clip.webm', await recordedWebm(s.page)), at(1)); // 160 × 120
    await importSeeded(s.page);

    await show(s, id);
    await openArtifacts(s);
    const list = listOf(s);
    const panelViewer = viewerOf(s.panel);
    const tabViewer = (record: DeliverableRecord) => s.page.locator(`[data-region="main"] [data-artifact-tab] [data-artifact-viewer="${record.id}"]`);

    // the media's drawn box against the stage's content box: at fit it is its natural size times the scale that fits it
    // (the aspect kept, neither side past the box), it meets the box on the limiting side, and a small medium is grown
    // past its natural size; stated by the box, so it holds at any column width (UX wave U8b, Addendum 5: in the 360 px
    // column the box is 316 px wide, the column less its chrome and the stage's padding, and the 160 by 120 video draws
    // 316 by 237)
    const measure = (viewer: Locator, media: string) =>
      viewer.locator('[data-zoom-stage]').evaluate((stage, selector) => {
        const style = getComputedStyle(stage);
        const box = { width: stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), height: stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) };
        const drawn = stage.querySelector(selector)!.getBoundingClientRect();
        return { box, drawn: { width: drawn.width, height: drawn.height }, zoom: stage.getAttribute('data-zoom') };
      }, media);
    const sizes = async (viewer: Locator, media: string, natural: { width: number; height: number }) => {
      const fits = async () => {
        const { box, drawn, zoom } = await measure(viewer, media);
        const scale = Math.min(box.width / natural.width, box.height / natural.height);
        const meets = Math.abs(drawn.width - box.width) <= 1 || Math.abs(drawn.height - box.height) <= 1;
        const grown = drawn.width > natural.width && drawn.height > natural.height;
        return zoom === 'fit' && Math.abs(drawn.width - natural.width * scale) <= 1 && Math.abs(drawn.height - natural.height * scale) <= 1 && meets && grown;
      };
      await expect.poll(fits, { message: 'fills the pane at fit' }).toBe(true);
      const fitted = (await measure(viewer, media)).drawn;
      await expect(viewer.getByRole('button', { name: 'Fit' })).toHaveAttribute('aria-pressed', 'true');
      await viewer.getByRole('button', { name: 'Zoom in' }).click();
      await expect.poll(async () => (await measure(viewer, media)).drawn.width).toBeGreaterThan(fitted.width + 1);
      expect((await measure(viewer, media)).zoom).not.toBe('fit');
      await viewer.getByRole('button', { name: 'Actual size' }).click();
      await expect.poll(async () => (await measure(viewer, media)).drawn).toEqual(natural);
      await expect(viewer.locator('[data-zoom-percent]')).toHaveText('100%');
      await viewer.getByRole('button', { name: 'Fit' }).click();
      await expect.poll(fits, { message: 'fits again' }).toBe(true);
    };

    for (const [record, body, media, natural] of [
      [png, 'file', '[data-image-view] img', { width: 64, height: 64 }],
      [webm, 'video', 'video[data-artifact-media="video"]', { width: 160, height: 120 }],
    ] as const) {
      // P3-L M6b: an `artifact` main tab is the library's, not the session's (E2's `deliverable` tab was), so the panel
      // leaves the session's tools while one is active: the session is shown again before the next row
      await show(s, id);
      if (await panelViewer.isVisible()) await s.panel.getByRole('button', { name: 'Back' }).click();
      await rowOf(list, record).click();
      await expect(panelViewer).toHaveAttribute('data-body', body);
      await sizes(panelViewer, media, natural);
      await s.panel.getByRole('button', { name: 'Move to tab' }).click();
      await expect(tabViewer(record)).toBeVisible();
      await sizes(tabViewer(record), media, natural);
    }
  });
});

// ---- (4) show_pane 'artifact' (E2's 'deliverable'; over the recording's derived copy, its pane renamed) --------------
// UX wave U6d (O-44; decision 22): the agent opens no artifact by itself. The pane is retired, so the host refuses the
// call with the sentence that teaches the link, asks no window, and nothing opens, whether or not an artifact answers to
// the target; the event carries the sentence. The cell draws the fixture's tool_result, which the replay plays as
// recorded, so the refusal's words in a row are the model's unit test's and the paid live group's.

test('show_pane: a call for the retired artifact pane is answered with the sentence and opens nothing, also when an artifact the target names exists', async () => {
  test.setTimeout(180_000);
  await scene({ titles: ['E2: show_pane, nothing delivered', 'E2: show_pane, an artifact'] }, async (s) => {
    const [bare, seeded] = s.ids;
    // the recording's target is `none`: in the second session an artifact carries that id, which the call opened before
    seedArtifact(s.maws.userData, seeded, 'none', 'Release notes', [pageOf('RELEASE_NOTES', '#37474f')]);
    await importSeeded(s.page);
    const answers = (id: string) => {
      const rows = s.journal(id);
      return mcpCalls(rows).map((c) => mcpResultOf(rows, c.requestId)!);
    };
    const panesShown = async (id: string) => ofKind(await s.events(id), 'maws.pane.shown').map((e) => [e.pane, e.opened?.kind ?? null, e.error]);

    for (const id of [bare, seeded]) {
      await show(s, id);
      await replay(s, id, SHOW_PANE_ARTIFACT);
      for (let k = 0; k < 3; k++) await allowNext(s, id); // terminal, artifact, nope (seqs 68, 85, 100)
      await idle(s, id);
      expect(answers(id)[1], id).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.artifactPaneRetired }], isError: true });
      expect(await panesShown(id), id).toEqual([
        ['terminal', 'panel-tool', null],
        ['artifact', null, TOOL_ERRORS.artifactPaneRetired],
      ]);
      // nothing opened beside the chat: no Artifacts viewer, no Artifacts surface
      await expect(viewerOf(s.panel)).toHaveCount(0);
      await expect(surface(s.page, 'artifacts')).toHaveCount(0);
      // the cell draws the fixture's tool_result, E1's words with the pane renamed (Surprises, M4); the replay compares no
      // bodies. Read on the cell's own label: the turn's line says what the turn did in its rows' words (UX wave U2, O-15)
      await unfoldWork(s.pane);
      await expect(s.pane.locator('.transcript-cell-label').filter({ hasText: /^Could not open pane: the artifact pane is not available in this build of MAWS$/ })).toBeVisible();
    }
  });
});

// ---- (5) comment mode -------------------------------------------------------------------------------------------------

const COMMENT_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><title>Dashboard</title></head><body style="margin:0;font:16px system-ui;background:#ffffff;color:#1b1b1b">' +
  '<h1 id="hero" style="margin:0;padding:32px 24px;background:#e3f2fd">Sales overview</h1>' +
  '<p class="lead" style="padding:0 24px">Revenue by region, third quarter.</p>' +
  "<script>console.error('E2_PAGE_LOG')</script></body></html>";

// P2-E1 (M1): a page whose last element sits at the bottom of its frame, where the card opens above it.
const FOOTER_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><title>Notes</title></head><body style="margin:0;font:16px system-ui;background:#ffffff;color:#1b1b1b">' +
  '<p style="margin:0;padding:24px">Notes for the quarter.</p>' +
  '<footer id="foot" style="position:fixed;left:0;right:0;bottom:0;margin:0;padding:12px 24px;background:#fff3e0">Prepared by the analytics team</footer></body></html>';

// Within a pixel: a box edge as the layout rounds it.
const near = (actual: number, expected: number, what: string) => expect(Math.abs(actual - expected), `${what}: ${actual} against ${expected}`).toBeLessThanOrEqual(1);

// P2-E1 (M1; P2-E1 document, acceptance 1 and 2): a pick opens the comment card beside the element inside the viewer's
// body (no sheet, no Side tab, the main area's tabs unchanged, the Artifacts tab still selected), below the element
// with room and above one at the frame's bottom; the same in the artifact's main tab; Escape gives focus back to Comment
// (the viewer's X32 header's, P3-L M5b), dismissing an empty card and keeping one with text (UX wave U5a: X36's draft rule
// is every host's), which Close then discards.
test('comment mode: Escape ends picking and nothing else, picking highlights the element under the pointer, and a click opens the comment card beside the element', async () => {
  await scene({ titles: ['E2: comment'] }, async (s) => {
    const [id] = s.ids;
    const record = seedArtifact(s.maws.userData, id, 'dash', 'Dashboard', [COMMENT_PAGE]);
    const notes = seedArtifact(s.maws.userData, id, 'notes', 'Notes', [FOOTER_PAGE], new Date(Date.now() - 60_000).toISOString());
    await importSeeded(s.page);
    await show(s, id);
    await openArtifacts(s);
    await rowOf(listOf(s), record).click();
    const viewer = viewerOf(s.panel);
    const frame = await frameAt(s.page, await pageUrlOf(s.page, record.id));
    await expect(frame.locator('#hero')).toHaveText('Sales overview');
    await expect(viewer.locator('[data-console-chip]')).toHaveText('1 console error');
    const comment = s.panel.locator('[data-editor-header]').getByRole('button', { name: 'Comment', exact: true });
    const hint = viewer.locator('[data-picking]');
    const tools = surfaceRow(s.page);
    const artifactsSurface = surface(s.page, 'artifacts');

    // Escape while picking ends picking; the viewer, the panel's tab and the session's composer stay as they were
    await comment.click();
    await expect(comment).toHaveAttribute('aria-pressed', 'true');
    await expect(hint).toHaveText('Click an element to comment on it · Esc cancels');
    await s.page.keyboard.press('Escape');
    await expect(hint).toHaveCount(0);
    await expect(comment).toHaveAttribute('aria-pressed', 'false');
    await expect(viewer).toHaveAttribute('data-artifact-viewer', record.id);
    await expect(artifactsSurface).toBeVisible();
    await expect(s.pane.locator(`[data-composer="${await addressed(s.page, id)}"]`)).toBeVisible();

    // with the console popover open over a picking viewer, one Escape closes the popover alone
    await comment.click();
    await expect(hint).toBeVisible();
    await viewer.locator('[data-console-chip]').click();
    await expect(s.page.locator('[data-console-entry]')).toHaveCount(1);
    await s.page.keyboard.press('Escape');
    await expect(s.page.locator('[data-console-entry]')).toHaveCount(0);
    await expect(hint).toBeVisible();
    await expect(comment).toHaveAttribute('aria-pressed', 'true');

    // the heading under the pointer is highlighted in the page; a click picks it and opens the card beside it
    const box = (await viewer.locator('[data-artifact-frame="html"]').boundingBox())!;
    await pointInFrame(s.page, frame, box.x + 60, box.y + 30);
    await shoot(s, 'comment-picking', () => s.page.mouse.move(box.x + 61, box.y + 31));
    const mainTabs = shellMainTabs(s.page).getByRole('tab');
    const mainTabsBefore = await mainTabs.count();
    await s.page.mouse.click(box.x + 60, box.y + 30);
    const card = viewer.getByRole('dialog', { name: 'Comment on Dashboard v1 › h1#hero “Sales overview”' });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-comment-card', '');
    await expect(card).toHaveAttribute('data-anchor-kind', 'artifact-element');
    await expect(card).toHaveAttribute('data-anchor-locator', '#hero');
    await expect(card).toHaveAttribute('data-card-phase', 'composing');
    await expect(card).toHaveAttribute('data-placement', 'below');
    await expect(s.page.locator('[data-comment-composer]')).toHaveCount(0);
    await expect(hint).toHaveCount(0); // one pick per Comment
    await expect(frame.locator('[data-maws-pick-overlay]')).toHaveCount(0);
    await expect(artifactsSurface).toBeVisible();
    await expect(s.panel.getByRole('tab', { name: /^Side/ }).or(tools.getByRole('button', { name: /^Side/ }))).toHaveCount(0);
    await expect(mainTabs).toHaveCount(mainTabsBefore);

    // its box: 4 px under the heading's bottom edge, at its left, 300 px wide, inside the viewer's body. The body holds the
    // card and its 8 px margin each side (316 px): in the 360 px column the body is 348 px, the column less its chrome
    // (UX wave U8b, Addendum 5; 348 measured on the hosted Macs)
    const hero = (await frame.locator('#hero').boundingBox())!;
    const body = (await viewer.locator('[data-card-host]').boundingBox())!;
    const placed = (await card.boundingBox())!;
    near(placed.y, hero.y + hero.height + 4, 'the card’s top');
    near(placed.x, hero.x, 'the card’s left');
    expect(body.width).toBeGreaterThanOrEqual(316);
    near(placed.width, 300, 'the card’s width');
    expect(placed.x + placed.width).toBeLessThanOrEqual(body.x + body.width - 8 + 1);
    expect(placed.y + placed.height).toBeLessThanOrEqual(body.y + body.height + 1);

    // the composer half: the sheet's names, the field focused, "Send to main" unchecked (a side thread; UX wave U5a's one
    // checkbox in place of the two segments), Send waiting for text
    const field = card.getByRole('textbox', { name: 'Comment' });
    await expect(field).toBeFocused();
    await expect(card.getByRole('checkbox', { name: 'Send to main' })).not.toBeChecked();
    await expect(card.getByRole('radio'), 'no two-segment control').toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Send' })).toBeDisabled();
    await field.fill('Make the heading larger.');
    await expect(card.getByRole('button', { name: 'Send' })).toBeEnabled();
    await shoot(s, 'comment-card');
    // Escape keeps a card with text and gives the keyboard back; the person's Close discards it
    await s.page.keyboard.press('Escape');
    await expect(comment).toBeFocused();
    await expect(card, 'a card with text is kept').toBeVisible();
    await expect(field).toHaveValue('Make the heading larger.');
    await card.getByRole('button', { name: 'Close' }).click();
    await expect(card).toHaveCount(0);
    await expect(viewer.locator('[data-unsent-chip]'), 'Close discarded it: nothing unsent').toHaveCount(0);
    await expect(artifactsSurface).toBeVisible();

    // the same pick in the artifact's main tab opens the card inside that tab's viewer
    await s.panel.getByRole('button', { name: 'Move to tab' }).click();
    const tabViewer = viewerOf(s.page.locator('[data-region="main"] [data-artifact-tab]'));
    await expect(tabViewer).toHaveAttribute('data-artifact-viewer', record.id);
    await s.page.locator('[data-region="main"] [data-editor-header]').getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(tabViewer.locator('[data-picking]')).toBeVisible();
    const tabFrame = (await tabViewer.locator('[data-artifact-frame="html"]').boundingBox())!;
    // the frame has just loaded in the tab: the click follows a move it heard (runs 40609072336 and 40760525466 lost it)
    await pointInFrame(s.page, tabViewer.locator('[data-artifact-frame="html"]').contentFrame(), tabFrame.x + 60, tabFrame.y + 30);
    await s.page.mouse.click(tabFrame.x + 60, tabFrame.y + 30);
    const tabCard = tabViewer.locator('[data-comment-card]');
    await expect(tabCard).toHaveAttribute('data-anchor-locator', '#hero');
    await expect(tabCard).toHaveAttribute('data-placement', 'below');
    const tabHero = (await tabViewer.locator('[data-artifact-frame="html"]').contentFrame().locator('#hero').boundingBox())!; // the tab's width wraps it differently
    near((await tabCard.boundingBox())!.y, tabHero.y + tabHero.height + 4, 'the tab card’s top');
    await expect(viewer.locator('[data-comment-card]')).toHaveCount(0);
    await expect(s.page.locator('[data-comment-composer]')).toHaveCount(0);
    await s.page.keyboard.press('Escape');
    await expect(tabCard).toHaveCount(0);

    // an element at the bottom of its frame: the card opens above it, its bottom edge 4 px over the element's top
    await show(s, id); // P3-L M6b: the session again, its panel tools with it (an `artifact` main tab is the library's)
    // Move to tab moved the artifact (P3-F wave S, F16): the session's Artifacts tool is back on its list
    await expect(listOf(s)).toBeVisible();
    await expect(viewer).toHaveCount(0);
    await rowOf(listOf(s), notes).click();
    await expect(viewer).toHaveAttribute('data-artifact-viewer', notes.id);
    const notesFrame = await frameAt(s.page, await pageUrlOf(s.page, notes.id));
    const foot = notesFrame.locator('#foot');
    await expect(foot).toHaveText('Prepared by the analytics team');
    await comment.click();
    await expect(hint).toBeVisible();
    const footBox = (await foot.boundingBox())!;
    await pointInFrame(s.page, notesFrame, footBox.x + 60, footBox.y + footBox.height / 2);
    await s.page.mouse.click(footBox.x + 60, footBox.y + footBox.height / 2);
    const above = viewer.locator('[data-comment-card]');
    await expect(above).toHaveAttribute('data-anchor-locator', '#foot');
    await expect(above).toHaveAttribute('data-placement', 'above');
    const aboveBox = (await above.boundingBox())!;
    near(aboveBox.y + aboveBox.height, footBox.y - 4, 'the card’s bottom');
    await s.page.keyboard.press('Escape');
    await expect(above).toHaveCount(0);
  });
});

// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M8; A4 on an HTML page): the page's comments
// are one pass, as a browser tab's are. Escape keeps a typed card; a second pick joins the first; with no card open the
// chip "N unsent comments" sits at the page's top right and reopens the card on the newest; one Send carries them all.
test('a pass on an HTML page: Escape keeps the text in the card, a second pick lists the first and Send reads "Send 2 comments", the Artifacts surface away and back shows "2 unsent comments" at the page’s top right, and one Send to main delivers both as one message', async () => {
  await scene({ titles: ['U5a: a pass on a page'] }, async (s) => {
    const [id] = s.ids;
    const record = seedArtifact(s.maws.userData, id, 'dash', 'Dashboard', [COMMENT_PAGE]);
    await importSeeded(s.page);
    const journals = join(s.scratch.root, 'journals');
    mkdirSync(journals, { recursive: true });
    await launchReady(s.page, id, turnsJournal(journals, 'u5a-pass', 1), { cwd: s.repo }); // the one turn the pass's message opens
    await show(s, id);
    await openArtifacts(s);
    await rowOf(listOf(s), record).click();
    const viewer = viewerOf(s.panel);
    const frame = await frameAt(s.page, await pageUrlOf(s.page, record.id));
    await expect(frame.locator('#hero')).toHaveText('Sales overview');
    const comment = s.panel.locator('[data-editor-header]').getByRole('button', { name: 'Comment', exact: true });
    const card = viewer.locator('[data-comment-card]');
    const field = card.getByRole('textbox', { name: 'Comment' });
    // A pick at a point of the element that no open card covers: a card Escape kept stands below the first element, over
    // the left of the next, so the person points at the part of that element to the card's right
    const pick = async (selector: string) => {
      await comment.click();
      await expect(viewer.locator('[data-picking]')).toBeVisible();
      const box = (await frame.locator(selector).boundingBox())!;
      const over = (await card.count()) > 0 ? await card.boundingBox() : null;
      const x = over === null ? box.x + 20 : over.x + over.width + 16;
      const at = { x, y: box.y + box.height / 2 };
      expect(at.x, `${selector}: the point inside the element: ${JSON.stringify({ at, box })}`).toBeLessThan(box.x + box.width - 4);
      const underCard = over !== null && at.x >= over.x && at.x <= over.x + over.width && at.y >= over.y && at.y <= over.y + over.height;
      expect(underCard, `${selector}: the point clear of the kept card: ${JSON.stringify({ at, over })}`).toBe(false);
      await pointInFrame(s.page, frame, at.x, at.y);
      await s.page.mouse.click(at.x, at.y);
    };

    // the first pick, typed, then Escape: the card stays with its text, the keyboard back on Comment
    await pick('#hero');
    await expect(card).toHaveAttribute('data-anchor-locator', '#hero');
    await field.fill('Make the heading larger.');
    await field.press('Escape');
    await expect(comment).toBeFocused();
    await expect(card, 'Escape keeps the card').toBeVisible();
    await expect(field).toHaveValue('Make the heading larger.');

    // a second pick: the card moves to it and lists the first; Send counts both once the second has words
    await pick('p.lead');
    await expect(card).not.toHaveAttribute('data-anchor-locator', '#hero');
    const secondLocator = (await card.getAttribute('data-anchor-locator'))!;
    const others = card.locator('[data-pass-comment]');
    await expect(others).toHaveCount(1);
    await expect(others).toContainText('Make the heading larger.');
    await field.fill('Say which quarter this is.');
    await expect(card.getByRole('button', { name: 'Send 2 comments' })).toBeEnabled();

    // the side surface away and back: the card went with its viewer and its comments stayed; at the page's top right the
    // chip counts them and opens the card on the newest, with its text
    await hideSurface(s.page, 'Artifacts');
    await expect(viewer, 'the surface closed, its viewer with it').toHaveCount(0);
    await openSurface(s.page, 'Artifacts');
    await expect(viewer, 'the surface back on the page').toHaveAttribute('data-artifact-viewer', record.id);
    const chip = viewer.locator('[data-unsent-chip]');
    await expect(chip).toHaveText('2 unsent comments');
    await expect(card, 'no card while the chip shows').toHaveCount(0);
    const [chipBox, hostBox] = [(await chip.boundingBox())!, (await viewer.locator('[data-card-host]').boundingBox())!];
    near(chipBox.x + chipBox.width, hostBox.x + hostBox.width - 8, 'the chip’s right, 8 px in from the page’s');
    near(chipBox.y, hostBox.y + 8, 'the chip’s top, 8 px under the page’s');
    await chip.click();
    await expect(card).toHaveAttribute('data-anchor-locator', secondLocator);
    await expect(field).toHaveValue('Say which quarter this is.');
    await expect(others).toContainText('Make the heading larger.');

    // one Send to main: one message holding both comments in the order made, and the page's corner says where it went
    const listed = value(await invoke(s.page, 'session.list', {})).sessions.find((r) => r.appId === id)?.title.text ?? '';
    const title = listed.trim() === '' ? 'New chat' : listed;
    await card.getByRole('checkbox', { name: 'Send to main' }).check();
    await card.getByRole('button', { name: 'Send 2 comments' }).click();
    await expect(card).toHaveCount(0);
    await expect(viewer.locator('[data-sent-note]')).toHaveText(`Sent to ${title}`);
    const written = () => s.journal(id).filter((r) => r.direction === 'out' && (r.frame as { type?: string }).type === 'user');
    await expect.poll(() => written().length, { timeout: 20_000 }).toBe(1);
    const content = (written()[0]!.frame as { message: { content: { type: string; text?: string }[] } }).message.content;
    // the pass's one text block (the page gives no screenshots), then the page's own read: the engine host attaches the
    // read of every artifact a prompt links (P4-A3, src/engine-host/linked-reads.ts), and each comment's anchor links this
    // page by its `maws-artifact://` url; two comments on one page link it once, so one read
    expect(content.map((block) => block.type), 'the pass’s text, then one linked read').toEqual(['text', 'text']);
    expect(linkedReadOf(content[0]!.text!), 'the first block is the comments, not a read').toBeNull();
    expect(linkedReadOf(content[1]!.text!)?.artifactId, 'the second block: the page’s read (P4-A3)').toBe(record.id);
    const sent = content[0]!.text!;
    expect(sent.startsWith('2 comments, in the order made:\n\n'), 'the framing line first').toBe(true);
    const read = readAnchoredMessage(sent);
    expect(read?.destination).toBe('main');
    expect(read!.comments.map(({ anchor, text }) => ({ kind: anchor.kind, locator: anchor.locator, text }))).toEqual([
      { kind: 'artifact-element', locator: '#hero', text: 'Make the heading larger.' },
      { kind: 'artifact-element', locator: secondLocator, text: 'Say which quarter this is.' },
    ]);
    expect(sent, 'the writer’s text of the two, to the byte').toBe(commentsMessage(read!.comments, 'main'));
    // the turn that prompt opened ran to its end: the replay maps the recorded ids onto the written prompt's uuid, so the
    // result and the completed lifecycle name that prompt (a turn not yet begun reads `turn: null` too)
    const prompt = (written()[0]!.frame as { uuid?: string }).uuid;
    expect(typeof prompt, 'the written prompt carries its uuid').toBe('string');
    const answered = () => {
      const frames = s.journal(id).filter((r) => r.direction === 'in').map((r) => r.frame as { type?: string; state?: string; command_uuid?: string; user_message_uuid?: string });
      return {
        result: frames.some((f) => f.type === 'result' && f.user_message_uuid === prompt),
        completed: frames.some((f) => f.type === 'command_lifecycle' && f.state === 'completed' && f.command_uuid === prompt),
      };
    };
    await expect.poll(answered, { timeout: 20_000, message: 'the turn of that prompt reached its result and its completed lifecycle' }).toEqual({ result: true, completed: true });
    await expect.poll(async () => value(await invoke(s.page, 'session.status', { appSessionId: id })).turn, { timeout: 20_000, message: 'and the session holds no turn after it' }).toBeNull();
    expect(written(), 'one message for the two comments').toHaveLength(1);

    // UX wave U5a (M5, decision 13): the session's transcript draws the message as one bubble, each comment its own chip
    // over its own text, in the order made; the page's read (P4-A3) is not a comment, and no lead or framing line is drawn
    await test.step('the transcript’s bubble of the two comments draws two chips, in order', async () => {
      const main = s.page.locator('[data-region="main"]');
      const bubble = main.locator('[data-bubble]').filter({ hasText: 'Make the heading larger.' }).filter({ hasText: 'Say which quarter this is.' });
      await expect(bubble).toHaveCount(1, { timeout: 20_000 });
      const chips = bubble.locator('[data-chip="anchor"][data-anchor-kind="artifact-element"]');
      await expect(chips).toHaveText(read!.comments.map(({ anchor }) => anchor.label));
      await expect(chips.nth(0)).toHaveAttribute('title', '#hero');
      await expect(chips.nth(1)).toHaveAttribute('title', secondLocator);
      const drawn = await bubble.innerText();
      const order = [read!.comments[0]!.anchor.label, 'Make the heading larger.', read!.comments[1]!.anchor.label, 'Say which quarter this is.'].map((part) => drawn.indexOf(part));
      expect(order.every((index) => index >= 0), `every part drawn: ${JSON.stringify({ order, drawn })}`).toBe(true);
      expect([...order].sort((a, b) => a - b), `chip, text, chip, text in that order: ${JSON.stringify(drawn)}`).toEqual(order);
      await expect(main.getByText('2 comments, in the order made:'), 'the framing line is not drawn').toHaveCount(0);
      await expect(main.getByText('Comment on "', { exact: false }), 'the lead lines are not drawn').toHaveCount(0);
    });
  });
});

// ---- (6) a relaunch, and the All scope -------------------------------------------------------------------------------

// P3-L M6b: the two pages are X12 records written between the launches, so the second launch's host imports them at its
// start, as an upgrade does. The All scope's row naming its session ("E2: the other session") was the Deliverables
// list's alone and is gone with it.
test('a relaunch over the same profile lists every deliverable; the All scope shows another session’s and opens it; a delivered file’s name opens the viewer', async () => {
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
      // the delivery row's file name opens the Artifacts viewer on the File artifact (G5; P3-L M6b)
      const name = first.pane.locator('[data-delivery] button.transcript-delivery-open');
      await expect(name).toHaveText('hello.txt');
      await name.click();
      await expect(viewerOf(first.panel)).toHaveAttribute('data-artifact-viewer', hello);
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
      // the panel comes back as it was (the Artifacts tool on the viewer), or the tool is opened afresh
      const list = listOf(second);
      const viewer = viewerOf(second.panel);
      await expect(list.or(viewer).or(surfaceRow(second.page)).first()).toBeVisible();
      if (await viewer.isVisible()) await second.panel.getByRole('button', { name: 'Back' }).click();
      else if (!(await list.isVisible())) await openArtifacts(second);
      await expect(list.locator('[data-artifact-row] [data-part="title"]')).toHaveText(['Dashboard', 'hello.txt'], { timeout: 20_000 });
      await expect(rowOf(list, { id: hello })).toHaveAttribute('data-kind', 'file');
      await expect(rowOf(list, dashboard)).toHaveAttribute('data-kind', 'html');

      await list.getByRole('button', { name: 'All', exact: true }).click();
      // the case's own three among the whole library (P3-D seeds default design systems: Decision Log 32c)
      await expect(list.locator('[data-artifact-row][data-kind="html"], [data-artifact-row][data-kind="file"]')).toHaveCount(3);
      await rowOf(list, report).click();
      await expect(viewer).toHaveAttribute('data-artifact-viewer', report.id);
      await expect((await frameAt(second.page, await pageUrlOf(second.page, report.id))).locator('#heading')).toHaveText('OTHER_REPORT');
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
    await importSeeded(s.page);
    const revision = Number((await pageUrlOf(s.page, record.id)).split('/')[3]);
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
    const request: MawsArtifactCapture = { appSessionId: id, requestId: 'e2-attention' as MawsArtifactCapture['requestId'], artifactId: record.id, revision, width: 800, height: 600 };
    const capture = s.maws.app.evaluate(
      (_electron, request) => (globalThis as unknown as { __maws_captures: { capture(r: unknown): Promise<MawsArtifactCapturedResult> } }).__maws_captures.capture(request),
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

// ---- P3-G: Mark-up over the artifact viewer (E2's deliverable viewer) (docs/doperpowers/plans/2026-10-12-p3-g-shell.md, M4 and its review) -----

// The window's own pixel at a point (main's capture of the page, as the still's DOM route takes it), as [r, g, b].
async function windowPixel(s: Scene, at: { x: number; y: number }): Promise<number[]> {
  return s.maws.app.evaluate(async ({ BrowserWindow }, at) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!;
    const bitmap = (await win.webContents.capturePage({ x: Math.round(at.x), y: Math.round(at.y), width: 1, height: 1 })).toBitmap(); // BGRA
    return [bitmap[2]!, bitmap[1]!, bitmap[0]!];
  }, at);
}
const nearColour = (rgb: number[], expected: number[], tolerance = 16) => rgb.every((c, k) => Math.abs(c - expected[k]!) <= tolerance);

// The M4 review's ruling 2: the DOM route's still is the surface alone. The floating card overlaps the viewer's body;
// Mark up takes the still with the card's layer hidden (never unmounted), so the still holds the artifact where the card
// stands, and the card is back, the same element, once the still is taken.
test('P3-G: Mark up over the artifact viewer under the floating card takes the artifact alone; the card stays mounted and shows again', async () => {
  await scene({ titles: ['P3-G: mark-up over a viewer'] }, async (s) => {
    const [id] = s.ids;
    const TEAL = [0x00, 0x69, 0x5c];
    const artifact = seedArtifact(s.maws.userData, id, 'swatch', 'Swatch', [pageOf('SWATCH', '#00695c')]);
    await importSeeded(s.page);
    await show(s, id);
    await openArtifacts(s);
    await rowOf(listOf(s), artifact).click();
    await expect((await frameAt(s.page, await pageUrlOf(s.page, artifact.id))).locator('#heading')).toHaveText('SWATCH');

    await menu(s.maws.app, 'panel.float');
    const card = s.page.getByRole('region', { name: 'Session card' });
    await expect(card).toBeVisible();
    await card.evaluate((el) => void (el.dataset.e2eSame = 'yes')); // the element itself, to tell a remount apart
    const box = (await card.boundingBox())!;
    const inCard = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const frame = (await viewerOf(s.panel).locator('iframe').boundingBox())!;
    expect(inCard.y > frame.y && inCard.y < frame.y + frame.height && inCard.x > frame.x && inCard.x < frame.x + frame.width, 'the card stands over the artifact').toBe(true);
    expect(nearColour(await windowPixel(s, inCard), TEAL), 'the card is drawn over the artifact').toBe(false);

    // Mark up: the still under the overlay holds the artifact where the card stands
    await s.panel.locator('[data-editor-header]').getByRole('button', { name: 'Mark up' }).click();
    const layer = s.page.getByRole('region', { name: 'Mark-up' });
    const still = layer.locator('img');
    await expect(still).toHaveAttribute('src', /^data:image\/(png|jpeg);base64,/);
    const pixel = await still.evaluate(async (img: HTMLImageElement, at) => {
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(img, 0, 0);
      const rect = img.getBoundingClientRect();
      const x = Math.round(((at.x - rect.left) * img.naturalWidth) / rect.width);
      const y = Math.round(((at.y - rect.top) * img.naturalHeight) / rect.height);
      return Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3));
    }, inCard);
    expect(nearColour(pixel, TEAL), `the still under the card is the artifact’s teal, not the card (${pixel.join(',')})`).toBe(true);

    // the card was hidden for the capture only: it shows again, the same element
    await expect(card).toBeVisible();
    expect(await card.evaluate((el) => el.dataset.e2eSame)).toBe('yes');
    expect(await s.page.locator('[data-markup-occluder]').evaluateAll((els) => els.map((el) => (el as HTMLElement).style.visibility))).not.toContain('hidden');
    await s.page.keyboard.press('Escape');
    await expect(layer).toHaveCount(0);
    await expect(card).toBeVisible();
  });
});
