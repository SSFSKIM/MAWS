// P5 O8 M4a: the change sheet (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's "At its end" and
// *Changes*): each change opens one sheet showing what will be signed, line by line, with the checks' warnings, from
// `org.preview`; Confirm sends `org.change` with the change as previewed (normalized: `member.add`'s id) and the digest
// that names what was shown. A change the checks refuse is named there and never reaches Touch ID.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { OrgChange, PreviewResult, SignResult } from '@shared/ipc/schema/org';
import { ANA, ANA_MAC, BEN, BEN_WEB, ME, MINI, ROOT, VIEW, VM, emit, found, group, renderSection, resetHarness, row, sent, signing, viewWith } from './test-support';

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(resetHarness);

const WARNING = 'ben@example.com owns no machine and no delegation after this';
// Opens `button` on `member`'s row, once the page and its view are drawn.
async function press(member: string, button: string) {
  await group('people');
  fireEvent.click(await within(row(member)).findByRole('button', { name: button }));
}
const previewed = (change: OrgChange, lines: string[], warnings: string[] = [], digest = 'digest-1'): PreviewResult => ({ ok: true, change, lines, warnings, digest });

describe('Settings › Org: the change sheet (M4a)', () => {
  const cases: { button: string; member: string; device?: string; title: string; change: OrgChange; lines: string[] }[] = [
    { button: 'Remove person…', member: 'Ben', title: 'Remove ben@example.com?', change: { kind: 'member.remove', member: BEN }, lines: ['Remove ben@example.com from the org', 'Revoke the keys of their 1 device'] },
    { button: 'Make admin…', member: 'Ben', title: 'Make ben@example.com an admin?', change: { kind: 'member.role', member: BEN, role: 'admin' }, lines: ['Make ben@example.com an admin'] },
    { button: 'Make member…', member: 'Ana', title: 'Make ana@example.com a member?', change: { kind: 'member.role', member: ANA, role: 'member' }, lines: ['Make ana@example.com a member'] },
    { button: 'Remove device…', member: 'Ben', device: BEN_WEB, title: 'Remove a device of ben@example.com?', change: { kind: 'device.remove', member: BEN, device: BEN_WEB }, lines: [`Remove ben@example.com's device ${BEN_WEB.slice(0, 8)} (web-cards) and revoke its keys`] },
    { button: 'Make a root…', member: 'Ana', device: ANA_MAC, title: 'Make a device of ana@example.com a root?', change: { kind: 'root.add', member: ANA, device: ANA_MAC }, lines: [`Make ana@example.com's device ${ANA_MAC.slice(0, 8)} (native-mac) a root of the org`] },
  ];
  for (const c of cases) {
    it(`each change’s sheet shows its lines and warnings, and Confirm sends the previewed digest: ${c.button} on ${c.member}`, async () => {
      renderSection(signing(ROOT), { 'org.preview': () => previewed(c.change, c.lines, [WARNING], `digest-${c.change.kind}`) });
      await press(c.member, c.button);
      const sheet = await screen.findByRole('dialog', { name: c.title });
      expect(await within(sheet).findByText(c.lines[0]!)).toBeTruthy();
      for (const line of c.lines) expect(within(sheet).getByText(line)).toBeTruthy();
      expect(within(sheet).getByText(`Warning: ${WARNING}`).className).toContain('text-warning');
      expect(sent('org.preview')).toEqual([{ change: c.change }]);
      expect(sent('org.change')).toEqual([]); // nothing signed before Confirm
      fireEvent.click(within(sheet).getByRole('button', { name: 'Sign' }));
      await vi.waitFor(() => expect(sent('org.change')).toEqual([{ change: c.change, digest: `digest-${c.change.kind}` }]));
      await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(await within(await group('people')).findByText('Signed version 13.')).toBeTruthy();
    });
  }

  it('Add person: the email and role first, then the preview’s lines; Confirm sends the change as previewed, its new id included', async () => {
    const id = '0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f';
    const lines = [`Add dee@example.com as a member (id ${id}), with no device yet`, "They sign in through the hub's Access. On production their email must be admitted there too: an Access change, the owner's."];
    renderSection(signing(ROOT), { 'org.preview': () => previewed({ kind: 'member.add', email: 'dee@example.com', role: 'member', id }, lines, [], 'digest-add') });
    fireEvent.click(await within(await group('people')).findByRole('button', { name: 'Add person…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add a person' });
    const review = within(sheet).getByRole('button', { name: 'Review…' }) as HTMLButtonElement;
    expect(review.disabled).toBe(true);
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Email' }), { target: { value: '  Dee@Example.com ' } });
    expect((within(sheet).getByRole('radio', { name: 'member' }) as HTMLInputElement).checked).toBe(true); // a member unless chosen
    expect(sent('org.preview')).toEqual([]);
    fireEvent.click(review);
    // main trims and lower-cases the email; the renderer sends what was typed, trimmed
    await vi.waitFor(() => expect(sent('org.preview')).toEqual([{ change: { kind: 'member.add', email: 'Dee@Example.com', role: 'member' } }]));
    for (const line of lines) expect(await within(sheet).findByText(line)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Sign' }));
    await vi.waitFor(() => expect(sent('org.change')).toEqual([{ change: { kind: 'member.add', email: 'dee@example.com', role: 'member', id }, digest: 'digest-add' }]));
  });

  it('Add person as an admin, and Edit goes back to the fields', async () => {
    renderSection(signing(ROOT), { 'org.preview': () => previewed({ kind: 'member.add', email: 'eve@example.com', role: 'admin', id: '1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e' }, ['Add eve@example.com as an admin']) });
    fireEvent.click(await within(await group('people')).findByRole('button', { name: 'Add person…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add a person' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Email' }), { target: { value: 'eve@example.com' } });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'admin' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Review…' }));
    await vi.waitFor(() => expect(sent('org.preview')).toEqual([{ change: { kind: 'member.add', email: 'eve@example.com', role: 'admin' } }]));
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Edit' }));
    expect((within(sheet).getByRole('textbox', { name: 'Email' }) as HTMLInputElement).value).toBe('eve@example.com');
    expect(within(sheet).queryByRole('button', { name: 'Sign' })).toBeNull();
  });

  it('Change email: the new email, then its lines', async () => {
    const lines = ['Change ana@example.com’s email to ana@new.example', 'The hub admits them by ana@new.example from this state on.'];
    renderSection(signing(ROOT), { 'org.preview': () => previewed({ kind: 'member.email', member: ANA, email: 'ana@new.example' }, lines, [], 'digest-email') });
    await press('Ana', 'Change email…');
    const sheet = await screen.findByRole('dialog', { name: 'Change ana@example.com’s email' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'New email' }), { target: { value: 'ana@new.example' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Review…' }));
    await vi.waitFor(() => expect(sent('org.preview')).toEqual([{ change: { kind: 'member.email', member: ANA, email: 'ana@new.example' } }]));
    for (const line of lines) expect(await within(sheet).findByText(line)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Sign' }));
    await vi.waitFor(() => expect(sent('org.change')).toEqual([{ change: { kind: 'member.email', member: ANA, email: 'ana@new.example' }, digest: 'digest-email' }]));
  });

  it('a refused preview shows its findings and no Confirm', async () => {
    renderSection(signing(ROOT), {
      'org.preview': () =>
        ({
          ok: false,
          reason: 'refused',
          findings: [
            { level: 'refuse', code: 'owners-unknown', detail: 'machine mini is owned by ben@example.com, who would no longer be a member' },
            { level: 'warn', code: 'drops-delegation', detail: 'a delegation would be dropped' },
          ],
        }) satisfies PreviewResult,
    });
    await press('Ben', 'Remove person…');
    const sheet = await screen.findByRole('dialog', { name: 'Remove ben@example.com?' });
    expect(await within(sheet).findByText('The checks refuse this change. Nothing was signed:')).toBeTruthy();
    expect(within(sheet).getByText('machine mini is owned by ben@example.com, who would no longer be a member')).toBeTruthy();
    expect(within(sheet).getByText('Warning: a delegation would be dropped')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Sign' })).toBeNull();
    expect(sent('org.change')).toEqual([]);

    // a head that moved under the preview reads stale, with nothing to confirm either
    resetHarness();
    renderSection(signing(ROOT), { 'org.preview': () => ({ ok: false, reason: 'stale', detail: 'ben@example.com is not in the org state', findings: [] }) satisfies PreviewResult });
    await press('Ben', 'Make admin…');
    const stale = await screen.findByRole('dialog', { name: 'Make ben@example.com an admin?' });
    expect(await within(stale).findByText('The org state changed while this was composed. Close and try again.')).toBeTruthy();
    expect(within(stale).queryByRole('button', { name: 'Sign' })).toBeNull();
  });

  it('a sign main refuses is said in the sheet, and nothing more is sent; a Touch ID cancel says nothing and Sign stays', async () => {
    let answer: SignResult = { ok: false, reason: 'cancelled' };
    renderSection(signing(ROOT), { 'org.preview': () => previewed({ kind: 'member.role', member: BEN, role: 'admin' }, ['Make ben@example.com an admin'], [], 'digest-role'), 'org.change': () => answer });
    await press('Ben', 'Make admin…');
    const sheet = await screen.findByRole('dialog', { name: 'Make ben@example.com an admin?' });
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Sign' }));
    await vi.waitFor(() => expect(sent('org.change')).toHaveLength(1));
    expect(within(sheet).queryByRole('alert')).toBeNull();
    const sign = within(sheet).getByRole('button', { name: 'Sign' }) as HTMLButtonElement;
    await vi.waitFor(() => expect(sign.disabled).toBe(false));

    answer = { ok: false, reason: 'stale', detail: 'what would be signed changed since it was shown' };
    fireEvent.click(sign);
    expect((await within(sheet).findByRole('alert')).textContent).toBe('Not signed · What would be signed changed since it was shown. · what would be signed changed since it was shown');
    expect(within(sheet).queryByRole('button', { name: 'Sign' })).toBeNull();
    expect(sent('org.change')).toHaveLength(2);
  });

  it('the sheet’s Cancel sends nothing', async () => {
    renderSection(signing(ROOT), { 'org.preview': () => previewed({ kind: 'member.remove', member: BEN }, ['Remove ben@example.com from the org']) });
    await press('Ben', 'Remove person…');
    const sheet = await screen.findByRole('dialog', { name: 'Remove ben@example.com?' });
    await within(sheet).findByText('Remove ben@example.com from the org');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('org.change')).toEqual([]);
  });
});

describe('Settings › Org: the change sheet’s machine fields (M4b)', () => {
  async function pressOn(machine: string, button: string) {
    fireEvent.click(await within(await found(machine)).findByRole('button', { name: button }));
  }

  it('Owners…: the org’s admins or people ticked from the members, a former owner kept until unticked; Review waits for a change, then the preview signs it', async () => {
    const lines = ['mini’s owners become owner@example.com, ben@example.com (were owner@example.com, ana@example.com, member ffff…)'];
    renderSection(signing(ROOT), {
      'org.view': () => viewWith({ machines: [{ ...VIEW.machines[0]!, owners: [ME, ANA, 'ffffffffffffffffffffffffffffffff'] }, VIEW.machines[1]!] }),
      'org.preview': (input: { change: OrgChange }) => previewed(input.change, lines, [], 'digest-owners'),
    });
    await pressOn('mini', 'Owners…');
    const sheet = await screen.findByRole('dialog', { name: 'Change mini’s owners' });
    const ticked = () => within(sheet).getAllByRole('checkbox').filter((c) => (c as HTMLInputElement).checked).map((c) => c.closest('label')!.textContent);
    expect((within(sheet).getByRole('radio', { name: 'People' }) as HTMLInputElement).checked).toBe(true);
    expect(within(sheet).getAllByRole('checkbox').map((c) => c.closest('label')!.textContent)).toEqual(['youowner@example.com', 'Anaana@example.com', 'Benben@example.com', 'Catcat@example.com', 'a former member']);
    expect(ticked()).toEqual(['youowner@example.com', 'Anaana@example.com', 'a former member']);
    const review = within(sheet).getByRole('button', { name: 'Review…' }) as HTMLButtonElement;
    expect(review.disabled).toBe(true); // the owners as they are: main would refuse no change

    fireEvent.click(within(sheet).getByRole('checkbox', { name: /^Ana/ }));
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /^a former member/ }));
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /^Ben/ }));
    expect(ticked()).toEqual(['youowner@example.com', 'Benben@example.com']);
    for (const box of within(sheet).getAllByRole('checkbox').filter((c) => (c as HTMLInputElement).checked)) fireEvent.click(box);
    expect(review.disabled).toBe(true); // no owner at all: main's `shape`
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /^you/ }));
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /^Ben/ }));
    fireEvent.click(review);
    await vi.waitFor(() => expect(sent('org.preview')).toEqual([{ change: { kind: 'machine.owners', ref: MINI, owners: [ME, BEN] } }]));
    expect(await within(sheet).findByText(lines[0]!)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Sign' }));
    await vi.waitFor(() => expect(sent('org.change')).toEqual([{ change: { kind: 'machine.owners', ref: MINI, owners: [ME, BEN] }, digest: 'digest-owners' }]));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(row('Enroll a machine')).getByText('Signed version 13.')).toBeTruthy();
  });

  it('Owners…: an org-owned machine given to people, and back to the org', async () => {
    renderSection(signing(ROOT), { 'org.preview': (input: { change: OrgChange }) => previewed(input.change, ['build-vm’s owners change']) });
    await pressOn('build-vm', 'Owners…');
    const sheet = await screen.findByRole('dialog', { name: 'Change build-vm’s owners' });
    expect((within(sheet).getByRole('radio', { name: 'The org (its admins)' }) as HTMLInputElement).checked).toBe(true);
    expect(within(sheet).queryAllByRole('checkbox')).toEqual([]);
    fireEvent.click(within(sheet).getByRole('radio', { name: 'People' }));
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /^Ana/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Review…' }));
    await vi.waitFor(() => expect(sent('org.preview')).toEqual([{ change: { kind: 'machine.owners', ref: VM, owners: [ANA] } }]));
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Edit' }));
    fireEvent.click(within(sheet).getByRole('radio', { name: 'The org (its admins)' }));
    expect((within(sheet).getByRole('button', { name: 'Review…' }) as HTMLButtonElement).disabled).toBe(true); // the org's again: no change
  });

  it('Drop…: “Its key may be compromised” ticked revokes the key; left, it retires it', async () => {
    const lines = ['Drop mini (ref MawsMiniRef000000001) from the org', 'Revoke its key miniKeyId0001: it may be compromised'];
    renderSection(signing(ROOT), { 'org.preview': (input: { change: OrgChange }) => previewed(input.change, lines, [], 'digest-drop') });
    await pressOn('mini', 'Drop…');
    const sheet = await screen.findByRole('dialog', { name: 'Drop mini?' });
    const tick = within(sheet).getByRole('checkbox', { name: /^Its key may be compromised/ }) as HTMLInputElement;
    expect(tick.checked).toBe(false);
    fireEvent.click(tick);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Review…' }));
    await vi.waitFor(() => expect(sent('org.preview')).toEqual([{ change: { kind: 'machine.drop', ref: MINI, revoke: true } }]));
    for (const line of lines) expect(await within(sheet).findByText(line)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Sign' }));
    await vi.waitFor(() => expect(sent('org.change')).toEqual([{ change: { kind: 'machine.drop', ref: MINI, revoke: true }, digest: 'digest-drop' }]));
  });

  it('removing a member who owns a machine shows the composer’s line, and Go to <machine> takes the person to its row', async () => {
    const detail = "ana@example.com owns mini: Change the machine's owners first";
    renderSection(signing(ROOT), { 'org.preview': () => ({ ok: false, reason: 'refused', findings: [{ level: 'refuse', code: 'owners-unknown', detail }] }) satisfies PreviewResult });
    await press('Ana', 'Remove person…');
    const sheet = await screen.findByRole('dialog', { name: 'Remove ana@example.com?' });
    expect(await within(sheet).findByText(detail)).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Go to build-vm' })).toBeNull(); // the org's: it blocks no one
    fireEvent.click(within(sheet).getByRole('button', { name: 'Go to mini' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement?.id).toBe(`org-machine-${MINI}`));
    expect(within(document.activeElement as HTMLElement).getByRole('group', { name: 'mini' })).toBeTruthy();
    expect(document.activeElement?.hasAttribute('data-sought')).toBe(true); // marked while it holds the focus
    await new Promise((resolve) => setTimeout(resolve, 20)); // the sheet's focus restore has run: the row keeps it
    const sought = document.activeElement as HTMLElement;
    expect(sought.id).toBe(`org-machine-${MINI}`);
    sought.blur();
    expect(sought.hasAttribute('data-sought')).toBe(false);
  });

  // The review's mid-flight probe (fix wave): a sheet's late answer acts only on that sheet, under its own sign-in.
  it('a late answer from a closed sheet leaves the next sheet alone', async () => {
    let signed: (result: SignResult) => void = () => {};
    renderSection(signing(ROOT), {
      'org.preview': (input: { change: OrgChange }) => previewed(input.change, ['Change mini’s owners'], [], 'owners-digest'),
      'org.change': () => new Promise<SignResult>((resolve) => (signed = resolve)),
    });
    await pressOn('mini', 'Owners…');
    const owners = await screen.findByRole('dialog', { name: 'Change mini’s owners' });
    fireEvent.click(within(owners).getByRole('checkbox', { name: /^Ana/ }));
    fireEvent.click(within(owners).getByRole('button', { name: 'Review…' }));
    fireEvent.click(await within(owners).findByRole('button', { name: 'Sign' }));
    await vi.waitFor(() => expect(sent('org.change')).toHaveLength(1));
    fireEvent.click(within(owners).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(within(row('mini')).getByRole('button', { name: 'Drop…' }));
    const drop = await screen.findByRole('dialog', { name: 'Drop mini?' });
    await act(async () => signed({ ok: true, version: 13 }));
    expect(screen.getByRole('dialog', { name: 'Drop mini?' })).toBe(drop);
    expect(within(drop).queryByText(/Signed version 13/)).toBeNull();
  });

  it('a sign answered after its sign-in ended stays in its sheet and reaches nothing of the page', async () => {
    let signed: (result: SignResult) => void = () => {};
    renderSection(signing(ROOT), { 'org.preview': (input: { change: OrgChange }) => previewed(input.change, ['Drop mini (ref MawsMiniRef000000001) from the org']), 'org.change': () => new Promise<SignResult>((resolve) => (signed = resolve)) });
    await pressOn('mini', 'Drop…');
    const sheet = await screen.findByRole('dialog', { name: 'Drop mini?' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Review…' }));
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Sign' }));
    await vi.waitFor(() => expect(sent('org.change')).toHaveLength(1));
    emit(signing(ROOT, { session: 'signed-out' }));
    emit(signing(ROOT)); // signed in again: another sign-in, though the same member and device
    await act(async () => signed({ ok: true, version: 13 }));
    expect(await within(sheet).findByText('Signed version 13.')).toBeTruthy(); // its answer stays in view (M4a's rule)
    expect(screen.getByRole('dialog', { name: 'Drop mini?' })).toBe(sheet);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(row('Enroll a machine')).queryByText('Signed version 13.')).toBeNull();
  });

  it('a long member list scrolls inside the owners field, so Review and Cancel stay in the sheet', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: (i + 16).toString(16).padStart(32, '0'),
      email: `member-${i}.with-a-rather-long-address@clinical-research-operations.northwind-health.example`,
      name: `Member ${i}`,
      role: 'member' as const,
      you: false,
      devices: [],
    }));
    renderSection(signing(ROOT), { 'org.view': () => viewWith({ members: [...VIEW.members, ...many] }) });
    await pressOn('mini', 'Owners…');
    const sheet = await screen.findByRole('dialog', { name: 'Change mini’s owners' });
    const list = within(sheet).getByRole('group', { name: 'People' });
    expect(within(list).getAllByRole('checkbox')).toHaveLength(44);
    expect(list.className).toMatch(/max-h-/);
    expect(list.className).toContain('overflow-y-auto');
    expect(list.contains(within(sheet).getByRole('button', { name: 'Review…' }))).toBe(false);
    expect(list.contains(within(sheet).getByRole('button', { name: 'Cancel' }))).toBe(false);
    expect(within(list).getByText(many[0]!.email).className).toContain('[overflow-wrap:anywhere]');
  });
});
