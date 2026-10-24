// Presentations' export in the product build (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M9, D12;
// Acceptance 6; `pnpm e2e:presentations`). A deck is created by the human's `artifacts.create`, given a picture through
// `artifacts.uploadAsset` and seeded from files through the renderer's seam (`window.__maws_presentations`), on a scratch
// profile. Each format runs through main's export service, the route the agent's `artifact_export` and the editor's
// Export menu share (`artifacts.export`; the tool's `fonts` reaching main is the tool server's unit suite):
// - PPTX in the `named`, `basic` and `pictures` variants: unzipped, every editable element a native object named by its
//   id at its measured place, notes kept, the hidden slide marked, the transitions and the design system's theme part
//   written, an icon's PNG fallback drawn by the window; each slide one picture with its notes in `pictures`; `embedded`
//   refused with its reason (not built yet; H3);
// - PDF: one 1920×1080 px page per visible slide, the embed drawn as the picture the window took of it running;
// - standalone HTML: tokens literal, the picture inlined, the shapes drawn from the measure, a keyboard viewer that
//   works in a window of its own;
// - For Claude: a zip whose slides use no `var()` and which the loader reads back with no slide held;
// - PNG: the cover slide at 1920×1080, or at the width asked.
// The export entries under Deck actions save each where the owner chooses (the e2e's folder).
// The LibreOffice render-and-compare (parent §4.8) runs where `soffice` is present, else it is skipped with its reason:
// the corpus as one deck exported to PPTX (`named`), converted by LibreOffice to PDF, both that and the app's own PDF
// rasterized by `pdftoppm` at 480×270, compared per slide (mean absolute difference per channel ≤ 0.08) and per text
// element (its words' bounding box in each, from `pdftotext -bbox`, within 24 slide px).
// P4-B2 D19 (Acceptance 7): a deck naming Google Fonts faces, with no network (MAWS_GOOGLE_FONTS_FIXTURES answers the
// host's egress from the grounding's recorded answers, any other URL failing as offline): Lora is fetched into the deck
// and draws from its assets in the editor and the presenter (`document.fonts` holds it loaded; its text sets apart from
// the fallback) and in the HTML export's `data:font/woff2` face, the PDF's font descriptor and the PPTX's `typeface`;
// Roboto Slab (Apache-2.0) is refused by name in Theme ▸ Faces and in the agent's read (the deck scale seam's
// `artifact_read`, MAWS_PRESENTATIONS_SCALE=1).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { expect, test, type Locator, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { benchDeckFiles, benchShapes } from '../src/artifacts/slides/fixtures/bench';
import { PerfSeam } from './support/document-scale';
import { asDocumentReplay } from './support/document-replay';
import { allowNext, idle, mcpCalls, mcpResultOf, PASS3, replay, scene, show } from './support/maws-tools';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { normalized, wordsAlong, wordsOfBox, type Extent, type Word } from './support/text-run';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
const invoke = <T>(page: Page, name: string, input?: unknown) =>
  page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const) as Promise<Result<T>>;
async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = await invoke<T>(page, name, input);
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}
interface Seam {
  __maws_presentations: { seed(artifactId: string, files: Record<string, string>): Promise<{ changed: string[]; held: string[] }>; files(artifactId: string): Promise<Record<string, string>> };
}

const SOFFICE = ['/opt/homebrew/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'].find((path) => existsSync(path)) ?? null;
const POPPLER = '/opt/homebrew/bin';

let launch: MawsLaunch | null = null;
let scratch: string | null = null;
let exportMenuTrace = false;
test.afterEach(async () => {
  const testInfo = test.info();
  try {
    if (exportMenuTrace && launch) {
      try {
        if (testInfo.status !== testInfo.expectedStatus) {
          const path = testInfo.outputPath('export-menu-failure.png');
          await launch.page.screenshot({ path });
          await testInfo.attach('Export menu failure', { path, contentType: 'image/png' });
        }
      } finally {
        exportMenuTrace = false;
        const path = testInfo.outputPath('export-menu-trace.zip');
        await launch.page.context().tracing.stop({ path });
        await testInfo.attach('Export menu trace', { path, contentType: 'application/zip' });
      }
    }
  } finally {
    await launch?.cleanup();
    launch = null;
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    scratch = null;
  }
});

async function ready(env: Record<string, string> = {}): Promise<Page> {
  launch = await launchMaws({ env });
  await launch.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 1000));
  const { page } = launch;
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as Partial<Seam>).__maws_presentations), { message: 'the seam is installed' }).toBe('object');
  return page;
}

/** A PNG of `w`×`h` in one colour. */
function png(w: number, h: number, [r, g, b]: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  const rows = Buffer.concat(Array.from({ length: h }, () => Buffer.from([0, ...Array.from({ length: w }, () => [r, g, b]).flat()])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** Publishes `files` onto a new deck through the seam (the kind's own loader and publish); answers the held paths. */
async function seedDeck(page: Page, title: string, files: Record<string, string>): Promise<{ id: string; held: string[] }> {
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'presentation', title });
  const seeded = await page.evaluate(([id, f]) => (window as unknown as Seam).__maws_presentations.seed(id, f), [artifact.id, files] as const);
  return { id: artifact.id, held: seeded.held };
}

async function createDeck(page: Page, title: string, files: (logo: string) => Record<string, string>): Promise<string> {
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'presentation', title });
  const bytes = [...png(40, 20, [200, 30, 30])];
  const { ref } = await page.evaluate(
    ([id, b]) => (window as unknown as { maws: { invoke(n: string, i: unknown): Promise<{ ok: boolean; value: { ref: string } }> } }).maws.invoke('artifacts.uploadAsset', { artifactId: id, name: 'logo.png', mime: 'image/png', bytes: new Uint8Array(b) }).then((r) => r.value),
    [artifact.id, bytes] as const,
  );
  const seeded = await page.evaluate(([id, f]) => (window as unknown as Seam).__maws_presentations.seed(id, f), [artifact.id, files(ref)] as const);
  expect(seeded.held).toEqual([]);
  return artifact.id;
}

const DECK = (logo: string): Record<string, string> => ({
  'project/deck.json': JSON.stringify({ v: 4, title: 'Quarterly', cover: 'cover', order: ['cover', 'body', 'gone'], dsOverrides: { '--ds-color-accent': '#123456' } }),
  'project/slides/cover.html': `<section id="cover" data-transition="fade" style="background:linear-gradient(135deg, #0f2a3d, #2b7a78); color:#fbfbf8; padding:128px; gap:24px">
<h1 id="title" style="font-size:96px; font-family:'Avenir Next', Georgia, serif; color:var(--ds-color-accent, #ff0000)">Quarterly <b>review</b></h1>
<p id="sub" style="height:60px; font-size:60px">A subtitle far too long for its sixty pixel box, so the fit shrinks it down</p>
<img id="logo" src="${logo}" alt="Logo" style="position:absolute; left:1600px; top:64px; width:200px; height:100px; object-fit:cover">
<aside>Open with the numbers.</aside></section>`,
  'project/slides/body.html': `<section id="body" data-transition="push" style="background:#fbfbf8; color:#1a1a1a; padding:128px; gap:32px">
<x-shape id="badge" kind="ellipse" style="position:absolute; left:100px; top:100px; width:200px; height:100px; background:#2b7a78; border:4px solid #0f2a3d"></x-shape>
<x-connector id="link" x1="300" y1="150" x2="600" y2="150" head="end"></x-connector>
<x-icon id="star" name="Star" style="position:absolute; left:700px; top:100px; color:#ff8800"></x-icon>
<svg id="chart" viewBox="0 0 100 100" aria-label="A dot" style="position:absolute; left:900px; top:100px; width:100px; height:100px"><circle cx="50" cy="50" r="40" fill="#2b7a78"></circle></svg>
<h2 id="heading" style="font-size:64px; margin-top:160px">Where we are</h2>
<ul id="points" style="font-size:36px"><li>One <a href="https://example.com/">link</a></li><li>Two</li></ul>
<table id="grid" style="font-size:28px"><tr id="h" style="background:#eef2f1"><th>Region</th><th>Q1</th></tr><tr id="r1"><td>North</td><td>12</td></tr></table>
<x-embed id="live" style="position:absolute; left:1300px; top:600px; width:400px; height:300px"><div id="x" style="width:100%; height:100%"></div><script>document.getElementById('x').style.background = '#00ff00'</script></x-embed>
<aside>Then the plan.</aside></section>`,
  'project/slides/gone.html': `<section id="gone" hidden style="background:#000000"><p id="g" style="color:#ffffff; font-size:40px">Hidden</p></section>`,
});

