// The live word (the UX wave, U9, S-05; A7; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, Interfaces
// §10): a remote lane B session's listing carries its open tab's turn while a tab of the strip names its address, its
// machine's link is up, main still holds its status and the window holds its engine status; absent the moment any of
// those fails. The listing entry is where every reader of the session's state already reads it (sessions/listed-state.ts).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS, type TabRef } from '@shared/ipc/schema/layout';
import { addressOf } from '@shared/machine/address';
import { remoteRow, status } from '../../../../test/support/builders';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { useLayout } from '../stores/layout';
import { useMachines } from '../stores/machines';
import { useSessions } from '../stores/sessions';
import { startLiveWords } from './live-word';
import { applyRemoteSession, resetRemoteLaneBStore } from './remote-session';
import { remoteSessionState } from './test-support/remote-session';

const B1 = addressOf(OTHER_MACHINE, 'b1' as AppSessionId);
const PRIVATE = addressOf(OTHER_MACHINE, 'p1' as AppSessionId);
const tab = (id: AppSessionId): TabRef => ({ id: `session:${id}`, kind: 'session', appSessionId: id, pinned: false });
const tabs = (...ids: AppSessionId[]) => useLayout.setState({ main: { ...LAYOUT_DEFAULTS.main, panes: [{ tabs: ids.map(tab), activeTabId: ids[0] === undefined ? '' : tab(ids[0]).id }] } }); // UX wave U13a: one strip
const roster = (state: 'up' | 'down') =>
  useMachines.getState().applyRoster([
    { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: new Date().toISOString(), generation: 0 },
    { ref: OTHER_MACHINE, name: 'Studio', local: false, state, since: new Date().toISOString(), generation: 1, ...(state === 'up' && { carrier: 'relay' as const }) },
  ]);
const rows = (...listed: ReturnType<typeof remoteRow>[]) => useSessions.getState().applyRows({ machines: [OTHER_MACHINE], rows: listed, complete: true, pending: [], members: [], member: 'member-1' });
const engine = (id: AppSessionId, turn: boolean) =>
  useSessions.setState({ engine: new Map(useSessions.getState().engine).set(id, { ...status(id), turn: turn ? { id: 'ev-1', origin: 'human', startedAt: '2026-11-13T00:00:00Z', acceptedAt: null, userMessageUuids: [] } : null } as never) });
const live = (id: AppSessionId = B1) => useSessions.getState().listed.get(id)?.live;

let stop: () => void;
beforeEach(() => {
  resetRemoteLaneBStore();
  useSessions.setState({ listed: new Map(), listedMachines: new Set(), engine: new Map(), liveWords: new Map() });
  tabs(B1);
  roster('up');
  rows(remoteRow(OTHER_MACHINE, 'b1', { state: 'idle' }));
  applyRemoteSession(remoteSessionState(B1, { stream: 'live' }));
  stop = startLiveWords();
});
afterEach(() => stop());

describe('the live word', () => {
  it('is running while the held status has a turn, resting once it has none', () => {
    expect(live(), 'no engine status yet').toBeUndefined();
    engine(B1, true);
    expect(live()).toBe('running');
    engine(B1, false);
    expect(live()).toBe('resting');
  });

  it('is absent the moment any condition fails, and back when all hold again', () => {
    engine(B1, true);
    tabs();
    expect(live(), 'no tab names it').toBeUndefined();
    tabs(B1);
    expect(live()).toBe('running');
    roster('down');
    expect(live(), 'the link not up').toBeUndefined();
    roster('up');
    expect(live()).toBe('running');
    applyRemoteSession(remoteSessionState(B1, { stream: 'idle' }));
    expect(live(), 'main no longer holds its status').toBeUndefined();
    applyRemoteSession(remoteSessionState(B1, { stream: 'live' }));
    expect(live()).toBe('running');
    useSessions.setState({ engine: new Map() });
    expect(live(), 'no engine status').toBeUndefined();
  });

  it('survives the listing’s next issue, which replaces the entry', () => {
    engine(B1, true);
    rows(remoteRow(OTHER_MACHINE, 'b1', { state: 'waiting', revision: 2 }));
    expect(useSessions.getState().listed.get(B1)).toMatchObject({ state: 'waiting', live: 'running' });
  });

  it('is taken by a private session, whose listing came over the link', () => {
    tabs(PRIVATE);
    applyRemoteSession(remoteSessionState(PRIVATE, { stream: 'live' }));
    engine(PRIVATE, false);
    rows(remoteRow(OTHER_MACHINE, 'p1', { state: 'busy', audience: ['member-1'], policyRev: 1 }));
    expect(live(PRIVATE)).toBe('resting');
  });

  it('has nothing to ride on before the session’s listing arrives, and is there from the moment it does', () => {
    const fresh = addressOf(OTHER_MACHINE, 'f1' as AppSessionId); // just forked: no listing yet
    tabs(fresh);
    applyRemoteSession(remoteSessionState(fresh, { stream: 'live' }));
    engine(fresh, true);
    expect(useSessions.getState().listed.has(fresh)).toBe(false);
    rows(remoteRow(OTHER_MACHINE, 'f1', { state: 'idle' }));
    expect(live(fresh)).toBe('running');
  });

  it('is never a word for this Mac’s session or a socket-linked machine’s (no `remote.session`)', () => {
    const socket = addressOf(OTHER_MACHINE, 's1' as AppSessionId);
    tabs(socket);
    engine(socket, true);
    rows(remoteRow(OTHER_MACHINE, 's1'));
    expect(live(socket)).toBeUndefined();
  });
});
