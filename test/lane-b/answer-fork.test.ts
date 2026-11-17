// "Fork from here" on another machine (UX wave U3b, M3; docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-
// find.md, "Routes" and Acceptance 9): what the answer's button sends for a session MAWS runs there, read against the
// machine's own offer of `session.fork`. The input is the one src/renderer/src/transcript/view/rows/AnswerActions.test.tsx
// pins as sent ("sends what the machine's offer of session.fork accepts"); that suite renders in the renderer's project,
// which does not build the endpoint's module, so the offer is read here.
import { describe, expect, it } from 'vitest';
import { OFFERS } from '../../src/endpoint/offers';

const SENT = { appSessionId: 'app-far', target: { kind: 'inPlace' }, message: null, rewindTo: 'u-next' };

describe('the answer’s Fork from here, sent to another machine', () => {
  it('is an in-place fork the machine’s offer of session.fork accepts, from before the next prompt or of the whole conversation', () => {
    const accepts = OFFERS.commands['session.fork']!.accepts!;
    expect(accepts(SENT)).toBe(true);
    expect(accepts({ ...SENT, rewindTo: null })).toBe(true);
  });
});