const EMU = 6350; // per slide px (914400 per inch, 144 px per inch)
const exportAs = (page: Page, artifactId: string, format: string, extra: Record<string, unknown> = {}) => ok<{ path: string; revision: number }>(page, 'artifacts.export', { artifactId, format, ...extra });
const pngSize = (bytes: Buffer) => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
const slideXml = (zip: JSZip, n: number) => zip.file(`ppt/slides/slide${n}.xml`)!.async('string');
const namesIn = (xml: string) => [...xml.matchAll(/<p:cNvPr id="\d+" name="([^"]*)"/g)].map((m) => m[1]!);
const typefaces = (xml: string) => new Set([...xml.matchAll(/<a:latin typeface="([^"]*)"/g)].map((m) => m[1]!));
/** The `a:off` of the shape or picture named `name`. */
const offsetOf = (xml: string, name: string) => {
  const at = xml.indexOf(`name="${name}"`);
  const m = /<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(xml.slice(at));
  return m ? m.slice(1, 5).map(Number) : null;
};

test('artifact_screenshot renders a named slide through the real export bridge and refuses an absent slide', async () => {
  test.setTimeout(180_000);
  const fixture = asDocumentReplay(`${PASS3}/p1-maws-artifacts.jsonl`, [
    { name: 'artifact_create', input: { id: 'inspection-deck', kind: 'presentation', title: 'Inspection deck', files: {
      'project/deck.json': JSON.stringify({ v: 4, title: 'Inspection deck', order: ['only'], cover: 'only' }),
      'project/slides/only.html': '<section id="only" style="background:#123456"></section>',
    } } },
    { name: 'artifact_screenshot', input: { id: 'inspection-deck', slide: 'only', width: 640, height: 360 } },
    { name: 'artifact_screenshot', input: { id: 'inspection-deck', slide: 'only', width: 960, height: 540 } },
    { name: 'artifact_screenshot', input: { id: 'inspection-deck', slide: 'absent' } },
    { name: 'artifact_read', input: { artifact: 'inspection-deck' } },
  ], 'wr-merged-slide-inspection');
  await scene({ titles: ['Deck screenshot integration'] }, async (s) => {
    const [id] = s.ids;
    await show(s, id);
    await replay(s, id, fixture);
    // The recording has two file-tool permissions beside its five maws calls.
    for (let i = 0; i < 7; i++) await allowNext(s, id);
    await idle(s, id);
    const rows = s.journal(id);
    const calls = mcpCalls(rows);
    const created = mcpResultOf(rows, calls[0]!.requestId)!;
    expect(created.isError).toBeUndefined();
    for (const [index, width, height] of [[1, 640, 360], [2, 960, 540]]) {
      const result = mcpResultOf(rows, calls[index!]!.requestId)!;
      expect(result.isError, JSON.stringify(result.content)).toBeUndefined();
      const image = result.content.find((block) => block.type === 'image');
      if (!image || image.type !== 'image') throw new Error('screenshot returned no image');
      expect(image.mimeType).toBe('image/png');
      const bytes = Buffer.from(image.data, 'base64');
      expect(pngSize(bytes)).toEqual([width, height]);
      const text = result.content.find((block) => block.type === 'text');
      if (!text || text.type !== 'text') throw new Error('screenshot returned no metadata');
      expect(JSON.parse(text.text)).toMatchObject({ status: 'captured', kind: 'presentation', slide: 'only', width, height, bytes: bytes.length });
      const centre = await s.maws.app.evaluate(({ nativeImage }, base64) => {
        const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'));
        const { width, height } = image.getSize();
        const bitmap = image.toBitmap();
        const at = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
        return [bitmap[at + 2], bitmap[at + 1], bitmap[at]];
      }, image.data);
      expect(centre).toEqual([18, 52, 86]); // Authored slide pixels, not a blank capture or a mock PNG.
    }
    const missing = mcpResultOf(rows, calls[3]!.requestId)!;
    expect(missing.isError).toBe(true);
    expect(missing.content).toEqual([expect.objectContaining({ type: 'text', text: expect.stringContaining('No slide absent') })]);
  });
});

test('every format through the export service: PPTX in three variants, PDF, standalone HTML, For Claude, PNG', async () => {
  test.setTimeout(300_000);
  const page = await ready();
  const id = await createDeck(page, 'Quarterly', DECK);

  // ---- PPTX, faces named ----
  const named = await JSZip.loadAsync(readFileSync((await exportAs(page, id, 'pptx', { fonts: 'named' })).path));
  const [one, two, three] = await Promise.all([1, 2, 3].map((n) => slideXml(named, n)));
  expect(namesIn(one!)).toEqual(expect.arrayContaining(['title', 'sub', 'logo']));
  expect(namesIn(two!)).toEqual(expect.arrayContaining(['badge', 'link', 'star', 'chart', 'heading', 'points', 'grid', 'live']));
  // at its measured place: the title at the section's padding, the logo where it is pinned, the badge an ellipse
  expect(offsetOf(one!, 'title')!.slice(0, 2)).toEqual([128 * EMU, 128 * EMU]);
  expect(offsetOf(one!, 'logo')).toEqual([1600 * EMU, 64 * EMU, 200 * EMU, 100 * EMU]);
  expect(two).toMatch(/name="badge"[\s\S]*?<a:prstGeom prst="ellipse">/);
  expect(two).toMatch(/name="grid"[\s\S]*?<a:tbl>/);
  expect(typefaces(one!)).toContain('Avenir Next');
  expect(one).toContain('<a:srgbClr val="123456"/>'); // the deck's override, as the title's colour
  // the fitted size is the size written: below the 30 pt the 60 px asked for
  const subSize = Number(/name="sub"[\s\S]*?<a:rPr[^>]* sz="(\d+)"/.exec(one!)![1]) / 100;
  expect(subSize).toBeLessThan(30);
  expect(subSize).toBeGreaterThanOrEqual(18);
  // the gradient behind the cover is its background picture; transitions; the hidden slide
  expect(one).toMatch(/<p:bg><p:bgPr><a:blipFill/);
  expect(one).toContain('<p:transition spd="med"><p:fade/></p:transition>');
  expect(two).toContain('<p:push dir="l"/>');
  expect(three).toContain('show="0"');
  const notes = await Promise.all(Object.keys(named.files).filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f)).map((f) => named.file(f)!.async('string')));
  expect(notes.join('\n')).toContain('Open with the numbers.');
  expect(notes.join('\n')).toContain('Then the plan.');
  // the design system's theme part, not pptxgenjs's
  const theme = await named.file('ppt/theme/theme1.xml')!.async('string');
  expect(theme).not.toContain('Office Theme');
  expect(theme).toContain('<a:accent1>');
  // the icon an SVG picture with the window's PNG of it (64×64), not a broken-image stand-in
  const rels2 = await named.file('ppt/slides/_rels/slide2.xml.rels')!.async('string');
  const star = two!.split('<p:pic>').find((part) => part.includes('name="star"'))!;
  expect(star).toContain('svgBlip');
  const pngTarget = new RegExp(`Id="${/<a:blip r:embed="(rId\d+)"/.exec(star)![1]}"[^>]*Target="\\.\\./media/([^"]+)"`).exec(rels2)![1]!;
  expect(pngSize(Buffer.from(await named.file(`ppt/media/${pngTarget}`)!.async('uint8array')))).toEqual([64, 64]);

  // ---- PPTX, basic faces; slides as pictures; embedded refused ----
  const basic = await JSZip.loadAsync(readFileSync((await exportAs(page, id, 'pptx')).path));
  const basicFaces = typefaces(await slideXml(basic, 1));
  expect(basicFaces).toContain('Georgia');
  expect([...basicFaces].every((face) => ['Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Brush Script MT'].includes(face))).toBe(true);
  const pictures = await JSZip.loadAsync(readFileSync((await exportAs(page, id, 'pptx', { fonts: 'pictures' })).path));
  for (const n of [1, 2, 3]) {
    const xml = await slideXml(pictures, n);
    expect(xml.split('<p:pic>').length - 1, `slide ${n} is one picture`).toBe(1);
    expect(xml).not.toContain('<p:sp>');
  }
  const slidePictures = Object.keys(pictures.files).filter((f) => f.startsWith('ppt/media/') && f.endsWith('.png'));
  expect(slidePictures).toHaveLength(3);
  for (const f of slidePictures) expect(pngSize(Buffer.from(await pictures.file(f)!.async('uint8array')))).toEqual([1920, 1080]);
  const picturesNotes = await Promise.all(Object.keys(pictures.files).filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f)).map((f) => pictures.file(f)!.async('string')));
  expect(picturesNotes.join('\n')).toContain('Open with the numbers.');
  const embedded = await invoke(page, 'artifacts.export', { artifactId: id, format: 'pptx', fonts: 'embedded' });
  expect(embedded.ok).toBe(false);
  expect(!embedded.ok && embedded.error.message).toContain('embedding uploaded fonts in a PPTX is not available yet');

  // ---- PDF: one 1920×1080 px page per visible slide, the embed a picture of it running ----
  const pdf = (await exportAs(page, id, 'pdf')).path;
  const info = execFileSync(join(POPPLER, 'pdfinfo'), [pdf], { encoding: 'utf8' });
  expect(info).toMatch(/Pages:\s+2\n/);
  expect(info).toMatch(/Page size:\s+1440 x 810 pts/);
  const body = rasterize(pdf, 2, 1920, 1080);
  expect(pixelAt(body, 1500, 750).every((v, k) => Math.abs(v - [0, 255, 0][k]!) <= 8)).toBe(true); // green: the embed ran

  // ---- standalone HTML ----
  const htmlPath = (await exportAs(page, id, 'html')).path;
  const html = readFileSync(htmlPath, 'utf8');
  expect(html).not.toContain('var(--ds-');
  expect(html).toContain('data:image/png;base64,');
  expect(html).toMatch(/<x-shape data-eid="badge"[^>]*><svg data-glyph=""/);
  expect(html).not.toContain('data-slide="gone"');
  // its viewer, in a window of its own: one slide shown, the arrow key moves on
  const viewed = await launch!.app.evaluate(async ({ BrowserWindow }, path) => {
    // a session of its own: the app's own sessions put MAWS's CSP on every file they load, which a browser would not
    const win = new BrowserWindow({ show: false, width: 960, height: 540, webPreferences: { sandbox: true, partition: 'maws-e2e-standalone' } });
    try {
      await win.loadFile(path);
      const shown = () => win.webContents.executeJavaScript(`[...document.querySelectorAll('.maws-frame[data-current]')].map((f) => f.getAttribute('data-frame'))`) as Promise<string[]>;
      const before = await shown();
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
      await new Promise((r) => setTimeout(r, 200));
      return [before, await shown()];
    } finally {
      win.destroy();
    }
  }, htmlPath);
  expect(viewed).toEqual([['cover'], ['body']]);

  // ---- For Claude ----
  const claude = await JSZip.loadAsync(readFileSync((await exportAs(page, id, 'claude')).path));
  expect(Object.keys(claude.files).sort()).toEqual(['project/deck.json', 'project/ds/maws/logo.png', 'project/slides/body.html', 'project/slides/cover.html', 'project/slides/gone.html']);
  expect(JSON.parse(await claude.file('project/deck.json')!.async('string'))).not.toHaveProperty('dsOverrides');
  const readBack: Record<string, string> = { 'project/deck.json': await claude.file('project/deck.json')!.async('string') };
  for (const name of ['cover', 'body', 'gone']) {
    const text = await claude.file(`project/slides/${name}.html`)!.async('string');
    expect(text).not.toContain('var(');
    readBack[`project/slides/${name}.html`] = text;
  }
  expect(readBack['project/slides/cover.html']).toContain('src="project/ds/maws/logo.png"');
  // read back by the kind's own loader (a deck seeded from them): no slide held
  expect((await seedDeck(page, 'Read back', readBack)).held).toEqual([]);

  // ---- PNG: the cover slide ----
  expect(pngSize(readFileSync((await exportAs(page, id, 'png')).path))).toEqual([1920, 1080]);
  expect(pngSize(readFileSync((await exportAs(page, id, 'png', { width: 960 })).path))).toEqual([960, 540]);
});

