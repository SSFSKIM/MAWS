// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12 "PPTX"; parent §4.5, Decision Log 17): a measured deck
// as a PowerPoint file over pptxgenjs, on `LAYOUT_WIDE` (13.333 × 7.5 in), one CSS px = 0.5 pt. Every editable element
// keeps its measured place and becomes the native object it is: a text element a text box with its runs (face, size,
// weight, style, colour, decoration, link), its paragraphs' alignment, line spacing and bullets, its padding as insets,
// an explicit size and no autofit (the fitted size the export window measured is the size written); a painted div a
// rectangle or rounded rectangle with its fill, line, shadow and transparency; a picture a picture (cover, contain or
// the owner's crop as a source rectangle); an x-shape its preset geometry; an x-connector and an hr lines (a routed
// connector one open path), heads as line ends; a table a native table with its column widths, row heights, fills,
// borders and cell text; an inline svg and an x-icon an SVG picture with a PNG fallback the window drew. What no native
// object carries (an x-embed, a gradient fill, a gradient slide background, a turned table) is a picture of its region
// the window took. A turn (the element's own and its ancestors') turns a connector's points and a box's border bars with
// it (the final review's A5, A11, A12); every line break is a native one (A9). A skew (P4), which no PowerPoint object
// takes, makes the element, and every member of a skewed group, a picture of it as drawn.
// Every object is named by its element's id (`shapeName`); notes, hidden slides, fade and push transitions (magic as
// fade), and the theme part of the design system (D's `officeThemeXml`) are written by post-processing the package.
//
// Two steps, so the mapping is testable without a file: `pptxSlides` maps a measured deck to pptxgenjs calls (plain data),
// `writePptx` makes the file. The pictures it needs are listed by `pictureJobs` for the window to take first. Portable.
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import { connectorHeads } from '../glyphs';
import type { ElementIR } from '../ir';
import { connectorPoints } from './glyphs-svg';
import { faceFor, type PptxFontVariant } from './fonts';
import type { MeasuredBorder, MeasuredBox, MeasuredDeck, MeasuredElement, MeasuredParagraph, MeasuredPaint, MeasuredSlide, MeasuredText } from './measure';
import { cropOf, cropViewBox, type ExportDeck } from './standalone';

/** Inches from slide px (1920 px = 13.333 in). */
export const inches = (px: number): number => px / 144; // pptxgenjs rounds to whole EMU
/** Points from CSS px (1 px = 0.5 pt). */
export const points = (px: number): number => Math.round(px * 50) / 100;

/** A CSS colour as computed (`rgb()`, `rgba()`, `#hex`) as PowerPoint's hex and its alpha. */
export function parseColor(value: string | null | undefined): { hex: string; alpha: number } | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const alpha = full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) / 255 : 1;
    return { hex: full.slice(0, 6).toUpperCase(), alpha };
  }
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (!m) return null;
  const byte = (s: string) => Math.max(0, Math.min(255, Math.round(Number(s))));
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number.parseFloat(m[4]) / 100 : Number(m[4]);
  return { hex: [m[1]!, m[2]!, m[3]!].map((s) => byte(s).toString(16).padStart(2, '0')).join('').toUpperCase(), alpha };
}

/** PowerPoint's transparency (0–100) from an alpha and an opacity. */
const transparencyOf = (alpha: number, opacity = 1): number => Math.round((1 - Math.max(0, Math.min(1, alpha * opacity))) * 100);

export type PptxObject =
  | { kind: 'text'; name: string; text: PptxGenJS.TextProps[]; options: PptxGenJS.TextPropsOptions }
  | { kind: 'shape'; name: string; shape: PptxGenJS.SHAPE_NAME; options: PptxGenJS.ShapeProps }
  | { kind: 'image'; name: string; options: PptxGenJS.ImageProps; /** an SVG picture's PNG fallback (`data:`) */ fallback?: string }
  | { kind: 'table'; name: string; rows: PptxGenJS.TableRow[]; options: PptxGenJS.TableProps };

export interface PptxSlide {
  id: string;
  hidden: boolean;
  notes: string;
  transition: 'fade' | 'push' | null;
  background: PptxGenJS.BackgroundProps | null;
  objects: PptxObject[];
}

/** A picture the export window takes before the mapping: a whole slide, a slide's background, or one element's region. */
export interface PictureJob {
  key: string;
  slideId: string;
  elementId: string | null;
  /**
   * `slide`: everything; `background`: the section alone; `self`: the element without its content; `tree`: the element
   * and its content; `drawn` (P4): the element in place as the slide draws it, its own and its ancestors' transforms and
   * clips kept (a skew), with its content but the elements measured on their own.
   */
  mode: 'slide' | 'background' | 'self' | 'tree' | 'drawn';
  /** In slide px (the element's box before rotation; the window draws it unrotated); for `drawn`, the region it paints. */
  box: MeasuredBox;
}

export const pictureKey = (slideId: string, elementId: string | null): string => (elementId === null ? slideId : `${slideId}/${elementId}`);
const FULL: MeasuredBox = { x: 0, y: 0, w: 1920, h: 1080 };

