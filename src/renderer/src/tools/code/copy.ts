// Every sentence the code tools show (C8c execution document, Interfaces *Copy*; exact strings are decisions). M2 holds
// the Files tool's and the viewer's; Review's join in M3.
import { FILES_LIST_MAX_ENTRIES } from '@shared/ipc/schema/files';

// Sizes in binary units labelled KB and MB (`1.0 MB` is 1,048,576 bytes), as the acceptance reads them.
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export const REFUSAL = "path outside the session's directories";

export const FILES_COPY = {
  title: 'Files',
  refresh: 'Refresh',
  noSession: 'Open a session to see its files',
  roles: { directory: 'directory', additional: 'additional directory', worktree: 'worktree' },
  symlink: (target: string | null) => `Symbolic link → ${target ?? 'unknown target'}`,
  empty: 'Empty directory',
  truncated: `Showing ${FILES_LIST_MAX_ENTRIES.toLocaleString('en-US')} of many entries`,
  couldNotList: (message: string) => `Could not list: ${message}`,
  refused: (message: string) => `Refused: ${message}`,
} as const;

export const VIEWER_COPY = {
  source: 'Source',
  rendered: 'Rendered',
  wrap: 'Wrap',
  openExternally: 'Open externally',
  externalKind: (kind: string) => `${kind} files open outside MAWS`,
  binary: (bytes: number) => `Binary file · ${formatSize(bytes)}`,
  head: (head: number, bytes: number) => `Showing the first ${formatSize(head)} of ${formatSize(bytes)}`,
  loadMore: 'Load more',
  loading: 'Loading',
  continuing: (loaded: number, bytes: number) => `Loading ${formatSize(loaded)} of ${formatSize(bytes)}`,
  noSession: 'No session grants access to this file',
  removed: 'File removed',
  updated: 'Updated',
  refused: (message: string) => `Refused: ${message}`,
  notOpened: (message: string) => `Not opened: ${message}`,
  // P2-F W-V (L95): an image's or a video's sizing controls
  zoom: 'Zoom',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  actualSize: 'Actual size',
  fit: 'Fit',
  zoomPercent: (scale: number) => `${Math.round(scale * 100)}%`,
} as const;

// A count as Review prints it, with the thousands separator (UX wave U5b, §I); English throughout, as the app's other counts.
const count = (n: number) => n.toLocaleString('en-US');

export const REVIEW_COPY = {
  title: 'Review',
  noSession: 'Open a session to review its changes',
  scopes: { uncommitted: 'Uncommitted', branch: 'This branch', turn: 'Last turn', staged: 'Staged' },
  // UX wave U5b (§I; card 1 at its default, built in `totalsWords`): the totals without the scope's name, which the
  // pressed chip above them says.
  totals: (files: number, added: number, removed: number) => `${count(files)} ${files === 1 ? 'file' : 'files'} changed · +${count(added)} −${count(removed)}`,
  // A disabled chip's reason, as its tooltip.
  mainWorktreeBranch: (branch: string) => `Session runs on ${branch}, the main worktree's branch`,
  detachedHead: 'Detached HEAD',
  indexMatchesHead: 'Index matches HEAD',
  noMainBranch: 'The main worktree has no branch', // C10 answered a detached main worktree (base `HEAD`)
  noCommits: (branch: string) => `No commits on ${branch} yet`, // C10 answered null: the branch does not resolve
  noTurnChangedFiles: 'No turn has changed files yet', // UX wave U5b (l5-code-12 c): Last turn is always listed
  // Empty scopes
  noUncommitted: 'No uncommitted changes',
  nothingOnBranch: (branch: string, base: string) => `Nothing on ${branch} beyond ${base}`,
  nothingStaged: 'Nothing staged',
  turnChangedNothing: 'This turn changed no files',
  // A file's section (UX wave U5b, §F and §I): a kind's badge (none for a modified file), its counts, its body
  kinds: { modified: 'Modified', added: 'Added', deleted: 'Deleted', renamed: 'Renamed', binary: 'Binary', untracked: 'Untracked', conflict: 'Conflict' },
  renamedFrom: (old: string) => `Renamed from ${old}`,
  renamed: (old: string, now: string) => `${old} → ${now}`, // a rename whose two paths fit whole
  added: (n: number) => `+${count(n)}`,
  removed: (n: number) => `−${count(n)}`,
  binaryFile: 'Binary file',
  retry: 'Retry',
  // A file held still under an open comment card while the agent changed it (UX wave U5b, M5; §G, §I)
  fileChanged: 'This file changed',
  lineLeftDiff: 'The line this comment was on is no longer in this diff.', // over the comments whose line left the diff (M5; D11, Decision Log 20 and 21)
  fileNotInScope: 'The file this comment is on is not in this diff.', // over the comments whose file the scope does not hold, or whose scope has no files (Decision Log 21)
  diffNotShown: "This file's diff is not shown here.", // over the comments whose file is in the scope while the surface draws no lines for it: its own read failed, or it is too large to draw (Decision Log 21)
  refresh: 'Refresh',
  untrackedNote: 'Untracked file · not in the diff',
  // The toolbar (UX wave U5b, §F): Collapse all and the View menu, which holds the stack's Unified, Split and Wrap
  collapseAll: 'Collapse all',
  expandAll: 'Expand all',
  view: 'View',
  unified: 'Unified',
  split: 'Split',
  splitNeedsRoom: 'Split needs a wider column',
  wrap: 'Wrap',
  hunkOf: (index: number, count: number) => `Showing hunk ${index} of ${count}`,
  hunkOfShort: (index: number, count: number) => `${index} of ${count}`, // where the long form does not fit (card 1)
  previousHunk: 'Previous hunk',
  nextHunk: 'Next hunk',
  openFile: 'Open file ↗',
  openFileGlyph: '↗', // "Open file ↗" in a narrow header (card 2), its words the tooltip
  markViewed: 'Mark viewed',
  viewed: 'Viewed',
  tooLarge: 'Diff too large to display.',
  openTheFile: 'Open the file', // follows `tooLarge` in one sentence: `Diff too large to display. Open the file`
  // Footers
  footer: {
    uncommitted: (branch: string) => `${branch} · Working tree against HEAD`,
    branch: (branch: string, base: string) => `${branch} · Since ${base}`,
    staged: (branch: string) => `${branch} · Index against HEAD`,
    turn: (branch: string | null) => (branch === null ? 'Changes from the turn' : `${branch} · Changes from the turn`),
  },
  detachedAt: (head: string) => `detached at ${head.slice(0, 7)}`,
  notRepository: 'Not a git repository',
  unavailable: (message: string) => `Diff unavailable: ${message}`,
  refused: (message: string) => `Refused: ${message}`, // a diff tab's path outside the session's directories
  unknownRef: 'unknown ref',
  turnNotLoaded: 'the turn is not loaded · Open the session',
  loading: 'Loading',
  // The Environment summary's addition to the host's change line.
  staged: (n: number) => ` · ${n} staged`,
} as const;