// fix wave 1 (findings 1 and 2): what transforms draw. Text under its own scale or an ancestor's exports at the size it is
// seen; a picture the window takes of a translated, a scaled, or a rotated group's member holds the element alone, whole
// and unturned (the PPTX places and turns it).
const GREEN = '<rect width="200" height="100" fill="#00ff00"></rect>';
const TRANSFORMED = (): Record<string, string> => ({
  'project/deck.json': JSON.stringify({ v: 4, title: 'Transforms', cover: 's1', order: ['s1'] }),
  'project/slides/s1.html': `<section id="s1" style="background:#ffffff">
<svg id="moved" viewBox="0 0 200 100" style="position:absolute; left:50%; top:100px; width:200px; height:100px; transform:translateX(-50%)">${GREEN}</svg>
<svg id="grown" viewBox="0 0 200 100" style="position:absolute; left:200px; top:400px; width:200px; height:100px; transform:scale(1.5)">${GREEN}</svg>
<div id="grp" data-group="" style="position:absolute; left:600px; top:500px; width:300px; height:200px; transform:rotate(30deg)"><svg id="member" viewBox="0 0 200 100" style="position:absolute; left:50px; top:50px; width:200px; height:100px">${GREEN}</svg><p id="label" style="position:absolute; left:20px; top:10px; font-size:28px">Label</p></div>
<svg id="wide" viewBox="0 0 1664 100" style="position:absolute; left:50%; top:900px; width:1664px; height:100px; transform:translateX(-50%)"><rect width="832" height="100" fill="#ff0000"></rect><rect x="832" width="832" height="100" fill="#0000ff"></rect></svg>
<p id="big" style="position:absolute; left:1200px; top:100px; width:300px; font-size:32px; transform:scale(2)">Big</p>
<div id="zoom" style="position:absolute; left:1200px; top:600px; width:300px; height:100px; transform:scale(1.5)"><p id="small" style="font-size:32px">Inner</p></div>
</section>`,
});

