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
  // The word cut (T316): a link's row reads its arrow and target; its kind's words stay for a screen reader
  symlink: (target: string | null) => `→ ${target ?? 'unknown target'}`,
  symlinkName: 'Symbolic link',
  empty: 'Empty directory',
  truncated: `Showing ${FILES_LIST_MAX_ENTRIES.toLocaleString('en-US')} of many entries`,
  // UX wave U6b-4b: a listing that failed reads the notice's sentences for a folder (NOTICE_COPY below)
  // UX wave U6b-1 (M3): the tree at the file's left, its button in the file's bar and its divider
  hideTree: 'Hide files',
  showTree: 'Show files',
  resizeTree: 'Resize files',
  // UX wave U6b-3a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md, "The sentences a person reads"):
  // the Changed group's heading, a folder's dot and an ignored entry for a screen reader, and the title of a row for an
  // entry outside the session's folders; a letter's words are Review's (`REVIEW_COPY.kinds`)
  changed: (count: number) => `Changed ${count.toLocaleString('en-US')}`,
  containsChanges: 'Contains changes',
  ignored: 'Ignored by git',
  outside: (path: string) => `${path} · Outside the folders this session works in`,
  // UX wave U6b-3b (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md, "The sentences a person reads"): the
  // field's placeholder and its accessible name; the list's lines; the label `disabledWords` words the offline line from
  // ("File search is unavailable while <machine> is offline.")
  goToFile: 'Go to file',
  noMatchingFiles: 'No matching files',
  searchingFiles: 'Searching files', // the word cut (N1): the finder's quiet spinner's name
  searchFailed: 'Files could not be searched.',
  fileSearch: 'file search',
} as const;

export const VIEWER_COPY = {
  source: 'Source',
  rendered: 'Rendered',
  wrap: 'Wrap',
  view: 'View', // the word cut (T305): the menu that holds Wrap, behind a glyph its word names
  openExternally: 'Open externally',
  // The word cut (T327, T328): a file MAWS does not draw reads its kind and its size on one line, above Open externally
  externalKind: (kind: string, bytes: number) => `${kind} · ${formatSize(bytes)}`,
  binary: (bytes: number) => `Binary · ${formatSize(bytes)}`,
  // The word cut (T322, T324): the two sizes, a head's notice beside Load more and the tip of a long file's arrival ring,
  // whose name keeps `continuing`
  sizes: (part: number, bytes: number) => `${formatSize(part)} of ${formatSize(bytes)}`,
  loadMore: 'Load more',
  loading: 'Loading', // the word cut (T302): the quiet spinner's name
  continuing: (loaded: number, bytes: number) => `Loading ${formatSize(loaded)} of ${formatSize(bytes)}`,
  noSession: 'No session grants access to this file',
  removed: 'File removed',
  updated: 'Updated',
  refused: (message: string) => `Refused: ${message}`,
  notOpened: (message: string) => `Not opened: ${message}`,
  // UX wave U6e (§D): the label of a file that cannot be saved, and a savable outside file's path's tooltip and description
  readOnly: 'Read-only',
  savesTo: (real: string) => `Save writes to ${real}`,
  // UX wave U6f (docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, §E; decisions 12 and 18,
  // Decision Log 20): a savable outside file of a session on another machine, and a file there inside a folder macOS protects
  savesToOn: (real: string, machine: string) => `Save writes to ${real} on ${machine}`,
  protectedThere: (machine: string) => `This file is in a folder macOS protects on ${machine}. Opening it may show a privacy prompt on ${machine}’s own screen.`,
  openIt: 'Open it',
  protectedThrough: (machine: string) => `This path goes through a link into another folder macOS protects on ${machine}. Choose the file with Open File… to open it.`,
  // P2-F W-V (L95): an image's or a video's sizing controls
  zoom: 'Zoom',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  actualSize: 'Actual size',
  fit: 'Fit',
  zoomPercent: (scale: number) => `${Math.round(scale * 100)}%`,
  // UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, "The sentences a person reads"): a
  // framed file's failure body and its button, the line under an HTML page's bar, and the row's sentence per reason
  frameStopped: 'This file stopped loading.', // the word cut (N12): no guess at the cause
  openAgain: 'Open again',
  besideFiles: 'Shown without the files beside it',
  tooLargeHere: 'Too large to show here', // the word cut (N14): the file's size under it is the fact
  videoUnplayable: 'This video can’t be played here.',
  soundUnplayable: 'This sound can’t be played here.',
  olderService: 'This file can’t be shown here yet.', // the word cut (N15): Open externally under it is the way out
} as const;

