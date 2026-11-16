// The document's X32 header (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D13; G's editor host contract):
// what the header above the editor says and offers, built from the tab's own state (X32's lifetime rule: a retained
// action or the close guard reads the tab, never a body's component). The saved word is the replica's: saved when live
// with nothing left waiting, saving while edits have waited past the tab's delay for the host's acknowledgement (M9:
// never for the milliseconds a keystroke's ack takes), reconnecting while the port is down or the replica syncs
// again, read-only when the store is (a newer app wrote it) or a version is shown. The actions are in importance order
// for the 360 px fold: an export's progress or failure while there is one (the header's Export is G's menu, drawn
// after the actions), Save version and Agent edits as suggestions. History and Comments belong only to the document's
// formatting toolbar (UX2); the header keeps the open-thread count as a non-interactive badge. The menu exports the four formats; Word and PDF on Letter, or on A4 by their own entries (the owner's
// Decision Log 43). UX wave U10b (§B.5 of docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md; the owner's
// answer to the card "Export menu"): a document's menu is the four formats, which send no size, so an export prints on
// the document's own page, then its page as three checked items, Letter, A4 and Compact (./page.ts); a dashboard keeps
// the six rows (H8); the history card's menu is a document's four formats. The page items show the setting and take no
// choice while the document cannot be written (opened to view, a version shown) or an export runs.
// P3-F (8.2, F7; c65, c66): it exports what the editor shows (the tab's `export`), so while two versions are compared
// none is offered, as the deck's (L233); a saved export says where in a toast, so the header keeps no finished export.
import type { DocumentState } from '@artifacts/host';
import type { DocumentRail, DocumentShown } from '@artifacts/document/editor/DocumentEditor'; // P3-F (F7): DocumentShown
import type { PageSize } from '@artifacts/document/export/design-system';
import type { CloseAsk, EditorHostAction, EditorHostExport, EditorHostRegistration, SavedState } from '../../panel/editor-host';
import { SaveVersionIcon, SuggestIcon } from './icons';
import type { PageInForce, PageItem } from './page'; // UX wave U10b

export type DocumentExportFormat = 'md' | 'html' | 'docx' | 'pdf';

export type ExportStatus = { phase: 'running'; format: DocumentExportFormat } | { phase: 'failed'; format: DocumentExportFormat; message: string }; // P3-F (F7): no 'done'

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
  shown: DocumentShown; // P3-F (F7): what the editor shows, which Export exports
  kind: 'document' | 'dashboard'; // UX wave U10b: a dashboard has no page setting (H8)
  page: PageMenuState; // UX wave U10b: what the page items show (a document's)
}

/** UX wave U10b: the page in force, and whether the items take a choice (the document can be written). */
export interface PageMenuState extends PageInForce {
  disabled: boolean;
}

export interface DocumentHeaderCommands {
  toggleRail(rail: Exclude<DocumentRail, null>): void;
  saveVersion(): void;
  setSuggestions(on: boolean): void;
  export(format: DocumentExportFormat, pageSize?: PageSize): void; // UX wave U10b: a size only where the row carries one
  choosePage(item: PageItem): void; // UX wave U10b
  dismissExport(): void;
  closeGuard(ask?: CloseAsk): Promise<boolean>; // P4-B3: ask
}

export const FORMAT_NAMES: Record<DocumentExportFormat, string> = { md: 'Markdown', html: 'Web page', docx: 'Word', pdf: 'PDF' };
/** UX wave U10b (§B.5): the one sentence of an export the document's last write held back (M3 decision 3). */
export const EXPORT_COPY = {
  exportNotSaved: 'The last change is not saved yet. Try again in a moment.',
} as const;
// A dashboard's rows (H8: it has no page setting), each with the size it prints on
const DASHBOARD_EXPORTS: ReadonlyArray<{ format: DocumentExportFormat; pageSize: PageSize; label: string }> = [
  { format: 'md', pageSize: 'letter', label: 'Markdown (.md)' },
  { format: 'html', pageSize: 'letter', label: 'Web page (.html)' },
  { format: 'docx', pageSize: 'letter', label: 'Word (.docx)' },
  { format: 'docx', pageSize: 'a4', label: 'Word, A4 (.docx)' },
  { format: 'pdf', pageSize: 'letter', label: 'PDF (.pdf)' },
  { format: 'pdf', pageSize: 'a4', label: 'PDF, A4 (.pdf)' },
];
// A document's formats (UX wave U10b, H7): no size, so the export follows the document's page
const DOCUMENT_EXPORTS: ReadonlyArray<{ format: DocumentExportFormat; label: string }> = [
  { format: 'md', label: 'Markdown (.md)' },
  { format: 'html', label: 'Web page (.html)' },
  { format: 'docx', label: 'Word (.docx)' },
  { format: 'pdf', label: 'PDF (.pdf)' },
];
const PAGE_ITEMS: ReadonlyArray<{ item: PageItem; label: string }> = [
  { item: 'letter', label: 'Letter' },
  { item: 'a4', label: 'A4' },
  { item: 'compact', label: 'Compact' },
];

