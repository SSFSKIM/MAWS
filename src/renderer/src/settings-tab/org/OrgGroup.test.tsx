// P5 O8 M4a: the Org page's Org group (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's "At its end" and
// *The split*): the org state's version and age, the roots as `rootLines` reads them, the recovery key's id, the problem
// held, and M3's signer lines (weekly, the pending slot, the superseded offer, deliveries owing), whose cases moved here
// with their names. M3's old-device line becomes Remove device (M4a's `device.remove`), through the change sheet.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { SignResult } from '@shared/ipc/schema/org';
import { DAY, DEVICE, FINGERPRINT, ME, MINI, REGISTERED, ROOT, VM, emit, found, group, renderSection, resetHarness, row, sent, signing, type Signer } from './test-support';

// The file's own clock (see YouGroup.test.tsx). Only Date is faked; timers stay real for the waits.
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(resetHarness);

const OLD_DEVICE = 'Zo1dDevice9xYc0dEk9F3';
// pending proposals' stateHashes, as the status names them
const HASH_A = 'aaaaPendingStateHashA0000000000000000000000';
const HASH_B = 'bbbbPendingStateHashB0000000000000000000000';
const HASH_C = 'ccccPendingStateHashC0000000000000000000000';
// the superseded offer as main shows it: each revocation and consequence, the checks' warnings, and the digest naming them
const OFFER_LINES = ['revoke the step-up key k1 of device b1 of b@example.com: it was revoked before the recovery', 'its channel key k2 is revoked with it'];
const OFFER_WARNING = 'device 7Hq2xVb9 of owner@example.com (stepUpKid0001) was revoked on the branch the recovery discarded, and this state doesn’t revoke it';
const DIGEST_A = 'offerDigestA000000000000000000000000000000';
const DIGEST_B = 'offerDigestB000000000000000000000000000000';
const offerOf = (offer: Partial<NonNullable<Signer['offer']>>): Signer['offer'] => ({ superseded: 2, lines: OFFER_LINES, warnings: [OFFER_WARNING], withheld: [], digest: DIGEST_A, ...offer });

describe('Settings › Org', () => {
  it('the org state turns to the warning tone at 21 days; a held problem is said in words', async () => {
    renderSection({ ...REGISTERED, head: { version: 40, issued: new Date(Date.now() - 22 * DAY).toISOString() }, problem: 'rollback' });
    expect(within(await found('Org state')).getByText('Version 40 · 22 days old').className).toContain('text-warning');
    expect(within(row('Problem')).getByText('The hub served an older org state than this Mac holds. It was refused.')).toBeTruthy();
    emit({ ...REGISTERED, head: null });
    expect(within(row('Org state')).getByText('Not verified yet')).toBeTruthy();
  });
});

