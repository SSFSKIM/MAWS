// The design's Export menu and sheet (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M5; X32's header
// `exports: [png, pdf]`; XE9 and the parent's Decision Logs 26 and 31): the selected board as a PNG or a one-page PDF,
// and every board as a PDF. Each is main's export service (`artifacts.export`, the agent's `artifact_export` route too)
// and then saved where the owner chooses, as the deck's menu saves (`library.saveAs`). What it exports is what the tab
// shows, read from the tab's own state when the entry is chosen: the board selected (its frame, else the active board)
// and, while the history previews one retained version, that version (its boards, system and assets: main reads them
// at the version); while two versions are compared nothing is offered rather than one side silently chosen.
//
// A picture over the cap is never cropped: main refuses it `exportTooLarge {board, w, h, maxScale}`, and the sheet states
// that scale and the size it gives; the owner agreeing, the export runs at it.
import type { MawsBridge } from '@shared/ipc/schema';
import { artifactRefusalOf } from '@shared/ipc/schema/artifacts';
import type { ShownVersion } from '@artifacts/design/editor/viewport';
import { boardLabel, readBoards } from '@artifacts/design/editor/boards';
import type { HistoryApi } from '@artifacts/document/editor/history/api';
import { applyV2, newDoc } from '@artifacts/yjs';
import { ipc } from '../../ipc/client';
import { toastFailure } from '../../library/dialogs';
import type { EditorHostExport } from '../../panel/editor-host';
import { confirm, type ConfirmRequest } from '../../sessions/dialogs';
import { toast } from '../../stores/notices';
import { VIEWERS_COPY } from '../artifacts/viewers/copy';

export interface DesignExportEntry {
  id: 'png' | 'pdf-board' | 'pdf';
  label: string;
  format: 'png' | 'pdf';
  /** The selected board, or every board. */
  of: 'board' | 'all';
}

export const DESIGN_EXPORTS: readonly DesignExportEntry[] = [
  { id: 'png', label: 'PNG (selected board)', format: 'png', of: 'board' },
  { id: 'pdf-board', label: 'PDF (selected board)', format: 'pdf', of: 'board' },
  { id: 'pdf', label: 'PDF (all boards)', format: 'pdf', of: 'all' },
];

/**
 * What the tab shows when an entry is chosen: the board an export takes and its name as shown (the live selection, or
 * while a version is previewed that version's own board and name), and the version its history previews.
 */
export interface DesignExportContext {
  board: string | null;
  label: string | null;
  shown: ShownVersion;
}

export interface DesignExportRequest {
  format: 'png' | 'pdf';
  board?: string;
  boards?: string[];
  scale?: number;
  versionId?: number;
}

/** The request `entry` sends for what the tab shows. */
export function designExportRequest(entry: DesignExportEntry, { board, shown }: DesignExportContext): DesignExportRequest {
  const version = shown !== null && shown !== 'compare' ? { versionId: shown.versionId } : {};
  if (entry.of === 'all' || board === null) return { format: entry.format, ...version };
  return entry.format === 'png' ? { format: 'png', board, ...version } : { format: 'pdf', boards: [board], ...version };
}

/** The header's Export entries; a board's need a board, and none is offered while two versions are compared. */
export function designExports(context: Pick<DesignExportContext, 'board' | 'shown'>, run: (entry: DesignExportEntry) => void): EditorHostExport[] {
  return DESIGN_EXPORTS.map((entry) => {
    const disabled = context.shown === 'compare' || (entry.of === 'board' && context.board === null);
    return { id: entry.id, label: entry.label, onSelect: () => run(entry), ...(disabled && { disabled }) };
  });
}