/** The pictures `pptxSlides` will ask for under `variant`. */
export function pictureJobs(measured: MeasuredDeck, variant: PptxFontVariant): PictureJob[] {
  const jobs: PictureJob[] = [];
  for (const slide of measured.slides) {
    if (variant === 'pictures') {
      jobs.push({ key: pictureKey(slide.id, null), slideId: slide.id, elementId: null, mode: 'slide', box: FULL });
      continue;
    }
    if (slide.background.image) jobs.push({ key: pictureKey(slide.id, ''), slideId: slide.id, elementId: '', mode: 'background', box: FULL });
    for (const el of slide.elements) {
      const job = (mode: PictureJob['mode'], box = el.box) => jobs.push({ key: pictureKey(slide.id, el.id), slideId: slide.id, elementId: el.id, mode, box });
      // a skew has no native form (P4): the window's picture of the element as drawn (a group's own, when it paints; none
      // where the slide shows none of it, which then draws nothing)
      if (el.drawn) {
        if (el.drawn.w > 0 && el.drawn.h > 0 && (el.tag !== 'div' || painted(el.paint) || el.paint.image)) job('drawn', el.drawn);
      }
      // a turned table has no native form (a PowerPoint table does not turn): the window's picture of it (A11)
      else if (el.tag === 'x-embed' || el.tag === 'svg' || el.tag === 'x-icon' || (el.tag === 'table' && el.rotate !== 0)) job('tree');
      else if (el.tag === 'img' ? decoratedImage(el) : el.paint.image && el.tag !== 'x-shape' && el.tag !== 'x-connector' && el.tag !== 'hr') job('self');
    }
  }
  return jobs;
}

/**
 * An image with paint of its own no native picture carries (P3-F, exports-capture scalpel-5#3): a corner radius, a
 * border, a background under it. A placeholder keeps its flat stand-in; a shadow alone PowerPoint casts itself.
 */
const decoratedImage = (el: MeasuredElement): boolean => !el.image?.placeholder && (el.paint.radius > 0.5 || el.paint.borders.some((b) => b !== null) || el.paint.fill !== null || el.paint.image);

export interface PptxMapOptions {
  variant: PptxFontVariant;
  /** The window's pictures by `pictureKey`, as `data:image/png;base64,…`. */
  pictures: ReadonlyMap<string, string>;
  /** An uploaded asset's `data:` URL, null when the deck has none such. */
  asset: (ref: string) => string | null;
}

const at = (box: MeasuredBox) => ({ x: inches(box.x), y: inches(box.y), w: inches(Math.max(box.w, 0)), h: inches(Math.max(box.h, 0)) });

function fillOf(color: string | null, opacity: number): PptxGenJS.ShapeFillProps | undefined {
  const c = parseColor(color);
  return c ? { color: c.hex, transparency: transparencyOf(c.alpha, opacity) } : undefined;
}
const dashOf = (style: string): PptxGenJS.ShapeLineProps['dashType'] => (style === 'dashed' ? 'dash' : style === 'dotted' ? 'sysDot' : 'solid');
function lineOf(border: MeasuredBorder | null, opacity: number): PptxGenJS.ShapeLineProps | undefined {
  const c = parseColor(border?.color);
  if (!border || !c) return undefined;
  return { color: c.hex, transparency: transparencyOf(c.alpha, opacity), width: points(border.width), dashType: dashOf(border.style) };
}
const sameBorder = (a: MeasuredBorder | null, b: MeasuredBorder | null) => a === b || (a !== null && b !== null && a.width === b.width && a.style === b.style && a.color === b.color);
const uniform = (borders: MeasuredPaint['borders']) => borders.every((b) => sameBorder(b, borders[0]));

function shadowOf(paint: MeasuredPaint): PptxGenJS.ShadowProps | undefined {
  const s = paint.shadow;
  const c = parseColor(s?.color);
  if (!s || !c) return undefined;
  const angle = ((Math.round((Math.atan2(s.y, s.x) * 180) / Math.PI) % 360) + 360) % 360;
  return { type: 'outer', blur: points(s.blur), offset: points(Math.hypot(s.x, s.y)), angle, color: c.hex, opacity: Math.max(0, Math.min(1, c.alpha * paint.opacity)) };
}

/** The shape a painted box draws as: a rectangle, or a rounded one with its corner radius. */
function boxShape(radius: number, box: MeasuredBox): { shape: PptxGenJS.SHAPE_NAME; rectRadius?: number } {
  const r = Math.min(radius, box.w / 2, box.h / 2);
  return r > 0.5 ? { shape: 'roundRect', rectRadius: inches(r) } : { shape: 'rect' };
}
/** `box` with each side moved `d` px in (its centre kept). */
const inside = (box: MeasuredBox, d: number): MeasuredBox => (d ? { x: box.x + d, y: box.y + d, w: box.w - 2 * d, h: box.h - 2 * d } : box);

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
/**
 * A part of an owner's unturned box where the owner's turn (`deg` clockwise about its centre, its own and its
 * ancestors') carries it: the part keeps its size and turns by as much about its own centre (A12).
 */
