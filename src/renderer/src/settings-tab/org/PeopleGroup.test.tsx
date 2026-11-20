// P5 O8 M4a: the Org page's People group (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's "At its end",
// "The rule the page states" and "Read-only, and refusals"): each member with email, role and devices, the roots marked;
// while this Mac may sign, the changes it offers, never one that refuses for yourself; read-only otherwise, with the
// roots' emails; and the later-device rule in place of Pair a device. A sheet open when this Mac loses the right to sign
// withdraws what would sign, and an operation already in flight keeps its answer in view. The word cut (G160, G162,
// G163, G165, G166, G170): a device's id is its kind's tooltip; a person's and a device's actions are each one "…" menu;
// the later-device rule is not stated; the read-only rule is the page's one line at its top.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { OrgChange, OrgPairingStatus, OrgStatus, PairStartResult, PreviewResult, SignResult } from '@shared/ipc/schema/org';
import { accessibleText } from '../../test-support/accessible-text';
import { ANA_MAC, BEN, BEN_WEB, DEVICE, ME, MY_OTHER_MAC, ROOT, VIEW, choose, emit, found, group, menuItems, renderSection, resetHarness, row, sent, signing, viewWith } from './test-support';

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(resetHarness);

const buttons = (label: string) => within(row(label)).queryAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
// A device's line by its id, which is its kind's description (the word cut, G160), held in the line.
const device = (label: string, id: string) => within(row(label)).getByText(id.slice(0, 8)).closest('[data-org-device]') as HTMLElement;
const deviceMenu = (id: string) => `Actions for Mac ${id.slice(0, 8)}`;

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
    expect(accessibleText(row('Owner'))).not.toContain(DEVICE.slice(0, 8)); // the kind's tooltip, not the line's words
  });

  it('read-only without maySign: nothing offered, the rule in words with the roots’ emails at the page’s top', async () => {
    renderSection(signing({ root: true, maySign: false }));
    const people = await group('people');
    expect(await screen.findByText('View only: owner@example.com signs changes')).toBeTruthy(); // the word cut (G170)
    expect(people.contains(screen.getByText('View only: owner@example.com signs changes'))).toBe(false);
    expect(accessibleText(people)).not.toContain('Only a root signs org changes.');
    expect(within(people).queryAllByRole('button')).toEqual([]);

    // signed in and able to sign: the changes come back
    emit(signing(ROOT));
    expect(await within(people).findByRole('button', { name: 'Add person…' })).toBeTruthy();
    expect(screen.queryByText(/^View only/)).toBeNull();
  });

  it('while this Mac signs: each member’s changes, none that would refuse for yourself or this Mac', async () => {
    renderSection(signing(ROOT));
    await group('people');
    await within(row('Owner')).findByRole('button', { name: 'Actions for Owner' });
    // the word cut (G162, G163): each person's actions are one "…" menu, each device's one on its line
    // yourself: no Remove person or role change (another admin changes your role); this Mac's own device isn't removed
    // here, your other Mac is; your other Mac becomes a root (you're an admin, it's a Mac); you pair your own devices
    expect(buttons('Owner')).toEqual(['Actions for Owner', deviceMenu(MY_OTHER_MAC), 'Pair a device…']);
    expect(await menuItems(row('Owner'), 'Actions for Owner')).toEqual(['Change email…']);
    expect(await menuItems(row('Owner'), deviceMenu(MY_OTHER_MAC))).toEqual(['Make a root…', 'Remove device…']);
    expect(within(device('Owner', DEVICE)).queryAllByRole('button')).toEqual([]);
    // an admin: demoted, an admin's Mac made a root
    expect(await menuItems(row('Ana'), 'Actions for Ana')).toEqual(['Make member…', 'Change email…', 'Remove person…']);
    expect(await menuItems(row('Ana'), deviceMenu(ANA_MAC))).toEqual(['Make a root…', 'Remove device…']);
    // a member: promoted; a member's device is never offered as a root
    expect(await menuItems(row('Ben'), 'Actions for Ben')).toEqual(['Make admin…', 'Change email…', 'Remove person…']);
    expect(buttons('Ben')).toEqual(['Actions for Ben', 'Actions for browser BenWebQ9']);
    expect(await menuItems(row('Ben'), 'Actions for browser BenWebQ9')).toEqual(['Remove device…']);
    // a member with no device: their first is paired from here
    expect(buttons('Cat')).toEqual(['Actions for Cat', 'Pair a device…']);
    expect(within(await group('people')).getByRole('button', { name: 'Add person…' })).toBeTruthy();
    expect(within(device('Ana', ANA_MAC)).getByRole('button', { name: deviceMenu(ANA_MAC) })).toBeTruthy();
  });

  it('a later device of another member is neither offered nor stated (the word cut, G165, G166)', async () => {
    renderSection(signing(ROOT));
    await found('Ana');
    // Ana and Ben have devices and sign nothing: their next device waits for the countersign flow, unsaid
    expect(within(row('Ana')).queryByRole('button', { name: 'Pair a device…' })).toBeNull();
    expect(within(row('Ben')).queryByRole('button', { name: 'Pair a device…' })).toBeNull();
    expect(accessibleText(await group('people'))).not.toMatch(/Their next device|They pair their next device/);
    expect(within(row('Cat')).getByRole('button', { name: 'Pair a device…' })).toBeTruthy();

    // a member who signs pairs their own later device from their own app: not offered here either
    resetHarness();
    const anaRoot = viewWith({ members: VIEW.members.map((m) => (m.name === 'Ana' ? { ...m, devices: m.devices.map((d) => ({ ...d, root: true })) } : m)) });
    renderSection(signing(ROOT), { 'org.view': () => anaRoot });
    expect(accessibleText(await found('Ana'))).not.toContain('They pair their next device');
    expect(within(row('Ana')).queryByRole('button', { name: 'Pair a device…' })).toBeNull();
  });
});

