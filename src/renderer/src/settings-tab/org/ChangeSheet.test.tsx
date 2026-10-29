// P5 O8 M4a: the change sheet (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's "At its end" and
// *Changes*): each change opens one sheet showing what will be signed, line by line, with the checks' warnings, from
// `org.preview`; Confirm sends `org.change` with the change as previewed (normalized: `member.add`'s id) and the digest
// that names what was shown. A change the checks refuse is named there and never reaches Touch ID.
import { fireEvent, screen, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { OrgChange, PreviewResult, SignResult } from '@shared/ipc/schema/org';
import { ANA, ANA_MAC, BEN, BEN_WEB, ROOT, group, renderSection, resetHarness, row, sent, signing } from './test-support';

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
