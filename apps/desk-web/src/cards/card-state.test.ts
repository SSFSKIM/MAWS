// The adapter from what this tab did about a channel card (the client's normalized `Outcome`, M4) to the state the card
// draws (P5 O13 M5): one table, so a `done` envelope carrying a failure is never drawn as sent, an uncertain answer keeps
// its Retry and takes no new answer, and a card the snapshot no longer carries is closed.
import type { Digest } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { Answer, Operation, Outcome } from './answers';
import type { Card } from './cards';
import { channelCardState, type Attempt, type ChannelCardState } from './card-state';

const digest = (input = 'h1'): Digest => ({ session: 'app-1', request: 'rq-1', tool: 'Bash', input_sha256: input });
const laneA = (launch: string | null = 'L1'): Card => ({ lane: 'A', raised: { request: 'toolu_1', session: 'la-1', tool: 'Bash', input: { command: 'pnpm test' } }, launch, digest: { ...digest(), session: 'la-1', request: 'toolu_1' } });
const laneB = (fields: { engineSessionId?: string | null; requestId?: string | null; endpoint?: Digest | null; kind?: string } = {}): Card => ({
  lane: 'B',
  item: { id: 'item-1', appSessionId: 'app-1', request: { requestId: fields.requestId === undefined ? 'rq-1' : fields.requestId } } as unknown as AttentionItem,
  request: { kind: fields.kind ?? 'permission.requested', requestId: 'rq-1', toolName: 'Bash', input: { command: 'pnpm test' } } as unknown as SessionEvent,
  context: { launchId: 'launch-1', engineSessionId: fields.engineSessionId === undefined ? 'eng-1' : fields.engineSessionId },
  digest: digest(),
  endpointDigest: fields.endpoint === undefined ? digest() : fields.endpoint,
});

const allow: Answer = { kind: 'decision', decision: 'allow' };
const operation = { opId: 'op-1' } as Operation;
const asking: Attempt = { phase: 'asking', answer: allow, card: laneB(), operation: null };
const resealing: Attempt = { phase: 'asking', answer: allow, card: laneB(), operation };
const sending: Attempt = { phase: 'sending', answer: allow, card: laneB(), operation: null };
const ended = (outcome: Outcome, sent: Operation = operation): Attempt => ({ phase: 'outcome', answer: allow, card: laneB(), operation: sent, outcome });
/** The operation an answer to `card` built: its request digest and context are the card's. */
const sentFor = (card: Card): Operation =>
  ({
    opId: 'op-1',
    requestDigest: card.digest,
    context: card.lane === 'A' ? { lane: 'A', session: card.raised.session, launch: card.launch } : { lane: 'B', ...card.context },
  }) as Operation;

type Row = [string, { card: Card | null; attempt: Attempt | null; connected?: boolean }, ChannelCardState];