function turnedWith(part: MeasuredBox, owner: MeasuredBox, deg: number): MeasuredBox {
  if (!deg) return part;
  const t = (deg * Math.PI) / 180;
  const [cx, cy] = [owner.x + owner.w / 2, owner.y + owner.h / 2];
  const [dx, dy] = [part.x + part.w / 2 - cx, part.y + part.h / 2 - cy];
  const [px, py] = [cx + dx * Math.cos(t) - dy * Math.sin(t), cy + dx * Math.sin(t) + dy * Math.cos(t)];
  return { x: round6(px - part.w / 2), y: round6(py - part.h / 2), w: part.w, h: part.h };
}

/**
 * A box's paint: its shape, fill, uniform line and shadow; a side drawn alone is its own bar (named `<id>:border-<side>`).
 * P3-F (exports-capture scalpel-5#5): PowerPoint centres a line on its shape's path, where the canvas draws a border
 * inside the box (as the bars are drawn), so a uniform line's path lies half its width inside the box (`inset`), its
 * corner the radius the stroke's middle follows; the shape's place is `options`' x, y, w and h.
 */
function paintObjects(el: MeasuredElement, withFill: boolean): { options: PptxGenJS.ShapeProps; shape: PptxGenJS.SHAPE_NAME; sides: PptxObject[]; inset: number } {
  const { paint, box } = el;
  const line = uniform(paint.borders) ? lineOf(paint.borders[0], paint.opacity) : undefined;
  const inset = line ? paint.borders[0]!.width / 2 : 0;
  const path = inside(box, inset);
  const { shape, rectRadius } = boxShape(paint.radius - inset, path);
  const options: PptxGenJS.ShapeProps = { ...at(path), objectName: el.id, ...(rectRadius !== undefined && { rectRadius }), ...(el.rotate && { rotate: el.rotate }) };
  const fill = withFill ? fillOf(paint.fill, paint.opacity) : undefined;
  options.fill = fill ?? { type: 'none' };
  const sides: PptxObject[] = [];
  if (uniform(paint.borders)) {
    if (line) options.line = line;
  } else {
    const names = ['top', 'right', 'bottom', 'left'] as const;
    paint.borders.forEach((border, i) => {
      const c = parseColor(border?.color);
      if (!border || !c) return;
      const bar: MeasuredBox =
        i === 0 ? { x: box.x, y: box.y, w: box.w, h: border.width } : i === 1 ? { x: box.x + box.w - border.width, y: box.y, w: border.width, h: box.h } : i === 2 ? { x: box.x, y: box.y + box.h - border.width, w: box.w, h: border.width } : { x: box.x, y: box.y, w: border.width, h: box.h };
      sides.push({ kind: 'shape', name: `${el.id}:border-${names[i]}`, shape: 'rect', options: { ...at(turnedWith(bar, box, el.rotate)), objectName: `${el.id}:border-${names[i]}`, fill: { color: c.hex, transparency: transparencyOf(c.alpha, paint.opacity) }, line: { type: 'none' }, ...(el.rotate && { rotate: el.rotate }) } });
    });
  }
  const shadow = shadowOf(paint);
  if (shadow) options.shadow = shadow;
  return { options, shape, sides, inset };
}
const painted = (paint: MeasuredPaint) => paint.fill !== null || paint.borders.some((b) => b !== null) || paint.shadow !== null;

/** A text element's runs as pptxgenjs text, paragraph by paragraph. */
function runsOf(text: MeasuredText, variant: PptxFontVariant, opacity: number, listIndent: number): PptxGenJS.TextProps[] {
  const out: PptxGenJS.TextProps[] = [];
  text.paragraphs.forEach((paragraph: MeasuredParagraph, p) => {
    const para: PptxGenJS.TextPropsOptions = {
      align: paragraph.align,
      lineSpacing: points(paragraph.lineHeight),
      paraSpaceBefore: 0,
      paraSpaceAfter: 0,
      ...(paragraph.bullet === 'disc' && { bullet: { indent: points(listIndent) } }),
      ...(paragraph.bullet === 'decimal' && { bullet: { type: 'number', indent: points(listIndent) } }),
    };
    const last = p === text.paragraphs.length - 1;
    const pieces: PptxGenJS.TextProps[] = [];
    for (const run of paragraph.runs) {
      const color = parseColor(run.color);
      const chars: PptxGenJS.TextPropsOptions = {
        fontFace: faceFor(run.font, variant),
        fontSize: points(run.size),
        bold: run.bold,
        italic: run.italic,
        ...(run.underline && { underline: { style: 'sng' } }),
        ...(run.strike && { strike: 'sngStrike' }),
        ...(color && { color: color.hex, ...(transparencyOf(color.alpha, opacity) > 0 && { transparency: transparencyOf(color.alpha, opacity) }) }),
        ...(run.letterSpacing !== 0 && { charSpacing: points(run.letterSpacing) }),
      };
      // every break a native one (A9): pptxgenjs writes one before a paragraph's second run on, so a paragraph that
      // opens with a break opens with an empty run, and each break but the run's own last rides an empty run
      const breaks = run.breaks ?? 0;
      for (let k = 0; k < breaks; k++) {
        if (!pieces.length) pieces.push({ text: '', options: { ...chars } });
        if (k < breaks - 1) pieces.push({ text: '', options: { ...chars, softBreakBefore: true } });
      }
      pieces.push({ text: run.text, options: { ...chars, ...(run.href && { hyperlink: { url: run.href } }), ...(breaks > 0 && { softBreakBefore: true }) } });
    }
    if (!pieces.length) pieces.push({ text: '', options: {} });
    // the paragraph's properties on its first run (`onePPr` keeps that one; pptxgenjs writes one per run)
    pieces[0]!.options = { ...para, ...pieces[0]!.options };
    if (!last) pieces[pieces.length - 1]!.options = { ...pieces[pieces.length - 1]!.options, breakLine: true };
    out.push(...pieces);
  });
  return out;
}

