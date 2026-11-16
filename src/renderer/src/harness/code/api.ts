// The `#panel` harness's code-tools surface, `window.__maws_harness.code` (C8c execution document, Interfaces *Harness
// API*). Types only, so the e2e project can import them. It reads what Review, Files and the file viewer show (their
// DOM and the stores behind it) and drives them as a reader would (clicks), over C8a's page; C8a's `panel` object is
// untouched. Actions that need a render before they are done answer a promise.
import type { TabTarget } from '@shared/ipc/schema/layout';

// Review's scopes (`tools/code/review/review-model.ts`), restated: that module reaches the transcript's components,
// which the e2e project does not compile.
export type ReviewScope = 'uncommitted' | 'branch' | 'turn' | 'staged' | 'commit'; // UX wave U5b-2: `commit`

export type ReviewSurface = 'panel' | 'tab'; // the panel's Review tool, or a diff tab in the page's left column

// UX wave U5b (M3): Review is one stack of sections. `files` are its sections in order, each with its fold; `selected`
// is the file whose section is at the top of the stack (`section` reads one by its path); `mode` is what the stack draws.
// M6: the one-file `openSelectedFile` left with the scenes; `openFileOf` opens a section's file by its path.
export interface CodeHarnessReview {
  scope: ReviewScope | null;
  turnId: string | null; // Last turn's turn (the panel tool's state, or a diff tab's ref)
  files: { path: string; added: number; removed: number; viewed: boolean; kind: string; folded: boolean }[];
  selected: string | null;
  hunks: string[] | null; // the selected file's hunk texts as Review draws them (null: none to draw, or not loaded)
  hunk: { index: number; count: number } | null; // `Showing hunk <index> of <count>` (or `<index> of <count>`), 1-based as shown
  mode: 'unified' | 'split';
  wrap: boolean;
  footer: string;
  header: string;
}

// UX wave U5b (M3): one file's section, read by its path, so a scene asserts per file whichever section is at the top
// (a short last section never reaches it). `hunks` as in `CodeHarnessReview`, for this file.
export interface CodeHarnessSection {
  path: string;
  kind: string;
  added: number;
  removed: number;
  folded: boolean;
  viewed: boolean;
  hunks: string[] | null;
}

export interface CodeHarnessViewer {
  path: string;
  kind: 'code' | 'markdown' | 'image' | 'frame' | 'external' | 'head'; // UX wave U6b-2: 'frame', a PDF, a page or media drawn
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
  selectFile(path: string, surface?: ReviewSurface): void; // brings the file's section to the top of the stack
  nextHunk(surface?: ReviewSurface): void;
  prevHunk(surface?: ReviewSurface): void;
  setMode(mode: 'unified' | 'split', surface?: ReviewSurface): void; // through the View menu: read `review().mode` after
  toggleWrap(surface?: ReviewSurface): void; // through the View menu: read `review().wrap` after
  markViewed(path: string, surface?: ReviewSurface): Promise<void>; // brings the file's section to the top, then marks it
  section(path: string, surface?: ReviewSurface): CodeHarnessSection | null; // null: no section for the path
  setFolded(path: string, folded: boolean, surface?: ReviewSurface): void; // a click on the header when it differs
  openFileOf(path: string, surface?: ReviewSurface): void; // `Open file ↗` of that file's section
  files(): { roots: string[]; expanded: string[]; selected: string | null; rows: { path: string; kind: string; depth: number }[] } | null;
  expand(path: string): Promise<void>; // resolves once the directory's listing (or its notice) is drawn
  selectEntry(path: string): void;
  viewer(): CodeHarnessViewer | null; // the focused pane's file tab
  toggleSource(): void;
  transcriptKey(): string | null; // the store key the left column's Transcript renders over: the loaded HarnessSession's `harness:<n>`
  storeKeys(): string[]; // the transcript store's entry keys
  changedTurns(key: string): string[]; // turn ids with changed files in divider metadata
  openTab(target: TabTarget): void; // C5's openTab, for a diff or file tab in the left column
}
