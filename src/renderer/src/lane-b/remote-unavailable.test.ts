// Why a session control is greyed for a session on another machine (P5 O7 M8, docs/doperpowers/plans/2026-10-28-p5-o7-
// remote-lane-b.md, "The offer audit and its contract"): a command the shared set declares not offered there is greyed
// with that entry's words, before anything is asked; for an older peer, a command the machine was heard refusing
// `not-offered` is greyed with the machine's name, until its feed opens again. A session of this Mac, or of a machine
// whose sessions take the manager's path, greys nothing.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { REMOTE_UNAVAILABLE } from '@shared/ipc/remote-unavailable';
import { addressOf } from '@shared/machine/address';
import { remoteRow } from '../../../../test/support/builders';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { forgetOffers, heardRefusal, REMOTE_SURFACE_WORDS, resetRemoteSurfaces } from '../artifacts/remote-surfaces';
import { useMachines } from '../stores/machines';
import { useSessions } from '../stores/sessions';
import { remoteUnavailableOf, useRemoteUnavailable } from './remote-unavailable';
import { resetRemoteLaneBStore } from './remote-session';

const R = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
const L = at('app-l' as AppSessionId);
const NOT_OFFERED = { issues: { refusal: 'not-offered' } };

beforeEach(() => {
  window.maws = { localMachine: TEST_MACHINE } as never;
  resetRemoteSurfaces();
  resetRemoteLaneBStore();
  useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00.000Z', generation: 1, carrier: 'relay' }]);
  useSessions.setState({ listed: new Map([[R, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: R }]]), listedMachines: new Set([OTHER_MACHINE]) });
});
afterEach(() => {
  useSessions.setState({ listed: new Map(), listedMachines: new Set() });
  delete (window as { maws?: unknown }).maws;
});

describe('remoteUnavailableOf', () => {
  it('greys a declared command for a session on another machine with the declared words, and nothing of this Mac’s', () => {
    expect(remoteUnavailableOf(R, 'session.rename')).toBe(REMOTE_UNAVAILABLE['session.rename']);
    expect(remoteUnavailableOf(L, 'session.rename')).toBeNull();
    expect(remoteUnavailableOf(R, 'session.mcpReconnect')).toBeNull(); // offered there
  });

  it('greys the first of several commands that is declared or heard refused', () => {
    expect(remoteUnavailableOf(R, 'session.reloadPlugins', 'session.reloadSkills')).toBe(REMOTE_UNAVAILABLE['session.reloadSkills']);
  });

  it('greys a command an older machine was heard refusing not-offered, with its name, until its feed opens again', () => {
    heardRefusal('session.mcpReconnect', NOT_OFFERED, OTHER_MACHINE, TEST_MACHINE);
    expect(remoteUnavailableOf(R, 'session.mcpReconnect')).toBe(REMOTE_SURFACE_WORDS.notOffered('mini'));
    heardRefusal('session.mcpReconnect', NOT_OFFERED, TEST_MACHINE, TEST_MACHINE); // this Mac's own: not an offer
    expect(remoteUnavailableOf(L, 'session.mcpReconnect')).toBeNull();
    heardRefusal('session.mcpToggle', { issues: { refusal: 'grade' } }, OTHER_MACHINE, TEST_MACHINE); // a refusal of the member, not of the offer
    expect(remoteUnavailableOf(R, 'session.mcpToggle')).toBeNull();
    forgetOffers(OTHER_MACHINE);
    expect(remoteUnavailableOf(R, 'session.mcpReconnect')).toBeNull();
  });

  it('greys a lane A session on an RL2 machine too: its adapter takes only laneA.*, the rest reach the machine as lane B’s', () => {
    const A = addressOf(OTHER_MACHINE, 'app-a' as AppSessionId);
    useSessions.setState({ listed: new Map([[A, { ...remoteRow(OTHER_MACHINE, 'app-a', { lane: 'A' }), appId: A }]]), listedMachines: new Set([OTHER_MACHINE]) });
    expect(remoteUnavailableOf(A, 'session.rename')).toBe(REMOTE_UNAVAILABLE['session.rename']);
    heardRefusal('session.mcpReconnect', NOT_OFFERED, OTHER_MACHINE, TEST_MACHINE);
    expect(remoteUnavailableOf(A, 'session.mcpReconnect')).toBe(REMOTE_SURFACE_WORDS.notOffered('mini'));
    const { result } = renderHook(() => useRemoteUnavailable(A, 'session.rename'));
    expect(result.current).toBe(REMOTE_UNAVAILABLE['session.rename']);
  });

  it('greys nothing for a session whose machine’s sessions take the manager’s path (no RL2 rows cover it)', () => {
    useSessions.setState({ listed: new Map(), listedMachines: new Set() });
    expect(remoteUnavailableOf(R, 'session.rename')).toBeNull();
  });
});

describe('useRemoteUnavailable', () => {
  it('follows a refusal heard while it is shown', () => {
    const { result } = renderHook(() => useRemoteUnavailable(R, 'maws.ask.answer'));
    expect(result.current).toBeNull();
    act(() => heardRefusal('maws.ask.answer', NOT_OFFERED, OTHER_MACHINE, TEST_MACHINE));
    expect(result.current).toBe(REMOTE_SURFACE_WORDS.notOffered('mini'));
  });

  it('greys nothing for no session', () => {
    const { result } = renderHook(() => useRemoteUnavailable(null, 'session.rename'));
    expect(result.current).toBeNull();
  });
});
