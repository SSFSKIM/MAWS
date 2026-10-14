// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D1, D4, D6), from S6's `spikes/p3-store/s6/src/parse.ts`,
// completed per S6's copy list. The loader of one slide file: a file's markup → SlideIR, with Claude's loading rule:
// an unknown property or attribute is dropped with a diagnostic naming slide, element and property; a slide that
// fails structurally (a limit, a tag out of place, an image URL) is held with its reasons, never trimmed. The one HTML
// front end is html.ts (parse5), the same in the host and the renderer.
import { parseStyle, spanStyle, isAssetRef, type StyleDiagnostic, type StyleSite } from './css';
import { parseHtml, type RawElement, type RawNode } from './html';
import {
  isPinned, LIST_TAGS, MARK_ORDER, TEXT_TAGS,
  type Attrs, type Diagnostic, type ElementIR, type Inline, type LoadResult, type MarkName, type Marks, type SlideIR, type Style, type Tag, type TextBlock,
} from './ir';

/** A slide or element id (Claude's rule; the file name is the slide's). */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The loader's limits per slide (Claude's `format.md` and `deck-files.md`; §4.5). Past any of them a slide is held. */
export const SLIDE_LIMITS = {
  divDepth: 15,
  elements: 200,
  cells: 4000,
  tableRows: 100,
  tableColumns: 24,
  pinnedPerHost: 24,
  textChars: 20000,
  marks: 100,
  notes: 4000,
  svgBytes: 52 * 1024,
  embedBytes: 16 * 1024,
  embeds: 8,
} as const;

