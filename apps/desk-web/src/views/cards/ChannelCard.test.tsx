// @vitest-environment happy-dom
// What the passkey gesture approves is the answer's own (P5 O13 M5, review round 1): the card the answer was built from,
// kept with the attempt, never the card as a later set redrew it. A Retry reseals the retained operation over the first
// card's digest, so it must say what that card asked, though sminos republished the request with another input since.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Attempt } from '../../cards/card-state';
import type { Card } from '../../cards/cards';
import { ChannelCard } from './ChannelCard';

const bash = (command: string): Card => ({ lane: 'A', raised: { request: 'toolu_1', session: 'la-1', tool: 'Bash', input: { command } }, launch: 'L1', digest: { session: 'la-1', request: 'toolu_1', tool: 'Bash', input_sha256: command } });
const allow = { kind: 'decision', decision: 'allow' } as const;

afterEach(cleanup);

function drawn(card: Card, attempt: Attempt) {
  render(<ChannelCard card={card} state={{ kind: 'sending' }} attempt={attempt} note={null} where="main" machine="mini" draftId="d" onAnswer={() => {}} onRetry={() => {}} onNote={() => {}} />);
  return screen.getByTestId('gesture').textContent;
}

describe('the gesture line', () => {
  it('names the card the first answer was built from while its gesture is asked, though the set redrew the card', () => {
    expect(drawn(bash('pnpm deploy'), { phase: 'asking', answer: allow, operation: null, card: bash('pnpm test') })).toBe('Face ID approves: Allow pnpm test in main');
  });

  it("names the retained operation's card on a Retry", () => {
    const operation = { opId: 'op-1' } as Extract<Attempt, { phase: 'outcome' }>['operation'];
    expect(drawn(bash('pnpm deploy'), { phase: 'asking', answer: allow, operation, card: bash('pnpm test') })).toBe('Face ID approves: Allow pnpm test in main');
  });
});