/** pptxgenjs's text-box insets, in points, in its order (left, right, bottom, top). */
const insets = (padding: MeasuredText['padding'], listIndent: number): [number, number, number, number] => [points(Math.max(0, padding[3] - listIndent)), points(padding[1]), points(padding[2]), points(padding[0])];

function textObject(el: MeasuredElement, variant: PptxFontVariant, withFill: boolean): PptxObject[] {
  const text = el.text!;
  const list = el.tag === 'ul' || el.tag === 'ol';
  const listIndent = list ? text.padding[3] : 0;
  const runs = runsOf(text, variant, el.paint.opacity, listIndent);
  const hasText = runs.some((r) => r.text);
  if (!hasText && !painted(el.paint)) return [];
  const { options: paint, shape, sides, inset } = paintObjects(el, withFill);
  // P3-F (exports-capture scalpel-5#5): the text is set after the border and the padding, as CSS sets it, measured from
  // the box's path (`inset` inside the border's outer edge)
  const borders = el.paint.borders.map((b) => b?.width ?? 0);
  const content = text.padding.map((p, i) => p + borders[i]! - inset) as MeasuredText['padding'];
  const options: PptxGenJS.TextPropsOptions = {
    ...at(inside(el.box, inset)),
    objectName: el.id,
    margin: insets(content, listIndent),
    valign: text.valign,
    fit: 'none',
    // text the app sets on one line stays on one line: a substitute face a little wider runs past the box, not onto a
    // second line under the next element
    wrap: !text.oneLine,
    ...(el.rotate && { rotate: el.rotate }),
    ...(paint.fill && 'color' in paint.fill && { fill: paint.fill }),
    ...(paint.line && { line: paint.line }),
    ...(paint.shadow && { shadow: paint.shadow }),
    ...(shape === 'roundRect' && { shape: 'roundRect', rectRadius: paint.rectRadius }),
  };
  return [{ kind: 'text', name: el.id, text: hasText ? runs : [{ text: '' }], options }, ...sides];
}

/** A picture's source rectangle (fractions) and placed box for its fit, position and the owner's crop. */
function placeImage(el: MeasuredElement, natural: { w: number; h: number }): { box: MeasuredBox; crop: { x: number; y: number; w: number; h: number } | null } {
  const { box } = el;
  const image = el.image!;
  // the owner's crop narrows the picture to a region (as the canvas's object-view-box does); the element's own fit and
  // position then place that region in its box
  const crop = cropOf(el.attrs['data-crop']);
  const fit = image.fit;
  const [px, py] = image.position;
  const view = crop && crop.zoom > 1 ? cropViewBox(natural, crop) : { x: 0, y: 0, w: natural.w, h: natural.h };
  if (fit === 'cover') {
    const s = Math.max(box.w / view.w, box.h / view.h);
    const [w, h] = [box.w / s, box.h / s];
    return { box, crop: { x: view.x + (view.w - w) * px, y: view.y + (view.h - h) * py, w, h } };
  }
  if (fit === 'contain' || fit === 'scale-down') {
    const s = Math.min(box.w / view.w, box.h / view.h, fit === 'scale-down' ? 1 : Infinity);
    const [w, h] = [view.w * s, view.h * s];
    return { box: { x: box.x + (box.w - w) * px, y: box.y + (box.h - h) * py, w, h }, crop: view.w === natural.w && view.h === natural.h ? null : view };
  }
  return { box, crop: view.w === natural.w && view.h === natural.h ? null : view };
}

