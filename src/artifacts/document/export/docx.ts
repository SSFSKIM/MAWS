// The DOCX export (D12 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): a Word file through the `docx`
// package, styled by the governing design system (X28): its fonts and colours as the Word theme
// (`word/theme/theme1.xml` from `officeThemeXml`, so Word's "(Headings)" and "(Body)" faces and its palette are the
// system's), its type scale and colours on Word's own styles (Heading 1 to 3, Title, Hyperlink) and on this kind's
// (`Code`, `Quote`, `Callout Note|Tip|Warn|Danger`, `Placeholder`), and its page size (Letter unless A4 is chosen or the
// system's page tokens say otherwise, Decision Log 43). Headings are Word headings, lists Word numbering (bullets,
// numbers from the list's start and style, task boxes as ☐ and ☒), tables Word tables with header rows, spans and
// widths, links hyperlinks, pictures embedded through the caller's loader, and every thread whose passage is in the
// file a Word comment on that passage with its messages as replies, resolved threads marked done. What Word has no
// form for is written as text: math as its LaTeX, a diagram as its mermaid source under a label, a chart and a pending
// block as their labelled placeholders, chips as what they show. Tracked changes since a version are deferred (H3).
// Pure: `docx` bundles its own zip and needs no Node built-in, so this runs in main or the renderer.
import {
  AlignmentType,
  BorderStyle,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ICommentOptions,
  type ILevelsOptions,
  type IParagraphOptions,
  type IParagraphStyleOptions,
  type IRunOptions,
  type ParagraphChild,
} from 'docx';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import type { Actor } from '@shared/artifacts/actor';
import { CALLOUT_TONES } from '../schema';
import { dsValue, exportDesign, hexOf, houseSystem, officeFace, pageOf, twipsOf, type DsName, type ExportDesign } from './design-system';
import { imageSize } from './image-size';
import { defaultAuthorName, tabsOf, type ExportOptions, type ExportSource, type ImageLoader } from './source';

export interface DocxExportOptions<T> extends ExportOptions<T> {
  /** Reads a picture's bytes; a picture it cannot read is written as its alt text. */
  loadImage?: ImageLoader;
  /** A comment's author as Word shows it; the session's title or "Claude", and "Owner" for the human, by default. */
  authorName?: (actor: Actor) => string;
}

const CALLOUT_STYLE = (tone: string) => `Callout${tone[0].toUpperCase()}${tone.slice(1)}`;
const TONE_COLOR: Record<string, DsName> = { note: '--ds-color-status-info', tip: '--ds-color-status-ok', warn: '--ds-color-status-warn', danger: '--ds-color-status-error' };
const BULLETS = ['•', '◦', '▪'];
const ORDERED: Record<string, (typeof LevelFormat)[keyof typeof LevelFormat]> = {
  '1': LevelFormat.DECIMAL,
  a: LevelFormat.LOWER_LETTER,
  A: LevelFormat.UPPER_LETTER,
  i: LevelFormat.LOWER_ROMAN,
  I: LevelFormat.UPPER_ROMAN,
};
const INDENT = 720; // twips per list level
const IMAGE_TYPES: Record<string, 'png' | 'jpg' | 'gif' | 'bmp'> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp' };

