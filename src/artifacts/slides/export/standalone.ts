// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12 "Standalone HTML", "PDF"; Decision Log 18): a deck as
// one HTML page of its own. Every slide is written from the model as the DOM canvas draws it (`CANVAS_CSS`, the
// section's under-layer, the dialect's own elements), with the deck's design-system tokens resolved to literals, its
// pictures and uploaded faces inlined as `data:`, and its embeds running in sandboxed frames with no network. Nothing on
// the page loads from anywhere (its CSP says so), so the file opens anywhere.
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
import { CANVAS_CSS } from '../canvas/css';
import { resolveVars } from '../css';
import type { DeckFace } from '../deck';
import { CONTAINER_TAGS, LIST_TAGS, TEXT_TAGS, type ElementIR, type SlideIR, type TextBlock } from '../ir';
import { readDeckJson, readSlide, slideOrder } from '../model';
import { canonicalOrder, escAttr, escText, partition, serializeInline } from '../serialize';
import type { Doc } from '../../yjs';
import { connectorSvg, iconSvg, shapeSvg } from './glyphs-svg';
import type { MeasuredDeck, MeasuredElement } from './measure';

export interface ExportSlide {
  id: string;
  ir: SlideIR;
  hidden: boolean;
  transition: 'fade' | 'push' | 'magic' | null;
  notes: string;
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
    return { id, ir, hidden: ir.attrs.hidden !== undefined, transition: transition && TRANSITIONS.has(transition) ? (transition as ExportSlide['transition']) : null, notes: ir.notes };
  });
  const title = typeof deck.title === 'string' && deck.title.trim() ? deck.title : fallbackTitle;
  const cover = typeof deck.cover === 'string' && slides.some((s) => s.id === deck.cover) ? deck.cover : null;
  return { title, cover, slides, faces: deck.faces ?? {}, overrides: deck.dsOverrides ?? {} };
}

/** Every `assets/<name>` the deck draws or loads a face from. */
export function deckAssetRefs(deck: ExportDeck): string[] {
  const refs = new Set<string>();
  const walk = (els: ElementIR[]) => {
    for (const el of els) {
      if (el.tag === 'img' && el.attrs.src?.startsWith('assets/')) refs.add(el.attrs.src);
      walk(el.children);
    }
  };
  for (const slide of deck.slides) walk(slide.ir.children);
  for (const face of Object.values(deck.faces)) if (typeof face.src === 'string' && face.src.startsWith('assets/')) refs.add(face.src);
  return [...refs].sort();
}

