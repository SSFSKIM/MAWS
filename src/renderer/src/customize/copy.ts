// Customize's page's own words (UX wave U11c, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §G): the row
// of kinds under the view switch and My items' search under All. A kind's own words are its section's
// (./connectors/copy.ts, ./discover/copy.ts, widgets/copy.ts).
export const PAGE = {
  show: 'Show:',
  showGroup: 'Show',
  choice: { all: 'All', plugins: 'Plugins', skills: 'Skills', connectors: 'Connectors' } as const,
  searchMine: 'Search my items', // the drawing's label (ruled point 7)
} as const;
