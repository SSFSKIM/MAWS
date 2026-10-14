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
// The editor's Export menu (the X32 header in a main tab) saves each where the owner chooses (the e2e's folder).
// The LibreOffice render-and-compare (parent §4.8) runs where `soffice` is present, else it is skipped with its reason:
// the corpus as one deck exported to PPTX (`named`), converted by LibreOffice to PDF, both that and the app's own PDF
// rasterized by `pdftoppm` at 480×270, compared per slide (mean absolute difference per channel ≤ 0.08) and per text
// element (its words' bounding box in each, from `pdftotext -bbox`, within 24 slide px).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { benchShapes } from '../src/artifacts/slides/fixtures/bench';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
const invoke = <T>(page: Page, name: string, input?: unknown) =>
  page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const) as Promise<Result<T>>;
async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = await invoke<T>(page, name, input);
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}
interface Seam {
  __maws_presentations: { seed(artifactId: string, files: Record<string, string>): Promise<{ changed: string[]; held: string[] }> };
}

const SOFFICE = ['/opt/homebrew/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'].find((path) => existsSync(path)) ?? null;
const POPPLER = '/opt/homebrew/bin';

let launch: MawsLaunch | null = null;
let scratch: string | null = null;
test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
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

test('every format through the export service: PPTX in three variants, PDF, standalone HTML, For Claude, PNG', async () => {
  test.setTimeout(300_000);
  const page = await ready();
  const id = await createDeck(page, 'Quarterly', DECK);

  // ---- PPTX, faces named ----
  const named = await JSZip.loadAsync(readFileSync((await exportAs(page, id, 'pptx')).path));
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
  const basic = await JSZip.loadAsync(readFileSync((await exportAs(page, id, 'pptx', { fonts: 'basic' })).path));
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

test('the editor’s Export menu saves each format where the owner chooses', async () => {
  test.setTimeout(240_000);
  scratch = mkdtempSync(join(tmpdir(), 'maws-e2e-deck-export-'));
  const saved = join(scratch, 'saved');
  mkdirSync(saved);
  const page = await ready({ MAWS_E2E_SAVE_PATH: saved });
  const id = await createDeck(page, 'Quarterly', DECK);
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: 'Quarterly', exact: true }).click();
  const tab = page.locator(`[data-region="main"] [data-artifact-tab="${id}"]`);
  await expect(tab.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  const header = page.locator('[data-region="main"] [data-editor-header]');
  const pick = async (label: string) => {
    await header.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
  };
  const savedFile = (name: string) => join(saved, name);
  const appears = (name: string, check: (bytes: Buffer) => boolean) =>
    expect.poll(() => (existsSync(savedFile(name)) ? check(readFileSync(savedFile(name))) : false), { timeout: 60_000, message: `${name} saved` }).toBe(true);
  const isZip = (bytes: Buffer) => bytes.subarray(0, 2).toString('latin1') === 'PK';

  await expect(async () => {
    await header.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByRole('menuitem')).toHaveText(['PowerPoint (fonts by name)', 'PowerPoint (basic fonts)', 'PowerPoint (slides as pictures)', 'PDF', 'HTML (one page)', 'For Claude (zip)', 'PNG (cover slide)']);
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press('Escape');

  await pick('PowerPoint (fonts by name)');
  await appears('Quarterly.pptx', isZip);
  expect(namesIn(await slideXml(await JSZip.loadAsync(readFileSync(savedFile('Quarterly.pptx'))), 1))).toContain('title');
  await expect(page.getByRole('region', { name: /^Notifications/ }).getByText(`Saved to ${savedFile('Quarterly.pptx')}`).first()).toBeVisible();
  rmSync(savedFile('Quarterly.pptx'));
  await pick('PowerPoint (slides as pictures)');
  await appears('Quarterly.pptx', isZip);
  expect((await slideXml(await JSZip.loadAsync(readFileSync(savedFile('Quarterly.pptx'))), 1)).split('<p:pic>').length - 1).toBe(1);
  await pick('PDF');
  await appears('Quarterly.pdf', (bytes) => bytes.subarray(0, 5).toString('latin1') === '%PDF-');
  await pick('HTML (one page)');
  await appears('Quarterly.html', (bytes) => bytes.toString('utf8').includes('class="maws-slide"'));
  await pick('For Claude (zip)');
  await appears('Quarterly.zip', isZip);
  await pick('PNG (cover slide)');
  await appears('Quarterly.png', (bytes) => bytes.length > 24 && pngSize(bytes).join('x') === '1920x1080');
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
interface Word {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
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
// pdftotext writes a ligature as its one character
const unligature = (text: string) => text.replace(/\uFB00/g, 'ff').replace(/\uFB01/g, 'fi').replace(/\uFB02/g, 'fl').replace(/\uFB03/g, 'ffi').replace(/\uFB04/g, 'ffl').replace(/\s+/g, '');
/** The LibreOffice words that belong to a text: centre within its extent grown by `slack` px, text found in its text. */
function wordsBox(page: Word[], ink: [number, number, number, number], text: string, slack: number): [number, number, number, number] | null {
  const flat = unligature(text);
  const hits = page.filter((w) => w.text && flat.includes(unligature(w.text)) && (w.x0 + w.x1) / 2 >= ink[0] - slack && (w.x0 + w.x1) / 2 <= ink[2] + slack && (w.y0 + w.y1) / 2 >= ink[1] - slack && (w.y0 + w.y1) / 2 <= ink[3] + slack);
  if (!hits.length) return null;
  return [Math.min(...hits.map((w) => w.x0)), Math.min(...hits.map((w) => w.y0)), Math.max(...hits.map((w) => w.x1)), Math.max(...hits.map((w) => w.y1))];
}

/** Each slide's text elements as the app lays them out: the union of their line boxes (slide px) and their text. */
type AppText = { id: string; ink: [number, number, number, number]; text: string; face: string; drawn: string; weight: number; numeric: string };
async function appTexts(launched: MawsLaunch, htmlPath: string): Promise<Record<string, AppText[]>> {
  return launched.app.evaluate(async ({ BrowserWindow }, path) => {
    const win = new BrowserWindow({ show: false, width: 1920, height: 1080, webPreferences: { sandbox: true, partition: 'maws-e2e-standalone' } });
    try {
      await win.loadFile(path);
      return (await win.webContents.executeJavaScript(`(async () => {
        await document.fonts.ready;
        document.body.classList.remove('viewer'); // every slide at its size, one under another
        // which family of a stack the Mac draws: the first whose glyphs differ from a generic's (the usual detection);
        // a CSS generic, or a system alias, is drawn as itself
        const ctx = document.createElement('canvas').getContext('2d');
        const SAMPLE = 'mmmmmmmmmmlli1WQ@#';
        const width = (font) => { ctx.font = '72px ' + font; return ctx.measureText(SAMPLE).width; };
        const installed = (family) => ['monospace', 'serif', 'sans-serif'].some((generic) => width('"' + family + '", ' + generic) !== width(generic));
        const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|-apple-system|blinkmacsystemfont)$/i;
        const stack = (value) => value.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
        const out = {};
        for (const slide of document.querySelectorAll('section.maws-slide')) {
          const o = slide.getBoundingClientRect();
          out[slide.dataset.slide] = [...slide.querySelectorAll('h1[data-eid], h2[data-eid], h3[data-eid], p[data-eid], ul[data-eid], ol[data-eid]')].flatMap((el) => {
            if (getComputedStyle(el).transform !== 'none') return [];
            // the line boxes of its text nodes (an element's own box is not its text)
            const rects = [];
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              if (!node.textContent.trim()) continue;
              const range = document.createRange();
              range.selectNodeContents(node);
              rects.push(...[...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0));
            }
            const text = el.textContent.trim();
            if (!rects.length || !text) return [];
            const ink = [Math.min(...rects.map((r) => r.left)) - o.left, Math.min(...rects.map((r) => r.top)) - o.top, Math.max(...rects.map((r) => r.right)) - o.left, Math.max(...rects.map((r) => r.bottom)) - o.top];
            const families = stack(getComputedStyle(el).fontFamily);
            const face = families.find((f) => !GENERIC.test(f)) ?? families[0] ?? '';
            const drawn = families.find((f) => GENERIC.test(f) || installed(f)) ?? '';
            return [{ id: el.dataset.eid, ink, text, face, drawn, weight: Number(getComputedStyle(el).fontWeight), numeric: getComputedStyle(el).fontVariantNumeric }];
          });
        }
        return out;
      })()`)) as Record<string, AppText[]>;
    } finally {
      win.destroy();
    }
  }, htmlPath);
}

test('the PPTX under LibreOffice draws each corpus slide as the app does', async () => {
  test.skip(SOFFICE === null, 'LibreOffice (soffice) is not installed here: the render-and-compare is the documented manual check and a tracker row (H3)');
  test.setTimeout(420_000);
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
  const appPdf = (await exportAs(page, id, 'pdf')).path;
  const texts = await appTexts(launch!, (await exportAs(page, id, 'html')).path);
  // LibreOffice with a profile of its own, never the owner's
  execFileSync(SOFFICE!, [`-env:UserInstallation=file://${join(scratch, 'lo-profile')}`, '--headless', '--convert-to', 'pdf', '--outdir', scratch, pptx], { timeout: 240_000, stdio: 'ignore' });
  const loPdf = join(scratch, `${/([^/]+)\.pptx$/.exec(pptx)![1]}.pdf`);
  expect(existsSync(loPdf)).toBe(true);
  expect(execFileSync(join(POPPLER, 'pdfinfo'), [loPdf], { encoding: 'utf8' })).toMatch(new RegExp(`Pages:\\s+${ids.length}\\n`));

  const loWords = wordsOf(loPdf);
  const report: string[] = [];
  const failures: string[] = [];
  let compared = 0;
  let sameFace = 0;
  for (const [i, slide] of corpus.entries()) {
    const diff = meanDifference(rasterize(appPdf, i + 1, 480, 270), rasterize(loPdf, i + 1, 480, 270));
    report.push(`${slide.name}: ${diff.toFixed(3)}`);
    if (diff > 0.08) failures.push(`${slide.name}: mean difference ${diff.toFixed(3)} > 0.08`);
    // each text element: LibreOffice's words' box against the app's measured text box. Where the PPTX names the face the
    // app drew, in a weight it can say (regular or bold), every edge within 24 px; where it names another (the stack's
    // first face is not on this Mac, the app drew the system face, which Office cannot name, a medium or semibold
    // weight drawn regular or bold, or tabular figures, which Office cannot ask for), the text's width is that face's, so
    // its start (left, top) is held
    for (const text of texts[ids[i]!] ?? []) {
      const lo = wordsBox(loWords[i]!, text.ink, text.text, 24);
      const same = text.face === text.drawn && (text.weight === 400 || text.weight === 700) && text.numeric === 'normal';
      compared++;
      if (same) sameFace++;
      if (!lo) {
        failures.push(`${slide.name} ${text.id}: LibreOffice drew none of “${text.text.slice(0, 40)}” near the app's text`);
        continue;
      }
      const edges = same ? [0, 1, 2, 3] : [0, 1];
      const off = Math.max(...edges.map((k) => Math.abs(text.ink[k]! - lo[k]!)));
      if (off > 24) failures.push(`${slide.name} ${text.id}: its words' box is ${off.toFixed(1)} px from the app's text (app ${text.ink.map((v) => v.toFixed(0)).join(',')}, LibreOffice ${lo.map((v) => v.toFixed(0)).join(',')}, face ${text.face} ${text.weight}, drawn ${text.drawn})`);
    }
  }
  expect(compared).toBeGreaterThan(50);
  mkdirSync(test.info().outputDir, { recursive: true });
  writeFileSync(join(test.info().outputDir, 'libreoffice-compare.txt'), `${report.join('\n')}\n`);
  console.log(`[libreoffice compare] ${compared} text elements (${sameFace} in the face and weight the app drew); mean difference per slide: ${report.join(', ')}`);
  expect(failures).toEqual([]);
});