const rows: Row[] = [
  ['no answer yet: open', { card: laneB(), attempt: null }, { kind: 'open', window: false }],
  ['the gesture asked for: sending', { card: laneB(), attempt: asking }, { kind: 'sending' }],
  ['a Retry’s gesture asked for: sending', { card: laneB(), attempt: resealing }, { kind: 'sending' }],
  ['the act sent, no ack or done yet: sending', { card: laneB(), attempt: sending }, { kind: 'sending' }],
  ['done: sent', { card: laneB(), attempt: ended({ state: 'done', result: { outcome: 'delivered' } }) }, { kind: 'sent' }],
  ['done, and the snapshot no longer carries it: closed', { card: null, attempt: ended({ state: 'done', result: {} }) }, { kind: 'closed' }],
  ['a done envelope carrying a failure: failed by its code, answerable anew', { card: laneB(), attempt: ended({ state: 'failed', error: { code: 'not_pending', message: 'the engine’s words' } }) }, { kind: 'failed', code: 'not_pending', message: 'the engine’s words' }],
  ['a lane A failure, its code alone', { card: laneA(), attempt: ended({ state: 'failed', error: { code: 'not_pending' } }) }, { kind: 'failed', code: 'not_pending', message: '' }],
  ['a failure with nothing readable', { card: laneA(), attempt: ended({ state: 'failed', error: null }) }, { kind: 'failed', code: 'failed', message: '' }],
  ['the executor refused it (tombstoned): failed by its reason', { card: laneB(), attempt: ended({ state: 'refused', reason: 'tombstoned' }) }, { kind: 'failed', code: 'tombstoned', message: 'the session ended before the answer ran' }],
  ['refused at the endpoint (step-up): failed by its reason', { card: laneA(), attempt: ended({ state: 'refused', reason: 'step-up' }) }, { kind: 'failed', code: 'step-up', message: 'the machine did not accept the passkey’s approval' }],
  ['refused class', { card: laneA(), attempt: ended({ state: 'refused', reason: 'class' }) }, { kind: 'failed', code: 'class', message: 'this phone may not do that on a moved machine' }],
  ['refused with a reason no copy names: its code', { card: laneA(), attempt: ended({ state: 'refused', reason: 'novel' }) }, { kind: 'failed', code: 'novel', message: 'refused (novel)' }],
  ['refused digest-mismatch: the request changed', { card: laneB(), attempt: ended({ state: 'refused', reason: 'digest-mismatch' }, sentFor(laneB())) }, { kind: 'changed' }],
  ['refused context: the request changed', { card: laneA(), attempt: ended({ state: 'refused', reason: 'context' }, sentFor(laneA())) }, { kind: 'changed' }],
  ['refused digest-mismatch, the card drawn anew since over another input: open', { card: { ...laneA(), digest: { ...digest(), session: 'la-1', request: 'toolu_1', input_sha256: 'h2' } } as Card, attempt: ended({ state: 'refused', reason: 'digest-mismatch' }, sentFor(laneA())) }, { kind: 'open', window: false }],
  ['refused context, the session relaunched since: open', { card: laneA('L2'), attempt: ended({ state: 'refused', reason: 'context' }, sentFor(laneA())) }, { kind: 'open', window: false }],
  ['no ack: uncertain with Retry', { card: laneB(), attempt: ended({ state: 'uncertain', why: 'no-ack' }) }, { kind: 'uncertain', offline: false }],
  ['no done: uncertain', { card: laneB(), attempt: ended({ state: 'uncertain', why: 'no-done' }) }, { kind: 'uncertain', offline: false }],
  ['in-progress: uncertain', { card: laneA(), attempt: ended({ state: 'uncertain', why: 'in-progress' }) }, { kind: 'uncertain', offline: false }],
  ['unknown: uncertain', { card: laneA(), attempt: ended({ state: 'uncertain', why: 'unknown' }) }, { kind: 'uncertain', offline: false }],
  ['uncertain with the channel down: its Retry waits for the channel', { card: laneB(), attempt: ended({ state: 'uncertain', why: 'no-ack' }), connected: false }, { kind: 'uncertain', offline: true }],
  ['uncertain, and the snapshot no longer carries it: closed', { card: null, attempt: ended({ state: 'uncertain', why: 'no-ack' }) }, { kind: 'closed' }],
  ['uncertain on a card whose request changed: still its Retry', { card: laneB({ endpoint: digest('h2') }), attempt: ended({ state: 'uncertain', why: 'unknown' }) }, { kind: 'uncertain', offline: false }],
  ['the channel down: disconnected', { card: laneB(), attempt: null, connected: false }, { kind: 'disconnected' }],
  ['the channel down after a failure: disconnected', { card: laneB(), attempt: ended({ state: 'failed', error: null }), connected: false }, { kind: 'disconnected' }],
  ['a lane B session not prompted: not yet actionable', { card: laneB({ engineSessionId: null }), attempt: null }, { kind: 'not-actionable', why: 'not-prompted', text: "this session hasn't been prompted locally yet" }],
  ['an item naming no request: not yet actionable', { card: laneB({ requestId: null }), attempt: null }, { kind: 'not-actionable', why: 'no-request', text: "this request can't be answered from the phone yet" }],
  ['a lane A session with no bridge: not actionable', { card: laneA(null), attempt: null }, { kind: 'not-actionable', why: 'no-bridge', text: 'this session has no bridge running to take an answer' }],
  ['a lane B kind the phone does not answer', { card: laneB({ kind: 'plan.requested' }), attempt: null }, { kind: 'not-actionable', why: 'not-here', text: 'answer this one in MAWS' }],
  ['the endpoint’s digest differs from the phone’s: the request changed', { card: laneB({ endpoint: digest('h2') }), attempt: null }, { kind: 'changed' }],
  ['a card the snapshot no longer carries, never answered here: closed', { card: null, attempt: null }, { kind: 'closed' }],
];

describe('a channel card’s state', () => {
  it.each(rows)('%s', (_, input, expected) => {
    expect(channelCardState({ connected: true, ...input })).toEqual(expected);
  });

  it('never draws a done envelope that is not a success as sent', () => {
    const outcomes: Outcome[] = [{ state: 'failed', error: null }, { state: 'refused', reason: 'tombstoned' }, { state: 'uncertain', why: 'in-progress' }, { state: 'uncertain', why: 'unknown' }];
    for (const outcome of outcomes) expect(channelCardState({ card: laneB(), attempt: ended(outcome), connected: true }).kind, outcome.state).not.toBe('sent');
  });
});
