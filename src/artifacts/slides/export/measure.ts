// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12 "PPTX"; parent Decision Log 17, PPTX by measured
// geometry): what the export window reads of a deck's standalone page after layout, and the function that reads it.
//
// `measureDeckPage` runs inside the hidden 1920×1080 export window (main sends its source through `executeJavaScript`),
// so it is self-contained: it names nothing outside its own body but the page's globals, and survives being turned into
// text (`String(measureDeckPage)`; the unit suite evaluates it alone). It
// 1. waits for the page's faces and pictures,
// 2. fits every sized text box the page marked (`data-fit-box`: shrink to 60 % or 8 px then clip, grow, none), as the
//    canvas's fit pass does (canvas/fit.ts; a copy, since the window cannot import),
// 3. reads every slide: its background, then each element in paint order (document order, the page writing a section's
//    children under, flow, over), each with its box before rotation in slide px, its rotation, its paint, and for text
//    its paragraphs of runs with their computed face, size, weight, style, colour and decoration; tables by rows of
//    cells; pictures with their natural size; inline svg and icons as their markup in their colour.
// Portable: types and one function over the DOM, no imports.

export interface MeasuredBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MeasuredRun {
  text: string;
  /** The computed `font-family` stack. */
  font: string;
  /** px. */
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** CSS colour as computed (`rgb()`/`rgba()`). */
  color: string;
  /** px; 0 when normal. */
  letterSpacing: number;
  href?: string;
  /** A line break (`<br>`) before this run's text. */
  breakBefore?: boolean;
}

export interface MeasuredParagraph {
  runs: MeasuredRun[];
  align: 'left' | 'center' | 'right' | 'justify';
  /** px. */
  lineHeight: number;
  bullet?: 'disc' | 'decimal';
}

export interface MeasuredText {
  paragraphs: MeasuredParagraph[];
  /** px: top, right, bottom, left. */
  padding: [number, number, number, number];
  valign: 'top' | 'middle' | 'bottom';
  /** The union of the text's line boxes in slide px (the LibreOffice compare's reference). */
  ink: MeasuredBox | null;
}

export interface MeasuredBorder {
  width: number;
  style: string;
  color: string;
}

export interface MeasuredPaint {
  /** The background colour (null when transparent). */
  fill: string | null;
  /** A background image (a gradient): the element flattens to a picture of its region. */
  image: boolean;
  /** One per side: top, right, bottom, left (null where there is none). */
  borders: [MeasuredBorder | null, MeasuredBorder | null, MeasuredBorder | null, MeasuredBorder | null];
  /** px (the top-left corner's). */
  radius: number;
  /** The first outer shadow. */
  shadow: { x: number; y: number; blur: number; color: string } | null;
  /** The element's opacity times its ancestors' within the slide. */
  opacity: number;
}

export interface MeasuredCell {
  box: MeasuredBox;
  fill: string | null;
  borders: MeasuredPaint['borders'];
  text: MeasuredText;
  header: boolean;
}

export interface MeasuredRow {
  id: string;
  box: MeasuredBox;
  fill: string | null;
  cells: MeasuredCell[];
}

export interface MeasuredElement {
  id: string;
  tag: string;
  /** The box before rotation, in slide px. */
  box: MeasuredBox;
  /** Degrees clockwise. */
  rotate: number;
  paint: MeasuredPaint;
  /** The computed text colour (an x-icon's and an x-connector's stroke). */
  color: string;
  text?: MeasuredText;
  /** The fit applied to a sized text box: `shrink` with the fitted size, or `grow`. */
  fit?: { mode: 'shrink'; size: number; clipped: boolean } | { mode: 'grow' };
  image?: { natural: { w: number; h: number }; fit: string; position: [number, number]; placeholder: boolean };
  rows?: MeasuredRow[];
  /** svg and x-icon: the graphic's markup, its colour set. */
  svg?: string;
  /** An x-shape's own paint (its box draws none; the outline takes the box's background and border). */
  shape?: { fill: string | null; stroke: MeasuredBorder | null };
  /** The element's attributes but `style`, `src` and the page's own. */
  attrs: Record<string, string>;
}

