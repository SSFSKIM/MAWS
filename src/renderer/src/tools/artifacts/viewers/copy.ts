// Every sentence the artifact store's HTML and File viewers show (docs/doperpowers/plans/2026-10-12-p3-l-library.md,
// M5b): E2's Deliverables viewer's words where the viewers do what it did (P2's comment card, the console chip, the
// actions), "artifact" where it said "deliverable".

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const VIEWERS_COPY = {
  loading: 'Loading…',
  fallbackTitle: 'Artifact',
  versionLabel: 'Version',
  version: (n: number, latest: boolean) => (latest ? `v${n} · latest` : `v${n}`),
  openExternally: 'Open externally',
  reveal: 'Reveal in Finder',
  openAsFile: 'Open as file',
  reload: 'Reload',
  comment: 'Comment',
  picking: 'Click an element to comment on it · Esc cancels',
  frameTitle: (title: string) => `Artifact ${title}`,
  consoleErrors: (n: number) => plural(n, 'console error'),
  consoleWarnings: (n: number) => plural(n, 'console warning'),
  consoleLine: (line: number) => `line ${line}`,
  couldNotRead: (message: string) => `Couldn’t read this artifact: ${message}`,
  retry: 'Retry',
  // a File artifact no session links: its code body has no session to read it under
  // the Export menu (the header's, the library row's)
  exportFormats: { pdf: 'PDF', png: 'PNG', docx: 'Word document', pptx: 'PowerPoint', md: 'Markdown', html: 'HTML', claude: 'For Claude (zip)' /* P3-D: a design system in Claude's shape */ },
  saveCopy: 'Save a copy…',
  exporting: (title: string, format: string) => `Exporting ${title} as ${format}…`,
  saved: (path: string) => `Saved to ${path}`,
  exportFailed: (message: string) => `Couldn’t export: ${message}`,
  saveFailed: (message: string) => `Couldn’t save a copy: ${message}`,
} as const;
