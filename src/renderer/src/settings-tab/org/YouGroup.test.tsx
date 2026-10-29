// P5 O8 M4a: the Org page's You group (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's "At its end" and
// *The split*): this Mac (its device id and fingerprint), the hub sign-in with its renewal, Sign out, new keys, and your
// other devices. M1's and M3's cases for those lines moved here with their names; and a refusal shows under the control
// its attempt names (`refused.attempt`), one naming none in a row of its own.
import { fireEvent, screen, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { CODE, DEVICE, FINGERPRINT, MY_OTHER_MAC, REGISTERED, ROOT, emit, found, group, renderSection, resetHarness, row, sent, signing, viewWith, VIEW } from './test-support';

// The file's own clock: Date is frozen before any module loads, so `app/use-now`'s module-level `now` (read at import,
// at each first subscribe and at each tick) equals every `Date.now()` here. On the real clock it could lag a test's own
// reading, and an age of exactly n days floored to n - 1. Only Date is faked; timers stay real for the waits.
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(resetHarness);

describe('Settings › Org', () => {
  it('registered and signed in: org, account, the device id’s first 8, the hub, the org state’s age, Sign out', async () => {
    renderSection(REGISTERED);
    expect(within(await found('Org')).getByText('org-1f2e')).toBeTruthy();
    expect(within(row('Account')).getByText('owner@example.com')).toBeTruthy();
    expect(within(row('This Mac')).getByText(DEVICE.slice(0, 8))).toBeTruthy();
    expect(screen.queryByText(DEVICE)).toBeNull();
    expect(within(row('Hub')).getByText('Connected')).toBeTruthy();
    expect(within(row('Hub')).queryByRole('button')).toBeNull();
    const age = within(row('Org state')).getByText('Version 12 · 3 days old');
    expect(age.className).not.toContain('text-warning');
    expect(within(row('Org state')).getByText(/30 days old/)).toBeTruthy(); // the backstop named
    expect(screen.queryByRole('group', { name: 'Problem' })).toBeNull();
    fireEvent.click(within(row('Account')).getByRole('button', { name: 'Sign out' }));
    await vi.waitFor(() => expect(sent('org.signOut')).toEqual([undefined]));
  });

  it('a lapsed sign-in (expired, or the hub no longer admitting this person) offers Sign in again', async () => {
    renderSection({ ...REGISTERED, hubAccess: 'expired' }, { 'org.signIn': () => ({ ok: false, reason: { code: 'hub', detail: '502' } }) });
    expect(within(await found('Hub')).getByText('Sign-in expired')).toBeTruthy();
    fireEvent.click(within(row('Hub')).getByRole('button', { name: 'Sign in again' }));
    await vi.waitFor(() => expect(sent('org.signIn')).toEqual([undefined]));
    expect((await within(row('Hub')).findByRole('alert')).textContent).toBe('Couldn’t reach the hub. · 502');

    emit({ ...REGISTERED, hubAccess: 'denied' });
    expect(within(row('Hub')).getByText('The hub no longer admits this account')).toBeTruthy();
    expect(within(row('Hub')).getByRole('button', { name: 'Sign in again' })).toBeTruthy();
    for (const [hubAccess, words] of [['connecting', 'Connecting…'], ['unreachable', 'Can’t reach the hub'], ['signing-in', 'Signing in…']] as const) {
      emit({ ...REGISTERED, hubAccess });
      expect(within(row('Hub')).getByText(words)).toBeTruthy();
      expect(within(row('Hub')).queryByRole('button', { name: 'Sign in again' })).toBeNull();
    }
  });

  it('held-chain: the problem in words, a code field and Re-anchor sending org.reanchor', async () => {
    renderSection({ ...REGISTERED, problem: 'held-chain', head: null });
    expect(within(await found('Problem')).getByText(/stays closed here until you re-anchor/)).toBeTruthy();
    expect(within(row('Pairing code')).getByText(/replaces the org state this Mac trusted/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    const field = within(row('Pairing code')).getByRole('textbox', { name: 'Pairing code' }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: ` ${CODE} ` } });
    fireEvent.click(within(row('Pairing code')).getByRole('button', { name: 'Re-anchor' }));
    await vi.waitFor(() => expect(sent('org.reanchor')).toEqual([{ code: CODE }]));
    expect(field.value).toBe('');
    expect(sent('org.register')).toEqual([]);
    expect(document.body.innerHTML).not.toContain(CODE);
  });

  it('registered and signed out: Sign in sends org.signIn', async () => {
    renderSection({ ...REGISTERED, session: 'signed-out' });
    expect(within(await found('Hub')).getByText('Signed out')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    fireEvent.click(within(row('Hub')).getByRole('button', { name: 'Sign in' }));
    await vi.waitFor(() => expect(sent('org.signIn')).toEqual([undefined]));
  });

  it('registered and removed: this Mac is no longer in the org', async () => {
    renderSection({ ...REGISTERED, session: 'removed' });
    expect(await screen.findByText('This Mac is no longer in the org.')).toBeTruthy();
    await group('people');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Settings › Org: this Mac as the org’s signer (M3)', () => {
  it('an unmarked device gets no root add guidance, as a root or not: the new-keys offer instead, sending org.rekey', async () => {
    renderSection(signing({ rekey: 'unmarked' }));
    expect(within(await found('Signer')).getByText(/weren’t kept out of Time Machine backups/)).toBeTruthy();
    expect(screen.queryByText(/root add/)).toBeNull();
    emit(signing({ rekey: 'unmarked', root: true }));
    expect(within(row('Signer')).getByText(/weren’t kept out of Time Machine backups/)).toBeTruthy();
    expect(screen.queryByText(/root add/)).toBeNull();
    expect(screen.queryByText('This Mac signs the org state.')).toBeNull();

    expect(within(row('Pairing code')).getByText(/stays signed in on its old keys/)).toBeTruthy();
    const field = within(row('Pairing code')).getByRole('textbox', { name: 'Pairing code' }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: ` ${CODE} ` } });
    fireEvent.click(within(row('Pairing code')).getByRole('button', { name: 'Make new keys' }));
    await vi.waitFor(() => expect(sent('org.rekey')).toEqual([{ code: CODE }]));
    expect(field.value).toBe('');
    expect(sent('org.register')).toEqual([]);
    expect(document.body.innerHTML).not.toContain(CODE);
  });

  it('a rekey under way: its step with Cancel, the new fingerprint at approval, then the promotion; a refusal under its field only', async () => {
    renderSection(signing({ rekey: 'unmarked', rekeying: { step: 'checking', fingerprint: null, expires: null } }));
    expect(within(await found('New keys')).getByText('Checking the org…')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(within(row('New keys')).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(sent('org.cancel')).toEqual([undefined]));

    emit(signing({ rekey: 'unmarked', rekeying: { step: 'approval', fingerprint: 'n3wfp-12345', expires: '2026-10-28T10:30:00.000Z' } }));
    expect(within(row('New keys')).getByText(/^Waiting for approval until /)).toBeTruthy();
    expect(within(row('Fingerprint')).getByText('n3wfp-12345').className).toContain('font-mono');
    emit(signing({ rekey: 'unmarked', rekeying: { step: 'promoting', fingerprint: null, expires: null } }));
    expect(within(row('New keys')).getByText('Switching to the new keys…')).toBeTruthy();
    expect(within(row('New keys')).queryByRole('button')).toBeNull(); // past its intent, a rekey can't be cancelled

    resetHarness();
    renderSection(signing({ rekey: 'unmarked' }), { 'org.rekey': () => ({ ok: false, reason: { code: 'other-org' } }) });
    fireEvent.change(await screen.findByRole('textbox', { name: 'Pairing code' }), { target: { value: CODE } });
    fireEvent.click(within(row('Pairing code')).getByRole('button', { name: 'Make new keys' }));
    expect((await within(row('Pairing code')).findByRole('alert')).textContent).toBe('That code is for a different org from the one this Mac is in.');
    expect(within(row('Hub')).queryByRole('alert')).toBeNull();
  });

  it('a removed device: no longer in the org, with the new-keys offer', async () => {
    renderSection(signing({}, { session: 'removed' }));
    expect(await screen.findByText('This Mac is no longer in the org.')).toBeTruthy();
    expect(within(row('Pairing code')).getByText(/To rejoin, make new keys/)).toBeTruthy();
    fireEvent.change(within(row('Pairing code')).getByRole('textbox', { name: 'Pairing code' }), { target: { value: CODE } });
    fireEvent.click(within(row('Pairing code')).getByRole('button', { name: 'Make new keys' }));
    await vi.waitFor(() => expect(sent('org.rekey')).toEqual([{ code: CODE }]));
  });
});

describe('Settings › Org: You (M4a)', () => {
  it('this Mac with its fingerprint, and your other devices with their class and root mark', async () => {
    renderSection(signing(ROOT));
    const you = await group('you');
    expect(within(you).getByRole('group', { name: 'This Mac' })).toBeTruthy();
    expect(await within(row('This Mac')).findByText(FINGERPRINT)).toBeTruthy();
    expect(within(row('Your other devices')).getByText(MY_OTHER_MAC.slice(0, 8))).toBeTruthy();
    expect(within(row('Your other devices')).getByText(/Mac/)).toBeTruthy();
    expect(within(row('Your other devices')).queryByText(DEVICE.slice(0, 8))).toBeNull(); // this Mac is its own row

    resetHarness();
    renderSection(signing(ROOT), { 'org.view': () => viewWith({ members: [{ ...VIEW.members[0]!, devices: [VIEW.members[0]!.devices[0]!] }, ...VIEW.members.slice(1)] }) });
    expect(within(await found('Your other devices')).getByText('None')).toBeTruthy();
  });

  it('a refusal shows under the control its attempt names', async () => {
    // signIn: under the hub's row, where Sign in is
    renderSection({ ...REGISTERED, session: 'signed-out', refused: { code: 'hub', detail: '503', attempt: 'signIn' } });
    expect(within(await found('Hub')).getByRole('alert').textContent).toBe('Couldn’t reach the hub. · 503');
    expect(screen.queryByRole('group', { name: 'Refused' })).toBeNull();

    // rekey: under the new-keys field, never the hub's row, signed in or lapsed
    emit(signing({ rekey: 'unmarked' }, { hubAccess: 'expired', refused: { code: 'other-org', attempt: 'rekey' } }));
    expect(within(row('Pairing code')).getByRole('alert').textContent).toBe('That code is for a different org from the one this Mac is in.');
    expect(within(row('Hub')).queryByRole('alert')).toBeNull();

    // signIn while the rekey is offered: the hub's row, not the field
    emit(signing({ rekey: 'unmarked' }, { hubAccess: 'expired', refused: { code: 'access', attempt: 'signIn' } }));
    expect(within(row('Hub')).getByRole('alert').textContent).toBe('The browser sign-in didn’t finish.');
    expect(within(row('Pairing code')).queryByRole('alert')).toBeNull();

    // reanchor: under the re-anchor field
    emit({ ...REGISTERED, problem: 'held-chain', head: null, refused: { code: 'chain', attempt: 'reanchor' } });
    expect(within(row('Pairing code')).getByRole('alert').textContent).toBe('The org state from the hub didn’t verify.');
  });

  it('a refusal that names no attempt, or whose control isn’t on the page, still shows in a row of its own', async () => {
    renderSection({ ...REGISTERED, refused: { code: 'keys', detail: 'keys.json is gone' } });
    expect(within(await found('Refused')).getByRole('alert').textContent).toBe('This Mac’s device keys couldn’t be used. · keys.json is gone');
    expect(within(row('Hub')).queryByRole('alert')).toBeNull();

    // a rekey's refusal once no new-keys field is offered is not dropped
    emit({ ...REGISTERED, refused: { code: 'busy', detail: 'a rekey is still being finished', attempt: 'rekey' } });
    expect(within(row('Refused')).getByRole('alert').textContent).toBe('Another sign-in is running. · a rekey is still being finished');
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