export interface MeasuredSlide {
  id: string;
  background: { fill: string | null; image: boolean };
  elements: MeasuredElement[];
}

export interface MeasuredDeck {
  slides: MeasuredSlide[];
}

/** The arguments `measureDeckPage` takes (JSON). */
export interface MeasureArgs {
  /** The text tags whose content is runs. */
  textTags: string[];
}

// The DOM the function touches, typed here: main imports this module (to send the function's text) under the node
// project, which has no DOM library.
interface DomRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}
interface DomStyle {
  getPropertyValue(name: string): string;
  setProperty(name: string, value: string): void;
}
interface DomNode {
  nodeType: number;
  textContent: string | null;
  childNodes: ArrayLike<DomNode>;
  parentElement: DomElement | null;
}
interface DomElement extends DomNode {
  tagName: string;
  children: ArrayLike<DomElement>;
  attributes: ArrayLike<{ name: string; value: string }>;
  style: DomStyle;
  offsetWidth?: number;
  offsetHeight?: number;
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  getBoundingClientRect(): DomRect;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  closest(selector: string): DomElement | null;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
  cloneNode(deep: boolean): DomElement;
  remove(): void;
}
interface DomImage extends DomElement {
  complete: boolean;
  naturalWidth: number;
  naturalHeight: number;
  decode(): Promise<void>;
}
interface DomTable extends DomElement {
  rows: ArrayLike<DomElement & { cells: ArrayLike<DomElement> }>;
}
interface DomGlobals {
  document: {
    fonts?: { ready: Promise<unknown> };
    querySelectorAll(selector: string): ArrayLike<DomElement>;
    createRange(): { selectNodeContents(node: DomNode): void; getClientRects(): ArrayLike<DomRect> };
    createElement(tag: string): DomElement;
    body: DomElement & { appendChild(node: DomElement): void };
  };
  getComputedStyle(element: DomElement): DomStyle;
  DOMMatrixReadOnly: new (transform: string) => { a: number; b: number };
  XMLSerializer: new () => { serializeToString(node: DomElement): string };
}

/**
 * Fits, then measures every slide of the page (see the header). Self-contained: evaluated alone in the export window.
 */
