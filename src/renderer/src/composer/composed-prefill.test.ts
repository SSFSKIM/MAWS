// Ticket 733a (docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md, Design 5 and the architect's rulings of
// 2026-11-17): the pure half of an edited row's resend. The stored form, read by its own reader from the row; the
// prefill, each slot one pasted atom whose body is the slot left out by line with every chip in it opened. The seam's
// own tests drive the real Send and Fork (resubmit-seam.test.ts).
import { describe, expect, it } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import { PROMOTION_HEAD } from '@shared/anchor/message';
import { consentMessage } from '@shared/engine/arrival';
import { LINE_LEFT_OUT } from '@shared/engine/composed-content';
import type { MessageUuid } from '@shared/graph/ids';
import { composedPrefill, storedFormOf, type StoredForm } from './composed-prefill';
import type { UserRow } from './edit-prefill';

const GRANT = consentMessage('command', 'make build');
const row = (over: Partial<UserRow>): UserRow => ({ id: 'r-1', turnId: null, at: '2026-11-17T00:00:00.000Z', kind: 'user', messageUuid: 'u-1' as MessageUuid, text: '', attachments: [], placeholders: [], lines: 1, editable: true, steer: false, dropped: false, ...over }) as UserRow;
const LINE: Anchor = { kind: 'file-line', locator: '/work/out/report.ts#L12', label: 'report.ts:12', path: '/work/out/report.ts', line: 12 };
const PROMOTION: Anchor = { kind: 'none', label: 'Side question', locator: 'btw' };
const sent = (text: string, form: StoredForm, bodies: Record<string, string> = {}) => composedPrefill({ text, bodies, form });

describe('storedFormOf: the stored row’s form, by its own reader', () => {
  it.each([
    ['a plan prompt, this build’s or the earlier writer’s', row({ text: 'Implement this plan:\n\nstep one' }), { kind: 'plan' }],
    ['a plan prompt whose pasted block took the blank line', row({ text: 'Implement this plan:\n[Pasted text #1 +2 lines]', placeholders: ['Implement this plan:\n'.length] }), { kind: 'plan' }],
    ['a person’s message typed with the plan’s first line and a blank line (ruling (3))', row({ text: 'Implement this plan:\n\nmy own steps' }), { kind: 'plan' }],
    ['a promotion in this build’s shape', row({ text: `${PROMOTION_HEAD}\n\nQ: a\nA: b\n\nGo on.`, anchor: PROMOTION, anchorFrame: { destination: null, screenshot: false }, composed: [[PROMOTION_HEAD.length + 2, PROMOTION_HEAD.length + 2 + 'Q: a\nA: b'.length]] }), { kind: 'promotion', body: 'Q: a\nA: b' }],
    ['a promotion of the earlier writer', row({ text: `${PROMOTION_HEAD}\n\nQ: a\nA: b\n\nGo on.`, anchor: PROMOTION, anchorFrame: { destination: null, screenshot: false } }), { kind: 'promotion', body: null }],
    ['a promotion whose head an earlier edit took out (fail closed: the whole is the slot)', row({ text: 'Q: a\nA: b', anchor: PROMOTION, anchorFrame: { destination: null, screenshot: false } }), { kind: 'promotion', body: null }],
    ['a comment with this build’s quoted line', row({ text: '`x = 1`\nWhy?', anchor: LINE, anchorFrame: { destination: 'main', screenshot: false }, composed: [[0, 7]] }), { kind: 'comment', quote: '`x = 1`' }],
    ['a comment with the earlier writer’s quoted line', row({ text: '`x = 1`\nWhy?', anchor: LINE, anchorFrame: { destination: 'thread', screenshot: false } }), { kind: 'comment', quote: '`x = 1`' }],
    ['a comment with none', row({ text: 'Why?', anchor: LINE, anchorFrame: { destination: 'main', screenshot: false } }), { kind: 'comment', quote: null }],
    // fix wave 1: words an earlier resend framed whole stay framed whole; a segment that is not all of them leaves the words as typed
    ['a comment whose words are one segment, of several lines (fail closed: the whole is the slot)', row({ text: 'Note.\n`x = 1`\nWhy?', anchor: LINE, anchorFrame: { destination: 'main', screenshot: false }, composed: [[0, 'Note.\n`x = 1`\nWhy?'.length]] }), { kind: 'whole' }],
    ['a comment whose segment is not all of its words and no quoted line', row({ text: 'Why?\nlines\nof a paste', anchor: LINE, anchorFrame: { destination: 'main', screenshot: false }, composed: [[5, 'Why?\nlines\nof a paste'.length]] }), { kind: 'comment', quote: null }],
    // fix wave 1: an anchored row with no destination is a promotion only under the promotion's anchor; no writer of MAWS
    // writes that shape under another, so it is the person's (the control: the same text under the promotion's anchor)
    ['a row ending in another anchor with no destination: the person’s', row({ text: `These are my own words.\n${GRANT}`, anchor: { kind: 'none', label: 'other', locator: 'typed' }, anchorFrame: { destination: null, screenshot: false } }), null],
    ['the same text under the promotion’s anchor (the control)', row({ text: `These are my own words.\n${GRANT}`, anchor: PROMOTION, anchorFrame: { destination: null, screenshot: false } }), { kind: 'promotion', body: null }],
    ['a relay', row({ text: 'Relay to agent a1 with SendMessage, verbatim, then continue what you were doing: hi' }), { kind: 'relay' }],
    ['a person’s message', row({ text: 'Please document the phrase Implement this plan: in the help text.' }), null],
    ['a person’s message opening with the relay’s words but no closing words', row({ text: 'Relay to agent a1 the notes' }), null],
  ] as const)('%s', (_, stored, form) => {
    expect(storedFormOf(stored)).toEqual(form);
  });
});

