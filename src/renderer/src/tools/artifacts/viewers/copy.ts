// Every sentence the artifact store's HTML and File viewers show (docs/doperpowers/plans/2026-10-12-p3-l-library.md,
// M5b): E2's Deliverables viewer's words where the viewers do what it did (P2's comment card, the console chip, the
// actions), "artifact" where it said "deliverable".

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const VIEWERS_COPY = {
  loading: 'Loading…', // the word cut (T573): the quiet spinner's name, never drawn
  fallbackTitle: 'Artifact',
  versionLabel: 'Version',
  version: (n: number, latest: boolean) => (latest ? `v${n} · latest` : `v${n}`),
  openExternally: 'Open externally',
  reveal: 'Reveal in Finder',
  revealOn: (machine: string) => `The file is on ${machine}`, // P5 O7 M5a: why Reveal is greyed (ticket 815: its reason, the name staying Reveal)
  openAsFile: 'Open as file',
  reload: 'Reload',
  comment: 'Comment',
  picking: 'Click an element · Esc cancels', // the word cut (T575)
  frameTitle: (title: string) => `Artifact ${title}`,
  consoleErrors: (n: number) => plural(n, 'error'), // the word cut (T571): the chip says the count and its level
  consoleWarnings: (n: number) => plural(n, 'warning'),
  consoleLine: (line: number) => `line ${line}`,
  couldNotRead: (message: string) => `Couldn’t read this artifact: ${message}`,
  retry: 'Retry',
  // a File artifact no session links: its code body has no session to read it under
  // the Export menu (the header's, the library row's)
  exportFormats: { pdf: 'PDF', png: 'PNG', pngs: 'PNG (all slides)', docx: 'Word document', pptx: 'PowerPoint', md: 'Markdown', html: 'HTML', claude: 'For Claude (zip)' /* P3-D: a design system in Claude's shape */ },
  saveCopy: 'Save a copy…',
  exporting: (title: string, format: string) => `Exporting ${title} as ${format}…`,
  saved: (path: string, commentAuthorName?: string) => `Saved to ${path}${commentAuthorName ? ` · Comments credited to ${commentAuthorName}` : ''}`, // the word cut (T579)
  exportFailed: (message: string) => `Couldn’t export: ${message}`,
  saveFailed: (message: string) => `Couldn’t save a copy: ${message}`,
} as const;
