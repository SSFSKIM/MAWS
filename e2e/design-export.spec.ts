// A design's export in the product build (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M5, acceptance 5;
// XE9 and the parent's Decision Logs 26 and 31; part of `pnpm e2e:design`). Every board carries a 40 px marker in each
// corner, each corner its own colour, so a crop, a clamp or a misplaced page shows as a wrong colour at a corner.
// - Through main's export service (`artifacts.export`, the Export menu's route): a PNG of a board at native size (its
//   manifest size, though its section's own style says otherwise) and at twice it; the poster taller than 8,192 px
//   refused `exportTooLarge` naming it, its size and the fitting scale, then exported at that scale whole; one PDF page
//   per board at its own size (a hidden board included), the markers at native positions; the named boards at half size,
//   in their order; a scale taking a page past 19,200 px refused with the scale that fits.
// - The agent's route on the real tool server (E2's recorded artifact session replayed with its five `maws` calls made
//   a design's create and four exports): the PNG, the refusal flattened into the tool's (`{reason, board, w, h,
//   maxScale}`), the fitted PNG and the PDF; the design the session made is the library's row with the session as its
//   last editor and its chip (M6).
// - The editor's Export menu and sheet in a main tab: the selected board's PNG saved where the owner chooses; the poster
//   offered at the stated scale in the sheet (its screenshot kept), exported whole; every board as a PDF; while a
//   retained version is previewed its board exported as the version draws it, in the system pinned at it and with its
//   own picture; the live design again after Back; nothing offered while two versions are compared; no console error.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { asDocumentReplay } from './support/document-replay';
import { launchMaws, type MawsLaunch } from './support/launch';
import { allowNext, idle, mcpCalls, mcpResultOf, PASS3, recordedCwd, replay, resultText, scene, show } from './support/maws-tools';
import { headerAction, ok, openFromLibrary, seamInstalled, seed, tabsOf, type Result } from './support/design';

const POPPLER = '/opt/homebrew/bin';
/** The largest scale (to four places) at which a board's longer side fits `side` px: the policy's own rule (src/artifacts/design/export.ts). */
const fittingScale = (w: number, h: number, side: number) => Math.min(4, Math.floor((side / Math.max(w, h)) * 10_000) / 10_000);
const ARTIFACTS = `${PASS3}/p1-maws-artifacts.jsonl`;

let launch: MawsLaunch | null = null;
let scratch: string | null = null;
test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

interface Row {
  id: string;
  title: string;
}
const systems = async (page: Page): Promise<Row[]> => (await ok<{ artifacts: Row[] }>(page, 'artifacts.list', { filter: { kind: 'design_system' } })).artifacts;

async function ready(env: Record<string, string> = {}): Promise<Page> {
  launch = await launchMaws({ env });
  await launch.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1800, 1000));
  const { page } = launch;
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  await expect.poll(() => seamInstalled(page), { message: 'the seam is installed' }).toBe('object');
  await expect.poll(async () => (await systems(page)).map((s) => s.title).sort(), { timeout: 15_000, message: 'the built-in systems are seeded' }).toEqual(['Classroom', 'MAWS', 'Official']);
  return page;
}

// ---- the fixture: four boards, a 40 px marker of its own colour in each corner of each

type RGB = [number, number, number];
const CORNERS: { id: string; colour: RGB; hex: string }[] = [
  { id: 'tl', colour: [255, 0, 0], hex: '#ff0000' },
  { id: 'tr', colour: [0, 255, 0], hex: '#00ff00' },
  { id: 'bl', colour: [0, 0, 255], hex: '#0000ff' },
  { id: 'br', colour: [255, 0, 255], hex: '#ff00ff' },
];
const MARK = 40;
const markers = (board: string, w: number, h: number) =>
  CORNERS.map(({ id, hex }) => {
    const [left, top] = [id.endsWith('r') ? w - MARK : 0, id.startsWith('b') ? h - MARK : 0];
    return `<div id="${board}-${id}" style="position:absolute; left:${left}px; top:${top}px; width:${MARK}px; height:${MARK}px; background:${hex}"></div>`;
  }).join('');
