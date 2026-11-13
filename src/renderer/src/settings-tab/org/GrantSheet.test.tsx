// P5 O8 M4b: the grant sheets (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4b's "Rights" and
// "Re-granting"). Grant… offers a person, then the rights, each with its line, preselected as the machine holds them; Save
// sends `org.grants.set` (withdraw: no rights) and main signs one grant behind one Touch ID. While main brings the machine
// up to date and asks, the sheet says so. Re-grant… shows each missing grant, then sends `org.grants.regrant` naming the
// list shown. Every refusal reads in its own words; an answer that comes after the sheet closed, or after the sign-in it
// opened under ended, lands nowhere.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { GRANT_REFUSALS, type GrantRegrantResult, type GrantSetResult, type GrantsView, type OrgView } from '@shared/ipc/schema/org';
import { GrantSheet } from './GrantSheet';
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
const GRANT_BOXES = ['spawn', 'shell', 'machine-admin'] as const;
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
    expect(within(sheet).getByText('Connect, sign in and disconnect its connectors, and choose the connector tools its dashboards may use.')).toBeTruthy();
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
    expect(within(row('mini')).getByText('Signed grant version 4. Not yet on mini: this Mac keeps sending it until mini answers.')).toBeTruthy();
  });

  it('a grant on the machine, refused, or another device’s: each answer’s line', async () => {
    for (const [delivered, words] of [
      ['done', 'Signed grant version 4. mini holds it.'],
      [{ refused: 'not-newer' }, 'Signed grant version 4. Another device changed this grant: sign again.'],
      [{ refused: 'not-held' }, 'Signed grant version 4. mini refused it: it no longer holds the key this grant names. Sign again. · not-held'],
      // left sending across a restart: no machine's verdict, so the line doesn't blame the machine
      [{ refused: 'outcome-unknown' }, 'Signed grant version 4. This Mac stopped before mini’s answer came: sign again.'],
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

  it('every refusal reads in its own words, and names what to do next; a Touch ID cancel says nothing and Save stays', async () => {
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

    // each its own explanation, not its detail's: with no detail, every line is apart
    const lines = new Set<string>();
    for (const reason of GRANT_REFUSALS) {
      if (reason === 'cancelled') continue; // a Touch ID cancel with no detail says nothing (above)
      answer = { ok: false, reason };
      const asked = sent('org.grants.set').length;
      fireEvent.click(within(sheet).getByRole('button', { name: 'Save…' }));
      await vi.waitFor(() => expect(sent('org.grants.set')).toHaveLength(asked + 1));
      await act(async () => {}); // its answer drawn
      const text = within(sheet).getByRole('alert').textContent!;
      expect(text).toMatch(/^Not signed · [^·]+$/);
      lines.add(text);
    }
    expect(lines.size).toBe(GRANT_REFUSALS.length - 1);
    expect(within(sheet).getByRole('button', { name: 'Save…' })).toBeTruthy();
  });

  // U11a board 540 (§B): every reason main gives the sheet, with its detail as main words it, and the exact line drawn: main's
  // detail follows the line only where it says something the line does not, and ineligible's list is drawn once
  it('each reason, given main’s detail, draws its line once, and the detail only where it adds to the line', async () => {
    const NOT = 'Not signed · ';
    const drawn: Record<(typeof GRANT_REFUSALS)[number], readonly (readonly [string | undefined, string | null])[]> = {
      'signed-out': [[undefined, `${NOT}This Mac isn’t signed in to the org. Sign in under Org, then try again.`]],
      damaged: [[undefined, `${NOT}This Mac’s record of the grants it issued is damaged and can’t be repaired here, so it signs no grant. Sign from another device of the machine’s owner (an admin’s, for a machine the org owns).`]],
      storage: [
        ['grants.json could not be written (EIO): nothing was sent', `${NOT}The grant couldn’t be saved on this Mac. Try again; if it keeps failing, check the disk’s free space. · grants.json could not be written (EIO): nothing was sent`],
        [
          `${MINI} answered done, but grants.json could not record it (EIO): it is not sent again, and the record is written again at the next pass`,
          `${NOT}The grant couldn’t be saved on this Mac. Try again; if it keeps failing, check the disk’s free space. · ${MINI} answered done, but grants.json could not record it (EIO): it is not sent again, and the record is written again at the next pass`,
        ],
      ],
      busy: [['another grant is being signed', `${NOT}Another grant is being signed. Try again once it’s done.`]],
      invalid: [['a right is named twice', `${NOT}The rights were sent wrongly (one was named twice). Close this sheet and choose them again.`]],
      'no-change': [['the member holds these rights already', `${NOT}They hold these rights already.`]],
      ineligible: [["this grant can't be signed here: signer-not-owner", `${NOT}This Mac can’t sign this grant. Sign it from another device of the machine’s owner, or resolve:`]],
      'ledger-unread': [
        ['this Mac’s own endpoint hasn’t seen this member yet', `${NOT}The machine’s grants for this person couldn’t be read, so nothing was signed. Try again in a moment. · this Mac’s own endpoint hasn’t seen this member yet`],
        [`${MINI}'s grant ledger can't be read (offline): no version is guessed`, `${NOT}The machine’s grants for this person couldn’t be read, so nothing was signed. Try again in a moment. · ${MINI}'s grant ledger can't be read (offline): no version is guessed`],
      ],
      cancelled: [[undefined, null]], // Touch ID cancelled: nothing to say
      refused: [['unknown-signer', `${NOT}The signed grant didn’t verify against the org state held now. Nothing was kept or sent: sign again. · unknown-signer`]],
      stale: [['the org state moved after the grant was verified: nothing was kept or sent, sign again', `${NOT}What this would sign changed meanwhile. Nothing was kept or sent: sign again.`]],
      none: [['no grant this Mac issued is missing there', `${NOT}Nothing is missing on the machine now.`]],
    };
    let answer: GrantSetResult = { ok: false, reason: 'cancelled' };
    renderSection(signing(notSigning), { 'org.view': () => VIEWED, 'org.grants.view': () => MINIS, 'org.grants.set': () => answer });
    const sheet = await openGrant();
    fireEvent.change(person(sheet), { target: { value: CAT } });
    fireEvent.click(box(sheet, 'machine-admin'));
    for (const reason of GRANT_REFUSALS) {
      for (const [detail, words] of drawn[reason]) {
        answer = { ok: false, reason, ...(detail === undefined ? {} : { detail }), ...(reason === 'ineligible' ? { problems: ['signer-not-owner'] } : {}) };
        const asked = sent('org.grants.set').length;
        fireEvent.click(within(sheet).getByRole('button', { name: 'Save…' }));
        await vi.waitFor(() => expect(sent('org.grants.set')).toHaveLength(asked + 1));
        await act(async () => {}); // its answer drawn
        const alert = within(sheet).queryByRole('alert');
        if (words === null) expect(alert, reason).toBeNull();
        else expect(alert?.querySelector('p')?.textContent, `${reason}, ${detail ?? 'no detail'}`).toBe(words);
      }
    }

    // ineligible: the line, then each problem once, in words, a code with none as itself
    answer = { ok: false, reason: 'ineligible', detail: "this grant can't be signed here: signer-not-owner, member-not-listed, some-new-code", problems: ['signer-not-owner', 'member-not-listed', 'some-new-code'] };
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save…' }));
    await vi.waitFor(() => expect(within(sheet).getAllByRole('listitem')).toHaveLength(3));
    const alert = within(sheet).getByRole('alert');
    expect(alert.querySelector('p')?.textContent).toBe(`${NOT}This Mac can’t sign this grant. Sign it from another device of the machine’s owner, or resolve:`);
    expect(within(alert).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'this Mac’s key isn’t an owner’s (an admin’s, for a machine the org owns)',
      'the org state doesn’t list the person',
      'some-new-code',
    ]);
    expect(alert.textContent).not.toContain('signer-not-owner');
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

  it('before the machine’s grants are first read, the sheet waits on them: no right to tick and no Save', async () => {
    const read = deferred<GrantsView>();
    renderSection(signing(notSigning), { 'org.view': () => VIEWED, 'org.grants.view': () => read.promise, 'org.grants.set': () => ({ ok: true, version: 4, delivered: 'done' }) satisfies GrantSetResult });
    const sheet = await openGrant();
    fireEvent.change(person(sheet), { target: { value: BEN } });
    expect(within(sheet).getByText('Reading mini’s grants…')).toBeTruthy();
    expect(GRANT_BOXES.map((right) => box(sheet, right).disabled)).toEqual([true, true, true]);
    const save = within(sheet).getByRole('button', { name: 'Save…' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.submit(save.form!); // Enter: nothing is sent either
    expect(sent('org.grants.set')).toEqual([]);
    await act(async () => read.resolve(MINIS));
    expect(within(sheet).queryByText('Reading mini’s grants…')).toBeNull();
    expect(box(sheet, 'spawn').checked).toBe(true); // as Ben holds it, once known
    expect(save.disabled).toBe(true); // nothing changed yet
  });

  it('a refused read of the grants says why in the row and the sheet, with Retry, and nothing signs until a read answers', async () => {
    let refuse = true;
    let reads = 0;
    renderSection(signing(notSigning), {
      'org.view': () => VIEWED,
      'org.grants.view': (input: { ref: string }) => {
        reads += 1;
        return refuse ? ({ ok: false, ref: input.ref, reason: 'signed-out' } satisfies GrantsView) : MINIS;
      },
      'org.grants.set': () => ({ ok: true, version: 4, delivered: 'done' }) satisfies GrantSetResult,
    });
    const UNREAD = 'mini’s grants can’t be read now. This Mac isn’t signed in to the org. Sign in under Org, then try again.';
    expect(await within(await found('mini')).findByText(UNREAD)).toBeTruthy();
    expect(within(row('mini')).getByRole('button', { name: 'Retry' })).toBeTruthy();
    const sheet = await openGrant();
    await vi.waitFor(() => expect(reads).toBe(2)); // read again as the sheet opened, refused again
    expect(within(sheet).getByText(UNREAD)).toBeTruthy();
    expect(within(sheet).queryByText('Reading mini’s grants…')).toBeNull(); // it says why, never that it is still reading
    fireEvent.change(person(sheet), { target: { value: BEN } });
    expect((within(sheet).getByRole('button', { name: 'Save…' }) as HTMLButtonElement).disabled).toBe(true);
    // Retry reads again, and the sheet recovers once a read answers
    refuse = false;
    fireEvent.click(within(sheet).getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(box(sheet, 'spawn').checked).toBe(true));
    expect(reads).toBe(3);
    expect(within(sheet).queryByText(UNREAD)).toBeNull();
    fireEvent.click(box(sheet, 'shell'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save…' }));
    await vi.waitFor(() => expect(sent('org.grants.set')).toEqual([{ ref: MINI, member: BEN, rights: ['spawn', 'shell'] }]));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(row('mini')).queryByText(UNREAD)).toBeNull();
  });

  // U11a board 540: with nobody to grant to, the sheet still says the read's own state, and says so only once the grants are known
  it('on a machine every member owns: reading, then a refused read with Retry (kept while a retry is out), then nobody to grant to, or the person picker for an owner who still holds a grant', async () => {
    const EVERYONES: Machine = { ...MINE, owners: [ME, ANA, BEN, CAT] };
    const READING = 'Reading mini’s grants…';
    const UNREAD = 'mini’s grants can’t be read now. This Mac isn’t signed in to the org. Sign in under Org, then try again.';
    const NOBODY = 'Everyone in the org owns this machine, and owners hold every right.';
    const answers: Extract<GrantsView, { ok: true }>['grants'][] = [[], [{ member: BEN, rights: ['spawn'], version: 2, state: 'on-machine' }]];
    for (const held of answers) {
      const reads: ReturnType<typeof deferred<GrantsView>>[] = [];
      renderSection(signing(notSigning), {
        'org.view': () => viewWith({ maySign: false, machines: [EVERYONES] }),
        'org.grants.view': () => {
          const read = deferred<GrantsView>();
          reads.push(read);
          return read.promise;
        },
      });
      const sheet = await openGrant();
      await vi.waitFor(() => expect(reads).toHaveLength(2)); // the row's read, and the sheet's
      expect(within(sheet).getByText(READING)).toBeTruthy();
      expect(within(sheet).queryByText(NOBODY)).toBeNull(); // not before the grants are known

      await act(async () => reads[1]!.resolve({ ok: false, ref: MINI, reason: 'signed-out' }));
      expect(within(sheet).getByText(UNREAD)).toBeTruthy();
      expect(within(sheet).queryByText(READING)).toBeNull();
      expect(within(sheet).queryByText(NOBODY)).toBeNull();

      fireEvent.click(within(sheet).getByRole('button', { name: 'Retry' }));
      await vi.waitFor(() => expect(reads).toHaveLength(3));
      expect(within(sheet).getByText(UNREAD)).toBeTruthy(); // the retry is out: the earlier line and Retry stay
      expect(within(sheet).getByRole('button', { name: 'Retry' })).toBeTruthy();
      await act(async () => reads[0]!.resolve(grantsOf(MINI))); // an earlier read's answer lands nowhere
      expect(within(sheet).getByText(UNREAD)).toBeTruthy();

      await act(async () => reads[2]!.resolve(grantsOf(MINI, { grants: held })));
      expect(within(sheet).queryByText(UNREAD)).toBeNull();
      expect(within(sheet).queryByRole('button', { name: 'Retry' })).toBeNull();
      if (held.length === 0) {
        expect(within(sheet).getByText(NOBODY)).toBeTruthy();
        expect(within(sheet).queryByRole('combobox', { name: 'Person' })).toBeNull();
      } else {
        expect(within(sheet).queryByText(NOBODY)).toBeNull();
        expect(Array.from(person(sheet).options).map((o) => o.textContent)).toEqual(['Choose a person', 'Ben (ben@example.com)']); // an owner, offered to withdraw
      }
      resetHarness();
    }
  });

  it('opened on a draft before the grants are read (Sign again on a row read again), it still waits: no Save, whatever is ticked', () => {
    render(<GrantSheet machine={MINE} members={VIEWED.members} grants={null} unread={null} onRetry={() => {}} may draft={{ member: BEN, rights: ['spawn', 'shell'] }} onClose={() => {}} onSaved={() => {}} />);
    const sheet = screen.getByRole('dialog', { name: 'Rights on mini' });
    expect(within(sheet).getByText('Reading mini’s grants…')).toBeTruthy();
    expect(box(sheet, 'spawn').checked).toBe(true);
    expect(box(sheet, 'spawn').disabled).toBe(true);
    expect((within(sheet).getByRole('button', { name: 'Save…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('no rights are sent only through Withdraw: a person who holds none can’t be sent none', async () => {
    renderSection(signing(notSigning), { 'org.view': () => VIEWED, 'org.grants.view': () => MINIS, 'org.grants.set': () => ({ ok: true, version: 4, delivered: 'done' }) satisfies GrantSetResult });
    const sheet = await openGrant();
    await vi.waitFor(() => expect(box(sheet, 'spawn').disabled).toBe(true)); // no person yet
    fireEvent.change(person(sheet), { target: { value: CAT } }); // Cat holds nothing on mini
    await vi.waitFor(() => expect(box(sheet, 'spawn').disabled).toBe(false));
    fireEvent.click(box(sheet, 'spawn'));
    fireEvent.click(box(sheet, 'spawn'));
    const save = within(sheet).getByRole('button', { name: 'Save…' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.submit(save.form!);
    expect(sent('org.grants.set')).toEqual([]);
    // Ben holds spawn: none for him is a withdrawal, under its own label
    fireEvent.change(person(sheet), { target: { value: BEN } });
    fireEvent.click(box(sheet, 'spawn'));
    expect(within(sheet).queryByRole('button', { name: 'Save…' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Withdraw…' }));
    await vi.waitFor(() => expect(sent('org.grants.set')).toEqual([{ ref: MINI, member: BEN, rights: [] }]));
  });

  it('a person no longer offered while the sheet is open is chosen no longer: the sheet never shows one person and sends another', async () => {
    let view = VIEWED;
    renderSection(signing(notSigning), { 'org.view': () => view, 'org.grants.view': () => MINIS, 'org.grants.set': () => ({ ok: true, version: 4, delivered: 'done' }) satisfies GrantSetResult });
    const sheet = await openGrant();
    fireEvent.change(person(sheet), { target: { value: CAT } });
    await vi.waitFor(() => expect(box(sheet, 'shell').disabled).toBe(false));
    fireEvent.click(box(sheet, 'shell'));
    // Cat is made a co-owner of mini: owners hold every right, so she is no longer offered
    const reads = sent('org.view').length;
    view = viewWith({ maySign: false, machines: [{ ...MINE, owners: [ME, CAT] }] });
    emit(signing(notSigning, { head: { version: 13, issued: new Date().toISOString() } }));
    await vi.waitFor(() => expect(sent('org.view').length).toBeGreaterThan(reads));
    await vi.waitFor(() => expect(within(sheet).getByText('The person chosen is no longer offered here. Choose a person again.')).toBeTruthy());
    expect(person(sheet).value).toBe('');
    expect(Array.from(person(sheet).options).map((o) => o.value)).toEqual(['', ANA, BEN]);
    expect(box(sheet, 'shell').checked).toBe(false);
    expect((within(sheet).getByRole('button', { name: 'Save…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(person(sheet).form!);
    expect(sent('org.grants.set')).toEqual([]);
    // choosing again clears the line, and sends the person shown
    fireEvent.change(person(sheet), { target: { value: ANA } });
    expect(within(sheet).queryByText(/no longer offered/)).toBeNull();
    fireEvent.click(box(sheet, 'spawn'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save…' }));
    await vi.waitFor(() => expect(sent('org.grants.set')).toEqual([{ ref: MINI, member: ANA, rights: ['spawn'] }]));
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

  it('a long list scrolls inside a bound, with Re-grant and Cancel outside it', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ member: i.toString(16).padStart(32, '0'), rights: ['spawn', 'shell'] as const, version: i + 1 }));
    renderSection(signing(notSigning), { 'org.view': () => VIEWED, 'org.grants.view': () => grantsOf(MINI, { missing: many.map((g) => ({ ...g, rights: [...g.rights] })), digest: 'many-digest' }) });
    fireEvent.click(await within(await found('mini')).findByRole('button', { name: 'Re-grant…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Re-grant on mini?' });
    expect(within(sheet).getAllByRole('listitem')).toHaveLength(40);
    const list = within(sheet).getAllByRole('listitem')[0]!.parentElement!;
    expect(list.className).toMatch(/max-h-\[/);
    expect(list.className).toContain('overflow-y-auto');
    for (const name of ['Re-grant', 'Cancel']) expect(list.contains(within(sheet).getByRole('button', { name }))).toBe(false);
  });

  it('a list that moved reads stale and nothing is kept; an answer after the sheet closed lands nowhere', async () => {
    let answer: GrantRegrantResult | Promise<GrantRegrantResult> = { ok: false, reason: 'stale', detail: 'the missing grants changed since they were shown: nothing was signed' };
    renderSection(signing(notSigning), { 'org.view': () => VIEWED, 'org.grants.view': () => MISSING, 'org.grants.regrant': () => answer });
    fireEvent.click(await within(await found('mini')).findByRole('button', { name: 'Re-grant…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Re-grant on mini?' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Re-grant' }));
    expect((await within(sheet).findByRole('alert')).textContent).toBe('Not signed · What this would sign changed meanwhile. Nothing was kept or sent: sign again.'); // main's detail says the same

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