// Dates in the owner's United States frame, read as calendar days (the editor's chip).
const DATE = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
function formatDate(iso: unknown): string {
  const text = typeof iso === 'string' ? iso : '';
  const at = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00Z`) : NaN;
  return Number.isNaN(at) ? text : DATE.format(at);
}

interface LoadedImage {
  type: 'png' | 'jpg' | 'gif' | 'bmp';
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** Where a block sits: the paragraph style its paragraphs take, the list level, a table cell's alignment and weight. */
interface Place {
  style?: string;
  indent?: number;
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
  strong?: boolean;
  level: number;
}

class Writer {
  private inline = 0;
  private lists = 0;
  readonly numbering = new Map<string, { reference: string; levels: ILevelsOptions[] }>();
  readonly starts = new Map<number, number[]>();
  readonly ends = new Map<number, number[]>();

  constructor(
    private readonly design: ExportDesign,
    private readonly images: Map<string, LoadedImage | null>,
    private readonly textWidth: number,
  ) {}

  private value = (name: DsName) => dsValue(this.design, name);
  private color = (name: DsName) => hexOf(this.value(name)) ?? undefined;

  // ── inline ──
  private next(): number {
    return this.inline++;
  }
  private withComments(index: number, children: ParagraphChild[]): ParagraphChild[] {
    const starts = (this.starts.get(index) ?? []).map((id) => new CommentRangeStart(id));
    const ends = (this.ends.get(index) ?? []).flatMap((id) => [new CommentRangeEnd(id), new TextRun({ children: [new CommentReference(id)] })]);
    return [...starts, ...children, ...ends];
  }

  private format(marks: readonly Mark[], place: Place): IRunOptions {
    const run: Record<string, unknown> = {};
    if (place.strong) run.bold = true;
    for (const mark of marks) {
      switch (mark.type.name) {
        case 'bold':
          run.bold = true;
          break;
        case 'italic':
          run.italics = true;
          break;
        case 'underline':
          run.underline = {};
          break;
        case 'strike':
          run.strike = true;
          break;
        case 'code':
          run.font = officeFace(this.value('--ds-font-mono'));
          run.shading = { type: ShadingType.CLEAR, fill: this.color('--ds-color-bg-raised') ?? 'auto', color: 'auto' };
          break;
        case 'highlight': {
          const fill = hexOf(typeof mark.attrs.color === 'string' ? mark.attrs.color : null);
          if (fill) run.shading = { type: ShadingType.CLEAR, fill, color: 'auto' };
          else run.highlight = 'yellow';
          break;
        }
        case 'link':
          run.style = 'Hyperlink';
          break;
      }
    }
    return run as IRunOptions;
  }

  private text(text: string, marks: readonly Mark[], place: Place): ParagraphChild {
    const run = new TextRun({ text, ...this.format(marks, place) });
    const link = marks.find((mark) => mark.type.name === 'link');
    const href = typeof link?.attrs.href === 'string' ? link.attrs.href : '';
    return href ? new ExternalHyperlink({ link: href, children: [run] }) : run;
  }

  private inlineNode(node: PMNode, place: Place): ParagraphChild[] {
    const index = this.next();
    const plain = (text: string, extra: IRunOptions = {}) => [new TextRun({ text, ...this.format(node.marks, place), ...extra })];
    let children: ParagraphChild[];
    switch (node.type.name) {
      case 'text':
        children = [this.text(node.text ?? '', node.marks, place)];
        break;
      case 'hardBreak':
        children = [new TextRun({ break: 1 })];
        break;
      case 'image':
        children = this.image(node, place);
        break;
      case 'math':
        children = plain(String(node.attrs.latex ?? ''), { font: 'Cambria Math', italics: true });
        break;
      case 'date':
        children = plain(formatDate(node.attrs.iso));
        break;
      case 'mention':
        children = plain(String(node.attrs.label ?? ''));
        break;
      case 'dropdown':
        children = plain(String(node.attrs.value ?? ''));
        break;
      default:
        children = plain(node.textContent);
    }
    return this.withComments(index, children);
  }

  private image(node: PMNode, place: Place): ParagraphChild[] {
    const loaded = this.images.get(imageKey(node));
    const alt = String(node.attrs.alt ?? '');
    if (!loaded) return [new TextRun({ text: alt ? `[Image: ${alt}]` : '[Image]', ...this.format(node.marks, place), italics: true })];
    const maxWidth = this.textWidth / 15; // px at 96 to the inch
    const scale = Math.min(1, maxWidth / loaded.width);
    return [
      new ImageRun({
        type: loaded.type,
        data: loaded.bytes,
        transformation: { width: Math.round(loaded.width * scale), height: Math.round(loaded.height * scale) },
        altText: { name: alt || 'Image', description: alt, title: alt },
      }),
    ];
  }

  private runs(node: PMNode, place: Place): ParagraphChild[] {
    const out: ParagraphChild[] = [];
    node.forEach((child) => out.push(...this.inlineNode(child, place)));
    return out;
  }

  // ── blocks ──
  private paragraph(children: ParagraphChild[], place: Place, extra: IParagraphOptions = {}): Paragraph {
    return new Paragraph({
      children,
      ...(place.style ? { style: place.style } : {}),
      ...(place.indent ? { indent: { left: place.indent } } : {}),
      ...(place.alignment ? { alignment: place.alignment } : {}),
      ...extra,
    });
  }

  private code(node: PMNode, place: Place): Paragraph[] {
    const lines: ParagraphChild[][] = [[]];
    node.forEach((child) => {
      const index = this.next();
      const pieces = (child.text ?? '').split('\n');
      pieces.forEach((piece, i) => {
        if (i > 0) lines.push([]);
        const line = lines[lines.length - 1];
        if (i === 0) line.push(...(this.starts.get(index) ?? []).map((id) => new CommentRangeStart(id)));
        if (piece) line.push(new TextRun({ text: piece }));
        if (i === pieces.length - 1) line.push(...(this.ends.get(index) ?? []).flatMap((id) => [new CommentRangeEnd(id), new TextRun({ children: [new CommentReference(id)] })]));
      });
    });
    return lines.map((line) => this.paragraph(line, { ...place, style: 'Code' }));
  }

  private list(node: PMNode, place: Place): Array<Paragraph | Table> {
    const ordered = node.type.name === 'orderedList';
    const task = node.type.name === 'taskList';
    const instance = ++this.lists;
    const out: Array<Paragraph | Table> = [];
    node.forEach((item) => {
      const reference = task
        ? this.reference(item.attrs.checked ? 'task-done' : 'task-open', LevelFormat.BULLET, () => (item.attrs.checked ? '☒' : '☐'), 1)
        : ordered
          ? this.orderedReference(String(node.attrs.type ?? '1'), Number(node.attrs.start ?? 1))
          : this.reference('bullet', LevelFormat.BULLET, (level) => BULLETS[level % BULLETS.length], 1);
      let first = true;
      item.forEach((child) => {
        if (first && child.isTextblock) {
          out.push(this.paragraph(this.runs(child, place), { ...place, indent: undefined }, { numbering: { reference, level: place.level, instance } }));
        } else {
          out.push(...this.block(child, { ...place, indent: INDENT * (place.level + 1), level: place.level + 1 }));
        }
        first = false;
      });
    });
    return out;
  }

  private orderedReference(type: string, start: number): string {
    const format = ORDERED[type] ?? LevelFormat.DECIMAL;
    return this.reference(`ordered-${type}-${start}`, format, (level) => `%${level + 1}.`, start);
  }

  private reference(key: string, format: ILevelsOptions['format'], text: (level: number) => string, start: number): string {
    if (!this.numbering.has(key)) {
      const levels = Array.from({ length: 9 }, (_, level) => ({
        level,
        format,
        text: text(level),
        start,
        alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: INDENT * (level + 1), hanging: 360 } } },
      }));
      this.numbering.set(key, { reference: key, levels });
    }
    return key;
  }

  private table(node: PMNode, place: Place): Table {
    // the grid: the widest row's columns, widths from the cells' `colwidth` where every column has one
    const widths: Array<number | null> = [];
    let columns = 0;
    node.forEach((row) => {
      let column = 0;
      row.forEach((cell) => {
        const span = Number(cell.attrs.colspan ?? 1);
        const given = cell.attrs.colwidth as number[] | null;
        for (let i = 0; i < span; i++) if (given?.[i]) widths[column + i] ??= given[i] * 15;
        column += span;
      });
      columns = Math.max(columns, column);
    });
    const available = this.textWidth - INDENT * place.level;
    const known = widths.length === columns && widths.every((width) => width != null);
    const grid = known ? (widths as number[]) : Array.from({ length: columns }, () => Math.floor(available / Math.max(1, columns)));
    const rows: TableRow[] = [];
    let index = 0;
    node.forEach((row) => {
      const header = row.childCount > 0 && [...Array(row.childCount).keys()].every((i) => row.child(i).type.name === 'tableHeader');
      const cells: TableCell[] = [];
      let column = 0;
      row.forEach((cell) => {
        const span = Number(cell.attrs.colspan ?? 1);
        const width = grid.slice(column, column + span).reduce((a, b) => a + b, 0);
        column += span;
        const isHeader = cell.type.name === 'tableHeader';
        const align = cell.attrs.align as string | null;
        const cellPlace: Place = {
          level: 0,
          strong: isHeader,
          alignment: align === 'center' ? AlignmentType.CENTER : align === 'right' ? AlignmentType.RIGHT : undefined,
        };
        const children: Array<Paragraph | Table> = [];
        cell.forEach((block) => children.push(...this.block(block, cellPlace)));
        cells.push(
          new TableCell({
            children: children.length ? children : [new Paragraph({})],
            width: { size: width, type: WidthType.DXA },
            ...(span > 1 ? { columnSpan: span } : {}),
            ...(Number(cell.attrs.rowspan ?? 1) > 1 ? { rowSpan: Number(cell.attrs.rowspan) } : {}),
            ...(isHeader ? { shading: { type: ShadingType.CLEAR, fill: this.color('--ds-color-bg-raised') ?? 'auto', color: 'auto' } } : {}),
          }),
        );
      });
      rows.push(new TableRow({ children: cells, ...(header && index === 0 ? { tableHeader: true } : {}) }));
      index++;
    });
    const border = { style: BorderStyle.SINGLE, size: 4, color: this.color('--ds-color-border') ?? 'auto' };
    return new Table({
      rows,
      columnWidths: grid,
      width: { size: grid.reduce((a, b) => a + b, 0), type: WidthType.DXA },
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
      ...(place.level ? { indent: { size: INDENT * place.level, type: WidthType.DXA } } : {}),
    });
  }

  private placeholder(label: string, text: string, place: Place): Paragraph {
    return this.paragraph([new TextRun({ text: `${label}: `, bold: true }), new TextRun({ text })], { ...place, style: 'Placeholder' });
  }

  block(node: PMNode, place: Place): Array<Paragraph | Table> {
    const a = node.attrs;
    switch (node.type.name) {
      case 'paragraph':
        return [this.paragraph(this.runs(node, place), place)];
      case 'heading': {
        const heading = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][Number(a.level) - 1] ?? HeadingLevel.HEADING_3;
        return [this.paragraph(this.runs(node, place), { ...place, style: undefined }, { heading })];
      }
      case 'blockquote':
        return this.children(node, { ...place, style: 'Quote' });
      case 'callout':
        return this.children(node, { ...place, style: CALLOUT_STYLE(String(a.tone ?? 'note')) });
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        return this.list(node, place);
      case 'codeBlock':
        return this.code(node, place);
      case 'horizontalRule':
        return [this.paragraph([], { ...place, style: undefined }, { border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: this.color('--ds-color-border') ?? 'auto', space: 1 } } })];
      case 'table':
        return [this.table(node, place)];
      case 'mathBlock':
        return [this.paragraph([new TextRun({ text: String(a.latex ?? ''), font: 'Cambria Math', italics: true })], { ...place, alignment: AlignmentType.CENTER })];
      case 'diagram':
        return [
          this.paragraph([new TextRun({ text: 'Diagram', bold: true })], { ...place, style: 'Placeholder' }),
          ...String(a.source ?? '')
            .split('\n')
            .map((line) => this.paragraph(line ? [new TextRun({ text: line })] : [], { ...place, style: 'Code' })),
        ];
      case 'chart':
        return [this.placeholder('Chart', String(a.source ?? ''), place)];
      case 'pending':
        return [this.placeholder('Pending', String(a.intent ?? ''), place)];
      default:
        return node.isTextblock ? [this.paragraph(this.runs(node, place), place)] : this.children(node, place);
    }
  }

  private children(node: PMNode, place: Place): Array<Paragraph | Table> {
    const out: Array<Paragraph | Table> = [];
    node.forEach((child) => out.push(...this.block(child, place)));
    return out;
  }
}

const imageKey = (node: PMNode) => `${(node.attrs.assetId as string | null) ?? ''}\u0000${String(node.attrs.src ?? '')}`;

async function loadImages(bodies: PMNode[], loadImage: ImageLoader | undefined): Promise<Map<string, LoadedImage | null>> {
  const images = new Map<string, LoadedImage | null>();
  const pending: Array<Promise<void>> = [];
  for (const body of bodies)
    body.descendants((node) => {
      if (node.type.name !== 'image') return true;
      const key = imageKey(node);
      if (images.has(key)) return false;
      images.set(key, null);
      if (loadImage)
        pending.push(
          loadImage({ src: String(node.attrs.src ?? ''), assetId: (node.attrs.assetId as string | null) ?? null })
            .then((image) => {
              const type = image && IMAGE_TYPES[image.mime.toLowerCase()];
              const size = image && imageSize(image.bytes);
              if (type && size && size.width > 0 && size.height > 0) images.set(key, { type, bytes: image.bytes, ...size });
            })
            .catch(() => undefined),
        );
      return false;
    });
  await Promise.all(pending);
  return images;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0].toUpperCase())
    .join('');

/** The document (one tab, or every tab under its title, each on a new page) as a Word file. */
export async function exportDocx<T>(source: ExportSource, options: DocxExportOptions<T> = {}): Promise<Uint8Array> {
  const tabs = tabsOf(source, options.tab);
  const design = options.system ? exportDesign(options.system, source.overrides) : exportDesign(houseSystem, source.overrides);
  const value = (name: DsName) => dsValue(design, name);
  const color = (name: DsName) => hexOf(value(name)) ?? undefined;
  const halfPoints = (name: DsName) => {
    const twips = twipsOf(value(name));
    return twips ? Math.round(twips / 10) : undefined;
  };
  const bold = (name: DsName) => Number(value(name) ?? 400) >= 600;
  const page = pageOf(design, options.pageSize);
  const [width, height, margin] = [twipsOf(page.width) ?? 12240, twipsOf(page.height) ?? 15840, twipsOf(page.margin) ?? 1440];
  const images = await loadImages(
    tabs.map(({ body }) => body),
    options.loadImage,
  );
  const writer = new Writer(design, images, width - 2 * margin);

  // each thread's passage: the first and last inline node its mark is on, in the order the writer visits them
  const extents = new Map<string, { first: number; last: number }>();
  let index = 0;
  for (const { body } of tabs)
    body.descendants((node) => {
      if (!node.isInline) return true;
      for (const mark of node.marks) {
        if (mark.type.name !== 'comment') continue;
        const id = String(mark.attrs.threadId);
        const extent = extents.get(id);
        if (extent) extent.last = index;
        else extents.set(id, { first: index, last: index });
      }
      index++;
      return false;
    });
  const name = options.authorName ?? defaultAuthorName;
  const comments: ICommentOptions[] = [];
  for (const thread of source.threads) {
    const extent = extents.get(thread.id);
    if (!extent || thread.messages.length === 0) continue;
    const root = comments.length;
    thread.messages.forEach((message, i) => {
      const id = comments.length;
      const author = name(message.by);
      comments.push({
        id,
        author,
        initials: initials(author),
        date: new Date(message.at),
        children: message.body.split('\n').map((line) => new Paragraph({ children: [new TextRun(line)] })),
        ...(i > 0 ? { parentId: root } : {}),
        ...(thread.status === 'resolved' ? { resolved: true } : {}),
      });
      writer.starts.set(extent.first, [...(writer.starts.get(extent.first) ?? []), id]);
      writer.ends.set(extent.last, [...(writer.ends.get(extent.last) ?? []), id]);
    });
  }

  const sections = tabs.map(({ title, body }) => {
    const children: Array<Paragraph | Table> = [];
    if (tabs.length > 1) children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] }));
    body.forEach((block) => children.push(...writer.block(block, { level: 0 })));
    return {
      properties: { page: { size: { width, height }, margin: { top: margin, right: margin, bottom: margin, left: margin } } },
      children: children.length ? children : [new Paragraph({})],
    };
  });

  const text = color('--ds-color-text');
  const heading = (role: 'h1' | 'h2' | 'h3' | 'title') => ({
    run: { font: { theme: 'headings' as const }, size: halfPoints(`--ds-type-${role}-size`), bold: bold(`--ds-type-${role}-weight`), color: text },
    paragraph: { spacing: { before: role === 'title' ? 0 : (twipsOf(value('--ds-space-5')) ?? 360), after: twipsOf(value('--ds-space-2')) ?? 120 }, keepNext: true },
  });
  const raised = color('--ds-color-bg-raised') ?? 'auto';
  const paragraphStyles: IParagraphStyleOptions[] = [
    {
      id: 'Code',
      name: 'Code',
      basedOn: 'Normal',
      quickFormat: true,
      run: { font: officeFace(value('--ds-font-mono')), size: halfPoints('--ds-type-caption-size') },
      paragraph: { spacing: { before: 0, after: 0, line: 240 }, shading: { type: ShadingType.CLEAR, fill: raised, color: 'auto' } },
    },
    {
      id: 'Quote',
      name: 'Quote',
      basedOn: 'Normal',
      quickFormat: true,
      run: { color: color('--ds-color-text-muted'), size: halfPoints('--ds-type-quote-size') },
      paragraph: { indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: color('--ds-color-border') ?? 'auto', space: 12 } } },
    },
    ...CALLOUT_TONES.map((tone) => ({
      id: CALLOUT_STYLE(tone),
      name: `Callout ${tone[0].toUpperCase()}${tone.slice(1)}`,
      basedOn: 'Normal',
      paragraph: {
        indent: { left: 240, right: 240 },
        shading: { type: ShadingType.CLEAR, fill: raised, color: 'auto' },
        border: { left: { style: BorderStyle.SINGLE, size: 24, color: color(TONE_COLOR[tone]) ?? 'auto', space: 8 } },
      },
    })),
    {
      id: 'Placeholder',
      name: 'Placeholder',
      basedOn: 'Normal',
      run: { color: color('--ds-color-text-muted'), size: halfPoints('--ds-type-caption-size') },
      paragraph: { border: { left: { style: BorderStyle.DASHED, size: 6, color: color('--ds-color-border') ?? 'auto', space: 8 } }, indent: { left: 240 } },
    },
  ];
  const line = Number(value('--ds-type-body-line'));
  const file = new Document({
    title: source.title,
    creator: 'MAWS',
    ...(comments.length ? { comments: { children: comments } } : {}),
    numbering: { config: [...writer.numbering.values()] },
    styles: {
      default: {
        document: {
          run: { font: { theme: 'body' }, size: halfPoints('--ds-type-body-size'), color: text },
          paragraph: { spacing: { after: twipsOf(value('--ds-space-3')) ?? 160, ...(line > 0 && line < 5 ? { line: Math.round(line * 240) } : {}) } },
        },
        title: heading('title'),
        heading1: heading('h1'),
        heading2: heading('h2'),
        heading3: heading('h3'),
        hyperlink: { run: { color: color('--ds-color-accent'), underline: {} } },
      },
      paragraphStyles,
    },
    sections,
  });
  return Packer.pack(file, 'uint8array', false, [{ path: 'word/theme/theme1.xml', data: design.officeThemeXml() }]);
}
