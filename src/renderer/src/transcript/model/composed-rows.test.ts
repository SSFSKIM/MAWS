// Ticket 733a (docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md, Design 4; acceptance 7 and 8): a pasted
// segment inside one of MAWS's forms is drawn in place by two recognisers, each keyed on a mark only MAWS writes (a text
// MAWS's anchor tag ends; a plan prompt in exactly its writer's shape). Through the real derivation, each form's row is
// the row the pin drew for the pin writer's text of the same input, with no placeholder and no chip, and records where
// its segments' bodies stand. No message of a person's is drawn differently: a seeded differential against the pin's
// reader.
import { describe, expect, it } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import { commentsMessage, promotionMessage, quotedComment, PROMOTION_HEAD, ANCHOR_TAG_OPENING } from '@shared/anchor/message';
import { wrapPasted } from '@shared/composer/pasted-framing';
import type { SessionEvent } from '@shared/graph/events';
import { PLAN_LEAD, planPrompt } from '@shared/engine/host-prompts';
import { pinPlanPrompt, pinPromotionMessage, pinQuotedComment, pinWrapPasted } from '../../../../../test/support/pin-forms';
import { pinUserTextOf } from '../../../../../test/support/pin-user-text';
import { rowsOf } from './derive';
import { applyEvents, createState } from './reduce';
import type { Row } from './rows';
import { RowSchema } from './schema';
import { builder, uuid } from './test-events';
import { userTextOf } from './user-text';

type UserRow = Extract<Row, { kind: 'user' }>;
// The user row the model derives for a message of `content`, as the transcript draws it
function rowOf(content: string): UserRow {
  const b = builder();
  b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
  b.emit('user.message', { messageUuid: uuid('u1'), content, isReplay: false, isSynthetic: false, origin: 'human', bash: null });
  b.end(['u1']);
  return rowsOf(applyEvents(createState(null, null), b.events as SessionEvent[])).find((row): row is UserRow => row.kind === 'user')!;
}
// The parts of a row the pin's reader also gave
const drawn = (row: UserRow) => ({ text: row.text, attachments: row.attachments, placeholders: row.placeholders, anchor: row.anchor ?? null, comments: row.comments?.map(({ anchor, text }) => ({ anchor, text })) ?? null });
const pinDrawn = (content: string) => {
  const read = pinUserTextOf(content);
  return { text: read.text, attachments: read.attachments, placeholders: read.placeholders, anchor: read.anchor, comments: read.comments };
};

const LINE: Anchor = { kind: 'file-line', locator: '/work/out/report.ts#L12', label: 'report.ts:12', path: '/work/out/report.ts', line: 12 };
const OLD: Anchor = { ...LINE, side: 'old' };
const EXCHANGES = [
  { question: 'Where are the notes?', response: 'In the notes folder.\nUnder the dated ones.' },
  { question: 'Which is newest?', response: 'The one from Tuesday.' },
];
const PLAN = '# Plan\n\n1. Edit the notes.\n2. Run the tests.\n';

describe('a form’s row is drawn as the pin drew it, its segments in place', () => {
  it.each([
    ['a promotion', promotionMessage(EXCHANGES, 'Spell it backwards.', 'a1b2'), pinPromotionMessage(EXCHANGES, 'Spell it backwards.')],
    ['a promotion with no typed words', promotionMessage(EXCHANGES, null, 'a1b2'), pinPromotionMessage(EXCHANGES, null)],
    ['a plan prompt', planPrompt(PLAN, 'a1b2'), pinPlanPrompt(PLAN.replace(/\n$/, ''))],
    ['one comment with a quoted line, to main', commentsMessage([{ anchor: LINE, text: quotedComment(LINE, 'return total;', 'Count the header.', 'a1b2'), screenshot: false }], 'main'), commentsMessage([{ anchor: LINE, text: pinQuotedComment(LINE, 'return total;', 'Count the header.'), screenshot: false }], 'main')],
    ['one comment on a removed line, to a thread', commentsMessage([{ anchor: OLD, text: quotedComment(OLD, 'if (row) skip();', 'Why dropped?', 'a1b2'), screenshot: false }], 'thread'), commentsMessage([{ anchor: OLD, text: pinQuotedComment(OLD, 'if (row) skip();', 'Why dropped?'), screenshot: false }], 'thread')],
    [
      'several comments with quoted lines',
      commentsMessage([{ anchor: LINE, text: quotedComment(LINE, 'return total;', 'One.', 'a1b2'), screenshot: false }, { anchor: OLD, text: quotedComment(OLD, 'if (row) skip();', 'Two.', 'a1b2'), screenshot: false }], 'thread'),
      commentsMessage([{ anchor: LINE, text: pinQuotedComment(LINE, 'return total;', 'One.'), screenshot: false }, { anchor: OLD, text: pinQuotedComment(OLD, 'if (row) skip();', 'Two.'), screenshot: false }], 'thread'),
    ],
  ])('%s: the pin’s row for the pin writer’s text, no placeholder and no chip, each body’s range recorded', (_, sent, pin) => {
    const row = rowOf(sent);
    expect(drawn(row)).toEqual(pinDrawn(pin));
    expect(row.placeholders).toEqual([]);
    expect(row.attachments.filter((attachment) => attachment.kind === 'text')).toEqual([]);
    expect(row.composed?.length).toBeGreaterThan(0);
    for (const [from, to] of row.composed!) expect(sent).toContain(row.text.slice(from, to));
    expect(RowSchema.safeParse(row).success).toBe(true);
    // the control: the same segment in a message of no form is a chip, as it always was
    const chipped = rowOf(`Please read this.${wrapPasted('a1b2', row.text.slice(...row.composed![0]!))}`);
    expect(chipped.placeholders).toHaveLength(1);
    expect('composed' in chipped).toBe(false);
  });

  it('a row of no form carries no ranges; the pin’s writers’ rows are the pin’s rows', () => {
    for (const content of ['plain prompt', pinPlanPrompt(PLAN), pinPromotionMessage(EXCHANGES, null)]) {
      const row = rowOf(content);
      expect('composed' in row, content).toBe(false);
      expect(drawn(row)).toEqual(pinDrawn(content));
    }
  });

  it('a plan prompt whose first line was edited is the person’s message with a pasted block: its plan a chip', () => {
    const row = rowOf(planPrompt(PLAN, 'a1b2').replace(PLAN_LEAD, 'Implement this plan, please:'));
    expect(row.placeholders).toHaveLength(1);
    expect('composed' in row).toBe(false);
  });
});