// E5: the editor's sentences (E5 execution document, Interfaces *Copy*; exact strings are decisions). M2 shows the save,
// the dirty mark, the close sheet and Changed on disk; M3 the merge view's, the conflict blocks' and the gutter's.
export const EDITOR_COPY = {
  save: 'Save', saving: 'Saving…', unsaved: 'Unsaved changes',
  saveFailed: (message: string) => `Could not save: ${message}`,
  changedOnDisk: 'Changed on disk', reload: 'Reload', keepMine: 'Keep mine', compare: 'Compare',
  conflictOnSave: 'Changed on disk since you opened it',
  // E11 W-D: the disk's version under unsaved edits that cannot be shown as theirs, by why
  diskUnusable: {
    head: 'Changed on disk: now larger than the editor’s cap, so it cannot be merged',
    binary: 'Changed on disk: no longer text, so it cannot be merged',
    encoding: 'Changed on disk: no longer UTF-8, so it cannot be merged',
  },
  changesFromDisk: (n: number) => `${n} ${n === 1 ? 'change' : 'changes'} from disk`,
  keepMineChunk: 'Keep mine', takeTheirs: 'Take theirs', previousChange: 'Previous change', nextChange: 'Next change',
  conflicts: (n: number) => `${n} ${n === 1 ? 'conflict' : 'conflicts'}`,
  acceptMine: 'Accept mine', acceptTheirs: 'Accept theirs', acceptBoth: 'Accept both',
  mineLabel: (name: string | null) => (name ? `mine (${name})` : 'mine'), theirsLabel: (name: string | null) => (name ? `theirs (${name})` : 'theirs'), base: 'base',
  previousConflict: 'Previous conflict', nextConflict: 'Next conflict',
  closeTitle: (name: string) => `Save changes to ${name}?`, closeBody: 'Your changes will be lost if you don’t save them.', dontSave: 'Don’t save',
  readOnly: {
    outside: 'Read-only: the file is outside the folders this session works in', // UX wave U6c: a file the transcript names
    head: 'Read-only: the file is larger than the editor’s cap',
    encoding: 'Read-only: the file is not UTF-8',
    loading: 'Read-only until the file has loaded',
  },
  comment: (line: number) => `Comment on line ${line}`,
  anchorTitle: (label: string) => `Comment on ${label}`, anchorBody: 'The comment composer arrives with side threads (E3). This anchor will open it:', close: 'Close',
  // M5: the quit-when-idle banner's part (the quit question's own words are main's, in quit-guard.ts)
  unsavedFilesPart: (n: number) => `${n} unsaved ${n === 1 ? 'file' : 'files'}`,
} as const;
