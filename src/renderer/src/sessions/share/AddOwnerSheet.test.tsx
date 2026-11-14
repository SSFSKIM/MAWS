// The Add owner sheet (P5 O8 M5b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M5b's "At its end" and
// Proves, and the Decision Log's "M5b's refresh at its cut", items 3 and 4): it opens on a fresh read of the session's
// policy, as Share's does; offers the head's members who aren't you and whom the session's listing doesn't name an owner
// (every member but you for a session with no listing); sends `org.owners.add {address, member}`; and shows the act's
// outcome: added, "already an owner" for a no-op (never a failure), a refusal in its words. A machine whose sminos can't
// keep a reach says so and offers nothing; a reach that can't be read offers a reload. A change of who is signed in
// closes it.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import type { RecordPolicyEntry } from '@shared/ipc/schema/endpoint';
import type { OrgPolicy, OrgPolicyOutcome, OrgPolicySetResult, OrgView } from '@shared/ipc/schema/org';
import { addressOf } from '@shared/machine/address';
import { record, remoteRow } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../../test/support/machine';
import { useHubAccess } from '../../stores/hub-access';
import { useMachines } from '../../stores/machines';
import { useSessions } from '../../stores/sessions';
import { resetShellStores } from '../../test-support/shell-stores';
import { closeDialog, openDialog } from '../dialogs';
import { SessionDialogs } from '../SessionDialogs';
import { OWNER, REFUSALS, SHARE } from './copy';

const ME = 'member-me';
const ANA = 'member-ana';
const BEN = 'member-ben';
const CHEN = 'member-chen';
const ADDRESS = addressOf(OTHER_MACHINE, 'sess-1') as AppSessionId;
const HERE = at('app-here') as AppSessionId;

const member = (id: string, name: string, you = false): OrgView['members'][number] => ({ id, email: `${name.toLowerCase()}@northwind.example`, name, role: 'member', you, devices: [] });
const VIEW: OrgView = { version: 3, issued: '2026-11-09T10:00:00Z', maySign: false, recoveryKid: 'kid', members: [member(ME, 'Me', true), member(ANA, 'Ana'), member(BEN, 'Ben'), member(CHEN, 'Chen')], machines: [], roots: [], delegations: [], strayKeys: [], hubKeys: { at: null, failed: false } };
const entry = (session = 'sess-1'): RecordPolicyEntry => ({ session, access: 'listed', shares: [], policyRev: 4 });
const read = (machine: typeof OTHER_MACHINE, policies: RecordPolicyEntry[]): OrgPolicy => ({ ok: true, machine, supported: true, policies });
const added = (memberId: string, over: Partial<Extract<OrgPolicyOutcome, { state: 'done' }>> = {}): OrgPolicySetResult => ({
  ok: true,
  results: [{ line: { kind: 'owner', member: memberId }, state: 'done', changed: true, policyRev: 5, elsewhere: false, ...over }],
  policy: entry(),
});

let fake: FakeClient;
const install = (answers: Parameters<typeof fakeClient>[0]) => {
  fake = fakeClient({ 'org.view': VIEW, ...answers });
  window.maws = fake.client as unknown as PreloadBridge;
};
const open = async (address: AppSessionId = ADDRESS) => {
  act(() => openDialog({ kind: 'addOwner', address }));
  return screen.findByRole('dialog', { name: OWNER.title });
};
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const picker = (sheet: HTMLElement) => within(sheet).getByRole('combobox', { name: OWNER.person }) as HTMLSelectElement;
const offered = (sheet: HTMLElement) => [...picker(sheet).options].map((o) => o.value).filter((v) => v !== '');
const submit = (sheet: HTMLElement) => within(sheet).getByRole('button', { name: OWNER.add }) as HTMLButtonElement;
const choose = (sheet: HTMLElement, id: string) => fireEvent.change(picker(sheet), { target: { value: id } });

