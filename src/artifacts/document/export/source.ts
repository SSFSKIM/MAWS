// What a document export reads (D12 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): a document's state (the
// live doc or a version's) as plain values: its tabs in order with their bodies as ProseMirror docs of the one schema,
// its threads (DOCX writes them as Word comments) and its token overrides (`meta.dsOverrides`). The exporters are pure
// functions of this, so M8's registrations in A's export service, the editor's Export menu and `artifact_export` all
// call them the same way, from main or the renderer.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Actor } from '@shared/artifacts/actor';
import { actorDisplay } from '@shared/artifacts/actor';
import type { Doc } from '../../yjs';
import { ynodeToPmnode } from '../../yjs/prosemirror';
import { dsOverrides, type TokenOverrides } from '../meta';
import { schemaFor } from '../schema';
import { listTabs, tabBody } from '../tabs';
import { listThreads, type Thread } from '../threads';
import type { DesignSystemExport, LocalTokens, PageSize } from './design-system';

export interface ExportTab {
  id: string;
  title: string;
  body: PMNode;
}

export interface ExportSource {
  title: string;
  tabs: ExportTab[];
  threads: Thread[];
  overrides: TokenOverrides;
}

/** A document's state as an export reads it. */
export function exportSource(doc: Doc, title: string): ExportSource {
  const schema = schemaFor();
  const tabs = listTabs(doc).flatMap(({ id, title: tabTitle }) => {
    const body = tabBody(doc, id);
    return body ? [{ id, title: tabTitle, body: ynodeToPmnode(body, schema) }] : [];
  });
  return { title, tabs, threads: listThreads(doc), overrides: dsOverrides(doc) };
}

/** An image the export embeds: its bytes and MIME type, or null when it cannot be had (shown by its alt text); a rejection fails the export. */
export type ImageLoader = (image: { src: string; assetId: string | null }) => Promise<{ bytes: Uint8Array; mime: string } | null>;

/** What every exporter takes. */
export interface ExportOptions<T = LocalTokens> {
  /** One tab by id; all tabs in order when absent (each introduced by its title when there are several). */
  tab?: string;
  /** The governing system's export helpers (X28); the house system when absent. */
  system?: DesignSystemExport<T>;
  /** Letter or A4 (Decision Log 43); the system's page size, else Letter, when absent. */
  pageSize?: PageSize;
  // P3-E start (E2 M5; E's Decision Logs 15, 24 and 32): a kind's drawing of a `chart` block, prepared before the export
  // runs (synchronous, as `ImageLoader`'s work is preloaded); undefined keeps the labelled placeholder
  renderView?: ViewRenderer;
  /** CSS appended to the HTML page's own (through the system's resolver, as the theme is), when given. */
  viewCss?: string;
  // P3-E end
}

// P3-E start (E2 M5; E's Decision Log 32): what a chart block exports as. A chart is its SVG (with its size in CSS px and,
// for Word, a PNG of it as the fallback picture); a table is a native table, its HTML and the same cells as text (one
// formatter writes both, so nothing reads generated HTML back). Both carry the caption, the source label, the warnings
// shown under the label (E's Decision Log 35; a table's preview and overflow notes stay in `table.notes`), and the view
// as GFM for a Markdown export.
export interface ExportViewTable {
  columns: { name: string; numeric: boolean }[];
  rows: string[][];
  notes: string[];
}
interface ExportViewCommon {
  caption: string;
  sourceLabel: string;
  /** What the view could not show as asked, and its dataset's validation notes: under the label. */
  warnings?: readonly string[];
  /** The view as Markdown: caption, the bounded preview as GFM, its notes and the label. */
  markdown: string;
}
export type ExportView = ExportViewCommon & ({ svg: string; width: number; height: number; png?: Uint8Array; html?: never; table?: never } | { html: string; table: ExportViewTable; svg?: never; width?: never; height?: never; png?: never });
export type ViewRenderer = (node: PMNode) => ExportView | undefined;
// P3-E end

/** The tabs an export writes: the one named, else every tab. */
export function tabsOf(source: ExportSource, tab: string | undefined): ExportTab[] {
  if (tab === undefined) return source.tabs;
  const found = source.tabs.find(({ id }) => id === tab);
  if (!found) throw new Error(`The document has no tab ${tab}`);
  return [found];
}

/** A session by its title (main's index), else "Claude"; the human by the export's resolved identity, else neutral. */
export const exportAuthorName =
  (sessionTitle?: (appSessionId: string) => string | undefined, humanName = 'Comment author') =>
  (actor: Actor): string =>
    actor.kind === 'human' ? humanName : actorDisplay(actor, sessionTitle?.(actor.appSessionId)).name;
/** Author names without an identity provider: every session "Claude", the human "Comment author". */
export const defaultAuthorName = exportAuthorName();
