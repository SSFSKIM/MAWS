// P5 O8 M4a: the Org page's People group (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's "At its end",
// "The rule the page states" and "Read-only, and refusals"): each member with email, role and devices, the roots marked;
// while this Mac may sign, the changes it offers, never one that refuses for yourself; read-only otherwise, with the
// roots' emails; and the later-device rule in place of Pair a device.
import { screen, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ANA_MAC, BEN_WEB, DEVICE, MY_OTHER_MAC, ROOT, VIEW, emit, found, group, renderSection, resetHarness, row, signing, viewWith } from './test-support';

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(resetHarness);

const buttons = (label: string) => within(row(label)).queryAllByRole('button').map((b) => b.textContent);
const device = (label: string, id: string) => within(row(label)).getByText(id.slice(0, 8)).closest('[data-org-device]') as HTMLElement;

describe('Settings › Org: People (M4a)', () => {
  it('each member draws its row: email, role and devices, the roots and this Mac marked', async () => {
    renderSection(signing(ROOT));
    const people = await group('people');
    expect(within(people).getAllByRole('group').map((g) => g.firstElementChild?.textContent)).toEqual(['Owner', 'Ana', 'Ben', 'Cat']);
    expect(within(row('Owner')).getByText('owner@example.com')).toBeTruthy();
    expect(within(row('Owner')).getByText('you')).toBeTruthy();
    expect(within(row('Ana')).getByText('admin')).toBeTruthy();
    expect(within(row('Ben')).getByText('member')).toBeTruthy();
    const mine = device('Owner', DEVICE);
    expect(within(mine).getByText('root')).toBeTruthy();
    expect(within(mine).getByText('this Mac')).toBeTruthy();
    expect(within(device('Owner', MY_OTHER_MAC)).queryByText('root')).toBeNull();
    expect(within(device('Ben', BEN_WEB)).getByText('browser')).toBeTruthy();
    expect(within(row('Cat')).getByText('No devices yet.')).toBeTruthy();
    expect(screen.queryByText(DEVICE)).toBeNull(); // ids by their first 8, as `show` does
  });

  it('read-only without maySign: nothing offered, the rule in words with the roots’ emails', async () => {
    renderSection(signing({ root: true, maySign: false }));
    const people = await group('people');
    expect(await within(people).findByText('Only a root signs org changes.')).toBeTruthy();
    expect(within(people).getByText('The roots are owner@example.com.')).toBeTruthy();
    expect(within(people).queryAllByRole('button')).toEqual([]);
    expect(within(people).queryByText(/Their next device/)).toBeNull(); // a rule about an action not on offer

    // signed in and able to sign: the changes come back
    emit(signing(ROOT));
    expect(await within(people).findByRole('button', { name: 'Add person…' })).toBeTruthy();
    expect(within(people).queryByText('Only a root signs org changes.')).toBeNull();
  });

  it('while this Mac signs: each member’s changes, none that would refuse for yourself or this Mac', async () => {
    renderSection(signing(ROOT));
    await group('people');
    await within(row('Owner')).findByRole('button', { name: 'Change email…' });
    // yourself: no Remove person or role change (another admin changes your role); this Mac's own device isn't removed
    // here, your other Mac is; your other Mac becomes a root (you're an admin, it's a Mac); you pair your own devices
    expect(buttons('Owner')).toEqual(['Change email…', 'Remove device…', 'Make a root…', 'Pair a device…']);
    expect(within(device('Owner', DEVICE)).queryAllByRole('button')).toEqual([]);
    // an admin: demoted, an admin's Mac made a root
    expect(buttons('Ana')).toEqual(['Make member…', 'Change email…', 'Remove person…', 'Remove device…', 'Make a root…']);
    // a member: promoted; a member's device is never offered as a root
    expect(buttons('Ben')).toEqual(['Make admin…', 'Change email…', 'Remove person…', 'Remove device…']);
    // a member with no device: their first is paired from here
    expect(buttons('Cat')).toEqual(['Make admin…', 'Change email…', 'Remove person…', 'Pair a device…']);
    expect(within(await group('people')).getByRole('button', { name: 'Add person…' })).toBeTruthy();
    expect(within(device('Ana', ANA_MAC)).getByRole('button', { name: 'Make a root…' })).toBeTruthy();
  });

  it('the later-device rule is shown in place of the action', async () => {
    renderSection(signing(ROOT));
    await group('people');
    // Ana and Ben have devices and sign nothing: their next device waits for the countersign flow
    expect(await within(row('Ana')).findByText('Their next device is paired from one of their own devices, a flow not built yet.')).toBeTruthy();
    expect(within(row('Ben')).getByText('Their next device is paired from one of their own devices, a flow not built yet.')).toBeTruthy();
    expect(within(row('Cat')).queryByText(/Their next device/)).toBeNull();
    expect(within(row('Owner')).queryByText(/Their next device/)).toBeNull();

    // a member who signs pairs their own later device from their own app
    resetHarness();
    const anaRoot = viewWith({ members: VIEW.members.map((m) => (m.name === 'Ana' ? { ...m, devices: m.devices.map((d) => ({ ...d, root: true })) } : m)) });
    renderSection(signing(ROOT), { 'org.view': () => anaRoot });
    expect(await within(await found('Ana')).findByText('They pair their next device from their own Org page.')).toBeTruthy();
    expect(within(row('Ana')).queryByRole('button', { name: 'Pair a device…' })).toBeNull();
  });
});
