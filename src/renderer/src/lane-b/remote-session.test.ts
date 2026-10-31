// Another machine's lane B sessions in the page (P5 O7 M2): main's `remote.session` held per address, which sessions are
// lane B on another machine (their machine reached over RL2, the org rows not listing them as lane A), and the sends on
// their way to one.
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { remoteRow } from '../../../../test/support/builders';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { useSessions } from '../stores/sessions';
import { applyRemoteSession, beginRemoteSend, isRemoteLaneB, remoteLaneBStateOf, resetRemoteLaneBStore, useRemoteLaneB } from './remote-session';
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
