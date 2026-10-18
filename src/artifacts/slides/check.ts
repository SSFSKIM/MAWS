// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D10 "Check against the design system"; M6; X27's
// `unitsOfDeck`): the deck as P3-D's check units, so `checkHardDonts` runs the governing system's tagged hard don'ts over
// the slides as it runs them over the system's own canon. One unit per slide in deck order (its speaker notes are not
// on it); each element is read from the model as the slide file has it: its attributes, its declarations, its own text
// and its children, an inline colour mark among them as a `span` with its colour and its words (fix wave 1). An svg's
// markup is read too (a gradient drawn inside it is a gradient); an x-embed's page is its own (Claude's build does not
// read it either). Locators are selectors a reader can follow, each element by its id:
// `section#<slide> > div#card > p#title`, a cell by its row and place; `elementOfLocator` answers the element the
// editor selects for one. Portable (§4.10).
import type { CanonElement, CheckUnit } from '../design-system/canon';
import { checkHardDonts, type CheckReport } from '../design-system/check';
import { parseDeclarations } from '../design-system/css-read';
import { parseLaw, type HardDont } from '../design-system/law';
import type { TokenSet } from '../design-system/tokens';
import type { Doc } from '../yjs';
import { parseHtml, type RawNode } from './html';
import { CELL_TAGS, type ElementIR, type TextBlock } from './ir';
import { readSlide, slideOrder } from './model';

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * A text element's words and its inline colour marks (fix wave 1): the text outside the marks is the element's own; each
 * run in a `<span style="color">` is a `span` child with its colour and its own words, located under the element (so a
 * violation selects the element), each word counted once.
 */
function textAndMarks(blocks: readonly TextBlock[] | undefined, at: string): { text: string; spans: CanonElement[] } {
  const own: string[] = [];
  const spans: CanonElement[] = [];
  for (const block of blocks ?? []) {
    for (const item of block.inline) {
      if (!('text' in item)) own.push(' ');
      else if (item.marks.span?.color !== undefined) {
        own.push(' ');
        const here = `${at} > span:nth-of-type(${spans.length + 1})`;
        spans.push({ tag: 'span', attrs: {}, style: [{ property: 'color', value: item.marks.span.color }], text: squash(item.text), children: [], at: here });
      } else own.push(item.text);
    }
    own.push(' ');
  }
  return { text: squash(own.join('')), spans };
}

const declarationsOf = (style: Readonly<Record<string, string>>) => Object.entries(style).map(([property, value]) => ({ property, value }));

/** An svg's own markup as elements (its attributes and inline style), each by its id where it has one. */
function rawElements(nodes: readonly RawNode[], at: string): CanonElement[] {
  const out: CanonElement[] = [];
  for (const node of nodes) {
    if (node.kind !== 'element') continue;
    const attrs: Record<string, string> = {};
    let style: CanonElement['style'] = [];
    for (const [name, value] of node.attrs) {
      if (name.toLowerCase() === 'style') style = parseDeclarations(value);
      else attrs[name] = value;
    }
    const id = attrs.id;
    const here = `${at} > ${id && /^[A-Za-z_][\w-]*$/.test(id) ? `${node.tag}#${id}` : `${node.tag}:nth-child(${out.length + 1})`}`;
    const text = squash(node.children.flatMap((c) => (c.kind === 'text' ? [c.value] : [])).join(''));
    out.push({ tag: node.tag, attrs, style, text, children: rawElements(node.children, here), at: here });
  }
  return out;
}

function elementOf(e: ElementIR, at: string, nth: number): CanonElement {
  const here = `${at} > ${CELL_TAGS.has(e.tag) ? `${e.tag}:nth-child(${nth})` : `${e.tag}#${e.id}`}`;
  const { text, spans } = textAndMarks(e.text, here);
  const children = e.tag === 'svg' ? rawElements(parseHtml(e.raw ?? ''), here) : [...spans, ...e.children.map((c, i) => elementOf(c, here, i + 1))];
  return { tag: e.tag, attrs: CELL_TAGS.has(e.tag) ? e.attrs : { id: e.id, ...e.attrs }, style: declarationsOf(e.style), text, children, at: here };
}

/** The deck's slides as check units, in deck order. */
export function unitsOfDeck(doc: Doc): CheckUnit[] {
  return slideOrder(doc).map((slideId) => {
    const slide = readSlide(doc, slideId);
    const at = `section#${slideId}`;
    const section: CanonElement = { tag: 'section', attrs: { id: slideId, ...slide.attrs }, style: declarationsOf(slide.style), text: '', children: slide.children.map((c, i) => elementOf(c, at, i + 1)), at };
    return { name: slideId, kind: 'slide', elements: [section] };
  });
}

export interface DeckCheck {
  /** The law's hard don'ts (the words a violation's `dont` index names). */
  donts: HardDont[];
  report: CheckReport;
}

/** The governing system's hard don'ts over the deck (D's `checkHardDonts` on `unitsOfDeck`). */
export function checkDeck(doc: Doc, law: string, tokens: TokenSet): DeckCheck {
  const parsed = parseLaw(law);
  return { donts: parsed.donts, report: checkHardDonts(parsed, tokens, unitsOfDeck(doc)) };
}

/**
 * The element a violation's locator selects in the editor: the deepest slide element named on it. A cell selects its
 * table (cells and rows are not selected on their own), anything inside an svg the svg; the section itself, nothing.
 */
export function elementOfLocator(at: string): string | null {
  let found: string | null = null;
  let table: string | null = null;
  for (const segment of at.split(' > ').slice(1)) {
    const m = /^([a-z][a-z0-9-]*)(?:#([A-Za-z0-9_-]+))?/.exec(segment);
    if (!m) break;
    const [, tag, id] = m;
    if (tag === 'tr' || CELL_TAGS.has(tag as never)) return table ?? found;
    if (!id) break;
    found = id;
    table = tag === 'table' ? id : null;
    if (tag === 'svg') break;
  }
  return found;
}
