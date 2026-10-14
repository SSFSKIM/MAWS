// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Canvas", D6): one model element as DOM, and the
// size-dependent drawing of the dialect's own elements (x-shape outlines and x-connector lines need their box, so they
// are drawn in the canvas's layout pass, after the slide has laid out).
import { connectorHeads, connectorRoute, headPolygon, ICON_GLYPHS, isStrokeOnly, shapePath, splitBorder, type Point } from '../glyphs';
import { LIST_TAGS, TEXT_TAGS, type TextBlock } from '../ir';
import type { FlatElement } from '../model';
import { escAttr, serializeInline } from '../serialize';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** What the canvas resolves an image's `src` through: an uploaded asset's URL (`assets/<name>`), else null. */
export type AssetUrl = (ref: string) => string | null;

// An x-embed runs in a sandboxed frame with no network: inline script and style only (D8, Claude's "no network").
const EMBED_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:";
export const embedDocument = (raw: string): string => `<!doctype html><meta http-equiv="Content-Security-Policy" content="${escAttr(EMBED_CSP)}"><style>html,body{margin:0;height:100%;overflow:hidden}</style>${raw}`;

/** The element's node, its inline style and attributes as the model holds them (the section's `hidden` excepted). */
export function createNode(document: Document, e: FlatElement, text: TextBlock[] | undefined, assetUrl: AssetUrl, thumbnail = false): HTMLElement {
  let n: HTMLElement;
  if (e.tag === 'svg') {
    // the opaque markup parses in the SVG namespace through a template, as it does in the file
    const t = document.createElement('template');
    t.innerHTML = `<svg${Object.entries(e.attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('')}>${e.raw ?? ''}</svg>`;
    n = (t.content.firstElementChild as HTMLElement | null) ?? document.createElement('div');
  } else {
    n = document.createElement(e.tag);
    for (const [k, v] of Object.entries(e.attrs)) if (!(e.tag === 'img' && k === 'src')) n.setAttribute(k, v);
  }
  n.dataset.eid = e.id;
  for (const [k, v] of Object.entries(e.style)) n.style.setProperty(k, v);
  if (TEXT_TAGS.has(e.tag)) renderText(n, e.tag, text ?? []);
  else if (e.tag === 'img') setImageSource(n as HTMLImageElement, e.attrs.src, assetUrl);
  else if (e.tag === 'x-icon') renderIcon(document, n, e.attrs.name);
  else if (e.tag === 'x-embed' && thumbnail) {
    // a hundred thumbnails never run a hundred pages: the embed's place, marked
    const mark = document.createElement('div');
    mark.dataset.embedPlaceholder = '';
    n.appendChild(mark);
  } else if (e.tag === 'x-embed') {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('tabindex', '-1');
    frame.srcdoc = embedDocument(e.raw ?? '');
    n.appendChild(frame);
  }
  return n;
}

export function renderText(n: HTMLElement, tag: string, blocks: TextBlock[]): void {
  n.innerHTML = LIST_TAGS.has(tag as never) ? blocks.map((b) => `<li>${serializeInline(b.inline)}</li>`).join('') : serializeInline(blocks[0]?.inline ?? []);
}

/** `assets/<name>` through the store; Claude's `/_blob/` and an installed system's `project/ds/` paths, or none, draw as a labelled placeholder. */
export function setImageSource(img: HTMLImageElement, src: string | undefined, assetUrl: AssetUrl): void {
  const url = src?.startsWith('assets/') ? assetUrl(src) : null;
  if (url) {
    img.src = url;
    delete img.dataset.placeholder;
  } else {
    img.removeAttribute('src');
    img.dataset.placeholder = src ?? '';
  }
}

function renderIcon(document: Document, n: HTMLElement, name: string | undefined): void {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICON_GLYPHS[name ?? ''] ?? '');
  svg.appendChild(path);
  n.appendChild(svg);
}

/** Whether an element's look depends on its laid-out box (drawn in the layout pass). */
export const drawsInLayout = (tag: string, attrs: Readonly<Record<string, string>>): boolean => tag === 'x-connector' || (tag === 'x-shape' && attrs.kind !== 'rect');

/** A stroke width in px from a CSS length the model holds (a token resolved through the computed custom property). */
function strokeWidthOf(n: HTMLElement, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  n.style.setProperty('--maws-stroke', value);
  const resolved = n.ownerDocument.defaultView?.getComputedStyle(n).getPropertyValue('--maws-stroke') ?? value;
  const px = Number.parseFloat(resolved);
  return Number.isFinite(px) ? px : Number.parseFloat(value) || fallback;
}

const dashOf = (style: string | null | undefined, w: number): string | null => (style === 'dashed' ? `${3 * w} ${2 * w}` : style === 'dotted' ? `${w} ${1.5 * w}` : null);

