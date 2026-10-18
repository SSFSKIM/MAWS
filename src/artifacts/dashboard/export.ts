// A dashboard's views as B's four exporters write them (P3-E2 M5; parent §2 "Exports", E's Decision Logs 15, 24, 32 and
// 35; ledger X26's exporters' hook): every chart block of the state the export captured, drawn before the export runs
// (B's walkers are synchronous, as its image loading is preloaded) over the descriptor that state names and the
// snapshot that descriptor's ref names, so a replacement landing meanwhile changes nothing in the file. The figure is the
// renderer's own bytes for the theme the governing system and the doc's overrides resolve (the editor's, for the same
// tokens); a table is its native table and the same cells as text; the label is the captured descriptor's, the human
// named as files name them ("Owner"). A view with no dataset or a spec that cannot be read exports its named state, as
// the editor draws it; a bound snapshot that cannot be read fails the whole export, and a held legacy dashboard is
// refused with its files and the way forward. Portable: main supplies the reads, under its export's signal, and Word's
// fallback pictures.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Actor } from '@shared/artifacts/actor';
import type { TokenOverrides } from '../document/meta';
import { dsValue, exportDesign, houseSystem, type DesignSystemExport } from '../document/export/design-system';
import type { ExportView, ExportViewTable, ViewRenderer } from '../document/export/source';
import type { Doc } from '../yjs';
import { datasetIdFromSource, readDataset, snapshotOf, type DatasetDescriptor } from './datasets';
import { legacyDashboardFiles, legacyDashboardReason } from './legacy';
import { captionOf, renderFailure, renderView, svgSize, THEME_PROPERTIES, themeFrom, viewPreview, type Theme, type ViewTable } from './render';
import { parseSpec } from './spec';
import type { SnapshotRef } from './snapshots';
import { DATASET_STATES, mismatchNotes, sourceLabel } from './states';
import { chartSpecs } from './views';

/** The figure's theme as an export resolves it: the governing system's document-medium values with the doc's overrides
 * (the values the editor's scope sets for the same tokens); the house system's without one. */
export function exportTheme(system?: DesignSystemExport<unknown>, overrides: TokenOverrides = {}): Theme {
  const design = exportDesign(system ?? (houseSystem as DesignSystemExport<unknown>), overrides);
  return themeFrom(Object.fromEntries(THEME_PROPERTIES.map((name) => [name, dsValue(design, name) ?? undefined]))).theme;
}

/**
 * The views on an exported page (B's `viewCss`, resolved by the system with B's own theme): the editor's view rules
 * (sheet.css) in the system's `--ds-*` alone, so the file needs no app token; a figure keeps its own size and fits the
 * column, a chart is never split across a printed page, a table breaks between rows and repeats its head.
 */
export const VIEW_CSS = `
.ds-doc .doc-chart.dash-export { display: block; border: 0; padding: 0; color: inherit; margin: var(--ds-space-4) 0; }
.ds-doc .dash-view { display: block; margin: 0; min-width: 0; }
.ds-doc .dash-caption { font-family: var(--ds-font-display); font-size: var(--ds-type-h3-size); line-height: var(--ds-type-h3-line); font-weight: var(--ds-type-h3-weight); color: var(--ds-color-text); margin-bottom: var(--ds-space-2); break-after: avoid; }
.ds-doc .dash-figure > svg { display: block; width: 100%; max-width: 100%; height: auto; }
.ds-doc .dash-figure > table.dash-table { table-layout: auto; margin: 0; }
.ds-doc .dash-table .dash-num { text-align: right; font-variant-numeric: tabular-nums; }
.ds-doc .dash-table td.dash-num { font-family: var(--ds-font-mono); }
.ds-doc .dash-table-note { caption-side: bottom; text-align: left; padding-top: var(--ds-space-2); font-size: var(--ds-type-caption-size); color: var(--ds-color-text-muted); }
.ds-doc .dash-source { display: block; margin-top: var(--ds-space-2); font-size: var(--ds-type-caption-size); line-height: var(--ds-type-caption-line); color: var(--ds-color-text-muted); }
.ds-doc .dash-source-label, .ds-doc .dash-notes { display: block; word-break: keep-all; overflow-wrap: anywhere; }
@media print {
  .ds-doc .dash-view:has(> .dash-figure > svg) { break-inside: avoid; }
  .ds-doc .dash-table thead { display: table-header-group; }
  .ds-doc .dash-table tr { break-inside: avoid; }
}
`;

/** Which view a chart node draws: its dataset (its fence body as `datasetIdFromSource` reads it) and its spec (two blocks
 * naming both draw one view). */
export const viewKey = (node: Pick<PMNode, 'attrs'>): string => JSON.stringify([datasetIdFromSource(node.attrs.source), node.attrs.spec ?? null]);

// ---- Markdown ----

const oneLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
/** Text Markdown reads as text: what would read as markup backslash-escaped (the dialect's `==`, `++` and `$$` too). */
const mdText = (text: string) => text.replace(/[\\`*_[\]<>|~&$#=+]/g, '\\$&');
const mdLine = (text: string) => mdText(oneLine(text)).replace(/^(\d+)([.)])/, '$1\\$2').replace(/^-/, '\\-');
const mdCell = (text: string) => mdText(text.replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');

function gfm(table: ExportViewTable): string {
  const row = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [row(table.columns.map((c) => mdCell(c.name))), row(table.columns.map((c) => (c.numeric ? '---:' : '---'))), ...table.rows.map((cells) => row(cells.map(mdCell)))].join('\n');
}

// ---- one view ----

export interface ViewInput {
  spec: unknown;
  /** The dataset the block names (its fence body, trimmed). */
  datasetId: string;
  /** The captured state's descriptor of it, or null when none is bound. */
  descriptor: DatasetDescriptor | null;
  /** The snapshot's rows (null with no descriptor, or E3: a query never fetched). */
  table: ViewTable | null;
  theme: Theme;
  /** The updater's name in the label. */
  by: string;
  /** E3 M3 fix: the export's captured clock, at which a query's staleness is labelled; absent, the saved label. */
  now?: number;
}

/** One view as the exporters take it: the renderer's figure or table, its caption, label, warnings and Markdown. */
export function exportView({ spec, datasetId, descriptor, table, theme, by, now }: ViewInput): ExportView {
  const parsed = parseSpec(spec);
  const caption = parsed.ok ? captionOf(parsed.spec, datasetId) : (parsed.title ?? 'Chart');
  // E3: a query never fetched draws E2's no-data presentation, labelled as such
  const notFetched = descriptor !== null && snapshotOf(descriptor) === null;
  const rendered = notFetched ? renderFailure(spec, theme, datasetId, DATASET_STATES.notFetched) : renderView(spec, table, theme, datasetId);
  const label = descriptor ? sourceLabel(descriptor, by, now === undefined ? undefined : { now }) : DATASET_STATES.noDataset(datasetId); // E3 M3 fix
  // what the editor notes under the label: the descriptor's validation notes, and what the view could not show unless
  // its frame already says so
  const drawnInPlace = rendered.svg?.includes('<desc>This view cannot be drawn: ') ?? false;
  const warnings = [...new Set([...(descriptor ? mismatchNotes(descriptor) : []), ...(drawnInPlace ? [] : rendered.warnings)])];

  const preview = table === null ? ({ ok: false, error: notFetched ? DATASET_STATES.notFetched : DATASET_STATES.noDataset(datasetId) } as const) : viewPreview(spec, table, datasetId);
  // the preview's notes under its rows, the warnings below the label as every other format places them (E2 M6), each once
  const notes = preview.ok ? preview.table.notes : [];
  const below = warnings.filter((warning) => !notes.includes(warning));
  const line = (texts: readonly string[]) => (texts.length > 0 ? [`*${mdLine(texts.join(' · '))}*`] : []);
  const markdown = [`**${mdLine(caption)}**`, preview.ok ? gfm(preview.table) : mdLine(preview.error), ...line(notes), `*${mdLine(label)}*`, ...line(below)].join('\n\n');

  const common = { caption, sourceLabel: label, markdown, ...(warnings.length > 0 && { warnings }) };
  if (rendered.svg !== undefined) return { svg: rendered.svg, ...svgSize(rendered.svg), ...common };
  return { html: rendered.html, table: rendered.table, ...common };
}

// ---- every view of a state ----

export interface ViewExportOptions {
  /** A snapshot's rows by its ref and format; a rejection fails the export. */
  read(snapshot: SnapshotRef): Promise<ViewTable>;
  theme: Theme;
  /** An updater's name in a label, as files name people (B's `defaultAuthorName`: the human "Owner"). */
  authorName(actor: Actor): string;
  /** A PNG of a chart's SVG at its size (Word's fallback picture), when the format embeds one. */
  picture?(svg: string, size: { width: number; height: number }): Promise<Uint8Array>;
  /** E3 M3 fix: the one clock the export captured with its state, every view's staleness labelled at it (however long
   * its read takes); absent (a retained version's export), the saved labels. */
  now?: number;
}

/**
 * Every chart block of `doc` (the export's captured state) drawn: its snapshots read once each, its charts pictured
 * when asked. Answers B's synchronous `renderView`: a chart node's view, undefined for a node not of this state.
 */
export async function prepareViews(doc: Doc, options: ViewExportOptions): Promise<ViewRenderer> {
  const held = legacyDashboardFiles(doc);
  if (held) throw new Error(legacyDashboardReason(held));
  const blocks = chartSpecs(doc).map(({ source, spec }) => {
    const datasetId = datasetIdFromSource(source);
    return { key: viewKey({ attrs: { source, spec } }), spec, datasetId, descriptor: readDataset(doc, datasetId) };
  });
  const snapshots = new Map<string, Promise<ViewTable>>();
  const tableOf = (descriptor: DatasetDescriptor | null): Promise<ViewTable> | null => {
    const snapshot = descriptor && snapshotOf(descriptor);
    if (!snapshot) return null; // E3: none bound, or a query never fetched (no bytes to read)
    const key = `${snapshot.format}\u0000${snapshot.ref}`;
    if (!snapshots.has(key)) snapshots.set(key, options.read(snapshot));
    return snapshots.get(key)!;
  };
  const views = new Map<string, ExportView>();
  await Promise.all(
    blocks.map(async ({ key, spec, datasetId, descriptor }) => {
      const table = await tableOf(descriptor);
      if (!views.has(key)) views.set(key, exportView({ spec, datasetId, descriptor, table, theme: options.theme, by: descriptor?.updated ? options.authorName(descriptor.updated.by) : '', ...(options.now !== undefined && { now: options.now }) }));
    }),
  );
  const { picture } = options;
  if (picture) {
    const charts = new Map<string, { width: number; height: number }>();
    for (const view of views.values()) if (view.svg !== undefined) charts.set(view.svg, { width: view.width, height: view.height });
    const pngs = new Map(await Promise.all([...charts].map(async ([svg, size]) => [svg, await picture(svg, size)] as const)));
    for (const [key, view] of views) if (view.svg !== undefined) views.set(key, { ...view, png: pngs.get(view.svg)! });
  }
  return (node) => (node.type.name === 'chart' ? views.get(viewKey(node)) : undefined);
}
