// P5 O8 M4c: the Org group's Delegations section (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4c's "At
// its end", *The view*, *Renew*, *Drop*, *The destination*, and the renderer's "Proves"): each delegation with its prefix,
// owners, expiry in words, uses and certified machines; the hub's side of it (a half-done renewal or a dropped key still
// live, each with Retry calling the route alone; a hub key list that didn't read is never "no keys"); an unsent
// delegation's reason with "Write the code again" while this run holds its key pair, else Discard alone; the stray hub
// keys, each with Revoke behind a confirmation that warns more strongly for a young key; the code's destination with
// Save, a damaged file's Reset, and Create disabled, saying why, without one. Task 5's fix wave: a row acts only on the
// pending slot that holds its own delegation (Discard by that slot's hash, Write again naming its run), words where a
// write stopped, and a failed read of the hub's key list has Retry. Fix wave 2: only while that slot is still held unsent
// (the status's `held`), whatever a view not yet refreshed says.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { DelegationResult, DiscardResult, HubHalfResult, HubKeysRead, OrgDelegationRow, OrgView, ProvisioningSecret, ProvisioningSecretReading, ProvisioningSecretWrite } from '@shared/ipc/schema/org';
import { ANA, DAY, ME, ROOT, emit, group, renderSection, resetHarness, row, sent, signing, viewWith, type Signer } from './test-support';

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(resetHarness);

const D1 = '0123456789abcdef0123456789abcdef';
const D2 = '1111111111111111aaaaaaaaaaaaaaaa';
const D3 = '2222222222222222bbbbbbbbbbbbbbbb';
const D4 = '3333333333333333cccccccccccccccc';
const S1 = '4444444444444444dddddddddddddddd';
const S2 = '5555555555555555eeeeeeeeeeeeeeee';
const IN_23_DAYS = '2026-11-20T13:00:00.000Z';
const IN_90_DAYS = '2027-01-26T13:00:00.000Z'; // an hour past 90 days: vi.waitFor moves the faked clock on
const HASH = 'unsentSlotStateHash0000000000000000000000000';
const HASH2 = 'anotherSlotStateHash000000000000000000000000';
const D5 = '6666666666666666ffffffffffffffff';

const delegation = (patch: Partial<OrgDelegationRow> & Pick<OrgDelegationRow, 'id' | 'prefix'>): OrgDelegationRow => ({
  owners: [ME, ANA],
  expires: IN_23_DAYS,
  maxUses: 10,
  machines: [],
  hub: { expires: patch.expires ?? IN_23_DAYS, uses: 3, revoked: false },
  state: 'in-effect',
  unsent: null,
  hubBehind: null,
  hubProblem: null,
  ...patch,
});
const IN_EFFECT = delegation({
  id: D1,
  prefix: 'ci-runner-',
  machines: [
    { ref: 'CiRunnerRef000000001', name: 'ci-runner-1', live: true },
    { ref: 'CiRunnerRef000000002', name: 'ci-runner-2', live: false },
  ],
});
const HALF_DONE = delegation({ id: D2, prefix: 'gpu-', owners: 'org', expires: IN_90_DAYS, maxUses: null, hub: { expires: IN_23_DAYS, uses: 0, revoked: false }, hubBehind: 'renew', hubProblem: { reason: 'not-renewed', detail: "the hub's org state doesn't hold the renewal yet" } });
const DROPPED = delegation({ id: D3, prefix: 'old-vm-', state: 'dropped', owners: [], hubBehind: 'revoke' });
const UNSENT = delegation({ id: D4, prefix: 'dc-', expires: IN_90_DAYS, hub: { expires: IN_90_DAYS, uses: 0, revoked: false }, state: 'unsent', unsent: { rewrite: true, writing: false, problem: 'gcloud secrets versions add failed: PERMISSION_DENIED on desk-provisioning-v2', generation: 1 } });
const RUN = { generation: 1, id: D4, hash: HASH };
const REV = 1;
const READ = { at: '2026-10-28T11:59:00.000Z', failed: false };
const DEST: ProvisioningSecret = { project: 'maws-example-prod', secret: 'desk-provisioning-v2', account: 'cli-owner@maws-example-prod.iam.gserviceaccount.com' };
const slotOf = (hash: string, delegation: string | null, version = 13, held = delegation !== null): Partial<Signer> => ({ ...ROOT, pending: { version, hash, fork: false, exposed: !held, refused: null, delegation, held } });
const PENDING = slotOf(HASH, D4);
const notSigning = { root: false, maySign: false } as const;

