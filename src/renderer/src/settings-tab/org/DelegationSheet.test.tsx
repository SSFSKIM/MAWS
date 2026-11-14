// P5 O8 M4c: the create sheet (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4c's *The create transaction*
// and *The destination*, and the renderer's "Proves"): a label, a prefix, a life in days and a use cap inside the
// provisioning bounds (checked here), and owners; where the code goes, and when devcloud uses it; then one
// `org.delegation.create`, whose one Touch ID is main's. Its outcomes each read in their own words with their next step:
// `secret-store` with what's missing, a mint disagreement, `busy`, a cancel, a write that leaves the delegation unsent
// (with "Write the code again"), and success with the code's version and its time. It never shows, copies or holds the
// code, and it takes no answer from a request it no longer owns: closed, or under a sign-in that has ended. Task 5's fix
// wave: each answer names its run (generation, id, held slot's hash) and where it stopped (`phase`); the sheet words each
// phase, offers only what that phase allows, and acts only on the row and slot its run names. Fix wave 2: a slot it
// doesn't see reads as gone only once the status it holds is at or past the answer's revision; a discarded publish
// reads discarded.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { DELEGATION_MAX_USES, DELEGATION_TTL_DAYS, type DelegationResult, type DelegationRun, type OrgDelegationRow, type ProvisioningSecret } from '@shared/ipc/schema/org';
import { ANA, ME, ROOT, emit, found, group, renderSection, resetHarness, row, sent, signing, viewWith, type Signer } from './test-support';

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(resetHarness);

