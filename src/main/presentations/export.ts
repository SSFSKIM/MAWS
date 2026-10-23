// The presentation kind's exporters in A's export registry (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M9,
// D12; parent §4.5, §4.8, Decision Log 17; X31): `presentation` × `html`, `pdf`, `pptx`, `claude` and `png`, reached by
// the agent's `artifact_export` and the editor's and the library's Export alike. Each reads the deck's state as the
// export took it (the live revision or a version's), the design system governing it as the engine host names it (D's
// `designSystems.governing`: the version's pin, else the host's chain, else the bundled floor; Decision Log 27 (2), as
// D binds B's document exporters) with the deck's overrides, and the uploaded assets it names; the portable halves under
// `src/artifacts/slides/export/` write the page, the mapping and the zip.
//
// Every format but `claude` renders: the deck's standalone page is loaded in a hidden 1920×1080 window on the capture
// partition (offscreen, sandboxed, its requests limited to its own file and `data:` as A's printer limits them, the window
// destroyed when the export ends or its budget runs out), fitted and measured (`measureDeckPage`); the page is then
// written again with what depends on layout drawn from the measure (shapes, connectors, fitted text, crops) for:
// - `html`: the file itself;
// - `pdf`: printed by the service's printer, one 1920×1080 px page per visible slide, each embed drawn as the picture the
//   window took of it (the printer runs no script);
// - `png`: the cover slide (else the first visible one) as the window draws it, `width` (and `height`) when asked;
// - `pptx`: the measure mapped to native objects in the request's `fonts` variant, with the pictures the mapping needs
//   taken from the window first (a whole slide for `pictures`; an embed, an svg's or icon's fallback, a gradient region).
// `embedded` (uploaded faces embedded in the package) is not built yet (H3's tracker row): it is refused with a reason.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserWindow } from 'electron';
import { fontFaceCss, systemFaces } from '@artifacts/design-system/assets';
import { DOCUMENT_CSS_PATH } from '@artifacts/design-system/canon';
import { readSystem } from '@artifacts/design-system/model';
import { officeThemeXml } from '@artifacts/design-system/office';
import { resolveDsVars } from '@artifacts/design-system/resolve-vars';
import type { TokenSet } from '@artifacts/design-system/tokens';
import { builtinView } from '@artifacts/design-system/view';
import type { DesignSystemExport } from '@artifacts/document/export/design-system';
import { claudeDeckFiles } from '@artifacts/slides/export/claude';
import { MeasureNeeded } from '@artifacts/slides/export/lower';
import { measureDeckPage, type MeasureArgs, type MeasuredDeck } from '@artifacts/slides/export/measure';
import { pictureJobs, pptxSlides, writePptx, type PictureJob } from '@artifacts/slides/export/pptx';
import { deckAssetRefs, deckFacesCss, deckPage, exportDeckOf, type ExportDeck, type PageOptions } from '@artifacts/slides/export/standalone';
import { TEXT_TAGS } from '@artifacts/slides/ir';
import { shrinkScale } from '@artifacts/slides/render-rules';
import { deckTokenValues } from '@artifacts/slides/mirror';
import { applyV2, newDoc, type Doc } from '@artifacts/yjs';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import { mimeOf } from '@shared/files/mime';
import { loadSettled, openCaptureWindow, settled } from '../artifacts/capture';
import { printRequestAllowed, type Exporter, type ExportContext, type ExporterRegistry, type ExportRequest } from '../artifacts/export';
import { restrictRequests, type SeamEnv } from '../artifacts/policies';
import { zipFiles } from '../design-systems/zip';

export interface PresentationExportDeps {
  /** The engine host's commands (the governing system, its state and assets). */
  call<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>;
  env: SeamEnv;
}

const SLIDE_W = 1920;
const SLIDE_H = 1080;

async function required<N extends CommandName>(deps: PresentationExportDeps, name: N, input: CommandInput<N>): Promise<CommandOutput<N>> {
  const result = await deps.call(name, input);
  if (!result.ok) throw new Error(`${name} failed: ${result.error.message}`);
  return result.value;
}

// ---- the design system ----

/** D's export helpers bound to the governing system (as D hands B's document exporters theirs), with what the deck reads
 * beside them: the system's id for its faces' files. */
