// Customize's page's own words (UX wave U11c, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §G): the row
// of kinds under the view switch, My items' search under All, the kind word that ends a row under All and All's empty
// state. A kind's own words are its section's (./connectors/copy.ts, ./discover/copy.ts, widgets/copy.ts).
export const PAGE = {
  show: 'Show:',
  showGroup: 'Show',
  choice: { all: 'All', plugins: 'Plugins', skills: 'Skills', connectors: 'Connectors' } as const,
  searchMine: 'Search my items', // the drawing's label (ruled point 7)
  kindWord: { plugin: 'Plugin', mod: 'Mod', skill: 'Skill', connector: 'Connector' } as const,
  emptyTitle: 'Nothing here yet.',
  emptyBody: 'Find plugins, skills and connectors in Discover.',
} as const;
