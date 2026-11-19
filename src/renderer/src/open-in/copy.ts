// The words of "Open in" (UX wave U6b-4a, docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4a-open-in.md). A refusal's
// sentence is main's (`layout.openIn`'s message); these are the menus' own.
export const OPEN_IN_COPY = {
  label: 'Open in',
  // a session on another machine: the item is drawn disabled and carries the reason in its own words (the cut's decision 10)
  elsewhere: (machine: string) => `Open in (the folder is on ${machine})`,
  looking: 'Looking for apps…',
  failed: 'MAWS could not open it just now', // the bridge threw, or main answered an error
} as const;