test('transforms: scaled text at its drawn size; pictures of translated, scaled and grouped-and-rotated elements whole', async () => {
  test.setTimeout(180_000);
  const page = await ready();
  const { id, held } = await seedDeck(page, 'Transforms', TRANSFORMED());
  expect(held).toEqual([]);
  const zip = await JSZip.loadAsync(readFileSync((await exportAs(page, id, 'pptx')).path));
  const xml = await slideXml(zip, 1);
  const shape = (name: string) => xml.split(/<p:(?:sp|pic)>/).find((part) => part.includes(`name="${name}"`))!;
  // text: 32 px under scale(2) is seen at 64 px (32 pt); under an ancestor's scale(1.5) at 48 px (24 pt)
  expect(/ sz="(\d+)"/.exec(shape('big'))![1]).toBe('3200');
  expect(offsetOf(xml, 'big')![2]).toBe(600 * EMU);
  expect(/ sz="(\d+)"/.exec(shape('small'))![1]).toBe('2400');
  // pictures: placed at the drawn box (the translated one centred on 960; the scaled one 300 × 150; the member turned 30°)
  expect(offsetOf(xml, 'moved')).toEqual([860 * EMU, 100 * EMU, 200 * EMU, 100 * EMU]);
  expect(offsetOf(xml, 'grown')!.slice(2)).toEqual([300 * EMU, 150 * EMU]);
  expect(shape('member')).toContain('rot="1800000"');
  // and each picture (the SVG's PNG fallback the window drew) is the element alone, green to its corners
  const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string');
  const pictureOf = async (name: string) => {
    const rId = /<a:blip r:embed="(rId\d+)"/.exec(shape(name))![1];
    const target = new RegExp(`Id="${rId}"[^>]*Target="\\.\\./media/([^"]+)"`).exec(rels)![1]!;
    return zip.file(`ppt/media/${target}`)!.async('base64');
  };
  const sample = (png: string) =>
    launch!.app.evaluate(({ nativeImage }, b64) => {
      const image = nativeImage.createFromBuffer(Buffer.from(b64, 'base64'));
      const { width, height } = image.getSize();
      const bitmap = image.toBitmap(); // BGRA
      const at = (x: number, y: number) => {
        const i = (Math.round(y) * width + Math.round(x)) * 4;
        return [bitmap[i + 2]!, bitmap[i + 1]!, bitmap[i]!, bitmap[i + 3]!];
      };
      return { width, height, points: [at(3, 3), at(width - 4, 3), at(width / 2, height / 2), at(3, height - 4), at(width - 4, height - 4)] };
    }, png);
  for (const name of ['moved', 'grown', 'member']) {
    const samples = await sample(await pictureOf(name));
    expect(samples.width, name).toBeGreaterThanOrEqual(198);
    for (const [r, g, b, a] of samples.points) expect([r, g > 230, b, a > 230], `${name} is green to its corners`).toEqual([expect.any(Number), true, expect.any(Number), true]);
    for (const [r, , b] of samples.points) expect(r + b, name).toBeLessThan(30);
  }
  // fix wave 2 (finding 1): a centred element wider than the slide's right half is taken whole, red on its left, blue on
  // its right (a picture of its right part alone, stretched, would be red to both edges or cut short)
  const wide = await sample(await pictureOf('wide'));
  expect(wide.width).toBeGreaterThanOrEqual(1660);
  const [left, , , , right] = wide.points as [number[], number[], number[], number[], number[]];
  expect([left[0]! > 200, left[2]! < 60], 'red at its left edge').toEqual([true, true]);
  expect([right[2]! > 200, right[0]! < 60], 'blue at its right edge').toEqual([true, true]);

  // fix wave 2 (finding 2): For Claude lowers the turned group; its auto-sized member is placed from the window's measure
  const claude = await JSZip.loadAsync(readFileSync((await exportAs(page, id, 'claude')).path));
  const lowered = await claude.file('project/slides/s1.html')!.async('string');
  expect(lowered).not.toContain('id="grp"');
  expect(lowered).toMatch(/<p id="label" style="[^"]*width:\d+(\.\d+)?px[^"]*transform:rotate\(30deg\)/);
  const back = await seedDeck(page, 'Transforms read back', { 'project/deck.json': await claude.file('project/deck.json')!.async('string'), 'project/slides/s1.html': lowered });
  expect(back.held).toEqual([]);
});

/** Each point's [r, g, b, a] in a PNG, read by main's nativeImage. */
const pixelsOf = (png: Buffer, points: [number, number][]) =>
  launch!.app.evaluate(({ nativeImage }, [b64, at]) => {
    const image = nativeImage.createFromBuffer(Buffer.from(b64, 'base64'));
    const { width } = image.getSize();
    const bitmap = image.toBitmap(); // BGRA
    return at.map(([x, y]) => {
      const i = (Math.round(y) * width + Math.round(x)) * 4;
      return [bitmap[i + 2]!, bitmap[i + 1]!, bitmap[i]!, bitmap[i + 3]!];
    });
  }, [png.toString('base64'), points] as const);
const colourOf = ([r, g, b]: number[]) => (r! > 200 && g! < 60 && b! < 60 ? 'red' : r! < 60 && g! > 200 && b! < 60 ? 'green' : r! < 60 && g! < 60 && b! > 200 ? 'blue' : r! > 230 && g! > 230 && b! > 230 ? 'white' : `rgb(${r}, ${g}, ${b})`);

// P4 (the collapsed-table row): the probe of what Chromium draws for a collapsed table (the canvas's `border-collapse:
// collapse`) with a 16 px border, a radius and a shadow, on the export window's own page (the slide's PNG), recorded as
// evidence, and the PPTX that matches it: the whole outer border lies inside the measured box (none of it outside, so
// the outline keeps its half-width inset) and its corners are square, while the background and the shadow are rounded.
const TABLES = (): Record<string, string> => ({
  'project/deck.json': JSON.stringify({ v: 4, title: 'Tables', cover: 's1', order: ['s1'] }),
  'project/slides/s1.html': `<section id="s1" style="background:#ffffff">
<table id="thick" style="position:absolute; left:200px; top:200px; border:16px solid #ff0000; border-radius:40px; background:#0000ff; box-shadow:12px 12px 0 #00ff00; font-size:28px"><tr id="a1"><td>North</td><td>12</td></tr><tr id="a2"><td>South</td><td>34</td></tr></table>
<table id="thin" style="position:absolute; left:900px; top:200px; border:4px solid #ff0000; border-radius:40px; background:#0000ff; font-size:28px"><tr id="b1"><td>North</td><td>12</td></tr><tr id="b2"><td>South</td><td>34</td></tr></table>
</section>`,
});

test('a collapsed table: its border inside its box and square, its background and shadow rounded, in the canvas and the PPTX', async () => {
  test.setTimeout(120_000);
  const page = await ready();
  const { id, held } = await seedDeck(page, 'Tables', TABLES());
  expect(held).toEqual([]);
  const xml = await slideXml(await JSZip.loadAsync(readFileSync((await exportAs(page, id, 'pptx')).path)), 1);
  const part = (name: string) => xml.split(/<p:sp>/).find((p) => p.includes(`name="${name}"`))!;
  // the measured box: the fill's place (the whole box)
  const boxOf = (name: string) => {
    const [x, y, w, h] = offsetOf(xml, `${name}:fill`)!.map((n) => n / EMU) as [number, number, number, number];
    return { x, y, w, h };
  };
  const thick = boxOf('thick');
  const thin = boxOf('thin');
  const midThick = thick.y + thick.h / 2;
  const points: Record<string, [number, number]> = {
    'thick: 2 px outside its left edge': [thick.x - 2, midThick],
    'thick: 1 px inside its left edge': [thick.x + 1, midThick],
    'thick: 14 px inside its left edge': [thick.x + 14, midThick],
    'thick: 18 px inside its left edge': [thick.x + 18, midThick],
    'thick: its corner, 2 px in': [thick.x + 2, thick.y + 2],
    'thick: 6 px right of its right edge': [thick.x + thick.w + 6, midThick],
    'thick: 9 px past its bottom-right corner': [thick.x + thick.w + 9, thick.y + thick.h + 9],
    'thin: its corner, 1 px in': [thin.x + 1, thin.y + 1],
    'thin: 7 px in from its corner': [thin.x + 7, thin.y + 7],
    'thin: 6 px inside its left edge': [thin.x + 6, thin.y + thin.h / 2],
  };
  const png = readFileSync((await exportAs(page, id, 'png')).path);
  const seen = Object.fromEntries((await pixelsOf(png, Object.values(points))).map((rgba, i) => [Object.keys(points)[i]!, colourOf(rgba)]));
  const versions = await launch!.app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome }));
  const probe = { ...versions, boxes: { thick, thin }, seen };
  console.log(`[collapsed-table probe] ${JSON.stringify(probe)}`);
  await test.info().attach('collapsed-table-probe.json', { body: JSON.stringify(probe, null, 2), contentType: 'application/json' });
  expect(seen).toEqual({
    // nothing of the border outside the box; all 16 px of it inside; the background after it
    'thick: 2 px outside its left edge': 'white',
    'thick: 1 px inside its left edge': 'red',
    'thick: 14 px inside its left edge': 'red',
    'thick: 18 px inside its left edge': 'blue',
    // the border's corner square, under a 40 px radius
    'thick: its corner, 2 px in': 'red',
    // the shadow at 12 px, its corner rounded by the radius (12 + 40 px about the corner's centre)
    'thick: 6 px right of its right edge': 'green',
    'thick: 9 px past its bottom-right corner': 'white',
    // a 4 px border: square at the corner, the background inside it rounded
    'thin: its corner, 1 px in': 'red',
    'thin: 7 px in from its corner': 'white',
    'thin: 6 px inside its left edge': 'blue',
  });
  // the PPTX: the outline a square rectangle whose 16 px stroke runs from the box's edge inward (its path 8 px in), the
  // fill and the shadow under the table a rounded rectangle at the box
  expect(part('thick:border')).toContain('prst="rect"');
  expect(offsetOf(xml, 'thick:border')).toEqual([(thick.x + 8) * EMU, (thick.y + 8) * EMU, (thick.w - 16) * EMU, (thick.h - 16) * EMU].map(Math.round));
  expect(part('thick:fill')).toContain('prst="roundRect"');
  expect(part('thin:border')).toContain('prst="rect"');
});