/** The deck's uploaded faces as `@font-face` blocks, their files inlined (a face whose file is not there is left out). */
export function deckFacesCss(deck: ExportDeck, asset: (ref: string) => string | null): string {
  const blocks: string[] = [];
  for (const face of Object.values(deck.faces)) {
    const url = typeof face.src === 'string' ? asset(face.src) : null;
    if (!url || typeof face.family !== 'string') continue;
    blocks.push(`@font-face { font-family: "${face.family.replace(/["\\\n]/g, '')}"; src: url("${url}"); }`);
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
}

// An x-embed's page: inline script and style only, no network (the canvas's `embedDocument`).
const EMBED_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:";
const embedPage = (raw: string): string => `<!doctype html><meta http-equiv="Content-Security-Policy" content="${escAttr(EMBED_CSP)}"><style>html,body{margin:0;height:100%;overflow:hidden}</style>${raw}`;
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

/** A crop's view box in the picture's own pixels: `1/zoom` of it, placed at the position. */
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
  const style = literalStyle(el.style, options.resolveVar);
  const measured = el.id ? w.measured.get(el.id) : undefined;
  const attrs: string[] = [];
  if (el.id) attrs.push(`data-eid="${escAttr(el.id)}"`);
  if (under) attrs.push('data-layer="under"');
  for (const k of Object.keys(el.attrs).sort()) {
    if (el.tag === 'img' && k === 'src') continue;
    attrs.push(el.attrs[k] === '' ? k : `${k}="${escAttr(el.attrs[k]!)}"`);
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
    const crop = cropOf(el.attrs['data-crop']);
    if (crop) {
      Object.assign(style, { 'object-fit': 'cover', 'object-position': `${crop.x * 100}% ${crop.y * 100}%` });
      const natural = measured?.image?.natural;
      if (natural && natural.w > 0 && natural.h > 0 && crop.zoom > 1) {
        const v = cropViewBox(natural, crop);
        style['object-view-box'] = `inset(${v.y}px ${natural.w - v.x - v.w}px ${natural.h - v.y - v.h}px ${v.x}px)`;
      }
    }
  } else if (el.tag === 'svg') inner = el.raw ?? '';
  else if (el.tag === 'x-icon') inner = iconSvg(el.attrs.name);
  else if (el.tag === 'x-embed') {
    const picture = w.pictures?.get(el.id);
    inner = picture ? `<img alt="" src="${escAttr(picture)}">` : `<iframe sandbox="allow-scripts" tabindex="-1" srcdoc="${escAttr(embedPage(el.raw ?? ''))}"></iframe>`;
  } else if (el.tag === 'x-shape' && el.attrs.kind !== 'rect' && measured) inner = shapeSvg(style, el.attrs.kind ?? 'rect', measured.box.w, measured.box.h);
  else if (el.tag === 'x-connector' && measured) inner = connectorSvg(style, el.attrs, measured.box.w, measured.box.h);
  else if (el.text) inner = textHtml(el.tag, el.text, options.resolveVar);
  else if (CONTAINER_TAGS.has(el.tag)) inner = (el.tag === 'div' ? canonicalOrder(el.children) : el.children).map((c) => elementHtml(c, w, false)).join('');
  const css = styleText(style);
  if (css) attrs.push(`style="${escAttr(css)}"`);
  const head = `<${el.tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`;
  return el.tag === 'img' || el.tag === 'hr' ? head : `${head}${inner}</${el.tag}>`;
}

function slideHtml(slide: ExportSlide, options: PageOptions): string {
  const measuredSlide = options.measured?.slides.find((s) => s.id === slide.id);
  const w: Writer = { options, measured: new Map((measuredSlide?.elements ?? []).map((e) => [e.id, e])), pictures: options.pictures?.get(slide.id) };
  const attrs = [`class="maws-slide"`, `data-slide="${escAttr(slide.id)}"`];
  for (const k of Object.keys(slide.ir.attrs).sort()) {
    if (k === 'hidden') attrs.push('data-hidden=""');
    else attrs.push(`${k}="${escAttr(slide.ir.attrs[k]!)}"`);
  }
  const css = styleText(literalStyle(slide.ir.style, options.resolveVar));
  if (css) attrs.push(`style="${escAttr(css)}"`);
  const { under, flow, over } = partition(slide.ir.children);
  const children = [...under.map((c) => elementHtml(c, w, true)), ...[...flow, ...over].map((c) => elementHtml(c, w, false))].join('');
  return `<div class="maws-frame" data-frame="${escAttr(slide.id)}"><section ${attrs.join(' ')}>${children}</section></div>`;
}

/** The deck as one page in `mode` (see the header). */
export function deckPage(deck: ExportDeck, options: PageOptions): string {
  const ids = options.only ? new Set(options.only) : null;
  const slides = deck.slides.filter((s) => (ids ? ids.has(s.id) : options.mode === 'measure' || !s.hidden));
  const body = slides.map((s) => slideHtml(s, options)).join('\n');
  const script = options.mode === 'html' ? `<script>${VIEWER}</script>` : '';
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escAttr(PAGE_CSP)}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escText(deck.title)}</title>`,
    `<style>${options.facesCss}\n${CANVAS_CSS}\n${PAGE_CSS[options.mode]}</style>`,
    `</head><body data-mode="${options.mode}">`,
    body,
    `${script}</body></html>`,
    '',
  ].join('\n');
}