export interface DeckSystem extends DesignSystemExport<TokenSet> {
  /** The system's id, null for the bundled floor. */
  id: string | null;
  /**
   * The revision the system is read at: a version's pin (X29's `versionSeq`), absent for the live system. Its faces'
   * files are read at it too: a system deleted since lends a retained version its files only at a named revision (the
   * final review's A15; the host's `artifacts.content`).
   */
  revision?: number;
  /** `components/document.css`, whose `@font-face` blocks are the system's faces. */
  documentCss: string | undefined;
}

function floor(): DeckSystem {
  const view = builtinView();
  return { id: null, name: view.name || 'MAWS', tokens: view.tokens, documentCss: undefined, resolveDsVars, officeThemeXml };
}

/** The system in `bytes` (at `revision`, a pin); the floor when it holds no system yet (a seeding cut short), as the editor draws it. */
function systemOf(id: string, bytes: Uint8Array, revision: number | undefined): DeckSystem {
  const doc = newDoc();
  try {
    applyV2(doc, bytes);
    const state = readSystem(doc);
    if (!state.meta) return floor();
    return { id, ...(revision !== undefined && { revision }), name: state.meta.name, tokens: state.tokens, documentCss: state.files[DOCUMENT_CSS_PATH], resolveDsVars, officeThemeXml };
  } finally {
    doc.destroy();
  }
}

/**
 * The system a deck exports in, as the engine host names it (D's main-only `designSystems.governing`, the read D's
 * `governingSystemExport` makes for B's document exporters): a version's pin (X29) when the request names a version, the
 * floor for a version written with none, else the live deck's through the host's chain; then that system's state, live
 * or at the pin's seq. Main resolves no chain of its own.
 */
export async function deckSystem(request: Pick<ExportRequest, 'artifactId' | 'versionId'>, deps: PresentationExportDeps): Promise<DeckSystem> {
  const { system } = await required(deps, 'designSystems.governing', { artifactId: request.artifactId, ...(request.versionId !== undefined && { versionId: request.versionId }) });
  if ('builtin' in system) return floor();
  const { bytes } = system.versionSeq === undefined ? await required(deps, 'artifacts.state', { artifactId: system.id }) : await required(deps, 'artifacts.versionState', { artifactId: system.id, seq: system.versionSeq });
  return systemOf(system.id, bytes, system.versionSeq);
}

const dataUrl = (bytes: Uint8Array, mime: string) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

/** The system's faces, their files inlined, read at the system's revision (a face whose file cannot be read is left out). */
export async function systemFacesCss(system: DeckSystem, deps: Pick<PresentationExportDeps, 'call'>): Promise<string> { // F (L182): B's document pages too
  if (!system.id || !system.documentCss) return '';
  const urls = new Map<string, string>();
  for (const ref of new Set(systemFaces(system.documentCss, system.tokens).flatMap((face) => face.refs))) {
    const found = await deps.call('artifacts.content', { artifactId: system.id, path: ref, ...(system.revision !== undefined && { revision: system.revision }) });
    if (found.ok) urls.set(ref, dataUrl(new Uint8Array(await readFile(found.value.path)), mimeOf(found.value.name)));
  }
  // a source that is not there points nowhere loadable (the page's policy refuses it): the face falls back
  return fontFaceCss(system.documentCss, system.tokens, (ref) => urls.get(ref) ?? 'data:,');
}

// ---- what every export reads ----

interface Prepared {
  doc: Doc;
  deck: ExportDeck;
  system: DeckSystem;
  resolveVar: (name: string) => string | undefined;
  assets: Map<string, { bytes: Uint8Array; mime: string }>;
  page: Omit<PageOptions, 'mode'>;
}

async function prepare(request: ExportRequest, context: ExportContext, deps: PresentationExportDeps): Promise<Prepared> {
  const doc = newDoc();
  try {
    applyV2(doc, await context.state());
    const deck = exportDeckOf(doc, context.title);
    const system = await deckSystem(request, deps);
    const resolveVar = deckTokenValues(system.tokens, deck.overrides);
    const assets = new Map<string, { bytes: Uint8Array; mime: string }>();
    for (const ref of deckAssetRefs(deck)) {
      const found = await context.readAsset(ref);
      if (found) assets.set(ref, found);
    }
    const urls = new Map([...assets].map(([ref, a]) => [ref, dataUrl(a.bytes, a.mime)]));
    const asset = (ref: string) => urls.get(ref) ?? null;
    const facesCss = `${await systemFacesCss(system, deps)}${deckFacesCss(deck, asset)}`;
    return { doc, deck, system, resolveVar, assets, page: { resolveVar, asset, facesCss } };
  } catch (error) {
    doc.destroy();
    throw error;
  }
}