// P4 (the skewed-element row): a skew, its own or a group's, has no native PowerPoint form: the element, and a skewed
// group's members with their connector, are the window's pictures of them as drawn, placed unturned at the box each is
// drawn in; a turn alone keeps its native object.
const SKEWED = (): Record<string, string> => ({
  'project/deck.json': JSON.stringify({ v: 4, title: 'Skews', cover: 's1', order: ['s1', 's2'] }),
  'project/slides/s1.html': `<section id="s1" style="background:#ffffff">
<div id="lean" style="position:absolute; left:200px; top:200px; width:200px; height:100px; background:#00ff00; transform:skewX(30deg)"></div>
<div id="tilt" data-group="" style="position:absolute; left:800px; top:200px; width:300px; height:200px; transform:skewY(20deg)"><x-connector id="wire" x1="0" y1="100" x2="300" y2="100"></x-connector><p id="word" style="position:absolute; left:20px; top:20px; font-size:28px">Lean</p></div>
<div id="plain" style="position:absolute; left:200px; top:600px; width:200px; height:100px; background:#00ff00; transform:rotate(30deg)"></div>
<div id="cast" style="position:absolute; left:1300px; top:150px; width:200px; height:100px; background:#00ff00; box-shadow:0 40px 0 #0000ff; transform:skewX(30deg)"></div>
<div id="wrap" style="width:500px"><div id="pin" style="position:absolute; left:50%; top:800px; width:200px; height:100px; background:#ff8800; transform:skewX(30deg)"></div></div>
</section>`,
  'project/slides/s2.html': `<section id="s2" style="background:#ffffff; transform:translate(300px, 0px)">
<div id="moved" style="position:absolute; left:200px; top:200px; width:200px; height:100px; background:#ff00ff; transform:skewX(30deg)"></div>
</section>`,
});

test('a skewed element and a skewed group’s members export as pictures of them as drawn', async () => {
  test.setTimeout(120_000);
  const page = await ready();
  const { id, held } = await seedDeck(page, 'Skews', SKEWED());
  expect(held).toEqual([]);
  const zip = await JSZip.loadAsync(readFileSync((await exportAs(page, id, 'pptx')).path));
  const xml = await slideXml(zip, 1);
  const part = (name: string) => xml.split(/(?=<p:(?:sp|pic)>)/).find((p) => p.includes(`name="${name}"`));
  // the skewed box, the group's connector and its text: pictures; the turned box its native shape; the unpainted group nothing
  expect(['lean', 'wire', 'word', 'plain', 'tilt', 'cast', 'pin', 'wrap'].map((name) => /^<p:(sp|pic)>/.exec(part(name) ?? '')?.[1] ?? null)).toEqual(['pic', 'pic', 'pic', 'sp', null, 'pic', 'pic', null]);
  expect(part('plain')).toContain('rot="1800000"');
  expect(part('lean')).not.toMatch(/ rot="/);
  // at the box skewX(30deg) draws the 200 × 100 box in: 200 + 100·tan 30° ≈ 257.7 px across, from 300 − 128.9 ≈ 171.1
  const [x, y, w, h] = offsetOf(xml, 'lean')!.map((n) => n / EMU) as [number, number, number, number];
  expect([Math.abs(x - 171.13) < 1, y, Math.abs(w - 257.74) < 1, h]).toEqual([true, 200, true, 100]);
  // its picture leans: its top-left and bottom-right corners green, the other two see-through (an unskewed box's picture
  // would be green to all four)
  const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string');
  const pictureOf = async (name: string) => {
    const rId = /<a:blip r:embed="(rId\d+)"/.exec(part(name)!)![1];
    const target = new RegExp(`Id="${rId}"[^>]*Target="\\.\\./media/([^"]+)"`).exec(rels)![1]!;
    const png = Buffer.from(await zip.file(`ppt/media/${target}`)!.async('uint8array'));
    return { png, size: pngSize(png) as [number, number] };
  };
  const lean = await pictureOf('lean');
  const [pw, ph] = lean.size;
  expect(pw).toBeGreaterThanOrEqual(255);
  // 8 px in across, 4 px down: each sample at least 5 px from a slanted edge (at 4 px down the edges run 2.3 px in)
  const [topLeft, topRight, bottomLeft, bottomRight, centre] = await pixelsOf(lean.png, [[8, 4], [pw - 8, 4], [8, ph - 4], [pw - 8, ph - 4], [pw / 2, ph / 2]]);
  const green = ([r, g, b, a]: number[]) => r! < 60 && g! > 200 && b! < 60 && a! > 200;
  const clear = (rgba: number[]) => rgba[3]! < 30;
  expect([green(topLeft!), clear(topRight!), clear(bottomLeft!), green(bottomRight!), green(centre!)]).toEqual([true, true, true, true, true]);

  // the review's findings. A shadow past the border box is in the picture: the region widened by the shadow's 40 px as
  // the lean carries it (63 px across, 40 down, each side), so 180 px tall, the shadow below the box and leaning with it
  const cast = await pictureOf('cast');
  const [cw, ch] = cast.size;
  expect(ch).toBeGreaterThanOrEqual(170);
  const [shadow] = await pixelsOf(cast.png, [[cw / 2 + 40, ch / 2 + 70]]);
  expect([shadow![0]! < 60, shadow![1]! < 60, shadow![2]! > 200, shadow![3]! > 200], 'blue: the shadow below the box').toEqual([true, true, true, true]);
  // a pinned skewed box in a static flow wrapper is taken where the slide draws it, whole (moving the wrapper would have
  // made it the box's containing block, laying it out elsewhere)
  const pin = await pictureOf('pin');
  expect(offsetOf(xml, 'pin')!.map((n) => Math.round(n / EMU))).toEqual([931, 800, 258, 100]);
  expect(pin.size[0]).toBeGreaterThanOrEqual(255);
  const [orange] = await pixelsOf(pin.png, [[pin.size[0] / 2, pin.size[1] / 2]]);
  expect([orange![0]! > 200, orange![1]! > 100 && orange![1]! < 170, orange![2]! < 60, orange![3]! > 200], 'orange at its centre').toEqual([true, true, true, true]);

  // the re-review's: a slide whose section carries a translate of its own draws the element 300 px off the region the
  // measure gives in slide px; the window takes it where it is drawn, so its picture is the box, not empty
  const xml2 = await slideXml(zip, 2);
  const moved = xml2.split(/(?=<p:(?:sp|pic)>)/).find((p) => p.includes('name="moved"'))!;
  expect(moved.startsWith('<p:pic>')).toBe(true);
  const rels2 = await zip.file('ppt/slides/_rels/slide2.xml.rels')!.async('string');
  const rId2 = /<a:blip r:embed="(rId\d+)"/.exec(moved)![1];
  const target2 = new RegExp(`Id="${rId2}"[^>]*Target="\\.\\./media/([^"]+)"`).exec(rels2)![1]!;
  const movedPng = Buffer.from(await zip.file(`ppt/media/${target2}`)!.async('uint8array'));
  const [mw, mh] = pngSize(movedPng) as [number, number];
  const [magenta] = await pixelsOf(movedPng, [[mw / 2, mh / 2]]);
  expect([magenta![0]! > 200, magenta![1]! < 60, magenta![2]! > 200, magenta![3]! > 200], 'magenta at its centre').toEqual([true, true, true, true]);
});

// S7b's 100-slide deck inside the export's 55 s budget, in the variants that take the most from the window (the load
// average beside each time, as the scale gate records its bounds)
test('the 100-slide deck exports to PPTX, named and as pictures, and to PDF within the budget', async () => {
  test.setTimeout(300_000);
  const page = await ready();
  const { id, held } = await seedDeck(page, 'Bench', benchDeckFiles(100));
  expect(held).toEqual([]);
  const times: string[] = [];
  for (const [format, extra] of [['pptx', {}], ['pptx', { fonts: 'pictures' }], ['pdf', {}]] as const) {
    const started = Date.now();
    const { path } = await exportAs(page, id, format, extra);
    times.push(`${format}${'fonts' in extra ? `/${extra.fonts}` : ''} ${Date.now() - started} ms`);
    if (format === 'pptx') expect(Object.keys((await JSZip.loadAsync(readFileSync(path))).files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))).toHaveLength(100);
  }
  console.log(`[100-slide export] ${times.join(', ')} at load ${loadavg()[0]!.toFixed(1)}`);
});

