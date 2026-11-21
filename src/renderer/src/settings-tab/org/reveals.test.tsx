// The word cut on the Org page (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M1; G147 to G196): a row is its
// label and its control at rest, its note opening in the row on pointing or keyboard focus and its description at all
// times, a line that states a condition (or that a consent keeps) standing; identifiers wait behind a disclosure chevron
// named by what it shows; a row's actions are one "…" menu named by what they act on; a fact sent to a tooltip has an
// owner the keyboard reaches; a non-signer reads one view-only line at the page's top; and every reveal works from the
// keyboard alone.
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { OrgView, ProvisioningSecret, ProvisioningSecretWrite } from '@shared/ipc/schema/org';
import { useMachines } from '../../stores/machines';
import { accessibleText } from '../../test-support/accessible-text';
import { ANA, ANA_MAC, BEN, DEVICE, FINGERPRINT, MINI, findFoot, ROOT, VIEW, found, grantsOf, group, renderSection, resetHarness, row, sent, signing, viewWith } from './test-support';

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(resetHarness);

const noteOpen = (of: HTMLElement) => of.querySelector('[data-row-note]')!.hasAttribute('data-open');
const tooltip = () => screen.getByRole('tooltip').textContent;
const notSigning = { root: false, maySign: false } as const;
const linked = (ref: MachineState['ref'], state: MachineState['state']): MachineState => ({ ref, name: 'ignored', local: false, state, since: '2026-10-28T11:00:00.000Z', generation: 1 });
// Keyboard alone: focus the stop before `owner`, then Tab lands on it.
async function tabTo(user: ReturnType<typeof userEvent.setup>, owner: HTMLElement) {
  const stops = [...document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((el) => el.closest('[hidden]') === null);
  act(() => stops[stops.indexOf(owner) - 1]!.focus());
  await user.tab();
  expect(document.activeElement).toBe(owner);
}

describe('a Mac in no org (G147 to G149, G153)', () => {
  it('reads “Not signed in” with Sign in…, which opens the pairing-code field, focused, its note open and its description', async () => {
    const user = userEvent.setup();
    renderSection({ state: 'none' });
    const org = await found('Org');
    expect(accessibleText(org)).toContain('Not signed in');
    expect(screen.queryByRole('group', { name: 'Pairing code' })).toBeNull();
    await user.click(within(org).getByRole('button', { name: 'Sign in…' }));
    const code = row('Pairing code');
    expect(document.activeElement).toBe(within(code).getByRole('textbox', { name: 'Pairing code' }));
    expect(noteOpen(code)).toBe(true);
    expect(screen.getByRole('group', { name: 'Pairing code', description: /^Get one from a device already in the org: / })).toBe(code);
    expect(within(org).queryByRole('button', { name: 'Sign in…' })).toBeNull(); // the field's own Sign in sends
  });

  it('draws the field without Sign in… while the sign-in’s refusal stands', async () => {
    renderSection({ state: 'none', refused: { code: 'expired', attempt: 'register' } });
    expect(within(await found('Pairing code')).getByRole('alert').textContent).toBe('The approval wasn’t given in time. Start again with a new code.');
    expect(within(row('Org')).queryByRole('button')).toBeNull();
  });

  it('a refusal that answers a sent code is brought into view under the field; one standing as the page draws is not', async () => {
    const user = userEvent.setup();
    const seen = vi.fn();
    const scroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = seen;
    try {
      // the Org section is Settings' last: sitting low, the field opens at the scroll area's edge and its answer under it
      renderSection({ state: 'none' }, { 'org.register': () => ({ ok: false, reason: { code: 'busy', detail: 'another attempt' } }) });
      await user.click(within(await found('Org')).getByRole('button', { name: 'Sign in…' }));
      await user.type(within(row('Pairing code')).getByRole('textbox', { name: 'Pairing code' }), 'QX7K-4MPL-92TD{Enter}');
      const refusal = await within(row('Pairing code')).findByRole('alert');
      expect(seen).toHaveBeenCalledWith({ block: 'nearest' });
      expect(seen.mock.contexts.at(-1)).toBe(refusal);
      resetHarness();
      seen.mockClear();
      renderSection({ state: 'none', refused: { code: 'expired', attempt: 'register' } });
      await within(await found('Pairing code')).findByRole('alert');
      expect(seen).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = scroll;
    }
  });

  it('the read is a quiet spinner named by its words, which are not drawn; a failed read keeps its words', async () => {
    renderSection({ state: 'none' }, { 'org.status': () => new Promise(() => {}) });
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(await screen.findByRole('progressbar', { name: 'Reading the org…' })).toBeTruthy();
    expect(accessibleText(document.body)).not.toContain('Reading the org…');

    resetHarness();
    renderSection({ state: 'none' }, { 'org.status': undefined }); // main answers no status: the read fails
    expect(await screen.findByText('Could not read the org · no answer for org.status')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('a registered Mac (G156, G160, G170, G180, G183)', () => {
  it('This Mac is its chevron and its “signs” chip; the chevron opens its device id and fingerprint, from the keyboard too', async () => {
    const user = userEvent.setup();
    renderSection(signing(ROOT));
    const mac = await found('This Mac');
    await within(await group('people')).findByRole('group', { name: 'Ana' });
    expect(accessibleText(mac)).not.toContain(DEVICE.slice(0, 8));
    expect(accessibleText(mac)).not.toContain(FINGERPRINT);
    expect(within(mac).getByText('signs')).toBeTruthy();
    const chevron = within(mac).getByRole('button', { name: 'Device id and fingerprint' });
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
    await tabTo(user, chevron);
    expect(tooltip()).toBe('Device id and fingerprint');
    await user.keyboard('{Enter}');
    expect(chevron.getAttribute('aria-expanded')).toBe('true');
    expect(accessibleText(mac)).toContain(DEVICE.slice(0, 8));
    expect(accessibleText(mac)).toContain(FINGERPRINT);
    expect(document.getElementById(chevron.getAttribute('aria-controls')!)).toBeTruthy();
    // a root that signs has no Signer row: the chip says it
    expect(screen.queryByRole('group', { name: 'Signer' })).toBeNull();
  });

  it('the Signer row stands for a Mac that is not a root, its compare-the-fingerprints line at rest, and for the weekly re-sign; no “signs” chip there', async () => {
    renderSection(signing({ maySign: false }));
    const signer = await found('Signer');
    expect(within(row('This Mac')).queryByText('signs')).toBeNull();
    expect(accessibleText(signer)).toContain(`Its confirmation names this Mac’s fingerprint, ${FINGERPRINT}. Compare the two before you confirm.`);

    resetHarness();
    renderSection(signing({ ...ROOT, due: true, ageDays: 8 }));
    expect(within(await found('Signer')).getByRole('button', { name: 'Re-sign now' })).toBeTruthy();
    expect(accessibleText(row('Signer'))).not.toContain('This Mac signs the org state.');
  });

  it('a device line reads its kind and marks; its id is the kind’s tooltip and description, reached by Tab', async () => {
    const user = userEvent.setup();
    renderSection(signing(ROOT));
    const ana = within(await group('people')).getByRole('group', { name: 'Ana' });
    expect(accessibleText(ana)).not.toContain(ANA_MAC.slice(0, 8));
    const kind = within(ana).getByText('Mac', { selector: '[tabindex="0"]' });
    expect(document.getElementById(kind.getAttribute('aria-describedby')!)!.textContent).toBe(ANA_MAC.slice(0, 8));
    await tabTo(user, kind);
    expect(tooltip()).toBe(ANA_MAC.slice(0, 8));
  });

  it('the Org group’s identifiers wait behind Details beside its heading; the org state and its consent line stay', async () => {
    const user = userEvent.setup();
    renderSection(signing(ROOT));
    const org = await group('org');
    await within(await group('machines')).findByRole('group', { name: 'mini' });
    expect(within(org).queryByRole('group', { name: 'Org' })).toBeNull();
    expect(within(org).queryByRole('group', { name: 'Roots' })).toBeNull();
    expect(within(org).queryByRole('group', { name: 'Recovery key' })).toBeNull();
    expect(accessibleText(org)).not.toContain('org-1f2e');
    const state = within(org).getByRole('group', { name: 'Org state' });
    expect(accessibleText(state)).toContain('Machines stop taking requests once the org state is 30 days old.'); // G182, consent
    const details = within(org).getByRole('button', { name: 'Details' });
    expect(screen.getByRole('heading', { level: 4, name: 'Org' }).contains(details)).toBe(false);
    await tabTo(user, details);
    await user.keyboard('{Enter}');
    expect(within(within(org).getByRole('group', { name: 'Org' })).getByText('org-1f2e')).toBeTruthy();
    expect(within(org).getByRole('group', { name: 'Roots' })).toBeTruthy();
    expect(within(within(org).getByRole('group', { name: 'Recovery key' })).getByText('recoveryKid00001')).toBeTruthy();
  });

  it('someone who may not sign reads one line at the top, “View only: <roots> sign(s) changes”, and no group says it again', async () => {
    renderSection(signing(notSigning));
    await within(await group('machines')).findByRole('group', { name: 'mini' });
    const top = screen.getByText('View only: owner@example.com signs changes');
    const you = screen.getByRole('heading', { level: 4, name: 'You' });
    expect(top.compareDocumentPosition(you) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const page = accessibleText(document.body);
    for (const said of ['Only a root signs org changes.', 'The roots are', 'This Mac can’t sign', 'An admin enrolls', 'An admin creates']) expect(page).not.toContain(said);
    expect(screen.queryByRole('button', { name: 'Enroll a machine…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New delegation…' })).toBeNull();
    expect(within(await group('org')).getByText('No delegations yet.')).toBeTruthy(); // nothing stands in its place here

    resetHarness();
    renderSection(signing(notSigning), { 'org.view': () => viewWith({ maySign: false, roots: [...VIEW.roots, { kid: 'anaKid', member: ANA, device: ANA_MAC }] }) });
    expect(await screen.findByText('View only: owner@example.com and ana@example.com sign changes')).toBeTruthy();

    resetHarness();
    renderSection(signing(ROOT));
    await group('people');
    expect(screen.queryByText(/^View only/)).toBeNull();
  });
});

describe('the rows’ “…” menus (G162, G163, G173)', () => {
  it('a person’s Make admin… / Change email… / Remove person… are one menu named for them; a device’s actions one named for it', async () => {
    const user = userEvent.setup();
    renderSection(signing(ROOT));
    const ana = within(await group('people')).getByRole('group', { name: 'Ana' });
    expect(within(ana).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Actions for Ana', `Actions for Mac ${ANA_MAC.slice(0, 8)}`]);
    await user.click(within(ana).getByRole('button', { name: 'Actions for Ana' }));
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Make member…', 'Change email…', 'Remove person…']);
    await user.click(screen.getByRole('menuitem', { name: 'Remove person…' }));
    expect(await screen.findByRole('dialog', { name: 'Remove ana@example.com?' })).toBeTruthy();
  });

  it('a device’s Make a root… / Remove device… sit in its menu, by the keyboard alone', async () => {
    const user = userEvent.setup();
    renderSection(signing(ROOT));
    const ana = within(await group('people')).getByRole('group', { name: 'Ana' });
    const trigger = within(ana).getByRole('button', { name: `Actions for Mac ${ANA_MAC.slice(0, 8)}` });
    await tabTo(user, trigger);
    expect(tooltip()).toBe(`Actions for Mac ${ANA_MAC.slice(0, 8)}`);
    await user.keyboard('{Enter}');
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Make a root…', 'Remove device…']);
  });

  it('this Mac’s own device offers no menu; yourself only Change email…; a later device of another is neither offered nor stated', async () => {
    const user = userEvent.setup();
    renderSection(signing(ROOT));
    const owner = within(await group('people')).getByRole('group', { name: 'Owner' });
    expect(within(owner).queryByRole('button', { name: `Actions for Mac ${DEVICE.slice(0, 8)}` })).toBeNull();
    await user.click(within(owner).getByRole('button', { name: 'Actions for Owner' }));
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Change email…']);
    const page = accessibleText(document.body);
    expect(page).not.toContain('Their next device');
    expect(page).not.toContain('They pair their next device');
  });

  it('a machine’s Grant… / Owners… / Re-enroll… / Drop… are one menu named for it', async () => {
    const user = userEvent.setup();
    renderSection(signing(ROOT), { 'org.view': () => viewWith({ machines: [{ ...VIEW.machines[0]!, mayGrant: true }] }) });
    const mini = await found('mini');
    await user.click(within(mini).getByRole('button', { name: 'Actions for mini' }));
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Grant…', 'Owners…', 'Re-enroll…', 'Drop…']);
    await user.click(screen.getByRole('menuitem', { name: 'Owners…' }));
    expect(await screen.findByRole('dialog', { name: 'Change mini’s owners' })).toBeTruthy();
  });
});

describe('a machine’s row (G171, G174 to G176, G178)', () => {
  it('Up is a green dot named and tipped “Up”, reached by Tab; any other state keeps its word', async () => {
    const user = userEvent.setup();
    renderSection(signing(ROOT));
    await found('mini');
    act(() => useMachines.getState().applyRoster([linked(MINI, 'up'), linked(VIEW.machines[1]!.ref as MachineState['ref'], 'down')]));
    const dot = within(row('mini')).getByRole('img', { name: 'Up' });
    expect(accessibleText(row('mini'))).not.toContain('Up');
    await tabTo(user, dot);
    expect(tooltip()).toBe('Up');
    expect(accessibleText(row('build-vm'))).toContain('Offline');
  });

  it('the key waits behind its chevron', async () => {
    const user = userEvent.setup();
    renderSection(signing(ROOT));
    const mini = await found('mini');
    expect(accessibleText(mini)).not.toContain('key miniKeyId0001');
    await user.click(within(mini).getByRole('button', { name: 'Key' }));
    expect(within(mini).getByText('key miniKeyId0001').className).toContain('font-mono');
    expect(within(mini).getByRole('button', { name: 'Key' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('a grant’s rights read in the page’s words; no line for a machine nobody was granted rights on; a certified one reads “Via delegation”', async () => {
    renderSection(signing(ROOT), {
      'org.view': () =>
        viewWith({
          machines: [
            VIEW.machines[0]!,
            VIEW.machines[1]!,
            { name: 'ci-vm-7', ref: 'CiVmRef0000000000007', owners: [ANA], keyId: 'ciKid', certified: true, delegation: 'dlg-ci', mayGrant: false } satisfies OrgView['machines'][number],
          ],
        }),
      'org.grants.view': (input: { ref: string }) => (input.ref === MINI ? grantsOf(MINI, { grants: [{ member: BEN, rights: ['spawn', 'shell', 'machine-admin'], version: 1, state: 'on-machine' }] }) : grantsOf(input.ref)),
    });
    const mini = await found('mini');
    expect(await within(mini).findByText('sessions, terminal and connectors')).toBeTruthy();
    await vi.waitFor(() => expect(sent('org.grants.view').length).toBeGreaterThanOrEqual(3));
    await act(async () => {});
    const page = accessibleText(document.body);
    expect(page).not.toContain('Only its owners have rights on it');
    expect(page).not.toContain('You hold no rights on it.');
    expect(within(row('ci-vm-7')).getByText('Via delegation dlg-ci')).toBeTruthy();
  });

  it('the Machines group ends with one Enroll a machine… button and no label', async () => {
    renderSection(signing(ROOT));
    const machines = await group('machines');
    expect(await within(machines).findByRole('button', { name: 'Enroll a machine…' })).toBeTruthy();
    expect(within(machines).queryByRole('group', { name: 'Enroll a machine' })).toBeNull();
  });
});

describe('Delegations (G187 to G189)', () => {
  it('no delegation yet: one New delegation… button and no empty line; the unset destination stays in view with no chevron', async () => {
    renderSection(signing(ROOT));
    const org = await group('org');
    expect(await within(org).findByRole('button', { name: 'New delegation…' })).toBeTruthy();
    expect(within(org).queryByRole('group', { name: 'New delegation' })).toBeNull();
    expect(accessibleText(org)).not.toContain('No delegations yet.');
    expect(await within(org).findByRole('textbox', { name: 'Project' })).toBeTruthy();
    expect(within(org).queryByRole('button', { name: 'Code destination' })).toBeNull();
  });

  it('a set destination waits behind the chevron beside the heading, its note in its row, open while focus is there', async () => {
    const user = userEvent.setup();
    renderSection(signing(ROOT), { 'org.provisioningSecret.get': () => ({ project: 'acme-prod-01', secret: 'desk-code', account: 'ops@example.com' }) });
    const org = await group('org');
    const chevron = await within(org).findByRole('button', { name: 'Code destination' });
    await vi.waitFor(() => expect(sent('org.provisioningSecret.get')).toHaveLength(1));
    await act(async () => {});
    expect(within(org).queryByRole('textbox', { name: 'Project' })).toBeNull();
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
    await tabTo(user, chevron);
    await user.keyboard('{Enter}');
    const destination = within(org).getByRole('group', { name: 'Code destination' });
    const project = within(destination).getByRole('textbox', { name: 'Project' }) as HTMLInputElement;
    expect(project.value).toBe('acme-prod-01');
    expect(document.activeElement).toBe(project);
    expect(noteOpen(destination)).toBe(true);
    act(() => chevron.focus());
    await vi.waitFor(() => expect(accessibleText(destination)).not.toContain('Secret Manager'));
    expect(within(org).getByRole('group', { name: 'Code destination', description: /^A new delegation’s provisioning code is stored there / })).toBe(destination);
  });
});

describe('the Org page’s notes (Settings’ rows, G13 to G15)', () => {
  it('a row with a note and nothing that takes the keyboard takes Tab itself, and its note opens on focus', async () => {
    const user = userEvent.setup();
    renderSection({ state: 'development', org: 'org-dev', member: 'dev-member', device: 'dev-device' });
    const development = await found('Development');
    expect(accessibleText(development)).not.toContain('MAWS_DEV_ORG');
    expect(development.getAttribute('tabindex')).toBe('0');
    await user.tab();
    expect(document.activeElement).toBe(development);
    expect(noteOpen(development)).toBe(true);
    expect(screen.getByRole('group', { name: 'Development', description: 'This session comes from MAWS_DEV_ORG.' })).toBe(development);
  });

  it('the fingerprint’s compare line stays at rest while the approval waits', async () => {
    renderSection({ state: 'registering', step: 'approval', org: 'org-1f2e', hub: 'https://hub.example.com', fingerprint: 'B7-4K-9Q-2M', expires: '2026-10-28T12:10:00.000Z' });
    expect(accessibleText(await found('Fingerprint'))).toContain('Compare it with the approving device, then approve there.');
  });

  it('the stray hub keys’ explanation waits in their row', async () => {
    renderSection(signing(ROOT), { 'org.view': () => viewWith({ strayKeys: [{ id: 'stray1', label: 'old create', prefix: 'dc-', created: '2026-10-20T12:00:00.000Z', expires: '2026-11-20T12:00:00.000Z', young: false }] }) });
    const stray = await found('Stray hub keys');
    expect(accessibleText(stray)).not.toContain('Hub keys that no delegation names');
    expect(screen.getByRole('group', { name: 'Stray hub keys', description: 'Hub keys that no delegation names, left by a create whose delegation was never signed.' })).toBe(stray);
  });
});


// Review fix round 1: what a fold or a menu must not lose, and the greyed New delegation…'s reason from the keyboard.
describe('the code destination across a fold (G188)', () => {
  const SET: ProvisioningSecret = { project: 'acme-prod-01', secret: 'desk-code', account: 'ops@example.com' };
  const NEXT: ProvisioningSecret = { ...SET, secret: 'desk-code-v2' };
  const destination = () => screen.getByRole('group', { name: 'Code destination', hidden: true });
  const field = (name: string) => within(destination()).getByRole('textbox', { name, hidden: true }) as HTMLInputElement;

  it('a fold and a reopen keep an edit in progress; the folded form is out of the accessibility tree and inert', async () => {
    const user = userEvent.setup();
    renderSection(signing(ROOT), { 'org.provisioningSecret.get': () => SET });
    const chevron = await within(await group('org')).findByRole('button', { name: 'Code destination' });
    await vi.waitFor(() => expect(field('Secret').value).toBe(SET.secret));
    await user.click(chevron);
    await user.clear(field('Secret'));
    await user.type(field('Secret'), 'half-typed');
    await user.click(chevron); // fold
    const body = destination().closest<HTMLElement>('[inert]')!;
    expect(body.hidden).toBe(true);
    expect(screen.queryByRole('group', { name: 'Code destination' })).toBeNull();
    await user.click(chevron); // reopen
    expect(field('Secret').value).toBe('half-typed');
  });

  it('a Save answered while folded lands: its line shows on reopening, and the destination is read again', async () => {
    const user = userEvent.setup();
    let reading: ProvisioningSecret = SET;
    let answer: (write: ProvisioningSecretWrite) => void = () => {};
    renderSection(signing(ROOT), {
      'org.provisioningSecret.get': () => reading,
      'org.provisioningSecret.set': (input: { value: ProvisioningSecret }) =>
        new Promise<ProvisioningSecretWrite>((resolve) => {
          answer = (write) => {
            reading = input.value;
            resolve(write);
          };
        }),
    });
    const chevron = await within(await group('org')).findByRole('button', { name: 'Code destination' });
    await vi.waitFor(() => expect(field('Secret').value).toBe(SET.secret));
    await user.click(chevron);
    fireEvent.change(field('Secret'), { target: { value: NEXT.secret } });
    await user.click(within(destination()).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(sent('org.provisioningSecret.set')).toEqual([{ value: NEXT }]));
    const reads = sent('org.provisioningSecret.get').length;
    await user.click(chevron); // fold while the write is out
    await act(async () => answer({ ok: true }));
    await vi.waitFor(() => expect(sent('org.provisioningSecret.get').length).toBe(reads + 1));
    await user.click(chevron);
    expect(within(destination()).getByText('Saved.')).toBeTruthy();
    await vi.waitFor(() => expect(field('Secret').value).toBe(NEXT.secret));
  });

  it('opened from its chevron by the keyboard, focus moves into the form, on its first field', async () => {
    const user = userEvent.setup();
    renderSection(signing(ROOT), { 'org.provisioningSecret.get': () => SET });
    const chevron = await within(await group('org')).findByRole('button', { name: 'Code destination' });
    await vi.waitFor(() => expect(field('Project').value).toBe(SET.project));
    act(() => chevron.focus());
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(field('Project'));
  });

  it('a Save refused while folded unfolds the form: the refusal and its retry are in view, the draft kept', async () => {
    const user = userEvent.setup();
    let answer: (write: ProvisioningSecretWrite) => void = () => {};
    renderSection(signing(ROOT), {
      'org.provisioningSecret.get': () => SET,
      'org.provisioningSecret.set': () =>
        new Promise<ProvisioningSecretWrite>((resolve) => {
          answer = resolve;
        }),
    });
    const chevron = await within(await group('org')).findByRole('button', { name: 'Code destination' });
    await vi.waitFor(() => expect(field('Secret').value).toBe(SET.secret));
    await user.click(chevron);
    fireEvent.change(field('Secret'), { target: { value: NEXT.secret } });
    await user.click(within(destination()).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(sent('org.provisioningSecret.set')).toEqual([{ value: NEXT }]));
    await user.click(chevron); // fold while the write is out
    await act(async () => answer({ ok: false, reason: 'io', detail: 'disk full' }));
    expect(chevron.getAttribute('aria-expanded')).toBe('true');
    const shown = screen.getByRole('group', { name: 'Code destination' });
    expect(accessibleText(shown)).toContain('Not saved · The destination couldn’t be written: Save again. · disk full');
    expect(field('Secret').value).toBe(NEXT.secret);
    expect(within(shown).getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);
  });

  it('opened from its chevron, the form is brought into view', async () => {
    const user = userEvent.setup();
    const seen = vi.fn();
    const scroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = seen;
    try {
      renderSection(signing(ROOT), { 'org.provisioningSecret.get': () => SET });
      const chevron = await within(await group('org')).findByRole('button', { name: 'Code destination' });
      await user.click(chevron);
      expect(seen).toHaveBeenCalledWith({ block: 'nearest' });
      expect(seen.mock.contexts[0]).toBe(document.getElementById(chevron.getAttribute('aria-controls')!));
    } finally {
      Element.prototype.scrollIntoView = scroll;
    }
  });
});

describe('New delegation… while it waits (G187)', () => {
  it('greyed, it takes Tab and says why on focus, its reason also at rest; Enter opens nothing', async () => {
    const user = userEvent.setup();
    renderSection(signing(ROOT)); // no destination set
    const foot = await findFoot('new-delegation');
    const create = await within(foot).findByRole('button', { name: 'New delegation…', description: 'Set the code destination below first.' });
    expect(create.getAttribute('aria-disabled')).toBe('true');
    expect(accessibleText(foot)).toContain('Set the code destination below first.');
    await tabTo(user, create);
    expect(tooltip()).toBe('Set the code destination below first.');
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog', { name: 'Create a delegation' })).toBeNull();
  });

  it('while the destination’s first read is out: a quiet spinner named for it; a failed read says so with Retry, which reads again', async () => {
    let read: () => void = () => {};
    renderSection(signing(ROOT), { 'org.provisioningSecret.get': () => new Promise((resolve) => (read = () => resolve(null))) });
    expect(await screen.findByRole('progressbar', { name: 'Reading the code destination…' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New delegation…' })).toBeNull();
    await act(async () => read());
    expect(await screen.findByRole('button', { name: 'New delegation…' })).toBeTruthy();

    // main answers no destination: the read fails, which is not a wait that goes on
    resetHarness();
    renderSection(signing(ROOT), { 'org.provisioningSecret.get': undefined });
    expect(await screen.findByText('The code destination couldn’t be read · no answer for org.provisioningSecret.get')).toBeTruthy();
    expect(screen.queryByRole('progressbar', { name: 'Reading the code destination…' })).toBeNull();
    const reads = sent('org.provisioningSecret.get').length;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(sent('org.provisioningSecret.get').length).toBe(reads + 1));
  });
});

describe('a sheet opened from a row’s menu gives the keyboard back to the menu (G162, G173)', () => {
  it('Tab to the menu, choose an action, Escape: focus is on the same “…” again; Cancel too', async () => {
    const user = userEvent.setup();
    renderSection(signing(ROOT));
    const ana = within(await group('people')).getByRole('group', { name: 'Ana' });
    const trigger = within(ana).getByRole('button', { name: 'Actions for Ana' });
    await tabTo(user, trigger);
    await user.keyboard('{Enter}');
    await screen.findByRole('menuitem', { name: 'Make member…' });
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}'); // Remove person…
    expect(await screen.findByRole('dialog', { name: 'Remove ana@example.com?' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove ana@example.com?' })).toBeNull());
    expect(document.activeElement).toBe(trigger);

    await user.keyboard('{Enter}');
    await screen.findByRole('menuitem', { name: 'Make member…' });
    await user.keyboard('{Enter}'); // Make member…
    const sheet = await screen.findByRole('dialog', { name: 'Make ana@example.com a member?' });
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Make ana@example.com a member?' })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