describe('Settings › Org: this Mac as the org’s signer (M3)', () => {
  it('a marked device not yet a root: its fingerprint and id beside the root add command; a root signs; no signer lines signed out', async () => {
    renderSection(signing({}));
    const signer = await found('Signer');
    expect(within(signer).getByText('Make this Mac a root: run')).toBeTruthy();
    // The id after `--`: a base64url id may start with '-', which the admin's option parser would take for an option.
    expect(within(signer).getByText(`deployment admin root add -- ${DEVICE}`).className).toContain('font-mono');
    expect(within(signer).getByText(new RegExp(FINGERPRINT))).toBeTruthy();
    expect(within(signer).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull(); // a marked, listed device is offered no new keys

    emit(signing(ROOT));
    expect(within(row('Signer')).getByText('This Mac signs the org state.')).toBeTruthy();
    expect(screen.queryByText(/root add/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Re-sign now' })).toBeNull(); // not due

    emit(signing(ROOT, { session: 'signed-out' }));
    expect(screen.queryByRole('group', { name: 'Signer' })).toBeNull();
  });

  it('the quiet weekly line: the org state’s age with Re-sign now, and the sign’s outcome in one line', async () => {
    renderSection(signing({ ...ROOT, due: true, ageDays: 8 }), { 'org.resign': () => ({ ok: false, reason: 'hub', detail: '503' }) });
    const signer = await found('Signer');
    expect(within(signer).getByText('This Mac signs the org state.')).toBeTruthy();
    const line = within(signer).getByText('Org state is 8 days old');
    expect(line.className).not.toContain('text-warning'); // a quiet line, not a banner
    fireEvent.click(within(signer).getByRole('button', { name: 'Re-sign now' }));
    await vi.waitFor(() => expect(sent('org.resign')).toEqual([undefined]));
    expect((await within(row('Signer')).findByRole('alert')).textContent).toBe('Not signed · The hub didn’t take it. · 503');
  });

  it('Re-sign now: a signed version says so; a Touch ID cancel says nothing', async () => {
    let answer: SignResult = { ok: true, version: 13 };
    renderSection(signing({ ...ROOT, due: true, ageDays: 7 }), { 'org.resign': () => answer });
    fireEvent.click(within(await found('Signer')).getByRole('button', { name: 'Re-sign now' }));
    expect(await within(row('Signer')).findByText('Signed version 13.')).toBeTruthy();
    answer = { ok: false, reason: 'cancelled' };
    fireEvent.click(within(row('Signer')).getByRole('button', { name: 'Re-sign now' }));
    await vi.waitFor(() => expect(sent('org.resign')).toHaveLength(2));
    await act(async () => {});
    expect(within(row('Signer')).queryByText('Signed version 13.')).toBeNull();
    expect(within(row('Signer')).queryByRole('alert')).toBeNull();
  });

  it('the superseded offer: Revoke again only when there is something to sign; the withheld names always', async () => {
    const withheld = 'device 7Hq2xVb9 of owner@example.com (stepUpKid0001)';
    renderSection(signing({ ...ROOT, offer: offerOf({ superseded: 2, withheld: [withheld] }) }));
    const revocations = await found('Revocations');
    expect(within(revocations).getByText('A recovery dropped the revocation of 2 keys.')).toBeTruthy();
    expect(within(revocations).getByText((text) => text.startsWith(`Not offered: ${withheld}.`))).toBeTruthy();
    fireEvent.click(within(revocations).getByRole('button', { name: 'Revoke again…' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Sign these revocations?' })).getByRole('button', { name: 'Sign' }));
    await vi.waitFor(() => expect(sent('org.revokeSuperseded')).toEqual([{ offer: DIGEST_A }]));
    expect(await within(row('Signer')).findByText('Signed version 13.')).toBeTruthy();

    emit(signing({ ...ROOT, offer: offerOf({ superseded: 0, lines: [], warnings: [], withheld: [withheld] }) }));
    expect(within(row('Revocations')).queryByRole('button')).toBeNull();
    expect(within(row('Revocations')).queryByText(/A recovery dropped/)).toBeNull();
    expect(within(row('Revocations')).getByText((text) => text.startsWith(`Not offered: ${withheld}.`))).toBeTruthy();

    emit(signing({ offer: offerOf({ superseded: 2 }) })); // not a root: nothing shown would sign
    expect(within(row('Revocations')).getByText('A recovery dropped the revocation of 2 keys.')).toBeTruthy();
    expect(within(row('Revocations')).queryByRole('button')).toBeNull();
  });

  it('Revoke again shows the whole closure, the warnings and the withheld before it signs; Cancel sends nothing; a changed offer closes the sheet', async () => {
    const withheld = 'device 7Hq2xVb9 of owner@example.com (stepUpKid0001)';
    renderSection(signing({ ...ROOT, offer: offerOf({ withheld: [withheld] }) }), { 'org.revokeSuperseded': () => ({ ok: false, reason: 'stale', detail: 'the revocations changed since they were shown: nothing was signed' }) });
    fireEvent.click(within(await found('Revocations')).getByRole('button', { name: 'Revoke again…' }));
    let sheet = await screen.findByRole('dialog', { name: 'Sign these revocations?' });
    for (const line of OFFER_LINES) expect(within(sheet).getByText(line)).toBeTruthy();
    expect(within(sheet).getByText(`Warning: ${OFFER_WARNING}`)).toBeTruthy();
    expect(within(sheet).getByText((text) => text.startsWith(`Not offered: ${withheld}.`))).toBeTruthy();
    expect(sent('org.revokeSuperseded')).toEqual([]);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('org.revokeSuperseded')).toEqual([]);

    // The offer changes while the sheet is open: it closes, so no confirmation reaches other words.
    fireEvent.click(within(row('Revocations')).getByRole('button', { name: 'Revoke again…' }));
    await screen.findByRole('dialog', { name: 'Sign these revocations?' });
    emit(signing({ ...ROOT, offer: offerOf({ lines: OFFER_LINES.slice(0, 1), digest: DIGEST_B }) }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Main refuses a confirmation of words it no longer holds: the line says so.
    fireEvent.click(within(row('Revocations')).getByRole('button', { name: 'Revoke again…' }));
    sheet = await screen.findByRole('dialog', { name: 'Sign these revocations?' });
    expect(within(sheet).queryByText(OFFER_LINES[1])).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Sign' }));
    await vi.waitFor(() => expect(sent('org.revokeSuperseded')).toEqual([{ offer: DIGEST_B }]));
    expect((await within(row('Signer')).findByRole('alert')).textContent).toContain('What would be signed changed since it was shown.');
  });

  it('owing machines per version, a too-large one named; a discarded proposal where it may still be held', async () => {
    renderSection(
      signing({
        ...ROOT,
        owing: [{ version: 7, machines: [MINI, VM], tooLarge: [VM] }],
        abandoned: [
          { hash: HASH_A, version: 5, hub: true, machines: [MINI] },
          { hash: HASH_B, version: 6, hub: false, machines: [] }, // never sent: nothing can hold it
        ],
      }),
    );
    const deliveries = await found('Deliveries');
    expect(within(deliveries).getByText(`Version 7 · waiting for ${MINI} to acknowledge · too large to send to ${VM}, which catches up from the hub`)).toBeTruthy();
    expect(within(row('Discarded')).getByText(`Version 5 · the hub and ${MINI} may still hold it`)).toBeTruthy();
    expect(within(row('Discarded')).queryByText(/Version 6/)).toBeNull();

    emit(signing({ ...ROOT, abandoned: [{ hash: HASH_B, version: 6, hub: false, machines: [] }] }));
    expect(screen.queryByRole('group', { name: 'Deliveries' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Discarded' })).toBeNull();
  });

  it('pending-fork: Discard behind a confirmation with the fork warning; Cancel sends nothing; Discard sends it confirmed', async () => {
    renderSection(signing({ ...ROOT, pending: { version: 13, hash: HASH_A, fork: true, exposed: true, refused: null } }), {
      'org.discardPending': () => ({ ok: true, unsent: false, hubVersion: 13, forkAt: 13 }),
    });
    const pending = await found('Pending');
    expect(within(pending).getByText('Version 13 conflicts with another version 13 at the hub: a fork.').className).toContain('text-warning');
    fireEvent.click(within(pending).getByRole('button', { name: 'Discard…' }));
    let sheet = await screen.findByRole('dialog', { name: 'Discard version 13?' });
    expect(within(sheet).getByText('The hub holds another version 13: a fork.')).toBeTruthy();
    expect(within(sheet).getByText(/A later sign may make another successor of version 12, which a hub or machine that kept these bytes could show as a fork/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('org.discardPending')).toEqual([]);

    fireEvent.click(within(row('Pending')).getByRole('button', { name: 'Discard…' }));
    sheet = await screen.findByRole('dialog', { name: 'Discard version 13?' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Discard' }));
    await vi.waitFor(() => expect(sent('org.discardPending')).toEqual([{ confirmed: true, hash: HASH_A }]));
    expect(await within(row('Signer')).findByText('Discarded version 13. The hub holds another version 13 (a fork); its head is version 13.')).toBeTruthy();
  });

  it('a refused slot that isn’t a fork offers Discard too; a never-sent one is worded so; a slot merely waiting offers none', async () => {
    renderSection(signing({ ...ROOT, pending: { version: 13, hash: HASH_A, fork: false, exposed: true, refused: 'key-purged' } }), {
      'org.discardPending': () => ({ ok: true, unsent: true, hubVersion: 12 }),
    });
    expect(within(await found('Pending')).getByText('The hub refused version 13 · key-purged')).toBeTruthy();
    fireEvent.click(within(row('Pending')).getByRole('button', { name: 'Discard…' }));
    let sheet = await screen.findByRole('dialog', { name: 'Discard version 13?' });
    expect(within(sheet).getByText('Version 13 isn’t at the hub.')).toBeTruthy();
    expect(within(sheet).getByText(/could show as a fork: discard it only once you know why the hub refused it/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    emit(signing({ ...ROOT, pending: { version: 13, hash: HASH_B, fork: false, exposed: false, refused: 'key-purged' } }));
    fireEvent.click(within(row('Pending')).getByRole('button', { name: 'Discard…' }));
    sheet = await screen.findByRole('dialog', { name: 'Discard version 13?' });
    expect(within(sheet).getByText('Version 13 was never sent: nothing was posted, so nothing can show it as a fork.')).toBeTruthy();
    expect(within(sheet).queryByText(/A later sign/)).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Discard' }));
    expect(await within(row('Signer')).findByText('Discarded version 13. It was never sent.')).toBeTruthy();

    emit(signing({ ...ROOT, pending: { version: 14, hash: HASH_C, fork: false, exposed: true, refused: null } }));
    expect(within(row('Pending')).getByText('Version 14 is signed and waits for the hub.')).toBeTruthy();
    expect(within(row('Pending')).queryByRole('button')).toBeNull();
  });

  it('a discard the hub overtook says so, and nothing was discarded', async () => {
    renderSection(signing({ ...ROOT, pending: { version: 13, hash: HASH_A, fork: true, exposed: true, refused: null } }), { 'org.discardPending': () => ({ ok: false, reason: 'held' }) });
    fireEvent.click(within(await found('Pending')).getByRole('button', { name: 'Discard…' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Discard version 13?' })).getByRole('button', { name: 'Discard' }));
    expect((await within(row('Signer')).findByRole('alert')).textContent).toBe('Not discarded · The hub holds version 13 now: it settled.');
  });

  it('signing: the problem in words, a successor sent before the damage named; Reset behind its confirmation', async () => {
    renderSection(signing(ROOT, { problem: 'signing' }));
    const problem = await found('Problem');
    expect(within(problem).getByText(/signs nothing until you reset it/)).toBeTruthy();
    expect(within(problem).getByText(/sent before the damage could still surface as a fork/)).toBeTruthy();
    fireEvent.click(within(problem).getByRole('button', { name: 'Reset…' }));
    let sheet = await screen.findByRole('dialog', { name: 'Reset the signing record?' });
    expect(within(sheet).getByText(/could still surface as a fork/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('org.resetSigning')).toEqual([]);
    fireEvent.click(within(row('Problem')).getByRole('button', { name: 'Reset…' }));
    sheet = await screen.findByRole('dialog', { name: 'Reset the signing record?' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Reset' }));
    await vi.waitFor(() => expect(sent('org.resetSigning')).toEqual([{ confirmed: true }]));
    // another problem carries no Reset
    emit(signing(ROOT, { problem: 'rollback' }));
    expect(within(row('Problem')).queryByRole('button')).toBeNull();
  });

  it('an open Discard confirmation closes when its proposal settles, and when another replaces it: the old hash is never sent', async () => {
    const fork = { version: 13, hash: HASH_A, fork: true, exposed: true, refused: null };
    renderSection(signing({ ...ROOT, pending: fork }));
    fireEvent.click(within(await found('Pending')).getByRole('button', { name: 'Discard…' }));
    await screen.findByRole('dialog', { name: 'Discard version 13?' });
    emit(signing({ ...ROOT, pending: null })); // settled while the owner read the sheet
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    emit(signing({ ...ROOT, pending: fork }));
    fireEvent.click(within(row('Pending')).getByRole('button', { name: 'Discard…' }));
    await screen.findByRole('dialog', { name: 'Discard version 13?' });
    // Another proposal at the same version replaces it (discarded elsewhere, signed again): the sheet was for A.
    emit(signing({ ...ROOT, pending: { ...fork, hash: HASH_B, refused: 'key-purged', fork: false } }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // An unrelated status change leaves an open sheet for the slot it names.
    fireEvent.click(within(row('Pending')).getByRole('button', { name: 'Discard…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Discard version 13?' });
    emit(signing({ ...ROOT, ageDays: 4, pending: { ...fork, hash: HASH_B, refused: 'key-purged', fork: false } }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Discard' }));
    await vi.waitFor(() => expect(sent('org.discardPending')).toEqual([{ confirmed: true, hash: HASH_B }]));
  });

  it('a discard main refused as stale (the slot changed since the confirmation) says so', async () => {
    renderSection(signing({ ...ROOT, pending: { version: 13, hash: HASH_A, fork: true, exposed: true, refused: null } }), { 'org.discardPending': () => ({ ok: false, reason: 'stale' }) });
    fireEvent.click(within(await found('Pending')).getByRole('button', { name: 'Discard…' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Discard version 13?' })).getByRole('button', { name: 'Discard' }));
    expect((await within(row('Signer')).findByRole('alert')).textContent).toBe('Not discarded · The pending state changed since you confirmed: nothing was discarded.');
  });

  it('two discarded proposals of one version are two lines', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderSection(
        signing({
          ...ROOT,
          abandoned: [
            { hash: HASH_A, version: 5, hub: true, machines: [] },
            { hash: HASH_B, version: 5, hub: false, machines: [MINI] },
          ],
        }),
      );
      const discarded = await found('Discarded');
      expect(within(discarded).getByText('Version 5 · the hub may still hold it')).toBeTruthy();
      expect(within(discarded).getByText(`Version 5 · ${MINI} may still hold it`)).toBeTruthy();
      expect(errors).not.toHaveBeenCalled(); // no duplicate React keys
    } finally {
      errors.mockRestore();
    }
  });


  it('the old device, still listed after a rekey: Remove device through the change sheet, offered only while this Mac signs', async () => {
    const lines = [`Remove owner@example.com's device ${OLD_DEVICE.slice(0, 8)} (native-mac) and revoke its keys`];
    renderSection(signing({ ...ROOT, oldDevice: OLD_DEVICE }), { 'org.preview': () => ({ ok: true, change: { kind: 'device.remove', member: ME, device: OLD_DEVICE }, lines, warnings: [], digest: 'oldDigest' }) });
    const old = await found('Old device');
    expect(within(old).getByText(OLD_DEVICE.slice(0, 8)).className).toContain('font-mono');
    expect(screen.queryByText(/remove-device/)).toBeNull();
    fireEvent.click(within(old).getByRole('button', { name: 'Remove…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Remove a device of owner@example.com?' });
    expect(await within(sheet).findByText(lines[0]!)).toBeTruthy();
    expect(sent('org.preview')).toEqual([{ change: { kind: 'device.remove', member: ME, device: OLD_DEVICE } }]);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Sign' }));
    await vi.waitFor(() => expect(sent('org.change')).toEqual([{ change: { kind: 'device.remove', member: ME, device: OLD_DEVICE }, digest: 'oldDigest' }]));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await within(row('Signer')).findByText('Signed version 13.')).toBeTruthy();

    emit(signing({ oldDevice: OLD_DEVICE })); // not a root: the line, with nothing to press
    expect(within(row('Old device')).queryByRole('button')).toBeNull();
    emit(signing(ROOT));
    expect(screen.queryByRole('group', { name: 'Old device' })).toBeNull();
  });
});

describe('Settings › Org: Org (M4a)', () => {
  it('the org’s id, its roots as rootLines reads them, an unlisted root named so, and the recovery key’s id', async () => {
    renderSection(signing(ROOT));
    const org = await group('org');
    expect(within(org).getByRole('group', { name: 'Org' })).toBeTruthy();
    const roots = await found('Roots');
    expect(within(roots).getByText('stepUpKid0001').className).toContain('font-mono');
    expect(within(roots).getByText(`owner@example.com · device ${DEVICE.slice(0, 8)} (Mac)`)).toBeTruthy();
    expect(within(roots).getByText('orphanKid0002')).toBeTruthy();
    expect(within(roots).getByText('no listed device')).toBeTruthy();
    expect(within(row('Recovery key')).getByText('recoveryKid00001').className).toContain('font-mono');
    expect(within(org).getByRole('group', { name: 'Signer' })).toBeTruthy();
  });

  it('the root add guidance stays in the Org group, the fingerprint in its note', async () => {
    renderSection(signing({}));
    const org = await group('org');
    expect(within(within(org).getByRole('group', { name: 'Signer' })).getByText(new RegExp(FINGERPRINT))).toBeTruthy();
  });
});
