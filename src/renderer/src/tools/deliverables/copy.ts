// Every sentence the Deliverables tool, its viewer, its tab and its summary show (E2 execution document, Design §13;
// the exact strings are decisions). The transcript's artifact row keeps its own in the transcript's copy (M5).

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const DELIVERABLES_COPY = {
  title: 'Deliverables',
  noSession: 'Open a session to see what it delivered',
  groups: { artifact: 'Artifacts', file: 'Files', screenshot: 'Screenshots' },
  scopes: { session: 'This session', all: 'All sessions' },
  scopeLabel: 'Show deliverables of',
  empty: 'Nothing delivered yet',
  loading: 'Loading…',
  back: 'Back',
  openInTab: 'Open in tab',
  openExternally: 'Open externally',
  reveal: 'Reveal in Finder',
  openAsFile: 'Open as file',
  reload: 'Reload',
  comment: 'Comment',
  versionLabel: 'Version',
  version: (n: number, latest: boolean) => (latest ? `v${n} · latest` : `v${n}`),
  artifactLine: (n: number, when: string) => `v${n} · ${when}`,
  missing: (path: string) => `Not on disk any more: ${path}`,
  notRecorded: (id: string) => `No deliverable ${id} in this session`,
  consoleErrors: (n: number) => plural(n, 'console error'),
  consoleWarnings: (n: number) => plural(n, 'console warning'),
  consoleLine: (line: number | null) => (line === null ? '' : `line ${line}`),
  couldNotList: "Couldn't read this session's deliverables",
  couldNotListAll: "Couldn't read the deliverables",
  couldNotRead: (message: string) => `Couldn't read this deliverable: ${message}`,
  retry: 'Retry',
  frameTitle: (title: string) => `Deliverable ${title}`,
  // the summary
  summary: (n: number, latestTitle: string) => `${n} delivered · ${latestTitle}`,
  nothingYet: 'Nothing delivered yet',
  open: 'Open',
  fallbackTitle: 'Deliverable',
} as const;
