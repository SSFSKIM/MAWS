// Every sentence the panel's Artifacts tool shows (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M5). The kinds'
// names, the "Edited … by …" line and the record view's notices are the library's (`library/copy.ts`).

export const ARTIFACTS_TOOL_COPY = {
  title: 'Artifacts',
  scopeLabel: 'Show artifacts of',
  scopes: { session: 'This session', all: 'All' },
  openLibrary: 'Open library',
  noSession: 'Open a session to see its artifacts',
  emptySession: 'Nothing made in this session yet. The pages, documents and files its agent makes land here.',
  emptyAll: 'No artifacts yet.',
  reading: 'Reading…',
  couldNotList: (message: string) => `Couldn’t read the artifacts: ${message}`,
  couldNotRefresh: (message: string) => `Couldn’t refresh the artifacts: ${message}`, // the last good list stays below
  retry: 'Try again',
  back: 'Back',
  openInTab: 'Open in tab',
} as const;