export async function measureDeckPage(args: MeasureArgs): Promise<MeasuredDeck> {
  const g = globalThis as unknown as DomGlobals;
  const doc = g.document;
  await doc.fonts?.ready; // absent where there is no font loading (a DOM without layout)
  await Promise.all(Array.from(doc.querySelectorAll("img") as ArrayLike<DomImage>).map((img) => (img.complete ? null : img.decode().catch(() => null))));
  const textTags = new Set(args.textTags);
  const num = (value: string): number => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  };
  const style = (el: DomElement) => g.getComputedStyle(el);
  const css = (el: DomElement, name: string) => style(el).getPropertyValue(name);
  const transparent = (color: string) => color === '' || color === 'transparent' || /^rgba\([^)]*,\s*0\)$/.test(color.replace(/\s+/g, ' '));

  // ---- the fit pass (canvas/fit.ts) ----
  const overflows = (n: DomElement) => n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1;
  const fits = new Map<DomElement, NonNullable<MeasuredElement['fit']>>();
  for (const n of Array.from(doc.querySelectorAll('[data-fit-box]'))) {
    const mode = n.getAttribute('data-fit-box');
    if (mode === 'none') continue;
    if (mode === 'grow') {
      n.style.setProperty('min-height', n.style.getPropertyValue('height'));
      n.style.setProperty('height', 'auto');
      fits.set(n, { mode: 'grow' });
      continue;
    }
    if (!overflows(n)) continue;
    const base = num(css(n, 'font-size'));
    if (base <= 0) continue;
    const floor = Math.min(1, Math.max(0.6, 8 / base));
    let lo = floor;
    let hi = 1;
    for (let k = 0; k < 7; k++) {
      const mid = (lo + hi) / 2;
      n.style.setProperty('font-size', `${base * mid}px`);
      if (overflows(n)) hi = mid;
      else lo = mid;
    }
    n.style.setProperty('font-size', `${base * lo}px`);
    const clipped = overflows(n);
    if (clipped) n.style.setProperty('overflow', 'hidden');
    fits.set(n, { mode: 'shrink', size: base * lo, clipped });
  }

  // ---- geometry ----
  const angleOf = (el: DomElement): { angle: number; scale: number } => {
    const t = css(el, 'transform');
    if (!t || t === 'none') return { angle: 0, scale: 1 };
    const m = new g.DOMMatrixReadOnly(t);
    return { angle: (Math.atan2(m.b, m.a) * 180) / Math.PI, scale: Math.hypot(m.a, m.b) };
  };
  const rectIn = (rect: Pick<DomRect, 'left' | 'top' | 'width' | 'height'>, slide: DomElement): MeasuredBox => {
    const origin = slide.getBoundingClientRect();
    return { x: rect.left - origin.left, y: rect.top - origin.top, w: rect.width, h: rect.height };
  };
  // The box before rotation: the drawn box's centre with the layout size scaled (a rotation about the centre, CSS's
  // default origin, keeps the centre where it was).
  const boxOf = (el: DomElement, slide: DomElement): { box: MeasuredBox; rotate: number } => {
    const drawn = rectIn(el.getBoundingClientRect(), slide);
    let angle = 0;
    let scale = 1;
    for (let at: DomElement | null = el; at && at !== slide; at = at.parentElement) {
      const own = angleOf(at);
      angle += own.angle;
      scale *= own.scale;
    }
    const rotate = (((Math.round(angle * 100) / 100) % 360) + 360) % 360;
    if (rotate === 0 && Math.abs(scale - 1) < 1e-6) return { box: drawn, rotate: 0 };
    const w = (el.offsetWidth ?? el.clientWidth) * scale;
    const h = (el.offsetHeight ?? el.clientHeight) * scale;
    const [cx, cy] = [drawn.x + drawn.w / 2, drawn.y + drawn.h / 2];
    return { box: { x: cx - w / 2, y: cy - h / 2, w, h }, rotate };
  };
  const bordersOf = (el: DomElement): MeasuredPaint['borders'] =>
    (['top', 'right', 'bottom', 'left'] as const).map((side) => {
      const width = num(css(el, `border-${side}-width`));
      const kind = css(el, `border-${side}-style`);
      const color = css(el, `border-${side}-color`);
      return width > 0 && kind !== 'none' && kind !== 'hidden' && !transparent(color) ? { width, style: kind, color } : null;
    }) as MeasuredPaint['borders'];
  const shadowOf = (value: string): MeasuredPaint['shadow'] => {
    if (!value || value === 'none') return null;
    for (const layer of value.split(/,(?![^(]*\))/)) {
      if (/\binset\b/.test(layer)) continue;
      const color = /(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})/.exec(layer)?.[1] ?? 'rgb(0, 0, 0)';
      const lengths = (layer.replace(color, '').match(/-?\d*\.?\d+px/g) ?? []).map(num);
      return { x: lengths[0] ?? 0, y: lengths[1] ?? 0, blur: lengths[2] ?? 0, color };
    }
    return null;
  };
  const opacityOf = (el: DomElement, slide: DomElement): number => {
    let o = 1;
    for (let at: DomElement | null = el; at && at !== slide; at = at.parentElement) {
      const own = Number.parseFloat(css(at, 'opacity'));
      if (Number.isFinite(own)) o *= own;
    }
    return o;
  };
  const fillOf = (el: DomElement): string | null => {
    const color = css(el, 'background-color');
    return transparent(color) ? null : color;
  };
  const imageOf = (el: DomElement): boolean => {
    const image = css(el, 'background-image');
    return image !== '' && image !== 'none';
  };
  const paintOf = (el: DomElement, slide: DomElement): MeasuredPaint => ({
    fill: fillOf(el),
    image: imageOf(el),
    borders: bordersOf(el),
    radius: num(css(el, 'border-top-left-radius')),
    shadow: shadowOf(css(el, 'box-shadow')),
    opacity: opacityOf(el, slide),
  });

  // ---- text ----
  const alignOf = (value: string): MeasuredParagraph['align'] => (value === 'center' ? 'center' : value === 'right' || value === 'end' ? 'right' : value === 'justify' ? 'justify' : 'left');
  const decoratedBy = (node: DomElement, root: DomElement, line: string): boolean => {
    for (let at: DomElement | null = node; at; at = at.parentElement) {
      if (css(at, 'text-decoration-line').includes(line)) return true;
      if (at === root) break;
    }
    return false;
  };
  const runOf = (text: string, parent: DomElement, root: DomElement): MeasuredRun => {
    const href = parent.closest('a')?.getAttribute('href') ?? undefined;
    const fontStyle = css(parent, 'font-style');
    const spacing = css(parent, 'letter-spacing');
    return {
      text,
      font: css(parent, 'font-family'),
      size: num(css(parent, 'font-size')),
      bold: num(css(parent, 'font-weight')) >= 600,
      italic: fontStyle === 'italic' || fontStyle.startsWith('oblique'),
      underline: decoratedBy(parent, root, 'underline'),
      strike: decoratedBy(parent, root, 'line-through'),
      color: css(parent, 'color'),
      letterSpacing: spacing === 'normal' ? 0 : num(spacing),
      ...(href && { href }),
    };
  };
  const paragraphOf = (block: DomElement, bullet?: MeasuredParagraph['bullet']): MeasuredParagraph => {
    const runs: MeasuredRun[] = [];
    let breakNext = false;
    const walk = (node: DomNode) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
          const text = (child.textContent ?? '').replace(/[ \t\n\r\f]+/g, ' ');
          if (!text) continue;
          runs.push({ ...runOf(text, child.parentElement ?? block, block), ...(breakNext && { breakBefore: true }) });
          breakNext = false;
        } else if (child.nodeType === 1 && (child as DomElement).tagName === 'BR') breakNext = true;
        else if (child.nodeType === 1) walk(child);
      }
    };
    walk(block);
    if (runs.length) runs[0]!.text = runs[0]!.text.replace(/^ /, '');
    const size = num(css(block, 'font-size'));
    const line = css(block, 'line-height');
    return { runs: runs.filter((r) => r.text !== ''), align: alignOf(css(block, 'text-align')), lineHeight: line === 'normal' || line === '' ? size * 1.2 : num(line), ...(bullet && { bullet }) };
  };
  const inkOf = (el: DomElement, slide: DomElement): MeasuredBox | null => {
    const range = doc.createRange();
    range.selectNodeContents(el);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) return null;
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return rectIn({ left, top, width: right - left, height: bottom - top }, slide);
  };
  const textOf = (el: DomElement, slide: DomElement): MeasuredText => {
    const tag = el.tagName.toLowerCase();
    const paragraphs =
      tag === 'ul' || tag === 'ol'
        ? Array.from(el.children)
            .filter((li) => li.tagName === 'LI')
            .map((li) => paragraphOf(li, tag === 'ol' ? 'decimal' : 'disc'))
        : [paragraphOf(el)];
    const valign = css(el, 'vertical-align');
    return {
      paragraphs,
      padding: [num(css(el, 'padding-top')), num(css(el, 'padding-right')), num(css(el, 'padding-bottom')), num(css(el, 'padding-left'))],
      valign: tag === 'td' || tag === 'th' ? (valign === 'middle' ? 'middle' : valign === 'bottom' ? 'bottom' : 'top') : 'top',
      ink: inkOf(el, slide),
    };
  };

  // ---- graphics ----
  const markupOf = (svg: DomElement, color: string, box: MeasuredBox): string => {
    const copy = svg.cloneNode(true);
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('width', String(Math.max(1, Math.round(box.w))));
    copy.setAttribute('height', String(Math.max(1, Math.round(box.h))));
    copy.setAttribute('color', color);
    copy.setAttribute('style', `color:${color}`);
    return new g.XMLSerializer().serializeToString(copy);
  };
  const positionOf = (value: string): [number, number] => {
    const parts = value.trim().split(/\s+/);
    const pct = (part: string | undefined) => (part && part.endsWith('%') ? num(part) / 100 : 0.5);
    return [pct(parts[0]), pct(parts[1])];
  };

  // An x-shape's outline paints from its box's own background and border, which the canvas's stylesheet hides on the
  // box: read from the inline style, each colour computed through a probe.
  const probe = doc.createElement('div');
  doc.body.appendChild(probe);
  const colorOf = (value: string): string | null => {
    if (!value) return null;
    probe.style.setProperty('color', '');
    probe.style.setProperty('color', value);
    const color = css(probe, 'color');
    return transparent(color) ? null : color;
  };
  const shapeOf = (el: DomElement): NonNullable<MeasuredElement['shape']> => {
    const own = (name: string) => el.style.getPropertyValue(name);
    const width = own('border-top-width');
    const kind = own('border-top-style');
    const color = colorOf(own('border-top-color'));
    const strokeWidth = width ? num(width) : 1;
    return {
      // a gradient draws the canvas's default fill (the outline takes a flat colour only)
      fill: /gradient\(/.test(own('background-image') + own('background')) ? null : colorOf(own('background-color') || own('background')),
      stroke: kind && kind !== 'none' && strokeWidth > 0 ? { width: strokeWidth, style: kind, color: color ?? 'rgb(0, 0, 0)' } : null,
    };
  };

  const slides: MeasuredSlide[] = [];
  for (const slide of Array.from(doc.querySelectorAll('section.maws-slide'))) {
    const elements: MeasuredElement[] = [];
    for (const el of Array.from(slide.querySelectorAll('[data-eid]'))) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'tr' || tag === 'th' || tag === 'td') continue; // read with their table
      if (css(el, 'display') === 'none') continue;
      const { box, rotate } = boxOf(el, slide);
      const attrs: Record<string, string> = {};
      for (const a of Array.from(el.attributes)) if (!['style', 'src', 'data-eid', 'data-layer', 'data-fit-box'].includes(a.name)) attrs[a.name] = a.value;
      const color = css(el, 'color');
      const measured: MeasuredElement = { id: el.getAttribute('data-eid') ?? '', tag, box, rotate, paint: paintOf(el, slide), color, attrs };
      if (textTags.has(tag)) measured.text = textOf(el, slide);
      const fit = fits.get(el);
      if (fit) measured.fit = fit;
      if (tag === 'img') {
        const img = el as DomImage;
        measured.image = { natural: { w: img.naturalWidth, h: img.naturalHeight }, fit: css(img, 'object-fit'), position: positionOf(css(img, 'object-position')), placeholder: img.hasAttribute('data-placeholder') };
      }
      if (tag === 'svg') measured.svg = markupOf(el, color, box);
      if (tag === 'x-shape') measured.shape = shapeOf(el);
      if (tag === 'x-connector') {
        // its line: the box's own border width and style (the stylesheet hides the box's border), in its text colour
        const width = num(el.style.getPropertyValue('border-top-width'));
        measured.shape = { fill: null, stroke: { width: width > 0 ? width : 2, style: el.style.getPropertyValue('border-top-style') || 'solid', color } };
      }
      if (tag === 'x-icon') {
        const glyph = el.querySelector('svg');
        if (glyph) measured.svg = markupOf(glyph, color, box);
      }
      if (tag === 'table') {
        measured.rows = Array.from((el as DomTable).rows).map((tr) => ({
          id: tr.getAttribute('data-eid') ?? '',
          box: rectIn(tr.getBoundingClientRect(), slide),
          fill: fillOf(tr),
          cells: Array.from(tr.cells).map((cell) => ({
            box: rectIn(cell.getBoundingClientRect(), slide),
            fill: fillOf(cell),
            borders: bordersOf(cell),
            text: textOf(cell, slide),
            header: cell.tagName === 'TH',
          })),
        }));
      }
      elements.push(measured);
    }
    slides.push({ id: slide.getAttribute('data-slide') ?? '', background: { fill: fillOf(slide), image: imageOf(slide) }, elements });
  }
  probe.remove();
  return { slides };
}
