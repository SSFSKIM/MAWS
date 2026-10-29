// P5 O8 M4a: the Org page's Machines group (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, *Machines in
// M4a*): read-only, each listed machine with its owners by name and whether it is up. Up follows the renderer's
// `useMachines` store (which `machines.changed` feeds through `connectShell`), not the view: a link drops with no new head.
import { act, screen, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { MachineState } from '@shared/ipc/schema/machines';
import { useMachines } from '../../stores/machines';
import { MINI, ROOT, VIEW, VM, emit, found, group, renderSection, resetHarness, row, sent, signing, viewWith } from './test-support';

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(resetHarness);

const linked = (ref: MachineState['ref'], state: MachineState['state']): MachineState => ({ ref, name: 'ignored', local: false, state, since: '2026-10-28T11:00:00.000Z', generation: 1 });
// What `connectShell` does with each `machines.changed`: the whole list into the store.
const machinesChanged = (machines: MachineState[]) => act(() => useMachines.getState().applyRoster(machines));

describe('Settings › Org: Machines (M4a)', () => {
  it('each machine draws its row: its name, its owners by name, the org’s named so, a former member so', async () => {
    renderSection(signing(ROOT), { 'org.view': () => viewWith({ machines: [...VIEW.machines, { name: 'old-box', ref: 'OldBoxRef00000000003', owners: ['ffffffffffffffffffffffffffffffff'] }] }) });
    const machines = await group('machines');
    expect(within(await found('mini')).getByText('Owned by you and Ana')).toBeTruthy();
    expect(within(row('build-vm')).getByText('Owned by the org')).toBeTruthy();
    expect(within(row('old-box')).getByText('Owned by a former member')).toBeTruthy();
    expect(within(machines).queryAllByRole('button')).toEqual([]); // read-only in M4a
    expect(within(row('Enroll a machine')).getByText('deployment admin enroll <name>').className).toContain('font-mono');
    expect(within(row('Enroll a machine')).getByText('Enrolling from this page comes later.')).toBeTruthy();
  });

  it('a machine’s up state follows machines.changed while the org version stays the same', async () => {
    renderSection(signing(ROOT));
    await found('mini');
    expect(within(row('mini')).getByText('Not connected')).toBeTruthy(); // the roster names it not yet
    const reads = sent('org.view').length;
    machinesChanged([linked(MINI, 'connecting'), linked(VM, 'up')]);
    expect(within(row('mini')).getByText('Connecting…')).toBeTruthy();
    expect(within(row('build-vm')).getByText('Up')).toBeTruthy();
    machinesChanged([linked(MINI, 'up'), linked(VM, 'down')]);
    expect(within(row('mini')).getByText('Up')).toBeTruthy();
    expect(within(row('build-vm')).getByText('Offline')).toBeTruthy();
    expect(sent('org.view')).toHaveLength(reads); // no new view: the version is the same
    expect(within(row('Org state')).getByText(/^Version 12 /)).toBeTruthy();

    // and a new head leaves the up state where the store has it
    emit(signing(ROOT, { head: { version: 13, issued: new Date().toISOString() } }));
    await vi.waitFor(() => expect(sent('org.view')).toHaveLength(reads + 1));
    expect(within(row('mini')).getByText('Up')).toBeTruthy();
  });

  it('no machine enrolled yet is said so', async () => {
    renderSection(signing(ROOT), { 'org.view': () => viewWith({ machines: [] }) });
    expect(within(await group('machines')).getByText('No machines are enrolled yet.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'mini' })).toBeNull();
  });
});