const DEST: ProvisioningSecret = { project: 'maws-example-prod', secret: 'desk-provisioning-v2', account: 'cli-owner@maws-example-prod.iam.gserviceaccount.com' };
const ID = '0123456789abcdef0123456789abcdef';
// What the code looks like, were it ever to reach the renderer (org-protocol's PROVISIONING_CODE_V2_PREFIX, then base64url).
const CODE = 'smns-provision-v2:eyJodWIiOiJodHRwczovL2Rlc2suZXhhbXBsZSIsInRva2VuIjoic2VjcmV0In0';
const ID2 = 'fedcba9876543210fedcba9876543210';
const HASH = 'heldSlotStateHash000000000000000000000000000';
const HASH2 = 'anotherSlotStateHash0000000000000000000000000';
const RUN: DelegationRun = { generation: 1, id: ID, hash: HASH };
const OK: DelegationResult = { ok: true, version: 13, secret: { version: '7', createTime: '2026-10-28T12:00:05.000Z' }, run: RUN, rev: 1 };
/** A refusal before anything was minted (no run reserved), as main answers it. */
const refused = (reason: Extract<DelegationResult, { ok: false }>['reason'], detail: string): DelegationResult => ({ ok: false, reason, detail, phase: 'refused', stored: false, run: null, rev: 0 });
/** A create that signed and holds its slot unsent (`stored`: its code is in the secret, the publish refused), covered by status revision 1. */
const held = (detail: string, stored = false, run: DelegationRun = RUN): DelegationResult => ({ ok: false, reason: 'unsent', detail, phase: 'held', stored, version: 13, run, rev: 1 });
/** The status while slot `hash` holds delegation `id` (`held`: its unsent marker stands). */
const holding = (hash = HASH, id: string | null = ID, held = true): Partial<Signer> => ({ ...ROOT, pending: { version: 13, hash, fork: false, exposed: !held, refused: null, delegation: id, held } });
const at = (rev: number) => ({ delegations: { creating: false, rev } });
const UNSENT_ROW: OrgDelegationRow = {
  id: ID,
  prefix: 'dc-',
  owners: [ME],
  expires: '2027-01-26T12:00:00.000Z',
  maxUses: null,
  machines: [],
  hub: { expires: '2027-01-26T12:00:00.000Z', uses: 0, revoked: false },
  state: 'unsent',
  unsent: { rewrite: true, writing: false, problem: 'gcloud secrets versions add failed: PERMISSION_DENIED', generation: 1 },
  hubBehind: null,
  hubProblem: null,
};

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function openSheet() {
  await group('org');
  const create = await within(await found('New delegation')).findByRole('button', { name: 'Create a delegation…' });
  await vi.waitFor(() => expect((create as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(create);
  return screen.findByRole('dialog', { name: 'Create a delegation' });
}
function fill(sheet: HTMLElement, fields: { label?: string; prefix?: string; days?: string }) {
  if (fields.label !== undefined) fireEvent.change(within(sheet).getByRole('textbox', { name: 'Label' }), { target: { value: fields.label } });
  if (fields.prefix !== undefined) fireEvent.change(within(sheet).getByRole('textbox', { name: 'Prefix' }), { target: { value: fields.prefix } });
  if (fields.days !== undefined) fireEvent.change(within(sheet).getByRole('spinbutton', { name: 'Expires in' }), { target: { value: fields.days } });
}
const createButton = (sheet: HTMLElement) => within(sheet).getByRole('button', { name: 'Create…' }) as HTMLButtonElement;

describe('Settings › Org: the create sheet (M4c)', () => {
  it('its fields inside the bounds, the destination named, devcloud’s condition said; Create sends the fields as asked, and success reaches the page with the code’s version and time', async () => {
    renderSection(signing(ROOT), { 'org.provisioningSecret.get': () => DEST, 'org.delegation.create': () => OK });
    const sheet = await openSheet();
    expect(within(sheet).getByText('The code goes to maws-example-prod/desk-provisioning-v2 as a new version. It is never shown here.')).toBeTruthy();
    expect(within(sheet).getByText('Devcloud uses it only if the profile’s [desk] delegation_id names this delegation.')).toBeTruthy();
    expect((within(sheet).getByRole('spinbutton', { name: 'Expires in' }) as HTMLInputElement).value).toBe('90');
    expect((within(sheet).getByRole('radio', { name: 'No cap' }) as HTMLInputElement).checked).toBe(true);
    expect(createButton(sheet).disabled).toBe(true); // a label and a prefix first

    fill(sheet, { label: 'x'.repeat(101), prefix: 'dc-' });
    expect(createButton(sheet).disabled).toBe(true);
    expect(within(sheet).getByText('The hub key’s label: 1 to 100 characters.').className).toContain('text-warning');
    fill(sheet, { label: '  devcloud VMs ', days: String(DELEGATION_TTL_DAYS.max + 1) });
    expect(createButton(sheet).disabled).toBe(true);
    expect(within(sheet).getByText(`${DELEGATION_TTL_DAYS.min} to ${DELEGATION_TTL_DAYS.max} days.`).className).toContain('text-warning');
    fill(sheet, { days: '30' });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'At most' }));
    const cap = within(sheet).getByRole('spinbutton', { name: 'Use cap' });
    fireEvent.change(cap, { target: { value: String(DELEGATION_MAX_USES + 1) } });
    expect(createButton(sheet).disabled).toBe(true);
    fireEvent.change(cap, { target: { value: '5' } });
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /^Ana/ }));
    expect(createButton(sheet).disabled).toBe(false);
    fireEvent.click(createButton(sheet));
    await vi.waitFor(() => expect(sent('org.delegation.create')).toEqual([{ label: 'devcloud VMs', prefix: 'dc-', ttlDays: 30, maxUses: 5, owners: [ME, ANA] }]));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(row('New delegation')).getByText(/^Created delegation dc-\. Signed version 13\. Its code is version 7, stored Oct 28, /)).toBeTruthy();
  });

  it('uncapped sends no cap, and the org’s admins may own it', async () => {
    renderSection(signing(ROOT), { 'org.provisioningSecret.get': () => DEST, 'org.delegation.create': () => OK });
    const sheet = await openSheet();
    fill(sheet, { label: 'ci', prefix: 'ci-' });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'The org (its admins)' }));
    fireEvent.click(createButton(sheet));
    await vi.waitFor(() => expect(sent('org.delegation.create')).toEqual([{ label: 'ci', prefix: 'ci-', ttlDays: 90, maxUses: null, owners: 'org' }]));
  });

  it('every refusal reads in its own words with its next step, and Create stays to try again', async () => {
    const answers: { answer: DelegationResult; line: string }[] = [
      { answer: refused('secret-store', 'secret-store: gcloud not found: nothing was minted or signed'), line: 'Not created · Its code has nowhere to go yet, so nothing was minted or signed: fix what’s named, then Create again. · secret-store: gcloud not found: nothing was minted or signed' },
      {
        answer: { ok: false, reason: 'refused', detail: "the hub's answer to the mint disagrees with what was asked (prefix dc- not dd-): nothing was signed; its key was revoked", phase: 'minted', stored: false, run: { ...RUN, hash: null }, rev: 1 },
        line: "Not created · Refused, so nothing was signed: correct what’s named, then Create again. · the hub's answer to the mint disagrees with what was asked (prefix dc- not dd-): nothing was signed; its key was revoked",
      },
      { answer: refused('busy', 'another org attempt is under way'), line: 'Not created · Another create or org attempt is running: Create again once it’s done. · another org attempt is under way' },
      { answer: { ok: false, reason: 'cancelled', detail: 'nothing was signed; its key was revoked', phase: 'minted', stored: false, run: { ...RUN, hash: null }, rev: 1 }, line: 'Not created · Touch ID was cancelled, so nothing was signed: Create again when ready. · nothing was signed; its key was revoked' },
    ];
    let answer = answers[0]!.answer;
    renderSection(signing(ROOT), { 'org.provisioningSecret.get': () => DEST, 'org.delegation.create': () => answer });
    const sheet = await openSheet();
    fill(sheet, { label: 'devcloud VMs', prefix: 'dc-' });
    for (const [i, each] of answers.entries()) {
      answer = each.answer;
      fireEvent.click(createButton(sheet));
      await vi.waitFor(() => expect(sent('org.delegation.create')).toHaveLength(i + 1));
      expect((await within(sheet).findByRole('alert')).textContent).toBe(each.line);
      expect(createButton(sheet).disabled).toBe(false);
      expect((within(sheet).getByRole('textbox', { name: 'Label' }) as HTMLInputElement).value).toBe('devcloud VMs'); // kept, to correct
      // a key minted and nothing signed says where that key went
      const minted = within(sheet).queryByText('Nothing was signed. Any key it minted was revoked, or, if the hub didn’t take the revoke, it shows under Stray hub keys, to revoke there.');
      expect(minted !== null).toBe(each.answer.ok === false && each.answer.phase === 'minted');
    }
    expect(screen.getByRole('dialog', { name: 'Create a delegation' })).toBe(sheet);
  });

  it('a write that leaves the delegation unsent: its reason, and Write the code again for the run it names, whose success reaches the page', async () => {
    let unsent = false;
    renderSection(signing(ROOT), {
      'org.provisioningSecret.get': () => DEST,
      'org.view': () => viewWith({ delegations: unsent ? [UNSENT_ROW] : [] }),
      'org.delegation.create': () => {
        unsent = true;
        return held('gcloud secrets versions add failed: PERMISSION_DENIED');
      },
      'org.delegation.rewrite': () => OK,
    });
    const sheet = await openSheet();
    fill(sheet, { label: 'devcloud VMs', prefix: 'dc-' });
    fireEvent.click(createButton(sheet));
    expect((await within(sheet).findByRole('alert')).textContent).toBe('Signed as version 13, not published: its provisioning code isn’t stored yet. · gcloud secrets versions add failed: PERMISSION_DENIED');
    emit(signing(holding(), { delegations: { creating: false, rev: 1 } })); // main's rev: the slot holds it, and the view lists it unsent
    const again = await within(sheet).findByRole('button', { name: 'Write the code again' });
    expect(within(sheet).getByText('Write the code again, or close this and Discard it from its row.')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Create…' })).toBeNull(); // a delegation is signed: no second create
    fireEvent.click(again);
    await vi.waitFor(() => expect(sent('org.delegation.rewrite')).toEqual([{ generation: 1, id: ID, hash: HASH }]));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(row('New delegation')).getByText(/^Created delegation dc-\. Signed version 13\. Its code is version 7, stored /)).toBeTruthy();
  });

  it('signed and its code stored, but its publish refused: Discard only, said as such, with no Write again', async () => {
    const problem = 'its code is stored (version 7), but the publish was refused: stale; only Discard';
    let unsent = false;
    renderSection(signing(ROOT), {
      'org.provisioningSecret.get': () => DEST,
      'org.view': () => viewWith({ delegations: unsent ? [{ ...UNSENT_ROW, unsent: { rewrite: false, writing: false, problem, generation: null } }] : [] }),
      'org.delegation.create': () => {
        unsent = true;
        return held(problem, true);
      },
    });
    const sheet = await openSheet();
    fill(sheet, { label: 'devcloud VMs', prefix: 'dc-' });
    fireEvent.click(createButton(sheet));
    expect((await within(sheet).findByRole('alert')).textContent).toBe(`Signed as version 13 and its code stored, but its publish was refused, so it stays unsent. · ${problem}`);
    emit(signing(holding(), { delegations: { creating: false, rev: 1 } }));
    expect(await within(sheet).findByText('This Mac can’t write it again: close this and Discard it from its row.')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Write the code again' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Create…' })).toBeNull();
  });

  it('published and pending settlement, though the post failed: it says so, and offers no new Create and no Write again', async () => {
    const detail = 'the hub did not answer: the delegation is published and its code stored (version 7): it settles as any pending proposal';
    renderSection(signing(ROOT), {
      'org.provisioningSecret.get': () => DEST,
      'org.delegation.create': () => ({ ok: false, reason: 'hub', detail, phase: 'published', stored: true, version: 13, run: RUN, rev: 1 }) satisfies DelegationResult,
    });
    const sheet = await openSheet();
    fill(sheet, { label: 'devcloud VMs', prefix: 'dc-' });
    fireEvent.click(createButton(sheet));
    expect((await within(sheet).findByText(/^Published as version 13/)).textContent).toBe(`Published as version 13, its code stored. It settles as any pending state once the hub takes it (Org › Pending): nothing more to do here. · ${detail}`);
    emit(signing(holding(), { delegations: { creating: false, rev: 1 } }));
    await act(async () => {});
    expect(within(sheet).queryByRole('textbox', { name: 'Label' })).toBeNull(); // no fields to create again
    expect(within(sheet).queryByRole('button', { name: 'Create…' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Write the code again' })).toBeNull();
    expect(within(sheet).queryByText(/Not created/)).toBeNull();
    expect(within(sheet).getByText(/^Published as version 13/).getAttribute('role')).toBe('status'); // no refusal: it settles on its own
    expect(screen.getByRole('dialog', { name: 'Create a delegation' })).toBe(sheet); // not a success: it stays, to be read
  });

  it('a held answer that arrives before its status: nothing reads as gone until a status at or past its revision says so', async () => {
    renderSection(signing(ROOT), {
      'org.provisioningSecret.get': () => DEST,
      'org.view': () => viewWith({ delegations: [UNSENT_ROW] }),
      'org.delegation.create': () => held('gcloud failed'), // covered by revision 1
    });
    const sheet = await openSheet();
    fill(sheet, { label: 'devcloud VMs', prefix: 'dc-' });
    fireEvent.click(createButton(sheet));
    await within(sheet).findByRole('alert');
    // the status this window holds is revision 0, its slot null: older than the answer, so not proof of anything
    await act(async () => {});
    expect(within(sheet).queryByText(/no longer the one this Mac runs/)).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Write the code again' })).toBeNull();
    emit(signing(ROOT, at(0))); // another publication of the old revision changes nothing
    await act(async () => {});
    expect(within(sheet).queryByText(/no longer the one this Mac runs/)).toBeNull();
    // its status lands: the slot is the run's
    emit(signing(holding(), at(1)));
    await within(sheet).findByRole('button', { name: 'Write the code again' });
    // published by another window's Write again: the same hash and id, no longer held: no Write again, nothing gone
    emit(signing(holding(HASH, ID, false), at(2)));
    await vi.waitFor(() => expect(within(sheet).queryByRole('button', { name: 'Write the code again' })).toBeNull());
    expect(within(sheet).queryByText(/no longer the one this Mac runs/)).toBeNull();
    // a later status without the slot: gone
    emit(signing(ROOT, at(3)));
    expect(await within(sheet).findByText(/^This create is no longer the one this Mac runs/)).toBeTruthy();
  });

  it('a publish whose slot was discarded first reads discarded, not published, and offers nothing', async () => {
    const detail = 'its slot was discarded or replaced before its publish (no proposal is pending (discarded): nothing was published): nothing was published';
    renderSection(signing(ROOT), {
      'org.provisioningSecret.get': () => DEST,
      'org.delegation.create': () => ({ ok: false, reason: 'stale', detail, phase: 'discarded', stored: true, version: 13, run: RUN, rev: 1 }) satisfies DelegationResult,
    });
    const sheet = await openSheet();
    fill(sheet, { label: 'devcloud VMs', prefix: 'dc-' });
    fireEvent.click(createButton(sheet));
    expect((await within(sheet).findByRole('alert')).textContent).toBe(
      `Not published: its pending slot was discarded or replaced first, so nothing was published; its code’s version stays in the secret, unused. Create the delegation again if it’s still wanted. · ${detail}`,
    );
    emit(signing(ROOT, at(1)));
    await act(async () => {});
    expect(within(sheet).queryByText(/^Published/)).toBeNull();
    expect(within(sheet).queryByText(/no longer the one this Mac runs/)).toBeNull(); // said once, in its own words
    expect(within(sheet).queryByRole('textbox', { name: 'Label' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Create…' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Write the code again' })).toBeNull();
  });

  it('two windows: a Discard and a replacement create elsewhere end this sheet’s recovery, saying so, with no Write again and no Discard', async () => {
    let rows: OrgDelegationRow[] = [];
    renderSection(signing(ROOT), {
      'org.provisioningSecret.get': () => DEST,
      'org.view': () => viewWith({ delegations: rows }),
      'org.delegation.create': () => {
        rows = [UNSENT_ROW];
        return held('gcloud failed');
      },
    });
    const sheet = await openSheet();
    fill(sheet, { label: 'devcloud VMs', prefix: 'dc-' });
    fireEvent.click(createButton(sheet));
    await within(sheet).findByRole('alert');
    emit(signing(holding(), { delegations: { creating: false, rev: 1 } }));
    await within(sheet).findByRole('button', { name: 'Write the code again' });
    // the other window discards it: the slot is gone, and this run with it
    rows = [];
    emit(signing(ROOT, { delegations: { creating: false, rev: 2 } }));
    expect(await within(sheet).findByText('This create is no longer the one this Mac runs (a Discard, another create or a sign-out since): nothing more to do here.')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Write the code again' })).toBeNull();
    // ...then creates its own, held unsent and writable by its run: still nothing here acts on it
    rows = [{ ...UNSENT_ROW, id: ID2, prefix: 'dd-', unsent: { rewrite: true, writing: false, problem: 'gcloud failed', generation: 2 } }];
    emit(signing(holding(HASH2, ID2), { delegations: { creating: false, rev: 3 } }));
    await act(async () => {});
    await vi.waitFor(() => expect(within(screen.getByRole('group', { name: 'dd-', hidden: true })).getByText('unsent')).toBeTruthy());
    expect(within(sheet).getByText(/^This create is no longer the one this Mac runs/)).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Write the code again' })).toBeNull();
    expect(within(sheet).queryByText(/Discard it from its row/)).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Create…' })).toBeNull();
    expect(sent('org.delegation.rewrite')).toEqual([]);
  });

  it('a slot that names this run’s hash but the view lists under another run: no Write again for it', async () => {
    renderSection(signing(ROOT), {
      'org.provisioningSecret.get': () => DEST,
      'org.view': () => viewWith({ delegations: [{ ...UNSENT_ROW, unsent: { rewrite: true, writing: false, problem: null, generation: 2 } }] }),
      'org.delegation.create': () => held('gcloud failed'),
    });
    const sheet = await openSheet();
    fill(sheet, { label: 'devcloud VMs', prefix: 'dc-' });
    fireEvent.click(createButton(sheet));
    await within(sheet).findByRole('alert');
    emit(signing(holding(), { delegations: { creating: false, rev: 1 } }));
    expect(await within(sheet).findByText(/^This create is no longer the one this Mac runs/)).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Write the code again' })).toBeNull();
  });

  it('a Write again answered stale by main (its run replaced meanwhile) ends the recovery, saying so', async () => {
    renderSection(signing(ROOT), {
      'org.provisioningSecret.get': () => DEST,
      'org.view': () => viewWith({ delegations: [UNSENT_ROW] }),
      'org.delegation.create': () => held('gcloud failed'),
      'org.delegation.rewrite': () => refused('stale', 'that create is no longer the one this Mac runs (a Discard, a new create, a sign-out or a relaunch since): nothing was written'),
    });
    const sheet = await openSheet();
    fill(sheet, { label: 'devcloud VMs', prefix: 'dc-' });
    fireEvent.click(createButton(sheet));
    await within(sheet).findByRole('alert');
    emit(signing(holding(), { delegations: { creating: false, rev: 1 } }));
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Write the code again' }));
    await vi.waitFor(() => expect(sent('org.delegation.rewrite')).toEqual([{ generation: 1, id: ID, hash: HASH }]));
    expect(await within(sheet).findByText(/^This create is no longer the one this Mac runs/)).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Write the code again' })).toBeNull();
  });

  it('Create waits while a delegation is being created elsewhere, saying so; and while this Mac can’t sign it is withdrawn', async () => {
    renderSection(signing(ROOT), { 'org.provisioningSecret.get': () => DEST });
    const sheet = await openSheet();
    fill(sheet, { label: 'devcloud VMs', prefix: 'dc-' });
    emit(signing(ROOT, { delegations: { creating: true, rev: 1 } }));
    expect(await within(sheet).findByText('A delegation is being created, in this window or another: Create once it’s done.')).toBeTruthy();
    expect(createButton(sheet).disabled).toBe(true);
    emit(signing(ROOT, { delegations: { creating: false, rev: 2 } }));
    await vi.waitFor(() => expect(createButton(sheet).disabled).toBe(false));
    emit(signing({ root: false, maySign: false }));
    await vi.waitFor(() => expect(within(sheet).queryByRole('button', { name: 'Create…' })).toBeNull());
    expect(within(sheet).getByText('Only a root signs org changes.')).toBeTruthy();
  });

  it('an answer after its sign-in ended stays in the sheet, offers nothing, and reaches nothing of the page', async () => {
    const answer = deferred<DelegationResult>();
    renderSection(signing(ROOT), { 'org.provisioningSecret.get': () => DEST, 'org.delegation.create': () => answer.promise });
    const sheet = await openSheet();
    fill(sheet, { label: 'devcloud VMs', prefix: 'dc-' });
    fireEvent.click(createButton(sheet));
    await vi.waitFor(() => expect(sent('org.delegation.create')).toHaveLength(1));
    expect(within(sheet).getByText('Minting its key, then Touch ID signs the delegation, then its code is stored…')).toBeTruthy();
    expect((within(sheet).getByRole('button', { name: 'Creating…' }) as HTMLButtonElement).disabled).toBe(true);
    emit(signing(ROOT, { session: 'signed-out' }));
    emit(signing(ROOT)); // the same member and device signed in again: another sign-in
    expect(await within(sheet).findByText('The sign-in this sheet opened under ended. Close it to create again.')).toBeTruthy();
    await act(async () => answer.resolve(OK));
    expect(screen.getByRole('dialog', { name: 'Create a delegation' })).toBe(sheet); // not closed by it
    expect(within(sheet).getByText(/^Created delegation dc-\. Signed version 13\./)).toBeTruthy(); // said where it was asked
    expect(within(sheet).queryByRole('button', { name: 'Create…' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Write the code again' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(row('New delegation')).queryByText(/Created delegation/)).toBeNull();
  });

  it('an ended run’s late refusal, under a sign-in that ended, offers no Write the code again', async () => {
    const answer = deferred<DelegationResult>();
    let unsent = false;
    renderSection(signing(ROOT), {
      'org.provisioningSecret.get': () => DEST,
      'org.view': () => viewWith({ delegations: unsent ? [UNSENT_ROW] : [] }),
      'org.delegation.create': () => answer.promise,
    });
    const sheet = await openSheet();
    fill(sheet, { label: 'devcloud VMs', prefix: 'dc-' });
    fireEvent.click(createButton(sheet));
    await vi.waitFor(() => expect(sent('org.delegation.create')).toHaveLength(1));
    emit(signing(ROOT, { session: 'signed-out' }));
    unsent = true;
    emit(signing(holding(), { delegations: { creating: false, rev: 1 } })); // a later sign-in's view lists an unsent row that would offer a rewrite
    await act(async () => answer.resolve(held('gcloud failed')));
    await act(async () => {});
    expect(within(sheet).queryByRole('button', { name: 'Write the code again' })).toBeNull();
    expect(sent('org.delegation.rewrite')).toEqual([]);
  });

  it('a sheet closed while its create is out takes no answer, and the next sheet starts fresh', async () => {
    const answer = deferred<DelegationResult>();
    renderSection(signing(ROOT), { 'org.provisioningSecret.get': () => DEST, 'org.delegation.create': () => answer.promise });
    let sheet = await openSheet();
    fill(sheet, { label: 'devcloud VMs', prefix: 'dc-' });
    fireEvent.click(createButton(sheet));
    await vi.waitFor(() => expect(sent('org.delegation.create')).toHaveLength(1));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    sheet = await openSheet();
    await act(async () => answer.resolve(refused('busy', 'late')));
    expect(within(sheet).queryByRole('alert')).toBeNull();
    expect((within(sheet).getByRole('textbox', { name: 'Label' }) as HTMLInputElement).value).toBe('');
    expect(within(screen.getByRole('group', { name: 'New delegation', hidden: true })).queryByText(/late/)).toBeNull(); // the page behind the open sheet
  });

  // What this proves: an answer with an unexpected `code` property is refused at the boundary (main's strict output
  // schema admits none), and the sheet offers no copy and sends nothing holding it. It does not prove that the strings
  // an answer may carry (a `detail`) are free of the code: that is main's to keep, and delegations.test.ts's stderr-echo
  // regression proves it for a gcloud failure that printed the code.
  it('an answer with a code property is refused at the boundary, and the sheet offers no copy and sends nothing holding it', async () => {
    const clipboard = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboard }, configurable: true });
    let smuggle = true;
    renderSection(signing(ROOT), {
      'org.provisioningSecret.get': () => DEST,
      // main's strict output schema admits no `code` beside the result's own fields
      'org.delegation.create': () => (smuggle ? ({ ...OK, code: CODE } as unknown as DelegationResult) : OK),
    });
    const sheet = await openSheet();
    expect(within(sheet).queryByRole('button', { name: /copy/i })).toBeNull();
    fill(sheet, { label: 'devcloud VMs', prefix: 'dc-' });
    fireEvent.click(createButton(sheet));
    await vi.waitFor(() => expect(sent('org.delegation.create')).toHaveLength(1));
    await act(async () => {});
    expect(screen.getByRole('dialog', { name: 'Create a delegation' })).toBe(sheet); // refused: nothing landed as a success
    expect(document.body.innerHTML).not.toContain(CODE);
    smuggle = false;
    fireEvent.click(createButton(sheet));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.body.innerHTML).not.toContain('smns-provision-v2');
    expect(clipboard).not.toHaveBeenCalled();
    expect(JSON.stringify(sent('org.delegation.create'))).not.toContain('smns-provision');
  });
});
