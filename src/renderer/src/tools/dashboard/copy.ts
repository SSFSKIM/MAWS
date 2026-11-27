// The dashboard editor's words that its own modules draw (the word cut, docs/doperpowers/specs/2026-11-16-word-cut-design.md,
// "Constraints for the build": copy lives in `copy.ts`; a word kept only as an accessible name says so in its name).

export const DASHBOARD_COPY = {
  fallbackTitle: 'Dashboard',
  // a dashboard from before dashboards were documents: what it is and the way on, above its files (T629)
  legacy: 'An older dashboard, kept read-only. To keep working on it, ask an agent to rebuild it from these files:',
  // a file source's line: the fact; the saved data shown below says itself (T626)
  sourceChanged: (name: string) => `${name} changed`,
  sourceUnavailable: (name: string) => `${name} is unavailable`,
  reread: 'Reread',
  rereadName: (title: string) => `Reread ${title}`, // accessible name only: Reread's, naming its source
  rereadingName: 'Rereading…', // accessible name only: the quiet spinner's beside Reread while it reads (N192)
};
