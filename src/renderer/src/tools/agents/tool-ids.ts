// The agent tools' panel ids (X5), in a module of their own so the tools and the transcript hand-offs (`actions.ts`, which
// opens the Log through `openLog`) import them without a cycle.
export const AGENT_TOOL_IDS = { subagents: 'subagents', background: 'background', log: 'log' } as const;
