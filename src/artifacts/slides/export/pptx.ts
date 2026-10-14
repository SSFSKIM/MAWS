// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12 "PPTX"; parent §4.5, Decision Log 17): a measured deck
// as a PowerPoint file over pptxgenjs, on `LAYOUT_WIDE` (13.333 × 7.5 in), one CSS px = 0.5 pt. Every editable element
// keeps its measured place and becomes the native object it is: a text element a text box with its runs (face, size,
// weight, style, colour, decoration, link), its paragraphs' alignment, line spacing and bullets, its padding as insets,
// an explicit size and no autofit (the fitted size the export window measured is the size written); a painted div a
// rectangle or rounded rectangle with its fill, line, shadow and transparency; a picture a picture (cover, contain or
// the owner's crop as a source rectangle); an x-shape its preset geometry; an x-connector and an hr lines (a routed
// connector one open path), heads as line ends; a table a native table with its column widths, row heights, fills,
// borders and cell text; an inline svg and an x-icon an SVG picture with a PNG fallback the window drew. What no native
// object carries (an x-embed, a gradient fill, a gradient slide background) is a picture of its region the window took.
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
export const inches = (px: number): number => Math.round((px / 144) * 10_000) / 10_000;
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
  /** `slide`: everything; `background`: the section alone; `self`: the element without its content; `tree`: the element and its content. */
  mode: 'slide' | 'background' | 'self' | 'tree';
  /** In slide px (the element's box before rotation; the window draws it unrotated). */
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
      const job = (mode: PictureJob['mode']) => jobs.push({ key: pictureKey(slide.id, el.id), slideId: slide.id, elementId: el.id, mode, box: el.box });
      if (el.tag === 'x-embed' || el.tag === 'svg' || el.tag === 'x-icon') job('tree');
      else if (el.paint.image && el.tag !== 'img' && el.tag !== 'x-shape' && el.tag !== 'x-connector' && el.tag !== 'hr') job('self');
    }
  }
  return jobs;
}

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
function boxShape(paint: MeasuredPaint, box: MeasuredBox): { shape: PptxGenJS.SHAPE_NAME; rectRadius?: number } {
  const r = Math.min(paint.radius, box.w / 2, box.h / 2);
  return r > 0.5 ? { shape: 'roundRect', rectRadius: inches(r) } : { shape: 'rect' };
}