test('the export entries under Deck actions save each format where the owner chooses', async () => {
  test.setTimeout(240_000);
  scratch = mkdtempSync(join(tmpdir(), 'maws-e2e-deck-export-'));
  const saved = join(scratch, 'saved');
  mkdirSync(saved);
  const page = await ready({ MAWS_E2E_SAVE_PATH: saved });
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
  exportMenuTrace = true;
  const id = await createDeck(page, 'Quarterly', DECK);
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: 'Quarterly', exact: true }).click();
  const tab = page.locator(`[data-region="main"] [data-artifact-tab="${id}"]`);
  await expect(tab.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  const toolbar = tab.locator('.deck-toolbar [data-editor-toolbar]');
  const pick = async (label: string) => {
    await toolbar.getByRole('button', { name: 'Deck actions', exact: true }).click();
    if (['Fonts by name', 'Basic fonts (default)', 'Slides as pictures'].includes(label)) await page.getByRole('menuitem', { name: 'PowerPoint', exact: true }).click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
  };
  const savedFile = (name: string) => join(saved, name);
  const appears = (name: string, check: (bytes: Buffer) => boolean) =>
    expect.poll(() => (existsSync(savedFile(name)) ? check(readFileSync(savedFile(name))) : false), { timeout: 60_000, message: `${name} saved` }).toBe(true);
  const isZip = (bytes: Buffer) => bytes.subarray(0, 2).toString('latin1') === 'PK';

  await toolbar.getByRole('button', { name: 'Deck actions', exact: true }).click();
  await expect(page.getByRole('menu').getByRole('group').getByRole('menuitem')).toHaveText(['PowerPoint›', 'PDF', 'HTML (one page)', 'For Claude (zip)', 'PNG (all slides)']);
  await page.keyboard.press('Escape');

  await pick('Fonts by name');
  await appears('Quarterly.pptx', isZip);
  expect(namesIn(await slideXml(await JSZip.loadAsync(readFileSync(savedFile('Quarterly.pptx'))), 1))).toContain('title');
  await expect(page.getByRole('region', { name: /^Notifications/ }).getByText(`Saved to ${savedFile('Quarterly.pptx')}`).first()).toBeVisible();
  rmSync(savedFile('Quarterly.pptx'));
  await pick('Slides as pictures');
  await appears('Quarterly.pptx', isZip);
  expect((await slideXml(await JSZip.loadAsync(readFileSync(savedFile('Quarterly.pptx'))), 1)).split('<p:pic>').length - 1).toBe(1);
  await pick('PDF');
  await appears('Quarterly.pdf', (bytes) => bytes.subarray(0, 5).toString('latin1') === '%PDF-');
  await pick('HTML (one page)');
  await appears('Quarterly.html', (bytes) => bytes.toString('utf8').includes('class="maws-slide"'));
  await pick('For Claude (zip)');
  await appears('Quarterly.zip', isZip);
  await pick('PNG (all slides)');
  const images = ['slide-01.png', 'slide-02.png', 'slide-03.png'];
  for (const name of images) await appears(`Quarterly slides/${name}`, (bytes) => bytes.length > 24 && pngSize(bytes).join('x') === '1920x1080');
  expect(new Set(images.map((name) => readFileSync(savedFile(`Quarterly slides/${name}`)).toString('base64'))).size).toBe(3);
});

// ---- P4-B2 D19: a named Google Fonts face, fetched once and drawn offline ----

const GOOGLE_FONTS = join(REPO_ROOT, 'e2e/fixtures/google-fonts');
const SLAB_REQUEST = 'https://fonts.googleapis.com/css2?family=Roboto+Slab';
const SLAB_REFUSAL = 'Roboto Slab is Apache-2.0 on Google Fonts; MAWS fetches only OFL faces, so it draws as its fallback; upload a font file to use it';
const FACES_DECK: Record<string, string> = {
  'project/deck.json': JSON.stringify({
    v: 4,
    title: 'Faces',
    cover: 'cover',
    order: ['cover'],
    faces: { lora: { family: 'Lora', href: 'https://fonts.googleapis.com/css2?family=Lora&display=swap' }, 'roboto-slab': { family: 'Roboto Slab', href: SLAB_REQUEST } },
  }),
  'project/slides/cover.html': `<section id="cover" style="background:#ffffff; color:#1a1a1a; padding:128px; gap:40px">
<h1 id="title" style="font-size:120px; font-family:Lora, serif">Handgloves, quickly</h1>
<p id="slab" style="font-size:60px; font-family:'Roboto Slab', serif">A refused face</p></section>`,
};

/** How a drawn text element sets: its first family, whether `document.fonts` holds that family loaded, and the width of
 * its text in its own stack and in the bare fallback. */