function imageObject(el: MeasuredElement, ir: ElementIR | undefined, picture: string | undefined, options: PptxMapOptions): PptxObject[] {
  const src = ir?.attrs.src;
  const data = src?.startsWith('assets/') ? options.asset(src) : null;
  const natural = el.image?.natural;
  if (!data || !natural || natural.w <= 0 || natural.h <= 0) {
    // a placeholder (no picture, or one MAWS cannot draw): its place, filled as the canvas fills it
    return [{ kind: 'shape', name: el.id, shape: 'rect', options: { ...at(el.box), objectName: el.id, fill: { color: 'E3E6E4' }, line: { type: 'none' }, ...(el.rotate && { rotate: el.rotate }) } }];
  }
  const shadow = shadowOf(el.paint);
  const transparency = transparencyOf(1, el.paint.opacity);
  // its own paint (P3-F, exports-capture scalpel-5#3): the window's picture of it, unturned at its box, which draws them
  if (picture && decoratedImage(el)) {
    return [{ kind: 'image', name: el.id, options: { data: picture, ...at(el.box), objectName: el.id, altText: ir?.attrs.alt ?? '', ...(el.rotate && { rotate: el.rotate }), ...(transparency > 0 && { transparency }), ...(shadow && { shadow }) } }];
  }
  const placed = placeImage(el, natural);
  // P3-F (exports-capture scalpel-5#4): CSS turns the img about the element's centre, PowerPoint the frame about its own:
  // a frame smaller than the box (contained, off centre) is carried by the turn, as a border bar is
  const frame = turnedWith(placed.box, el.box, el.rotate);
  const base: PptxGenJS.ImageProps = { data, objectName: el.id, altText: ir?.attrs.alt ?? '', ...(el.rotate && { rotate: el.rotate }), ...(shadow && { shadow }) };
  if (transparency > 0) base.transparency = transparency;
  if (!placed.crop) return [{ kind: 'image', name: el.id, options: { ...base, ...at(frame) } }];
  // pptxgenjs's crop: `w`/`h` the whole picture and `sizing` the window in the same units, so the window lands at the box;
  // each axis scales on its own (a region stretched into a box of another aspect)
  const sx = placed.box.w / placed.crop.w;
  const sy = placed.box.h / placed.crop.h;
  return [
    {
      kind: 'image',
      name: el.id,
      options: {
        ...base,
        x: inches(frame.x),
        y: inches(frame.y),
        w: inches(natural.w * sx),
        h: inches(natural.h * sy),
        sizing: { type: 'crop', x: inches(placed.crop.x * sx), y: inches(placed.crop.y * sy), w: inches(placed.box.w), h: inches(placed.box.h) },
      },
    },
  ];
}

function pictureObject(el: MeasuredElement, picture: string | undefined): PptxObject[] {
  if (!picture) return [];
  const transparency = transparencyOf(1, el.paint.opacity);
  return [{ kind: 'image', name: el.id, options: { data: picture, ...at(el.box), objectName: el.id, ...(el.rotate && { rotate: el.rotate }), ...(transparency > 0 && { transparency }) } }];
}

function svgObject(el: MeasuredElement, picture: string | undefined, ir: ElementIR | undefined): PptxObject[] {
  if (!el.svg) return pictureObject(el, picture);
  const data = `data:image/svg+xml;base64,${base64(el.svg)}`;
  const transparency = transparencyOf(1, el.paint.opacity);
  return [{ kind: 'image', name: el.id, options: { data, ...at(el.box), objectName: el.id, altText: ir?.attrs['aria-label'] ?? '', ...(el.rotate && { rotate: el.rotate }), ...(transparency > 0 && { transparency }) }, ...(picture && { fallback: picture }) }];
}

const ARROW: Record<'none' | 'open' | 'filled', PptxGenJS.ShapeLineProps['endArrowType']> = { none: 'none', open: 'arrow', filled: 'triangle' };
const PRESETS: Record<string, PptxGenJS.SHAPE_NAME> = { rect: 'rect', rounded: 'roundRect', ellipse: 'ellipse', diamond: 'diamond', 'arrow-right': 'rightArrow', 'arrow-left': 'leftArrow', 'arrow-up': 'upArrow', 'arrow-down': 'downArrow' };

/** A line from `points` (slide px): a straight line shape (flipped to run from its first point), else an open path. */
function lineObject(name: string, pts: [number, number][], line: PptxGenJS.ShapeLineProps, rotate: number): PptxObject[] {
  if (pts.length < 2) return [];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const box: MeasuredBox = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  const common = { ...at(box), objectName: name, line, ...(rotate && { rotate }) };
  if (pts.length === 2) {
    const [[x1, y1], [x2, y2]] = pts as [[number, number], [number, number]];
    return [{ kind: 'shape', name, shape: 'line', options: { ...common, ...(x2 < x1 && { flipH: true }), ...(y2 < y1 && { flipV: true }) } }];
  }
  return [{ kind: 'shape', name, shape: 'custGeom' as PptxGenJS.SHAPE_NAME /* pptxgenjs draws `points` for it; its type omits the name */, options: { ...common, fill: { type: 'none' }, points: pts.map(([x, y], i) => ({ x: inches(x - box.x), y: inches(y - box.y), ...(i === 0 && { moveTo: true }) })) } }];
}

