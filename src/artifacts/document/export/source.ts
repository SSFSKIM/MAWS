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

/** An image the export embeds: its bytes and MIME type, or null when it cannot be had. */
export type ImageLoader = (image: { src: string; assetId: string | null }) => Promise<{ bytes: Uint8Array; mime: string } | null>;

/** What every exporter takes. */
export interface ExportOptions<T = LocalTokens> {
  /** One tab by id; all tabs in order when absent (each introduced by its title when there are several). */
  tab?: string;
  /** The governing system's export helpers (X28); the house system when absent. */
  system?: DesignSystemExport<T>;
  /** Letter or A4 (Decision Log 43); the system's page size, else Letter, when absent. */
  pageSize?: PageSize;
}

/** The tabs an export writes: the one named, else every tab. */
export function tabsOf(source: ExportSource, tab: string | undefined): ExportTab[] {
  if (tab === undefined) return source.tabs;
  const found = source.tabs.find(({ id }) => id === tab);
  if (!found) throw new Error(`The document has no tab ${tab}`);
  return [found];
}

/** How an export names an author: the session's title or "Claude", the human as "Owner" (never "You" in a file). */
export const defaultAuthorName = (actor: Actor): string => (actor.kind === 'human' ? 'Owner' : actorDisplay(actor).name);
