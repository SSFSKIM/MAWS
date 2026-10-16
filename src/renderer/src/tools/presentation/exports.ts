// The deck editor's Export menu (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M9, D12; G's X32 header
// `exports`): PowerPoint with the deck's faces named, with basic faces, or with each slide a picture; PDF; one HTML page;
// For Claude (zip); a PNG of the cover slide. Each is main's export service (`artifacts.export`, the agent's
// `artifact_export` route too) and then saved where the owner chooses, as the library's Export saves (`library.saveAs` of
// that export, the native dialog at Downloads); the outcome is a toast, a cancelled dialog says nothing. PowerPoint with
// uploaded faces embedded is not offered yet (the exporter refuses it; the tracker row of H3).
import type { MawsBridge } from '@shared/ipc/schema';
import type { ArtifactExportFonts, ArtifactExportFormat } from '@shared/maws/tools';
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
  { id: 'pptx-named', label: 'PowerPoint (fonts by name)', format: 'pptx', fonts: 'named' },
  { id: 'pptx-basic', label: 'PowerPoint (basic fonts)', format: 'pptx', fonts: 'basic' },
  { id: 'pptx-pictures', label: 'PowerPoint (slides as pictures)', format: 'pptx', fonts: 'pictures' },
  { id: 'pdf', label: 'PDF', format: 'pdf' },
  { id: 'html', label: 'HTML (one page)', format: 'html' },
  { id: 'claude', label: VIEWERS_COPY.exportFormats.claude, format: 'claude' },
  { id: 'png', label: 'PNG (cover slide)', format: 'png' },
];

/** The deck exported as `entry` asks, then saved where the owner chooses. */
export async function exportDeck(artifactId: string, entry: DeckExport, client: MawsBridge = ipc): Promise<void> {
  const exported = await client.invoke('artifacts.export', { artifactId, format: entry.format, ...(entry.fonts && { fonts: entry.fonts }) });
  if (!exported.ok) return toastFailure(VIEWERS_COPY.exportFailed(exported.error.message));
  const saved = await client.invoke('library.saveAs', { artifactId, source: { export: { revision: exported.value.revision, format: entry.format } } });
  if (!saved.ok) return toastFailure(VIEWERS_COPY.exportFailed(saved.error.message));
  if (saved.value.saved) void toast({ level: 'info', text: VIEWERS_COPY.saved(saved.value.path), actions: [], dismissible: true });
}

/** The header's Export entries for a deck. */
export function deckExports(artifactId: string, run: (entry: DeckExport) => void = (entry) => void exportDeck(artifactId, entry)): EditorHostExport[] {
  return DECK_EXPORTS.map((entry) => ({ id: entry.id, label: entry.label, onSelect: () => run(entry) }));
}
