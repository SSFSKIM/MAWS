// The `#panel` harness's code-tools surface, `window.__maws_harness.code` (C8c execution document, Interfaces *Harness
// API*). Types only, so the e2e project can import them. It reads what Review, Files and the file viewer show (their
// DOM and the stores behind it) and drives them as a reader would (clicks), over C8a's page; C8a's `panel` object is
// untouched. Actions that need a render before they are done answer a promise.
import type { TabTarget } from '@shared/ipc/schema/layout';

// Review's scopes (`tools/code/review/review-model.ts`), restated: that module reaches the transcript's components,
// which the e2e project does not compile.
export type ReviewScope = 'uncommitted' | 'branch' | 'turn' | 'staged';

export type ReviewSurface = 'panel' | 'tab'; // the panel's Review tool, or a diff tab in the page's left column

export interface CodeHarnessReview {
  scope: ReviewScope | null;
  turnId: string | null; // Last turn's turn (the panel tool's state, or a diff tab's ref)
  files: { path: string; added: number; removed: number; viewed: boolean; kind: string }[];
  selected: string | null;
  hunks: string[] | null; // the selected file's hunk texts as Review draws them (null: none to draw, or not loaded)
  hunk: { index: number; count: number } | null; // `Showing hunk <index> of <count>`, 1-based as shown
  mode: 'unified' | 'split';
  wrap: boolean;
  footer: string;
  header: string;
}

export interface CodeHarnessViewer {
  path: string;
  kind: 'code' | 'markdown' | 'image' | 'external' | 'head';
  line: number | null;
  notice: string | null;
  lines: number | null; // the file's line count: CodeMirror's doc.lines, minus one when the text ends with a line break
  sourceView: boolean;
  language: string | null;
  imageSrc: string | null;
}

export interface CodeHarnessApi {
  // The panel's Review when the panel shows it, else the diff tab in the left column; `surface` picks one.
  review(surface?: ReviewSurface): CodeHarnessReview | null;
  selectScope(scope: ReviewScope): void;
  selectFile(path: string, surface?: ReviewSurface): void;
  nextHunk(surface?: ReviewSurface): void;
  prevHunk(surface?: ReviewSurface): void;
  setMode(mode: 'unified' | 'split', surface?: ReviewSurface): void;
  toggleWrap(surface?: ReviewSurface): void;
  markViewed(path: string, surface?: ReviewSurface): Promise<void>; // selects the file, then marks it
  openSelectedFile(surface?: ReviewSurface): void; // `Open file ↗` on the current hunk
  files(): { roots: string[]; expanded: string[]; selected: string | null; rows: { path: string; kind: string; depth: number }[] } | null;
  expand(path: string): Promise<void>; // resolves once the directory's listing (or its notice) is drawn
  selectEntry(path: string): void;
  viewer(): CodeHarnessViewer | null; // the focused pane's file tab
  toggleSource(): void;
  clickReceiptReview(path?: string): Promise<void>; // the loaded receipt's "Review changes", or one of its file rows
  transcriptKey(): string | null; // the store key the left column's Transcript renders over: the loaded HarnessSession's `harness:<n>`
  storeKeys(): string[]; // the transcript store's entry keys
  receiptTurns(key: string): string[]; // the turn ids of the receipt rows in `entries[key].rows`
  openTab(target: TabTarget): void; // C5's openTab, for a diff or file tab in the left column
}