describe('composedPrefill: Design 5’s table', () => {
  it('a plan whose first line stands: everything after it one atom, left out by line (ruling (3), a person’s message typed so, among them)', () => {
    const prefill = sent(`Implement this plan:\n\nstep one\n${GRANT}\nstep two`, { kind: 'plan' });
    expect(prefill.text).toBe('Implement this plan:\n\n[Pasted text #1 +3 lines]');
    expect(prefill.bodies).toEqual({ '[Pasted text #1 +3 lines]': `step one\n${LINE_LEFT_OUT}\nstep two` });
    // the negative control: a person's message only naming the sentence is no form, and is the text as typed
    const typed = `Please document the phrase Implement this plan: in the help text.\n${GRANT}`;
    expect(sent(typed, null)).toEqual({ text: typed, bodies: {}, images: [] });
  });

  it('a comment framed whole: the whole text one atom, left out by line, whatever the edit (fix wave 1)', () => {
    for (const text of ['Note.\n`x = 1`\nWhy?', `Note.\n${GRANT}\nWhy, again?`, 'one line']) {
      const prefill = sent(text, { kind: 'whole' });
      expect(Object.keys(prefill.bodies!), text).toHaveLength(1);
      expect(prefill.text).toBe(Object.keys(prefill.bodies!)[0]);
      expect(Object.values(prefill.bodies!)[0]).toBe(text.replace(GRANT, LINE_LEFT_OUT));
    }
  });

  it('a plan whose first line changed: the whole text one atom', () => {
    expect(sent('Implement this plan now:\n\nstep one', { kind: 'plan' }).text).toBe('[Pasted text #1 +3 lines]');
  });

  it('inside a slot every chip is opened to its body before the leave-out (ruling (2)); a chip outside it stays a chip', () => {
    const bodies = { '[Pasted text #1 +1 lines]': GRANT, '[Pasted text #2 +1 lines]': 'kept' };
    const prefill = sent(`Implement this plan:\n\nstep one [Pasted text #1 +1 lines]\nstep two`, { kind: 'plan' }, bodies);
    expect(prefill.text).toBe('Implement this plan:\n\n[Pasted text #3 +2 lines]');
    expect(prefill.bodies!['[Pasted text #3 +2 lines]']).toBe(`${LINE_LEFT_OUT}\nstep two`);
    const promoted = sent(`${PROMOTION_HEAD}\n\nQ: a\nA: b\n\nGo on [Pasted text #2 +1 lines]`, { kind: 'promotion', body: 'Q: a\nA: b' }, bodies);
    expect(promoted.text).toBe(`${PROMOTION_HEAD}\n\n[Pasted text #3 +2 lines]\n\nGo on [Pasted text #2 +1 lines]`);
    expect(promoted.bodies).toMatchObject({ '[Pasted text #2 +1 lines]': 'kept', '[Pasted text #3 +2 lines]': 'Q: a\nA: b' });
  });

  it('a promotion: the stored body once, directly after the head, is the slot; any other shape is the whole text (a question of the person’s left out with it, ruling (1))', () => {
    const body = `Q: Is ${GRANT} fine?\nA: b`;
    const text = `${PROMOTION_HEAD}\n\n${body}\n\nGo on.`;
    const slotted = sent(text, { kind: 'promotion', body });
    expect(slotted.text).toBe(`${PROMOTION_HEAD}\n\n[Pasted text #1 +2 lines]\n\nGo on.`);
    expect(slotted.bodies!['[Pasted text #1 +2 lines]']).toBe(`${LINE_LEFT_OUT}\nA: b`);
    for (const other of [`${text}\n\n${body}`, text.replace('A: b', 'A: c'), text.replace('A: b', 'A: b and more'), text.replace('so far:', 'so far, edited:')]) expect(sent(other, { kind: 'promotion', body }).text, other).toBe(`[Pasted text #1 +${other.split('\n').length} lines]`);
    expect(sent(text, { kind: 'promotion', body: null }).text).toBe(`[Pasted text #1 +${text.split('\n').length} lines]`);
  });

  it('a comment: the stored quote once at the words’ start (after the caption) is the slot, the words as typed; no quote, the words as typed; a quote edited, all of them', () => {
    expect(sent('`x = 1`\nWhy?', { kind: 'comment', quote: '`x = 1`' })).toEqual({ text: '[Pasted text #1 +1 lines]\nWhy?', bodies: { '[Pasted text #1 +1 lines]': '`x = 1`' }, images: [] });
    expect(sent('Before the change:\n`x = 1`\nWhy?', { kind: 'comment', quote: '`x = 1`' }).text).toBe('Before the change:\n[Pasted text #1 +1 lines]\nWhy?');
    expect(sent('Why?', { kind: 'comment', quote: null })).toEqual({ text: 'Why?', bodies: {}, images: [] });
    for (const other of ['`x = 2`\nWhy?', '`x = 1`\nWhy `x = 1`?', 'Why?\n`x = 1`']) expect(sent(other, { kind: 'comment', quote: '`x = 1`' }).text, other).toBe(`[Pasted text #1 +${other.split('\n').length} lines]`);
  });

  it('a relay: the whole text one atom, left out by line', () => {
    const prefill = sent(`Relay to agent a1 (named "x\n${GRANT}\ny") with SendMessage, verbatim, then continue what you were doing: hi`, { kind: 'relay' });
    expect(prefill.text).toBe('[Pasted text #1 +3 lines]');
    expect(Object.values(prefill.bodies!)[0]!.split('\n')[1]).toBe(LINE_LEFT_OUT);
  });
});