const ELEMENT_TAGS = new Set<string>(['h1', 'h2', 'h3', 'p', 'ul', 'ol', 'div', 'img', 'table', 'hr', 'svg', 'x-shape', 'x-icon', 'x-connector', 'x-embed']);
const ATTRS: Partial<Record<Tag, readonly string[]>> = {
  img: ['src', 'alt', 'data-crop'],
  'x-shape': ['kind'],
  'x-icon': ['name'],
  'x-connector': ['x1', 'y1', 'x2', 'y2', 'head', 'head-start', 'head-end', 'route', 'from'],
  div: ['data-group'],
};
/** On any element: text fit, the layout placeholder role (X28, kept so "new slide from layout" can strip it) and builds. */
const COMMON_ATTRS = ['data-fit', 'data-ph', 'data-build-in', 'data-build-out'];
const SHAPE_KINDS = ['rect', 'rounded', 'ellipse', 'diamond', 'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'line'];
export const ICON_NAMES = ('Activity Book Chart Chat Check CheckCircle Clock Cloud Code Database Globe GraduationCap Home Key Lightbulb ' +
  'Lightning Link Lock PaperPlane Play Search Settings Star ThumbsUp Tool Trust Users Verified Warning Wrench').split(' ');
const ENUMS: Record<string, readonly string[]> = {
  'data-transition': ['fade', 'push', 'magic'],
  'data-fit': ['none', 'shrink', 'grow'],
  kind: SHAPE_KINDS,
  name: ICON_NAMES,
  head: ['end', 'both', 'none'],
  'head-start': ['none', 'open', 'filled'],
  'head-end': ['none', 'open', 'filled'],
  route: ['straight', 'hv', 'vh', 'elbow'],
  from: ['tl', 'tr', 'bl', 'br'],
};
const BUILD_EFFECTS = ['fade', 'rise', 'drop', 'left', 'right', 'scale', 'pop'];
const COORDS = ['x1', 'y1', 'x2', 'y2'];

/** 32-bit FNV-1a, base36, 4 characters: the `<hash>` of a minted id. */
export function hash4(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(4, '0').slice(-4);
}

export interface LoadOptions {
  /** The file name's id; the section's id must equal it. */
  fileId?: string;
  /**
   * D4's first choice for an element written without an id: the id of the element at the same place in the slide the
   * writer last read (`parentPath` is the ancestors' ids from the slide's, joined by `/`; `index` its place among its
   * siblings). The loader takes it when it is a valid id used nowhere else in this file; otherwise it mints.
   */
  mint?: (parentPath: string, index: number, tag: Tag) => string | undefined;
  /** Ids never minted (the base slide's, any an anchor still names), beside every id in this file. */
  taken?: ReadonlySet<string>;
}

class Held extends Error {}

/** Load one slide file. */
export function loadSlide(source: string, opts: LoadOptions = {}): LoadResult {
  const diags: Diagnostic[] = [];
  const reasons: string[] = [];
  const loader = new Loader(diags, reasons, opts);
  try {
    const slide = loader.run(parseHtml(source));
    if (reasons.length) return { ok: false, held: { reasons }, diagnostics: loader.resolved() };
    return { ok: true, slide, diagnostics: loader.resolved() };
  } catch (e) {
    if (e instanceof Held) return { ok: false, held: { reasons }, diagnostics: loader.resolved() };
    throw e;
  }
}

interface ParentSite {
  tag: Tag | 'section';
  style: Style;
  /** The element itself (null for the section). */
  el: ElementIR | null;
}
/** The element a diagnostic names: the element, or for a table cell its row with the cell's column. */
type Subject = { el: ElementIR | null; cell?: number };
interface Pending {
  severity: Diagnostic['severity'];
  subject: Subject;
  property?: string;
  message: string;
}

class Loader {
  private ids = new Set<string>();
  private needsId: { el: ElementIR; parent: ElementIR | null; index: number }[] = [];
  private parents = new Map<ElementIR, ElementIR | null>();
  private pending: Pending[] = [];
  private elementCount = 0;
  private cellCount = 0;
  private textChars = 0;
  private markCount = 0;
  private embeds = 0;
  private sectionId = '';
  private readonly diags: Diagnostic[];
  private readonly reasons: string[];
  private readonly opts: LoadOptions;
  constructor(diags: Diagnostic[], reasons: string[], opts: LoadOptions) {
    this.diags = diags;
    this.reasons = reasons;
    this.opts = opts;
  }

  private hold(why: string): never {
    this.reasons.push(why);
    throw new Held(why);
  }
  private report(severity: Diagnostic['severity'], subject: Subject, message: string, property?: string) {
    this.pending.push({ severity, subject, message, ...(property === undefined ? {} : { property }) });
  }
  private warn(subject: Subject, message: string, property?: string) {
    this.report('warning', subject, message, property);
  }
  private note(subject: Subject, message: string, property?: string) {
    this.report('note', subject, message, property);
  }
  private styleReporter(subject: Subject) {
    return (d: StyleDiagnostic) => this.report(d.severity, subject, d.message, d.property);
  }

  /** The diagnostics with element ids, once ids are minted (an id-less element of a held slide is named by its tag). */
  resolved(): Diagnostic[] {
    for (const p of this.pending) {
      const { el, cell } = p.subject;
      const element = el === null ? undefined : el.id || `<${el.tag}>`;
      this.diags.push({
        severity: p.severity,
        slide: this.sectionId || this.opts.fileId || '',
        ...(element === undefined ? {} : { element }),
        ...(p.property === undefined ? {} : { property: p.property }),
        message: cell === undefined ? p.message : `cell ${cell + 1}: ${p.message}`,
      });
    }
    this.pending = [];
    return this.diags;
  }

  run(nodes: RawNode[]): SlideIR {
    const top = nodes.filter((n) => !(n.kind === 'text' && !n.value.trim()) && n.kind !== 'comment');
    if (top.length !== 1 || top[0]!.kind !== 'element' || top[0]!.tag !== 'section') this.hold('a slide file holds exactly one <section> and nothing else');
    const sec = top[0] as RawElement;
    const id = new Map(sec.attrs).get('id') ?? '';
    if (!ID_RE.test(id)) this.hold(`section id "${id}" is not [A-Za-z0-9_-]{1,64}`);
    if (this.opts.fileId !== undefined && id !== this.opts.fileId) this.hold(`section id "${id}" differs from the file name "${this.opts.fileId}"`);
    this.sectionId = id;
    this.ids.add(id);
    const section: Subject = { el: null };

    const slide: SlideIR = { id, attrs: {}, style: {}, children: [], notes: '' };
    for (const [name, value] of sec.attrs) {
      if (name === 'id' || name === 'style') continue;
      if (name === 'hidden') slide.attrs.hidden = '';
      else if (name === 'data-transition') this.enumAttr(slide.attrs, name, value, section);
      else if (name === 'data-section') {
        if (value.trim()) slide.attrs[name] = value.trim();
      } else this.dropAttr(section, name);
    }
    const style = sec.attrs.find(([k]) => k === 'style')?.[1];
    if (style !== undefined) slide.style = parseStyle(style, { tag: 'section', attrs: slide.attrs, parent: null }, this.styleReporter(section));

    const kids = sec.children.filter((n) => n.kind !== 'comment' || (this.note(section, 'a comment was dropped'), false));
    const asides = kids.filter((n) => n.kind === 'element' && n.tag === 'aside');
    if (asides.length > 1) this.hold('more than one <aside> (the speaker notes are one aside, the section’s last child)');
    if (asides.length === 1) {
      const last = [...kids].reverse().find((n) => !(n.kind === 'text' && !n.value.trim()));
      if (last !== asides[0]) this.hold('<aside> (the notes) is not the section’s last child');
      slide.notes = textContent(asides[0]!).trim();
      if (slide.notes.length > SLIDE_LIMITS.notes) this.hold(`${slide.notes.length} characters of speaker notes (over ${SLIDE_LIMITS.notes})`);
    }
    slide.children = this.children(kids.filter((n) => !asides.includes(n)), { tag: 'section', style: slide.style, el: null }, 0);
    if (this.elementCount > SLIDE_LIMITS.elements) this.hold(`${this.elementCount} elements (over ${SLIDE_LIMITS.elements})`);
    if (this.cellCount > SLIDE_LIMITS.cells) this.hold(`${this.cellCount} table cells (over ${SLIDE_LIMITS.cells})`);
    if (this.textChars > SLIDE_LIMITS.textChars) this.hold(`${this.textChars} characters of text (over ${SLIDE_LIMITS.textChars})`);
    if (this.markCount > SLIDE_LIMITS.marks) this.hold(`${this.markCount} inline marks (over ${SLIDE_LIMITS.marks})`);
    this.mintIds();
    return slide;
  }

  private children(nodes: RawNode[], parent: ParentSite, depth: number): ElementIR[] {
    const out: ElementIR[] = [];
    const subject: Subject = { el: parent.el };
    for (const n of nodes) {
      if (n.kind === 'comment') {
        this.note(subject, 'a comment was dropped');
        continue;
      }
      if (n.kind === 'text') {
        if (n.value.trim()) this.hold(`text "${n.value.trim().slice(0, 24)}" directly inside ${describe(parent)} (text goes in h1-h3, p, ul or ol)`);
        continue;
      }
      if (parent.tag === 'table') {
        if (n.tag === 'tbody' || n.tag === 'thead' || n.tag === 'tfoot') {
          out.push(...this.children(n.children, parent, depth)); // parse5 inserts a tbody in every table: no note
          continue;
        }
        if (n.tag !== 'tr') this.hold(`<${n.tag}> inside <table> (a table holds <tr> rows)`);
        out.push(this.element(n, 'tr', parent, depth, out.length));
        continue;
      }
      if (parent.tag === 'tr') {
        if (n.tag !== 'th' && n.tag !== 'td') this.hold(`<${n.tag}> inside <tr> (a row holds <th> and <td> cells)`);
        for (const [k] of n.attrs) if (k === 'colspan' || k === 'rowspan') this.hold(`${k} on a table cell (no spans)`);
        this.cellCount++;
        out.push(this.element(n, n.tag as Tag, parent, depth, out.length));
        continue;
      }
      if (!ELEMENT_TAGS.has(n.tag)) this.hold(`unknown or misplaced tag <${n.tag}>`);
      out.push(this.element(n, n.tag as Tag, parent, depth, out.length));
    }
    if (parent.tag === 'section' || parent.tag === 'div') {
      const pinned = out.filter((c) => isPinned(c.tag, c.style, c.attrs)).length;
      if (pinned > SLIDE_LIMITS.pinnedPerHost) this.hold(`${pinned} pinned children in ${describe(parent)} (over ${SLIDE_LIMITS.pinnedPerHost}; split them across sibling hosts)`);
    }
    if (parent.tag === 'table') {
      if (out.length > SLIDE_LIMITS.tableRows) this.hold(`a table of ${out.length} rows (over ${SLIDE_LIMITS.tableRows})`);
      const widest = Math.max(0, ...out.map((row) => row.children.length));
      if (widest > SLIDE_LIMITS.tableColumns) this.hold(`a table of ${widest} columns (over ${SLIDE_LIMITS.tableColumns})`);
    }
    return out;
  }

  private element(n: RawElement, tag: Tag, parent: ParentSite, depth: number, index: number): ElementIR {
    const cell = tag === 'th' || tag === 'td';
    if (tag !== 'tr' && !cell) this.elementCount++;
    const el: ElementIR = { id: '', tag, attrs: {}, style: {}, children: [] };
    this.parents.set(el, parent.el);
    // a cell is positional: its diagnostics name its row and its column
    const subject: Subject = cell ? { el: parent.el, cell: index } : { el };
    const allowed = new Set([...(ATTRS[tag] ?? []), ...COMMON_ATTRS]);
    let style: string | undefined;
    const builds: [string, string][] = [];
    for (const [name, value] of n.attrs) {
      if (name === 'style') style = value;
      else if (name === 'id') this.idAttr(el, value, subject, cell);
      else if (tag === 'svg') el.attrs[name] = value; // an svg's root attributes are kept verbatim (an opaque graphic)
      else if (tag === 'img' && /^data-video(-[a-z]+)*$/.test(name)) el.attrs[name] = value;
      else if (!allowed.has(name)) this.dropAttr(subject, name);
      else if (name === 'data-build-in' || name === 'data-build-out') builds.push([name, value]);
      else if (name in ENUMS) this.enumAttr(el.attrs, name, value, subject);
      else if (COORDS.includes(name)) this.coordinate(el, name, value);
      else if (name === 'src') this.src(el, value, subject);
      else if (name === 'data-crop') this.crop(el, value, subject);
      else if (name === 'data-ph') {
        if (/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.trim())) el.attrs[name] = value.trim();
        else this.warn(subject, `data-ph="${value}" is not a placeholder role name; dropped`, name);
      } else el.attrs[name] = value.trim();
    }
    if (tag === 'x-connector') {
      const given = COORDS.filter((c) => el.attrs[c] !== undefined);
      if (given.length > 0 && given.length < 4) this.hold(`an <x-connector> with ${given.join(', ')} but not ${COORDS.filter((c) => !given.includes(c)).join(', ')} (a connector takes all four coordinates, or none as a sized flow child)`);
    }
    if (style !== undefined) {
      const site: StyleSite = { tag, attrs: el.attrs, parent: { tag: parent.tag, style: parent.style } };
      el.style = parseStyle(style, site, this.styleReporter(subject));
    }
    for (const [name, value] of builds) this.build(el, name, value, subject);
    if (!el.id && !cell) this.needsId.push({ el, parent: parent.el, index });

    const site: ParentSite = { tag, style: el.style, el };
    if (tag === 'div') {
      const d = depth + 1;
      if (d > SLIDE_LIMITS.divDepth) this.hold(`more than ${SLIDE_LIMITS.divDepth} nested <div>s`);
      el.children = this.children(n.children, site, d);
    } else if (tag === 'table' || tag === 'tr') el.children = this.children(n.children, site, depth);
    else if (TEXT_TAGS.has(tag)) el.text = LIST_TAGS.has(tag) ? this.list(n, subject) : [this.block('p', n.children, subject)];
    else if (tag === 'svg') {
      const raw = n.inner();
      if (byteLength(raw) > SLIDE_LIMITS.svgBytes) this.hold(`an <svg> over ${SLIDE_LIMITS.svgBytes / 1024} KB`);
      if (/<script|\son[a-z]+\s*=|<foreignobject|(?:href|src)\s*=\s*["']?\s*(?:https?:|data:|\/\/)|url\(\s*["']?\s*(?:https?:|data:|\/\/)/i.test(raw)) {
        this.hold('an <svg> with script, an event handler, foreignObject or an external URL');
      }
      if (/<text[\s>]/i.test(raw)) this.warn(subject, 'an <svg> <text> draws without the deck’s fonts; put labels in <p> elements over it');
      el.raw = raw;
    } else if (tag === 'x-embed') {
      if (parent.tag !== 'section') this.hold('<x-embed> is not a direct child of the section');
      if (++this.embeds > SLIDE_LIMITS.embeds) this.hold(`more than ${SLIDE_LIMITS.embeds} <x-embed>s`);
      el.raw = n.inner();
      if (byteLength(el.raw) > SLIDE_LIMITS.embedBytes) this.hold(`an <x-embed> over ${SLIDE_LIMITS.embedBytes / 1024} KB`);
    } else if (n.children.some((c) => c.kind === 'element' || (c.kind === 'text' && c.value.trim()))) {
      this.hold(`<${tag}> holds content (shapes, icons, connectors, images and rules hold none)`);
    }
    if (tag === 'x-embed' && !isPinned(tag, el.style, el.attrs)) this.hold('<x-embed> is not pinned (position:absolute)');
    return el;
  }

  private idAttr(el: ElementIR, value: string, subject: Subject, cell: boolean) {
    if (cell) this.note(subject, 'a cell’s id is ignored (cells are positional)', 'id');
    else if (!ID_RE.test(value)) this.warn(subject, `id "${value}" is not [A-Za-z0-9_-]{1,64}; a new id is minted`, 'id');
    else if (this.ids.has(value)) this.warn(subject, `duplicate id "${value}"; a new id is minted`, 'id');
    else {
      el.id = value;
      this.ids.add(value);
    }
  }

  /** x1 y1 x2 y2: px (bare or `px`) or `%` of the host. */
  private coordinate(el: ElementIR, name: string, value: string) {
    const m = /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*(px|%)?\s*$/i.exec(value);
    if (m) el.attrs[name] = String(Number(m[1])) + (m[2] === '%' ? '%' : '');
    else this.hold(`an <x-connector> coordinate ${name}="${value}" is not a number of px or %`);
  }

  /** D6: MAWS's asset ref, Claude's upload path or an installed system's file; nothing makes a placeholder. */
  private src(el: ElementIR, value: string, subject: Subject) {
    const src = value.trim();
    if (src === '') this.note(subject, 'an empty src was dropped; the image is a placeholder', 'src');
    else if (isAssetRef(src)) el.attrs.src = src;
    else this.hold(`an <img> src "${src.slice(0, 60)}" is not assets/<name>, /_blob/<id> or project/ds/<folder>/<file> (never a URL, a data: URI or another path): upload the image`);
  }

  /** `data-crop="ZOOM X% Y%"`: zoom 1–50, the object position in percent. */
  private crop(el: ElementIR, value: string, subject: Subject) {
    const m = /^\s*(\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%\s*$/.exec(value);
    const zoom = m ? Number(m[1]) : NaN;
    if (m && zoom >= 1 && zoom <= 50) el.attrs['data-crop'] = `${Number(m[1])} ${Number(m[2])}% ${Number(m[3])}%`;
    else this.warn(subject, `data-crop="${value}" is not "ZOOM X% Y%" with a zoom of 1 to 50; dropped`, 'data-crop');
  }

  /** `data-build-in|out="EFFECT [ORDER 1–50] [auto]"` on a pinned element. */
  private build(el: ElementIR, name: string, value: string, subject: Subject) {
    if (!isPinned(el.tag, el.style, el.attrs)) {
      this.warn(subject, `${name} applies to pinned (position:absolute) elements only; dropped`, name);
      return;
    }
    const words = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const effect = words.find((w) => BUILD_EFFECTS.includes(w));
    const order = words.find((w) => /^\d+$/.test(w));
    const auto = words.includes('auto');
    const known = words.every((w) => w === effect || w === order || w === 'auto');
    if (!effect || !known || words.length !== [effect, order, auto ? 'auto' : undefined].filter(Boolean).length || (order !== undefined && (Number(order) < 1 || Number(order) > 50))) {
      this.warn(subject, `${name}="${value}" is not "${BUILD_EFFECTS.join('|')} [order 1–50] [auto]"; dropped`, name);
      return;
    }
    el.attrs[name] = [effect, order === undefined ? undefined : String(Number(order)), auto ? 'auto' : undefined].filter(Boolean).join(' ');
  }

  private list(n: RawElement, subject: Subject): TextBlock[] {
    const blocks: TextBlock[] = [];
    for (const c of n.children) {
      if (c.kind === 'comment' || (c.kind === 'text' && !c.value.trim())) continue;
      if (c.kind !== 'element' || c.tag !== 'li') this.hold(`a <${n.tag}> holds something other than <li>`);
      const li = c as RawElement;
      if (li.attrs.length) this.warn(subject, `<li> attributes dropped (plain items only)`, li.attrs.map(([k]) => k).join(' '));
      blocks.push(this.block('li', li.children, subject));
    }
    return blocks;
  }

  /** Inline content to normalized runs: HTML whitespace collapsing, adjacent equal runs merged. */
  private block(type: 'p' | 'li', nodes: RawNode[], subject: Subject): TextBlock {
    type Ch = { ch: string; marks: Marks } | { br: true };
    const chars: Ch[] = [];
    const where = subject.el ? `<${subject.el.tag}>` : 'the text';
    const walk = (ns: RawNode[], marks: Marks) => {
      for (const n of ns) {
        if (n.kind === 'comment') continue;
        if (n.kind === 'text') {
          for (const ch of n.value.replace(/[\t\n\r\f]/g, ' ')) chars.push({ ch, marks });
          continue;
        }
        let next: Marks | null = null;
        const add = (m: MarkName, v: object) => {
          next = { ...(next ?? marks), [m]: v };
        };
        switch (n.tag) {
          case 'br':
            chars.push({ br: true });
            continue;
          case 'b':
          case 'strong':
            add('b', {});
            if (n.tag === 'strong') this.note(subject, '<strong> became <b>');
            break;
          case 'i':
          case 'em':
            add('i', {});
            if (n.tag === 'em') this.note(subject, '<em> became <i>');
            break;
          case 'u':
            add('u', {});
            break;
          case 'a': {
            const href = n.attrs.find(([k]) => k === 'href')?.[1]?.trim();
            if (href && /^https:\/\//.test(href)) add('a', { href });
            else this.warn(subject, `link "${href ?? ''}" dropped (https links only); its text kept`, 'href');
            break;
          }
          case 'span': {
            const st = n.attrs.find(([k]) => k === 'style')?.[1] ?? '';
            const s = spanStyle(st, this.styleReporter(subject));
            if (s.color) add('span', { color: s.color });
            if (s.bold) add('b', {});
            if (s.italic) add('i', {});
            if (s.underline) add('u', {});
            break;
          }
          case 'ul':
          case 'ol':
            this.hold(`a nested list inside ${where}`);
          // falls through (hold throws)
          default:
            this.hold(`<${n.tag}> inside the text of ${where} (inline: b, i, u, an https a and a colour span)`);
        }
        for (const [k] of n.attrs) if (!(n.tag === 'a' && k === 'href') && !(n.tag === 'span' && k === 'style')) this.dropAttr(subject, k, `<${n.tag}>`);
        walk(n.children, next ?? marks);
      }
    };
    walk(nodes, {});
    // collapse: runs of spaces to one (the first keeps its marks), none at the block's ends or beside a <br>
    const out: Ch[] = [];
    for (const c of chars) {
      if ('ch' in c && c.ch === ' ') {
        const prev = out[out.length - 1];
        if (!prev || 'br' in prev || prev.ch === ' ') continue;
      }
      if ('br' in c) {
        const prev = out[out.length - 1];
        if (prev && 'ch' in prev && prev.ch === ' ') out.pop();
      }
      out.push(c);
    }
    while (out.length && 'ch' in out[out.length - 1]! && (out[out.length - 1] as { ch: string }).ch === ' ') out.pop();
    const inline: Inline[] = [];
    for (const c of out) {
      if ('br' in c) {
        inline.push({ br: true });
        continue;
      }
      this.textChars++;
      const last = inline[inline.length - 1];
      if (last && 'text' in last && sameMarks(last.marks, c.marks)) last.text += c.ch;
      else inline.push({ text: c.ch, marks: canonMarks(c.marks) });
    }
    this.markCount += inline.filter((r) => 'text' in r && Object.keys(r.marks).length).length;
    return { type, inline };
  }

  private enumAttr(target: Attrs, name: string, value: string, subject: Subject) {
    const v = value.trim().toLowerCase();
    const allowed = ENUMS[name]!;
    const ok = name === 'name' ? allowed.find((a) => a.toLowerCase() === v) : allowed.includes(v) ? v : undefined;
    if (ok === undefined) {
      this.warn(subject, `${name}="${value}" is not one of ${allowed.join(', ')}; dropped`, name);
      return;
    }
    if (ok !== value) this.note(subject, `${name}="${value}" normalized to "${ok}"`, name);
    target[name] = ok;
  }

  private dropAttr(subject: Subject, name: string, on?: string) {
    const where = on ? ` on ${on}` : '';
    if (name === 'class' || name.startsWith('data-')) this.note(subject, `${name}${where} ignored`, name);
    else this.warn(subject, `${name}${where} is not in the dialect; dropped`, name);
  }

  /**
   * D4: an element written without an id takes the id the writer's base held at its place, when that id is used
   * nowhere else in this file; else `e<n>-<hash4(slide, parent path, index, tag)>`, n counting the id-less elements in
   * document order and bumped past every id in this file and in `taken`. Parents mint before their children.
   */
  private mintIds() {
    const taken = new Set([...this.ids, ...(this.opts.taken ?? [])]);
    let n = 0;
    for (const { el, parent, index } of this.needsId) {
      const parentPath = this.pathOf(parent);
      const candidate = this.opts.mint?.(parentPath, index, el.tag);
      n++;
      if (candidate !== undefined && ID_RE.test(candidate) && !this.ids.has(candidate)) {
        el.id = candidate;
      } else {
        const h = hash4(`${this.sectionId}\u0000${parentPath}\u0000${index}\u0000${el.tag}`);
        let id = `e${n}-${h}`;
        while (taken.has(id)) id = `e${++n}-${h}`;
        el.id = id;
      }
      taken.add(el.id);
      this.ids.add(el.id);
    }
  }

  private pathOf(parent: ElementIR | null): string {
    const ids: string[] = [];
    for (let p = parent; p !== null; p = this.parents.get(p) ?? null) ids.unshift(p.id);
    return [this.sectionId, ...ids].join('/');
  }
}

function describe(parent: ParentSite): string {
  return parent.el?.id ? `<${parent.tag} id="${parent.el.id}">` : `<${parent.tag}>`;
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function canonMarks(m: Marks): Marks {
  const out: Marks = {};
  for (const k of MARK_ORDER) if (m[k]) (out as Record<string, unknown>)[k] = m[k];
  return out;
}
export function sameMarks(a: Marks, b: Marks): boolean {
  return JSON.stringify(canonMarks(a)) === JSON.stringify(canonMarks(b));
}

function textContent(n: RawNode): string {
  if (n.kind === 'text') return n.value;
  if (n.kind === 'comment') return '';
  return n.children.map(textContent).join('');
}