const BOARDS = {
  phone: { x: 0, y: 0, w: 390, h: 844, title: 'Phone' },
  desktop: { x: 490, y: 0, w: 1440, h: 1024, title: 'Desktop' },
  poster: { x: 2030, y: 0, w: 1080, h: 9000, title: 'Poster' },
  note: { x: 3210, y: 0, w: 300, h: 200, title: 'Note' },
};
type BoardId = keyof typeof BOARDS;
const ORDER: BoardId[] = ['phone', 'desktop', 'poster', 'note'];
const FILES = (phoneExtra = ''): Record<string, string> => ({
  'project/canvas.json': JSON.stringify({ v: 1, title: 'Export lab', boards: BOARDS, order: ORDER }),
  // the phone's section says 500 × 300: the manifest's 390 × 844 is its size
  'project/boards/phone.html': `<section id="phone" style="background:#ffffff; width:500px; height:300px">${markers('phone', 390, 844)}${phoneExtra}<p id="hello" style="position:absolute; left:60px; top:420px">Hello</p></section>`,
  'project/boards/desktop.html': `<section id="desktop" style="background:#ffffff">${markers('desktop', 1440, 1024)}<h2 id="head" style="position:absolute; left:80px; top:80px">Overview</h2></section>`,
  'project/boards/poster.html': `<section id="poster" style="background:#ffffff">${markers('poster', 1080, 9000)}<h1 id="t" style="position:absolute; left:80px; top:80px">Summer festival</h1></section>`,
  'project/boards/note.html': `<section id="note" hidden style="background:#ffffff">${markers('note', 300, 200)}</section>`,
});

/** A PNG of `w`×`h` in one colour (an uploaded picture). */
function png(w: number, h: number, [r, g, b]: RGB): Buffer {
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
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.concat(Array.from({ length: h }, () => Buffer.from([0, ...Array.from({ length: w }, () => [r, g, b]).flat()])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
async function upload(page: Page, artifactId: string, name: string, colour: RGB): Promise<string> {
  return page.evaluate(
    async ([a, n, bytes]) => {
      const result = (await (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<{ ok: boolean; value: { ref: string } }> } }).maws.invoke('artifacts.uploadAsset', { artifactId: a, name: n, mime: 'image/png', bytes: new Uint8Array(bytes as number[]) })) as { ok: boolean; value: { ref: string } };
      return result.value.ref;
    },
    [artifactId, name, [...png(20, 20, colour)]] as const,
  );
}

async function createDesign(page: Page, files = FILES()): Promise<string> {
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'design', title: 'Export lab' });
  const seeded = await seed(page, artifact.id, files);
  expect(seeded.held).toEqual([]);
  return artifact.id;
}

// ---- reading what was exported

const pngSize = (bytes: Buffer) => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
const near = (a: readonly number[], b: readonly number[], d = 8) => a.every((v, k) => Math.abs(v - b[k]!) <= d);

/** A PNG's size and its colour at each point (x, y in its own px). */
async function sample(bytes: Buffer, points: [number, number][]): Promise<{ width: number; height: number; colours: RGB[] }> {
  return launch!.app.evaluate(
    ({ nativeImage }, [b64, at]) => {
      const image = nativeImage.createFromBuffer(Buffer.from(b64, 'base64'));
      const { width, height } = image.getSize();
      const bitmap = image.toBitmap(); // BGRA
      return { width, height, colours: at.map(([x, y]) => { const i = (Math.round(y) * width + Math.round(x)) * 4; return [bitmap[i + 2]!, bitmap[i + 1]!, bitmap[i]!] as [number, number, number]; }) };
    },
    [bytes.toString('base64'), points] as const,
  );
}
/** Points `inset` px inside each corner of a `w`×`h` picture, in CORNERS' order. */
const cornerPoints = (w: number, h: number, inset: number): [number, number][] => [[inset, inset], [w - 1 - inset, inset], [inset, h - 1 - inset], [w - 1 - inset, h - 1 - inset]];
/** The PNG is `w`×`h` with each corner's marker at its corner, whole. */
async function expectCorners(bytes: Buffer, w: number, h: number, label: string): Promise<void> {
  expect(pngSize(bytes), `${label}: its size`).toEqual([w, h]);
  const { colours } = await sample(bytes, cornerPoints(w, h, 3));
  colours.forEach((c, k) => expect(near(c, CORNERS[k]!.colour), `${label}: the ${CORNERS[k]!.id} marker at its corner (${c.join(',')})`).toBe(true));
}

