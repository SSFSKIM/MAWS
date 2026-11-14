// A session's machine as the window's controls read it (the UX wave, U9, M3; ./remote-standing.ts): only a session
// reached over RL2 has a standing, and only the offline phase closes Send and Stop with UC-7.5's sentence.
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressOf } from '@shared/machine/address';
import { remoteRow } from '../../../../test/support/builders';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { useMachines } from '../stores/machines';
import { useSessions } from '../stores/sessions';
import { resetShellStores } from '../test-support/shell-stores';
import { resetRemoteLaneBStore } from './remote-session';
import { offlineActs, remoteStandingOf, useRemoteStanding } from './remote-standing';

const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
const here: MachineState = { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-11-13T08:00:00.000Z', generation: 0 };
const studio = (over: Partial<MachineState>): MachineState => ({ ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: new Date().toISOString(), generation: 1, ...over });
const listedOverRl2 = () => useSessions.setState({ listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: REMOTE }]]), listedMachines: new Set([OTHER_MACHINE]) });

beforeEach(() => {
  resetShellStores();
  resetRemoteLaneBStore();
});

describe('a session’s remote standing', () => {
  it('names the machine, its phase, its capabilities and ownership for a session reached over RL2', () => {
    listedOverRl2();
    useMachines.getState().applyRoster([here, studio({ capabilities: ['rl2.session-acts'], owner: true, carrier: 'relay' })]);
    const expected = { machine: 'Studio', phase: 'up', capabilities: ['rl2.session-acts'], owner: true };
    expect(remoteStandingOf(REMOTE)).toEqual(expected);
    expect(renderHook(() => useRemoteStanding(REMOTE)).result.current).toEqual(expected);
  });

  it('has none for a session on this Mac or on a machine whose sessions take the manager’s path', () => {
    useMachines.getState().applyRoster([here, studio({ state: 'down', generation: 0 })]);
    expect(remoteStandingOf(at('app-l' as AppSessionId))).toBeNull();
    expect(remoteStandingOf(REMOTE), 'a socket-linked machine: no org rows cover it').toBeNull();
    expect(renderHook(() => useRemoteStanding(REMOTE)).result.current).toBeNull();
  });

  it('closes Send and Stop with UC-7.5’s sentence in the offline phase alone', () => {
    listedOverRl2();
    useMachines.getState().applyRoster([here, studio({ state: 'down', generation: 0 })]);
    expect(offlineActs(remoteStandingOf(REMOTE))).toEqual({ send: 'Send is unavailable while Studio is offline.', stop: 'Stop is unavailable while Studio is offline.' });
    for (const entry of [studio({ state: 'connecting', generation: 0 }), studio({ state: 'down' }), studio({ state: 'down', refusal: 'removed' }), studio({})]) {
      useMachines.getState().applyRoster([here, entry]);
      expect(offlineActs(remoteStandingOf(REMOTE)), `${entry.state} ${entry.refusal ?? ''}`).toBeNull();
    }
    expect(offlineActs(null)).toBeNull();
  });
});
