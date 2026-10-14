// The presentation kind's exporters in A's export registry (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M9,
// D12; parent §4.5, §4.8, Decision Log 17; X31): `presentation` × `html`, `pdf`, `pptx`, `claude` and `png`, reached by
// the agent's `artifact_export` and the editor's and the library's Export alike. Each reads the deck's state as the
// export took it (the live revision or a version's), the design system governing it (the version's pin, else D's default
// chain over the live store: the deck's own system, its Space's default, the owner's, the house system, the bundled
// floor) with the deck's overrides, and the uploaded assets it names; the portable halves under
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
import { readOrigin, readSystem } from '@artifacts/design-system/model';
import { officeThemeXml } from '@artifacts/design-system/office';
import type { TokenSet } from '@artifacts/design-system/tokens';
import { builtinView } from '@artifacts/design-system/view';
import { claudeDeckFiles } from '@artifacts/slides/export/claude';
import { measureDeckPage, type MeasureArgs, type MeasuredDeck } from '@artifacts/slides/export/measure';
import { pictureJobs, pptxSlides, writePptx, type PictureJob } from '@artifacts/slides/export/pptx';
import { deckAssetRefs, deckFacesCss, deckPage, exportDeckOf, type ExportDeck, type PageOptions } from '@artifacts/slides/export/standalone';
import { TEXT_TAGS } from '@artifacts/slides/ir';
import { deckTokenValues } from '@artifacts/slides/mirror';
import { HOUSE_KEY } from '@artifacts/types/design_system/defaults';
import { applyV2, newDoc, type Doc } from '@artifacts/yjs';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import { mimeOf } from '@shared/files/mime';
import { loadSettled, openCaptureWindow } from '../artifacts/capture';
import { printRequestAllowed, type Exporter, type ExportContext, type ExporterRegistry, type ExportRequest } from '../artifacts/export';
import { restrictRequests, type SeamEnv } from '../artifacts/policies';
import { zipFiles } from '../design-systems/zip';

