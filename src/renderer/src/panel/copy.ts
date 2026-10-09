// Every sentence the panel host shows (C8a execution document, Interfaces *Copy*; the exact strings are decisions).
// M2 adds the summary's section copy here.
export const COPY = {
  home: 'Session overview',
  add: 'Add a tool',
  addNoSession: 'Open a session to add a tool',
  noTools: 'No tools registered yet',
  allOpen: 'Every tool is already open here', // every registered tool is single-instance and has a tab in the shown scope
  footer: 'Tools stay with this session. Pin a tab to keep it with you as you switch.',
  pin: (title: string) => `Pin ${title}`,
  unpin: (title: string) => `Unpin ${title}`,
  close: (title: string) => `Close ${title}`,
} as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The summary card (Interfaces *Copy*).
export const SUMMARY_COPY = {
  title: 'Session overview',
  sections: { environment: 'Environment', push: 'Push state', subagents: 'Subagents', background: 'Background work', sources: 'Sources', plugins: 'Plugins' /* R1 */, deliverables: 'Deliverables' /* E2 */ },
  // Environment
  branch: (branch: string) => `⎇ ${branch}`,
  detached: (head: string) => `detached at ${head.slice(0, 7)}`,
  notRepository: 'Not a git repository',
  gitUnavailable: 'Git unavailable',
  pending: '…', // git has not answered yet; the change line while its diff has not
  clean: 'Clean',
  across: (files: number) => `across ${plural(files, 'file')}`,
  untracked: (n: number) => ` · ${n} untracked`,
  binary: (n: number) => ` · ${n} binary`,
  changeUnavailable: 'Change unavailable',
  modelUnknown: 'model unknown', // W9 (H4): the row names the model by its alias (`<alias> <effort>`, the composer chip's words)
  review: 'Review',
  sessionInfo: 'Session info',
  engineVersion: (version: string) => `Claude Code ${version}`, // W13: the version the session last ran on
  // Push state
  notPushed: 'Not pushed',
  ahead: (n: number, upstream: string) => `${n} ahead of ${upstream}`,
  upToDate: (upstream: string) => `Up to date with ${upstream}`,
  behind: (n: number) => ` · ${n} behind`,
  openOnGitHub: 'Open on GitHub',
  // E6 start: the push-state row's PR line (E6 execution document, Design §6) and the push text that opens the tool
  openSourceControl: 'Open Source control',
  prUntrusted: 'Trust this folder to see PR state',
  ghMissing: 'GitHub CLI not installed',
  install: 'Install',
  ghSignedOut: 'GitHub CLI not signed in',
  signIn: 'Sign in',
  noPr: (branch: string) => `No PR for ${branch}`,
  prNumber: (n: number) => `PR #${n}`,
  prState: { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' },
  reviewDecision: { APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested' } as Record<string, string | undefined>,
  // gh's buckets in the order the line counts them
  checkBuckets: [['pass', 'passed'], ['fail', 'failed'], ['cancel', 'cancelled'], ['pending', 'pending'], ['skipping', 'skipped']] as const,
  noChecks: 'No checks reported yet',
  checksUnavailable: 'Checks unavailable',
  prUnavailable: (reason: string) => `PR state unavailable · ${reason}`,
  refreshPrState: 'Refresh PR state',
  checkedAt: (time: string) => `Checked ${time}`,
  // E6 end
  // Subagents and Background work
  open: 'Open',
  agents: (working: number, done: number) => `${working} working · ${done} done`,
  noAgents: 'No subagents yet',
  background: (counts: { shells: number; workflows: number; monitors: number; other: number }) =>
    [
      counts.shells && plural(counts.shells, 'shell'),
      counts.workflows && plural(counts.workflows, 'workflow'),
      counts.monitors && plural(counts.monitors, 'monitor'),
      counts.other && `${counts.other} other`,
    ]
      .filter(Boolean)
      .join(' · ') || 'Nothing running',
  runsOnDisk: (n: number) => `${plural(n, 'workflow run')} on disk`,
  shellsUnavailable: 'Shells and monitors are known only while the session runs here',
  // Sources
  noSources: 'No sources yet',
  openSession: 'Open the session to list its sources',
  loading: 'Loading…',
  sourcesUnavailable: 'Sources unavailable', // the transcript's hydration failed (C6's phase 'failed')
  sourceOnly: 'Source only',
  // Plugins (E8 D-9): the plugins the session loaded, beside Reload plugins and Reload skills
  pluginsLoaded: (n: number) => `Plugins · ${n} loaded`,
} as const;

// A tab or a summary button whose tool the host has no registration for: a restored tab before its tool registers, or a
// tool id no build registers any more.
export const unavailable = (toolId: string): string => `${toolId} is not available`;
