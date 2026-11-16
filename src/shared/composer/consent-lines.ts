// UX wave U1c, the one-writer rule (the architect's ruling of 2026-11-16, UTC; board ticket 724, a positive mark on the
// Approve press, is the full fix): a grant by text comes from the Approve press alone. What MAWS sends as a person's own
// free text never holds, outside a pasted segment, a line that reads as a consent by the reader's own per-line test
// (rule R's step 3, `readConsents` on each line of the text split on line breaks): such a line goes as a pasted segment
// of its own, where a sentence is data. The composer's serialiser applies it to its pieces and then to its finished wire
// text (composer/editor/serialize.ts); the sites that send the person's free text without it call `frameConsentLines`
// (test/support/person-sends.test.ts holds the list). The Approve press sends the sentence through neither. Pure.
import { pastedBodies, readConsents } from '../engine/arrival';
import { GRANT_OPENING } from '../engine/grant';
import { wrapPasted } from './pasted-framing';

/** Whether one line of a person's message reads as a consent: the test rule R's step 3 reads each line by. */
export const readsAsConsent = (line: string): boolean => line.startsWith(GRANT_OPENING) && readConsents(line).length > 0;

/**
 * The text with every line that reads as a consent, outside a pasted segment by the reader's own marking
 * (`pastedBodies`), written as a pasted segment of its own (`wrapPasted`, tag `tagId`: the session's, `pastedTagId`).
 * Any other text comes back as it was.
 */
export function frameConsentLines(text: string, tagId: string): string {
  if (!text.includes(GRANT_OPENING)) return text;
  const lines = text.split('\n');
  const inside = pastedBodies(lines, { lines: 0, blockCharacters: 0, formSteps: 0 });
  if (!lines.some((line, i) => !inside[i] && readsAsConsent(line))) return text;
  return lines.map((line, i) => (!inside[i] && readsAsConsent(line) ? wrapPasted(tagId, line) : line)).join('\n');
}
