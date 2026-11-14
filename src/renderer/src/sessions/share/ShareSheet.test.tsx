// The Share sheet (P5 O8 M6b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b's "At its end", Decisions and
// Proves' renderer line): it opens on a fresh read of the session's policy; draws the four levels with their lines, the
// people at their grades and Add person, and the foot, in the spec's words; saves the access and each share changed,
// removed or added in the sheet's order at the revision it opened on; shows each line's outcome (a no-op, a skipped
// revision marked "also changed elsewhere", a known refusal in its words, an unknown reason as one generic line with the
// raw word beside it, an unknown outcome that stopped the save with the lines after it not sent, and a reload); reads
// "Changed elsewhere: reload" when main's revision check sent nothing; and says what it can't offer: a machine whose
// sminos can't keep a reach yet, a reach that can't be read, a read refused.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import type { RecordPolicyEntry } from '@shared/ipc/schema/endpoint';
import type { OrgPolicy, OrgPolicyOutcome, OrgPolicySetResult, OrgView } from '@shared/ipc/schema/org';
import { addressOf } from '@shared/machine/address';
import { remoteRow } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../test/support/machine';
import { useHubAccess } from '../../stores/hub-access';
import { useMachines } from '../../stores/machines';
import { useSessions } from '../../stores/sessions';
import { resetShellStores } from '../../test-support/shell-stores';
import { closeDialog, openDialog } from '../dialogs';
import { SessionDialogs } from '../SessionDialogs';
import { REFUSALS, SHARE } from './copy';
import { saveOf } from './ShareSheet';

const ME = 'member-me';
const ANA = 'member-ana';
const BEN = 'member-ben';
const CHEN = 'member-chen';
const ADDRESS = addressOf(OTHER_MACHINE, 'sess-1') as AppSessionId;

const member = (id: string, name: string, you = false): OrgView['members'][number] => ({ id, email: `${name.toLowerCase()}@northwind.example`, name, role: 'member', you, devices: [] });
const VIEW: OrgView = { version: 3, issued: '2026-11-07T10:00:00Z', maySign: false, recoveryKid: 'kid', members: [member(ME, 'Me', true), member(ANA, 'Ana'), member(BEN, 'Ben'), member(CHEN, 'Chen')], machines: [], roots: [], delegations: [], strayKeys: [], hubKeys: { at: null, failed: false } };
const entry = (over: Partial<Extract<RecordPolicyEntry, { policyRev: number }>> = {}): RecordPolicyEntry => ({ session: 'sess-1', access: 'listed', shares: [{ member: ANA, grade: 'view' }], policyRev: 7, ...over });
const read = (policies: RecordPolicyEntry[]): OrgPolicy => ({ ok: true, machine: OTHER_MACHINE, supported: true, policies });

let fake: FakeClient;
const install = (answers: Parameters<typeof fakeClient>[0]) => {
  fake = fakeClient({ 'org.view': VIEW, ...answers });
  window.maws = fake.client as unknown as PreloadBridge;
};
const open = async () => {
  act(() => openDialog({ kind: 'share', address: ADDRESS }));
  return screen.findByRole('dialog', { name: SHARE.title });
};
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const level = (sheet: HTMLElement, name: string) => within(sheet).getByRole('radio', { name: new RegExp(`^${name}`) }) as HTMLInputElement;
/** The people's lines the sheet shows as pending, top to bottom, each as the share it would send. */
const pending = (sheet: HTMLElement) =>
  [...sheet.querySelectorAll<HTMLElement>('[data-share-pending]')].map((li) => ({
    member: li.getAttribute('data-share-person')!,
    grade: li.getAttribute('data-share-pending') === 'remove' ? null : li.querySelector('select')!.value,
  }));

