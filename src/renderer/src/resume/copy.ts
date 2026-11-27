// The resume chooser's words (P2-D). Claude Desktop 2.16120.0's picker where it has one
// (readable/app-2.16120.0/web/app/v1/cc43287c9-ua-2O55p.js:34583-34794, 34961-35044), the CLI's toggle names otherwise.
export const RESUME_COPY = {
  title: 'Resume session', // the dialog's accessible title (its hosts'); not drawn (the word cut, C155)
  close: 'Close',
  search: 'Search by title, folder, or branch', // the search field's accessible name; its placeholder is `placeholder`
  placeholder: 'Search sessions', // the word cut (C156)
  filters: 'Scope',
  toggles: { allProjects: 'All projects', currentBranch: 'Current branch', allWorktrees: 'All worktrees', archived: 'Archived' },
  allProjects: 'All projects',
  list: 'Sessions',
  none: 'No sessions',
  noMatch: 'No sessions match',
  more: (shown: number, all: number) => `${shown.toLocaleString('en-US')} of ${all.toLocaleString('en-US')}`, // the word cut (C159): the count
  archived: 'Archived',
  legend: { move: 'navigate', open: 'open', newTab: 'new tab', close: 'close' },
  facts: { folder: 'Folder', worktree: 'Worktree' /* ticket 815 */, branch: 'Branch', project: 'Project', lastActive: 'Last active', lastAnswer: 'Last answer', machine: 'Machine' /* P5 O7 M8 */ },
  where: 'Where you left off',
  loading: 'Loading preview…',
  failed: 'Couldn’t load the preview.',
  empty: 'No messages yet.',
  nothing: 'Nothing to preview.',
  earlier: 'Earlier messages not shown',
  toolCalls: (n: number) => `${n} tool call${n === 1 ? '' : 's'}`,
};