// ---- the export window ----

export interface DeckWindow {
  /** Loads a page (written to the window's own file) and waits for its first paint. */
  load(html: string): Promise<void>;
  measure(): Promise<MeasuredDeck>;
  /** A picture of `job`'s region as PNG bytes, at `width` px wide when asked. */
  capture(job: Pick<PictureJob, 'slideId' | 'elementId' | 'mode' | 'box'>, size?: { width?: number; height?: number }): Promise<Buffer>;
}

const MEASURE_ARGS: MeasureArgs = { textTags: [...TEXT_TAGS] };

// The page's state for one picture (fix waves 1 and 2): only the job's slide shown at the top; for an element, everything
// but the element hidden, and the transforms of the element and of every ancestor up to the slide neutralized, so the
// element stands alone, whole and unturned at its own layout box (a translate no longer moves it, a scale no longer sizes
// it, a group's rotation no longer turns it; the mapping places and turns the picture at the measured box). Then it is
// moved, by the `translate` property the dialect never writes, to the frame's top-left corner, its ancestors and the
// slide no longer clipping it, so a wide element no transform keeps in view is taken whole (fix wave 2). Its text is
// transparent when only its paint is wanted. Answers, after two frames, the rect to capture: the element's box as now
// drawn (the whole slide for `slide` and `background`), which may be larger than the window. P3-E (E1 M5; E0's finding
// (e)): a design board's frame (`data-size`) is the whole slide's box as drawn, at its size and any zoom its draw sets.
// P4 (the skewed-element row and its review): `drawn` moves, flattens and unclips nothing, so the element stands in
// place as the slide draws it (skewed, and clipped by its ancestors as the canvas clips it: moving an ancestor would make
// it the containing block of what is pinned inside it); the elements measured on their own (pictured or mapped on their
// own) are hidden within it, as a table's rows and cells are not, and the window captures the region the measure says it
// paints (the job's box, in slide px), moved by the slide's own offset in its frame, which `drawn` answers (a section may
// carry a transform of its own).
export const STAGE = (slideId: string, elementId: string | null, mode: PictureJob['mode']) => `(() => {
  const slide = ${JSON.stringify(slideId)}, eid = ${JSON.stringify(elementId)}, mode = ${JSON.stringify(mode)};
  document.body.setAttribute('data-shown', '');
  let frame = null;
  for (const f of document.querySelectorAll('.maws-frame')) { if (f.getAttribute('data-frame') === slide) { f.setAttribute('data-shown', ''); frame = f; } else f.removeAttribute('data-shown'); }
  for (const flat of document.querySelectorAll('[data-maws-flat]')) flat.removeAttribute('data-maws-flat');
  for (const open of document.querySelectorAll('[data-maws-open]')) open.removeAttribute('data-maws-open');
  for (const moved of document.querySelectorAll('[data-maws-moved]')) { moved.style.removeProperty('translate'); moved.removeAttribute('data-maws-moved'); }
  let st = document.getElementById('maws-stage');
  if (!st) { st = document.createElement('style'); st.id = 'maws-stage'; document.head.appendChild(st); }
  const on = '.maws-frame[data-shown] ';
  const el = eid ? on + '[data-eid="' + CSS.escape(eid) + '"]' : '';
  const target = eid && frame ? frame.querySelector('[data-eid="' + CSS.escape(eid) + '"]') : null;
  const isolated = target && (mode === 'self' || mode === 'tree');
  if (isolated) {
    for (let at = target; at && !at.classList.contains('maws-slide'); at = at.parentElement) at.setAttribute('data-maws-flat', '');
    for (let at = target.parentElement; at && !at.classList.contains('maws-slide'); at = at.parentElement) at.setAttribute('data-maws-open', '');
  }
  const own = el + ' [data-eid]:not(tr):not(th):not(td)';
  st.textContent = mode === 'slide' ? '' : mode === 'background'
    ? on + '.maws-slide * { visibility: hidden !important; }'
    : on + '.maws-slide { background: transparent !important; box-shadow: none !important; overflow: visible !important; }\\n' + '.maws-frame[data-shown] { overflow: visible !important; }\\n' + on + '.maws-slide * { visibility: hidden !important; opacity: 1 !important; }\\n'
      + on + '[data-maws-flat] { transform: none !important; }\\n'
      + on + '[data-maws-open] { overflow: visible !important; }\\n'
      + el + ' { visibility: visible !important; opacity: 1 !important;' + (mode === 'self' ? ' color: transparent !important;' : '') + ' }\\n'
      + (mode === 'tree' ? el + ' * { visibility: visible !important; }' : '')
      + (mode === 'drawn' ? el + ' * { visibility: visible !important; }\\n' + own + ', ' + own + ' * { visibility: hidden !important; }' : '');
  scrollTo(0, 0);
  const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const rectOf = () => {
    const r = target.getBoundingClientRect();
    const o = frame.getBoundingClientRect();
    return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
  };
  return frames().then(() => {
    if (mode === 'drawn' && frame) { const s = frame.querySelector('.maws-slide').getBoundingClientRect(); const o = frame.getBoundingClientRect(); return { x: s.left - o.left, y: s.top - o.top, w: s.width, h: s.height }; }
    if (!isolated) { const sized = frame && frame.hasAttribute('data-size') ? frame.getBoundingClientRect() : null; return { x: 0, y: 0, w: sized ? sized.width : ${SLIDE_W}, h: sized ? sized.height : ${SLIDE_H} }; }
    const at = rectOf();
    target.setAttribute('data-maws-moved', '');
    target.style.setProperty('translate', (-at.x) + 'px ' + (-at.y) + 'px', 'important');
    return frames().then(rectOf);
  });
})()`;

