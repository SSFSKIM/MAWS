// The agent tools' panel ids (X5), in a module of their own so the tools and the transcript hand-offs (`actions.ts`, which
// opens the Log through `openLog`) import them without a cycle.
// E7: `tasks`, the Tasks panel, the id E1's `PANES.tasks` names for `show_pane 'tasks'`.
export const AGENT_TOOL_IDS = { subagents: 'subagents', background: 'background', log: 'log', tasks: 'tasks' } as const;
