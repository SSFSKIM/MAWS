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

// A skill's actions (UX wave U11, docs/doperpowers/ledgers/2026-11-18-ux-wave-U11-skill-actions.md, decisions 3 to 5 and
// 7): "New skill…" and its two places, the first message it fills in, a plugin's skill's line, and why a skill's file
// was not shown.
export const SKILL_ACTIONS = {
  newSkill: 'New skill…',
  inProject: 'In this project', // the skills' own group headings (widgets/copy.ts)
  yours: 'Created by you',
  // the composer's text, sent by the person; `creator` is skill-creator's invocation when it can run here
  firstMessage: (where: 'project' | 'yours', skillsHome: string, creator: string | null) =>
    `${creator === null ? '' : `/${creator} `}Let's create a new skill in ${where === 'project' ? '.claude/skills/ of this project' : `${skillsHome}, for all my projects`}. First ask me what it should do.`,
  pluginLine: (plugin: string) => `Comes with the plugin ${plugin}. An update of the plugin replaces this file, and any edit in it.`,
  missing: "This skill's file is no longer here. Refresh, then try again.",
  unreadable: (reason: string) => `Skills could not be read: ${reason}`,
} as const;