/** Each page's size in PDF points, from pdfinfo. */
function pageSizes(pdf: string): [number, number][] {
  const info = execFileSync(join(POPPLER, 'pdfinfo'), ['-f', '1', '-l', '999', pdf], { encoding: 'utf8' });
  return [...info.matchAll(/^Page\s+\d+ size:\s+([\d.]+) x ([\d.]+) pts/gm)].map((m) => [Number(m[1]), Number(m[2])]);
}
/** A PDF page rasterized at `w`×`h` by pdftoppm, as RGB bytes. */
function rasterize(pdf: string, pageNo: number, w: number, h: number): { w: number; h: number; rgb: Buffer } {
  const ppm = execFileSync(join(POPPLER, 'pdftoppm'), ['-f', String(pageNo), '-l', String(pageNo), '-scale-to-x', String(w), '-scale-to-y', String(h), pdf], { maxBuffer: 64 * 1024 * 1024 });
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
const pixelAt = (image: { w: number; rgb: Buffer }, x: number, y: number): RGB => {
  const i = (y * image.w + x) * 3;
  return [image.rgb[i]!, image.rgb[i + 1]!, image.rgb[i + 2]!];
};
/** Page `pageNo` is a board of `w`×`h` px drawn at `scale`: its MediaBox that size (Chromium rounds to a fraction of a point), its markers at its corners. */
function expectPage(pdf: string, sizes: [number, number][], pageNo: number, board: { w: number; h: number }, scale: number, label: string): void {
  const [pw, ph] = [board.w * scale, board.h * scale];
  const [mw, mh] = sizes[pageNo - 1]!;
  expect(Math.abs(mw - pw * 0.75), `${label}: page width ${mw} pt for ${pw} px`).toBeLessThanOrEqual(1);
  expect(Math.abs(mh - ph * 0.75), `${label}: page height ${mh} pt for ${ph} px`).toBeLessThanOrEqual(1);
  const image = rasterize(pdf, pageNo, Math.round(pw), Math.round(ph));
  const inset = Math.max(3, Math.round(MARK * scale * 0.25));
  cornerPoints(image.w, image.h, inset).forEach(([x, y], k) => {
    const c = pixelAt(image, x, y);
    expect(near(c, CORNERS[k]!.colour, 24), `${label}: the ${CORNERS[k]!.id} marker at (${x}, ${y}) (${c.join(',')})`).toBe(true);
  });
  // and inside the markers, the board's own white: the page is the board, not a fit of it
  expect(near(pixelAt(image, Math.round(image.w / 2), Math.round(MARK * scale * 1.5)), [255, 255, 255], 24), `${label}: white beside the markers`).toBe(true);
}

const exportAs = (page: Page, artifactId: string, format: string, extra: Record<string, unknown> = {}) => ok<{ path: string; revision: number }>(page, 'artifacts.export', { artifactId, format, ...extra });
/** A command's answer as it is, a refusal's `issues` included. */
type Answer<T> = Result<T> | { ok: false; error: { code: string; message: string; issues?: unknown } };
const invoke = <T>(page: Page, name: string, input: unknown) => page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const) as Promise<Answer<T>>;

