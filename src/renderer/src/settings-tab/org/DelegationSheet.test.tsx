// P5 O8 M4c: the create sheet (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4c's *The create transaction*
// and *The destination*, and the renderer's "Proves"): a label, a prefix, a life in days and a use cap inside the
// provisioning bounds (checked here), and owners; where the code goes, and when devcloud uses it; then one
// `org.delegation.create`, whose one Touch ID is main's. Its outcomes each read in their own words with their next step:
// `secret-store` with what's missing, a mint disagreement, `busy`, a cancel, a write that leaves the delegation unsent
// (with "Write the code again"), and success with the code's version and its time. It never shows, copies or holds the
// code, and it takes no answer from a request it no longer owns: closed, or under a sign-in that has ended.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { DELEGATION_MAX_USES, DELEGATION_TTL_DAYS, type OrgDelegationRow, type ProvisioningSecret, type SignResult } from '@shared/ipc/schema/org';
import { ANA, ME, ROOT, emit, found, group, renderSection, resetHarness, row, sent, signing, viewWith } from './test-support';

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(resetHarness);

const DEST: ProvisioningSecret = { project: 'ytdownload-505811', secret: 'desk-provisioning-v2', account: 'cli-owner@ytdownload-505811.iam.gserviceaccount.com' };
const ID = '0123456789abcdef0123456789abcdef';
// What the code looks like, were it ever to reach the renderer (org-protocol's PROVISIONING_CODE_V2_PREFIX, then base64url).
const CODE = 'smns-provision-v2:eyJodWIiOiJodHRwczovL2Rlc2suZXhhbXBsZSIsInRva2VuIjoic2VjcmV0In0';
const OK: SignResult = { ok: true, version: 13, secret: { version: '7', createTime: '2026-10-28T12:00:05.000Z' } };
const UNSENT_ROW: OrgDelegationRow = {
  id: ID,
  prefix: 'dc-',
  owners: [ME],
  expires: '2027-01-26T12:00:00.000Z',
  maxUses: null,
  machines: [],
  hub: { expires: '2027-01-26T12:00:00.000Z', uses: 0, revoked: false },
  state: 'unsent',
  unsent: { rewrite: true, problem: 'gcloud secrets versions add failed: PERMISSION_DENIED' },
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
    expect(within(sheet).getByText('The code goes to ytdownload-505811/desk-provisioning-v2 as a new version. It is never shown here.')).toBeTruthy();
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
    const answers: { answer: SignResult; line: string }[] = [
      { answer: { ok: false, reason: 'secret-store', detail: 'secret-store: gcloud not found: nothing was minted or signed' }, line: 'Not created · Its code has nowhere to go yet, so nothing was minted or signed: fix what’s named, then Create again. · secret-store: gcloud not found: nothing was minted or signed' },
      {
        answer: { ok: false, reason: 'refused', detail: "the hub's answer to the mint disagrees with what was asked (prefix dc- not dd-): nothing was signed; its key was revoked" },
        line: "Not created · Refused, so nothing was signed: correct what’s named, then Create again. · the hub's answer to the mint disagrees with what was asked (prefix dc- not dd-): nothing was signed; its key was revoked",
      },
      { answer: { ok: false, reason: 'busy', detail: 'another org attempt is under way' }, line: 'Not created · Another create or org attempt is running: Create again once it’s done. · another org attempt is under way' },
      { answer: { ok: false, reason: 'cancelled', detail: 'nothing was signed; its key was revoked' }, line: 'Not created · Touch ID was cancelled, so nothing was signed: Create again when ready. · nothing was signed; its key was revoked' },
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
    }
    expect(screen.getByRole('dialog', { name: 'Create a delegation' })).toBe(sheet);
  });

  it('a write that leaves the delegation unsent: its reason, and Write the code again, whose success reaches the page', async () => {
    let unsent = false;
    renderSection(signing(ROOT), {
      'org.provisioningSecret.get': () => DEST,
      'org.view': () => viewWith({ delegations: unsent ? [UNSENT_ROW] : [] }),
      'org.delegation.create': () => {
        unsent = true;
        return { ok: false, reason: 'unsent', detail: 'gcloud secrets versions add failed: PERMISSION_DENIED' } satisfies SignResult;
      },
      'org.delegation.rewrite': () => OK,
    });
    const sheet = await openSheet();
    fill(sheet, { label: 'devcloud VMs', prefix: 'dc-' });
    fireEvent.click(createButton(sheet));
    expect((await within(sheet).findByRole('alert')).textContent).toBe('Not created · Signed, but its code isn’t stored, so it isn’t published: Write the code again. · gcloud secrets versions add failed: PERMISSION_DENIED');
    emit(signing(ROOT, { delegations: { creating: false, rev: 1 } })); // main's rev: the page reads the view, which lists it unsent
    const again = await within(sheet).findByRole('button', { name: 'Write the code again' });
    expect(within(sheet).queryByRole('button', { name: 'Create…' })).toBeNull(); // a delegation is signed: no second create
    fireEvent.click(again);
    await vi.waitFor(() => expect(sent('org.delegation.rewrite')).toEqual([{ id: ID }]));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(row('New delegation')).getByText(/^Created delegation dc-\. Signed version 13\. Its code is version 7, stored /)).toBeTruthy();
  });

  it('an unsent delegation this Mac can no longer write says to Discard it from its row', async () => {
    let unsent = false;
    renderSection(signing(ROOT), {
      'org.provisioningSecret.get': () => DEST,
      'org.view': () => viewWith({ delegations: unsent ? [{ ...UNSENT_ROW, unsent: { rewrite: false, problem: 'its code is stored (version 7), but the publish was refused: stale; only Discard' } }] : [] }),
      'org.delegation.create': () => {
        unsent = true;
        return { ok: false, reason: 'unsent', detail: 'its code is stored (version 7), but the publish was refused: stale; only Discard' } satisfies SignResult;
      },
    });
    const sheet = await openSheet();
    fill(sheet, { label: 'devcloud VMs', prefix: 'dc-' });
    fireEvent.click(createButton(sheet));
    await within(sheet).findByRole('alert');
    emit(signing(ROOT, { delegations: { creating: false, rev: 1 } }));
    expect(await within(sheet).findByText('This Mac can’t write it again: close this and Discard it from its row.')).toBeTruthy();
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
    const answer = deferred<SignResult>();
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
    const answer = deferred<SignResult>();
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
    emit(signing(ROOT, { delegations: { creating: false, rev: 1 } })); // a later sign-in's view lists an unsent row that would offer a rewrite
    await act(async () => answer.resolve({ ok: false, reason: 'unsent', detail: 'gcloud failed' }));
    await act(async () => {});
    expect(within(sheet).queryByRole('button', { name: 'Write the code again' })).toBeNull();
    expect(sent('org.delegation.rewrite')).toEqual([]);
  });

  it('a sheet closed while its create is out takes no answer, and the next sheet starts fresh', async () => {
    const answer = deferred<SignResult>();
    renderSection(signing(ROOT), { 'org.provisioningSecret.get': () => DEST, 'org.delegation.create': () => answer.promise });
    let sheet = await openSheet();
    fill(sheet, { label: 'devcloud VMs', prefix: 'dc-' });
    fireEvent.click(createButton(sheet));
    await vi.waitFor(() => expect(sent('org.delegation.create')).toHaveLength(1));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    sheet = await openSheet();
    await act(async () => answer.resolve({ ok: false, reason: 'busy', detail: 'late' }));
    expect(within(sheet).queryByRole('alert')).toBeNull();
    expect((within(sheet).getByRole('textbox', { name: 'Label' }) as HTMLInputElement).value).toBe('');
    expect(within(screen.getByRole('group', { name: 'New delegation', hidden: true })).queryByText(/late/)).toBeNull(); // the page behind the open sheet
  });

  it('the code never reaches the sheet: an answer carrying it is refused at the boundary, and nothing drawn, copied or sent holds it', async () => {
    const clipboard = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboard }, configurable: true });
    let smuggle = true;
    renderSection(signing(ROOT), {
      'org.provisioningSecret.get': () => DEST,
      // main's strict output schema is SignResult's: a code beside it, or in its detail's place, is no SignResult
      'org.delegation.create': () => (smuggle ? ({ ...OK, code: CODE } as unknown as SignResult) : OK),
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