beforeEach(() => {
  resetShellStores();
  useHubAccess.setState({ access: 'connected', member: ME });
  useMachines.getState().applyRoster([
    { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-11-09T10:00:00Z', generation: 0 },
    { ref: OTHER_MACHINE, name: 'studio-mini', local: false, state: 'up', since: '2026-11-09T10:00:00Z', generation: 0 },
  ]);
  useSessions.setState({
    listed: new Map([[ADDRESS, { ...remoteRow(OTHER_MACHINE, 'sess-1', { title: 'Nightly import', owners: [ME, ANA], project: 'proj-1' }), appId: ADDRESS }]]),
    records: new Map([[HERE, record(HERE, { title: { text: 'Here', source: 'user' } })]]),
  });
  render(<SessionDialogs />);
});
afterEach(() => {
  act(() => closeDialog());
  cleanup();
  useHubAccess.setState({ access: null, member: null });
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('who it offers', () => {
  it("opens on a fresh read and offers the head's members who aren't you and whom the listing doesn't name an owner", async () => {
    install({ 'org.policy.get': read(OTHER_MACHINE, [entry()]) });
    const sheet = await open();
    await within(sheet).findByRole('combobox', { name: OWNER.person });
    expect(fake.invoked('org.policy.get')).toEqual([{ address: ADDRESS }]);
    expect(sheet.querySelector('[data-share-session]')!.textContent).toBe('Nightly import · studio-mini');
    expect(sheet.querySelector('[data-share-session]')!.getAttribute('title')).toBe('Nightly import · studio-mini'); // board 523: the whole title and machine on hover
    expect(within(sheet).getByText(OWNER.line)).toBeTruthy();
    expect(offered(sheet)).toEqual([BEN, CHEN]);
    expect([...picker(sheet).options].find((o) => o.value === BEN)!.textContent).toBe('Ben · ben@northwind.example');
    expect(submit(sheet).disabled).toBe(true); // nobody chosen yet
    choose(sheet, BEN);
    expect(submit(sheet).disabled).toBe(false);
  });

  it('offers every member but you on a session with no listing', async () => {
    install({ 'org.policy.get': read(TEST_MACHINE, [entry('app-here')]) });
    const sheet = await open(HERE);
    await within(sheet).findByRole('combobox', { name: OWNER.person });
    expect(offered(sheet)).toEqual([ANA, BEN, CHEN]);
  });

  it('says so when everyone already owns it', async () => {
    install({ 'org.policy.get': read(OTHER_MACHINE, [entry()]), 'org.view': { ...VIEW, members: [member(ME, 'Me', true), member(ANA, 'Ana')] } });
    const sheet = await open();
    await within(sheet).findByRole('combobox', { name: OWNER.person });
    expect(picker(sheet).disabled).toBe(true);
    expect(picker(sheet).options[0].textContent).toBe(OWNER.nobodyToAdd);
  });
});

describe('the add and its outcome', () => {
  it('sends org.owners.add for the person chosen, shows them added, and offers them no more', async () => {
    install({ 'org.policy.get': read(OTHER_MACHINE, [entry()]), 'org.owners.add': added(BEN) });
    const sheet = await open();
    await within(sheet).findByRole('combobox', { name: OWNER.person });
    choose(sheet, BEN);
    fireEvent.click(submit(sheet));
    await settle();
    expect(fake.invoked('org.owners.add')).toEqual([{ address: ADDRESS, member: BEN }]);
    const outcome = sheet.querySelector('[data-owner-outcome]')!;
    expect(outcome.getAttribute('data-owner-outcome')).toBe('done');
    expect(outcome.textContent).toBe(`Ben · ${OWNER.added}`);
    expect(within(sheet).getByText(OWNER.relisted('studio-mini'))).toBeTruthy();
    expect(offered(sheet)).toEqual([CHEN]);
    expect(picker(sheet).value).toBe('');
    expect(within(sheet).getByRole('button', { name: SHARE.close })).toBeTruthy();
  });

  it('reads a no-op as "already an owner", not a failure', async () => {
    install({ 'org.policy.get': read(OTHER_MACHINE, [entry()]), 'org.owners.add': added(CHEN, { changed: false, policyRev: 4 }) });
    const sheet = await open();
    await within(sheet).findByRole('combobox', { name: OWNER.person });
    choose(sheet, CHEN);
    fireEvent.click(submit(sheet));
    await settle();
    const outcome = sheet.querySelector('[data-owner-outcome]')!;
    expect(outcome.textContent).toBe(`Chen · ${OWNER.already}`);
    expect(outcome.querySelector('.text-danger')).toBeNull();
    expect(within(sheet).queryByRole('alert')).toBeNull();
  });

  it("shows a refused act in its refuser's words, and a save main refused before sending as an alert", async () => {
    install({
      'org.policy.get': read(OTHER_MACHINE, [entry()]),
      'org.owners.add': { ok: true, results: [{ line: { kind: 'owner', member: BEN }, state: 'refused', reason: 'grade' }], policy: entry() } satisfies OrgPolicySetResult,
    });
    const sheet = await open();
    await within(sheet).findByRole('combobox', { name: OWNER.person });
    choose(sheet, BEN);
    fireEvent.click(submit(sheet));
    await settle();
    const outcome = sheet.querySelector('[data-owner-outcome]')!;
    expect(outcome.getAttribute('data-owner-outcome')).toBe('refused');
    expect(outcome.textContent).toBe(`Ben · ${REFUSALS.grade('studio-mini')}`);
    expect(within(sheet).queryByText(OWNER.relisted('studio-mini'))).toBeNull();
    expect(offered(sheet)).toEqual([BEN, CHEN]); // nothing changed: still offered

    fake = fakeClient({ 'org.view': VIEW, 'org.policy.get': read(OTHER_MACHINE, [entry()]), 'org.owners.add': { ok: false, reason: 'cancelled' } satisfies OrgPolicySetResult });
    window.maws = fake.client as unknown as PreloadBridge;
    choose(sheet, BEN);
    fireEvent.click(submit(sheet));
    await settle();
    expect(within(sheet).getByRole('alert').textContent).toBe(REFUSALS.cancelled('studio-mini'));
    expect(sheet.querySelector('[data-owner-outcome]')).toBeNull();
  });
});

describe('what it says instead', () => {
  it("says a machine whose sminos can't keep a reach can't yet, and offers nothing", async () => {
    install({ 'org.policy.get': { ok: true, machine: OTHER_MACHINE, supported: false } satisfies OrgPolicy });
    const sheet = await open();
    await within(sheet).findByText(SHARE.unsupported('studio-mini'));
    expect(within(sheet).queryByRole('combobox')).toBeNull();
    expect(within(sheet).queryByRole('button', { name: OWNER.add })).toBeNull();
  });

  it("says a reach that can't be read, and reads again on Reload", async () => {
    install({ 'org.policy.get': read(OTHER_MACHINE, [{ session: 'sess-1', unavailable: true }]) });
    const sheet = await open();
    await within(sheet).findByText(SHARE.unavailable);
    expect(within(sheet).queryByRole('combobox')).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: SHARE.reload }));
    await waitFor(() => expect(fake.invoked('org.policy.get')).toHaveLength(2));
  });

  it('closes when who is signed in changes', async () => {
    install({ 'org.policy.get': read(OTHER_MACHINE, [entry()]) });
    await open();
    act(() => useHubAccess.setState({ member: ANA }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: OWNER.title })).toBeNull());
  });
});