function svgIn(n: HTMLElement, w: number, h: number): SVGSVGElement {
  let svg = n.querySelector(':scope > svg[data-glyph]') as SVGSVGElement | null;
  if (!svg) {
    svg = n.ownerDocument.createElementNS(SVG_NS, 'svg');
    svg.dataset.glyph = '';
    n.appendChild(svg);
  }
  svg.setAttribute('width', String(Math.max(0, w)));
  svg.setAttribute('height', String(Math.max(0, h)));
  svg.setAttribute('viewBox', `0 0 ${Math.max(0, w)} ${Math.max(0, h)}`);
  svg.replaceChildren();
  return svg;
}

/** An x-shape's outline in its box: fill from its (flat) background, stroke from its border. */
export function drawShape(n: HTMLElement, style: Readonly<Record<string, string>>, kind: string, w: number, h: number): void {
  const border = style.border ? splitBorder(style.border) : null;
  const stroke = border && border.style !== 'none' ? strokeWidthOf(n, border.width ?? '1px', 1) : 0;
  const svg = svgIn(n, w, h);
  const path = n.ownerDocument.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', shapePath(kind, w, h, stroke || (isStrokeOnly(kind) ? 2 : 0)));
  const fill = style.background && !style.background.includes('gradient') ? style.background : null;
  if (isStrokeOnly(kind)) {
    path.style.setProperty('fill', 'none');
    path.style.setProperty('stroke', border?.color ?? fill ?? 'currentColor');
    path.style.setProperty('stroke-width', `${stroke || 2}px`);
  } else {
    path.style.setProperty('fill', fill ?? '#d9dedb');
    if (stroke > 0) {
      path.style.setProperty('stroke', border?.color ?? '#000000');
      path.style.setProperty('stroke-width', `${stroke}px`);
      const dash = dashOf(border?.style, stroke);
      if (dash) path.style.setProperty('stroke-dasharray', dash);
    }
  }
  svg.appendChild(path);
}

/** A coordinate attribute in px of the host box (bare px, `Npx`, or `N%` of the host's width or height). */
const coord = (v: string | undefined, size: number): number => (v === undefined ? 0 : v.trim().endsWith('%') ? (Number.parseFloat(v) / 100) * size : Number.parseFloat(v) || 0);

/** An x-connector's line and heads: in its host's coordinates when pinned, corner to corner of its own box in flow. */
export function drawConnector(n: HTMLElement, style: Readonly<Record<string, string>>, attrs: Readonly<Record<string, string>>, w: number, h: number): void {
  const sw = strokeWidthOf(n, style['border-width'], 2);
  let points: Point[];
  if (attrs.x1 !== undefined) {
    points = connectorRoute(attrs.route, coord(attrs.x1, w), coord(attrs.y1, h), coord(attrs.x2, w), coord(attrs.y2, h));
  } else {
    const from = attrs.from ?? 'tl';
    const [y0, y1] = h < sw ? [h / 2, h / 2] : [0, h];
    const ends: Record<string, [Point, Point]> = { tl: [[0, y0], [w, y1]], tr: [[w, y0], [0, y1]], bl: [[0, y1], [w, y0]], br: [[w, y1], [0, y0]] };
    const [a, b] = ends[from] ?? ends.tl!;
    points = a[0] === b[0] && a[1] === b[1] ? [a] : [a, b];
  }
  const svg = svgIn(n, w, h);
  const doc = n.ownerDocument;
  const line = doc.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', points.map(([x, y]) => `${x},${y}`).join(' '));
  line.style.setProperty('fill', 'none');
  line.style.setProperty('stroke', 'currentColor');
  line.style.setProperty('stroke-width', `${sw}px`);
  line.style.setProperty('stroke-linejoin', 'round');
  const dash = dashOf(style['border-style'], sw);
  if (dash) line.style.setProperty('stroke-dasharray', dash);
  svg.appendChild(line);
  if (points.length < 2) return; // both ends at one point: no direction for a head
  const heads = connectorHeads(attrs);
  const head = (from: Point, tip: Point, kind: 'none' | 'open' | 'filled') => {
    if (kind === 'none') return;
    const [t, a, b] = headPolygon(from, tip, sw);
    const shape = doc.createElementNS(SVG_NS, kind === 'filled' ? 'polygon' : 'polyline');
    shape.setAttribute('points', (kind === 'filled' ? [t, a, b] : [a, t, b]).map(([x, y]) => `${x},${y}`).join(' '));
    shape.style.setProperty('fill', kind === 'filled' ? 'currentColor' : 'none');
    shape.style.setProperty('stroke', 'currentColor');
    shape.style.setProperty('stroke-width', `${kind === 'filled' ? 0 : sw}px`);
    shape.style.setProperty('stroke-linejoin', 'round');
    svg.appendChild(shape);
  };
  head(points[points.length - 2]!, points[points.length - 1]!, heads.end);
  head(points[1]!, points[0]!, heads.start);
}
