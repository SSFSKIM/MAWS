// Every sentence Source control's page shows (UX wave U5b-2, M10; §H and §I of
// docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md; exact strings are decisions). Where the
// Environment card already words a fact, the page says it in the card's words (`SUMMARY_COPY`). The acting pane's words
// (E6 execution document, Design §5 and §8), its groups and sheets and the display helpers `shellWords` and
// `destinationLabel`, left with its files in M11.
import { formatCount } from '@shared/app/date-format';

export const SCM_COPY = {
  title: 'Source control',
  noSession: 'Open a session to see its changes',
  loading: 'Loading',
  notRepository: 'Not a git repository', // C8a's sentence
  gitUnavailable: (message: string) => `Git unavailable: ${message}`,
  branch: (branch: string) => `⎇ ${branch}`,
  detached: (head: string) => `detached at ${head.slice(0, 7)}`,
  behind: (n: number) => `${n} behind`,
  // UX wave U5b-2 (M10): the page. Counts print with the locale's thousands separator (§I).
  count: (n: number) => formatCount(n),
  worktree: 'worktree',
  offline: 'offline',
  uncommitted: 'Uncommitted',
  review: 'Review ›',
  conflicts: (n: number) => `· ${formatCount(n)} ${n === 1 ? 'conflict' : 'conflicts'}`, // frames' S14
  commitsPart: 'Commits',
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
