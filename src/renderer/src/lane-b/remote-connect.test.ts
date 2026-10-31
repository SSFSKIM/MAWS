// Another machine's lane B sessions in this window (P5 O7 M2): a listed lane B row opens its session's tab through O8's
// opener registry (a session main could not place is tried again), and a pane's opening read of a session, which is what
// makes main say a held session's record, parts and state again (a reload, a second window), goes only once the page
// listens for what it says.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { record, remoteRow, status } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { connectShell } from '../ipc/events';
import { remoteOpenerFor } from '../sessions/remote-openers';
import { createLayoutStore, useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { createSessionsStore, useSessions } from '../stores/sessions';
import { createAttentionStore } from '../stores/attention';
import { createMachinesStore } from '../stores/machines';
import { announceRemotePane, connectRemoteLaneB } from './remote-connect';
import { applyRemoteSession, remoteLaneBStateOf, resetRemoteLaneBStore } from './remote-session';
import { remoteSessionState } from './test-support/remote-session';

const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
const listed = { ...remoteRow(OTHER_MACHINE, 'app-r', { lane: 'B' }), appId: REMOTE };

const offs: Array<() => void> = [];
beforeEach(() => {
  resetRemoteLaneBStore();
  useSessions.setState({ listed: new Map([[REMOTE, listed]]), listedMachines: new Set([OTHER_MACHINE]) });
});
afterEach(() => {
  for (const off of offs.splice(0)) off();
});

describe('connectRemoteLaneB', () => {
  it('registers lane B’s opener: a listed lane B row opens its session’s tab, and unregisters it', () => {
    const fake = fakeClient();
    const off = connectRemoteLaneB(fake.client);
    remoteOpenerFor('B')!(listed);
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: REMOTE });
    off();
    expect(remoteOpenerFor('B')).toBeNull();
  });

  it('tries again a session main could not place: the click writes the tabs again, which re-opens every held address', async () => {
    const fake = fakeClient({ 'layout.set': undefined });
    useLayout.setState({ hydrated: true });
    offs.push(connectRemoteLaneB(fake.client));
    applyRemoteSession(remoteSessionState(REMOTE, { stream: 'opening', reason: 'Opening on mini…' }));
    remoteOpenerFor('B')!(listed);
    expect(fake.invoked('layout.set')).toEqual([]); // still opening: the tab's interest is enough
    applyRemoteSession(remoteSessionState(REMOTE, { stream: 'ended', reason: 'mini can’t place this session' }));
    remoteOpenerFor('B')!(listed);
    expect(fake.invoked('layout.set')).toEqual([{ key: 'main.tabs', value: useLayout.getState().main }]);
    useLayout.setState({ hydrated: false });
  });

  it('asks for a pane’s session only once connected, after every event the answer replays is listened for', async () => {
    const fake = fakeClient({ 'machines.list': { machines: [] }, 'org.rows': { machines: [], rows: [], members: [], member: null, complete: true, pending: [] }, 'session.get': null });
    announceRemotePane(REMOTE); // before the page listens: held
    expect(fake.invoked('session.get')).toEqual([]);
    const stores = { sessions: createSessionsStore(), attention: createAttentionStore(), layout: createLayoutStore(), machines: createMachinesStore() };
    offs.push(connectShell(fake.client, stores, { batchMs: 0 }));
    offs.push(connectRemoteLaneB(fake.client));
    expect(fake.invoked('session.get')).toEqual([{ appSessionId: REMOTE }]);
    const asked = fake.calls.indexOf('invoke session.get');
    // (the queue and the catalogue are each attached by what draws them, which reads them itself after listening)
    for (const name of ['session.changed', 'session.status', 'attention.changed', 'remote.session']) {
      const listened = fake.calls.indexOf(`on ${name}`);
      expect(listened, name).toBeGreaterThanOrEqual(0);
      expect(listened, name).toBeLessThan(asked);
    }
    // what main says again after the read lands in the stores
    fake.event('session.changed', { record: record(REMOTE), cause: 'live', revision: 5 }, OTHER_MACHINE);
    fake.event('session.status', { appSessionId: REMOTE, status: status(REMOTE) }, OTHER_MACHINE);
    fake.event('remote.session', remoteSessionState(REMOTE), OTHER_MACHINE);
    expect(stores.sessions.getState().records.get(REMOTE)?.appId).toBe(REMOTE);
    expect(stores.sessions.getState().engine.get(REMOTE)?.process).toBe('ready');
    expect(remoteLaneBStateOf(REMOTE)?.stream).toBe('live');
    // a pane announced once connected asks at once
    announceRemotePane(REMOTE);
    expect(fake.invoked('session.get')).toHaveLength(2);
  });
});
