import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import type { ProjectId } from '@shared/graph/ids';
import { isAddress, machineOf } from '@shared/machine/address';
import { fakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { createSession, isSessionCreatorRegistered } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { hostStatus } from '../test-support/host-status';
import { connectScenarioSessionCreator } from './scenario-session-creator';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the scenario’s session creator', () => {
  afterEach(() => {
    useLayout.setState({ main: LAYOUT_DEFAULTS.main });
    useSessions.setState({ unstarted: new Map(), records: new Map() });
  });

  it('registers in launch mode scenario and allocates a fresh id with no record each time', async () => {
    const off = connectScenarioSessionCreator(fakeClient({ 'session.launchMode': { mode: 'scenario' } }).client);
    await settle();
    expect(isSessionCreatorRegistered()).toBe(true);
    await createSession('proj-maws' as ProjectId);
    await createSession(null);
    const ids = [...useSessions.getState().unstarted.keys()];
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids.map((id) => isAddress(id) && machineOf(id))).toEqual([TEST_MACHINE, TEST_MACHINE]); // P5 O6 M2: the client's machine's addresses
    expect(useSessions.getState().records.size).toBe(0);
    off();
    expect(isSessionCreatorRegistered()).toBe(false);
  });

  it('registers nothing in launch mode index, or when main does not answer', async () => {
    const index = connectScenarioSessionCreator(fakeClient({ 'session.launchMode': { mode: 'index' } }).client);
    await settle();
    expect(isSessionCreatorRegistered()).toBe(false);
    index();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = fakeClient();
    const off = connectScenarioSessionCreator(failing.client);
    await failing.fail('session.launchMode');
    expect(isSessionCreatorRegistered()).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    off();
    warn.mockRestore();
  });

  it('a disconnect before main answers registers nothing', async () => {
    const fake = fakeClient();
    const off = connectScenarioSessionCreator(fake.client);
    off();
    await fake.reply('session.launchMode', { mode: 'scenario' });
    expect(isSessionCreatorRegistered()).toBe(false);
  });

  // 2026-10-31: an upgrade's mawsd restart answered the page's one ask host_unavailable, and new sessions stayed disabled
  it('asks again when the local machine’s host is heard after a failure, and registers once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = fakeClient();
    const off = connectScenarioSessionCreator(fake.client);
    await fake.fail('session.launchMode', 'machine is restarting; cannot answer session.launchMode', 'host_unavailable');
    expect(isSessionCreatorRegistered()).toBe(false);
    fake.event('host.status', hostStatus(), OTHER_MACHINE); // another machine's host says nothing of this one's
    expect(fake.pending('session.launchMode')).toBe(0);
    fake.event('host.status', hostStatus());
    expect(fake.pending('session.launchMode')).toBe(1);
    await fake.reply('session.launchMode', { mode: 'scenario' });
    expect(isSessionCreatorRegistered()).toBe(true);
    fake.event('host.status', hostStatus()); // answered: not asked again
    expect(fake.invoked('session.launchMode')).toHaveLength(2);
    off();
    expect(isSessionCreatorRegistered()).toBe(false);
    warn.mockRestore();
  });

  it('a host heard while the ask is out asks again at once when it fails; a disconnect stops the asking', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = fakeClient();
    const off = connectScenarioSessionCreator(fake.client);
    fake.event('host.status', hostStatus()); // heard before the failure arrives
    expect(fake.pending('session.launchMode')).toBe(1);
    await fake.fail('session.launchMode', 'machine disconnected before answering session.launchMode', 'host_unavailable');
    expect(fake.pending('session.launchMode')).toBe(1);
    await fake.fail('session.launchMode', 'the spine did not load', 'host_unavailable');
    off();
    fake.event('host.status', hostStatus());
    expect(fake.pending('session.launchMode')).toBe(0);
    expect(fake.invoked('session.launchMode')).toHaveLength(2);
    expect(isSessionCreatorRegistered()).toBe(false);
    warn.mockRestore();
  });
});