// The word cut (T336): the ⌘F find bar's controls as conventional glyphs, through the editor library's own phrases
// (`glyphs`, keyed by its phrase); each keeps its word as its accessible name and its tooltip (`words`, keyed by the
// control's `name`). "all", "replace" and "replace all" keep the library's words.
export const FIND_COPY = {
  glyphs: { next: '↓', previous: '↑', 'match case': 'Aa', regexp: '.*', 'by word': 'ab|' },
  words: { next: 'Next match', prev: 'Previous match', case: 'Match case', re: 'Regular expression', word: 'By word' },
} as const;

// UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, "The sentences a person reads"; decisions 9
// and 19): the notice of a file that cannot be read and of a folder that cannot be listed, by cause (`viewer/notice.ts`).
// A folder's forms are the Files list's. No sentence says who may open a file on a machine.
type Subject = 'file' | 'folder';
export const NOTICE_COPY = {
  outside: { file: 'This file is outside the folders this session works in.', folder: 'This folder is outside the folders this session works in.' },
  outsideOn: (subject: Subject, machine: string) => `This ${subject} is outside the folders this session works in on ${machine}.`,
  chooseIt: 'Choose it with File ▸ Open File…', // the word cut (N7): the way in, without how the app opens files
  // board ticket 848: the agent no longer sends a file; a copy inside the session's folders opens on every machine
  askAgent: 'Ask the agent to copy the file into this session’s folders to see it here.',
  notFound: (subject: Subject, machine: string | null) => `No ${subject} at this path${machine === null ? '' : ` on ${machine}`}.`,
  unreachableHere: "MAWS's service on this Mac is not answering.",
  unreachable: (machine: string) => `${machine} is not reachable.`,
  notOnRecord: (machine: string) => `${machine} does not have this session on record right now.`,
  noAccess: (machine: string) => `Your access to this session on ${machine} does not include its files.`,
  other: { file: 'This file could not be opened.', folder: 'This folder could not be listed.' },
  retry: 'Retry',
  copyPath: 'Copy path',
  copied: 'Copied', // the Copy path button's words for a moment after it copied (fix wave 1)
  copyFailed: "Couldn't copy the path", // … after the clipboard refused, or with none (as the agents' log says it)
} as const;

// A count as Review prints it, with the thousands separator (UX wave U5b, §I); English throughout, as the app's other counts.
const count = (n: number) => n.toLocaleString('en-US');

