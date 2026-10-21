// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12 "Standalone HTML", "PDF"; Decision Log 18): a deck as
// one HTML page of its own. Every slide is written from the model as the DOM canvas draws it (`CANVAS_CSS`, the
// section's under-layer, the dialect's own elements), with the deck's design-system tokens resolved to literals, its
// pictures and faces inlined as `data:`, and its embeds running in sandboxed frames with no network. Nothing on the page
// loads from anywhere (its CSP says so), so the file opens anywhere. P4-B2 D19 (docs/doperpowers/plans/
// 2026-10-21-p4-b2-slides-boards.md): a face's files are `faceFiles`'s, so a Google Fonts face the engine host saved in
// the deck's assets is inlined file by file as an upload is; one it has not saved (pending, or refused) is left out and
// draws as its fallback.
//
// The page has three modes:
// - `html`: the file the owner keeps: a keyboard viewer (arrows, Space, Home, End, F for full screen) over the visible
//   slides, each scaled to the window;
// - `print`: one 1920×1080 px page per visible slide, for the PDF printer (JavaScript off there, so each embed is drawn
//   as the picture the export window took of it);
// - `measure`: every slide (hidden ones too) stacked, for the export window to fit and measure (measure.ts) and to take
//   pictures of; the sized text boxes are marked for the fit.
// What depends on layout (an x-shape's outline, an x-connector's line, a text box's fitted size, a crop's view box) is
// drawn from a measurement of the same page: the `html` and `print` pages are written after a `measure` pass.
// Portable.
import { mapStyleMapAssets, slideAssetRefs } from '../asset-refs';
import { CANVAS_CSS } from '../canvas/css';
import { resolveVars } from '../css';
import { faceFiles, type DeckFace } from '../deck';
import { CONTAINER_TAGS, LIST_TAGS, TEXT_TAGS, type ElementIR, type SlideIR, type TextBlock } from '../ir';
import { readDeckJson, readSlide, slideOrder } from '../model';
import { cropStyle, embedDocument } from '../render-rules';
import { canonicalOrder, escAttr, escText, partition, serializeInline } from '../serialize';
import type { Doc } from '../../yjs';
import { slideScalars } from '../../yjs/slides'; // P3-E (E1 M5): a design board's size
import { connectorSvg, iconSvg, shapeSvg } from './glyphs-svg';
import { containSvgMarkup } from './svg-contain';
import type { MeasuredDeck, MeasuredElement } from './measure';

export interface ExportSlide {
  id: string;
  ir: SlideIR;
  hidden: boolean;
  transition: 'fade' | 'push' | 'magic' | null;
  notes: string;
  /**
   * P3-E (E1 M5, X27 additive; E0's finding (e)): a design board's size, its node's plain `w` and `h` keys (both positive
   * numbers, as the canvas reads them); absent for a deck's slide, which keeps 1920×1080. A sized slide's frame and
   * section are written at it whatever width or height the section's style says, the section marked `data-board`, and
   * in `print` mode it prints on a page of its own size.
   */
  size?: { w: number; h: number };
}

export interface ExportDeck {
  title: string;
  /** The cover slide's id when the deck names one it holds. */
  cover: string | null;
  slides: ExportSlide[];
  faces: Record<string, DeckFace>;
  /** The deck's design-system overrides (X28), set over the system's tokens. */
  overrides: Record<string, string>;
}

const TRANSITIONS = new Set(['fade', 'push', 'magic']);

/** The deck as the exporters read it: its slides in order, each as IR. */
export function exportDeckOf(doc: Doc, fallbackTitle: string): ExportDeck {
  const deck = readDeckJson(doc);
  const slides = slideOrder(doc).map((id): ExportSlide => {
    const ir = readSlide(doc, id);
    const transition = ir.attrs['data-transition'];
    const { w, h } = slideScalars(doc, id); // P3-E (E1 M5): a design board's size
    const size = typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0 ? { size: { w, h } } : {};
    return { id, ir, hidden: ir.attrs.hidden !== undefined, transition: transition && TRANSITIONS.has(transition) ? (transition as ExportSlide['transition']) : null, notes: ir.notes, ...size };
  });
  const title = typeof deck.title === 'string' && deck.title.trim() ? deck.title : fallbackTitle;
  const cover = typeof deck.cover === 'string' && slides.some((s) => s.id === deck.cover) ? deck.cover : null;
  return { title, cover, slides, faces: deck.faces ?? {}, overrides: deck.dsOverrides ?? {} };
}