test('through the export service: native and scaled PNGs whole, the over-cap poster refused then fitted, native and scaled PDF pages', async () => {
  test.setTimeout(240_000);
  const page = await ready();
  const id = await createDesign(page);

  await test.step('a PNG of a board at its manifest size, and at twice it, its corners whole', async () => {
    await expectCorners(readFileSync((await exportAs(page, id, 'png', { board: 'phone' })).path), 390, 844, 'phone, native');
    await expectCorners(readFileSync((await exportAs(page, id, 'png', { board: 'phone', scale: 2 })).path), 780, 1688, 'phone at 2');
    await expectCorners(readFileSync((await exportAs(page, id, 'png')).path), 390, 844, 'the first board by default');
  });

  await test.step('the poster over the picture cap: refused naming it, its size and the scale that fits; exported whole at that scale', async () => {
    const maxScale = fittingScale(1080, 9000, 8192);
    expect(maxScale).toBe(0.9102);
    const refused = await invoke(page, 'artifacts.export', { artifactId: id, format: 'png', board: 'poster' });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toMatchObject({ code: 'invalid_input', issues: { reason: 'exportTooLarge', data: { board: 'poster', w: 1080, h: 9000, maxScale } } });
    await expectCorners(readFileSync((await exportAs(page, id, 'png', { board: 'poster', scale: maxScale })).path), 983, 8192, 'poster at the fitting scale');
  });

  await test.step('a PDF: one page per board at its own size, the hidden board too, markers at native positions', async () => {
    const pdf = (await exportAs(page, id, 'pdf')).path;
    const sizes = pageSizes(pdf);
    expect(sizes).toHaveLength(4);
    ORDER.forEach((board, k) => expectPage(pdf, sizes, k + 1, BOARDS[board], 1, `page ${k + 1} (${board})`));
  });

  await test.step('the named boards at half size, in their order; a scale past the page limit refused with the one that fits', async () => {
    const pdf = (await exportAs(page, id, 'pdf', { boards: ['poster', 'phone'], scale: 0.5 })).path;
    const sizes = pageSizes(pdf);
    expect(sizes).toHaveLength(2);
    expectPage(pdf, sizes, 1, BOARDS.poster, 0.5, 'poster at half');
    expectPage(pdf, sizes, 2, BOARDS.phone, 0.5, 'phone at half');
    const refused = await invoke(page, 'artifacts.export', { artifactId: id, format: 'pdf', scale: 3 });
    expect(!refused.ok && 'issues' in refused.error && refused.error.issues).toEqual({ reason: 'exportTooLarge', data: { board: 'poster', w: 1080, h: 9000, maxScale: fittingScale(1080, 9000, 19_200) } });
  });

  expect(launch!.consoleErrors()).toEqual([]);
});

