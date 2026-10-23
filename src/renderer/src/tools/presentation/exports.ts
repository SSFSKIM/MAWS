// The deck editor's Export menu (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M9, D12; G's X32 header
// `exports`): PowerPoint with the deck's faces named, with basic faces, or with each slide a picture; PDF; one HTML page;
// For Claude (zip); a PNG of the cover slide. Each is main's export service (`artifacts.export`, the agent's
// `artifact_export` route too) and then saved where the owner chooses, as the library's Export saves (`library.saveAs` of
// that export, the native dialog at Downloads); the outcome is a toast, a cancelled dialog says nothing. PowerPoint with
// uploaded faces embedded is not offered yet (the exporter refuses it; the tracker row of H3).
// P3-F (L233): what it exports is what the editor shows (the design's what-you-see rule, P3-E's Decision Log 31): while
// the history previews one retained version, that version (main reads its state and its pinned system); while two
// versions are compared nothing is offered rather than one side silently chosen; otherwise the live deck.
import type { MawsBridge } from '@shared/ipc/schema';
import type { ArtifactExportFonts, ArtifactExportFormat } from '@shared/maws/tools';
import type { DeckShown } from '@artifacts/slides/editor/session';
import { ipc } from '../../ipc/client';
import { toastFailure } from '../../library/dialogs';
import type { EditorHostExport } from '../../panel/editor-host';
import { toast } from '../../stores/notices';
import { VIEWERS_COPY } from '../artifacts/viewers/copy';

export interface DeckExport {
  id: string;
  label: string;
  format: ArtifactExportFormat;
  fonts?: ArtifactExportFonts;
}

export const DECK_EXPORTS: readonly DeckExport[] = [
  { id: 'pptx-basic', label: 'Basic fonts (default)', format: 'pptx', fonts: 'basic' },
  { id: 'pptx-named', label: 'Fonts by name', format: 'pptx', fonts: 'named' },
  { id: 'pptx-pictures', label: 'Slides as pictures', format: 'pptx', fonts: 'pictures' },
  { id: 'pdf', label: 'PDF', format: 'pdf' },
  { id: 'html', label: 'HTML (one page)', format: 'html' },
  { id: 'claude', label: VIEWERS_COPY.exportFormats.claude, format: 'claude' },
  { id: 'png', label: 'PNG (all slides)', format: 'pngs' },
];

/** The deck as `shown` (L233: the version previewed, else the live deck) exported as `entry` asks, then saved where the owner chooses. */
export async function exportDeck(artifactId: string, entry: DeckExport, shown: DeckShown = null, client: MawsBridge = ipc): Promise<void> {
  if (shown === 'compare') return; // two versions compared: nothing is exported
  // P4 (W1, L302): a file of its own (`ownFile`), saved by its id, so an export of the same revision and format between
  // the two (the agent's `artifact_export`, another option) never swaps the file saved
  const exported = await client.invoke('artifacts.export', { artifactId, format: entry.format, ...(entry.fonts && { fonts: entry.fonts }), ...(shown && { versionId: shown.versionId }), ownFile: true });
  if (!exported.ok) return toastFailure(VIEWERS_COPY.exportFailed(exported.error.message));
  const { revision, exportId } = exported.value;
  const saved = await client.invoke('library.saveAs', { artifactId, source: { export: { revision, format: entry.format, ...(exportId !== undefined && { exportId }) } } });
  if (!saved.ok) return toastFailure(VIEWERS_COPY.exportFailed(saved.error.message));
  if (saved.value.saved) void toast({ level: 'info', text: VIEWERS_COPY.saved(saved.value.path), actions: [], dismissible: true });
}

/** The header's Export entries for a deck as the editor shows it; none is offered while two versions are compared. */
export function deckExports(artifactId: string, shown: DeckShown, run: (entry: DeckExport) => void = (entry) => void exportDeck(artifactId, entry, shown)): EditorHostExport[] {
  const disabled = shown === 'compare';
  const item = (entry: DeckExport): EditorHostExport => ({ id: entry.id, label: entry.label, onSelect: () => run(entry), ...(disabled && { disabled }), ...(entry.fonts === 'named' && { description: 'Displays correctly only where the same fonts are installed.' }) });
  return [{ id: 'pptx', label: 'PowerPoint', onSelect: () => {}, disabled, children: DECK_EXPORTS.filter((entry) => entry.format === 'pptx').map(item) }, ...DECK_EXPORTS.filter((entry) => entry.format !== 'pptx').map(item)];
}