const setting = (node: Locator) =>
  node.evaluate(async (el) => {
    const stack = getComputedStyle(el).fontFamily;
    const first = stack.split(',')[0]!.trim().replace(/^["']|["']$/g, '');
    await document.fonts.load(`120px "${first}"`, el.textContent ?? '');
    const width = (family: string) => {
      const probe = document.createElement('span');
      probe.style.cssText = `position:absolute; visibility:hidden; white-space:nowrap; font-size:120px; font-family:${family}`;
      probe.textContent = el.textContent;
      document.body.appendChild(probe);
      const w = probe.getBoundingClientRect().width;
      probe.remove();
      return w;
    };
    let loaded = false;
    document.fonts.forEach((face) => void (loaded ||= face.family.replace(/["']/g, '') === first && face.status === 'loaded'));
    return { first, loaded, drawn: width(stack), fallback: width('serif') };
  });

test('a named Google Fonts face with no network: Lora fetched once and drawn offline in the editor, the presenter and the three exports; Roboto Slab refused by name', async () => {
  test.setTimeout(240_000);
  const page = await ready({ MAWS_GOOGLE_FONTS_FIXTURES: GOOGLE_FONTS, MAWS_PRESENTATIONS_SCALE: '1' });
  const app = launch!.app;
  const { id, held } = await seedDeck(page, 'Faces', FACES_DECK);
  expect(held).toEqual([]);

  // the host's record lands after the seed's commit: Lora saved under OFL with its licence, Roboto Slab refused by its own
  const deckJson = async () => JSON.parse((await page.evaluate((a) => (window as unknown as Seam).__maws_presentations.files(a), id))['project/deck.json']!) as { faces: Record<string, { google?: Record<string, unknown> }> };
  await expect.poll(async () => (await deckJson()).faces.lora!.google?.licence, { timeout: 20_000, message: 'the host saved Lora into the deck' }).toBe('OFL');
  const { faces } = await deckJson();
  expect(faces.lora!.google).toEqual({ request: 'https://fonts.googleapis.com/css2?family=Lora', licence: 'OFL', licenceSrc: 'assets/gf-lora-OFL.txt', files: [{ src: 'assets/gf-lora-400.woff2', weight: '400', style: 'normal' }] });
  await expect.poll(async () => (await deckJson()).faces['roboto-slab']!.google, { timeout: 20_000 }).toEqual({ request: SLAB_REQUEST, refused: 'Apache-2.0' });

  // the agent's read names the refusal, and says nothing of the saved face
  const seam = new PerfSeam(join(launch!.userData, 'presentations-scale'));
  await expect.poll(() => existsSync(join(seam.dir, 'in')), { timeout: 10_000, message: 'the host started the deck scale seam' }).toBe(true);
  const read = await seam.call<{ warnings?: { property?: string; message: string }[] }>('e2e-agent', 'artifact_read', { artifact: id });
  expect(read.isError).toBe(false);
  const faceWarnings = (read.result?.warnings ?? []).filter((w) => w.property?.startsWith('faces.'));
  expect(faceWarnings).toEqual([expect.objectContaining({ property: 'faces.roboto-slab', message: SLAB_REFUSAL })]);

  // the editor: the face from the deck's assets under its private name, loaded, setting the text apart from the fallback
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: 'Faces', exact: true }).click();
  const tab = page.locator(`[data-region="main"] [data-artifact-tab="${id}"]`);
  await expect(tab.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  const inEditor = await setting(tab.locator('[data-stage-slide] [data-eid="title"]'));
  expect(inEditor.first).toMatch(/^deck-face-/);
  expect(inEditor.loaded).toBe(true);
  expect(Math.abs(inEditor.drawn - inEditor.fallback)).toBeGreaterThan(2);

  // Deck actions ▸ Theme ▸ Faces: each face with its state, Roboto Slab refused by name
  const toolbar = tab.locator('.deck-toolbar [data-editor-toolbar]');
  await toolbar.getByRole('button', { name: 'Deck actions', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Theme', exact: true }).click();
  const theme = tab.locator('[data-deck-rail="theme"]');
  await expect(theme.locator('[data-face="lora"]')).toHaveAttribute('data-face-state', 'saved');
  await expect(theme.locator('[data-face="lora"]')).toContainText('Lora');
  await expect(theme.locator('[data-face="roboto-slab"]')).toHaveAttribute('data-face-state', 'refused');
  await expect(theme.locator('[data-face="roboto-slab"]')).toContainText(SLAB_REFUSAL);

  // the presenter: the audience window declares the face under its own name, loaded from the deck's assets
  await toolbar.getByRole('button', { name: 'Present', exact: true }).click();
  const audiencePage = () => app.windows().find((w) => w.url().includes('present=1') && w.url().includes('role=audience'));
  await expect.poll(() => audiencePage() !== undefined, { timeout: 15_000, message: 'the audience window opened' }).toBe(true);
  const audience = audiencePage()!;
  const shown = audience.locator('[data-present-view="audience"] .present-layer:last-of-type [data-eid="title"]');
  await expect(shown).toBeVisible({ timeout: 15_000 });
  const presented = await setting(shown);
  expect(presented.first).toBe('Lora');
  expect(presented.loaded).toBe(true);
  expect(Math.abs(presented.drawn - presented.fallback)).toBeGreaterThan(2);
  // Escape ends the show: the window closes on the key's down, before its up, so a press that finds its page closed has
  // done its work (presentations-present.spec.ts's way); the window is open until the press
  expect(audience.isClosed(), 'the audience window still open before Escape').toBe(false);
  await audience.keyboard.press('Escape').catch((error: unknown) => {
    if (!/has been closed/.test(String(error))) throw error;
  });
  await expect.poll(() => app.windows().filter((w) => w.url().includes('present=1')).length, { timeout: 10_000 }).toBe(0);

  // the exports: the HTML inlines the fetched file as its face, the PDF embeds Lora, the PPTX names it
  const html = readFileSync((await exportAs(page, id, 'html')).path, 'utf8');
  const woff2 = readFileSync(join(GOOGLE_FONTS, 'lora-400.woff2')).toString('base64');
  expect(html).toContain(`data:font/woff2;base64,${woff2}`);
  expect(html).toMatch(/@font-face\s*\{[^}]*font-family:\s*"Lora"[^}]*data:font\/woff2/);
  const pdf = readFileSync((await exportAs(page, id, 'pdf')).path).toString('latin1');
  // Skia/PDF writes a web face as a Type 3 font (its glyphs' outlines, with a ToUnicode map), whose dictionary has no
  // /BaseFont; its name is in its descriptor, where an embedded TrueType face carries it too
  expect(pdf).toMatch(/\/FontName\s*\/(?:[A-Z]{6}\+)?Lora/);
  const pptx = await JSZip.loadAsync(readFileSync((await exportAs(page, id, 'pptx', { fonts: 'named' })).path));
  expect(typefaces(await slideXml(pptx, 1))).toContain('Lora');
});

// ---- the LibreOffice render-and-compare ----

/** A PDF's page rasterized at `w`×`h` by pdftoppm, as RGB bytes. */
function rasterize(pdf: string, pageNo: number, w: number, h: number): { w: number; h: number; rgb: Buffer } {
  const ppm = execFileSync(join(POPPLER, 'pdftoppm'), ['-f', String(pageNo), '-l', String(pageNo), '-scale-to-x', String(w), '-scale-to-y', String(h), pdf], { maxBuffer: 64 * 1024 * 1024 });
  // P6\n<w> <h>\n255\n<rgb…>
  let at = 0;
  const fields: string[] = [];
  while (fields.length < 4) {
    while (/\s/.test(String.fromCharCode(ppm[at]!))) at++;
    let field = '';
    while (!/\s/.test(String.fromCharCode(ppm[at]!))) field += String.fromCharCode(ppm[at++]!);
    fields.push(field);
  }
  return { w: Number(fields[1]), h: Number(fields[2]), rgb: ppm.subarray(at + 1) };
}
const pixelAt = (image: { w: number; rgb: Buffer }, x: number, y: number) => {
  const i = (y * image.w + x) * 3;
  return [image.rgb[i]!, image.rgb[i + 1]!, image.rgb[i + 2]!];
};
/** The mean absolute difference per channel of two images of one size, in 0…1. */
function meanDifference(a: { rgb: Buffer }, b: { rgb: Buffer }): number {
  let sum = 0;
  const n = Math.min(a.rgb.length, b.rgb.length);
  for (let i = 0; i < n; i++) sum += Math.abs(a.rgb[i]! - b.rgb[i]!);
  return sum / n / 255;
}
/** Each page's words with their boxes in slide px (a page is the slide's 1920 px across). */
function wordsOf(pdf: string): Word[][] {
  const out = execFileSync(join(POPPLER, 'pdftotext'), ['-bbox', pdf, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('<page ').slice(1).map((page) => {
    const width = Number(/width="([\d.]+)"/.exec(page)![1]);
    const k = 1920 / width;
    return [...page.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((m) => ({ text: m[5]!, x0: Number(m[1]) * k, y0: Number(m[2]) * k, x1: Number(m[3]) * k, y1: Number(m[4]) * k }));
  });
}

/** One text box as the app's own canvas draws it: the union of its line boxes in slide px, its text and its face. */
type CanvasText = { id: string; ink: Extent; text: string; rotated: number; face: string; drawn: string; weight: number; numeric: string };

/**
 * The app's own render of each slide (Decision Log 23): the deck in a main tab, each slide brought to the stage, its
 * `SlideCanvas` (the `.maws-slide` the stage scales) captured from the window at 480 × 270 and its text boxes read, in
 * slide px, from the same canvas.
 */
async function canvasRenders(page: Page, title: string, artifactId: string, ids: readonly string[]): Promise<Map<string, { pixels: { rgb: Buffer }; texts: CanvasText[] }>> {
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click();
  const tab = page.locator(`[data-region="main"] [data-artifact-tab="${artifactId}"]`);
  await expect(tab.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  const out = new Map<string, { pixels: { rgb: Buffer }; texts: CanvasText[] }>();
  for (const id of ids) {
    await tab.locator(`[data-slide-thumb="${id}"]`).click();
    const canvas = tab.locator(`[data-stage-slide="${id}"] .maws-slide`);
    await expect(canvas).toBeVisible();
    await page.mouse.move(0, 0); // no hover outline on the stage
    const read = await canvas.evaluate(async (slide) => {
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const o = slide.getBoundingClientRect();
      const k = o.width / 1920;
      const ctx = document.createElement('canvas').getContext('2d')!;
      const SAMPLE = 'mmmmmmmmmmlli1WQ@#';
      const width = (font: string) => {
        ctx.font = `72px ${font}`;
        return ctx.measureText(SAMPLE).width;
      };
      const installed = (family: string) => ['monospace', 'serif', 'sans-serif'].some((generic) => width(`"${family}", ${generic}`) !== width(generic));
      const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|-apple-system|blinkmacsystemfont)$/i;
      const stack = (value: string) => value.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      // the angle its own and its ancestors' transforms turn it by (degrees; 0 unturned)
      const turned = (el: Element) => {
        let angle = 0;
        for (let at: Element | null = el; at && at !== slide; at = at.parentElement) {
          const t = getComputedStyle(at).transform;
          if (t && t !== 'none') {
            const m = new DOMMatrixReadOnly(t);
            angle += (Math.atan2(m.b, m.a) * 180) / Math.PI;
          }
        }
        return Math.abs(angle) < 0.01 ? 0 : angle;
      };
      const texts = Array.from(slide.querySelectorAll('h1[data-eid], h2[data-eid], h3[data-eid], p[data-eid], ul[data-eid], ol[data-eid], th[data-eid], td[data-eid]')).flatMap((el) => {
        const rects: DOMRect[] = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          rects.push(...Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0));
        }
        const text = (el.textContent ?? '').trim();
        if (!rects.length || !text) return [];
        const ink = [Math.min(...rects.map((r) => r.left)), Math.min(...rects.map((r) => r.top)), Math.max(...rects.map((r) => r.right)), Math.max(...rects.map((r) => r.bottom))].map((v, i) => (v - (i % 2 ? o.top : o.left)) / k);
        const families = stack(getComputedStyle(el).fontFamily);
        return [
          {
            id: (el as HTMLElement).dataset.eid ?? '',
            ink,
            text,
            rotated: turned(el),
            face: families.find((f) => !GENERIC.test(f)) ?? families[0] ?? '',
            drawn: families.find((f) => GENERIC.test(f) || installed(f)) ?? '',
            weight: Number(getComputedStyle(el).fontWeight),
            numeric: getComputedStyle(el).fontVariantNumeric,
          },
        ];
      });
      return { rect: { x: o.left, y: o.top, width: o.width, height: o.height }, texts };
    });
    const pixels = await launch!.app.evaluate(async ({ BrowserWindow }, rect) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!;
      const image = (await win.webContents.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) })).resize({ width: 480, height: 270, quality: 'best' });
      const bitmap = image.toBitmap(); // BGRA
      const out: number[] = new Array(480 * 270 * 3);
      for (let i = 0, j = 0; i < bitmap.length; i += 4, j += 3) [out[j], out[j + 1], out[j + 2]] = [bitmap[i + 2]!, bitmap[i + 1]!, bitmap[i]!];
      return out;
    }, read.rect);
    out.set(id, { pixels: { rgb: Buffer.from(pixels) }, texts: read.texts as CanvasText[] });
  }
  return out;
}

/** The faces a PDF embeds, by family (its subset prefix and style suffix dropped, spaces removed, lower case). */
function facesIn(pdf: string): Set<string> {
  const out = execFileSync(join(POPPLER, 'pdffonts'), [pdf], { encoding: 'utf8' });
  return new Set(
    out
      .split('\n')
      .slice(2)
      .map((line) => line.split(/\s+/)[0] ?? '')
      .filter(Boolean)
      .map((name) => name.replace(/^[A-Z]{6}\+/, '').replace(/[-,].*$/, '').toLowerCase()),
  );
}

test('the PPTX under LibreOffice draws each corpus slide as the app’s own canvas does', async () => {
  test.skip(SOFFICE === null, 'LibreOffice (soffice) is not installed here: the render-and-compare is the documented manual check and a tracker row (H3)');
  test.setTimeout(600_000);
  scratch = mkdtempSync(join(tmpdir(), 'maws-e2e-deck-lo-'));
  const page = await ready();
  // the corpus (Claude's examples, the default systems' layouts, S6's bench shapes; src/artifacts/slides/fixtures/corpus.ts
  // reads the same files through Vite) as one deck, the slides the loader holds (Claude's templates) left out
  const claudeDir = join(REPO_ROOT, 'src/artifacts/slides/fixtures/claude');
  const defaults = join(REPO_ROOT, 'src/artifacts/types/design_system/defaults');
  const all = [
    ...readdirSync(claudeDir).filter((f) => f.endsWith('.html')).sort().map((f) => ({ name: `claude/${f}`, html: readFileSync(join(claudeDir, f), 'utf8') })),
    ...readdirSync(defaults).sort().flatMap((key) => readdirSync(join(defaults, key, 'layouts')).sort().map((f) => ({ name: `layout/${key}/${f}`, html: readFileSync(join(defaults, key, 'layouts', f), 'utf8') }))),
    ...benchShapes.map((shape, i) => ({ name: `bench/${i + 1}`, html: shape(`b${i + 1}`, i) })),
    // a turned text box (judged by its centre) and a table in an installed face (its cells on four edges)
    {
      name: 'm9/turned',
      html: `<section id="turned" style="background:#ffffff; padding:128px; gap:32px">
<table id="grid" style="font-size:32px; font-family:Georgia, serif; color:#1a1a1a"><tr id="h" style="background:#eef2f1"><th>Region</th><th>Q1</th><th>Q2</th></tr><tr id="r1"><td>North</td><td>12</td><td>19</td></tr></table>
<p id="turn" style="position:absolute; left:700px; top:600px; width:800px; font-size:56px; font-family:Georgia, serif; color:#2b7a78; transform:rotate(-12deg)">A turned line of text</p>
</section>`,
    },
  ];
  const named = (slides: typeof all) => {
    const ids = slides.map((_, i) => `c${i}`);
    return { ids, files: { 'project/deck.json': JSON.stringify({ v: 4, title: 'Corpus', cover: ids[0], order: ids }), ...Object.fromEntries(slides.map((slide, i) => [`project/slides/${ids[i]}.html`, slide.html.replace(/^<section id="[^"]*"/m, `<section id="${ids[i]}"`)])) } };
  };
  const probe = await seedDeck(page, 'Corpus probe', named(all).files);
  const corpus = all.filter((_, i) => !probe.held.includes(`project/slides/c${i}.html`));
  expect(corpus.length).toBeGreaterThan(20);
  const { ids, files } = named(corpus);
  const { id, held } = await seedDeck(page, 'Corpus', files);
  expect(held).toEqual([]);
  const pptx = (await exportAs(page, id, 'pptx')).path;
  // LibreOffice with a profile of its own, never the owner's
  execFileSync(SOFFICE!, [`-env:UserInstallation=file://${join(scratch, 'lo-profile')}`, '--headless', '--convert-to', 'pdf', '--outdir', scratch, pptx], { timeout: 240_000, stdio: 'ignore' });
  const loPdf = join(scratch, `${/([^/]+)\.pptx$/.exec(pptx)![1]}.pdf`);
  expect(existsSync(loPdf)).toBe(true);
  expect(execFileSync(join(POPPLER, 'pdfinfo'), [loPdf], { encoding: 'utf8' })).toMatch(new RegExp(`Pages:\\s+${ids.length}\\n`));
  const renders = await canvasRenders(page, 'Corpus', id, ids);

  const loWords = wordsOf(loPdf);
  const loFaces = facesIn(loPdf);
  const report: string[] = [];
  const failures: string[] = [];
  let [compared, fourEdges, rotated] = [0, 0, 0];
  for (const [i, slide] of corpus.entries()) {
    const render = renders.get(ids[i]!)!;
    const diff = meanDifference(render.pixels, rasterize(loPdf, i + 1, 480, 270));
    report.push(`${slide.name}: ${diff.toFixed(3)}`);
    if (diff > 0.08) failures.push(`${slide.name}: mean difference ${diff.toFixed(3)} > 0.08`);
    // each text box (table cells too): its whole text present; its four edges within 24 px where LibreOffice has the
    // face and weight the app drew (regular or bold, no tabular figures), its left and top elsewhere (a substituted
    // face changes advance widths, not placement); a rotated box judged by its centre
    for (const text of render.texts) {
      compared++;
      // a turned box's pieces read along its angle; any other box's words, a run in the stream (support/text-run.ts)
      const lo = text.rotated ? wordsAlong(loWords[i]!, text.ink, text.text, text.rotated) : wordsOfBox(loWords[i]!, text.ink, text.text);
      if (!lo) {
        failures.push(`${slide.name} ${text.id}: LibreOffice drew no run of words holding the box's whole text “${normalized(text.text).slice(0, 60)}” (LibreOffice near it: ${loWords[i]!.filter((w) => w.y1 > text.ink[1] - 200 && w.y0 < text.ink[3] + 200).map((w) => `${w.text}@${w.x0.toFixed(0)},${w.y0.toFixed(0)}`).join(" ")})`);
        continue;
      }
      if (text.rotated) {
        rotated++;
        const centre = (b: Extent) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
        const off = Math.max(...centre(text.ink).map((v, k) => Math.abs(v - centre(lo.box)[k]!)));
        if (off > 24) failures.push(`${slide.name} ${text.id}: its centre is ${off.toFixed(1)} px from the canvas's`);
        continue;
      }
      const same = text.face === text.drawn && loFaces.has(text.face.replace(/\s+/g, '').toLowerCase()) && (text.weight === 400 || text.weight === 700) && text.numeric === 'normal';
      if (same) fourEdges++;
      const edges = same ? [0, 1, 2, 3] : [0, 1];
      const off = Math.max(...edges.map((k) => Math.abs(text.ink[k]! - lo.box[k]!)));
      if (off > 24) failures.push(`${slide.name} ${text.id}: its words' box is ${off.toFixed(1)} px from the canvas's (canvas ${text.ink.map((v) => v.toFixed(0)).join(',')}, LibreOffice ${lo.box.map((v) => v.toFixed(0)).join(',')}, face ${text.face} ${text.weight}, drawn ${text.drawn})`);
    }
  }
  // P3-F (scalpel-4#3): the per-slide report and the summary first, so a failing run keeps them beside its failures
  mkdirSync(test.info().outputDir, { recursive: true });
  writeFileSync(join(test.info().outputDir, 'libreoffice-compare.txt'), `${report.join('\n')}\n`);
  console.log(`[libreoffice compare] ${compared} text boxes (${fourEdges} on four edges, ${rotated} by their centre); mean difference per slide: ${report.join(', ')}`);
  expect(failures).toEqual([]);
  expect(compared).toBeGreaterThan(50);
  expect(rotated).toBeGreaterThan(0);
});
