// P5 O8 M4b: the grant sheets (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4b's "Rights" and
// "Re-granting"). Grant… offers a person, then the rights, each with its line, preselected as the machine holds them; Save
// sends `org.grants.set` (withdraw: no rights) and main signs one grant behind one Touch ID. While main brings the machine
// up to date and asks, the sheet says so. Re-grant… shows each missing grant, then sends `org.grants.regrant` naming the
// list shown. Every refusal reads in its own words; an answer that comes after the sheet closed, or after the sign-in it
// opened under ended, lands nowhere.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { GRANT_REFUSALS, type GrantRegrantResult, type GrantSetResult, type GrantsView, type OrgView } from '@shared/ipc/schema/org';
import { ANA, BEN, CAT, ME, MINI, ROOT, emit, emitGrants, found, grantsOf, renderSection, resetHarness, row, sent, signing, viewWith } from './test-support';

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(resetHarness);

type Machine = OrgView['machines'][number];
// mini as its owner (you, on a Mac that isn't a root) sees it: Ana an admin, Ben and Cat members
const MINE: Machine = { name: 'mini', ref: MINI, owners: [ME], keyId: 'miniKeyId0001', certified: false, delegation: null, mayGrant: true };
const notSigning = { root: false, maySign: false } as const;
const VIEWED = viewWith({ maySign: false, machines: [MINE] });
const MINIS = grantsOf(MINI, { grants: [{ member: BEN, rights: ['spawn'], version: 3, state: 'on-machine' }] });
const SAVING = 'Bringing mini up to date, then Touch ID shows the grant…';

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
async function openGrant() {
  fireEvent.click(await within(await found('mini')).findByRole('button', { name: 'Grant…' }));
  return screen.findByRole('dialog', { name: 'Rights on mini' });
}
const box = (sheet: HTMLElement, right: string) => within(sheet).getByRole('checkbox', { name: new RegExp(`^${right} `) }) as HTMLInputElement;
const person = (sheet: HTMLElement) => within(sheet).getByRole('combobox', { name: 'Person' }) as HTMLSelectElement;

