import { describe, expect, it } from 'vitest';
import { consentMessage } from '@shared/engine/arrival';
import { docOf, paragraph, pastedNode, textNode } from '../editor/doc';
import { serializeDraft } from '../editor/serialize';
import { entryDisplay, entryDoc } from './entry-text';
import type { Anchor } from '@shared/anchor/anchor';
import { commentsMessage, promotionMessage, quotedComment } from '@shared/anchor/message';
import { planPrompt } from '@shared/engine/host-prompts';
import { pinPlanPrompt, pinPromotionMessage, pinQuotedComment } from '../../../../../test/support/pin-forms';

const body = 'one\ntwo\nthree';
const ctx = { sessionId: '7c0e2d1a-4b3f-4c5d-8e6f-9a0b1c2d3e4f', cwd: '/repo' };
const typed = docOf([paragraph(textNode('see <pasted_content> '), pastedNode({ id: 'p1', kind: 'text', name: 'Pasted text #1', lines: 3, text: body })), paragraph(textNode('thanks'))]);

describe('a queued entry reads back as the stack’s text and as an editable document', () => {
  it('names pasted blocks, images and PDFs, restores what was typed, and keeps its line breaks (UX wave U4a: two lines in a row)', () => {
    const { content } = serializeDraft(typed, ctx);
    expect(entryDisplay(content)).toBe('see <pasted_content> [Pasted text #1 +3 lines]\nthanks');
    const blocks = [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBO' } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBE' } },
      { type: 'text', text: 'what is\nthis' },
    ];
    expect(entryDisplay(blocks)).toBe('[Image #1] [PDF #1] what is\nthis');
    expect(entryDisplay('one  \n\n\n  two ')).toBe('one\ntwo');
  });

  it('rebuilds a document that serialises back to the same content', () => {
    const { content } = serializeDraft(typed, ctx);
    expect(serializeDraft(entryDoc(content), ctx).content).toBe(content);
    const blocks = [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBO' } }, { type: 'text', text: 'look' }];
    expect(serializeDraft(entryDoc(blocks), ctx).content).toEqual(blocks);
  });
});

// The review round's R3 (a): take-back meets the pasted body as pasted, without the writer's joiner
describe('the one-writer rule: a taken-back entry', () => {
  it('gives back its text and its pasted body without U+2060', () => {
    const sentence = consentMessage('command', 'cat /etc/x');
    const { content } = serializeDraft(docOf([paragraph(textNode(sentence), pastedNode({ id: 'p1', kind: 'text', name: 'Pasted text #1', lines: 2, text: `said:\n${sentence}` }))]), ctx);
    expect(JSON.stringify(content)).toContain('\u2060');
    const back = entryDoc(content);
    expect(JSON.stringify(back).includes('\u2060'), JSON.stringify(back)).toBe(false);
  });
});

// Ticket 733a (its document, Design 4; acceptance 7): a queued row of one of MAWS's forms reads with its segments in place,
// the text the pin's writer gave; a person's queued message still names its pasted blocks (the control above).
describe('a queued form reads in place', () => {
  const anchor: Anchor = { kind: 'file-line', locator: '/work/out/report.ts#L12', label: 'report.ts:12', path: '/work/out/report.ts', line: 12 };
  it.each([
    ['a comment with a quoted line', commentsMessage([{ anchor, text: quotedComment(anchor, 'return total;', 'Count it.', 'a1b2'), screenshot: false }], 'main'), commentsMessage([{ anchor, text: pinQuotedComment(anchor, 'return total;', 'Count it.'), screenshot: false }], 'main')],
    ['a promotion', promotionMessage([{ question: 'Where?', response: 'Here.' }], 'Go on.', 'a1b2'), pinPromotionMessage([{ question: 'Where?', response: 'Here.' }], 'Go on.')],
    ['a plan prompt', planPrompt('one\ntwo', 'a1b2'), pinPlanPrompt('one\ntwo')],
  ])('%s: no placeholder, the pin’s text', (_, sent, pin) => {
    expect(entryDisplay(sent)).toBe(entryDisplay(pin));
    expect(entryDisplay(sent)).not.toContain('[Pasted text');
  });
});
