// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12 "PPTX"; parent Decision Log 17, PPTX by measured
// geometry): what the export window reads of a deck's standalone page after layout, and the function that reads it.
//
// `measureDeckPage` runs inside the hidden 1920×1080 export window (main sends its source through `executeJavaScript`),
// so it is self-contained: it names nothing outside its own body but the page's globals, and survives being turned into
// text (`String(measureDeckPage)`; the unit suite evaluates it alone). It
// 1. waits for the page's faces and pictures,
// 2. fits every sized text box the page marked (`data-fit-box`: shrink to 60 % or 8 px then clip, grow, none), as the
//    canvas's fit pass does, its search the shared `shrinkScale` (render-rules.ts), whose source main sends beside this
//    function's and which arrives as the second argument,
// 3. reads every slide: its background, then each element in paint order (document order, the page writing a section's
//    children under, flow, over), each with its box before rotation in slide px, its rotation (under a skew, its drawn
//    box too), its paint, and for text its paragraphs of runs with their computed face, size, weight, style, colour and
//    decoration, the text as shown (its `text-transform` applied) and every line break the app shows (the final
//    review's A9, A10); tables by rows of cells; pictures with their natural size; inline svg and icons as their markup
//    in their colour. What a hidden ancestor hides is left out.
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
  /**
   * The line breaks (`<br>`) before this run's text, as many as the app shows (absent at none). A run with no text carries
   * the empty lines a paragraph ends with: a block's last break ends its line and adds none, so `A<br><br>` ends with one.
   */
  breaks?: number;
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
  /** Every paragraph sits on one line in the app: the PPTX box does not wrap it (a wider substitute face runs on). */
  oneLine: boolean;
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
  /**
   * The scale its transforms and its ancestors' draw it at, across and down (absent at 1): its box is drawn size, but
   * its text, insets, borders, radii, shadows and connector coordinates are its own CSS px, scaled by the mapping.
   */
  scale?: [number, number];
  /** The composed linear transform of its own and its ancestors' (a, b, c, d), absent at identity: its drawn pose. */
  linear?: [number, number, number, number];
  /** The mapping's own: a connector's scale, kept for its coordinates once its metrics are at drawn size. */
  connectorScale?: [number, number];
  /**
   * P4 (the skewed-element row): the region it paints on the slide, present when its composed transform skews it (a
   * `skewX`/`skewY`, its own or an ancestor's), so that no box, turn and scale describe its pose: its drawn bounding box
   * widened by what it paints past its border box (its shadows, a blur, its content's overflow), within the slide, which
   * clips the rest as the canvas does. Empty when the slide shows none of it.
   */
  drawn?: MeasuredBox;
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
  shape?: { fill: string | null; stroke: MeasuredBorder | null; shadow?: MeasuredPaint['shadow'] };
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
  DOMMatrixReadOnly: new (transform: string) => { a: number; b: number; c: number; d: number };
  XMLSerializer: new () => { serializeToString(node: DomElement): string };
}

/**
 * Fits, then measures every slide of the page (see the header). Self-contained: evaluated alone in the export window.
 */
