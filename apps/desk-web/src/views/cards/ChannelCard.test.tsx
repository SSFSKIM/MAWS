// @vitest-environment happy-dom
// What the passkey gesture approves is the answer's own (P5 O13 M5, review round 1): the card the answer was built from,
// kept with the attempt, never the card as a later set redrew it. A Retry reseals the retained operation over the first
// card's digest, so it must say what that card asked, though sminos republished the request with another input since.
// While an answer is retained for a Retry, the card draws the retained request in full, labelled so, never the
// replacement sminos republished: two edits of one file, or commands alike for 60 characters, would read the same in
// the gesture line alone. A capped input says so, the retained one's included.
// A question with every question skipped is declined, as DX6's card and Esc in the terminal decline it, on either lane;
// an async one sends nothing and says why.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
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

const QUESTIONS = [{ question: 'Which way?', header: 'Way', multiSelect: false, options: [{ label: 'left' }, { label: 'right' }] }];
const digest = { session: 'la-1', request: 'toolu_q', tool: 'AskUserQuestion', input_sha256: 'h' };
const laneA = (more: Record<string, unknown> = {}): Card => ({ lane: 'A', raised: { request: 'toolu_q', session: 'la-1', tool: 'AskUserQuestion', input: { questions: QUESTIONS }, ...more } as never, launch: 'L1', digest });
const laneB = (): Card => ({
  lane: 'B',
  item: { id: 'att-rq-q', appSessionId: 'app-1', kind: 'question', request: { requestId: 'rq-q' } } as unknown as AttentionItem,
  request: { kind: 'question.requested', requestId: 'rq-q', questions: QUESTIONS } as unknown as SessionEvent,
  context: { launchId: 'l', engineSessionId: 'e' },
  digest,
  endpointDigest: digest,
});

function asked(card: Card, draftId: string) {
  const onAnswer = vi.fn();
  const onNote = vi.fn();
  render(<ChannelCard card={card} state={{ kind: 'open', window: false }} attempt={null} note={null} where="main" machine="mini" draftId={draftId} onAnswer={onAnswer} onRetry={() => {}} onNote={onNote} />);
  return { onAnswer, onNote };
}

describe('a question with every question skipped', () => {
  it('is declined, a native lane A question', () => {
    const { onAnswer } = asked(laneA(), 'skip-native');
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'decline' });
  });

  it('sends the answers given, when one was answered', () => {
    const { onAnswer } = asked(laneA(), 'answer-native');
    fireEvent.click(screen.getByRole('radio', { name: /left/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'question', answers: { 'Which way?': 'left' } });
  });

  it('is declined, a lane B question', () => {
    const { onAnswer } = asked(laneB(), 'skip-b');
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'decline' });
  });

  it('sends nothing for an async question, and says why', () => {
    const async = asked(laneA({ tool: 'mcp__sminos__AskUserQuestion', async: true }), 'skip-async');
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(async.onAnswer).not.toHaveBeenCalled();
    expect(async.onNote).toHaveBeenCalledWith('Nothing was sent: an async question waits for an answer to at least one of its questions, and cannot be declined.');
  });
});

describe('a retained answer', () => {
  const operation = { opId: 'op-1' } as Extract<Attempt, { phase: 'outcome' }>['operation'];
  const retained = (card: Card): Attempt => ({ phase: 'outcome', answer: allow, card, operation, outcome: { state: 'uncertain', why: 'no-ack' } });
  const uncertain = { kind: 'uncertain', offline: false } as const;
  function shown(card: Card, attempt: Attempt | null, state: Parameters<typeof ChannelCard>[0]['state'] = uncertain) {
    const { container } = render(<ChannelCard card={card} state={state} attempt={attempt} note={null} where="main" machine="mini" draftId="d" onAnswer={() => {}} onRetry={() => {}} onNote={() => {}} />);
    return container.textContent ?? '';
  }
  const long = 'pnpm vitest run --project desk-web apps/desk-web/src/cards/answers.test.ts';

  it('draws the request it retains, labelled as the one a Retry answers, and says when the request changed since', () => {
    const text = shown(bash(`${long} --bail`), retained(bash(long)));
    expect(text).toContain(long);
    expect(text).not.toContain(`${long} --bail`);
    expect(screen.getByTestId('retained').textContent).toBe('Retry sends the first answer again, to this request as it was then. It has changed since: the new request can be answered once this answer is known.');
    cleanup();
    shown(bash(long), retained(bash(long)));
    expect(screen.getByTestId('retained').textContent).toBe('Retry sends the first answer again, to this request as it was then.');
  });

  it('draws the request as it is once nothing is retained', () => {
    const text = shown(bash(`${long} --bail`), null, { kind: 'open', window: false });
    expect(text).toContain(`${long} --bail`);
    expect(screen.queryByTestId('retained')).toBeNull();
  });

  it('says when the input shown was capped, the retained request’s included', () => {
    const capped = (command: string): Card => {
      const card = bash(command) as Extract<Card, { lane: 'A' }>;
      return { ...card, raised: { ...card.raised, truncated: true } };
    };
    shown(capped('cat big'), null, { kind: 'open', window: false });
    expect(screen.getByTestId('truncated').textContent).toBe('The input shown was capped: the full input was too large to send. A decision binds to what is shown here.');
    cleanup();
    shown(bash('cat big'), retained(capped('cat big')));
    expect(screen.getByTestId('truncated')).toBeTruthy();
    cleanup();
    shown(capped('cat big'), retained(bash('cat big')));
    expect(screen.queryByTestId('truncated')).toBeNull();
  });
});