beforeEach(() => {
  resetShellStores();
  useHubAccess.setState({ access: 'connected', member: ME });
  useMachines.getState().applyRoster([
    { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-11-07T10:00:00Z', generation: 0 },
    { ref: OTHER_MACHINE, name: 'studio-mini', local: false, state: 'up', since: '2026-11-07T10:00:00Z', generation: 0 },
  ]);
  useSessions.setState({ listed: new Map([[ADDRESS, { ...remoteRow(OTHER_MACHINE, 'sess-1', { title: 'Nightly import', owners: [ME], project: 'proj-1' }), appId: ADDRESS }]]) });
  render(<SessionDialogs />);
});
afterEach(() => {
  act(() => closeDialog());
  cleanup();
  useHubAccess.setState({ access: null, member: null });
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('the sheet', () => {
  it("opens on a fresh read and draws the levels, the people and the foot in the spec's words", async () => {
    install({ 'org.policy.get': read([entry({ shares: [{ member: ANA, grade: 'view' }, { member: BEN, grade: 'list' }] })]) });
    const sheet = await open();
    await within(sheet).findByText(SHARE.general);
    expect(fake.invoked('org.policy.get')).toEqual([{ address: ADDRESS }]);
    expect(sheet.querySelector('[data-share-session]')!.textContent).toBe('Nightly import · studio-mini');
    expect(sheet.querySelector('[data-share-session]')!.getAttribute('title')).toBe('Nightly import · studio-mini'); // board 523: the whole title and machine on hover
    expect(within(sheet).getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['private', 'listed', 'org-view', 'org-converse']);
    expect(['Private', 'Listed', 'Org can view', 'Org can talk'].map((name) => level(sheet, name).checked)).toEqual([false, true, false, false]);
    expect(within(sheet).getByText("Only its owners, and the people it's shared with, can see it or message its agent. Its agent can message only them too.")).toBeTruthy();
    const people = within(sheet).getByRole('list', { name: SHARE.people });
    expect(within(people).getAllByRole('listitem').map((li) => li.getAttribute('data-share-person'))).toEqual([ANA, BEN]);
    expect((within(people).getByRole('combobox', { name: "Ana's access" }) as HTMLSelectElement).value).toBe('view');
    expect((within(people).getByRole('combobox', { name: "Ben's access" }) as HTMLSelectElement).value).toBe('list');
    expect(within(people).getByText("Their agents can message this session. They can't read it.")).toBeTruthy();
    expect(within(sheet).getByText('What was already shared stays shared.')).toBeTruthy();
    // Add person, above the people, offers the org's other members: not you, an owner, nor anyone shared with already
    const pick = within(sheet).getByRole('combobox', { name: SHARE.addPerson }) as HTMLSelectElement;
    expect(pick.compareDocumentPosition(people) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...pick.options].map((o) => o.value)).toEqual(['', CHEN]);
    expect((within(sheet).getByRole('button', { name: SHARE.save }) as HTMLButtonElement).disabled).toBe(true); // nothing changed
  });

  it('saves the access and each share changed, removed or added, in the order the sheet showed, at the revision it opened on', async () => {
    install({ 'org.policy.get': read([entry({ shares: [{ member: ANA, grade: 'view' }, { member: BEN, grade: 'list' }] })]) });
    const sheet = await open();
    await within(sheet).findByText(SHARE.general);
    fireEvent.click(level(sheet, 'Private'));
    fireEvent.change(within(sheet).getByRole('combobox', { name: "Ana's access" }), { target: { value: 'converse' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove Ben' }));
    fireEvent.change(within(sheet).getByRole('combobox', { name: SHARE.addPerson }), { target: { value: CHEN } });
    fireEvent.change(within(sheet).getByRole('combobox', { name: SHARE.newGrade }), { target: { value: 'list' } });
    fireEvent.click(within(sheet).getByRole('button', { name: SHARE.add }));
    fireEvent.click(within(sheet).getByRole('button', { name: SHARE.save }));
    await settle();
    expect(fake.invoked('org.policy.set')).toEqual([
      {
        address: ADDRESS,
        access: 'private',
        shares: [
          { member: ANA, grade: 'converse' },
          { member: BEN, grade: null },
          { member: CHEN, grade: 'list' },
        ],
        policyRev: 7,
      },
    ]);
    expect(within(sheet).getByRole('button', { name: SHARE.saving })).toBeTruthy();
  });

  it('shows each pending line in the order it sends them, a removal kept in its place until saved', async () => {
    install({ 'org.policy.get': read([entry({ shares: [{ member: ANA, grade: 'view' }, { member: BEN, grade: 'list' }] })]) });
    const sheet = await open();
    await within(sheet).findByText(SHARE.general);
    // the review's sequence: remove Ana, change Ben, then take Ana back at another grade
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove Ana' }));
    const ana = sheet.querySelector(`[data-share-person="${ANA}"]`)!;
    expect(ana.getAttribute('data-share-pending')).toBe('remove');
    expect(within(ana as HTMLElement).getByText(SHARE.removing)).toBeTruthy();
    const pick = within(sheet).getByRole('combobox', { name: SHARE.addPerson }) as HTMLSelectElement;
    expect([...pick.options].map((o) => o.value)).toEqual(['', CHEN]); // a removal is undone in its place, not added again
    fireEvent.change(within(sheet).getByRole('combobox', { name: "Ben's access" }), { target: { value: 'view' } });
    fireEvent.click(within(sheet).getByRole('button', { name: SHARE.undoRemove('Ana') }));
    fireEvent.change(within(sheet).getByRole('combobox', { name: "Ana's access" }), { target: { value: 'approve' } });
    expect(pending(sheet)).toEqual([
      { member: ANA, grade: 'approve' },
      { member: BEN, grade: 'view' },
    ]);
    // then an addition, and a removal after it: each line where the sheet shows it
    fireEvent.change(pick, { target: { value: CHEN } });
    fireEvent.click(within(sheet).getByRole('button', { name: SHARE.add }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove Ana' }));
    const shown = pending(sheet);
    expect(shown).toEqual([
      { member: ANA, grade: null },
      { member: BEN, grade: 'view' },
      { member: CHEN, grade: 'view' },
    ]);
    fireEvent.click(within(sheet).getByRole('button', { name: SHARE.save }));
    await settle();
    expect(fake.invoked('org.policy.set')).toEqual([{ address: ADDRESS, shares: shown, policyRev: 7 }]);
  });

  it('drops a person added and removed before saving, and sends nothing for a change taken back', async () => {
    install({ 'org.policy.get': read([entry()]) });
    const sheet = await open();
    await within(sheet).findByText(SHARE.general);
    fireEvent.change(within(sheet).getByRole('combobox', { name: SHARE.addPerson }), { target: { value: CHEN } });
    fireEvent.click(within(sheet).getByRole('button', { name: SHARE.add }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove Chen' }));
    expect(sheet.querySelector(`[data-share-person="${CHEN}"]`)).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove Ana' }));
    fireEvent.click(within(sheet).getByRole('button', { name: SHARE.undoRemove('Ana') }));
    expect(pending(sheet)).toEqual([]);
    expect((within(sheet).getByRole('button', { name: SHARE.save }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows each line as it went: saved, a no-op, a skipped revision, a known refusal, and the policy as it then stands', async () => {
    const after = entry({ access: 'private', shares: [{ member: ANA, grade: 'converse' }], policyRev: 10 });
    const results: OrgPolicyOutcome[] = [
      { line: { kind: 'access', access: 'private' }, state: 'done', changed: true, policyRev: 8, elsewhere: false },
      { line: { kind: 'share', member: ANA, grade: 'converse' }, state: 'done', changed: true, policyRev: 10, elsewhere: true },
      { line: { kind: 'share', member: BEN, grade: 'view' }, state: 'done', changed: false, policyRev: 10, elsewhere: false },
      { line: { kind: 'share', member: CHEN, grade: 'approve' }, state: 'refused', reason: 'read-only' },
    ];
    install({ 'org.policy.get': read([entry()]), 'org.policy.set': { ok: true, results, policy: after } satisfies OrgPolicySetResult });
    const sheet = await open();
    await within(sheet).findByText(SHARE.general);
    fireEvent.click(level(sheet, 'Private'));
    fireEvent.click(within(sheet).getByRole('button', { name: SHARE.save }));
    const outcomes = await within(sheet).findByRole('region', { name: SHARE.results });
    expect(within(outcomes).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'General access: Private · Saved',
      'Ana: Converse · Saved, also changed elsewhere',
      'Ben: View · Already so',
      `Chen: Approve · ${REFUSALS['read-only']('studio-mini')}`,
    ]);
    // the sheet now reads the policy as main read it after the save
    expect(level(sheet, 'Private').checked).toBe(true);
    expect((within(sheet).getByRole('combobox', { name: "Ana's access" }) as HTMLSelectElement).value).toBe('converse');
    expect(within(sheet).getByRole('button', { name: SHARE.close })).toBeTruthy();
  });

  it('shows a reason no line knows as one line naming the machine, its raw word beside it; never blank', async () => {
    install({
      'org.policy.get': read([entry()]),
      'org.policy.set': { ok: true, results: [{ line: { kind: 'access', access: 'org-view' }, state: 'refused', reason: 'quota-exceeded' }], policy: entry() } satisfies OrgPolicySetResult,
    });
    const sheet = await open();
    await within(sheet).findByText(SHARE.general);
    fireEvent.click(level(sheet, 'Org can view'));
    fireEvent.click(within(sheet).getByRole('button', { name: SHARE.save }));
    const line = (await within(sheet).findByRole('region', { name: SHARE.results })).querySelector('[data-share-outcome="refused"]')!;
    expect(line.textContent).toBe('General access: Org can view · studio-mini refused thisquota-exceeded');
    expect(line.querySelector('[data-share-raw]')!.getAttribute('title')).toBe('quota-exceeded');
  });

  it('says a line whose outcome is unknown stopped the save, the lines after it not sent, and reloads the reach on asking', async () => {
    const results: OrgPolicyOutcome[] = [
      { line: { kind: 'access', access: 'private' }, state: 'unknown', reason: 'malformed' },
      { line: { kind: 'share', member: ANA, grade: null }, state: 'not-sent' },
    ];
    install({ 'org.policy.set': { ok: true, results, policy: null } satisfies OrgPolicySetResult });
    const sheet = await open();
    await fake.reply('org.policy.get', read([entry()]));
    await within(sheet).findByText(SHARE.general);
    fireEvent.click(level(sheet, 'Private'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove Ana' }));
    fireEvent.click(within(sheet).getByRole('button', { name: SHARE.save }));
    const outcomes = await within(sheet).findByRole('region', { name: SHARE.results });
    expect(within(outcomes).getAllByRole('listitem').map((li) => li.textContent)).toEqual([`General access: Private · ${SHARE.unknown.malformed('studio-mini')}`, `Ana: removed · ${SHARE.notSent}`]);
    expect(within(outcomes).getByText(SHARE.stopped)).toBeTruthy();
    // no policy came back with it, and the results' Reload is the one the sheet offers
    expect(within(sheet).queryByText(SHARE.unavailable)).toBeNull();
    expect(within(sheet).getAllByRole('button', { name: SHARE.reload })).toHaveLength(1);
    fireEvent.click(within(outcomes).getByRole('button', { name: SHARE.reload }));
    await fake.reply('org.policy.get', read([entry({ access: 'private', policyRev: 8 })]));
    await waitFor(() => expect(within(sheet).queryByRole('region', { name: SHARE.results })).toBeNull());
    expect(level(sheet, 'Private').checked).toBe(true);
    expect(fake.invoked('org.policy.get')).toHaveLength(2);
  });

  it('reads "Changed elsewhere: reload" when the revision moved, keeping the draft, and a reload takes the policy as it stands', async () => {
    install({ 'org.policy.set': { ok: false, reason: 'changed-elsewhere' } satisfies OrgPolicySetResult });
    const sheet = await open();
    await fake.reply('org.policy.get', read([entry()]));
    await within(sheet).findByText(SHARE.general);
    fireEvent.click(level(sheet, 'Org can talk'));
    fireEvent.click(within(sheet).getByRole('button', { name: SHARE.save }));
    const alert = await within(sheet).findByRole('alert');
    expect(alert.textContent).toBe(`Changed elsewhere: reload${SHARE.reload}`);
    expect(level(sheet, 'Org can talk').checked).toBe(true);
    fireEvent.click(within(alert).getByRole('button', { name: SHARE.reload }));
    await fake.reply('org.policy.get', read([entry({ access: 'org-view', policyRev: 9 })]));
    await waitFor(() => expect(level(sheet, 'Org can view').checked).toBe(true));
    expect(within(sheet).queryByRole('alert')).toBeNull();
  });

  it('says each save refusal in its words: Touch ID cancelled, the machine offline', async () => {
    install({ 'org.policy.get': read([entry()]), 'org.policy.set': { ok: false, reason: 'cancelled' } satisfies OrgPolicySetResult });
    const sheet = await open();
    await within(sheet).findByText(SHARE.general);
    fireEvent.click(level(sheet, 'Private'));
    fireEvent.click(within(sheet).getByRole('button', { name: SHARE.save }));
    expect((await within(sheet).findByRole('alert')).textContent).toBe(REFUSALS.cancelled('studio-mini'));
  });
});

describe("the sheet's reader", () => {
  for (const [what, next] of [
    ['signs out (or loses the registration)', null],
    ['gives way to another member', 'member-other'],
  ] as const) {
    it(`closes the sheet when its reader ${what}, showing none of their audience, and a late answer draws nothing`, async () => {
      install({ 'org.policy.get': read([entry({ shares: [{ member: ANA, grade: 'view' }, { member: BEN, grade: 'list' }] })]) });
      const sheet = await open();
      await within(sheet).findByText(SHARE.general);
      fireEvent.click(within(sheet).getByRole('button', { name: 'Remove Ben' }));
      fireEvent.click(within(sheet).getByRole('button', { name: SHARE.save }));
      act(() => useHubAccess.setState({ member: next }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.body.textContent).not.toMatch(/Ana|Ben|ana@|ben@/);
      await fake.reply('org.policy.set', { ok: true, results: [{ line: { kind: 'share', member: BEN, grade: null }, state: 'done', changed: true, policyRev: 8, elsewhere: false }], policy: entry({ policyRev: 8 }) } satisfies OrgPolicySetResult);
      await settle();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.body.textContent).not.toMatch(/Ana|Ben/);
    });
  }
});

describe('what the sheet cannot offer', () => {
  it("says the machine's sminos can't keep a session's reach yet and names the remedy (board 523), and offers nothing", async () => {
    install({ 'org.policy.get': { ok: true, machine: OTHER_MACHINE, supported: false } satisfies OrgPolicy });
    const sheet = await open();
    expect(await within(sheet).findByText("studio-mini's sminos can't keep a session's reach yet. Update sminos on studio-mini, then open this again.")).toBeTruthy();
    expect(within(sheet).queryAllByRole('radio')).toEqual([]);
    expect(within(sheet).queryByRole('button', { name: SHARE.save })).toBeNull();
    expect(within(sheet).getByRole('button', { name: SHARE.close })).toBeTruthy();
  });

  it("says its reach can't be read right now for an unavailable entry, and reloads", async () => {
    install({});
    const sheet = await open();
    await fake.reply('org.policy.get', read([{ session: 'sess-1', unavailable: true }]));
    expect(await within(sheet).findByText("Its reach can't be read right now")).toBeTruthy();
    expect(within(sheet).queryAllByRole('radio')).toEqual([]);
    fireEvent.click(within(sheet).getByRole('button', { name: SHARE.reload }));
    await fake.reply('org.policy.get', read([entry()]));
    await waitFor(() => expect(within(sheet).getAllByRole('radio')).toHaveLength(4));
  });

  it('says why a read was refused, in its words or as the generic line', async () => {
    install({});
    const sheet = await open();
    await fake.reply('org.policy.get', { ok: false, machine: OTHER_MACHINE, reason: 'offline' } satisfies OrgPolicy);
    expect(await within(sheet).findByText(REFUSALS.offline('studio-mini'))).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: SHARE.reload }));
    await fake.reply('org.policy.get', { ok: false, machine: OTHER_MACHINE, reason: 'closed' } satisfies OrgPolicy);
    expect(await within(sheet).findByText(SHARE.refused('studio-mini'))).toBeTruthy();
    expect(within(sheet).getByText('closed')).toBeTruthy();
  });
});

describe('saveOf', () => {
  const policy = { session: 'sess-1', access: 'listed' as const, shares: [{ member: ANA, grade: 'view' as const }], policyRev: 3 };
  it("is null when nothing changed, and carries only what did, in the people's order", () => {
    expect(saveOf(ADDRESS, policy, 'listed', [{ member: ANA, was: 'view', grade: 'view' }])).toBeNull();
    expect(saveOf(ADDRESS, policy, 'listed', [{ member: ANA, was: 'view', grade: 'approve' }])).toEqual({ address: ADDRESS, shares: [{ member: ANA, grade: 'approve' }], policyRev: 3 });
    expect(saveOf(ADDRESS, policy, 'org-view', [{ member: ANA, was: 'view', grade: 'view' }])).toEqual({ address: ADDRESS, access: 'org-view', policyRev: 3 });
    expect(
      saveOf(ADDRESS, policy, 'listed', [
        { member: BEN, was: null, grade: 'list' },
        { member: ANA, was: 'view', grade: null },
      ]),
    ).toEqual({ address: ADDRESS, shares: [{ member: BEN, grade: 'list' }, { member: ANA, grade: null }], policyRev: 3 });
  });
});
