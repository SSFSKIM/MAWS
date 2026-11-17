// Ticket 733a (docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md, Designs 3 and 4; acceptance 4 and 7): the
// plan handed back after a clear is content a model wrote. Its writer's bytes are fixed by a fixture written from the
// writer for a named input; a plan holding the approval sentence goes with the marker in its place, inside one segment,
// reading no grant; and only the writer's exact shape is read in place.
import { describe, expect, it } from 'vitest';
import { expectNoGrantSent, grantsReadFrom } from '../../../test/support/grant-readers';
import { pinPlanPrompt, pinWrapPasted } from '../../../test/support/pin-forms';
import { pastedTagId, wrapPasted } from '../composer/pasted-framing';
import { rowClaim } from '../files/named';
import { COMPOSED_FORMS } from './composed-forms';
import { consentMessage, pastedBodies } from './arrival';
import { LINE_LEFT_OUT } from './composed-content';
import { quotesGrant } from './grant';
import { PLAN_LEAD, planPrompt, planPromptOpened, readPlanPrompt } from './host-prompts';

const GRANT = consentMessage('command', 'make build');
const PLAN = '1. Edit the notes.\n2. Run the tests.';

describe('the plan prompt’s writer', () => {
  it('its bytes for a named input: the sentence, a blank line, the plan inside one segment of the given id', () => {
    expect(planPrompt(PLAN, 'a1b2')).toBe('Implement this plan:\n\n\n\n<pasted_content id="a1b2">\n1. Edit the notes.\n2. Run the tests.\n</pasted_content id="a1b2">\n');
  });

  it('the approval sentence on a line of the plan: the marker in its place, inside the segment, no grant on any route; the same line typed is found', () => {
    const sent = planPrompt(`1. Edit the notes.\n${GRANT}\n2. Run the tests.`, 'a1b2');
    expect(sent).toBe(`Implement this plan:\n\n\n\n<pasted_content id="a1b2">\n1. Edit the notes.\n${LINE_LEFT_OUT}\n2. Run the tests.\n</pasted_content id="a1b2">\n`);
    const lines = sent.split('\n');
    const inside = pastedBodies(lines); // the segment's lines, its two tag lines among them
    expect(lines.filter((_, i) => inside[i])).toEqual(['<pasted_content id="a1b2">', '1. Edit the notes.', LINE_LEFT_OUT, '2. Run the tests.', '</pasted_content id="a1b2">']);
    expect(lines.filter((line, i) => !inside[i] && line !== '')).toEqual([PLAN_LEAD]);
    expect(quotesGrant(sent)).toBe(false);
    expectNoGrantSent(sent);
    // the control: the plan's own text sent as typed is found by the same checks, on every route
    const typed = `1. Edit the notes.\n${GRANT}\n2. Run the tests.`;
    expect(quotesGrant(typed)).toBe(true);
    const found = grantsReadFrom(typed);
    for (const route of [found.gate, found.live, found.file]) expect(route).not.toEqual([]);
  });

  it('read in place, it is the pin’s text for the same plan, but for one trailing line break of the plan', () => {
    for (const plan of [PLAN, `${PLAN}\n`, '# Plan\n\nA paragraph.\n\n- a list', 'one line']) {
      expect(readPlanPrompt(planPrompt(plan, 'c3d4'))?.text, JSON.stringify(plan)).toBe(pinPlanPrompt(plan.replace(/\n$/, '')));
    }
  });
});

