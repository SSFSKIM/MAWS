// "Hub unreachable" (P5 O7 M2, A2; P5 §3's hub-offline, channel-up): said once, in the sidebar's org header, while the
// hub can't be reached and another machine is still reached over RL2 (directly: the hub carries no relay now); never for
// a machine offline (its rows grey on their own), and never while no RL2 link is up.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MachineState } from '@shared/ipc/schema/machines';
import { T0 } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { REGISTERED } from '../settings-tab/org/test-support';
import { connectHubAccess, useHubAccess } from '../stores/hub-access';
import { useMachines } from '../stores/machines';
import { HubNotice } from './HubNotice';

const local: MachineState = { ref: TEST_MACHINE, name: 'MacBook', local: true, state: 'up', since: T0, generation: 0 };
const mini = (over: Partial<MachineState>): MachineState => ({ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: T0, generation: 1, ...over });

beforeEach(() => useHubAccess.setState({ access: null }));
afterEach(cleanup);

describe('connectHubAccess', () => {
  it('reads the hub’s access once and follows each change, a change heard first winning over the read', async () => {
    const fake = fakeClient();
    const off = connectHubAccess(fake.client);
    fake.event('org.changed', { ...REGISTERED, hubAccess: 'unreachable' });
    await fake.reply('org.status', { ...REGISTERED, hubAccess: 'connected' });
    expect(useHubAccess.getState().access).toBe('unreachable');
    fake.event('org.changed', { ...REGISTERED, hubAccess: 'connected' });
    expect(useHubAccess.getState().access).toBe('connected');
    fake.event('org.changed', { state: 'none' });
    expect(useHubAccess.getState().access).toBeNull();
    off();
  });
});

describe('HubNotice', () => {
  const show = (access: 'connected' | 'unreachable', machines: MachineState[]) => {
    act(() => {
      useHubAccess.setState({ access });
      useMachines.getState().applyRoster(machines);
    });
    render(<HubNotice />);
  };

  it('says “Hub unreachable” once while the hub is unreachable and a machine is reached over RL2', () => {
    for (const carrier of ['direct', 'relay'] as const) {
      show('unreachable', [local, mini({ carrier })]);
      expect(screen.getAllByText('Hub unreachable'), carrier).toHaveLength(1);
      cleanup();
    }
  });

  it('says nothing while the hub is reached, or while no RL2 link is up', () => {
    show('connected', [local, mini({ carrier: 'direct' })]);
    expect(screen.queryByText('Hub unreachable')).toBeNull();
    cleanup();
    show('unreachable', [local, mini({ state: 'down' })]);
    expect(screen.queryByText('Hub unreachable')).toBeNull();
    cleanup();
    show('unreachable', [local, mini({ carrier: 'socket' })]); // a second profile on this Mac: no hub between
    expect(screen.queryByText('Hub unreachable')).toBeNull();
  });
});