/**
 * A hidden export window for the length of `use`, destroyed when it ends or `signal` aborts. P3-F (exports-capture
 * scalpel-4#2): the abort releases the rest as well (the page's directory, the request filter), so a cancellation that
 * leaves `use` waiting on the destroyed window leaks nothing; the end releases them again, each release idempotent.
 */
export async function withDeckWindow<T>(env: SeamEnv, signal: AbortSignal, use: (win: DeckWindow) => Promise<T>): Promise<T> {
  if (signal.aborted) throw new Error('the export was cancelled');
  const dir = await mkdtemp(join(tmpdir(), 'maws-deck-'));
  const file = join(dir, 'deck.html');
  const url = pathToFileURL(file).href;
  let win: BrowserWindow | null = null;
  let unrestrict = () => {};
  const release = () => {
    unrestrict();
    if (win && !win.isDestroyed()) win.destroy();
  };
  const removePage = () => rm(dir, { recursive: true, force: true }).catch(() => {});
  const cancel = () => {
    release();
    void removePage();
  };
  try {
    if (signal.aborted) throw new Error('the export was cancelled');
    win = openCaptureWindow(SLIDE_W, SLIDE_H, env);
    signal.addEventListener('abort', cancel, { once: true });
    win.setBackgroundColor('#00000000'); // an element's picture keeps what lies under it see-through
    const contents = win.webContents;
    unrestrict = restrictRequests(contents.id, (requested) => !printRequestAllowed(requested, url));
    const live = () => {
      if (!win || win.isDestroyed() || signal.aborted) throw new Error('the export was cancelled');
      return win;
    };
    return await use({
      load: async (html) => {
        await writeFile(file, html, 'utf8');
        await loadSettled(live(), url);
      },
      // the measure and the fit's search it uses, each sent as its own source (render-rules.ts: the canvas's too)
      measure: async () => (await live().webContents.executeJavaScript(`(${String(measureDeckPage)})(${JSON.stringify(MEASURE_ARGS)}, ${String(shrinkScale)})`, true)) as MeasuredDeck,
      capture: async (job, size) => {
        const w = live();
        const staged = (await w.webContents.executeJavaScript(STAGE(job.slideId, job.elementId, job.mode), true)) as { x: number; y: number; w: number; h: number };
        // a `drawn` picture is taken in place, of the region the measure says the element paints (P4), in slide px: moved
        // by where the slide sits in the frame
        const box = job.mode === 'drawn' ? { ...job.box, x: job.box.x + staged.x, y: job.box.y + staged.y } : staged;
        const x = Math.max(0, Math.floor(box.x));
        const y = Math.max(0, Math.floor(box.y));
        // an element larger than the slide: the window grows to hold it for this picture (fix wave 2)
        const [vw, vh] = [Math.max(SLIDE_W, Math.ceil(box.x + box.w)), Math.max(SLIDE_H, Math.ceil(box.y + box.h))];
        const grown = vw > SLIDE_W || vh > SLIDE_H;
        if (grown) {
          w.setContentSize(vw, vh);
          await settled(w);
        }
        const rect = { x, y, width: Math.max(1, Math.min(vw - x, Math.ceil(box.x + box.w) - x)), height: Math.max(1, Math.min(vh - y, Math.ceil(box.y + box.h) - y)) };
        let image = await w.webContents.capturePage(rect);
        if (grown) w.setContentSize(SLIDE_W, SLIDE_H);
        if (size?.width !== undefined) image = image.resize({ width: size.width, ...(size.height !== undefined && { height: size.height }), quality: 'best' });
        return image.toPNG();
      },
    });
  } finally {
    signal.removeEventListener('abort', cancel);
    release();
    await removePage();
  }
}

