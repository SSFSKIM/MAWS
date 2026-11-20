// Two prompts the engine host composes and writes as the person's (origin `human`), in their one copy (UX wave U6e):
// the plan handed back after a clear (src/engine-host/session-clear.ts) and the echo of a `!` command with its output
// (src/engine-host/bash-mode.ts). Both carry text the agent or a command produced, so the reader of the person's own
// text (src/shared/files/named.ts) claims a text that holds either opening anywhere. Pure.
// Ticket 733a (docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md, Designs 3 and 4): the plan is content a
// model wrote, so it goes with every line that quotes the grant's opening left out and inside one pasted segment after
// MAWS's own sentence; MAWS's readers draw that segment in place, so the prompt reads as it did before.
import { restorePastedTags } from '../composer/pasted-framing';
import { composedContent, LINES_LEFT_OUT, takeSegment, type Range } from './composed-content';
import { neutraliseGrant, quotesGrant } from './grant';

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

// The engine's replayed output frame, as the engine host reads it (src/engine-host/normalizer-support.ts `BASH_OUTPUT`,
// `pass2/bash-context-echoed` seq 7): the two streams' tags, then the exit code's when the engine wrote one
const BASH_OUTPUT = /^<bash-stdout>([\s\S]*?)<\/bash-stdout><bash-stderr>([\s\S]*?)<\/bash-stderr>((?:<bash-exit-code>-?\d+<\/bash-exit-code>)?\s*)$/;

/**
 * The echo of a `!` command: the command, then its output as the engine framed it. Ticket 733a (Design 3): each stream's
 * text is a command's, so inside the engine's own tags it goes through `composedContent` (its lines that quote the
 * grant's opening left out, the rest inside one pasted segment of `tagId`); a stream that is empty stays empty; the tags
 * and the exit code are the engine's. Where the two streams together still quote the opening (an opening put together
 * across them), the second is left out whole, and should the output still quote it, both are. An output not in the
 * engine's shape goes whole through the same function. The command is the person's and is not rewritten; the whole
 * passes `neutraliseGrant`, as any text sent as the person's does.
 */
export function bashEcho(command: string, output: string, tagId: string): string {
  const streams = BASH_OUTPUT.exec(output);
  const framed = streams === null ? composedContent(output, tagId) : framedStreams(streams[1]!, streams[2]!, streams[3]!, tagId);
  return neutraliseGrant(`${BASH_INPUT_OPENING}${command}</bash-input>\n${framed}`);
}

function framedStreams(stdout: string, stderr: string, exit: string, tagId: string): string {
  const stream = (text: string) => (text === '' ? '' : composedContent(text, tagId));
  const write = (out: string, err: string) => `<bash-stdout>${out}</bash-stdout><bash-stderr>${err}</bash-stderr>${exit}`;
  const out = stream(stdout);
  const both = write(out, stream(stderr));
  if (!quotesGrant(both)) return both;
  const second = write(out, stderr === '' ? '' : stream(LINES_LEFT_OUT));
  return quotesGrant(second) ? write(stream(LINES_LEFT_OUT), stderr === '' ? '' : stream(LINES_LEFT_OUT)) : second;
}