describe('Settings › Org: the grant sheet (M4b)', () => {
  it('a person, then the rights with their lines, preselected as held; Save sends the grant, says what it waits on while main works, and the row tells how it stands', async () => {
    const answer = deferred<GrantSetResult>();
    let reads = 0;
    renderSection(signing(notSigning), { 'org.view': () => VIEWED, 'org.grants.view': () => {
        reads += 1;
        return MINIS;
      }, 'org.grants.set': () => answer.promise });
    const sheet = await openGrant();
    await vi.waitFor(() => expect(reads).toBe(2)); // read as the row opened, and again as the sheet did
    // owners hold every right: you are offered no grant on your own machine
    expect(Array.from(person(sheet).options).map((o) => o.textContent)).toEqual(['Choose a person', 'Ana (ana@example.com)', 'Ben (ben@example.com)', 'Cat (cat@example.com)']);
    expect(within(sheet).getByText('Start sessions on it.')).toBeTruthy();
    expect(within(sheet).getByText('Open a terminal and forward ports on it, outside any session.')).toBeTruthy();
    expect(within(sheet).getByText('Set its read-only mode and its ceilings.')).toBeTruthy();
    expect(box(sheet, 'spawn').disabled).toBe(true); // no person yet

    fireEvent.change(person(sheet), { target: { value: BEN } });
    expect(box(sheet, 'spawn').checked).toBe(true); // as Ben holds it
    expect(box(sheet, 'shell').checked).toBe(false);
    const save = within(sheet).getByRole('button', { name: 'Save…' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // nothing changed yet
    fireEvent.click(box(sheet, 'shell'));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await vi.waitFor(() => expect(sent('org.grants.set')).toEqual([{ ref: MINI, member: BEN, rights: ['spawn', 'shell'] }]));

    // main pushes the head, reads the ledger again and asks for Touch ID: the sheet says so, never a dead button
    expect(within(sheet).getByRole('status').textContent).toBe(SAVING);
    expect((within(sheet).getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(sheet).queryByRole('button', { name: /cancel/i })).toBeNull(); // main offers no cancel for a grant: none is shown
    expect(within(sheet).getByRole('button', { name: 'Close' })).toBeTruthy(); // the sheet can still close
    expect(box(sheet, 'spawn').disabled).toBe(true);

    await act(async () => answer.resolve({ ok: true, version: 4, delivered: 'pending' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(row('mini')).getByText('Signed grant version 4. Not yet on mini: it’s sent once mini is reachable.')).toBeTruthy();
  });

  it('a grant on the machine, refused, or another device’s: each answer’s line', async () => {
    for (const [delivered, words] of [
      ['done', 'Signed grant version 4. mini holds it.'],
      [{ refused: 'not-newer' }, 'Signed grant version 4. Another device changed this grant: sign again.'],
      [{ refused: 'not-held' }, 'Signed grant version 4. mini refused it (not-held): sign again.'],
    ] as const) {
      renderSection(signing(notSigning), { 'org.view': () => VIEWED, 'org.grants.view': () => MINIS, 'org.grants.set': () => ({ ok: true, version: 4, delivered }) satisfies GrantSetResult });
      const sheet = await openGrant();
      fireEvent.change(person(sheet), { target: { value: CAT } });
      fireEvent.click(box(sheet, 'spawn'));
      fireEvent.click(within(sheet).getByRole('button', { name: 'Save…' }));
      await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(within(row('mini')).getByText(words)).toBeTruthy();
      resetHarness();
    }
  });

  it('withdrawing is no rights, said before it is sent', async () => {
    renderSection(signing(notSigning), { 'org.view': () => VIEWED, 'org.grants.view': () => MINIS, 'org.grants.set': () => ({ ok: true, version: 4, delivered: 'done' }) satisfies GrantSetResult });
    const sheet = await openGrant();
    fireEvent.change(person(sheet), { target: { value: BEN } });
    await vi.waitFor(() => expect(box(sheet, 'spawn').checked).toBe(true));
    fireEvent.click(box(sheet, 'spawn'));
    expect(within(sheet).getByText('With no rights, this withdraws every right ben@example.com holds on mini.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Withdraw…' }));
    await vi.waitFor(() => expect(sent('org.grants.set')).toEqual([{ ref: MINI, member: BEN, rights: [] }]));
  });

  it('every refusal reads in its own words, ineligible with each problem and ledger-unread with main’s detail; a Touch ID cancel says nothing and Save stays', async () => {
    let answer: GrantSetResult = { ok: false, reason: 'cancelled' };
    renderSection(signing(notSigning), { 'org.view': () => VIEWED, 'org.grants.view': () => MINIS, 'org.grants.set': () => answer });
    const sheet = await openGrant();
    fireEvent.change(person(sheet), { target: { value: CAT } });
    fireEvent.click(box(sheet, 'machine-admin'));
    const save = within(sheet).getByRole('button', { name: 'Save…' }) as HTMLButtonElement;
    fireEvent.click(save);
    await vi.waitFor(() => expect(sent('org.grants.set')).toHaveLength(1));
    await vi.waitFor(() => expect(save.disabled).toBe(false));
    expect(within(sheet).queryByRole('alert')).toBeNull();

    const said = new Map<string, string>();
    for (const reason of GRANT_REFUSALS) {
      answer = { ok: false, reason, detail: `why-${reason}` };
      fireEvent.click(within(sheet).getByRole('button', { name: 'Save…' }));
      const alert = await within(sheet).findByRole('alert');
      expect(alert.textContent).toContain(`why-${reason}`);
      said.set(reason, alert.textContent!);
    }
    expect(new Set(said.values()).size).toBe(GRANT_REFUSALS.length); // each its own line
    expect(said.get('stale')).toBe('Not signed · The org state moved while this was signed. Nothing was kept or sent: sign again. · why-stale');

    answer = { ok: false, reason: 'ineligible', problems: ['signer-not-owner', 'member-not-listed', 'some-new-code'] };
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save…' }));
    await vi.waitFor(() => expect(within(sheet).getByRole('alert').textContent).toContain('this Mac’s key isn’t an owner’s'));
    expect(within(within(sheet).getByRole('alert')).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'this Mac’s key isn’t an owner’s (an admin’s, for a machine the org owns)',
      'the org state doesn’t list the person',
      'some-new-code',
    ]);

    // this Mac's own machine, through the door: its endpoint hasn't seen the person yet
    answer = { ok: false, reason: 'ledger-unread', detail: "this Mac's own endpoint hasn't seen this member yet: try again shortly" };
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save…' }));
    await vi.waitFor(() =>
      expect(within(sheet).getByRole('alert').textContent).toBe("Not signed · The machine’s grants couldn’t be read, so no version was guessed. Nothing was signed. · this Mac's own endpoint hasn't seen this member yet: try again shortly"),
    );
    expect(sent('org.grants.set')).toHaveLength(GRANT_REFUSALS.length + 3);
  });

  it('Sign again… on a refused grant opens the sheet on that person and those rights', async () => {
    renderSection(signing(notSigning), {
      'org.view': () => VIEWED,
      'org.grants.view': () => grantsOf(MINI, { grants: [{ member: CAT, rights: ['spawn', 'machine-admin'], version: 5, state: 'refused', reason: 'not-newer' }] }),
      'org.grants.set': () => ({ ok: true, version: 6, delivered: 'done' }) satisfies GrantSetResult,
    });
    fireEvent.click(await within(await found('mini')).findByRole('button', { name: 'Sign again…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Rights on mini' });
    expect(person(sheet).value).toBe(CAT);
    expect(box(sheet, 'spawn').checked).toBe(true);
    expect(box(sheet, 'machine-admin').checked).toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save…' })); // what the machine holds is its own word: sign again as shown
    await vi.waitFor(() => expect(sent('org.grants.set')).toEqual([{ ref: MINI, member: CAT, rights: ['spawn', 'machine-admin'] }]));
  });

  it('on an org-owned machine its admins are its owners; a former owner still holding a grant is offered, to withdraw it', async () => {
    const ORGS: Machine = { ...MINE, owners: 'org' };
    renderSection(signing(ROOT), { 'org.view': () => viewWith({ machines: [ORGS] }), 'org.grants.view': () => grantsOf(MINI, { grants: [{ member: ANA, rights: ['shell'], version: 2, state: 'on-machine' }] }) });
    const sheet = await openGrant();
    expect(Array.from(person(sheet).options).map((o) => o.value)).toEqual(['', ANA, BEN, CAT]); // you, an admin, are an owner; Ana keeps her grant
  });

  it('closing the sheet while the grant is out leaves nothing of its answer; a sign-in that ends closes it', async () => {
    const answer = deferred<GrantSetResult>();
    renderSection(signing(notSigning), { 'org.view': () => VIEWED, 'org.grants.view': () => MINIS, 'org.grants.set': () => answer.promise });
    let sheet = await openGrant();
    fireEvent.change(person(sheet), { target: { value: CAT } });
    fireEvent.click(box(sheet, 'spawn'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save…' }));
    await vi.waitFor(() => expect(sent('org.grants.set')).toHaveLength(1));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await act(async () => answer.resolve({ ok: true, version: 4, delivered: 'done' }));
    expect(within(row('mini')).queryByText(/Signed grant/)).toBeNull();

    // the sign-in ends with the sheet open and a grant out: the sheet goes, and its answer with it
    const second = deferred<GrantSetResult>();
    resetHarness();
    renderSection(signing(notSigning), { 'org.view': () => VIEWED, 'org.grants.view': () => MINIS, 'org.grants.set': () => second.promise });
    sheet = await openGrant();
    fireEvent.change(person(sheet), { target: { value: CAT } });
    fireEvent.click(box(sheet, 'spawn'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save…' }));
    await vi.waitFor(() => expect(sent('org.grants.set')).toHaveLength(1));
    emit(signing(notSigning, { session: 'signed-out' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await act(async () => second.resolve({ ok: true, version: 4, delivered: 'done' }));
    expect(screen.queryByText(/Signed grant/)).toBeNull();
  });

  it('once this Mac may no longer sign a grant there, Save is withdrawn and the sheet says why', async () => {
    let damaged = false;
    renderSection(signing(notSigning), { 'org.view': () => VIEWED, 'org.grants.view': (input: { ref: string }) => (damaged ? ({ ok: false, ref: input.ref, reason: 'damaged' } satisfies GrantsView) : MINIS) });
    const sheet = await openGrant();
    fireEvent.change(person(sheet), { target: { value: CAT } });
    expect(within(sheet).getByRole('button', { name: 'Save…' })).toBeTruthy();
    damaged = true;
    emit(signing(notSigning)); // a status with no grants change reads nothing
    expect(within(sheet).getByRole('button', { name: 'Save…' })).toBeTruthy();
    emitGrants(MINI); // its grants moved: the row reads them, damaged
    expect(await within(sheet).findByText('This Mac can’t sign grants on mini now.')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Save…' })).toBeNull();
  });
});

describe('Settings › Org: the re-grant sheet (M4b)', () => {
  const MISSING = grantsOf(MINI, {
    missing: [
      { member: BEN, rights: ['spawn'], version: 3 },
      { member: CAT, rights: ['spawn', 'shell'], version: 2 },
    ],
    digest: 'missing-digest-1',
  });

  it('shows each missing grant, then re-grants the list shown, saying what it waits on while main works', async () => {
    const answer = deferred<GrantRegrantResult>();
    renderSection(signing(notSigning), { 'org.view': () => VIEWED, 'org.grants.view': () => MISSING, 'org.grants.regrant': () => answer.promise });
    fireEvent.click(await within(await found('mini')).findByRole('button', { name: 'Re-grant…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Re-grant on mini?' });
    expect(within(sheet).getByText('Each is signed again for mini’s current key, under one Touch ID, and delivered:')).toBeTruthy();
    expect(within(sheet).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Ben: spawn', 'Cat: spawn and shell']);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Re-grant' }));
    await vi.waitFor(() => expect(sent('org.grants.regrant')).toEqual([{ ref: MINI, digest: 'missing-digest-1' }]));
    expect(within(sheet).getByRole('status').textContent).toBe(SAVING);
    expect((within(sheet).getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(sheet).queryByRole('button', { name: 'Cancel' })).toBeNull();
    await act(async () =>
      answer.resolve({
        ok: true,
        results: [
          { member: BEN, version: 4, delivered: 'done' },
          { member: CAT, version: 3, delivered: 'pending' },
        ],
      }),
    );
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(row('mini')).getByText('Signed 2 grants again for mini.')).toBeTruthy();
  });

  it('a list that moved reads stale and nothing is kept; an answer after the sheet closed lands nowhere', async () => {
    let answer: GrantRegrantResult | Promise<GrantRegrantResult> = { ok: false, reason: 'stale', detail: 'the missing grants are no longer the ones shown' };
    renderSection(signing(notSigning), { 'org.view': () => VIEWED, 'org.grants.view': () => MISSING, 'org.grants.regrant': () => answer });
    fireEvent.click(await within(await found('mini')).findByRole('button', { name: 'Re-grant…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Re-grant on mini?' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Re-grant' }));
    expect((await within(sheet).findByRole('alert')).textContent).toBe('Not signed · The org state moved while this was signed. Nothing was kept or sent: sign again. · the missing grants are no longer the ones shown');

    const late = deferred<GrantRegrantResult>();
    answer = late.promise;
    fireEvent.click(within(sheet).getByRole('button', { name: 'Re-grant' }));
    await vi.waitFor(() => expect(sent('org.grants.regrant')).toHaveLength(2));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await act(async () => late.resolve({ ok: true, results: [{ member: BEN, version: 4, delivered: 'done' }] }));
    expect(within(row('mini')).queryByText(/again for mini/)).toBeNull();
  });
});