function connectorObject(el: MeasuredElement): PptxObject[] {
  const stroke = el.shape?.stroke;
  const width = stroke?.width ?? 2;
  const color = parseColor(el.color);
  // its coordinates are its host's own px: routed in the undrawn box, then carried by the composed placement (its
  // host's scale and turn, A5) about the box's centre, which is where the layout box's centre is drawn
  const [sx, sy] = el.connectorScale ?? [1, 1];
  const [lw, lh] = [el.box.w / sx, el.box.h / sy];
  const local = connectorPoints(el.attrs, lw, lh, width / Math.sqrt(sx * sy));
  const [a, b, c, d] = el.linear ?? [sx, 0, 0, sy];
  const [cx, cy] = [el.box.x + el.box.w / 2, el.box.y + el.box.h / 2];
  const pts = local.map(([x, y]): [number, number] => {
    const [dx, dy] = [x - lw / 2, y - lh / 2];
    return [round6(cx + a * dx + c * dy), round6(cy + b * dx + d * dy)];
  });
  const heads = connectorHeads(el.attrs);
  const line: PptxGenJS.ShapeLineProps = {
    width: points(width),
    dashType: dashOf(stroke?.style ?? 'solid'),
    beginArrowType: ARROW[heads.start],
    endArrowType: ARROW[heads.end],
    ...(color && { color: color.hex, transparency: transparencyOf(color.alpha, el.paint.opacity) }),
  };
  return lineObject(el.id, pts, line, 0);
}

function shapeObject(el: MeasuredElement): PptxObject[] {
  const kind = el.attrs.kind ?? 'rect';
  if (kind === 'rect') {
    const { options, shape, sides } = paintObjects(el, true);
    return [{ kind: 'shape', name: el.id, shape, options }, ...sides];
  }
  const own = el.shape ?? { fill: null, stroke: null, shadow: null };
  if (kind === 'line') {
    const color = parseColor(own.stroke?.color ?? own.fill ?? el.color);
    const y = el.box.y + el.box.h / 2;
    return lineObject(el.id, [[el.box.x, y], [el.box.x + el.box.w, y]], { width: points(own.stroke?.width ?? 2), ...(color && { color: color.hex }), dashType: dashOf(own.stroke?.style ?? 'solid') }, el.rotate);
  }
  const fill = fillOf(own.fill ?? 'rgb(217, 222, 219)', el.paint.opacity);
  const options: PptxGenJS.ShapeProps = { ...at(el.box), objectName: el.id, ...(fill && { fill }), ...(el.rotate && { rotate: el.rotate }) };
  const line = lineOf(own.stroke, el.paint.opacity);
  options.line = line ?? { type: 'none' };
  const shadow = shadowOf({ ...el.paint, shadow: own.shadow ?? null });
  if (shadow) options.shadow = shadow;
  if (kind === 'rounded') options.rectRadius = inches(Math.min(el.box.w, el.box.h) * 0.2);
  return [{ kind: 'shape', name: el.id, shape: PRESETS[kind] ?? 'rect', options }];
}

function hrObject(el: MeasuredElement): PptxObject[] {
  const top = el.paint.borders[0];
  const color = parseColor(top?.color ?? el.color);
  const width = top?.width ?? 2;
  const y = el.box.y + width / 2;
  return lineObject(el.id, [[el.box.x, y], [el.box.x + el.box.w, y]], { width: points(width), ...(color && { color: color.hex }), dashType: dashOf(top?.style ?? 'solid') }, el.rotate);
}

function tableObject(el: MeasuredElement, variant: PptxFontVariant): PptxObject[] {
  const rows = el.rows ?? [];
  if (!rows.length) return [];
  const columns = rows[0]!.cells.map((c) => inches(c.box.w));
  const border = (b: MeasuredBorder | null): PptxGenJS.BorderProps => {
    const c = parseColor(b?.color);
    return b && c ? { type: b.style === 'dashed' || b.style === 'dotted' ? 'dash' : 'solid', color: c.hex, pt: points(b.width) } : { type: 'none' };
  };
  const tableRows: PptxGenJS.TableRow[] = rows.map((row) =>
    row.cells.map((cell) => {
      const fill = fillOf(cell.fill ?? row.fill, el.paint.opacity);
      const text = runsOf(cell.text, variant, el.paint.opacity, 0);
      const [t, r, b, l] = cell.text.padding.map(points) as [number, number, number, number];
      return {
        text: text.length ? text : '',
        options: {
          ...(fill && { fill }),
          border: [border(cell.borders[0]), border(cell.borders[1]), border(cell.borders[2]), border(cell.borders[3])],
          // pptxgenjs reads a margin whose first value is below 1 as inches: points, the top at least 1
          margin: [Math.max(1, t), r, b, l],
          valign: cell.text.valign,
          align: cell.text.paragraphs[0]?.align ?? 'left',
        },
      };
    }),
  );
  return [{ kind: 'table', name: el.id, rows: tableRows, options: { ...at(el.box), objectName: el.id, colW: columns, rowH: rows.map((r) => inches(r.box.h)), autoPage: false } }];
}

const NO_BORDERS: MeasuredPaint['borders'] = [null, null, null, null];

