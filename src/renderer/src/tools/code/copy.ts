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
} as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const REVIEW_COPY = {
  title: 'Review',
  noSession: 'Open a session to review its changes',
  scopes: { uncommitted: 'Uncommitted', branch: 'This branch', turn: 'Last turn', staged: 'Staged' },
  header: (files: number, added: number, removed: number, scope: string) => `${plural(files, 'file')} changed · +${added} −${removed} · ${scope}`,
  // A disabled chip's reason, as its tooltip.
  mainWorktreeBranch: (branch: string) => `Session runs on ${branch}, the main worktree's branch`,
  detachedHead: 'Detached HEAD',
  indexMatchesHead: 'Index matches HEAD',
  noMainBranch: 'The main worktree has no branch', // C10 answered a detached main worktree (base `HEAD`)
  noCommits: (branch: string) => `No commits on ${branch} yet`, // C10 answered null: the branch does not resolve
  // Empty scopes
  noUncommitted: 'No uncommitted changes',
  nothingOnBranch: (branch: string, base: string) => `Nothing on ${branch} beyond ${base}`,
  nothingStaged: 'Nothing staged',
  turnChangedNothing: 'This turn changed no files',
  // A file
  kinds: { modified: 'Modified', added: 'Added', deleted: 'Deleted', binary: 'Binary', untracked: 'Untracked' },
  renamedFrom: (old: string) => `Renamed from ${old}`,
  fileHeader: (path: string, kind: string) => `${path} · ${kind}`,
  untrackedNote: 'Untracked file · not in the diff',
  unified: 'Unified',
  split: 'Split',
  wrap: 'Wrap',
  hunkOf: (index: number, count: number) => `Showing hunk ${index} of ${count}`,
  previousHunk: 'Previous hunk',
  nextHunk: 'Next hunk',
  previousFile: 'Previous file',
  nextFile: 'Next file',
  openFile: 'Open file ↗',
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
// the dirty mark, the close sheet and Changed on disk; the merge view's, the conflict blocks' and the gutter's are M3's.
export const EDITOR_COPY = {
  save: 'Save', saving: 'Saving…', unsaved: 'Unsaved changes',
  saveFailed: (message: string) => `Could not save: ${message}`,
  changedOnDisk: 'Changed on disk', reload: 'Reload', keepMine: 'Keep mine', compare: 'Compare',
  conflictOnSave: 'Changed on disk since you opened it',
  changesFromDisk: (n: number) => `${n} ${n === 1 ? 'change' : 'changes'} from disk`,
  keepMineChunk: 'Keep mine', takeTheirs: 'Take theirs', previousChange: 'Previous change', nextChange: 'Next change',
  conflicts: (n: number) => `${n} ${n === 1 ? 'conflict' : 'conflicts'}`,
  acceptMine: 'Accept mine', acceptTheirs: 'Accept theirs', acceptBoth: 'Accept both',
  mineLabel: (name: string | null) => (name ? `mine (${name})` : 'mine'), theirsLabel: (name: string | null) => (name ? `theirs (${name})` : 'theirs'), base: 'base',
  previousConflict: 'Previous conflict', nextConflict: 'Next conflict',
  closeTitle: (name: string) => `Save changes to ${name}?`, closeBody: 'Your changes will be lost if you don’t save them.', dontSave: 'Don’t save',
  readOnly: { head: 'Read-only: the file is larger than the editor’s cap', encoding: 'Read-only: the file is not UTF-8', loading: 'Read-only until the file has loaded' },
  comment: (line: number) => `Comment on line ${line}`,
  anchorTitle: (label: string) => `Comment on ${label}`, anchorBody: 'The comment composer arrives with side threads (E3). This anchor will open it:', close: 'Close',
} as const;