describe('Settings › Org: People when this Mac stops being able to sign (M4a)', () => {
  const ROLE: OrgChange = { kind: 'member.role', member: BEN, role: 'admin' };
  const previewed = (): PreviewResult => ({ ok: true, change: ROLE, lines: ['Make ben@example.com an admin'], warnings: [], digest: 'digest-role' });
  const PAIR_CODE = 'smns-pair-v1.eyJodWIiOiJodHRwczovL2h1YiJ9-made-for-the-new-device';
  const started: PairStartResult = { ok: true, code: PAIR_CODE, expires: '2026-10-28T12:10:00.000Z' };
  const ENTRY = { id: 'NewMacQ9xYc0dE000001', class: 'native-mac' as const, keyStorage: 'software', fingerprint: 'n3wdv-77777', digest: 'candidateDigest0001' };
  const pairing = (patch: Partial<NonNullable<OrgPairingStatus>> = {}): OrgPairingStatus => ({ generation: 1, member: ME, class: 'native-mac', expires: '2026-10-28T12:10:00.000Z', entry: null, problem: null, ...patch });
  // Each way this Mac loses the right to sign while a sheet is open: signed out, or a head that leaves it no root.
  const losses: [string, OrgStatus][] = [
    ['signed out', signing(ROOT, { session: 'signed-out' })],
    ['no longer a root', signing({ root: false, maySign: false })],
  ];

  for (const [how, lost] of losses) {
    it(`an open change sheet withdraws Sign once this Mac is ${how}, and says why`, async () => {
      renderSection(signing(ROOT), { 'org.preview': previewed });
      await group('people');
      await choose(await found('Ben'), 'Actions for Ben', 'Make admin…');
      const sheet = await screen.findByRole('dialog', { name: 'Make ben@example.com an admin?' });
      await within(sheet).findByRole('button', { name: 'Sign' });
      emit(lost);
      await vi.waitFor(() => expect(within(sheet).queryByRole('button', { name: 'Sign' })).toBeNull());
      expect(within(sheet).getByText('Only a root signs org changes.')).toBeTruthy();
      expect(within(sheet).getByText('Make ben@example.com an admin')).toBeTruthy(); // what was shown stays readable
      fireEvent.submit(sheet.querySelector('form')!); // Enter signs nothing either
      expect(sent('org.change')).toEqual([]);
    });

    it(`an open pairing sheet withdraws Make a code and Approve once this Mac is ${how}; Cancel pairing stays`, async () => {
      renderSection(signing(ROOT), { 'org.pair.start': () => started });
      await group('people');
      fireEvent.click(await within(row('Owner')).findByRole('button', { name: 'Pair a device…' }));
      let sheet = await screen.findByRole('dialog', { name: 'Pair a device of yours' });
      emit({ ...lost });
      await vi.waitFor(() => expect(within(sheet).queryByRole('button', { name: 'Make a code' })).toBeNull());
      expect(within(sheet).getByText('Only a root signs org changes.')).toBeTruthy();

      // a pairing under way whose device answered: no Approve, but the way to end it
      resetHarness();
      renderSection(signing(ROOT), { 'org.pair.start': () => started });
      await group('people');
      fireEvent.click(await within(row('Owner')).findByRole('button', { name: 'Pair a device…' }));
      sheet = await screen.findByRole('dialog', { name: 'Pair a device of yours' });
      fireEvent.click(within(sheet).getByRole('button', { name: 'Make a code' }));
      emit(signing(ROOT, { pairing: pairing({ entry: ENTRY }) }));
      await within(sheet).findByRole('button', { name: 'Approve…' });
      emit({ ...lost, pairing: pairing({ entry: ENTRY }) } as OrgStatus);
      await vi.waitFor(() => expect(within(sheet).queryByRole('button', { name: 'Approve…' })).toBeNull());
      expect(within(sheet).getByText('Only a root signs org changes.')).toBeTruthy();
      fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel pairing' }));
      await vi.waitFor(() => expect(sent('org.pair.cancel')).toEqual([undefined]));
      expect(sent('org.pair.approve')).toEqual([]);
    });
  }

  it('a sign or an approval in flight when this Mac stops being able to sign keeps its answer in view', async () => {
    let signed: (result: SignResult) => void = () => {};
    renderSection(signing(ROOT), { 'org.preview': previewed, 'org.change': () => new Promise<SignResult>((resolve) => (signed = resolve)) });
    await group('people');
    await choose(await found('Ben'), 'Actions for Ben', 'Make admin…');
    let sheet = await screen.findByRole('dialog', { name: 'Make ben@example.com an admin?' });
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Sign' }));
    await vi.waitFor(() => expect(sent('org.change')).toHaveLength(1));
    emit(signing(ROOT, { session: 'signed-out' }));
    await vi.waitFor(() => expect(within(sheet).getByText('Only a root signs org changes.')).toBeTruthy());
    await act(async () => signed({ ok: false, reason: 'not-root', detail: 'signed out while Touch ID was open' }));
    expect(await within(sheet).findByText('Not signed · This Mac isn’t a root of the org. · signed out while Touch ID was open')).toBeTruthy();

    resetHarness();
    let approved: (result: SignResult) => void = () => {};
    renderSection(signing(ROOT), { 'org.pair.start': () => started, 'org.pair.approve': () => new Promise<SignResult>((resolve) => (approved = resolve)) });
    await group('people');
    fireEvent.click(await within(row('Owner')).findByRole('button', { name: 'Pair a device…' }));
    sheet = await screen.findByRole('dialog', { name: 'Pair a device of yours' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Make a code' }));
    emit(signing(ROOT, { pairing: pairing({ entry: ENTRY }) }));
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Approve…' }));
    await vi.waitFor(() => expect(sent('org.pair.approve')).toHaveLength(1));
    emit(signing({ root: false, maySign: false }, { pairing: null }));
    await act(async () => approved({ ok: true, version: 13 }));
    expect(await within(sheet).findByText('Paired. Signed version 13.')).toBeTruthy();
  });
});
