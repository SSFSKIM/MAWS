// The search mirror's body (P4-B4: docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md, "Sections"; Decision Log
// 4): an artifact's searchable text built in sections, each with the place `artifact_read` opens it at, so the host's
// `artifact_search` answers a hit's `read` by a binary search over offsets, never by loading the document again.
// Portable (§4.10), as `./text.ts` is: the engine host runs it today.
//
// - A document: its tabs in display order, each tab's title (the place `{tab}`), then one line per top-level block,
//   its nested text included (`{tab, from: blockId}`; `{tab}` for a block without an id); then the rest of the
//   document's text with no place: the comment threads' messages, then every other root through the extractor's walk.
//   A line's whitespace is collapsed, so a quoted phrase matches across a block's formatting and line breaks.
// - A deck, a design or a design system: its files in the order given (the order `artifact_read` answers them), an
//   `.html` file's text without markup (a slide's notes, which its `<aside>` holds, included), a `.json` manifest
//   skipped, any other file's text as it is (`{paths: [path]}`).
// - A dashboard, an html page and a file: the library's extractor's text (no place).
//
// Every body is NFC and capped at MIRROR_TEXT_MAX_BYTES of UTF-8 (Decision Log 16: the extractor's 256 KiB, main's
// library's cap, left all but the first third of a 200-page document unsearchable); a section that would start past the
// cap is dropped. Offsets count UTF-16 code units of the body, as JavaScript indexes it.
import { listTabs, tabBody, TABS } from '@artifacts/document/tabs';
import { listThreads, THREADS } from '@artifacts/document/threads';
import type { Doc, Node } from '@artifacts/yjs';
import { capped, extractText, htmlText, walkText, type TextSource } from './text';

export const MIRROR_TEXT_MAX_BYTES = 2 * 1024 * 1024;

// Where a section opens: a document's tab and the top-level block to read from, or a file model's file. The shape of
// `artifact_search`'s `read` (X33).
export type SectionPlace = { tab: string; from?: string } | { paths: string[] };
export type Section = [offset: number, place: SectionPlace | null];

export interface SectionedText {
  body: string;
  sections: Section[]; // ascending offsets, each where its section's first line starts
}

export const FILE_MODEL_KINDS = ['presentation', 'design', 'design_system'] as const;
export type FileModelKind = (typeof FILE_MODEL_KINDS)[number];

export type SectionSource =
  | { kind: 'document'; doc: Doc }
  | { kind: FileModelKind; files: Record<string, string> } // in `artifact_read`'s order
  | { kind: 'dashboard'; doc: Doc }
  | Exclude<TextSource, { doc: Doc }>; // an html page's bytes, a file's name and bytes

export function sectionText(source: SectionSource): SectionedText {
  switch (source.kind) {
    case 'document':
      return documentSections(source.doc);
    case 'presentation':
    case 'design':
    case 'design_system':
      return fileSections(source.files);
    default: {
      const body = extractText(source, MIRROR_TEXT_MAX_BYTES).normalize('NFC');
      return body === '' ? { body, sections: [] } : { body: capped(body, MIRROR_TEXT_MAX_BYTES), sections: [[0, null]] };
    }
  }
}

// The place of the section holding `offset`, null when it has none (or the offset is before every section).
export function placeAt({ sections }: SectionedText, offset: number): SectionPlace | null {
  let low = 0;
  let high = sections.length - 1;
  let found: SectionPlace | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (sections[mid]![0] <= offset) {
      found = sections[mid]![1];
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

// Lines joined by '\n', each starting a section; the walk stops once the body has passed the cap in characters (each at
// least one byte), and the result is trimmed to the cap in bytes.
class Builder {
  private readonly parts: string[] = [];
  private readonly sections: Section[] = [];
  private length = 0;

  get full(): boolean {
    return this.length > MIRROR_TEXT_MAX_BYTES;
  }

  add(text: string, place: SectionPlace | null): void {
    const line = text.normalize('NFC');
    if (this.full || line.trim() === '') return;
    if (this.parts.length > 0) {
      this.parts.push('\n');
      this.length += 1;
    }
    this.sections.push([this.length, place]);
    this.parts.push(line);
    this.length += line.length;
  }

  done(): SectionedText {
    const body = capped(this.parts.join(''), MIRROR_TEXT_MAX_BYTES);
    return { body, sections: this.sections.filter(([offset]) => offset < body.length) };
  }
}

const collapsed = (text: string): string => text.replace(/\s+/gu, ' ').trim();

// A node's whole text on one line: its runs and nested nodes' texts, joined by a space.
function lineOf(node: Node, builder: Builder): string {
  const pieces: string[] = [];
  walkText(node, (text) => void (text !== '' && pieces.push(text)), () => !builder.full);
  return collapsed(pieces.join(' '));
}

const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null && typeof (value as Node).toArray === 'function' && typeof (value as Node).attrEntries === 'function';

function documentSections(doc: Doc): SectionedText {
  const builder = new Builder();
  for (const { id: tab, title } of listTabs(doc)) {
    builder.add(collapsed(title), { tab });
    for (const block of tabBody(doc, tab)?.toArray() ?? []) {
      if (builder.full) break;
      if (!isNode(block)) continue;
      const id: unknown = block.getAttr('id');
      builder.add(lineOf(block, builder), typeof id === 'string' ? { tab, from: id } : { tab });
    }
  }
  // the rest: the comment threads' messages (stored as values, which the extractor's walk does not read as text), then
  // every other root by name, as the extractor walks them
  for (const thread of listThreads(doc)) for (const message of thread.messages) if (typeof message.body === 'string') builder.add(collapsed(message.body), null);
  const roots = [...(doc.share.entries() as Iterable<[string, unknown]>)].filter(([name]) => name !== TABS && name !== THREADS).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [, root] of roots) if (isNode(root)) walkText(root, (text) => builder.add(text, null), () => !builder.full);
  return builder.done();
}

function fileSections(files: Record<string, string>): SectionedText {
  const builder = new Builder();
  for (const [path, text] of Object.entries(files)) {
    if (builder.full) break;
    const lower = path.toLowerCase();
    if (lower.endsWith('.json')) continue;
    builder.add(lower.endsWith('.html') || lower.endsWith('.htm') ? htmlText(text) : text, { paths: [path] });
  }
  return builder.done();
}
