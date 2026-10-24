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
  // M6b: the panel summary's Artifacts section
  summary: (n: number, latestTitle: string) => `${n} ${n === 1 ? 'artifact' : 'artifacts'} · ${latestTitle}`,
  nothingYet: 'Nothing made yet',
  open: 'Open',
} as const;

// P4-B3 (its Decision Log 18, 20, 21; the prior art's M1 to M5, Z7): moving an artifact between the panel and a main tab.
// The actions' names follow VS Code's "Move Terminal into Panel"; the drop labels name the outcome (Codex's words).
export const TRANSFER_COPY = {
  moveToPanel: 'Move to side surface',
  moveToTab: 'Move to tab', // the record bar's button (it was "Open in tab"; a move since P3-F wave S, F16)
  moveToMain: 'Move to main area', // the panel's Artifacts tab's context menu
  openInSplit: 'Open in split',
  grip: 'Drag to move to a tab',
  // the refusals
  notArtifact: 'Only an artifact moves to the panel',
  noPanel: 'No session’s panel to show it in',
  noProjectSession: 'Open a session in this project to show it beside the chat',
  loading: 'Loading…',
  noRecord: 'The panel shows no artifact',
  closing: 'The panel tab is closing',
} as const;