/**
 * A native table's own paint (P3-F, exports-capture scalpel-5#2), which the cells' fills and borders do not carry: its
 * fill and shadow under the table (or, for a gradient, the window's picture of the table without its cells), its outline
 * over it, where the canvas draws a collapsed border over the cells' fills. P4 (the collapsed-table row; the probe in
 * e2e/presentations-export.spec.ts): Chromium draws that border whole inside the measured box (so the outline keeps the
 * half-width inset every box's has) and square, the table's radius rounding only its background and its shadow.
 */
function tablePaint(el: MeasuredElement, picture: string | undefined): { under: PptxObject[]; over: PptxObject[] } {
  const fill = `${el.id}:fill`;
  const under: PptxObject[] = [];
  if (el.paint.image && picture) under.push(...pictureObject({ ...el, id: fill }, picture).map((o) => ({ ...o, name: fill })));
  else if (el.paint.fill !== null || el.paint.shadow !== null) {
    const { options, shape } = paintObjects({ ...el, paint: { ...el.paint, borders: NO_BORDERS } }, true);
    under.push({ kind: 'shape', name: fill, shape, options: { ...options, objectName: fill } });
  }
  const { options, shape, sides } = paintObjects({ ...el, paint: { ...el.paint, shadow: null, radius: 0 } }, false);
  const outline: PptxObject[] = options.line ? [{ kind: 'shape', name: `${el.id}:border`, shape, options: { ...options, objectName: `${el.id}:border` } }] : [];
  return { under, over: [...outline, ...sides] };
}

/**
 * An element's metrics at the size it is drawn (fix wave 1): its own CSS px times the scale its transforms and its
 * ancestors' draw it at. Sizes along a line scale across (`sx`), line heights and vertical insets down (`sy`), a font
 * size, a border, a radius and a blur by the mean (√(sx·sy)); its box is drawn size already.
 */
export function atDrawnSize(el: MeasuredElement): MeasuredElement {
  if (!el.scale) return el;
  const [sx, sy] = el.scale;
  const k = Math.sqrt(sx * sy);
  const border = (b: MeasuredBorder | null) => (b ? { ...b, width: b.width * k } : null);
  const borders = (list: MeasuredPaint['borders']) => list.map(border) as MeasuredPaint['borders'];
  const shadow = (s: MeasuredPaint['shadow'] | undefined) => (s ? { ...s, x: s.x * sx, y: s.y * sy, blur: s.blur * k } : (s ?? null));
  const text = (t: MeasuredText): MeasuredText => ({
    ...t,
    padding: [t.padding[0] * sy, t.padding[1] * sx, t.padding[2] * sy, t.padding[3] * sx],
    paragraphs: t.paragraphs.map((p) => ({ ...p, lineHeight: p.lineHeight * sy, runs: p.runs.map((r) => ({ ...r, size: r.size * k, letterSpacing: r.letterSpacing * sx })) })),
  });
  return {
    ...el,
    scale: undefined,
    paint: { ...el.paint, borders: borders(el.paint.borders), radius: el.paint.radius * k, shadow: shadow(el.paint.shadow) },
    ...(el.text && { text: text(el.text) }),
    ...(el.shape && { shape: { ...el.shape, stroke: border(el.shape.stroke), shadow: shadow(el.shape.shadow) } }),
    ...(el.rows && { rows: el.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell, borders: borders(cell.borders), text: text(cell.text) })) })) }),
    ...(el.tag === 'x-connector' && { connectorScale: [sx, sy] as [number, number] }),
  };
}

function elementObjects(drawn: MeasuredElement, ir: ElementIR | undefined, picture: string | undefined, options: PptxMapOptions): PptxObject[] {
  // a skewed element: the window's picture of it as drawn, its turn and lean in it, so placed unturned where it is drawn;
  // or nothing (no native stand-in, whose box need not stay within the skewed paint: one the slide shows none of, an
  // unpainted group, a picture not taken)
  if (drawn.drawn) return pictureObject({ ...drawn, box: drawn.drawn, rotate: 0 }, picture);
  const el = atDrawnSize(drawn);
  switch (el.tag) {
    case 'img':
      return imageObject(el, ir, picture, options);
    case 'svg':
    case 'x-icon':
      return svgObject(el, picture, ir);
    case 'x-embed':
      return pictureObject(el, picture);
    case 'x-shape':
      return shapeObject(el);
    case 'x-connector':
      return connectorObject(el);
    case 'hr':
      return hrObject(el);
    case 'table': {
      if (el.rotate !== 0 && picture) return pictureObject(el, picture);
      const { under, over } = tablePaint(el, picture);
      return [...under, ...tableObject(el, options.variant), ...over];
    }
    case 'div': {
      if (el.paint.image && picture) return pictureObject(el, picture);
      if (!painted(el.paint)) return [];
      const { options: shape, shape: kind, sides } = paintObjects(el, true);
      return [{ kind: 'shape', name: el.id, shape: kind, options: shape }, ...sides];
    }
    default:
      if (!el.text) return [];
      // a gradient behind text: the picture of its region, the text box over it unfilled
      if (el.paint.image && picture) return [...pictureObject({ ...el, id: `${el.id}:fill` }, picture).map((o) => ({ ...o, name: `${el.id}:fill` })), ...textObject(el, options.variant, false)];
      return textObject(el, options.variant, true);
  }
}

