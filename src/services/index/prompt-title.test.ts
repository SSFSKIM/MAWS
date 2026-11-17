// Ticket 733a (docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md, Design 4; acceptance 7): a session named
// by its first prompt names a plan prompt by the plan's first words, its segment's opening tag line taken out, also where
// the summary's cap of 200 characters cut the segment; a thread's first message is named as before, since its segment
// stands after the six words a title keeps (the shortest lead that can carry a quoted line is six words).
import { describe, expect, it } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import { commentsMessage, quotedComment } from '@shared/anchor/message';
import { planPrompt } from '@shared/engine/host-prompts';
import { pinPlanPrompt, pinQuotedComment } from '../../../test/support/pin-forms';
import { cutPrompt, promptTitle } from './sessions';

const title = (prompt: string) => cutPrompt(promptTitle(prompt)!);

describe('a composed form’s title', () => {
  const plan = 'Rename the export column, then update every caller and run the tests.\n'.repeat(5);

  it('a plan prompt reads the plan’s first words, whole and cut at 200 characters, as the pin’s plan prompt did', () => {
    const sent = planPrompt(plan, 'a1b2');
    expect(title(sent)).toBe('Implement this plan: Rename the export');
    expect(title(sent.slice(0, 200))).toBe('Implement this plan: Rename the export');
    expect(title(sent)).toBe(title(pinPlanPrompt(plan)));
    // the control: a pasted block in a person's prompt still titles as its placeholder
    expect(title(`Review this\n\n<pasted_content id="ab12">\nline one\n</pasted_content id="ab12">\n`)).toBe('Review this [Pasted text #1 +1 lines]');
  });

  it('a thread’s first message with a quoted line, under the shortest lead, is named as the pin named it', () => {
    const anchor: Anchor = { kind: 'file-line', locator: 'p#L1', label: 'x', path: 'p', line: 1 };
    const sent = commentsMessage([{ anchor, text: quotedComment(anchor, 'return total;', 'Count it.', 'a1b2'), screenshot: false }], 'thread');
    const pin = commentsMessage([{ anchor, text: pinQuotedComment(anchor, 'return total;', 'Count it.'), screenshot: false }], 'thread');
    expect(sent.split('\n')[0]).toBe('Comment on "x" (file p, line 1):');
    expect(title(sent)).toBe('Comment on "x" (file p, line');
    expect(title(sent)).toBe(title(pin));
  });
});