/**
 * The measure pass: the page loaded in `measure` mode, fitted and measured. P3-E (E1 M5; the parent's Decision Log 11
 * (2)): exported with its narrower parameter for the design's exporter (src/main/design/export.ts); unchanged.
 */
export async function measurePass(win: DeckWindow, prepared: Pick<Prepared, 'deck' | 'page'>): Promise<MeasuredDeck> {
  await win.load(deckPage(prepared.deck, { ...prepared.page, mode: 'measure' }));
  return win.measure();
}

const pngUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

/** The slide a picture of the deck shows: its cover, else its first visible slide, else its first. */
export function coverSlide(deck: ExportDeck): string | null {
  const visible = deck.slides.filter((s) => !s.hidden);
  return deck.cover && visible.some((s) => s.id === deck.cover) ? deck.cover : (visible[0]?.id ?? deck.slides[0]?.id ?? null);
}

// ---- the exporters ----

type Run = (request: ExportRequest, context: ExportContext, prepared: Prepared, deps: PresentationExportDeps) => Promise<void>;

const html: Run = async (request, context, prepared, deps) => {
  const page = await withDeckWindow(deps.env, context.signal, async (win) => {
    const measured = await measurePass(win, prepared);
    return deckPage(prepared.deck, { ...prepared.page, mode: 'html', measured });
  });
  await context.writeFile(request.path, page);
};

const pdf: Run = async (request, context, prepared, deps) => {
  if (!prepared.deck.slides.some((s) => !s.hidden)) throw new Error('the presentation has no visible slide to print');
  const page = await withDeckWindow(deps.env, context.signal, async (win) => {
    const measured = await measurePass(win, prepared);
    // the printer runs no script: each embed is the picture the window takes of it
    const embeds = measured.slides.flatMap((s) => s.elements.filter((e) => e.tag === 'x-embed').map((e) => ({ slideId: s.id, elementId: e.id, mode: 'tree' as const, box: e.box })));
    const pictures = new Map<string, Map<string, string>>();
    if (embeds.length) {
      await win.load(deckPage(prepared.deck, { ...prepared.page, mode: 'measure', measured }));
      for (const job of embeds) {
        const slide = pictures.get(job.slideId) ?? new Map<string, string>();
        slide.set(job.elementId, pngUrl(await win.capture(job)));
        pictures.set(job.slideId, slide);
      }
    }
    return deckPage(prepared.deck, { ...prepared.page, mode: 'print', measured, pictures });
  });
  await context.writeFile(request.path, await context.printToPdf(page));
};

type PngSize = { width: number; height?: number };
const pngSize = (request: ExportRequest): PngSize | undefined => request.width === undefined ? undefined : { width: request.width, ...(request.height !== undefined && { height: request.height }) };

/** A named slide of the loaded, measured deck. Shared by inspection and all-slide export. */
export async function renderSlidePng(win: DeckWindow, deck: ExportDeck, slideId: string, size?: PngSize): Promise<Buffer> {
  if (!deck.slides.some((slide) => slide.id === slideId)) throw new Error(`No slide ${slideId} in this presentation`);
  return win.capture({ slideId, elementId: null, mode: 'slide', box: { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H } }, size);
}

async function loadPngDeck(win: DeckWindow, prepared: Pick<Prepared, 'deck' | 'page'>): Promise<void> {
  const measured = await measurePass(win, prepared);
  await win.load(deckPage(prepared.deck, { ...prepared.page, mode: 'measure', measured }));
}

/** Render one named slide at the request's captured revision/version, releasing its document and window. */
export async function renderPresentationSlide(request: ExportRequest, context: ExportContext, deps: PresentationExportDeps, slideId: string): Promise<Buffer> {
  const prepared = await prepare(request, context, deps);
  try {
    return await withDeckWindow(deps.env, context.signal, async (win) => {
      await loadPngDeck(win, prepared);
      return renderSlidePng(win, prepared.deck, slideId, pngSize(request));
    });
  } finally { prepared.doc.destroy(); }
}