export const REVIEW_COPY = {
  title: 'Review',
  noSession: 'Open a session to review its changes',
  scopes: { uncommitted: 'Uncommitted', branch: 'This branch', turn: 'Last turn', staged: 'Staged', commit: 'Commit' }, // UX wave U5b-2: a commit's chip reads `commitChip`
  commitChip: (sha: string) => `Commit ${sha.slice(0, 7)}`, // UX wave U5b-2 (§I): a commit's chip, its title the subject
  // UX wave U5b (§I; card 1 at its default, built in `totalsWords`): the totals without the scope's name, which the
  // pressed chip above them says; the word cut (T356): nor "changed", which the totals already are.
  totals: (files: number, added: number, removed: number) => `${count(files)} ${files === 1 ? 'file' : 'files'} · +${count(added)} −${count(removed)}`,
  // UX wave U5b-2 (§I): after the totals, the new files whose lines are not counted (the word cut, N35: shortened)
  uncounted: (n: number) => ` · ${count(n)} untracked not counted`,
  // A greyed chip's reason, its tooltip and description. The word cut (P288): Staged greyed once the index matches HEAD
  // again says so in a person's words.
  nothingStaged: 'Nothing staged',
  // UX wave U5b-2 (§I): This branch off, with no default branch, or on a machine whose MAWS does not serve the reads (the
  // word cut, N38: this Mac's form in the other machine's words)
  noDefaultBranch: 'No default branch to compare with',
  branchNeedsReads: (machine: string | null) => `This branch needs a newer MAWS on ${machine ?? 'this Mac'}`,
  noTurnChangedFiles: 'No turn has changed files yet', // UX wave U5b (l5-code-12 c): Last turn is always listed
  // Empty scopes: the word cut (T362, N40) says "No changes" for every scope but This branch, the pressed chip naming the
  // scope (a commit's chip the commit)
  noChanges: 'No changes',
  nothingOnBranch: (branch: string, base: string) => `Nothing on ${branch} beyond ${base}`,
  // A file's section (UX wave U5b, §F and §I): a kind's badge (none for a modified file), its counts, its body
  kinds: { modified: 'Modified', added: 'Added', deleted: 'Deleted', renamed: 'Renamed', binary: 'Binary', untracked: 'Untracked', conflict: 'Conflict' },
  renamedFrom: (old: string) => `Renamed from ${old}`,
  renamed: (old: string, now: string) => `${old} → ${now}`, // a rename whose two paths fit whole
  added: (n: number) => `+${count(n)}`,
  removed: (n: number) => `−${count(n)}`,
  binaryFile: 'Binary file', // the word cut (N44): only where the header's badge does not say Binary (an untracked binary)
  retry: 'Retry',
  // A file held still under an open comment card while the agent changed it (UX wave U5b, M5; §G, §I)
  fileChanged: 'This file changed',
  lineLeftDiff: 'The line this comment was on is no longer in this diff.', // over the comments whose line left the diff (M5; D11, Decision Log 20 and 21)
  fileNotInScope: 'The file this comment is on is not in this diff.', // over the comments whose file the scope does not hold, or whose scope has no files (Decision Log 21)
  // UX wave U5b-2 (§G, §I; Decision Log 37): over a comment made on a commit, in any scope but that commit's; the short hash is
  // drawn as a button that opens the commit at the comment's file (`UnplacedComments`)
  onCommit: (sha: string) => `This comment is on commit ${sha.slice(0, 7)}.`,
  notOnThisCommit: 'This comment is not on this commit.', // UX wave U5b-2 (§G, §I; Decision Log 39): over the comments made on no commit, in a commit's scope; no link
  diffNotShown: "This file's diff is not shown here.", // over the comments whose file is in the scope while the surface draws no lines for it: its own read failed, or it is too large to draw (Decision Log 21)
  refresh: 'Refresh',
  untrackedFolder: 'Untracked folder', // the word cut (T361): an untracked folder's body, which today's note called a file
  // The toolbar (UX wave U5b, §F): Collapse all and the View menu, which holds the stack's Unified, Split and Wrap
  collapseAll: 'Collapse all',
  expandAll: 'Expand all',
  view: 'View',
  unified: 'Unified',
  split: 'Split',
  splitNeedsRoom: 'Split needs a wider column',
  wrap: 'Wrap',
  // The word cut (T306): the counter reads `hunkCount` at every width, `hunkOf` its name and tooltip
  hunkOf: (index: number, total: number) => `Hunk ${count(index)} of ${count(total)}`,
  hunkCount: (index: number, total: number) => `${count(index)} / ${count(total)}`,
  previousHunk: 'Previous hunk',
  nextHunk: 'Next hunk',
  openFile: 'Open file ↗',
  openFileGlyph: '↗', // "Open file ↗" in a narrow header (card 2), its words the tooltip
  markViewed: 'Mark viewed',
  viewed: 'Viewed',
  tooLarge: 'Diff too large to display.',
  openTheFile: 'Open the file', // follows `tooLarge` in one sentence: `Diff too large to display. Open the file`
  // What a scope reads: the faint line at Review's foot until the word cut (T357, N51, N52), which moves it to the pressed
  // chip's tooltip and description, or the totals line's in a diff tab, which has no chips. A commit's chip says its hash,
  // so its words are the subject, then `firstParent` for a merge commit; a diff tab's are `commit` before them.
  scopeWords: {
    uncommitted: (branch: string) => `${branch} · Working tree against HEAD`,
    branch: (branch: string, base: string) => `${branch} · Since ${base}`,
    staged: (branch: string) => `${branch} · Index against HEAD`,
    turn: (branch: string | null) => (branch === null ? 'Changes from the turn' : `${branch} · Changes from the turn`),
    commit: (sha: string) => `Commit ${sha.slice(0, 7)}`, // UX wave U5b-2 (§I; D8); ` · ` and the subject follow once read
    firstParent: ' · against its first parent', // a merge commit
  },
  // The one word of the foot that stays at rest (N53): a commit HEAD no longer holds; `not in HEAD` on a detached HEAD
  notOnBranch: (branch: string | null) => (branch === null ? 'Not in HEAD now' : `Not on ${branch} now`),
  detachedAt: (head: string) => `detached at ${head.slice(0, 7)}`,
  notRepository: 'Not a git repository',
  unavailable: (message: string) => `Diff unavailable: ${message}`,
  // UX wave U5b-2 (§H's refusals told apart, for a commit's diff; §I): `null` names this Mac's service
  // The word cut: this Mac's form (N54) and a refusal (N56) without the wire's words
  commitNeedsReads: (machine: string | null) => (machine === null ? 'Diff unavailable: this Mac’s MAWS needs updating' : `Diff unavailable: ${machine} runs an older MAWS`),
  commitOffline: (machine: string) => `Diff unavailable: ${machine} is offline`,
  commitRefused: (machine: string) => `Diff unavailable: ${machine} refused it`,
  refused: (message: string) => `Refused: ${message}`, // a diff tab's path outside the session's directories
  unknownRef: 'unknown ref',
  turnNotLoaded: 'the turn is not loaded · Open the session',
  loading: 'Loading', // the word cut: the quiet spinner's name, where the list, a file's diff or its body is read
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
    // the word cut (T343): the fact, shortened
    head: 'Changed on disk · too large to merge',
    binary: 'Changed on disk · not text, can’t merge',
    encoding: 'Changed on disk · not UTF-8, can’t merge',
  },
  changesFromDisk: (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`, // the word cut (T342): the count beside ↑ ↓
  keepMineChunk: 'Keep mine', takeTheirs: 'Take theirs', previousChange: 'Previous change', nextChange: 'Next change',
  conflicts: (n: number) => `${n} ${n === 1 ? 'conflict' : 'conflicts'}`,
  acceptMine: 'Accept mine', acceptTheirs: 'Accept theirs', acceptBoth: 'Accept both',
  mineLabel: (name: string | null) => (name ? `mine (${name})` : 'mine'), theirsLabel: (name: string | null) => (name ? `theirs (${name})` : 'theirs'), base: 'base',
  previousConflict: 'Previous conflict', nextConflict: 'Next conflict',
  closeTitle: (name: string) => `Save changes to ${name}?`, closeBody: 'Your changes will be lost if you don’t save them.', dontSave: 'Don’t save', cancel: 'Cancel', // the sheet's own Cancel (SheetForm's), drawn by the locked question (U6e)
  readOnly: {
    outside: 'Read-only: the file is outside the folders this session works in', // UX wave U6c: a file the transcript names; U6e: a daemon of the parent pin's answer alone (W6)
    // UX wave U6e (§D): a file the daemon admits for a read and never for a save
    maws: 'Read-only: MAWS does not edit its own files',
    added: 'Read-only: this file is in the Library, not in this session’s folders. Choose it with File ▸ Open File… to edit it',
    result: 'Read-only: only a tool’s output names this file in this conversation. Choose it with File ▸ Open File… to edit it',
    // UX wave U6b-4c (Q2, R4): a file opened through a link in a Markdown file that is itself read-only for the session
    linked: 'Read-only: the file that links this one is read-only in this conversation. Choose it with File ▸ Open File… to edit it',
    head: 'Read-only: the file is larger than the editor’s cap',
    encoding: 'Read-only: the file is not UTF-8',
    loading: 'Read-only until the file has loaded',
    // UX wave U6f (§E; decision 12's third column): an outside file of a session on another machine this person may not
    // save there, with the sentence of the window's helper
    elsewhere: (words: string) => `Read-only: ${words}`,
  },
  // The word cut (N16 to N20): the sentence of the panel "Read-only" opens, and the button's description; the button says
  // "Read-only" already, and the panel's Open File… under the sentence is the way to edit (the editor's title keeps
  // `readOnly`'s words). A file of another machine's (`elsewhere`) is the standing's sentence alone.
  readOnlyPanel: {
    outside: 'The file is outside the folders this session works in',
    maws: 'MAWS does not edit its own files',
    added: 'This file is in the Library, not in this session’s folders.',
    result: 'Only a tool’s output names this file in this conversation.',
    linked: 'The file that links this one is read-only in this conversation.',
  },
  comment: (line: number) => `Comment on line ${line}`,
  anchorTitle: (label: string) => `Comment on ${label}`, close: 'Close', // the word cut (T352): the placeholder sheet has no build-plan sentence
  // M5: the quit-when-idle banner's part (the quit question's own words are main's, in quit-guard.ts)
  unsavedFilesPart: (n: number) => `${n} unsaved ${n === 1 ? 'file' : 'files'}`,
  // UX wave U6e (§D, decision 18): an outside save's failure, after "Could not save: "
  outsideRefused: 'MAWS may no longer write this file for this session. Choose it with File ▸ Open File… to save it',
  outsideUnavailable: 'a file outside the session’s folders can’t be saved yet. Try again in a moment', // the word cut (N25)
} as const;

// UX wave U6e (§D): Open File…, in the File menu's row, the Files list's menu and the Read-only panel.
export const OPEN_FILE_COPY = {
  row: 'Open File…', // the menu row and the panel's button
  elsewhere: (machine: string) => `Open File… (this session runs on ${machine})`,
  // the word cut (N26, N27): the reason alone, without the action's name
  notAFile: 'A folder or an app’s package cannot be opened here.',
  unavailable: 'Could not open the file. Try again in a moment.',
} as const;

// UX wave U6f (§E; Card 1 as the owner answered it): the chooser MAWS draws for Open File… when the files are on another
// machine.
export const REMOTE_CHOOSER_COPY = {
  title: (machine: string) => `Open a file on ${machine}`,
  go: 'Go', up: '..', more: 'More…', open: 'Open', cancel: 'Cancel', back: 'Back', retry: 'Try again',
  private: 'private', link: 'link',
  reading: 'Reading the folders', // the word cut (N30): the quiet spinner's name; (N32) no foot line under the list
  empty: 'Nothing here',
  openPrivate: (folder: string, machine: string) => `Open ${folder} on ${machine}? macOS protects this folder, and opening it may show a privacy prompt on ${machine}’s own screen.`,
  unreadable: (machine: string) => `MAWS on ${machine} cannot read this folder.`,
  noAnswer: (machine: string) => `${machine} has not answered yet.`,
  unreachable: (machine: string) => `${machine} is not reachable.`,
  nothingThere: (machine: string) => `There is no file or folder at that path on ${machine}.`,
  notAFile: 'A folder or an app’s package cannot be opened here.', // U6e's sentence (the word cut, N34)
} as const;