/** Every `assets/<name>` the deck draws (a picture's source, a style's url) or loads a face from (each of its files). */
export function deckAssetRefs(deck: ExportDeck): string[] {
  const refs = new Set<string>();
  for (const slide of deck.slides) for (const ref of slideAssetRefs(slide.ir)) refs.add(ref);
  for (const face of Object.values(deck.faces)) for (const file of faceFiles(face)) refs.add(file.src);
  return [...refs].sort();
}

/** A literal style with its assets' urls inlined as `data:` (A13); one the deck lacks stays named, and loads nothing. */
const inlinedStyle = (style: Readonly<Record<string, string>>, options: PageOptions): Record<string, string> =>
  mapStyleMapAssets(literalStyle(style, options.resolveVar), (ref) => {
    const data = options.asset(ref);
    return data ? `url("${data}")` : null;
  });

/** The size an element is laid out at, before its own and its ancestors' transforms scale it (its box is drawn size). */
const layoutSize = (m: MeasuredElement): { w: number; h: number } => ({ w: m.box.w / (m.scale?.[0] || 1), h: m.box.h / (m.scale?.[1] || 1) });

/**
 * The deck's faces as `@font-face` blocks, one per file with its weight and style when it has them (a fetched face's),
 * each file inlined (a file the export does not have is left out).
 */