/** One preparation/window for every slide, including hidden slides; names sort in deck order. */
export async function renderAllSlidePngs(win: DeckWindow, prepared: Pick<Prepared, 'deck' | 'page'>, size?: PngSize): Promise<Record<string, Uint8Array>> {
  if (!prepared.deck.slides.length) throw new Error('the presentation has no slide to picture');
  await loadPngDeck(win, prepared);
  const digits = Math.max(2, String(prepared.deck.slides.length).length);
  const files: Record<string, Uint8Array> = {};
  for (const [index, slide] of prepared.deck.slides.entries()) files[`slide-${String(index + 1).padStart(digits, '0')}.png`] = await renderSlidePng(win, prepared.deck, slide.id, size);
  return files;
}

const png: Run = async (request, context, prepared, deps) => {
  const slideId = request.board ?? coverSlide(prepared.deck);
  if (!slideId) throw new Error('the presentation has no slide to picture');
  const bytes = await withDeckWindow(deps.env, context.signal, async (win) => {
    await loadPngDeck(win, prepared);
    return renderSlidePng(win, prepared.deck, slideId, pngSize(request));
  });
  await context.writeFile(request.path, bytes);
};

// The managed bundle stays in the store; library.saveAs publishes its PNGs as one folder, not a ZIP.
const pngs: Run = async (request, context, prepared, deps) => {
  const files = await withDeckWindow(deps.env, context.signal, (win) => renderAllSlidePngs(win, prepared, pngSize(request)));
  await context.writeFile(request.path, zipFiles(files));
};

const pptx: Run = async (request, context, prepared, deps) => {
  const variant = request.fonts ?? 'basic';
  if (variant === 'embedded') throw new Error('embedding uploaded fonts in a PPTX is not available yet; export with fonts "named" (the faces by name), "basic" or "pictures"');
  const { measured, pictures } = await withDeckWindow(deps.env, context.signal, async (win) => {
    const measured = await measurePass(win, prepared);
    const jobs = pictureJobs(measured, variant);
    const pictures = new Map<string, string>();
    if (jobs.length) {
      await win.load(deckPage(prepared.deck, { ...prepared.page, mode: 'measure', measured }));
      for (const job of jobs) pictures.set(job.key, pngUrl(await win.capture(job)));
    }
    return { measured, pictures };
  });
  const slides = pptxSlides(prepared.deck, measured, { variant, pictures, asset: prepared.page.asset });
  const themeXml = prepared.system.officeThemeXml(prepared.system.tokens, prepared.system.name, prepared.deck.overrides);
  await context.writeFile(request.path, await writePptx(slides, { title: prepared.deck.title, themeXml }));
};

// No window unless a group's member is placed so the model cannot say where (auto-sized, %, right or bottom): then the
// deck is measured and lowered again from the measure.
const claude: Run = async (request, context, prepared, deps) => {
  const assets = new Map([...prepared.assets].map(([ref, a]) => [ref, a.bytes]));
  const options = { resolveVar: prepared.resolveVar, assets };
  let files: Record<string, string | Uint8Array>;
  try {
    files = claudeDeckFiles(prepared.doc, options);
  } catch (error) {
    if (!(error instanceof MeasureNeeded)) throw error;
    const measured = await withDeckWindow(deps.env, context.signal, (win) => measurePass(win, prepared));
    files = claudeDeckFiles(prepared.doc, { ...options, measured });
  }
  await context.writeFile(request.path, zipFiles(files));
};

const RUNS = { html, pdf, png, pngs, pptx, claude } as const;

/** Registers the presentation's exporters (X31); the answer withdraws them. */
export function registerPresentationExporters(registry: Pick<ExporterRegistry, 'register'>, deps: PresentationExportDeps): () => void {
  const offs = Object.entries(RUNS).map(([format, run]) => {
    const exporter: Exporter = {
      kind: 'presentation',
      format: format as Exporter['format'],
      run: async (request, context) => {
        const prepared = await prepare(request, context, deps);
        try {
          await run(request, context, prepared, deps);
        } finally {
          prepared.doc.destroy();
        }
      },
    };
    return registry.register(exporter);
  });
  return () => offs.forEach((off) => off());
}