const withDelegations = (patch: Partial<OrgView>) => ({ 'org.view': () => viewWith({ hubKeys: READ, ...patch }) });
const delegationsGroup = async () => {
  const org = await group('org');
  return within(await within(org).findByRole('heading', { level: 5, name: 'Delegations' }).then((h) => h.closest<HTMLElement>('[data-org-section="delegations"]')!));
};
const buttons = (label: string) => within(row(label)).queryAllByRole('button').map((b) => b.textContent);

describe('Settings › Org: Delegations (M4c)', () => {
  it('a delegation in effect: its prefix, owners, expiry in words, uses and certified machines, live or retired; Renew and Drop while this Mac may sign', async () => {
    let may = true;
    renderSection(signing(ROOT), { 'org.view': () => viewWith({ hubKeys: READ, delegations: [IN_EFFECT], maySign: may }) });
    const section = await delegationsGroup();
    const ci = section.getByRole('group', { name: 'ci-runner-' });
    expect(within(ci).getByText('Owned by you and Ana')).toBeTruthy();
    expect(within(ci).getByText('expires in 23 days')).toBeTruthy();
    expect(within(ci).getByText('used 3 of 10')).toBeTruthy();
    expect(within(ci).getByText('Certified: ci-runner-1 (live) and ci-runner-2 (retired)')).toBeTruthy();
    expect(within(ci).getByText(`id ${D1.slice(0, 8)}`).className).toContain('font-mono');
    expect(buttons('ci-runner-')).toEqual(['Renew…', 'Drop…']);
    expect(within(ci).queryByText(/hub/i)).toBeNull(); // the hub's key agrees: nothing to say

    // read-only once this Mac can't sign: no Renew, Drop or Create
    may = false;
    emit(signing(notSigning));
    await vi.waitFor(() => expect(buttons('ci-runner-')).toEqual([]));
    expect(within(row('New delegation')).getByText('This Mac can’t sign: create delegations from an admin’s Mac that does.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Code destination' })).toBeNull();
  });

  it('none yet, a capless one, a delegation with no certified machine, and a member who is no admin reads them without the hub’s side', async () => {
    renderSection(signing(ROOT), withDelegations({ delegations: [] }));
    expect((await delegationsGroup()).getByText('No delegations yet.')).toBeTruthy();
    resetHarness();
    const capless = delegation({ id: D1, prefix: 'ci-', maxUses: null, hub: { expires: IN_23_DAYS, uses: 1, revoked: false } });
    renderSection(signing(ROOT), withDelegations({ delegations: [capless] }));
    await delegationsGroup();
    expect(within(row('ci-')).getByText('used 1 time, no cap')).toBeTruthy();
    expect(within(row('ci-')).getByText('No certified machines yet')).toBeTruthy();
    resetHarness();
    const member = viewWith({ delegations: [capless], hubKeys: { at: null, failed: true }, members: viewWith({}).members.map((m) => (m.you ? { ...m, role: 'member' as const } : m)) });
    renderSection(signing(ROOT), { 'org.view': () => member });
    const section = await delegationsGroup();
    const ci = section.getByRole('group', { name: 'ci-' });
    expect(within(ci).getByText('no use cap')).toBeTruthy(); // the hub's count is an admin's read
    expect(within(ci).queryByText(/hub/i)).toBeNull();
    expect(screen.queryByRole('group', { name: 'Hub keys' })).toBeNull(); // the key list is an admin's read
    expect(within(row('New delegation')).getByText('An admin creates delegations from their Org page.')).toBeTruthy();
    expect(sent('org.provisioningSecret.get')).toEqual([]); // the destination is an admin's who signs
  });

  it('a half-done renewal: the hub’s expiry beside the state’s, in the spec’s words, its problem with the next step, and Retry calling only the route', async () => {
    let answer: HubHalfResult = { ok: false, reason: 'none' };
    renderSection(signing(ROOT), { ...withDelegations({ delegations: [HALF_DONE] }), 'org.delegation.renewHub': () => answer });
    const section = await delegationsGroup();
    const gpu = section.getByRole('group', { name: 'gpu-' });
    expect(within(gpu).getByText('Renewed in the org state; the hub’s key still expires Nov 20, 2026:')).toBeTruthy();
    expect(within(gpu).getByText('expires in 90 days')).toBeTruthy();
    expect(within(gpu).getByText('Owned by the org')).toBeTruthy();
    expect(within(gpu).getByText('The hub’s org state doesn’t hold the renewal yet: Retry in a moment.').className).toContain('text-warning');
    fireEvent.click(within(gpu).getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(sent('org.delegation.renewHub')).toEqual([{ id: D2 }]));
    expect(sent('org.change')).toEqual([]); // the route alone: nothing signed again
    expect(await within(gpu).findByText('Nothing is left to do at the hub.')).toBeTruthy();
    answer = { ok: true };

    // a hub without the route: "this hub can't renew its key yet", with Retry
    emit(signing(ROOT, { delegations: { creating: false, rev: 1 } }));
    resetHarness();
    renderSection(signing(ROOT), withDelegations({ delegations: [{ ...HALF_DONE, hubProblem: { reason: 'no-route', detail: "Renewed in the org state; this hub can't renew its key yet" } }] }));
    const noRoute = (await delegationsGroup()).getByRole('group', { name: 'gpu-' });
    expect(within(noRoute).getByText('Renewed in the org state; this hub can’t renew its key yet:')).toBeTruthy();
    expect(within(noRoute).queryByText(/still expires/)).toBeNull();
    expect(within(noRoute).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('a dropped delegation whose key the hub still lists: Retry calls only revokeHub; a refused half shows the hub’s words', async () => {
    renderSection(signing(ROOT), { ...withDelegations({ delegations: [{ ...DROPPED, hubProblem: { reason: 'refused', detail: 'the hub answered 500 internal' } }] }), 'org.delegation.revokeHub': () => ({ ok: true }) });
    const old = (await delegationsGroup()).getByRole('group', { name: 'old-vm-' });
    expect(within(old).getByText('dropped')).toBeTruthy();
    expect(within(old).getByText('Dropped in the org state; the hub still lists its key as live:')).toBeTruthy();
    expect(within(old).getByText('The hub refused it: Retry, and if it refuses again, see its answer: the hub answered 500 internal')).toBeTruthy();
    expect(buttons('old-vm-')).toEqual(['Retry']); // a dropped row offers no Renew or Drop
    fireEvent.click(within(old).getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(sent('org.delegation.revokeHub')).toEqual([{ id: D3 }]));
    expect(sent('org.delegation.renewHub')).toEqual([]);
  });

  it('a hub key list that didn’t read says so, never “no keys”; one that read and lacks the key says that', async () => {
    renderSection(signing(ROOT), withDelegations({ delegations: [{ ...IN_EFFECT, hub: null }], hubKeys: { at: null, failed: true } }));
    const section = await delegationsGroup();
    expect(within(row('Hub keys')).getByText(/The hub’s key list couldn’t be read, so each delegation’s hub key is unknown, not missing\./)).toBeTruthy();
    expect(within(row('ci-runner-')).getByText('Its hub key isn’t read yet.')).toBeTruthy();
    expect(section.queryByText(/lists no key/)).toBeNull();
    expect(within(row('ci-runner-')).getByText('at most 10 uses')).toBeTruthy(); // the uses unknown, the cap known

    // read before, failing now: the last good read, with its time
    emit(signing(ROOT, { delegations: { creating: false, rev: 1 } }));
    resetHarness();
    renderSection(signing(ROOT), withDelegations({ delegations: [IN_EFFECT], hubKeys: { at: '2026-10-28T11:00:00.000Z', failed: true } }));
    await delegationsGroup();
    expect(within(row('Hub keys')).getByText(/each delegation’s hub key shows as of Oct 28, /)).toBeTruthy();

    // read, and the hub lists no key for it
    resetHarness();
    renderSection(signing(ROOT), withDelegations({ delegations: [{ ...IN_EFFECT, hub: null }] }));
    await delegationsGroup();
    expect(within(row('ci-runner-')).getByText('The hub lists no key for it, so it provisions nothing there: drop it and create a new delegation.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Hub keys' })).toBeNull();
  });

  it('a failed read of the hub’s key list has Retry, which reads it again now, each time it is pressed; a read that fails again says so', async () => {
    let read: HubKeysRead = { at: null, failed: true };
    let hubKeys: OrgView['hubKeys'] = { at: null, failed: true };
    renderSection(signing(ROOT), {
      'org.view': () => viewWith({ delegations: [{ ...IN_EFFECT, hub: null }], hubKeys }),
      'org.delegation.readKeys': () => read,
    });
    await delegationsGroup();
    expect(buttons('Hub keys')).toEqual(['Retry']);
    fireEvent.click(within(row('Hub keys')).getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(sent('org.delegation.readKeys')).toHaveLength(1));
    expect(await within(row('Hub keys')).findByText('It still couldn’t be read: Retry once the hub answers.')).toBeTruthy();
    // pressed again at once (inside main's 30 s freshness): it asks again, and this read lands
    read = { at: '2026-10-28T12:00:01.000Z', failed: false };
    hubKeys = read;
    fireEvent.click(within(row('Hub keys')).getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(sent('org.delegation.readKeys')).toHaveLength(2));
    emit(signing(ROOT, { delegations: { creating: false, rev: 1 } })); // main's rev: the view reads again
    await vi.waitFor(() => expect(screen.queryByRole('group', { name: 'Hub keys' })).toBeNull());
    // signed out, there is no sign-in for a read to belong to: no Retry
    resetHarness();
    renderSection(signing(ROOT, { session: 'signed-out' }), withDelegations({ delegations: [IN_EFFECT], hubKeys: { at: null, failed: true } }));
    await delegationsGroup();
    expect(buttons('Hub keys')).toEqual([]);
  });

  it('an unsent delegation while this run holds its key pair: its reason, Write the code again naming its run, and Discard', async () => {
    let rewrite: DelegationResult = { ok: false, reason: 'unsent', detail: 'gcloud secrets versions add failed again', phase: 'held', stored: false, version: 13, run: RUN, rev: REV };
    renderSection(signing(PENDING), {
      ...withDelegations({ delegations: [UNSENT] }),
      'org.delegation.rewrite': () => rewrite,
      'org.discardPending': () => ({ ok: true, unsent: true, hubVersion: 12 }) satisfies DiscardResult,
    });
    const dc = (await delegationsGroup()).getByRole('group', { name: 'dc-' });
    expect(within(dc).getByText('unsent')).toBeTruthy();
    expect(within(dc).getByText('Signed, not published: its provisioning code isn’t stored yet.')).toBeTruthy();
    expect(within(dc).getByText(UNSENT.unsent!.problem!)).toBeTruthy();
    expect(buttons('dc-')).toEqual(['Write the code again', 'Discard…']);
    fireEvent.click(within(dc).getByRole('button', { name: 'Write the code again' }));
    await vi.waitFor(() => expect(sent('org.delegation.rewrite')).toEqual([{ generation: 1, id: D4, hash: HASH }]));
    expect(await within(dc).findByText('The code still isn’t stored: Write the code again, or discard it.')).toBeTruthy();
    rewrite = { ok: true, version: 13, secret: { version: '7', createTime: '2026-10-28T12:00:05.000Z' }, run: RUN, rev: REV };
    fireEvent.click(within(dc).getByRole('button', { name: 'Write the code again' }));
    expect(await within(row('New delegation')).findByText(/^Published delegation dc- in version 13\. Its code is version 7, stored /)).toBeTruthy();
    expect(buttons('dc-'), 'published: its unsent actions withdraw before the status says so').toEqual([]);

    // Discard, behind its confirmation, names the slot shown and says the hub key goes with it
    resetHarness();
    renderSection(signing(PENDING), { ...withDelegations({ delegations: [UNSENT] }), 'org.discardPending': () => ({ ok: true, unsent: true, hubVersion: 12 }) satisfies DiscardResult });
    const fresh = (await delegationsGroup()).getByRole('group', { name: 'dc-' });
    fireEvent.click(within(fresh).getByRole('button', { name: 'Discard…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Discard the unsent delegation dc-?' });
    expect(within(sheet).getByText(/Discarding it also revokes the hub key minted for it\. Create the delegation again afterwards\./)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Discard' }));
    await vi.waitFor(() => expect(sent('org.discardPending')).toEqual([{ confirmed: true, hash: HASH }]));
    expect(await within(row('New delegation')).findByText(/^Discarded version 13\. Its hub key is revoked/)).toBeTruthy();
  });

  it('after a relaunch (rewrite false) the unsent row offers only Discard, worded to create it again', async () => {
    renderSection(signing(PENDING), withDelegations({ delegations: [{ ...UNSENT, unsent: { rewrite: false, writing: false, problem: null, generation: null } }] }));
    const dc = (await delegationsGroup()).getByRole('group', { name: 'dc-' });
    expect(within(dc).getByText('This Mac no longer holds its key pair, so it can’t be published: discard it and create the delegation again.')).toBeTruthy();
    expect(buttons('dc-')).toEqual(['Discard…']);
    // and the pending line says what the slot holds, not that it waits for the hub
    expect(within(row('Pending')).getByText('Version 13 holds delegation dc-, not yet published: see Delegations.')).toBeTruthy();
  });

  it('a delayed view refresh while the pending slot changes: the old row offers no Discard or Write again for another proposal', async () => {
    renderSection(signing(PENDING), {
      ...withDelegations({ delegations: [UNSENT] }),
      'org.discardPending': () => ({ ok: true, unsent: true, hubVersion: 12 }) satisfies DiscardResult,
    });
    const dc = (await delegationsGroup()).getByRole('group', { name: 'dc-' });
    expect(buttons('dc-')).toEqual(['Write the code again', 'Discard…']);
    fireEvent.click(within(dc).getByRole('button', { name: 'Discard…' }));
    await screen.findByRole('dialog', { name: 'Discard the unsent delegation dc-?' });
    // another window discarded it and signed another proposal; this window's status has it, its view not yet
    emit(signing(slotOf(HASH2, D5, 14)));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); // the confirmation was of the slot gone
    expect(buttons('dc-')).toEqual([]);
    // a pending slot that holds no delegation at all offers no Discard here either
    emit(signing(slotOf(HASH2, null, 14)));
    await act(async () => {});
    expect(buttons('dc-')).toEqual([]);
    expect(sent('org.discardPending')).toEqual([]);
    expect(sent('org.delegation.rewrite')).toEqual([]);
    // the slot that holds this row's delegation again: Discard names that slot's hash
    emit(signing(slotOf(HASH, D4)));
    fireEvent.click(await within(dc).findByRole('button', { name: 'Discard…' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Discard the unsent delegation dc-?' })).getByRole('button', { name: 'Discard' }));
    await vi.waitFor(() => expect(sent('org.discardPending')).toEqual([{ confirmed: true, hash: HASH }]));
  });

  it('the same id and hash going from held to exposed under a stale view: the unsent actions withdraw, and an open Discard confirmation closes', async () => {
    renderSection(signing(PENDING), {
      ...withDelegations({ delegations: [UNSENT] }), // the view stays as it was: unsent
      'org.discardPending': () => ({ ok: true, unsent: false, hubVersion: 13 }) satisfies DiscardResult,
    });
    const dc = (await delegationsGroup()).getByRole('group', { name: 'dc-' });
    expect(buttons('dc-')).toEqual(['Write the code again', 'Discard…']);
    expect(within(row('Pending')).getByText('Version 13 holds delegation dc-, not yet published: see Delegations.')).toBeTruthy();
    fireEvent.click(within(dc).getByRole('button', { name: 'Discard…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Discard the unsent delegation dc-?' });
    expect(within(sheet).getByText(/^Version 13 was never sent, so nothing can show it as a fork/)).toBeTruthy();
    // another window's Write again published it: the same slot, its marker cleared and its exposure written
    emit(signing(slotOf(HASH, D4, 13, false)));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); // the "never sent" assurance is withdrawn with it
    expect(buttons('dc-')).toEqual([]);
    expect(await within(row('Pending')).findByText('Version 13 is signed and waits for the hub.')).toBeTruthy();
    expect(sent('org.discardPending')).toEqual([]);
  });

  it('a Write again whose slot was discarded first says so, not published', async () => {
    renderSection(signing(PENDING), {
      ...withDelegations({ delegations: [UNSENT] }),
      'org.delegation.rewrite': () => ({ ok: false, reason: 'stale', detail: 'nothing was published', phase: 'discarded', stored: true, version: 13, run: RUN, rev: REV }) satisfies DelegationResult,
    });
    const dc = (await delegationsGroup()).getByRole('group', { name: 'dc-' });
    fireEvent.click(within(dc).getByRole('button', { name: 'Write the code again' }));
    expect(
      await within(row('New delegation')).findByText(
        'Not published: its pending slot was discarded or replaced first, so nothing was published; its code’s version stays in the secret, unused. Create the delegation again if it’s still wanted. · nothing was published',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/^Published as version/)).toBeNull();
    expect(buttons('dc-'), 'discarded: its unsent actions withdraw before the status says so').toEqual([]);
  });

  it('a Write again that ends published and pending says so, with no Write again; one stored but refused offers Discard alone', async () => {
    const published: DelegationResult = { ok: false, reason: 'hub', detail: 'the hub did not answer', phase: 'published', stored: true, version: 13, run: RUN, rev: REV };
    let rewrite: DelegationResult = published;
    renderSection(signing(PENDING), { ...withDelegations({ delegations: [UNSENT] }), 'org.delegation.rewrite': () => rewrite });
    const dc = (await delegationsGroup()).getByRole('group', { name: 'dc-' });
    fireEvent.click(within(dc).getByRole('button', { name: 'Write the code again' }));
    expect(await within(row('New delegation')).findByText('Published as version 13, its code stored. It settles as any pending state once the hub takes it (Org › Pending): nothing more to do here. · the hub did not answer')).toBeTruthy();
    expect(within(dc).queryByText(/Not written/)).toBeNull();
    // the answer outran its status (separate pipes): the status still says held at an earlier rev, and the row offers
    // nothing for the slot that is now exposed (branch fix wave, R6)
    expect(buttons('dc-')).toEqual([]);
    emit(signing(PENDING, { delegations: { creating: false, rev: REV - 1 } }));
    await act(async () => {});
    expect(buttons('dc-')).toEqual([]);
    // a status at the answer's rev governs again (were it still to say held, the actions would return)
    emit(signing(PENDING, { delegations: { creating: false, rev: REV } }));
    await vi.waitFor(() => expect(buttons('dc-')).toEqual(['Write the code again', 'Discard…']));

    resetHarness();
    rewrite = { ok: false, reason: 'unsent', detail: 'its code is stored (version 7), but the publish was refused: stale; only Discard', phase: 'held', stored: true, version: 13, run: RUN, rev: REV };
    renderSection(signing(PENDING), { ...withDelegations({ delegations: [UNSENT] }), 'org.delegation.rewrite': () => rewrite });
    const again = (await delegationsGroup()).getByRole('group', { name: 'dc-' });
    fireEvent.click(within(again).getByRole('button', { name: 'Write the code again' }));
    expect(
      await within(again).findByText('Signed as version 13 and its code stored, but its publish was refused, so it stays unsent. · Discard it, then create the delegation again. · its code is stored (version 7), but the publish was refused: stale; only Discard'),
    ).toBeTruthy();
  });

  it('while main writes the code (unsent.writing) the row says where, and offers nothing: no lost-key-pair words (branch fix wave, R5)', async () => {
    const writing = { ...UNSENT, unsent: { rewrite: false, writing: true, problem: null, generation: 1 } };
    renderSection(signing(PENDING), { ...withDelegations({ delegations: [writing] }), 'org.provisioningSecret.get': () => DEST });
    const dc = (await delegationsGroup()).getByRole('group', { name: 'dc-' });
    expect(await within(dc).findByText(`Writing the code to ${DEST.project}/${DEST.secret}…`)).toBeTruthy();
    expect(within(dc).queryByText(/no longer holds its key pair/)).toBeNull();
    expect(buttons('dc-')).toEqual([]);
  });

  it('a stray hub key: its prefix, label, age and expiry; Revoke behind a confirmation, stronger for a young key', async () => {
    const strays = [
      { id: S1, prefix: 'tmp-', label: 'cli create, abandoned', created: new Date(Date.now() - 3 * DAY).toISOString(), expires: IN_23_DAYS, young: false },
      { id: S2, prefix: 'new-', label: 'just now', created: new Date(Date.now() - 4 * 60_000).toISOString(), expires: IN_90_DAYS, young: true },
    ];
    renderSection(signing(ROOT), { ...withDelegations({ strayKeys: strays }), 'org.delegation.revokeHub': () => ({ ok: false, reason: 'hub', detail: 'the hub was not reached (timeout): Retry' }) });
    await delegationsGroup();
    const stray = row('Stray hub keys');
    expect(within(stray).getByText('cli create, abandoned · tmp-')).toBeTruthy();
    expect(within(stray).getByText('minted 3 days ago')).toBeTruthy();
    expect(within(stray).getByText('expires in 23 days')).toBeTruthy();
    expect(within(stray).getByText('just minted')).toBeTruthy();

    const [old, young] = within(stray).getAllByRole('button', { name: 'Revoke…' });
    fireEvent.click(old!);
    let sheet = await screen.findByRole('dialog', { name: 'Revoke the hub key “cli create, abandoned”?' });
    expect(within(sheet).getByText(/If a CLI delegation create or another admin’s create is still under way, it loses its key and fails/)).toBeTruthy();
    expect(within(sheet).queryByText(/likely a create still under way/)).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('org.delegation.revokeHub')).toEqual([]);

    fireEvent.click(young!);
    sheet = await screen.findByRole('dialog', { name: 'Revoke the hub key “just now”?' });
    expect(within(sheet).getByText(/^This key was minted 4 minutes ago: it is likely a create still under way/).className).toContain('text-warning');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Revoke' }));
    await vi.waitFor(() => expect(sent('org.delegation.revokeHub')).toEqual([{ id: S2 }]));
    expect(await within(row('Stray hub keys')).findByText('Not revoked · The hub wasn’t reached: Retry once it is. · the hub was not reached (timeout): Retry')).toBeTruthy();
  });
});

describe('Settings › Org: Delegations’ code destination and Create (M4c)', () => {
  it('Create is disabled without a destination, saying why; Save names all three, and Create then opens', async () => {
    let reading: ProvisioningSecretReading = null;
    const written: ProvisioningSecretWrite = { ok: true };
    renderSection(signing(ROOT), {
      'org.provisioningSecret.get': () => reading,
      'org.provisioningSecret.set': (input: { value: ProvisioningSecret | null }) => {
        reading = input.value;
        return written;
      },
    });
    await delegationsGroup();
    const create = await within(row('New delegation')).findByRole('button', { name: 'Create a delegation…' });
    await vi.waitFor(() => expect(within(row('New delegation')).getByText('Set the code destination below first.')).toBeTruthy());
    expect((create as HTMLButtonElement).disabled).toBe(true);

    const destination = row('Code destination');
    const save = within(destination).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(destination).getByRole('textbox', { name: 'Project' }), { target: { value: 'Not_A_Project' } });
    expect(within(destination).getByText('A project id is 6 to 30 lowercase letters, digits and hyphens, from a letter: correct it, then Save.')).toBeTruthy();
    expect(save.disabled).toBe(true);
    fireEvent.change(within(destination).getByRole('textbox', { name: 'Project' }), { target: { value: DEST.project } });
    expect(within(destination).getByText('Fill in all three, or clear all three to unset it, then Save.')).toBeTruthy();
    fireEvent.change(within(destination).getByRole('textbox', { name: 'Secret' }), { target: { value: DEST.secret } });
    fireEvent.change(within(destination).getByRole('textbox', { name: 'Account' }), { target: { value: ` ${DEST.account} ` } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await vi.waitFor(() => expect(sent('org.provisioningSecret.set')).toEqual([{ value: DEST }]));
    expect(await within(row('Code destination')).findByText('Saved.')).toBeTruthy();
    await vi.waitFor(() => expect((within(row('New delegation')).getByRole('button', { name: 'Create a delegation…' }) as HTMLButtonElement).disabled).toBe(false));
    expect(within(row('New delegation')).queryByText('Set the code destination below first.')).toBeNull();
    fireEvent.click(within(row('New delegation')).getByRole('button', { name: 'Create a delegation…' }));
    expect(await screen.findByRole('dialog', { name: 'Create a delegation' })).toBeTruthy();
  });

  it('a set destination shows its project, secret and account; a refused write says why and what next; clearing all three unsets it', async () => {
    renderSection(signing(ROOT), {
      'org.provisioningSecret.get': () => DEST,
      'org.provisioningSecret.set': (input: { value: ProvisioningSecret | null }) => (input.value === null ? { ok: true } : ({ ok: false, reason: 'io', detail: 'EACCES' } satisfies ProvisioningSecretWrite)),
    });
    await delegationsGroup();
    const destination = row('Code destination');
    await vi.waitFor(() => expect((within(destination).getByRole('textbox', { name: 'Project' }) as HTMLInputElement).value).toBe(DEST.project));
    expect((within(destination).getByRole('textbox', { name: 'Secret' }) as HTMLInputElement).value).toBe(DEST.secret);
    expect((within(destination).getByRole('textbox', { name: 'Account' }) as HTMLInputElement).value).toBe(DEST.account);
    fireEvent.change(within(destination).getByRole('textbox', { name: 'Secret' }), { target: { value: 'desk-provisioning-v3' } });
    fireEvent.click(within(destination).getByRole('button', { name: 'Save' }));
    expect(await within(destination).findByText('Not saved · The destination couldn’t be written: Save again. · EACCES')).toBeTruthy();
    for (const name of ['Project', 'Secret', 'Account']) fireEvent.change(within(destination).getByRole('textbox', { name }), { target: { value: '' } });
    fireEvent.click(within(destination).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(sent('org.provisioningSecret.set').at(-1)).toEqual({ value: null }));
    expect(await within(destination).findByText('Cleared.')).toBeTruthy();
  });

  it('a damaged destination file shows its reason, and Reset behind a confirmation; Create stays disabled, saying why', async () => {
    let reading: ProvisioningSecretReading = { damaged: 'version 2 is not this build’s' };
    renderSection(signing(ROOT), {
      'org.provisioningSecret.get': () => reading,
      'org.provisioningSecret.reset': () => {
        reading = null;
        return { ok: true };
      },
    });
    await delegationsGroup();
    const destination = row('Code destination');
    expect(await within(destination).findByText('The destination’s file is damaged (version 2 is not this build’s): Reset it, then enter the destination again.')).toBeTruthy();
    expect(within(destination).queryByRole('textbox')).toBeNull(); // never edited over
    expect(within(row('New delegation')).getByText('Reset the code destination below first.')).toBeTruthy();
    fireEvent.click(within(destination).getByRole('button', { name: 'Reset…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Reset the code destination?' });
    expect(sent('org.provisioningSecret.reset')).toEqual([]);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Reset' }));
    await vi.waitFor(() => expect(sent('org.provisioningSecret.reset')).toEqual([{ confirmed: true }]));
    expect(await within(row('Code destination')).findByRole('textbox', { name: 'Project' })).toBeTruthy(); // read again: unset
    expect(within(row('New delegation')).getByText('Set the code destination below first.')).toBeTruthy();
  });

  it('Create waits while a delegation is being created, and while a signed state is pending, saying why', async () => {
    renderSection(signing(ROOT, { delegations: { creating: true, rev: 0 } }), { 'org.provisioningSecret.get': () => DEST });
    await delegationsGroup();
    await vi.waitFor(() => expect(within(row('New delegation')).getByText('A delegation is being created, in this window or another: Create once it’s done.')).toBeTruthy());
    expect((within(row('New delegation')).getByRole('button', { name: 'Create a delegation…' }) as HTMLButtonElement).disabled).toBe(true);
    emit(signing(PENDING));
    await vi.waitFor(() => expect(within(row('New delegation')).getByText('A signed state is pending: publish or discard it (Org › Pending) first.')).toBeTruthy());
    emit(signing(ROOT));
    await vi.waitFor(() => expect((within(row('New delegation')).getByRole('button', { name: 'Create a delegation…' }) as HTMLButtonElement).disabled).toBe(false));
    await act(async () => {});
  });
});