/** WR 66: the card's version, with the same board choice as its preview: selected if retained, otherwise first. */
export function designVersionExports(artifactId: string, versionId: number, current: DesignExportContext, source: Pick<HistoryApi, 'versionState'>): EditorHostExport[] {
  return DESIGN_EXPORTS.map((entry) => ({
    id: entry.id,
    label: entry.label,
    onSelect: async () => {
      try {
        if (entry.of === 'all') return await exportDesign(artifactId, { format: entry.format, versionId }, { boardName: (id) => id });
        const state = await source.versionState(versionId);
        const doc = newDoc();
        let context: DesignExportContext;
        try {
          applyV2(doc, state);
          const boards = readBoards(doc).boards;
          const board = boards.find((b) => b.id === current.board) ?? boards[0];
          if (!board) throw new Error('This version has no boards.');
          const label = boardLabel(board);
          context = { board: board.id, label, shown: { versionId, board: board.id, label } };
        } finally {
          doc.destroy();
        }
        await runDesignExport(artifactId, entry, context);
      } catch (error) {
        toastFailure(VIEWERS_COPY.exportFailed(error instanceof Error ? error.message : String(error)));
      }
    },
  }));
}

export type DesignExportAsk = (sheet: ConfirmRequest) => Promise<boolean>;

const percent = (scale: number) => `${Math.round(scale * 10_000) / 100}%`;
const side = (v: number) => Math.max(1, Math.round(v));

/** The sheet for a board too large to picture at the size asked: the scale that fits and what it gives. */
function fittingSheet(name: string, format: 'png' | 'pdf', { w, h, maxScale }: { w: number; h: number; maxScale: number }): ConfirmRequest {
  const cap = format === 'png' ? 'A PNG can be at most 8192 px on a side' : 'A PDF page can be at most 19200 px on a side';
  return {
    title: `Export “${name}” at ${percent(maxScale)}?`,
    body: `“${name}” is ${w} × ${h} px. ${cap}, so MAWS exports the whole board at ${percent(maxScale)} (${side(w * maxScale)} × ${side(h * maxScale)} px); nothing is cropped.`,
    confirmLabel: `Export at ${percent(maxScale)}`,
    destructive: false,
  };
}

/** The design exported as `request` asks (at the fitting scale when the owner agrees), then saved where they choose. */
export async function exportDesign(artifactId: string, request: DesignExportRequest, { client = ipc, ask = confirm, boardName }: { client?: MawsBridge; ask?: DesignExportAsk; boardName(id: string): string }): Promise<void> {
  let exported = await client.invoke('artifacts.export', { artifactId, ...request });
  if (!exported.ok) {
    const refusal = artifactRefusalOf(exported.error);
    const data = refusal?.data as { board?: unknown; w?: unknown; h?: unknown; maxScale?: unknown } | undefined;
    if (refusal?.reason !== 'exportTooLarge' || request.scale !== undefined || typeof data?.board !== 'string' || typeof data.w !== 'number' || typeof data.h !== 'number' || typeof data.maxScale !== 'number') return toastFailure(VIEWERS_COPY.exportFailed(exported.error.message));
    if (!(await ask(fittingSheet(boardName(data.board), request.format, { w: data.w, h: data.h, maxScale: data.maxScale })))) return;
    exported = await client.invoke('artifacts.export', { artifactId, ...request, scale: data.maxScale });
    if (!exported.ok) return toastFailure(VIEWERS_COPY.exportFailed(exported.error.message));
  }
  const { revision, exportId } = exported.value; // the export's own file (Decision Log 33)
  const saved = await client.invoke('library.saveAs', { artifactId, source: { export: { revision, format: request.format, ...(exportId !== undefined && { exportId }) } } });
  if (!saved.ok) return toastFailure(VIEWERS_COPY.exportFailed(saved.error.message));
  if (saved.value.saved) void toast({ level: 'info', text: VIEWERS_COPY.saved(saved.value.path), actions: [], dismissible: true });
}

/** `entry` exported for what the tab shows (`context`, read as it is chosen): the sheet names the board as shown. */
export function runDesignExport(artifactId: string, entry: DesignExportEntry, context: DesignExportContext, deps: { client?: MawsBridge; ask?: DesignExportAsk } = {}): Promise<void> {
  return exportDesign(artifactId, designExportRequest(entry, context), { ...deps, boardName: (id) => (id === context.board && context.label ? context.label : id) });
}