const indexOf = (children: ElementIR[], into = new Map<string, ElementIR>()): Map<string, ElementIR> => {
  for (const el of children) {
    if (el.id) into.set(el.id, el);
    indexOf(el.children, into);
  }
  return into;
};

/** The measured deck as pptxgenjs's slides (see the header). */
export function pptxSlides(deck: ExportDeck, measured: MeasuredDeck, options: PptxMapOptions): PptxSlide[] {
  const byId = new Map<string, MeasuredSlide>(measured.slides.map((s) => [s.id, s]));
  return deck.slides.flatMap((slide): PptxSlide[] => {
    const m = byId.get(slide.id);
    if (!m) return [];
    const common = { id: slide.id, hidden: slide.hidden, notes: slide.notes, transition: slide.transition === 'magic' ? 'fade' : slide.transition };
    if (options.variant === 'pictures') {
      const picture = options.pictures.get(pictureKey(slide.id, null));
      return [{ ...common, background: null, objects: picture ? [{ kind: 'image', name: slide.id, options: { data: picture, x: 0, y: 0, w: inches(1920), h: inches(1080), objectName: slide.id } }] : [] }];
    }
    const backdrop = m.background.image ? options.pictures.get(pictureKey(slide.id, '')) : undefined;
    const fill = parseColor(m.background.fill);
    const background: PptxGenJS.BackgroundProps | null = backdrop ? { data: backdrop } : fill ? { color: fill.hex, ...(fill.alpha < 1 && { transparency: transparencyOf(fill.alpha) }) } : null;
    const irs = indexOf(slide.ir.children);
    const objects = m.elements.flatMap((el) => elementObjects(el, irs.get(el.id), options.pictures.get(pictureKey(slide.id, el.id)), options));
    return [{ ...common, background, objects }];
  });
}

// ---- the file ----

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Each paragraph with one `a:pPr`, its first: pptxgenjs writes one before every run (its zero indent at least), and a
 * second `a:pPr` inside an `a:p` is invalid DrawingML (PowerPoint offers to repair the file).
 */
export function onePPr(xml: string): string {
  return xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (_, body: string) => {
    let seen = false;
    return `<a:p>${body.replace(/<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/g, (ppr) => (seen ? '' : ((seen = true), ppr)))}</a:p>`;
  });
}

const TRANSITION_XML: Record<'fade' | 'push', string> = {
  fade: '<p:transition spd="med"><p:fade/></p:transition>',
  push: '<p:transition spd="med"><p:push dir="l"/></p:transition>',
};

export interface PptxWriteOptions {
  title: string;
  /** The design system's theme part (D's `officeThemeXml`), in place of pptxgenjs's. */
  themeXml?: string;
}

/** The slides as a .pptx file (pptxgenjs, then the package post-processed: theme, transitions, SVG fallbacks). */
export async function writePptx(slides: readonly PptxSlide[], options: PptxWriteOptions): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = options.title;
  pptx.author = 'MAWS';
  for (const s of slides) {
    const slide = pptx.addSlide();
    if (s.hidden) slide.hidden = true;
    if (s.background) slide.background = s.background;
    for (const o of s.objects) {
      if (o.kind === 'text') slide.addText(o.text, o.options);
      else if (o.kind === 'shape') slide.addShape(o.shape, o.options);
      else if (o.kind === 'image') slide.addImage(o.options);
      else slide.addTable(o.rows, o.options);
    }
    if (s.notes) slide.addNotes(s.notes);
  }
  const written = await pptx.write({ outputType: 'uint8array' });
  const zip = await JSZip.loadAsync(written as Uint8Array);
  if (options.themeXml) zip.file('ppt/theme/theme1.xml', options.themeXml);
  for (const [i, s] of slides.entries()) {
    const path = `ppt/slides/slide${i + 1}.xml`;
    let xml = await zip.file(path)?.async('string');
    if (xml === undefined) continue;
    xml = onePPr(xml);
    if (s.transition) xml = xml.replace('</p:clrMapOvr>', `</p:clrMapOvr>${TRANSITION_XML[s.transition]}`);
    zip.file(path, xml);
    const fallbacks = s.objects.filter((o): o is Extract<PptxObject, { kind: 'image' }> => o.kind === 'image' && o.fallback !== undefined);
    if (!fallbacks.length) continue;
    const rels = (await zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`)?.async('string')) ?? '';
    for (const o of fallbacks) {
      // the picture named by the element: its blip (the PNG) before the SVG extension
      const pic = xml.split('<p:pic>').find((part) => part.includes(`name="${o.name}"`) && part.includes('svgBlip'));
      const rId = pic && /<a:blip r:embed="(rId\d+)"/.exec(pic)?.[1];
      const target = rId && new RegExp(`Id="${rId}"[^>]*Target="\\.\\./media/([^"]+)"`).exec(rels)?.[1];
      if (target) zip.file(`ppt/media/${target}`, o.fallback!.split(',').pop()!, { base64: true });
    }
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