export interface PresentationExportDeps {
  /** The engine host's commands (the deck's row and versions, the design systems' rows, states and assets). */
  call<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>;
  /** The owner's design-system defaults (settings slot 14): the chain's Space and owner links. */
  defaults(): { owner: string | null; spaces: Record<string, string> };
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

export interface DeckSystem {
  /** The system's id, null for the bundled floor. */
  id: string | null;
  name: string;
  tokens: TokenSet;
  /** `components/document.css`, whose `@font-face` blocks are the system's faces. */
  documentCss: string | undefined;
}

function systemOf(id: string, bytes: Uint8Array): DeckSystem {
  const doc = newDoc();
  try {
    applyV2(doc, bytes);
    const state = readSystem(doc);
    return { id, name: state.meta?.name ?? 'Design system', tokens: state.tokens, documentCss: state.files[DOCUMENT_CSS_PATH] };
  } finally {
    doc.destroy();
  }
}

function floor(): DeckSystem {
  const view = builtinView();
  return { id: null, name: view.name || 'MAWS', tokens: view.tokens, documentCss: undefined };
}

/**
 * The system a deck exports in: a version's pin (X29) when the request names a version that has one, else the live
 * chain (D's `governingSystem` order, as `src/engine-host/design-systems/chain.ts` resolves it over the store): the deck's
 * own system, its Space's default, the owner's default, the house system (the earliest-created live system whose origin
 * key is `maws`), else the bundled floor. A missing or deleted id falls through.
 */
export async function deckSystem(request: Pick<ExportRequest, 'artifactId' | 'versionId'>, deps: PresentationExportDeps): Promise<DeckSystem> {
  if (request.versionId !== undefined) {
    const { versions } = await required(deps, 'artifacts.versions', { artifactId: request.artifactId });
    const pin = versions.find((v) => v.id === request.versionId)?.designSystemRef;
    if (pin) return systemOf(pin.id, (await required(deps, 'artifacts.versionState', { artifactId: pin.id, seq: pin.versionSeq })).bytes);
  }
  const { artifact } = await required(deps, 'artifacts.get', { artifactId: request.artifactId });
  const live = async (id: string) => {
    const found = await deps.call('artifacts.get', { artifactId: id });
    return found.ok && found.value.artifact?.kind === 'design_system';
  };
  const { owner, spaces } = deps.defaults();
  const space = artifact?.spaceId != null && Object.hasOwn(spaces, artifact.spaceId) ? spaces[artifact.spaceId] : undefined;
  for (const id of [artifact?.designSystemId, space, owner]) {
    if (id && (await live(id))) return systemOf(id, (await required(deps, 'artifacts.state', { artifactId: id })).bytes);
  }
  const { artifacts: systems } = await required(deps, 'artifacts.list', { filter: { kind: 'design_system' } });
  for (const system of [...systems].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const { bytes } = await required(deps, 'artifacts.state', { artifactId: system.id });
    const doc: Doc = newDoc();
    try {
      applyV2(doc, bytes);
      if (readOrigin(doc)?.key === HOUSE_KEY) return systemOf(system.id, bytes);
    } finally {
      doc.destroy();
    }
  }
  return floor();
}

const dataUrl = (bytes: Uint8Array, mime: string) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

/** The system's faces, their files inlined (a face whose file cannot be read is left out). */
async function systemFacesCss(system: DeckSystem, deps: PresentationExportDeps): Promise<string> {
  if (!system.id || !system.documentCss) return '';
  const urls = new Map<string, string>();
  for (const ref of new Set(systemFaces(system.documentCss, system.tokens).flatMap((face) => face.refs))) {
    const found = await deps.call('artifacts.content', { artifactId: system.id, path: ref });
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

// The page's state for one picture: only the job's slide shown at the top, and (for an element) everything but the
// element hidden, its own rotation undone (the mapping rotates the picture), its text transparent when only its paint is
// wanted. Answers after two frames, so the capture sees it painted.
const STAGE = (slideId: string, elementId: string | null, mode: PictureJob['mode']) => `(() => {
  const slide = ${JSON.stringify(slideId)}, eid = ${JSON.stringify(elementId)}, mode = ${JSON.stringify(mode)};
  document.body.setAttribute('data-shown', '');
  for (const f of document.querySelectorAll('.maws-frame')) { if (f.getAttribute('data-frame') === slide) f.setAttribute('data-shown', ''); else f.removeAttribute('data-shown'); }
  let st = document.getElementById('maws-stage');
  if (!st) { st = document.createElement('style'); st.id = 'maws-stage'; document.head.appendChild(st); }
  const on = '.maws-frame[data-shown] ';
  const el = eid ? on + '[data-eid="' + CSS.escape(eid) + '"]' : '';
  st.textContent = mode === 'slide' ? '' : mode === 'background'
    ? on + '.maws-slide * { visibility: hidden !important; }'
    : on + '.maws-slide { background: transparent !important; box-shadow: none !important; }\\n' + on + '.maws-slide * { visibility: hidden !important; opacity: 1 !important; }\\n'
      + el + ' { visibility: visible !important; transform: none !important; opacity: 1 !important;' + (mode === 'self' ? ' color: transparent !important;' : '') + ' }\\n'
      + (mode === 'tree' ? el + ' * { visibility: visible !important; }' : '');
  scrollTo(0, 0);
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))));
})()`;

/** A hidden export window for the length of `use`, destroyed when it ends or `signal` aborts. */
export async function withDeckWindow<T>(env: SeamEnv, signal: AbortSignal, use: (win: DeckWindow) => Promise<T>): Promise<T> {
  if (signal.aborted) throw new Error('the export was cancelled');
  const dir = await mkdtemp(join(tmpdir(), 'maws-deck-'));
  const file = join(dir, 'deck.html');
  const url = pathToFileURL(file).href;
  let win: BrowserWindow | null = null;
  let unrestrict = () => {};
  const destroy = () => {
    if (win && !win.isDestroyed()) win.destroy();
  };
  try {
    if (signal.aborted) throw new Error('the export was cancelled');
    win = openCaptureWindow(SLIDE_W, SLIDE_H, env);
    signal.addEventListener('abort', destroy, { once: true });
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
      measure: async () => (await live().webContents.executeJavaScript(`(${String(measureDeckPage)})(${JSON.stringify(MEASURE_ARGS)})`, true)) as MeasuredDeck,
      capture: async (job, size) => {
        const w = live();
        await w.webContents.executeJavaScript(STAGE(job.slideId, job.elementId, job.mode), true);
        const x = Math.max(0, Math.floor(job.box.x));
        const y = Math.max(0, Math.floor(job.box.y));
        const rect = { x, y, width: Math.max(1, Math.min(SLIDE_W - x, Math.ceil(job.box.x + job.box.w) - x)), height: Math.max(1, Math.min(SLIDE_H - y, Math.ceil(job.box.y + job.box.h) - y)) };
        let image = await w.webContents.capturePage(rect);
        if (size?.width !== undefined) image = image.resize({ width: size.width, ...(size.height !== undefined && { height: size.height }), quality: 'best' });
        return image.toPNG();
      },
    });
  } finally {
    signal.removeEventListener('abort', destroy);
    unrestrict();
    destroy();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** The measure pass: the page loaded in `measure` mode, fitted and measured. */
async function measurePass(win: DeckWindow, prepared: Prepared): Promise<MeasuredDeck> {
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

const png: Run = async (request, context, prepared, deps) => {
  const slideId = coverSlide(prepared.deck);
  if (!slideId) throw new Error('the presentation has no slide to picture');
  const bytes = await withDeckWindow(deps.env, context.signal, async (win) => {
    const measured = await measurePass(win, prepared);
    await win.load(deckPage(prepared.deck, { ...prepared.page, mode: 'measure', measured }));
    return win.capture({ slideId, elementId: null, mode: 'slide', box: { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H } }, request.width === undefined ? undefined : { width: request.width, ...(request.height !== undefined && { height: request.height }) });
  });
  await context.writeFile(request.path, bytes);
};

const pptx: Run = async (request, context, prepared, deps) => {
  const variant = request.fonts ?? 'named';
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
  const themeXml = officeThemeXml(prepared.system.tokens, prepared.system.name, prepared.deck.overrides);
  await context.writeFile(request.path, await writePptx(slides, { title: prepared.deck.title, themeXml }));
};

const claude: Run = async (request, context, prepared) => {
  const assets = new Map([...prepared.assets].map(([ref, a]) => [ref, a.bytes]));
  await context.writeFile(request.path, zipFiles(claudeDeckFiles(prepared.doc, { resolveVar: prepared.resolveVar, assets })));
};

const RUNS = { html, pdf, png, pptx, claude } as const;

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
