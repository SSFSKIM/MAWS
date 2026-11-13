// Why a session control is greyed for a session on another machine (P5 O7 M8, docs/doperpowers/plans/2026-10-28-p5-o7-
// remote-lane-b.md, "The offer audit and its contract"): a command the shared set declares not offered there is greyed
// with that entry's words, before anything is asked; for an older peer, a command the machine was heard refusing
// `not-offered` is greyed with the machine's name, until its feed opens again. A session of this Mac, or of a machine
// whose sessions take the manager's path, greys nothing. The UX wave, U9 (M4; docs/doperpowers/plans/2026-11-12-ux-wave-
// U9-other-machines.md, Interfaces §4): an act offered over the link reads UC-7.5's first table from the roster and the
// link's phase (`disabledWords`); M1's bridge is gone.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { REMOTE_UNAVAILABLE, SESSION_ACTS_CAPABILITY } from '@shared/ipc/remote-unavailable';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressOf } from '@shared/machine/address';
import { remoteRow } from '../../../../test/support/builders';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { forgetOffers, heardRefusal, REMOTE_SURFACE_WORDS, resetRemoteSurfaces } from '../artifacts/remote-surfaces';
import { useMachines } from '../stores/machines';
import { useSessions } from '../stores/sessions';
import { BUSY_REASON } from '../composer/InlineEdit';
import * as helper from './remote-unavailable';
import { remoteUnavailableOf, TURN_RUNS, useForkUnavailable, useRemoteUnavailable, useRemoteUnavailableAs } from './remote-unavailable';
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
  cleanup(); // a hook still mounted would render the reset below after the bridge is gone, and read no local machine
  useSessions.setState({ listed: new Map(), listedMachines: new Set() });
  delete (window as { maws?: unknown }).maws;
});

