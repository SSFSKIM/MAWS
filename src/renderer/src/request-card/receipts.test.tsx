// UX wave U1b (the U1b document, Interfaces §G "The receipt"; decisions 8 and 21): the two writers of a question's
// receipt. The card, at a delivered answer to a question: the answers it sent, or a dismissal for the decline. The
// follower of the lane A store, started by `connectRequestCard()`: each settlement a terminal session's state lists,
// under that session's addressed id and the call the settlement names (the bridge's request id is the call's, C17).
// Every question, id and word is invented.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import type { LaneAState } from '@shared/ipc/schema/lane-a';
import { addressOf } from '@shared/machine/address';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { laneAState } from '../lane-a/test-support/lane-a-state';
import { useAttention } from '../stores/attention';
import { applyLaneAList, applyLaneAState, resetLaneAStore } from '../stores/lane-a';
import { resetShellStores } from '../test-support/shell-stores';
import { followSettlements } from './receipts';
import { RequestCard } from './RequestCard';
import { fixtureRequest, itemFor } from './test-requests';

const HERE = at('eng-here' as AppSessionId);
const THERE = addressOf(OTHER_MACHINE, 'eng-here' as AppSessionId); // one engine session on two machines
const CALL = 'toolu_asked' as ToolUseId;
const receiptOf = (session: AppSessionId, call: ToolUseId = CALL) => useAttention.getState().receipts.get(session)?.get(call);
type Settled = LaneAState['settled'][number];
const settled = (over: Partial<Settled>): Settled => ({ request: CALL, session: 'eng-here', winner: 'terminal', outcome: 'answered', by: 'terminal', ...over });
const stateWith = (session: AppSessionId, list: Settled[]) => laneAState(session, { engineSessionId: 'eng-here', settled: list });

let outcome: 'delivered' | 'not_pending' | 'write_failed' = 'delivered';
let stop: () => void = () => {};
let fake: FakeClient;
beforeEach(() => {
  resetShellStores();
  resetLaneAStore();
  useAttention.setState({ receipts: new Map() });
  outcome = 'delivered';
  fake = fakeClient({ 'session.answer': () => ({ outcome }) });
  window.maws = fake.client as unknown as PreloadBridge;
});
afterEach(() => {
  stop();
  stop = () => {};
  cleanup();
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('the follower of settlements', () => {
  it('words each settlement under its session and call: a dismissal; withdrawn by the bridge, nothing; any other outcome, the settlement’s words', () => {
    stop = followSettlements();
    applyLaneAState(HERE, stateWith(HERE, [
      settled({ request: 'toolu_dismissed', outcome: 'withdrawn', by: 'terminal' }),
      settled({ request: 'toolu_cleared', outcome: 'withdrawn', winner: 'other', by: 'bridge' }),
      settled({ request: 'toolu_answered' }),
      settled({ request: 'toolu_allowed', outcome: 'allow' }),
      settled({ request: 'toolu_mine', outcome: 'withdrawn', winner: 'web', by: 'maws' }), // this window's own dismissal
    ]));
    expect(receiptOf(HERE, 'toolu_dismissed' as ToolUseId)).toEqual({ dismissed: true });
    expect(receiptOf(HERE, 'toolu_cleared' as ToolUseId)).toBeUndefined();
    expect(receiptOf(HERE, 'toolu_answered' as ToolUseId)).toEqual({ settled: 'Answered in the terminal' });
    expect(receiptOf(HERE, 'toolu_allowed' as ToolUseId)).toEqual({ settled: 'Answered in the terminal: Allowed' });
    expect(receiptOf(HERE, 'toolu_mine' as ToolUseId)).toEqual({ dismissed: true });
  });

  it('never replaces the answers this window sent with a settlement', () => {
    stop = followSettlements();
    useAttention.getState().recordReceipt(HERE, CALL, { answers: { 'Which file?': 'a.ts' } });
    applyLaneAState(HERE, stateWith(HERE, [settled({ winner: 'web', by: 'maws' })]));
    expect(receiptOf(HERE)).toEqual({ answers: { 'Which file?': 'a.ts' } });
  });

  it('keeps one machine’s settlement off the other machine’s same session and call', () => {
    stop = followSettlements();
    applyLaneAState(THERE, { ...stateWith(THERE, [settled({ outcome: 'withdrawn' })]), link: { state: 'up', refusal: null, carrier: 'direct', member: 'm', clientClass: 'native-mac', rights: [], reason: null } });
    expect(receiptOf(THERE)).toEqual({ dismissed: true });
    expect(receiptOf(HERE)).toBeUndefined();
  });

  // After a reload the window's memory is empty; this Mac's services rebuild a terminal session's settlements from its
  // bridge's snapshot (`src/services/lane-a/state.ts`), and the list the window asks for carries them
  it('rebuilds a dismissal’s receipt from the lane A state this Mac’s services give a reloaded window, and from one held when it starts', () => {
    stop = followSettlements();
    expect(receiptOf(HERE)).toBeUndefined();
    applyLaneAList(TEST_MACHINE, [stateWith(HERE, [settled({ outcome: 'withdrawn', winner: 'web', by: 'maws' })])]);
    expect(receiptOf(HERE)).toEqual({ dismissed: true });
    stop();
    useAttention.setState({ receipts: new Map() });
    stop = followSettlements();
    expect(receiptOf(HERE)).toEqual({ dismissed: true });
  });

  it('writes nothing once stopped', () => {
    stop = followSettlements();
    stop();
    applyLaneAState(HERE, stateWith(HERE, [settled({})]));
    expect(receiptOf(HERE)).toBeUndefined();
  });
});

describe('the card’s own receipt', () => {
  const question = fixtureRequest('pass1', 'question-roundtrip', 137);
  const declinable = fixtureRequest('pass3', 'question-deny', 108);
  const mount = (event: typeof question) => {
    const item = itemFor(event, HERE);
    render(<RequestCard item={item} request={event} placement="inline" paneIndex={0} />);
    return item;
  };

  it('a delivered answer writes the answers it sent under the item’s session and call', async () => {
    const item = mount(question);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await user.click(screen.getByRole('checkbox', { name: 'Apple' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(receiptOf(HERE, item.request.toolUseId!)).toEqual({ answers: { 'Which fruits do you like?': 'Apple' } }));
  });

  it('a delivered Dismiss writes a dismissal', async () => {
    const item = mount(declinable);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(receiptOf(HERE, item.request.toolUseId!)).toEqual({ dismissed: true }));
  });

  it.each(['write_failed', 'not_pending'] as const)('an answer that was not delivered (%s) writes nothing', async (failed) => {
    outcome = failed;
    const item = mount(declinable);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));
    await screen.findByText(failed === 'write_failed' ? "Couldn't deliver the answer" : 'Already answered elsewhere');
    expect(fake.invoked('session.answer')).toHaveLength(1);
    expect(receiptOf(HERE, item.request.toolUseId!)).toBeUndefined();
  });
});
