// P5 O8 M4a: the pairing sheet (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's "Pairing from the app"
// and *Pairing*): the code shown once, here only, with Copy; then the frozen candidate's fingerprint to compare; then
// the approval naming `{generation, digest}`. An approval's end keeps apart a pairing that ended while Touch ID was open
// (`cancelled`, with why) from one that ended before it (`stale`); a person's own Touch ID cancel says nothing.
import { fireEvent, screen, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { OrgPairingStatus, PairStartResult, SignResult } from '@shared/ipc/schema/org';
import { CAT, ME, ROOT, emit, group, renderSection, resetHarness, row, sent, signing } from './test-support';

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(() => {
  resetHarness();
  vi.restoreAllMocks();
});

const PAIR_CODE = 'smns-pair-v1.eyJodWIiOiJodHRwczovL2h1YiJ9-made-for-the-new-device';
const EXPIRES = '2026-10-28T12:10:00.000Z';
const ENTRY = { id: 'NewMacQ9xYc0dE000001', class: 'native-mac' as const, keyStorage: 'software', fingerprint: 'n3wdv-77777', digest: 'candidateDigest0001' };
const pairing = (patch: Partial<NonNullable<OrgPairingStatus>> = {}): OrgPairingStatus => ({ generation: 1, member: ME, class: 'native-mac', expires: EXPIRES, entry: null, problem: null, ...patch });
const started: PairStartResult = { ok: true, code: PAIR_CODE, expires: EXPIRES };
// main's words for an edit whose pairing ended (signer.ts): during Touch ID they come with `cancelled`, before it with `stale`
const ENDED_DURING = 'the change ended (a pairing cancelled or expired): nothing was signed';
const ENDED_BEFORE = 'the pairing ended (cancelled, expired or refused): nothing was signed';

async function openPair(member: string) {
  await group('people');
  fireEvent.click(await within(row(member)).findByRole('button', { name: 'Pair a device…' }));
  return screen.findByRole('dialog');
}

describe('Settings › Org: the pairing sheet (M4a)', () => {
  it('the PairSheet shows the code once, then the entry’s fingerprint, and approves', async () => {
    const copied = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: copied }, configurable: true });
    const log = vi.spyOn(console, 'log');
    renderSection(signing(ROOT), { 'org.pair.start': () => started, 'org.pair.approve': () => ({ ok: true, version: 13 }) satisfies SignResult });
    const sheet = await openPair('Owner');
    expect(within(sheet).getByRole('heading', { name: 'Pair a device of yours' })).toBeTruthy();
    expect(within(sheet).getByText('This Mac endorses the new device in the same Touch ID that signs it.')).toBeTruthy();
    expect((within(sheet).getByRole('radio', { name: 'A Mac with MAWS' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Make a code' }));
    await vi.waitFor(() => expect(sent('org.pair.start')).toEqual([{ member: ME, class: 'native-mac' }]));
    emit(signing(ROOT, { pairing: pairing() }));

    // the code, once, in the sheet alone, with Copy
    const code = await within(sheet).findByText(PAIR_CODE);
    expect(code.className).toContain('font-mono');
    expect(screen.getAllByText(PAIR_CODE)).toHaveLength(1);
    expect(within(sheet).getByText('Waiting for the device to answer…')).toBeTruthy();
    expect((within(sheet).getByRole('button', { name: 'Approve…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Copy' }));
    await vi.waitFor(() => expect(copied).toHaveBeenCalledWith(PAIR_CODE));
    expect(await within(sheet).findByRole('button', { name: 'Copied' })).toBeTruthy();

    // the device answered: its fingerprint to compare, and the code gone for good
    emit(signing(ROOT, { pairing: pairing({ entry: ENTRY }) }));
    expect(within(sheet).getByText('n3wdv-77777').className).toContain('font-mono');
    expect(within(sheet).getByText('Compare it with the new device’s screen. Approve only if the two match.')).toBeTruthy();
    expect(within(sheet).getByText(`Device ${ENTRY.id.slice(0, 8)} · Mac · software keys`)).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(PAIR_CODE);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Approve…' }));
    await vi.waitFor(() => expect(sent('org.pair.approve')).toEqual([{ generation: 1, digest: ENTRY.digest }]));
    emit(signing(ROOT, { pairing: null })); // done
    expect(await within(sheet).findByText('Paired. Signed version 13.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('org.pair.cancel')).toEqual([]);
    expect(document.body.innerHTML).not.toContain(PAIR_CODE);
    expect(log.mock.calls.flat().join(' ')).not.toContain(PAIR_CODE);
  });

  it('another member’s first device: the class chosen in the sheet, joined unendorsed', async () => {
    renderSection(signing(ROOT), { 'org.pair.start': () => started });
    const sheet = await openPair('Cat');
    expect(within(sheet).getByRole('heading', { name: 'Pair cat@example.com’s first device' })).toBeTruthy();
    expect(within(sheet).getByText(/joins without an endorsement/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'A browser with a passkey' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Make a code' }));
    await vi.waitFor(() => expect(sent('org.pair.start')).toEqual([{ member: CAT, class: 'web-cards' }]));
  });

  it('an approval whose pairing ended during Touch ID reads apart from one that ended before it; a Touch ID cancel says nothing', async () => {
    let answer: SignResult = { ok: false, reason: 'cancelled' };
    renderSection(signing(ROOT), { 'org.pair.start': () => started, 'org.pair.approve': () => answer });
    const sheet = await openPair('Owner');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Make a code' }));
    emit(signing(ROOT, { pairing: pairing({ generation: 2, entry: ENTRY }) }));
    const approve = (await within(sheet).findByRole('button', { name: 'Approve…' })) as HTMLButtonElement;

    // the person's own cancel at Touch ID: no line, and Approve stays for another try
    fireEvent.click(approve);
    await vi.waitFor(() => expect(sent('org.pair.approve')).toEqual([{ generation: 2, digest: ENTRY.digest }]));
    await vi.waitFor(() => expect(approve.disabled).toBe(false));
    expect(within(sheet).queryByRole('alert')).toBeNull();

    // ended while Touch ID was open
    answer = { ok: false, reason: 'cancelled', detail: ENDED_DURING };
    fireEvent.click(approve);
    const during = (await within(sheet).findByRole('alert')).textContent;
    expect(during).toBe('The pairing ended while Touch ID was open. Nothing was signed.');

    // ended before Touch ID
    answer = { ok: false, reason: 'stale', detail: ENDED_BEFORE };
    emit(signing(ROOT, { pairing: pairing({ generation: 2, entry: ENTRY }) }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Approve…' }));
    await vi.waitFor(() => expect(sent('org.pair.approve')).toHaveLength(3));
    await vi.waitFor(() => expect(within(sheet).getByRole('alert').textContent).toBe(`The pairing ended, or its device changed, before Touch ID. Nothing was signed. · ${ENDED_BEFORE}`));
    expect(within(sheet).getByRole('alert').textContent).not.toBe(during);
  });

  it('a pairing that ends shows why, and Start over makes a new code', async () => {
    renderSection(signing(ROOT), { 'org.pair.start': () => started });
    const sheet = await openPair('Owner');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Make a code' }));
    emit(signing(ROOT, { pairing: pairing({ generation: 3, entry: ENTRY }) }));
    await within(sheet).findByText('n3wdv-77777');
    emit(signing(ROOT, { pairing: pairing({ generation: 3, entry: ENTRY, problem: 'entry-changed' }) }));
    expect(within(sheet).getByText('The device’s entry changed after it was shown. Start over.')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Approve…' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Start over' }));
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Make a code' }));
    await vi.waitFor(() => expect(sent('org.pair.start')).toHaveLength(2));

    for (const [problem, words] of [
      ['two-entries', 'Two devices answered this code. Start over.'],
      ['expired', 'The code expired. Start over.'],
    ] as const) {
      emit(signing(ROOT, { pairing: pairing({ generation: 4, problem }) }));
      expect(await within(sheet).findByText(words)).toBeTruthy();
      expect(document.body.innerHTML).not.toContain(PAIR_CODE); // an ended pairing's code is gone too
    }
  });

  it('a start main refuses is said in the sheet, and no code shows', async () => {
    renderSection(signing(ROOT), { 'org.pair.start': () => ({ ok: false, reason: 'hub', detail: 'the hub sign-in has ended: sign in again to pair' }) satisfies PairStartResult });
    const sheet = await openPair('Cat');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Make a code' }));
    expect((await within(sheet).findByRole('alert')).textContent).toBe('This Mac isn’t connected to the hub. Sign in again to pair. · the hub sign-in has ended: sign in again to pair');
    expect(within(sheet).getByRole('button', { name: 'Make a code' })).toBeTruthy();
  });

  it('Cancel pairing ends the pairing; one left running shows on its member, and Show… reopens it without the code', async () => {
    renderSection(signing(ROOT), { 'org.pair.start': () => started });
    let sheet = await openPair('Cat');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Make a code' }));
    emit(signing(ROOT, { pairing: pairing({ member: CAT }) }));
    await within(sheet).findByText(PAIR_CODE);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel pairing' }));
    await vi.waitFor(() => expect(sent('org.pair.cancel')).toEqual([undefined]));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // a page drawn while a pairing runs (Settings reopened): the line on its member, and the sheet without the code
    resetHarness();
    renderSection(signing(ROOT, { pairing: pairing({ member: CAT, generation: 5 }) }));
    await group('people');
    expect(await within(row('Cat')).findByText(/^Pairing a device until /)).toBeTruthy();
    expect(within(row('Cat')).queryByRole('button', { name: 'Pair a device…' })).toBeNull();
    fireEvent.click(within(row('Cat')).getByRole('button', { name: 'Show…' }));
    sheet = await screen.findByRole('dialog', { name: 'Pair cat@example.com’s first device' });
    expect(within(sheet).getByText('The code was shown once, when it was made. For a new one, cancel and pair again.')).toBeTruthy();
    emit(signing(ROOT, { pairing: pairing({ member: CAT, generation: 5, entry: { ...ENTRY, class: 'web-cards', keyStorage: 'passkey' } }) }));
    expect(within(sheet).getByText('n3wdv-77777')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Approve…' }));
    await vi.waitFor(() => expect(sent('org.pair.approve')).toEqual([{ generation: 5, digest: ENTRY.digest }]));
  });
});
