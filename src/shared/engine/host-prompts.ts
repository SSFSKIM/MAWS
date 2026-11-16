// Two prompts the engine host composes and writes as the person's (origin `human`), in their one copy (UX wave U6e):
// the plan handed back after a clear (src/engine-host/session-clear.ts) and the echo of a `!` command with its output
// (src/engine-host/bash-mode.ts). Both carry text the agent or a command produced, so the reader of the person's own
// text (src/shared/files/named.ts) claims a text that holds either opening anywhere. Pure.

export const PLAN_LEAD = 'Implement this plan:';
/** The prompt that starts the plan's implementation after the clear. */
export const planPrompt = (plan: string): string => `${PLAN_LEAD}\n\n${plan}`;

export const BASH_INPUT_OPENING = '<bash-input>';
/** The echo of a `!` command: the command, then its output as the engine framed it. */
export const bashEcho = (command: string, output: string): string => `${BASH_INPUT_OPENING}${command}</bash-input>\n${output}`;