// The UX wave (U9, M1) offers `session.rename` now: the declared example is one that stays declared, `session.delete`.
const MINI: MachineState = { ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00.000Z', generation: 1, carrier: 'relay' };
const roster = (over: Partial<MachineState>) => useMachines.getState().applyRoster([{ ...MINI, ...over }]);
const SERVES = { capabilities: [SESSION_ACTS_CAPABILITY], owner: true };
const OFFERED = ['session.archive', 'session.update', 'session.rename', 'attention.acknowledge', 'session.steer.cancel', 'maws.pane.answer', 'session.fork'] as const;

describe('remoteUnavailableOf', () => {
  it('has no bridge left: the acts M1 and M2 offer are read from the offers, not from a list of the helper’s own', () => {
    expect(Object.keys(helper)).not.toContain('ACTS_UNTIL_M4');
    roster(SERVES);
    for (const command of OFFERED) {
      expect(REMOTE_UNAVAILABLE[command], command).toBeUndefined();
      expect(remoteUnavailableOf(R, command), command).toBeNull();
      expect(remoteUnavailableOf(L, command), command).toBeNull();
    }
  });

  it('closes an offered act on a machine whose build doesn’t list the capability, with the update sentence (A14)', () => {
    roster({ capabilities: ['rl2.project-acts'], owner: true });
    expect(remoteUnavailableOf(R, 'session.rename')).toBe('Can’t rename on mini yet. Update MAWS on mini and try again.');
    expect(remoteUnavailableOf(R, 'session.archive')).toBe('Can’t archive on mini yet. Update MAWS on mini and try again.');
    expect(remoteUnavailableOf(R, 'session.fork')).toBe('Can’t fork on mini yet. Update MAWS on mini and try again.');
    expect(remoteUnavailableOf(R, 'attention.acknowledge')).toBe('Can’t dismiss on mini yet. Update MAWS on mini and try again.');
    expect(remoteUnavailableOf(L, 'session.rename')).toBeNull();
  });

  it('words the link’s phase: offline for every act with words, connecting and reconnecting for the menu acts alone', () => {
    roster({ state: 'down', generation: 0, since: new Date().toISOString() });
    expect(remoteUnavailableOf(R, 'session.rename')).toBe('Rename is unavailable while mini is offline.');
    expect(remoteUnavailableOf(R, 'attention.acknowledge')).toBe('Dismiss is unavailable while mini is offline.');
    roster({ state: 'connecting', generation: 0 });
    expect(remoteUnavailableOf(R, 'session.archive')).toBe('Connecting to mini…');
    expect(remoteUnavailableOf(R, 'attention.acknowledge')).toBeNull(); // held under the link's hold, as Send and Stop are
    roster({ state: 'down', generation: 1, since: new Date().toISOString() });
    expect(remoteUnavailableOf(R, 'session.update')).toBe('Reconnecting to mini…');
  });

  it('closes Fork for a member known not to own the machine', () => {
    roster({ ...SERVES, owner: false });
    expect(remoteUnavailableOf(R, 'session.fork')).toBe('Only mini’s owners can fork a session there.');
    expect(remoteUnavailableOf(R, 'session.rename')).toBeNull();
  });

  it('takes the older peer’s rule only for a command outside REMOTE_NEEDS: the capability says the rest', () => {
    roster(SERVES);
    heardRefusal('session.rename', NOT_OFFERED, OTHER_MACHINE, TEST_MACHINE);
    expect(remoteUnavailableOf(R, 'session.rename')).toBeNull();
  });

  it('greys a declared command for a session on another machine with the declared words, and nothing of this Mac’s', () => {
    expect(remoteUnavailableOf(R, 'session.delete')).toBe(REMOTE_UNAVAILABLE['session.delete']);
    expect(remoteUnavailableOf(L, 'session.delete')).toBeNull();
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
    expect(remoteUnavailableOf(A, 'session.delete')).toBe(REMOTE_UNAVAILABLE['session.delete']);
    heardRefusal('session.mcpReconnect', NOT_OFFERED, OTHER_MACHINE, TEST_MACHINE);
    expect(remoteUnavailableOf(A, 'session.mcpReconnect')).toBe(REMOTE_SURFACE_WORDS.notOffered('mini'));
    const { result } = renderHook(() => useRemoteUnavailable(A, 'session.delete'));
    expect(result.current).toBe(REMOTE_UNAVAILABLE['session.delete']);
  });

  it('greys nothing for a session whose machine’s sessions take the manager’s path (no RL2 rows cover it)', () => {
    useSessions.setState({ listed: new Map(), listedMachines: new Set() });
    expect(remoteUnavailableOf(R, 'session.delete')).toBeNull();
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
    const { result } = renderHook(() => useRemoteUnavailable(null, 'session.delete'));
    expect(result.current).toBeNull();
  });

  it('follows the roster: an act the machine starts to serve opens', () => {
    roster({ capabilities: [], owner: true });
    const { result } = renderHook(() => useRemoteUnavailable(R, 'session.archive'));
    expect(result.current).toBe('Can’t archive on mini yet. Update MAWS on mini and try again.');
    act(() => roster(SERVES));
    expect(result.current).toBeNull();
  });
});

describe('useRemoteUnavailableAs', () => {
  it('words a control by its own label where the act has no words of its own or another label', () => {
    roster({ capabilities: [], owner: true });
    const { result } = renderHook(() => useRemoteUnavailableAs('edit', R, 'session.steer.cancel'));
    expect(result.current).toBe('Can’t edit on mini yet. Update MAWS on mini and try again.');
    const local = renderHook(() => useRemoteUnavailableAs('edit', L, 'session.steer.cancel'));
    expect(local.result.current).toBeNull();
  });
});

describe('useForkUnavailable', () => {
  const listing = (state: string) => useSessions.setState({ listed: new Map([[R, { ...remoteRow(OTHER_MACHINE, 'app-r', { state }), appId: R }]]) });

  it('says the turn runs while the one reader of the session’s state says it works, in the composer’s words', () => {
    expect(TURN_RUNS).toBe(BUSY_REASON);
    roster(SERVES);
    listing('busy');
    const { result } = renderHook(() => useForkUnavailable(R));
    expect(result.current).toBe(TURN_RUNS);
    act(() => listing('idle'));
    expect(result.current).toBeNull();
  });

  it('answers the offers’ sentence first, and nothing for a session on this Mac, where Fork is unchanged', () => {
    roster({ capabilities: [], owner: true });
    listing('busy');
    expect(renderHook(() => useForkUnavailable(R)).result.current).toBe('Can’t fork on mini yet. Update MAWS on mini and try again.');
    expect(renderHook(() => useForkUnavailable(L)).result.current).toBeNull();
    expect(renderHook(() => useForkUnavailable(null)).result.current).toBeNull();
  });
});