// E2's recorded artifact session (as `e2e:tools` replays it) with its five `maws` calls made a design's create and four
// exports; the host's tool server answers each against the real store and main's export service; the engine's recorded
// results and the model's words are never asserted.
test('the agent’s route: artifact_export on the real tool server exports a board, is refused over the cap with the scale, then exports at it, and prints every board', async () => {
  test.setTimeout(240_000);
  const repo = recordedCwd(ARTIFACTS);
  const maxScale = fittingScale(1080, 9000, 8192);
  const replayed = asDocumentReplay(
    ARTIFACTS,
    [
      { name: 'artifact_create', input: { kind: 'design', title: 'Export lab', handle: 'lab', files: FILES() } },
      { name: 'artifact_export', input: { artifact: 'lab', format: 'png', board: 'phone' } },
      { name: 'artifact_export', input: { artifact: 'lab', format: 'png', board: 'poster' } },
      { name: 'artifact_export', input: { artifact: 'lab', format: 'png', board: 'poster', scale: maxScale } },
      { name: 'artifact_export', input: { artifact: 'lab', format: 'pdf' } },
    ],
    'design-export',
  );
  const existed = existsSync(repo);
  mkdirSync(repo, { recursive: true });
  try {
    await scene({ titles: ['P3-E1: design export'], repo, label: 'p3e1-export' }, async (s) => {
      const [sessionId] = s.ids;
      launch = s.maws;
      await show(s, sessionId!);
      await replay(s, sessionId!, replayed);
      for (let k = 0; k < 7; k++) await allowNext(s, sessionId!); // the recording's permission requests, as recorded
      await idle(s, sessionId!);
      const rows = s.journal(sessionId!);
      const calls = mcpCalls(rows);
      expect(calls.map((c) => c.name)).toEqual(['artifact_create', 'artifact_export', 'artifact_export', 'artifact_export', 'artifact_export']);
      const answer = (k: number) => mcpResultOf(rows, calls[k]!.requestId)!;
      const exported = (k: number) => {
        const result = answer(k);
        expect(result.isError, resultText(result)).toBeUndefined();
        return JSON.parse(resultText(result)) as { status: string; format: string; path: string };
      };
      expect(answer(0).isError, resultText(answer(0))).toBeUndefined();
      await expectCorners(readFileSync(exported(1).path), 390, 844, 'the agent’s phone');
      const refused = answer(2);
      expect(refused.isError).toBe(true);
      const text = resultText(refused);
      expect(text).toMatch(/^artifact_export: board poster is 1080×9000 px/);
      expect(JSON.parse(text.slice(text.indexOf(' {"reason":') + 1))).toEqual({ reason: 'exportTooLarge', board: 'poster', w: 1080, h: 9000, maxScale });
      await expectCorners(readFileSync(exported(3).path), 983, 8192, 'the agent’s poster at the fitting scale');
      const pdf = exported(4).path;
      const sizes = pageSizes(pdf);
      expect(sizes).toHaveLength(4);
      ORDER.forEach((board, k) => expectPage(pdf, sizes, k + 1, BOARDS[board], 1, `the agent’s page ${k + 1} (${board})`));

      // M6 (acceptance 6): the design the session made is the library's row, kind and session named: its creator and
      // last editor, and its session chip, in the product's own library. The replay's launch bound the session to a new
      // engine transcript, which forgets the seeded transcript's first-prompt title (the index's rebinding rule) until
      // that transcript's own summary names one (a replay writes none). The owner names it with a MAWS title through
      // `session.update`, the override `session.rename` itself writes when no process of the session is ready (the
      // replay's, here, would be asked through the engine's control instead), and the row and chip read the index's title
      const designId = (JSON.parse(resultText(answer(0))) as { artifactId: string }).artifactId;
      const SESSION_TITLE = 'Export lab session';
      await ok(s.page, 'session.update', { appSessionId: sessionId, patch: { title: { text: SESSION_TITLE, source: 'user' } } });
      const { row } = await ok<{ row: { kind: string; lastEditor: unknown; sessions: { appSessionId: string; title: string; roles: string[] }[] } | null }>(s.page, 'library.get', { artifactId: designId });
      expect(row).toMatchObject({ kind: 'design', lastEditor: { kind: 'session', appSessionId: sessionId } });
      expect(row!.sessions).toEqual([expect.objectContaining({ appSessionId: sessionId, title: SESSION_TITLE, roles: expect.arrayContaining(['created']) })]);
      await s.page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
      const libraryRow = s.page.locator('[data-library]').getByRole('article', { name: 'Export lab', exact: true });
      await expect(libraryRow).toContainText('Design');
      await expect(libraryRow.getByRole('button', { name: SESSION_TITLE, exact: true })).toBeVisible();
    });
  } finally {
    launch = null; // the scene closed its own app
    if (!existed) rmSync(repo, { recursive: true, force: true });
  }
});