/** A box's paint: its shape, fill, uniform line and shadow; a side drawn alone is its own bar (named `<id>:border-<side>`). */
function paintObjects(el: MeasuredElement, withFill: boolean): { options: PptxGenJS.ShapeProps; shape: PptxGenJS.SHAPE_NAME; sides: PptxObject[] } {
  const { paint, box } = el;
  const { shape, rectRadius } = boxShape(paint, box);
  const options: PptxGenJS.ShapeProps = { ...at(box), objectName: el.id, ...(rectRadius !== undefined && { rectRadius }), ...(el.rotate && { rotate: el.rotate }) };
  const fill = withFill ? fillOf(paint.fill, paint.opacity) : undefined;
  options.fill = fill ?? { type: 'none' };
  const sides: PptxObject[] = [];
  if (uniform(paint.borders)) {
    const line = lineOf(paint.borders[0], paint.opacity);
    if (line) options.line = line;
  } else {
    const names = ['top', 'right', 'bottom', 'left'] as const;
    paint.borders.forEach((border, i) => {
      const c = parseColor(border?.color);
      if (!border || !c) return;
      const bar: MeasuredBox =
        i === 0 ? { x: box.x, y: box.y, w: box.w, h: border.width } : i === 1 ? { x: box.x + box.w - border.width, y: box.y, w: border.width, h: box.h } : i === 2 ? { x: box.x, y: box.y + box.h - border.width, w: box.w, h: border.width } : { x: box.x, y: box.y, w: border.width, h: box.h };
      sides.push({ kind: 'shape', name: `${el.id}:border-${names[i]}`, shape: 'rect', options: { ...at(bar), objectName: `${el.id}:border-${names[i]}`, fill: { color: c.hex, transparency: transparencyOf(c.alpha, paint.opacity) }, line: { type: 'none' } } });
    });
  }
  const shadow = shadowOf(paint);
  if (shadow) options.shadow = shadow;
  return { options, shape, sides };
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
    const runs = paragraph.runs.length ? paragraph.runs : [null];
    runs.forEach((run, r) => {
      const end = r === runs.length - 1 && !last;
      if (!run) {
        out.push({ text: '', options: { ...para, ...(end && { breakLine: true }) } });
        return;
      }
      const color = parseColor(run.color);
      out.push({
        text: run.text,
        options: {
          ...para,
          fontFace: faceFor(run.font, variant),
          fontSize: points(run.size),
          bold: run.bold,
          italic: run.italic,
          ...(run.underline && { underline: { style: 'sng' } }),
          ...(run.strike && { strike: 'sngStrike' }),
          ...(color && { color: color.hex, ...(transparencyOf(color.alpha, opacity) > 0 && { transparency: transparencyOf(color.alpha, opacity) }) }),
          ...(run.letterSpacing !== 0 && { charSpacing: points(run.letterSpacing) }),
          ...(run.href && { hyperlink: { url: run.href } }),
          ...(run.breakBefore && { softBreakBefore: true }),
          ...(end && { breakLine: true }),
        },
      });
    });
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
  const { options: paint, shape, sides } = paintObjects(el, withFill);
  const options: PptxGenJS.TextPropsOptions = {
    ...at(el.box),
    objectName: el.id,
    margin: insets(text.padding, listIndent),
    valign: text.valign,
    fit: 'none',
    wrap: true,
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
  const crop = cropOf(el.attrs['data-crop']);
  const fit = crop ? 'cover' : image.fit;
  const [px, py] = crop ? [crop.x, crop.y] : image.position;
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

function imageObject(el: MeasuredElement, ir: ElementIR | undefined, options: PptxMapOptions): PptxObject[] {
  const src = ir?.attrs.src;
  const data = src?.startsWith('assets/') ? options.asset(src) : null;
  const natural = el.image?.natural;
  if (!data || !natural || natural.w <= 0 || natural.h <= 0) {
    // a placeholder (no picture, or one MAWS cannot draw): its place, filled as the canvas fills it
    return [{ kind: 'shape', name: el.id, shape: 'rect', options: { ...at(el.box), objectName: el.id, fill: { color: 'E3E6E4' }, line: { type: 'none' }, ...(el.rotate && { rotate: el.rotate }) } }];
  }
  const placed = placeImage(el, natural);
  const base: PptxGenJS.ImageProps = { data, objectName: el.id, altText: ir?.attrs.alt ?? '', ...(el.rotate && { rotate: el.rotate }) };
  const transparency = transparencyOf(1, el.paint.opacity);
  if (transparency > 0) base.transparency = transparency;
  if (!placed.crop) return [{ kind: 'image', name: el.id, options: { ...base, ...at(placed.box) } }];
  // pptxgenjs's crop: `w`/`h` the whole picture and `sizing` the window in the same units, so the window lands at the box
  const scale = placed.box.w / placed.crop.w;
  return [
    {
      kind: 'image',
      name: el.id,
      options: {
        ...base,
        x: inches(placed.box.x),
        y: inches(placed.box.y),
        w: inches(natural.w * scale),
        h: inches(natural.h * scale),
        sizing: { type: 'crop', x: inches(placed.crop.x * scale), y: inches(placed.crop.y * scale), w: inches(placed.box.w), h: inches(placed.box.h) },
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
  const local = connectorPoints(el.attrs, el.box.w, el.box.h, width);
  const pts = local.map(([x, y]): [number, number] => [el.box.x + x, el.box.y + y]);
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
  const own = el.shape ?? { fill: null, stroke: null };
  if (kind === 'line') {
    const color = parseColor(own.stroke?.color ?? own.fill ?? el.color);
    const y = el.box.y + el.box.h / 2;
    return lineObject(el.id, [[el.box.x, y], [el.box.x + el.box.w, y]], { width: points(own.stroke?.width ?? 2), ...(color && { color: color.hex }), dashType: dashOf(own.stroke?.style ?? 'solid') }, el.rotate);
  }
  const fill = fillOf(own.fill ?? 'rgb(217, 222, 219)', el.paint.opacity);
  const options: PptxGenJS.ShapeProps = { ...at(el.box), objectName: el.id, ...(fill && { fill }), ...(el.rotate && { rotate: el.rotate }) };
  const line = lineOf(own.stroke, el.paint.opacity);
  options.line = line ?? { type: 'none' };
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

function elementObjects(el: MeasuredElement, ir: ElementIR | undefined, picture: string | undefined, options: PptxMapOptions): PptxObject[] {
  switch (el.tag) {
    case 'img':
      return imageObject(el, ir, options);
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
    case 'table':
      return tableObject(el, options.variant);
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