// Acceptance 8: for seeded messages of a person's that are no form, the row equals the pin's row byte for byte. A message
// is built from parts: words, chips of every size (the composer's frame, the pin's), the forms' fixed words in other
// places, tags that do not parse. A message that is a form (the plan's exact shape, a text MAWS's tag ends) is not a
// person's message of no form and is set aside, counted.
describe('no message of a person’s is drawn differently (the differential)', () => {
  // a seeded generator (mulberry32), so a failure names its message
  function random(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const SEED = 733;
  const COUNT = 3000;
  const body = (next: () => number) => Array.from({ length: 1 + Math.floor(next() * 40) }, (_, i) => `line ${i} of the paste`).join('\n');
  const PARTS: ((next: () => number) => string)[] = [
    () => 'Please look at this.',
    () => '\n',
    () => '\n\n',
    (next) => wrapPasted('a1b2', body(next)),
    (next) => pinWrapPasted('c3d4', body(next)),
    () => wrapPasted('a1b2', 'x'.repeat(20_000)),
    () => PLAN_LEAD,
    () => `${PLAN_LEAD}\n\n`,
    () => `${PROMOTION_HEAD}\n\n`,
    () => 'Q: why?\nA: because.',
    () => `${ANCHOR_TAG_OPENING} kind="x"/>`,
    () => '<maws_anchor kind="none" label="Side question"/>',
    () => '<pasted_content id="zzzz">\nnot a tag\n</pasted_content id="zzzz">',
    () => 'Comment on "report.ts:12" (file /work/out/report.ts, line 12):',
    () => '/compact keep it short',
  ];
  // The two recognisers' whole-form shapes, read from the raw input and not by the code under test (fix waves 1 and 2):
  // a message the pin's reader reads as anchored (its anchor reader, which this landing leaves unchanged), and a plan
  // prompt in exactly its writer's shape, one segment and nothing after it, written from the spec
  const PLAN_SHAPE = /^Implement this plan:\n\n\n\n<pasted_content id="([0-9a-f]{4})">\n(?:(?!\n<\/pasted_content id="\1">)[\s\S])*\n<\/pasted_content id="\1">\n$/;
  const allowedForm = (message: string) => {
    const pin = pinUserTextOf(message);
    return pin.anchor !== null || pin.comments !== null || PLAN_SHAPE.test(message);
  };
  it(`${COUNT} seeded messages (seed ${SEED}): every row of no form is the pin’s row; a form among them is set aside, and a form is drawn otherwise (the control)`, () => {
    const next = random(SEED);
    let compared = 0;
    let forms = 0;
    for (let n = 0; n < COUNT; n += 1) {
      const message = Array.from({ length: 1 + Math.floor(next() * 6) }, () => PARTS[Math.floor(next() * PARTS.length)]!(next)).join('');
      if (allowedForm(message)) {
        forms += 1;
        continue;
      }
      const read = userTextOf(message);
      const pin = pinUserTextOf(message);
      expect({ text: read.text, attachments: read.attachments, placeholders: read.placeholders }, JSON.stringify(message)).toEqual({ text: pin.text, attachments: pin.attachments, placeholders: pin.placeholders });
      compared += 1;
    }
    expect(compared).toBeGreaterThan(COUNT * 0.9);
    expect(compared + forms).toBe(COUNT);
    // the shapes set aside: each recogniser's own shape among them, a near miss of either not (the controls)
    expect([allowedForm(planPrompt('one', 'a1b2')), allowedForm(promotionMessage([], null, 'a1b2')), allowedForm(`${planPrompt('one', 'a1b2')}more`), allowedForm(`${PLAN_LEAD}\n\none`), allowedForm(`${ANCHOR_TAG_OPENING} kind="x"/> and words`), allowedForm(`Look.\n\n${ANCHOR_TAG_OPENING} kind="x"/>`)]).toEqual([true, true, false, false, false, false]);
    // the control: a form of this build is drawn otherwise than the pin's reader draws it
    const plan = planPrompt('one\ntwo', 'a1b2');
    expect(userTextOf(plan).text).not.toBe(pinUserTextOf(plan).text);
  });
});