export function deckFacesCss(deck: ExportDeck, asset: (ref: string) => string | null): string {
  const blocks: string[] = [];
  for (const face of Object.values(deck.faces)) {
    if (typeof face.family !== 'string') continue;
    const family = face.family.replace(/["\\\n]/g, '');
    for (const file of faceFiles(face)) {
      const url = asset(file.src);
      if (!url) continue;
      blocks.push(`@font-face { font-family: "${family}"; src: url("${url}");${file.weight ? ` font-weight: ${file.weight};` : ''}${file.style ? ` font-style: ${file.style};` : ''} }`);
    }
  }
  return blocks.join('\n');
}

export type PageMode = 'html' | 'print' | 'measure';

export interface PageOptions {
  mode: PageMode;
  /** A design-system token's literal value at the deck's scale with its overrides (the mirror's `deckTokenValues`). */
  resolveVar: (name: string) => string | undefined;
  /** An asset's `data:` URL, null when the deck has no such asset. */
  asset: (ref: string) => string | null;
  /** `@font-face` blocks with their sources inlined: the system's faces, then the deck's own. */
  facesCss: string;
  /** The measure pass of this deck (`html` and `print`): what depends on layout is drawn from it. */
  measured?: MeasuredDeck;
  /** Pictures of embeds by slide and element (`print`: JavaScript is off in the printer). */
  pictures?: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** The slides to write, in deck order (default: the visible ones; every one when measuring). */
  only?: readonly string[];
  /**
   * P3-E (E1 M5; the parent's Decision Log 11 (2)): style rules written after the page's own, from trusted code alone
   * (the design's screen type defaults and its scaled draw); empty by default.
   */
  extraCss?: string;
}

// The page's own policy: nothing but itself and `data:`.
const PAGE_CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src 'self' data: about:";

const PAGE_CSS: Record<PageMode, string> = {
  html: `html, body { margin: 0; padding: 0; background: #202124; }
.maws-frame { width: 1920px; height: 1080px; overflow: hidden; margin: 0 auto 24px; }
body.viewer { overflow: hidden; height: 100vh; }
body.viewer .maws-frame { display: none; position: absolute; left: 50%; top: 50%; margin: 0; transform: translate(-50%, -50%) scale(var(--maws-scale, 1)); }
body.viewer .maws-frame[data-current] { display: block; }`,
  print: `@page { size: 1920px 1080px; margin: 0; }
html, body { margin: 0; padding: 0; background: #ffffff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.maws-frame { width: 1920px; height: 1080px; overflow: hidden; break-after: page; }
.maws-frame:last-child { break-after: auto; }
.maws-slide x-embed > img { display: block; width: 100%; height: 100%; }`,
  measure: `html, body { margin: 0; padding: 0; background: transparent; }
.maws-frame { width: 1920px; height: 1080px; overflow: hidden; }
body[data-shown] .maws-frame { display: none; }
body[data-shown] .maws-frame[data-shown] { display: block; }`,
};

// The viewer: one slide at a time, scaled to the window; the slide's number in the address's hash.
const VIEWER = `(function () {
  var frames = Array.prototype.slice.call(document.querySelectorAll('.maws-frame'));
  if (!frames.length) return;
  var at = 0;
  document.body.classList.add('viewer');
  function fit() { document.documentElement.style.setProperty('--maws-scale', String(Math.min(innerWidth / 1920, innerHeight / 1080))); }
  function show(n) {
    at = Math.max(0, Math.min(frames.length - 1, n));
    frames.forEach(function (f, k) { if (k === at) f.setAttribute('data-current', ''); else f.removeAttribute('data-current'); });
    try { history.replaceState(null, '', '#' + (at + 1)); } catch (e) {}
  }
  addEventListener('resize', fit);
  addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === ' ' || k === 'PageDown') show(at + 1);
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') show(at - 1);
    else if (k === 'Home') show(0);
    else if (k === 'End') show(frames.length - 1);
    else if (k === 'f' || k === 'F') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); }
    else return;
    e.preventDefault();
  });
  fit();
  show((parseInt(location.hash.slice(1), 10) || 1) - 1);
})();`;

interface Writer {
  /** Each svg drawing's number on the page by element id (this slide's). */
  drawings: ReadonlyMap<string, number>;
  options: PageOptions;
  measured: Map<string, MeasuredElement>;
  pictures: ReadonlyMap<string, string> | undefined;
}

/** A style map with every token resolved; a property neither the system nor its fallback gives a value is left out. */
export function literalStyle(style: Readonly<Record<string, string>>, resolveVar: (name: string) => string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(style)) {
    const literal = resolveVars(v, resolveVar);
    if (literal !== null) out[k] = literal;
  }
  return out;
}

const styleText = (style: Readonly<Record<string, string>>) =>
  Object.entries(style)
    .map(([k, v]) => `${k}:${v}`)
    .join('; ');

/** `data-crop="ZOOM X% Y%"`: the zoom and the position as fractions. */
export function cropOf(value: string | undefined): { zoom: number; x: number; y: number } | null {
  const m = value === undefined ? null : /^(\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)% (-?\d+(?:\.\d+)?)%$/.exec(value);
  return m ? { zoom: Number(m[1]), x: Number(m[2]) / 100, y: Number(m[3]) / 100 } : null;
}

/** A crop's view box in the picture's own pixels: `1/zoom` of it, placed at the focus point (`cropStyle`'s region). */
export function cropViewBox(natural: { w: number; h: number }, crop: { zoom: number; x: number; y: number }): { x: number; y: number; w: number; h: number } {
  const w = natural.w / crop.zoom;
  const h = natural.h / crop.zoom;
  return { x: (natural.w - w) * Math.min(1, Math.max(0, crop.x)), y: (natural.h - h) * Math.min(1, Math.max(0, crop.y)), w, h };
}

function textHtml(tag: string, blocks: TextBlock[], resolveVar: (name: string) => string | undefined): string {
  const o = { resolveVar };
  return LIST_TAGS.has(tag as never) ? blocks.map((b) => `<li>${serializeInline(b.inline, o)}</li>`).join('') : serializeInline(blocks[0]?.inline ?? [], o);
}

function elementHtml(el: ElementIR, w: Writer, under: boolean): string {
  const { options } = w;
  const style = inlinedStyle(el.style, options);
  const measured = el.id ? w.measured.get(el.id) : undefined;
  const attrs: string[] = [];
  if (el.id) attrs.push(`data-eid="${escAttr(el.id)}"`);
  if (under) attrs.push('data-layer="under"');
  // an svg drawing contained as the canvas contains it: its stylesheets and ids its own on the one page (A16)
  // its scope is the drawing's number in the deck (`esvg<n>`, so `esvg<n>_<id>` never meets another drawing's renamed id)
  const drawing = el.tag === 'svg' ? containSvgMarkup(el.attrs, el.raw ?? '', `esvg${w.drawings.get(el.id) ?? 0}`) : null;
  const own = drawing?.attrs ?? el.attrs;
  for (const k of Object.keys(own).sort()) {
    if (el.tag === 'img' && k === 'src') continue;
    attrs.push(own[k] === '' ? k : `${k}="${escAttr(own[k]!)}"`);
  }
  // a sized text box: marked for the measure pass's fit, or (once measured) drawn at the size it fitted
  if (TEXT_TAGS.has(el.tag) && style.height !== undefined && style.height !== 'auto') {
    if (!options.measured) attrs.push(`data-fit-box="${escAttr(el.attrs['data-fit'] ?? 'shrink')}"`);
    else if (measured?.fit?.mode === 'shrink') Object.assign(style, { 'font-size': `${measured.fit.size}px`, ...(measured.fit.clipped && { overflow: 'hidden' }) });
    else if (measured?.fit?.mode === 'grow') Object.assign(style, { 'min-height': style.height, height: 'auto' });
  }
  let inner = '';
  if (el.tag === 'img') {
    const src = el.attrs.src?.startsWith('assets/') ? options.asset(el.attrs.src) : null;
    attrs.push(src ? `src="${escAttr(src)}"` : `data-placeholder="${escAttr(el.attrs.src ?? '')}"`);
    Object.assign(style, cropStyle(el.attrs['data-crop']) ?? {}); // the canvas's crop (render-rules.ts)
  } else if (drawing) inner = drawing.inner;
  else if (el.tag === 'x-icon') inner = iconSvg(el.attrs.name);
  else if (el.tag === 'x-embed') {
    const picture = w.pictures?.get(el.id);
    inner = picture ? `<img alt="" src="${escAttr(picture)}">` : `<iframe sandbox="allow-scripts" tabindex="-1" srcdoc="${escAttr(embedDocument(el.raw ?? ''))}"></iframe>`;
  } else if (el.tag === 'x-shape' && el.attrs.kind !== 'rect' && measured) {
    // drawn inside the element, which its transforms and its ancestors' still scale: at its layout size (A4)
    const { w: lw, h: lh } = layoutSize(measured);
    inner = shapeSvg(style, el.attrs.kind ?? 'rect', lw, lh);
  } else if (el.tag === 'x-connector' && measured) {
    const { w: lw, h: lh } = layoutSize(measured);
    inner = connectorSvg(style, el.attrs, lw, lh);
  }
  else if (el.text) inner = textHtml(el.tag, el.text, options.resolveVar);
  else if (CONTAINER_TAGS.has(el.tag)) inner = (el.tag === 'div' ? canonicalOrder(el.children) : el.children).map((c) => elementHtml(c, w, false)).join('');
  const css = styleText(style);
  if (css) attrs.push(`style="${escAttr(css)}"`);
  const head = `<${el.tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`;
  return el.tag === 'img' || el.tag === 'hr' ? head : `${head}${inner}</${el.tag}>`;
}

/**
 * Every svg drawing of the deck numbered in deck order, hidden slides and slides a pass leaves out included, so the
 * measure, html and print passes give each drawing the same number (A16).
 */
function drawingNumbers(deck: ExportDeck): Map<string, Map<string, number>> {
  const numbers = new Map<string, Map<string, number>>();
  let n = 0;
  for (const slide of deck.slides) {
    const own = new Map<string, number>();
    const walk = (els: ElementIR[]) => {
      for (const el of els) {
        if (el.tag === 'svg') own.set(el.id, ++n);
        walk(el.children);
      }
    };
    walk(slide.ir.children);
    numbers.set(slide.id, own);
  }
  return numbers;
}

function slideHtml(slide: ExportSlide, options: PageOptions, drawings: ReadonlyMap<string, number>): string {
  const measuredSlide = options.measured?.slides.find((s) => s.id === slide.id);
  const w: Writer = { drawings, options, measured: new Map((measuredSlide?.elements ?? []).map((e) => [e.id, e])), pictures: options.pictures?.get(slide.id) };
  const attrs = [`class="maws-slide"`, `data-slide="${escAttr(slide.id)}"`];
  for (const k of Object.keys(slide.ir.attrs).sort()) {
    if (k === 'hidden') attrs.push('data-hidden=""');
    else attrs.push(`${k}="${escAttr(slide.ir.attrs[k]!)}"`);
  }
  // P3-E (E1 M5): a board's frame and section at its manifest size, over any width or height its own style says (the
  // canvas's rule), the section marked a board for the design's type defaults
  const style = inlinedStyle(slide.ir.style, options);
  const sized = slide.size ? `width:${slide.size.w}px; height:${slide.size.h}px` : '';
  if (slide.size) {
    delete style.width;
    delete style.height;
    if (slide.ir.attrs['data-board'] === undefined) attrs.splice(1, 0, 'data-board=""');
  }
  const css = [sized, styleText(style)].filter(Boolean).join('; ');
  if (css) attrs.push(`style="${escAttr(css)}"`);
  const { under, flow, over } = partition(slide.ir.children);
  const children = [...under.map((c) => elementHtml(c, w, true)), ...[...flow, ...over].map((c) => elementHtml(c, w, false))].join('');
  const frame = slide.size ? ` data-size="${sizeKey(slide.size)}" style="${sized}"` : ''; // P3-E
  return `<div class="maws-frame" data-frame="${escAttr(slide.id)}"${frame}><section ${attrs.join(' ')}>${children}</section></div>`;
}

/** P3-E (E1 M5): a board size's key (`<w>x<h>`) and its named print page (an identifier: a fraction's point as `_`). */
const sizeKey = (size: { w: number; h: number }) => `${size.w}x${size.h}`;
const pageName = (size: { w: number; h: number }) => `board-${sizeKey(size).replace(/[^A-Za-z0-9_-]/g, '_')}`;

/** P3-E (E1 M5): in `print` mode, one named page per board size, so the printer pages each board at its own size. */
function boardPages(slides: readonly ExportSlide[]): string {
  const sizes = new Map<string, { w: number; h: number }>();
  for (const s of slides) if (s.size) sizes.set(sizeKey(s.size), s.size);
  return [...sizes.values()].map((size) => `@page ${pageName(size)} { size: ${size.w}px ${size.h}px; margin: 0; }\n.maws-frame[data-size="${sizeKey(size)}"] { page: ${pageName(size)}; }`).join('\n');
}

/** The deck as one page in `mode` (see the header). */
export function deckPage(deck: ExportDeck, options: PageOptions): string {
  const ids = options.only ? new Set(options.only) : null;
  const slides = deck.slides.filter((s) => (ids ? ids.has(s.id) : options.mode === 'measure' || !s.hidden));
  const drawings = drawingNumbers(deck);
  const body = slides.map((s) => slideHtml(s, options, drawings.get(s.id) ?? new Map())).join('\n');
  const script = options.mode === 'html' ? `<script>${VIEWER}</script>` : '';
  const extra = [options.mode === 'print' ? boardPages(slides) : '', options.extraCss ?? ''].filter(Boolean).map((css) => `\n${css}`).join(''); // P3-E (E1 M5)
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escAttr(PAGE_CSP)}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escText(deck.title)}</title>`,
    `<style>${options.facesCss}\n${CANVAS_CSS}\n${PAGE_CSS[options.mode]}${extra}</style>`, // P3-E: `extra`
    `</head><body data-mode="${options.mode}">`,
    body,
    `${script}</body></html>`,
    '',
  ].join('\n');
}
