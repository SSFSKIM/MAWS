// Every sentence the Source control tool shows (E6 execution document, Design §5 and §8; exact strings are decisions).
// M3 holds the body's, the commit form's and the Discard sheet's; M4 the header's remote actions, the Push and PR
// sheets', the Output's, and the display helpers `shellWords` and `destinationLabel`. UX wave U5b-2 (M10; §H and §I of
// docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md) adds the page's words at the end; the acting
// pane's leave with its files in M11. Where the Environment card already words a fact, the page says it in the card's
// words (`SUMMARY_COPY`).
import { formatCount } from '@shared/app/date-format';
import type { ScmChange, ScmGroupName } from './groups';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const SCM_COPY = {
  title: 'Source control',
  noSession: 'Open a session to see its changes',
  loading: 'Loading',
  notRepository: 'Not a git repository', // C8a's sentence
  gitUnavailable: (message: string) => `Git unavailable: ${message}`,
  untrusted: 'MAWS runs git here only after you trust the folder in a session',
  statusFailed: (message: string) => `Source control unavailable: ${message}`, // scm.status failed: the actions stay off
  // The header line
  branch: (branch: string) => `⎇ ${branch}`,
  detached: (head: string) => `detached at ${head.slice(0, 7)}`,
  noUpstream: 'no upstream',
  ahead: (n: number) => `${n} ahead`,
  behind: (n: number) => `${n} behind`,
  // The groups
  groups: { conflicts: 'Conflicts', staged: 'Staged', unstaged: 'Unstaged', untracked: 'Untracked' } satisfies Record<ScmGroupName, string>,
  stageAll: 'Stage all',
  unstageAll: 'Unstage all',
  discardAll: 'Discard all…',
  deleteAll: 'Delete all…',
  stageAllLabel: { unstaged: 'Stage all unstaged changes', untracked: 'Stage all untracked files' },
  discardAllLabel: 'Discard all unstaged changes',
  deleteAllLabel: 'Delete all untracked files',
  // A row's actions, each named with its file
  stage: (path: string) => `Stage ${path}`,
  unstage: (path: string) => `Unstage ${path}`,
  discard: (path: string) => `Discard changes to ${path}`,
  delete: (path: string) => `Delete ${path}`,
  markResolved: (path: string) => `Mark ${path} resolved`,
  open: (path: string) => `Open ${path}`,
  // What a row's letter stands for, and the diff header's words
  changes: {
    modified: 'Modified',
    added: 'Added',
    deleted: 'Deleted',
    renamed: 'Renamed',
    copied: 'Copied',
    'type-changed': 'Type changed',
    untracked: 'Untracked',
    'both-modified': 'Both modified',
    'both-added': 'Both added',
    'both-deleted': 'Both deleted',
    'added-by-one-side': 'Added by one side',
    'deleted-by-one-side': 'Deleted by one side',
  } satisfies Record<ScmChange, string>,
  letters: {
    modified: 'M',
    added: 'A',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
    'type-changed': 'T',
    untracked: 'U',
    'both-modified': '!',
    'both-added': '!',
    'both-deleted': '!',
    'added-by-one-side': '!',
    'deleted-by-one-side': '!',
  } satisfies Record<ScmChange, string>,
  renamedFrom: (old: string) => `Renamed from ${old}`,
  copiedFrom: (old: string) => `Copied from ${old}`,
  fileHeader: (path: string, change: string) => `${path} · ${change}`,
  // The diff body
  noChanges: 'No changes',
  selectFile: 'Select a file to see its changes',
  conflictNote: 'A merge conflict: resolve it in the file, then Mark resolved',
  directoryNote: 'An untracked directory: Stage adds every file in it',
  binary: 'Binary file',
  noContent: 'No content changes',
  noDiff: 'No diff for this entry',
  unavailable: (message: string) => `Diff unavailable: ${message}`,
  tooLarge: 'Diff too large to display.',
  openTheFile: 'Open the file',
  openFile: 'Open file ↗',
  unified: 'Unified',
  split: 'Split',
  wrap: 'Wrap',
  hunkOf: (index: number, count: number) => `Showing hunk ${index} of ${count}`,
  previousHunk: 'Previous hunk',
  nextHunk: 'Next hunk',
  // The notice line
  gitFailed: (detail: string) => `git failed: ${detail}`,
  failed: (message: string) => `Failed: ${message}`,
  showOutput: 'Output',
  dismiss: 'Dismiss',
  // The commit form
  commitMessage: 'Commit message',
  skipHooks: 'Skip hooks',
  noVerify: '--no-verify',
  commit: 'Commit',
  committing: 'Committing…',
  commitShortcut: '⌘Enter',
  commitBlocked: {
    untrusted: 'Trust the folder to commit',
    conflicts: 'Resolve the conflicts first',
    nothingStaged: 'Nothing staged',
    emptyMessage: 'Write a commit message',
  },
  lastCommit: (sha: string, subject: string) => `${sha.slice(0, 7)} · ${subject}`,
  // The Discard sheet (Design §8)
  discardTitle: 'Discard changes',
  deleteTitle: 'Delete untracked files',
  restores: (n: number) => `Restores ${plural(n, 'file')} to their staged content`,
  deletes: (n: number) => `Deletes ${plural(n, 'file')} git has never tracked`,
  discardAck: (n: number) => `Discard ${plural(n, 'change')}; this cannot be undone`,
  deleteAck: (n: number) => `Delete ${plural(n, 'file')}; this cannot be undone`,
  discardSubmit: 'Discard',
  deleteSubmit: 'Delete',
  // The header's remote actions (M4's decisions)
  push: 'Push',
  publish: 'Publish',
  openPr: 'Open PR',
  pushCommits: (n: number, upstream: string) => `Push ${plural(n, 'commit')} to ${upstream}`,
  publishBranch: (branch: string) => `Publish ${branch}`,
  nothingToPush: 'Nothing to push',
  pullFirst: 'Pull in a terminal first',
  noRemote: 'No remote to push to',
  noRemoteForPr: 'No remote to open a pull request on',
  trustToPush: 'Trust the folder to push',
  checkOutToPush: 'Check out a branch to push',
  openPrFor: (branch: string) => `Open a pull request for ${branch}`,
  pushFirst: 'Push first',
  trustToOpenPr: 'Trust the folder to open a pull request',
  checkOutToOpenPr: 'Check out a branch to open a pull request',
  prLink: (n: number) => `PR #${n} ↗`,
  prLinkLabel: (n: number) => `Open PR #${n} on GitHub`,
  // The Push and PR sheets (Design §8)
  pushSheetTitle: 'Push',
  prSheetTitle: 'Open pull request',
  planning: 'Preparing the command…',
  remote: 'Remote',
  destination: 'Destination',
  branchRow: 'Branch',
  branchTo: (branch: string, upstream: string) => `${branch} → ${upstream}`,
  setsUpstream: 'sets upstream',
  repointsUpstream: (from: string) => `sets upstream, re-pointing it from ${from}`,
  commitsRow: 'Commits',
  commits: (n: number) => plural(n, 'commit'),
  command: 'Command',
  runsIn: (cwd: string) => `Runs in ${cwd} with your login shell's environment and credential helpers.`,
  pushSubmit: 'Push',
  titleField: 'Title',
  bodyField: 'Body',
  baseField: 'Base',
  draftField: 'Draft',
  repository: 'Repository',
  headRow: 'Head',
  needTitle: 'Write a title',
  needBase: 'Name the base branch',
  prSubmit: 'Create pull request',
  installGh: 'Install the GitHub CLI ↗',
  signInGh: 'Sign in',
  // The Output disclosure (Design §5)
  output: 'Output',
  runKind: { push: 'Push', pr: 'Pull request' },
  remoteCommand: 'Remote command',
  running: 'Running…',
  done: 'Done',
  exited: (code: number) => `Exited with code ${code}`,
  stopped: (signal: string) => `Stopped (${signal})`,
  notStarted: 'Did not start',
  truncated: 'Output past 1 MiB was dropped',
  cancelRun: 'Cancel',
  cancelRunLabel: 'Cancel the running command',
  openCreatedPr: (n: number) => `Open PR #${n} ↗`,
  // UX wave U5b-2 (M10): the page. Counts print with the locale's thousands separator (§I).
  count: (n: number) => formatCount(n),
  worktree: 'worktree',
  offline: 'offline',
  uncommitted: 'Uncommitted',
  review: 'Review ›',
  conflicts: (n: number) => `· ${formatCount(n)} ${n === 1 ? 'conflict' : 'conflicts'}`, // frames' S14
  commits: 'Commits',
  since: (base: string) => `since ${base}`,
  latestOn: (branch: string) => `· latest on ${branch}`, // frames' S8: "Commits · latest on <branch>"
  latest: '· latest', // and on a detached HEAD, "Commits · latest"
  pushedTo: (upstream: string) => `Pushed to ${upstream}`,
  showAll: (n: number) => `Show all ${formatCount(n)} commits`, // frames' S1: 9 to 50
  showSome: (shown: number, n: number) => `Show ${formatCount(shown)} of ${formatCount(n)} commits`, // above 50
  olderNotShown: (m: number) => (m === 1 ? '1 older commit not shown' : `${formatCount(m)} older commits not shown`),
  showFewer: 'Show fewer', // card 3, as answered
  openCommit: (sha7: string) => `Open commit ${sha7} in Review`,
  commitTitle: (author: string, date: string, sha: string) => `${author}\n${date}\n${sha}`, // a row's tooltip
  age: (n: number, unit: 'm' | 'h' | 'd') => `${n}${unit}`, // "12m", "2h", "3d" (frames' S12): the one format
  commitsOlder: (machine: string | null) => (machine === null ? 'Commits unavailable: this Mac’s MAWS service is older than this window' : `Commits unavailable: ${machine} runs an older MAWS`),
  commitsOffline: (machine: string) => `Commits are unavailable while ${machine} is offline`,
  commitsRefused: (machine: string) => `Commits unavailable: ${machine} refused this read`,
  commitsFailed: (message: string) => `Commits unavailable: ${message}`,
  pullRequest: 'Pull request',
  prNumber: (n: number) => `#${n}`,
  into: (base: string) => `into ${base}`,
  readyToMerge: 'Ready to merge',
  conflictsWith: (base: string) => `Conflicts with ${base}`,
  behindBase: (base: string) => `Behind ${base}`,
  mergeBlocked: 'Merging is blocked',
  unknownMergeState: (value: string) => `GitHub reports a merge state MAWS does not know: ${value}`,
  checks: 'Checks',
  checkCount: (n: number, word: string) => `${formatCount(n)} ${word}`,
  openCheck: (name: string) => `Open ${name} on GitHub`, // the accessible name of a check's "↗", as `prLinkLabel` names the PR's
  checkLink: '↗',
  openOnGitHub: 'Open on GitHub ↗',
  on: (sentence: string, machine: string) => `${sentence} on ${machine}`, // the card's GitHub CLI sentences, naming the machine
  signInNeedsShell: (machine: string) => `Signing in needs shell access on ${machine}`, // decision 21; frames' S10
} as const;

// A command as a POSIX shell would read it, for display only: main spawns the plan's argv with no shell (Design §4), so
// this is the sheet's rendering of exactly those words. A word of only safe characters stays bare; anything else,
// the empty word included, is single-quoted whole (a `'` as `'\''`).
const BARE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;
const shellWord = (word: string) => (BARE_WORD.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`);
export function shellWords(program: string, argv: readonly string[]): string {
  return [program, ...argv].map(shellWord).join(' ');
}

// A push destination as the sheet names it (Design §8): a URL as host and path without its scheme and `.git`
// (`github.com/o/r`), an scp-like `user@host:path` the same way, a `file://` URL as its path, and a local path as it is.
// Main has stripped any user-info already (`withoutUserInfo`).
export function destinationLabel(url: string): string {
  const scheme = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(url);
  if (scheme) return scheme[1]!.toLowerCase() === 'file' ? scheme[2]! : scheme[2]!.replace(/\/$/, '').replace(/\.git$/, '');
  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(url);
  if (scp) return `${scp[1]}/${scp[2]!.replace(/\.git$/, '')}`;
  return url;
}