export async function measureDeckPage(args: MeasureArgs, shrinkScale: (base: number, overflowsAt: (px: number) => boolean) => number): Promise<MeasuredDeck> {
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
    const lo = shrinkScale(base, (px) => {
      n.style.setProperty('font-size', `${px}px`);
      return overflows(n);
    });
    n.style.setProperty('font-size', `${base * lo}px`);
    const clipped = overflows(n);
    if (clipped) n.style.setProperty('overflow', 'hidden');
    fits.set(n, { mode: 'shrink', size: base * lo, clipped });
  }

  // ---- geometry ----
  // An element's own linear transform (a, b, c, d), identity when it has none.
  const linearOf = (el: DomElement): [number, number, number, number] => {
    const t = css(el, 'transform');
    if (!t || t === 'none') return [1, 0, 0, 1];
    const m = new g.DOMMatrixReadOnly(t);
    return [m.a, m.b, m.c, m.d];
  };
  const rectIn = (rect: Pick<DomRect, 'left' | 'top' | 'width' | 'height'>, slide: DomElement): MeasuredBox => {
    const origin = slide.getBoundingClientRect();
    return { x: rect.left - origin.left, y: rect.top - origin.top, w: rect.width, h: rect.height };
  };
  // The box before rotation: the drawn box's centre with the layout size scaled (a rotation about the centre, CSS's
  // default origin, keeps the centre where it was). The element's and its ancestors' transforms compose (outermost
  // first): their rotation is the box's, their scale on each axis (fix wave 1) the factor its contents are drawn at.
  // P4: a skew leaves the composed matrix's columns out of square (a box drawn as a parallelogram); the drawn box, its
  // bounding box, is answered with it.
  const boxOf = (el: DomElement, slide: DomElement): { box: MeasuredBox; rotate: number; scale: [number, number]; linear: [number, number, number, number]; skewed: MeasuredBox | null } => {
    const drawn = rectIn(el.getBoundingClientRect(), slide);
    let [a, b, c, d] = [1, 0, 0, 1];
    for (let at: DomElement | null = el; at && at !== slide; at = at.parentElement) {
      const [p, q, r, s] = linearOf(at); // world = own ancestors' ∘ … ∘ this one's
      [a, b, c, d] = [p * a + r * b, q * a + s * b, p * c + r * d, q * c + s * d];
    }
    const sx = Math.hypot(a, b);
    const sy = sx > 0 ? Math.abs(a * d - b * c) / sx : 0;
    const angle = (Math.atan2(b, a) * 180) / Math.PI;
    const rotate = (((Math.round(angle * 100) / 100) % 360) + 360) % 360;
    const scale: [number, number] = [Math.round(sx * 1e6) / 1e6, Math.round(sy * 1e6) / 1e6];
    const linear: [number, number, number, number] = [a, b, c, d];
    const skewed = Math.abs(a * c + b * d) > 1e-6 * sx * Math.hypot(c, d) ? drawn : null;
    if (rotate === 0 && scale[0] === 1 && scale[1] === 1 && Math.abs(b) < 1e-9 && Math.abs(c) < 1e-9) return { box: drawn, rotate: 0, scale, linear, skewed };
    const w = (el.offsetWidth ?? el.clientWidth) * sx;
    const h = (el.offsetHeight ?? el.clientHeight) * sy;
    const [cx, cy] = [drawn.x + drawn.w / 2, drawn.y + drawn.h / 2];
    return { box: { x: cx - w / 2, y: cy - h / 2, w, h }, rotate, scale, linear, skewed };
  };
  // P4 (the review of the skewed-element row): what an element paints past its border box, in its own px: the widest of
  // its outer box and text shadows (offset, twice the blur, the spread) and twice a blur filter, on every side.
  const outsetOf = (el: DomElement): number => {
    let out = 0;
    for (const value of [css(el, 'box-shadow'), css(el, 'text-shadow')]) {
      if (!value || value === 'none') continue;
      for (const layer of value.split(/,(?![^(]*\))/)) {
        if (/\binset\b/.test(layer)) continue;
        const [x = 0, y = 0, blur = 0, spread = 0] = (layer.replace(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}/, ' ').match(/-?\d*\.?\d+px/g) ?? []).map(num);
        out = Math.max(out, Math.max(Math.abs(x), Math.abs(y)) + 2 * blur + Math.max(0, spread));
      }
    }
    const blur = /blur\((\d*\.?\d+)px\)/.exec(css(el, 'filter'));
    return out + (blur ? 2 * num(blur[1]!) : 0);
  };
  // The region a skewed element paints on the slide: its drawn box widened by its outset and its content's overflow
  // (rightward and downward, where text overflows), each carried by its composed linear transform, within the slide.
  const paintedIn = (el: DomElement, slide: DomElement, drawn: MeasuredBox, [a, b, c, d]: [number, number, number, number]): MeasuredBox => {
    const e = outsetOf(el);
    const ox = Math.max(0, el.scrollWidth - el.clientWidth);
    const oy = Math.max(0, el.scrollHeight - el.clientHeight);
    const dx = (Math.abs(a) + Math.abs(c)) * e + Math.abs(a) * ox + Math.abs(c) * oy;
    const dy = (Math.abs(b) + Math.abs(d)) * e + Math.abs(b) * ox + Math.abs(d) * oy;
    const page = slide.getBoundingClientRect();
    const [x0, y0] = [Math.max(0, drawn.x - dx), Math.max(0, drawn.y - dy)];
    const [x1, y1] = [Math.min(page.width, drawn.x + drawn.w + dx), Math.min(page.height, drawn.y + drawn.h + dy)];
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
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
  // The text as the app shows it under the computed (so inherited) `text-transform` (A10); `capitalize` raises a word's
  // first letter, a word running on across runs (`wor` + `ld`) by what came before it in the paragraph.
  const wordy = /[\p{L}\p{N}]/u;
  const shown = (text: string, el: DomElement, before: string): string => {
    const transform = css(el, 'text-transform');
    if (transform === 'uppercase') return text.toUpperCase();
    if (transform === 'lowercase') return text.toLowerCase();
    if (transform !== 'capitalize') return text;
    let out = '';
    let last = before;
    for (const ch of text) {
      out += wordy.test(ch) && !wordy.test(last) ? ch.toUpperCase() : ch;
      last = ch;
    }
    return out;
  };
  const paragraphOf = (block: DomElement, bullet?: MeasuredParagraph['bullet']): MeasuredParagraph => {
    const runs: MeasuredRun[] = [];
    let breaks = 0; // the line breaks since the last run (A9: each one kept)
    let before = ''; // the paragraph's text so far, its last character
    const walk = (node: DomNode) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
          let text = (child.textContent ?? '').replace(/[ \t\n\r\f]+/g, ' ');
          if (breaks > 0 || runs.length === 0) text = text.replace(/^ /, ''); // a line's leading space collapses away
          if (!text) continue;
          const parent = child.parentElement ?? block;
          text = shown(text, parent, before);
          before = text.slice(-1);
          runs.push({ ...runOf(text, parent, block), ...(breaks > 0 && { breaks }) });
          breaks = 0;
        } else if (child.nodeType === 1 && (child as DomElement).tagName === 'BR') {
          breaks++;
          before = '';
        } else if (child.nodeType === 1) walk(child);
      }
    };
    walk(block);
    // the breaks a block ends with: its last ends the line, the rest show as empty lines
    if (breaks > 1) runs.push({ ...runOf('', block, block), breaks: breaks - 1 });
    const size = num(css(block, 'font-size'));
    const line = css(block, 'line-height');
    return { runs, align: alignOf(css(block, 'text-align')), lineHeight: line === 'normal' || line === '' ? size * 1.2 : num(line), ...(bullet && { bullet }) };
  };
  // The line boxes of a block's text: one rect per line per text node (the nodes' own, never an element's box).
  const lineRects = (block: DomElement): DomRect[] => {
    const rects: DomRect[] = [];
    const walk = (node: DomNode) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3 && (child.textContent ?? '').trim()) {
          const range = doc.createRange();
          range.selectNodeContents(child);
          for (const r of Array.from(range.getClientRects())) if (r.width > 0 && r.height > 0) rects.push(r);
        } else if (child.nodeType === 1) walk(child);
      }
    };
    walk(block);
    return rects;
  };
  // Whether a block's text sits on one line: its line boxes share one band (a taller run on the line still overlaps it).
  // Lines are told by their centres, not by overlap: under a line height below the face's content height (1.05 at
  // 120 px) the boxes of two lines overlap, while a taller run on one line sits within half a line of its centre.
  const oneLine = (rects: DomRect[]): boolean => {
    if (rects.length <= 1) return true;
    const centre = (r: DomRect) => (r.top + r.bottom) / 2;
    const half = Math.min(...rects.map((r) => r.height)) / 2;
    return rects.every((r) => Math.abs(centre(r) - centre(rects[0]!)) < half);
  };
  const textOf = (el: DomElement): MeasuredText => {
    const tag = el.tagName.toLowerCase();
    const paragraphs =
      tag === 'ul' || tag === 'ol'
        ? Array.from(el.children)
            .filter((li) => li.tagName === 'LI')
            .map((li) => paragraphOf(li, tag === 'ol' ? 'decimal' : 'disc'))
        : [paragraphOf(el)];
    const blocks = tag === 'ul' || tag === 'ol' ? Array.from(el.children).filter((li) => li.tagName === 'LI') : [el];
    const perBlock = blocks.map(lineRects);
    const valign = css(el, 'vertical-align');
    return {
      paragraphs,
      padding: [num(css(el, 'padding-top')), num(css(el, 'padding-right')), num(css(el, 'padding-bottom')), num(css(el, 'padding-left'))],
      valign: tag === 'td' || tag === 'th' ? (valign === 'middle' ? 'middle' : valign === 'bottom' ? 'bottom' : 'top') : 'top',
      oneLine: perBlock.every(oneLine),
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
      shadow: shadowWith(own('box-shadow')),
    };
  };
  // a shadow from an inline value: its colour computed through the probe (a named colour, a hex)
  const shadowWith = (value: string): MeasuredPaint['shadow'] => {
    if (!value || value === 'none') return null;
    for (const layer of value.split(/,(?![^(]*\))/)) {
      if (/\binset\b/.test(layer)) continue;
      const lengths = (layer.match(/-?\d*\.?\d+px|(?<![\w#.-])0(?![\w.%])/g) ?? []).map(num);
      const rest = layer.replace(/-?\d*\.?\d+px|(?<![\w#.-])0(?![\w.%])/g, ' ').trim();
      return { x: lengths[0] ?? 0, y: lengths[1] ?? 0, blur: lengths[2] ?? 0, color: colorOf(rest) ?? 'rgb(0, 0, 0)' };
    }
    return null;
  };

  // Not drawn: the element or an ancestor within the slide is `display:none` (a hidden group's members draw nothing).
  const hiddenIn = (el: DomElement, slide: DomElement): boolean => {
    for (let at: DomElement | null = el; at && at !== slide; at = at.parentElement) if (css(at, 'display') === 'none') return true;
    return false;
  };

  const slides: MeasuredSlide[] = [];
  for (const slide of Array.from(doc.querySelectorAll('section.maws-slide'))) {
    const elements: MeasuredElement[] = [];
    for (const el of Array.from(slide.querySelectorAll('[data-eid]'))) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'tr' || tag === 'th' || tag === 'td') continue; // read with their table
      if (hiddenIn(el, slide)) continue;
      const { box, rotate, scale, linear, skewed } = boxOf(el, slide);
      const attrs: Record<string, string> = {};
      for (const a of Array.from(el.attributes)) if (!['style', 'src', 'data-eid', 'data-layer', 'data-fit-box'].includes(a.name)) attrs[a.name] = a.value;
      const color = css(el, 'color');
      const measured: MeasuredElement = { id: el.getAttribute('data-eid') ?? '', tag, box, rotate, ...(scale[0] !== 1 || scale[1] !== 1 ? { scale } : {}), ...(linear[0] !== 1 || linear[1] !== 0 || linear[2] !== 0 || linear[3] !== 1 ? { linear } : {}), ...(skewed && { drawn: paintedIn(el, slide, skewed, linear) }), paint: paintOf(el, slide), color, attrs };
      if (textTags.has(tag)) measured.text = textOf(el);
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
            text: textOf(cell),
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
