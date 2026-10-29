// A side question to a terminal session driven through its bridge (P5 O9 M5, "The side question"): the bridge keeps no
// log, so the exchange is this window's, drawn pending at once and settled from the watch's `op` messages for the op id
// `laneA.btw` answered (the end's text, else its reason); the host's listing is never asked, and a retry is a new op.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { record } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { laneAState } from '../lane-a/test-support/lane-a-state';
import { OUTCOME_WAIT_MS, SIDE_ANSWER_WORDS } from '../lane-a/outcomes';
import { resetLaneAWatches } from '../lane-a/watches';
import { applyLaneAState, resetLaneAStore } from '../stores/lane-a';
import { useSessions } from '../stores/sessions';
import { LANE_A_WORDS } from '../session/controls/lane-a';
import { canAskSide } from './btw';
import { askSide, clearSide, refreshSide, resetSideQuestions, retrySide, sidePaneOf, useSidePane } from './store';

const A = 'app-side-a' as AppSessionId;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const msg = (kind: string, body: unknown, n: number | null = 1) => ({ project: '', machine: 'm', session: 'eng-1', kind, sub: 'w-1', n, body });
const exchanges = () => sidePaneOf(useSidePane.getState(), A).exchanges ?? [];
const asked = (id: string) => ({ 'laneA.btw': { state: 'done', result: { started: true, id } }, 'laneA.watch': { watch: 'w-1' }, 'laneA.unwatch': undefined });

beforeEach(() => {
  resetLaneAStore();
  resetLaneAWatches();
  resetSideQuestions();
  useSidePane.setState({ panes: new Map() });
  useSessions.setState({ engine: new Map(), digests: new Map(), records: new Map([[A, record(A, { holder: { kind: 'terminal', pid: 4242 } })]]) });
  applyLaneAState(A, laneAState(A));
});
afterEach(() => vi.useRealTimers());

describe('a lane A side question', () => {
  it('can be asked of a bridged session with no engine process', () => {
    expect(canAskSide(A)).toBe(true);
    applyLaneAState(A, laneAState(A, { controls: { btw: { available: false, reason: 'not yet' } } }));
    expect(canAskSide(A)).toBe(false);
  });

  it('is answered from its op’s end, without the host’s listing', async () => {
    const fake = fakeClient(asked('cmd-9'));
    await askSide(A, 'why?', fake.client);
    expect(exchanges()).toMatchObject([{ question: 'why?', state: 'pending' }]);
    await settle();
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [msg('op', { rpc: 'cmd-9', op: 'btw', phase: 'start', id: 'cmd-9' }), msg('op', { rpc: 'cmd-9', op: 'btw', phase: 'end', id: 'cmd-9', text: 'Because.' })] });
    expect(exchanges()).toMatchObject([{ question: 'why?', state: 'answered', response: 'Because.', error: null }]);
    await refreshSide(A, fake.client);
    await clearSide(A, fake.client);
    expect(fake.invoked('side.question.list')).toEqual([]);
    expect(fake.invoked('side.question.clear')).toEqual([]);
    expect(exchanges()).toEqual([]); // a new side conversation drops the answered one
  });

  it('settles from an end that arrived before the answer named the op', async () => {
    const fake = fakeClient({ 'laneA.watch': { watch: 'w-1' }, 'laneA.unwatch': undefined });
    const asking = askSide(A, 'quick?', fake.client);
    await settle();
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [msg('op', { rpc: 'cmd-3', op: 'btw', phase: 'end', id: 'cmd-3', text: 'Fast.' })] });
    await fake.reply('laneA.btw', { state: 'done', result: { started: true, id: 'cmd-3' } });
    await asking;
    expect(exchanges()).toMatchObject([{ state: 'answered', response: 'Fast.' }]);
  });

  it('fails with the bridge’s error, and a retry asks again as a new op', async () => {
    const fake = fakeClient({ 'laneA.watch': { watch: 'w-1' }, 'laneA.unwatch': undefined });
    const asking = askSide(A, 'busy?', fake.client);
    await fake.reply('laneA.btw', { state: 'done', result: { started: true, id: 'cmd-4' } });
    await asking;
    await settle();
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [msg('op', { rpc: 'cmd-4', op: 'btw', phase: 'end', id: 'cmd-4', reason: 'api-error', error: 'overloaded' })] });
    const [failed] = exchanges();
    expect(failed).toMatchObject({ state: 'failed', error: 'overloaded' });
    const retrying = retrySide(A, failed!, fake.client);
    await fake.reply('laneA.btw', { state: 'done', result: { started: true, id: 'cmd-6' } });
    await retrying;
    expect(fake.invoked('laneA.btw')).toEqual([
      { appSessionId: A, prompt: 'busy?' },
      { appSessionId: A, prompt: 'busy?' },
    ]);
    expect(exchanges()).toMatchObject([{ question: 'busy?', state: 'pending' }]);
  });

  // A 504 means the op may have run: its id, which the bridge's answer named, is followed as a taken one's is.
  it('stays pending as uncertain after an unknown acknowledgement, and takes its op’s answer when it ends', async () => {
    const fake = fakeClient({ 'laneA.btw': { state: 'unknown', why: 'timeout', id: 'cmd-7' }, 'laneA.watch': { watch: 'w-1' }, 'laneA.unwatch': undefined });
    await askSide(A, 'still there?', fake.client);
    expect(exchanges()).toMatchObject([{ question: 'still there?', state: 'pending', error: LANE_A_WORDS.unknownAsk }]);
    await settle();
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [msg('op', { rpc: 'cmd-7', op: 'btw', phase: 'end', id: 'cmd-7', text: 'Yes.' })] });
    expect(exchanges()).toMatchObject([{ question: 'still there?', state: 'answered', response: 'Yes.', error: null }]);
  });

  it('can be asked again while uncertain, as a new op standing in its place', async () => {
    const fake = fakeClient({ 'laneA.btw': { state: 'unknown', why: 'timeout', id: 'cmd-8' }, 'laneA.watch': { watch: 'w-1' }, 'laneA.unwatch': undefined });
    await askSide(A, 'again?', fake.client);
    const [uncertain] = exchanges();
    const retrying = retrySide(A, uncertain!, fake.client);
    await settle();
    expect(fake.invoked('laneA.btw')).toHaveLength(2);
    await retrying;
    expect(exchanges()).toHaveLength(1);
  });

  it('fails an unknown acknowledgement that names no op, which nothing can follow', async () => {
    const fake = fakeClient({ 'laneA.btw': { state: 'unknown', why: 'gone' }, 'laneA.watch': { watch: 'w-1' }, 'laneA.unwatch': undefined });
    await askSide(A, 'gone?', fake.client);
    expect(exchanges()).toMatchObject([{ state: 'failed', error: LANE_A_WORDS.unknownAsk }]);
  });

  it('fails when no end arrives in time', async () => {
    vi.useFakeTimers();
    const fake = fakeClient(asked('cmd-5'));
    await askSide(A, 'lost?', fake.client);
    await vi.advanceTimersByTimeAsync(OUTCOME_WAIT_MS);
    expect(exchanges()).toMatchObject([{ state: 'failed', error: SIDE_ANSWER_WORDS.lost }]);
  });
});