/**
 * The same formats in the header and on a history card; the caller binds their export subject. A document's header also
 * passes its page items' state and their command; a history card passes none and lists the formats alone.
 */
export function documentExports(
  shown: DocumentShown,
  running: boolean,
  run: DocumentHeaderCommands['export'],
  menu: { kind: DocumentHeaderState['kind']; page?: { state: PageMenuState; choose(item: PageItem): void } },
): EditorHostExport[] {
  const disabled = running || shown === 'compare';
  if (menu.kind === 'dashboard') return DASHBOARD_EXPORTS.map(({ format, pageSize, label }) => ({ id: `${format}-${pageSize}`, label, disabled, onSelect: () => run(format, pageSize) }));
  const formats: EditorHostExport[] = DOCUMENT_EXPORTS.map(({ format, label }) => ({ id: format, label, disabled, onSelect: () => run(format) }));
  const page = menu.page;
  if (!page) return formats;
  const items = PAGE_ITEMS.map(({ item, label }): EditorHostExport => {
    const checked = item === 'compact' ? page.state.compact : page.state.size === item;
    const held = page.state.disabled || running || (item !== 'compact' && !page.state.sizeKnown);
    return { id: `page-${item}`, label, checked, disabled: held, onSelect: () => page.choose(item) };
  });
  return [...formats, ...items];
}

const LABEL_MAX = 80; // an action's label is drawn whole in the header

export function savedOf(document: DocumentState | null, previewing: boolean, saving: boolean): SavedState | null {
  if (!document) return null;
  if (document.readOnly || previewing) return 'readonly';
  if (document.phase !== 'live') return 'reconnecting';
  return saving ? 'saving' : 'saved';
}

const clip = (text: string): string => (text.length <= LABEL_MAX ? text : `${text.slice(0, LABEL_MAX - 1)}…`);

function exportAction(status: ExportStatus, commands: DocumentHeaderCommands): EditorHostAction {
  const name = FORMAT_NAMES[status.format];
  switch (status.phase) {
    case 'running':
      return { id: 'export', label: `Exporting ${name}…`, disabled: true, onSelect: () => {} };
    case 'failed':
      return { id: 'export', label: clip(`${name} export failed: ${status.message}`), onSelect: () => commands.dismissExport() };
  }
}

export function documentHeader(state: DocumentHeaderState, commands: DocumentHeaderCommands): EditorHostRegistration {
  const actions: EditorHostAction[] = [];
  if (state.exporting) actions.push(exportAction(state.exporting, commands));
  if (state.history) actions.push({ id: 'save-version', label: 'Save version', icon: SaveVersionIcon, onSelect: () => commands.saveVersion() });
  actions.push({
    id: 'suggestions',
    label: 'Agent edits as suggestions',
    icon: SuggestIcon,
    pressed: state.suggestions ?? false,
    disabled: state.suggestions === null,
    onSelect: () => state.suggestions !== null && commands.setSuggestions(!state.suggestions),
  });
  const exports = documentExports(state.shown, state.exporting?.phase === 'running', (...row) => commands.export(...row), {
    kind: state.kind,
    page: { state: state.page, choose: (item) => commands.choosePage(item) },
  });
  return { title: state.title, saved: savedOf(state.document, state.previewing, state.saving), unresolved: state.unresolved, actions, exports, closeGuard: commands.closeGuard };
}
