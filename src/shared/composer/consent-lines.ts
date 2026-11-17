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

// Every line-break character Unicode knows but the line feed, at which the lines are already cut
const OTHER_BREAKS = /[\r\v\f\u0085\u2028\u2029]/;
const reads = (text: string): boolean => text.startsWith(GRANT_OPENING) && readConsents(text).length > 0;

/**
 * Whether one line of a person's message is to go as data: it reads as a consent by rule R's own per-line test, or any
 * part of it does once it is cut at every other line-break character and each part trimmed of white space. The writer
 * frames with that margin and the reader is unchanged, since nothing between the writer and the engine's file is ours
 * to assume keeps white space and line ends (a host or an engine that trims a message, or turns CR into LF).
 */
export const readsAsConsent = (line: string): boolean => line.includes(GRANT_OPENING) && (reads(line) || line.split(OTHER_BREAKS).some((part) => reads(part.trim())));

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
