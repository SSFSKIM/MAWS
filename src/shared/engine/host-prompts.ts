// Two prompts the engine host composes and writes as the person's (origin `human`), in their one copy (UX wave U6e):
// the plan handed back after a clear (src/engine-host/session-clear.ts) and the echo of a `!` command with its output
// (src/engine-host/bash-mode.ts). Both carry text the agent or a command produced, so the reader of the person's own
// text (src/shared/files/named.ts) claims a text that holds either opening anywhere. Pure.
// Ticket 733a (docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md, Designs 3 and 4): the plan is content a
// model wrote, so it goes with every line that quotes the grant's opening left out and inside one pasted segment after
// MAWS's own sentence; MAWS's readers draw that segment in place, so the prompt reads as it did before.
import { restorePastedTags } from '../composer/pasted-framing';
import { composedContent, takeSegment, type Range } from './composed-content';
import { neutraliseGrant } from './grant';

export const PLAN_LEAD = 'Implement this plan:';
const PLAN_HEAD = `${PLAN_LEAD}\n\n`; // the sentence and the blank line after it, which the form had before the frame

/** The prompt that starts the plan's implementation after the clear: the sentence, a blank line, the plan as content. */
export const planPrompt = (plan: string, tagId: string): string => neutraliseGrant(`${PLAN_HEAD}${composedContent(plan, tagId)}`);

/**
 * A plan prompt read in place (Design 4): only a text that is exactly the writer's shape, the sentence, the blank line,
 * one segment and nothing after it, gives the text with the segment's body where the segment stood (its neutralised tags
 * restored) and the body's range; any other text, null.
 */
export function readPlanPrompt(text: string): { text: string; composed: Range[] } | null {
  if (!text.startsWith(PLAN_HEAD)) return null;
  const segment = takeSegment(text, PLAN_HEAD.length);
  if (segment === null || segment.end !== text.length) return null;
  const body = restorePastedTags(segment.body);
  return { text: `${PLAN_HEAD}${body}`, composed: [[PLAN_HEAD.length, PLAN_HEAD.length + body.length]] };
}

const PLAN_OPENING_TAG = /^\n\n<pasted_content id="[0-9a-f]{4}">\n/;

/**
 * A plan prompt with its segment's opening tag line taken out, for a title (Design 4): the text begins with the
 * sentence, the blank line and the segment's opening, also where a cap cut the segment before its closing tag; the
 * closing tag goes too when the segment closes the text. Any other text as it is.
 */
export function planPromptOpened(text: string): string {
  const whole = readPlanPrompt(text);
  if (whole !== null) return whole.text;
  if (!text.startsWith(PLAN_HEAD)) return text;
  const opening = PLAN_OPENING_TAG.exec(text.slice(PLAN_HEAD.length));
  return opening === null ? text : `${PLAN_HEAD}${restorePastedTags(text.slice(PLAN_HEAD.length + opening[0].length))}`;
}

export const BASH_INPUT_OPENING = '<bash-input>';
/** The echo of a `!` command: the command, then its output as the engine framed it. */
export const bashEcho = (command: string, output: string): string => `${BASH_INPUT_OPENING}${command}</bash-input>\n${output}`;