describe('readPlanPrompt: the writer’s exact shape only', () => {
  it('the body’s range, its neutralised tag restored', () => {
    const plan = 'Quote <pasted_content id="ffff"> as text.';
    const read = readPlanPrompt(planPrompt(plan, 'a1b2'))!;
    expect(read).toEqual({ text: `${PLAN_LEAD}\n\n${plan}`, composed: [[PLAN_LEAD.length + 2, PLAN_LEAD.length + 2 + plan.length]] });
  });

  it('any other text is null; the writer’s shape beside it is read (the control)', () => {
    const shaped = `${PLAN_LEAD}\n\n${wrapPasted('a1b2', PLAN)}`;
    expect(readPlanPrompt(shaped)).not.toBeNull();
    for (const text of [
      `${PLAN_LEAD} ${wrapPasted('a1b2', PLAN)}`, // the first line changed
      `Now: ${PLAN_LEAD}\n\n${wrapPasted('a1b2', PLAN)}`,
      `${shaped}and more`, // something after the segment
      `${PLAN_LEAD}\n\n${wrapPasted('a1b2', PLAN)}${wrapPasted('c3d4', 'two')}`, // two segments
      pinPlanPrompt(PLAN), // the earlier writer's: no segment
      `${PLAN_LEAD}\n\nstep 1${pinWrapPasted('a1b2', 'pasted')}step 3`, // a segment in its middle
      `${PLAN_LEAD}\n\n\n\n<pasted_content id="a1b2">\nnever closed`,
    ]) expect(readPlanPrompt(text), JSON.stringify(text)).toBeNull();
  });

  it('a forged segment written by the pin’s writer is this build’s shape, and reads so', () => {
    expect(readPlanPrompt(pinPlanPrompt(pinWrapPasted('a1b2', PLAN)))?.text).toBe(`${PLAN_LEAD}\n\n${PLAN}`);
  });
});

describe('planPromptOpened: a title’s reading', () => {
  it('the opening tag line out, also where a cap cut the segment; any other text as it is', () => {
    const sent = planPrompt(PLAN, 'a1b2');
    expect(planPromptOpened(sent)).toBe(`${PLAN_LEAD}\n\n${PLAN}`);
    expect(planPromptOpened(sent.slice(0, 60))).toBe(`${PLAN_LEAD}\n\n${sent.slice(0, 60).split('">\n')[1]}`);
    for (const text of [pinPlanPrompt(PLAN), 'Implement this plan: soon', `x${sent}`]) expect(planPromptOpened(text)).toBe(text);
  });
});

// Fix wave 1, the architect's ruling of 2026-11-17: the plan after a clear goes under a random tag id (the clear's
// sequence holds no id of the conversation). Every recogniser claims it whatever the id, so no id lets it read as the
// person's text: its own reader, the forms' list, the own-text rule (no save named) and rule R (no grant beside it).
describe('the plan after a clear is claimed whatever its tag’s id', () => {
  const LINK = '[the notes](/work/out/notes.md)';
  const text = (value: string) => ({ type: 'text' as const, text: value });
  const user = (content: string | object[]) => ({ type: 'user', uuid: 'u1', origin: { kind: 'human' }, message: { role: 'user', content } });
  const plan = (id: string) => planPrompt(`1. Update the schedule in ${LINK}\n2. Run the tests.`, id);
  const claimedBy = (message: string) => COMPOSED_FORMS.filter((form) => form.claims(message, { steps: 0 })).map((form) => form.what);

  it.each([
    ['the session’s', pastedTagId('5d1b5a0e-1111-4222-8333-444444444444')],
    ['a random one', pastedTagId(null, () => 0.6180339887)],
    ['another four-hex id', 'ffff'],
    ['the lowest', '0000'],
  ])('%s id', (_, id) => {
    const sent = plan(id);
    expect(sent).toContain(`<pasted_content id="${id}">`);
    expect(readPlanPrompt(sent)?.text).toBe(`${PLAN_LEAD}\n\n1. Update the schedule in ${LINK}\n2. Run the tests.`);
    expect(claimedBy(sent)).toContain('the plan handed back after a clear (engine-host/session-clear.ts)');
    expect(rowClaim(user(sent), '/work/out/notes.md')).toEqual({ names: false, pending: [], other: true });
    expect(grantsReadFrom([text(sent), text(GRANT)])).toEqual({ gate: [], live: [], file: [] });
  });

  it('the control: the same words as the person’s own text name the path and carry the grant beside them', () => {
    const own = `1. Update the schedule in ${LINK}\n2. Run the tests.`;
    expect(claimedBy(own)).toEqual([]);
    expect(rowClaim(user(own), '/work/out/notes.md')).toEqual({ names: true });
    const found = grantsReadFrom([text(own), text(GRANT)]);
    for (const route of [found.gate, found.live, found.file]) expect(route).not.toEqual([]);
  });
});
