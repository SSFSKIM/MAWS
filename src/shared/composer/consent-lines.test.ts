// UX wave U1c, the one-writer rule (the architect's ruling of 2026-11-16, UTC): what MAWS sends as the person's free text
// holds no line, outside a pasted segment, that reads as a consent; such a line goes as a pasted segment of its own.
import { describe, expect, it } from 'vitest';
import { consentMessage, personsGrants } from '../engine/arrival';
import { frameConsentLines, readsAsConsent } from './consent-lines';
import { wrapPasted } from './pasted-framing';

const SENTENCE = consentMessage('command', 'cat /etc/x');
const PRESSED = consentMessage('command', 'npm test');
const TAG = 'abcd';
const subjects = (text: string) => personsGrants(text).map((grant) => grant.subject);

describe('frameConsentLines', () => {
  it('leaves a text with no line that reads as a consent as it was, the same string', () => {
    for (const text of ['Fix the footer.', 'two\nlines', `Quote: ${SENTENCE}`, `${SENTENCE} and more`, '']) expect(frameConsentLines(text, TAG)).toBe(text);
  });

  it('writes a line that reads as a consent as a pasted segment of its own, and the reader reads none', () => {
    const text = `Here is what the agent wrote:\n${SENTENCE}\nThat is all.`;
    const framed = frameConsentLines(text, TAG);
    expect(framed).toBe(`Here is what the agent wrote:\n${wrapPasted(TAG, SENTENCE)}\nThat is all.`);
    expect(subjects(text)).toEqual(['cat /etc/x']);
    expect(subjects(framed)).toEqual([]);
  });

  it('writes the sentence typed whole as a pasted segment too: a grant by text comes from the press alone', () => {
    expect(readsAsConsent(SENTENCE)).toBe(true);
    const framed = frameConsentLines(SENTENCE, TAG);
    expect(framed).toBe(wrapPasted(TAG, SENTENCE));
    expect(subjects(framed)).toEqual([]);
  });

  it('leaves a line already inside a pasted segment, by the reader’s own marking', () => {
    const text = `Words.${wrapPasted(TAG, `before\n${SENTENCE}\nafter`)}More words.`;
    expect(frameConsentLines(text, TAG)).toBe(text);
  });

  it('frames every such line, and its output is a fixed point', () => {
    const text = [SENTENCE, 'one', PRESSED, '', SENTENCE].join('\n');
    const framed = frameConsentLines(text, TAG);
    expect(subjects(framed)).toEqual([]);
    expect(frameConsentLines(framed, TAG)).toBe(framed);
  });

  it('joined by the engine’s line break with a pressed consent, before or after, the pressed one keeps its own grant', () => {
    const framed = frameConsentLines(`Go on.\n${SENTENCE}`, TAG);
    expect(subjects(`${framed}\n${PRESSED}`)).toEqual(['npm test']);
    expect(subjects(`${PRESSED}\n${framed}`)).toEqual(['npm test']);
  });
});