test('the editor’s Export menu and sheet: the selected board, the poster at the stated scale, every board, a previewed version as it draws, nothing in Compare', async () => {
  test.setTimeout(300_000);
  scratch = mkdtempSync(join(tmpdir(), 'maws-e2e-design-export-'));
  const saved = join(scratch, 'saved');
  mkdirSync(saved);
  const page = await ready({ MAWS_E2E_SAVE_PATH: saved });
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'design', title: 'Export lab' });
  const id = artifact.id;
  const red = await upload(page, id, 'red.png', [255, 0, 0]);
  const blue = await upload(page, id, 'blue.png', [0, 0, 255]);
  // the phone's picture and a swatch in the system's text colour (the colour the two systems tell apart)
  const extra = (picture: string) => `<img id="pic" src="${picture}" alt="" style="position:absolute; left:100px; top:100px; width:100px; height:100px"><div id="swatch" style="position:absolute; left:100px; top:300px; width:100px; height:100px; background:var(--ds-color-text, #888888)"></div>`;
  expect((await seed(page, id, FILES(extra(red)))).held).toEqual([]);
  const official = (await systems(page)).find((s) => s.title === 'Official')!;
  const maws = (await systems(page)).find((s) => s.title === 'MAWS')!;
  await ok(page, 'artifacts.update', { artifactId: id, designSystemId: official.id });

  const tab = await openFromLibrary(page, 'Export lab', id);
  const header = page.locator('[data-region="main"] [data-editor-header]');
  const swatch = tab.locator('[data-design-world] [data-board-id="phone"] .design-board-canvas [data-eid="swatch"]').first();
  const colourOf = async (node: Locator): Promise<RGB> => ((await node.evaluate((n) => getComputedStyle(n).backgroundColor)).match(/\d+/g) ?? ['0', '0', '0', '0']).slice(0, 3).map(Number) as RGB;
  /** The swatch's colour once it draws in a system's token (not before it draws, nor in its fallback). */
  const drawnIn = async () => {
    const value = await swatch.evaluate((n) => getComputedStyle(n).backgroundColor);
    return ['', 'rgba(0, 0, 0, 0)', 'rgb(136, 136, 136)'].includes(value) ? null : value;
  };
  await expect.poll(drawnIn, { message: 'the swatch draws in Official' }).not.toBeNull();
  const inOfficial = await colourOf(swatch);

  const savedFile = (name: string) => join(saved, name);
  const appears = async (name: string): Promise<Buffer> => {
    await expect.poll(() => existsSync(savedFile(name)), { timeout: 60_000, message: `${name} saved` }).toBe(true);
    await expect.poll(() => readFileSync(savedFile(name)).length, { timeout: 5_000 }).toBeGreaterThan(24);
    const bytes = readFileSync(savedFile(name));
    rmSync(savedFile(name));
    return bytes;
  };
  /** Saved bytes kept under the scratch directory (a PDF read by poppler). */
  const kept = (name: string, bytes: Buffer) => {
    const path = join(scratch!, name);
    writeFileSync(path, bytes);
    return path;
  };
  const openExport = async () => {
    await header.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByRole('menuitem')).toHaveText(['PNG (selected board)', 'PDF (selected board)', 'PDF (all boards)']);
  };
  const pick = async (label: string) => {
    await openExport();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
  };
  const selectBoard = async (board: BoardId) => {
    await tab.locator(`[data-board-row="${board}"] .design-board-row`).click();
    await expect.poll(async () => (await tabsOf(page, id)).find((t) => t.surface === 'main')?.currentBoard).toBe(board);
  };

  await test.step('the selected board as a PNG, at its size, saved where the owner chooses', async () => {
    await selectBoard('phone');
    await pick('PNG (selected board)');
    const bytes = await appears('Export lab.png');
    await expectCorners(bytes, 390, 844, 'the menu’s phone');
    await expect(page.getByRole('region', { name: /^Notifications/ }).getByText(`Saved to ${savedFile('Export lab.png')}`).first()).toBeVisible();
  });

  await test.step('the poster: the sheet states the scale that fits and its size; agreed, the whole poster at that scale', async () => {
    await selectBoard('poster');
    await pick('PNG (selected board)');
    const sheet = page.getByRole('dialog', { name: 'Export “Poster” at 91.02%?' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('“Poster” is 1080 × 9000 px. A PNG can be at most 8192 px on a side, so MAWS exports the whole board at 91.02% (983 × 8192 px); nothing is cropped.');
    mkdirSync(test.info().outputDir, { recursive: true });
    await page.screenshot({ path: join(test.info().outputDir, 'design-export-sheet.png') }); // the sheet, for the owner's sitting
    await sheet.getByRole('button', { name: 'Export at 91.02%' }).click();
    await expectCorners(await appears('Export lab.png'), 983, 8192, 'the menu’s poster');
  });

  await test.step('every board as a PDF, one page each at its own size; the selected board alone as a PDF', async () => {
    await pick('PDF (all boards)');
    const all = kept('all.pdf', await appears('Export lab.pdf'));
    const sizes = pageSizes(all);
    expect(sizes).toHaveLength(4);
    ORDER.forEach((board, k) => expectPage(all, sizes, k + 1, BOARDS[board], 1, `the menu’s page ${k + 1} (${board})`));
    await pick('PDF (selected board)');
    const one = kept('one.pdf', await appears('Export lab.pdf'));
    expect(pageSizes(one)).toHaveLength(1);
    expectPage(one, pageSizes(one), 1, BOARDS.poster, 1, 'the menu’s selected poster');
  });

  // a version kept, then the picture changed and the system switched, and kept again
  await selectBoard('phone');
  await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: id, label: 'Draft' });
  expect((await seed(page, id, FILES(extra(blue)))).held).toEqual([]);
  await ok(page, 'artifacts.update', { artifactId: id, designSystemId: maws.id });
  await expect.poll(async () => (await colourOf(swatch)).join(',')).not.toBe(inOfficial.join(','));
  const inMaws = await colourOf(swatch);
  await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: id, label: 'Reviewed' });
  /** The phone's picture and swatch as an exported PNG draws them. */
  const phoneOf = async (bytes: Buffer) => {
    const { colours } = await sample(bytes, [[150, 150], [150, 350]]);
    return { picture: colours[0]!, swatch: colours[1]! };
  };

  const rail = tab.getByRole('complementary', { name: 'Version history' });
  const bar = tab.getByRole('toolbar', { name: 'Version preview' });
  await test.step('a previewed version: its board exported as the version draws it, its own picture, in the system pinned at it', async () => {
    await headerAction(page, 'Version history');
    await expect(rail).toBeVisible();
    for (const fold of await rail.getByRole('button', { name: /^\d+ more versions?$/ }).all()) await fold.click();
    await rail.getByRole('button', { name: /^Version Draft by You/ }).click();
    await expect(bar.locator('.deck-history-heading')).toContainText('Draft');
    await expect(bar.locator('.deck-history-heading')).not.toContainText('→');
    await pick('PNG (selected board)');
    const drawn = await phoneOf(await appears('Export lab.png'));
    expect(near(drawn.picture, [255, 0, 0]), `the version's picture (${drawn.picture.join(',')})`).toBe(true);
    expect(near(drawn.swatch, inOfficial, 4), `the version's system (${drawn.swatch.join(',')} for ${inOfficial.join(',')})`).toBe(true);
  });

  await test.step('two versions compared: nothing is offered rather than one side', async () => {
    await rail.getByRole('button', { name: /^Version Reviewed by You/ }).click({ modifiers: ['Shift'] });
    await expect(bar.locator('.deck-history-heading')).toHaveText('Draft → Reviewed');
    await openExport();
    for (const label of ['PNG (selected board)', 'PDF (selected board)', 'PDF (all boards)']) await expect(page.getByRole('menuitem', { name: label, exact: true })).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
  });

  await test.step('back to the design: the live board, its new picture, in the system governing it now', async () => {
    await bar.getByRole('button', { name: 'Back to design' }).click();
    await expect(tab.getByRole('toolbar', { name: 'Design' })).toBeVisible();
    await pick('PNG (selected board)');
    const drawn = await phoneOf(await appears('Export lab.png'));
    expect(near(drawn.picture, [0, 0, 255]), `the live picture (${drawn.picture.join(',')})`).toBe(true);
    expect(near(drawn.swatch, inMaws, 4), `the live system (${drawn.swatch.join(',')} for ${inMaws.join(',')})`).toBe(true);
  });

  expect(launch!.consoleErrors()).toEqual([]);
});
