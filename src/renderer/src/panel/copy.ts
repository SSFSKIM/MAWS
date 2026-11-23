// Every sentence the panel host shows (C8a execution document, Interfaces *Copy*; the exact strings are decisions).
// M2 adds the summary's section copy here.
export const COPY = {
  add: 'Add a tool',
  addNoSession: 'Open a session to add a tool',
  noTools: 'No tools registered yet',
  allOpen: 'Every tool is already open here', // every registered tool is single-instance and has a tab in the shown scope
  footer: 'Tools stay with this session. Pin a tab to keep it with you as you switch.',
  pin: (title: string) => `Pin ${title}`,
  unpin: (title: string) => `Unpin ${title}`,
  close: (title: string) => `Close ${title}`,
  // the word cut (P11): a tab glyph's tooltip is its verb alone; its accessible name above keeps the tab's title
  pinTip: 'Pin',
  unpinTip: 'Unpin',
  closeTip: 'Close',
  // the word cut (P8): what pins a tab for every session, in an icon's menu and an unavailable tab's submenu
  pinTab: 'Pin tab',
  unpinTab: 'Unpin tab',
  // UX wave U8b (its execution document, Interfaces §F): the control at the strip's right end, and an icon's context menu
  hideColumn: 'Hide side column',
  hideSurface: 'Hide surface',
  // M3: a tab's menu, and the bar between the two groups
  moveBelow: 'Move below',
  moveAbove: 'Move above',
  resizeGroups: 'Resize groups',
} as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The summary card (Interfaces *Copy*).
export const SUMMARY_COPY = {
  title: 'Session overview',
  sections: { environment: 'Environment', push: 'Push state', subagents: 'Agents', background: 'Background' /* UX wave U8b (M8): the card takes the tool's name; the word cut (P66, P72) */, sources: 'Sources', plugins: 'Plugins' /* R1 */, artifacts: 'Artifacts' /* E2's Deliverables; P3-L M6b */ },
  // Environment
  movedFrom: (name: string) => `moved from ${name}`, // UX wave U8c-2 (§H): the launch folder's last segment, while the agent works elsewhere
  branch: (branch: string) => `⎇ ${branch}`,
  detached: (head: string) => `detached at ${head.slice(0, 7)}`,
  notRepository: 'Not a git repository',
  gitUnavailable: 'Git unavailable',
  pending: '…', // git has not answered yet; the change line while its diff has not
  clean: 'Clean',
  // the word cut (P36): the change line is its counts and its files, "+12 −3 · 4 files"; the untracked and binary counts
  // are its tooltip, "2 untracked · 1 binary" (empty when there are none)
  files: (files: number) => `· ${plural(files, 'file')}`,
  uncounted: (untracked: number, binary: number) => [untracked > 0 && `${untracked} untracked`, binary > 0 && `${binary} binary`].filter(Boolean).join(' · '),
  changeUnavailable: 'Change unavailable',
  modelUnknown: 'model unknown', // W9 (H4): the row names the model by its alias (`<alias> <effort>`, the composer chip's words)
  sessionInfo: 'Session info',
  openChanges: 'Open changes', // UX wave U8b (l5-code-16): the change line's accessible name; its counts are its description
  // Push state
  notPushed: 'Not pushed',
  ahead: (n: number, upstream: string) => `${n} ahead of ${upstream}`,
  upToDate: (upstream: string) => `Up to date with ${upstream}`,
  behind: (n: number) => ` · ${n} behind`,
  behindOnly: (n: number, upstream: string) => `${n} behind ${upstream}`, // nothing ahead (the word cut: the ↓N mark's name)
  // the word cut (P39): the push row's marks, "↑2 ↓1"; the sentences above are their name and tooltip
  aheadMark: (n: number) => `↑${n}`,
  behindMark: (n: number) => `↓${n}`,
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
  // UX wave U8b (M8; its execution document, Interfaces §F): the two cards for running work, their heading's count, the
  // overflow that opens the panel and the tail that opens its Done
  running: (n: number) => `${n} running`, // the word cut (P67): the heading's bare count's meaning, its name and tooltip
  more: (n: number) => `${n} more`,
  finished: (n: number) => `${n} finished`,
  // Sources
  noSources: 'No sources yet',
  openSession: 'Open the session to list its sources',
  loading: 'Loading…',
  sourcesUnavailable: 'Sources unavailable', // the transcript's hydration failed (C6's phase 'failed')
  sourceOnly: 'Source only', // the word cut (P58): a connector tool row's tooltip
  // Plugins (E8 D-9): the plugins the session loaded, beside Reload plugins and Reload skills
  pluginsLoaded: (n: number) => plural(n, 'plugin'), // the word cut (P65): "3 plugins", its age only when it is not now
  // the word cut (P63): the Connectors card's two buttons, the first named in full; greyed, each says why
  manage: 'Manage…',
  manageName: 'Manage connectors…', // the accessible name the shorter label stands for
  pluginsButton: 'Plugins…',
  manageUnavailable: 'Open the session to manage its connectors',
  pluginsUnavailable: 'Open the session to manage its plugins',
} as const;

// A tab or a summary button whose tool the host has no registration for: a restored tab before its tool registers, or a
// tool id no build registers any more.
export const unavailable = (toolId: string): string => `${toolId} is not available`;
