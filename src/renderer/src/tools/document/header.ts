// The document's X32 header (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D13; G's editor host contract):
// what the header above the editor says and offers, built from the tab's own state (X32's lifetime rule: a retained
// action or the close guard reads the tab, never a body's component). The saved word is the replica's: saved when live
// with nothing left waiting, saving while edits have waited past the tab's delay for the host's acknowledgement (M9:
// never for the milliseconds a keystroke's ack takes), reconnecting while the port is down or the replica syncs
// again, read-only when the store is (a newer app wrote it) or a version is shown. The actions are in importance order
// for the 360 px fold: History, then an export's progress or failure while there is one (the header's Export is G's
// menu, drawn after the actions), Save version, Comments (the id the header's open-thread count stands for), Agent edits
// as suggestions. The menu exports the four formats; Word and PDF on Letter, or on A4 by their own entries (the owner's
// Decision Log 43).
import type { DocumentState } from '@artifacts/host';
import type { DocumentRail } from '@artifacts/document/editor/DocumentEditor';
import type { PageSize } from '@artifacts/document/export/design-system';
import type { EditorHostAction, EditorHostExport, EditorHostRegistration, SavedState } from '../../panel/editor-host';
import { CommentsIcon, HistoryIcon, SaveVersionIcon, SuggestIcon } from './icons';

export type DocumentExportFormat = 'md' | 'html' | 'docx' | 'pdf';

export type ExportStatus =
  | { phase: 'running'; format: DocumentExportFormat }
  | { phase: 'failed'; format: DocumentExportFormat; message: string }
  | { phase: 'done'; format: DocumentExportFormat; path: string };

export interface DocumentHeaderState {
  title: string;
  document: DocumentState | null; // null until the replica has opened
  saving: boolean; // edits have waited past the delay for the host's acknowledgement (the tab's state)
  previewing: boolean; // a version is shown in place of the live document
  unresolved: number; // open threads
  rail: DocumentRail;
  history: boolean; // version history is offered
  suggestions: boolean | null; // the artifact's `agentEditsAsSuggestions`, null until its row is read
  exporting: ExportStatus | null;
}

export interface DocumentHeaderCommands {
  toggleRail(rail: Exclude<DocumentRail, null>): void;
  saveVersion(): void;
  setSuggestions(on: boolean): void;
  export(format: DocumentExportFormat, pageSize: PageSize): void;
  dismissExport(): void;
  closeGuard(): Promise<boolean>;
}

export const FORMAT_NAMES: Record<DocumentExportFormat, string> = { md: 'Markdown', html: 'Web page', docx: 'Word', pdf: 'PDF' };
const EXPORTS: ReadonlyArray<{ format: DocumentExportFormat; pageSize: PageSize; label: string }> = [
  { format: 'md', pageSize: 'letter', label: 'Markdown (.md)' },
  { format: 'html', pageSize: 'letter', label: 'Web page (.html)' },
  { format: 'docx', pageSize: 'letter', label: 'Word (.docx)' },
  { format: 'docx', pageSize: 'a4', label: 'Word, A4 (.docx)' },
  { format: 'pdf', pageSize: 'letter', label: 'PDF (.pdf)' },
  { format: 'pdf', pageSize: 'a4', label: 'PDF, A4 (.pdf)' },
];
const LABEL_MAX = 80; // an action's label is drawn whole in the header

export function savedOf(document: DocumentState | null, previewing: boolean, saving: boolean): SavedState | null {
  if (!document) return null;
  if (document.readOnly || previewing) return 'readonly';
  if (document.phase !== 'live') return 'reconnecting';
  return saving ? 'saving' : 'saved';
}

const clip = (text: string): string => (text.length <= LABEL_MAX ? text : `${text.slice(0, LABEL_MAX - 1)}…`);
const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

function exportAction(status: ExportStatus, commands: DocumentHeaderCommands): EditorHostAction {
  const name = FORMAT_NAMES[status.format];
  switch (status.phase) {
    case 'running':
      return { id: 'export', label: `Exporting ${name}…`, disabled: true, onSelect: () => {} };
    case 'failed':
      return { id: 'export', label: clip(`${name} export failed: ${status.message}`), onSelect: () => commands.dismissExport() };
    case 'done':
      return { id: 'export', label: clip(`Exported ${fileName(status.path)}`), onSelect: () => commands.dismissExport() };
  }
}

export function documentHeader(state: DocumentHeaderState, commands: DocumentHeaderCommands): EditorHostRegistration {
  const actions: EditorHostAction[] = [];
  if (state.history) actions.push({ id: 'history', label: 'Version history', icon: HistoryIcon, pressed: state.rail === 'history', onSelect: () => commands.toggleRail('history') });
  if (state.exporting) actions.push(exportAction(state.exporting, commands));
  if (state.history) actions.push({ id: 'save-version', label: 'Save version', icon: SaveVersionIcon, onSelect: () => commands.saveVersion() });
  actions.push({ id: 'comments', label: 'Comments', icon: CommentsIcon, pressed: state.rail === 'comments', onSelect: () => commands.toggleRail('comments') });
  actions.push({
    id: 'suggestions',
    label: 'Agent edits as suggestions',
    icon: SuggestIcon,
    pressed: state.suggestions ?? false,
    disabled: state.suggestions === null,
    onSelect: () => state.suggestions !== null && commands.setSuggestions(!state.suggestions),
  });
  const running = state.exporting?.phase === 'running';
  const exports: EditorHostExport[] = EXPORTS.map(({ format, pageSize, label }) => ({ id: `${format}-${pageSize}`, label, disabled: running, onSelect: () => commands.export(format, pageSize) }));
  return { title: state.title, saved: savedOf(state.document, state.previewing, state.saving), unresolved: state.unresolved, actions, exports, closeGuard: commands.closeGuard };
}
