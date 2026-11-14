// Another machine's lane B sessions in the page (P5 O7 M2): main's `remote.session` held per address, which sessions are
// lane B on another machine (their machine reached over RL2, the org rows not listing them as lane A), and the sends on
// their way to one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { remoteRow } from '../../../../test/support/builders';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { useMachines } from '../stores/machines';
import { useSessions } from '../stores/sessions';
import { applyRemoteSession, applyRemoteSettled, beginRemoteSend, historyReadsNow, isRemoteLaneB, remoteLaneBStateOf, resetRemoteLaneBStore, SETTLE_BACKSTOP_MS, useRemoteLaneB, whenHistoryReads } from './remote-session';
import { remoteSessionState } from './test-support/remote-session';

const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);

beforeEach(() => {
  resetRemoteLaneBStore();
  useSessions.setState({ listed: new Map(), listedMachines: new Set() });
});

const list = (lane: 'A' | 'B') => {
  const row = remoteRow(OTHER_MACHINE, 'app-r', { lane });
  useSessions.setState({ listed: new Map([[REMOTE, { ...row, appId: REMOTE }]]), listedMachines: new Set([OTHER_MACHINE]) });
};

describe('the remote lane B store', () => {
  it('holds each session’s latest remote.session by its address', () => {
    applyRemoteSession(remoteSessionState(REMOTE, { stream: 'opening' }));
    applyRemoteSession(remoteSessionState(REMOTE, { stream: 'live' }));
    expect(remoteLaneBStateOf(REMOTE)?.stream).toBe('live');
    expect(remoteLaneBStateOf(at('app-local' as AppSessionId))).toBeNull();
  });

  it('counts the sends on their way to a session until each ends', () => {
    const one = beginRemoteSend(REMOTE);
    const two = beginRemoteSend(REMOTE);
    expect(useRemoteLaneB.getState().sending.get(REMOTE)).toBe(2);
    one();
    one(); // ending twice ends once
    expect(useRemoteLaneB.getState().sending.get(REMOTE)).toBe(1);
    two();
    expect(useRemoteLaneB.getState().sending.has(REMOTE)).toBe(false);
  });
});

describe('isRemoteLaneB', () => {
  it('is a session of an RL2 machine the rows cover that they do not list as lane A', () => {
    expect(isRemoteLaneB(REMOTE)).toBe(false); // no rows cover its machine (a socket-linked profile's sessions are the manager's)
    list('B');
    expect(isRemoteLaneB(REMOTE)).toBe(true);
    expect(isRemoteLaneB(addressOf(OTHER_MACHINE, 'app-unlisted' as AppSessionId))).toBe(true); // resumed or spawned here, listed later
    list('A');
    expect(isRemoteLaneB(REMOTE)).toBe(false); // O9's
  });

  it('is never a session of this machine', () => {
    useSessions.setState({ listedMachines: new Set([OTHER_MACHINE, TEST_MACHINE]) });
    expect(isRemoteLaneB(at('app-local' as AppSessionId))).toBe(false);
  });

  it('is a session main says a remote.session for, whatever the rows say yet', () => {
    applyRemoteSession(remoteSessionState(REMOTE));
    expect(isRemoteLaneB(REMOTE)).toBe(true);
  });
});

// The UX wave, U9 (M5, "The settled word"; Interfaces §9): main's `remote.settled` kept per machine, the generation last
// settled; a history read of the machine's session goes once the roster's current generation settled, or
// SETTLE_BACKSTOP_MS after the roster said up, or at once while the roster does not say it is up
describe('the settled word', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const rosterUp = (generation: number) =>
    useMachines.getState().applyRoster([
      { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: new Date().toISOString(), generation: 0 },
      { ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: new Date().toISOString(), generation, carrier: 'relay' },
    ]);

  it('is kept per machine, said again by a replay', () => {
    applyRemoteSettled({ machine: OTHER_MACHINE, generation: 2 });
    applyRemoteSettled({ machine: OTHER_MACHINE, generation: 2 });
    expect(useRemoteLaneB.getState().settled).toEqual(new Map([[OTHER_MACHINE, 2]]));
    resetRemoteLaneBStore();
    expect(useRemoteLaneB.getState().settled.size).toBe(0);
  });

  it('lets a read go at the roster generation’s word, not an earlier one’s', () => {
    rosterUp(3);
    expect(historyReadsNow(OTHER_MACHINE)).toBe(false);
    applyRemoteSettled({ machine: OTHER_MACHINE, generation: 2 });
    expect(historyReadsNow(OTHER_MACHINE)).toBe(false);
    applyRemoteSettled({ machine: OTHER_MACHINE, generation: 3 });
    expect(historyReadsNow(OTHER_MACHINE)).toBe(true);
  });

  it('waits for the word or the backstop, whichever is first', async () => {
    rosterUp(4);
    let went = false;
    void whenHistoryReads(OTHER_MACHINE).then(() => (went = true));
    await vi.advanceTimersByTimeAsync(SETTLE_BACKSTOP_MS - 1);
    expect(went).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(went, 'the backstop').toBe(true);
    rosterUp(5);
    let worded = false;
    void whenHistoryReads(OTHER_MACHINE).then(() => (worded = true));
    applyRemoteSettled({ machine: OTHER_MACHINE, generation: 5 });
    await vi.advanceTimersByTimeAsync(0);
    expect(worded, 'the word').toBe(true);
  });

  it('lets a read go at once for a machine the roster does not say is up, and for this Mac', () => {
    useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
    expect(historyReadsNow(OTHER_MACHINE)).toBe(true);
    expect(historyReadsNow(TEST_MACHINE)).toBe(true);
  });
});
