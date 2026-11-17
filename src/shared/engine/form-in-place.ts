// Ticket 733a (docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md, Design 4): the text of one of MAWS's
// forms as a surface that shows a message's whole text reads it (a queued row's text, the resume chooser's preview):
// the segments a form's own recogniser accepts drawn in place, so the text is what the form's writer wrote before the
// segments. Two recognisers, each keyed on a mark only MAWS writes: a text that `readAnchoredMessage` reads (it ends in
// MAWS's anchor tag), and a plan prompt in exactly its writer's shape. Any other text is no form: null, and the surface
// draws its pasted blocks as it always has.
import { ANCHOR_TAG_OPENING, readAnchoredMessage } from '../anchor/message';
import { segmentsInPlace } from './composed-content';
import { readPlanPrompt } from './host-prompts';

export function formTextInPlace(text: string): string | null {
  const plan = readPlanPrompt(text);
  if (plan !== null) return plan.text;
  return text.includes(ANCHOR_TAG_OPENING) && readAnchoredMessage(text) !== null ? segmentsInPlace(text).text : null;
}
