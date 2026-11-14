// P5 O8 M4a and M4b: the Org page's Machines group (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, *Machines in
// M4a*, M4b's "At its end" and the renderer's "Proves"): each machine with its owners by name and whether it is up (the
// renderer's `useMachines` store, which `machines.changed` feeds through `connectShell`, not the view: a link drops with
// no new head). M4b: while this Mac may sign, Owners…, Re-enroll… and Drop… on each attended machine (no Drop for this
// Mac's own) and Enroll a machine…; Grant… where `mayGrant` says, whatever `maySign` says (Fork B); a certified
// machine's owners are its delegation's; each machine's rights from `org.grants.view`, read when its row opens and at
// `org.grants.changed`, never at each `org.changed`; a dropped machine's hub row left behind, with Retry.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { DropRetryResult, GrantsView, OrgView } from '@shared/ipc/schema/org';
import { useMachines } from '../../stores/machines';
import { TEST_MACHINE } from '../../../../../test/support/machine';
import { ANA, BEN, CAT, ME, MINI, ROOT, VIEW, VM, emit, emitGrants, found, grantsOf, group, renderSection, resetHarness, row, sent, signing, viewWith } from './test-support';

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(resetHarness);

const linked = (ref: MachineState['ref'], state: MachineState['state']): MachineState => ({ ref, name: 'ignored', local: false, state, since: '2026-10-28T11:00:00.000Z', generation: 1 });
// What `connectShell` does with each `machines.changed`: the whole list into the store.
const machinesChanged = (machines: MachineState[]) => act(() => useMachines.getState().applyRoster(machines));

type Machine = OrgView['machines'][number];
const machine = (patch: Partial<Machine> & Pick<Machine, 'name' | 'ref'>): Machine => ({ owners: [ME], keyId: `${patch.name}Kid`, certified: false, delegation: null, mayGrant: false, ...patch });
const THIS_MAC = machine({ name: 'this-mbp', ref: TEST_MACHINE });
const CI_VM = machine({ name: 'ci-vm-7', ref: 'CiVmRef0000000000007', owners: [ANA], certified: true, delegation: 'dlg-ci' });
const buttons = (label: string) => within(row(label)).queryAllByRole('button').map((b) => b.textContent);
const notSigning = { root: false, maySign: false } as const;

describe('Settings › Org: Machines (M4a)', () => {
  it('each machine draws its row: its name, its owners by name, the org’s named so, a former member so', async () => {
    renderSection(signing(ROOT), { 'org.view': () => viewWith({ machines: [...VIEW.machines, { name: 'old-box', ref: 'OldBoxRef00000000003', owners: ['ffffffffffffffffffffffffffffffff'], keyId: 'oldBoxKeyId03', certified: false, delegation: null, mayGrant: false }] }) });
    await group('machines');
    expect(within(await found('mini')).getByText('Owned by you and Ana')).toBeTruthy();
    expect(within(row('mini')).getByText('key miniKeyId0001').className).toContain('font-mono');
    expect(within(row('build-vm')).getByText('Owned by the org')).toBeTruthy();
    expect(within(row('old-box')).getByText('Owned by a former member')).toBeTruthy();
  });

  it('a machine’s up state follows machines.changed while the org version stays the same', async () => {
    renderSection(signing(ROOT));
    await found('mini');
    expect(within(row('mini')).getByText('Not connected')).toBeTruthy(); // the roster names it not yet
    const reads = sent('org.view').length;
    machinesChanged([linked(MINI, 'connecting'), linked(VM, 'up')]);
    expect(within(row('mini')).getByText('Connecting…')).toBeTruthy();
    expect(within(row('build-vm')).getByText('Up')).toBeTruthy();
    machinesChanged([linked(MINI, 'up'), linked(VM, 'down')]);
    expect(within(row('mini')).getByText('Up')).toBeTruthy();
    expect(within(row('build-vm')).getByText('Offline')).toBeTruthy();
    expect(sent('org.view')).toHaveLength(reads); // no new view: the version is the same
    expect(within(row('Org state')).getByText(/^Version 12 /)).toBeTruthy();

    // and a new head leaves the up state where the store has it
    emit(signing(ROOT, { head: { version: 13, issued: new Date().toISOString() } }));
    await vi.waitFor(() => expect(sent('org.view')).toHaveLength(reads + 1));
    expect(within(row('mini')).getByText('Up')).toBeTruthy();
  });

  it('no machine enrolled yet is said so', async () => {
    renderSection(signing(ROOT), { 'org.view': () => viewWith({ machines: [] }) });
    expect(within(await group('machines')).getByText('No machines are enrolled yet.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'mini' })).toBeNull();
  });
});

describe('Settings › Org: Machines’ actions and rights (M4b)', () => {
  it('while this Mac may sign: Owners…, Re-enroll… and Drop… on each attended machine, no Drop for this Mac’s own, none on a certified one, and Enroll a machine…', async () => {
    renderSection(signing(ROOT), { 'org.view': () => viewWith({ machines: [...VIEW.machines, THIS_MAC, CI_VM] }) });
    await found('ci-vm-7');
    expect(buttons('mini')).toEqual(['Owners…', 'Re-enroll…', 'Drop…']);
    expect(buttons('build-vm')).toEqual(['Owners…', 'Re-enroll…', 'Drop…']);
    expect(buttons('this-mbp')).toEqual(['Owners…', 'Re-enroll…']); // it leaves through `mawsd endpoint unenroll` on it
    expect(within(row('this-mbp')).getByText('this Mac')).toBeTruthy();
    expect(buttons('ci-vm-7')).toEqual([]);
    expect(within(row('ci-vm-7')).getByText('Owned by Ana')).toBeTruthy();
    expect(within(row('ci-vm-7')).getByText('Certified through delegation dlg-ci: its owners are the delegation’s, and change with it.')).toBeTruthy();
    expect(buttons('Enroll a machine')).toEqual(['Enroll a machine…']);
  });

  it('without maySign the org-state actions are read-only, and Enroll says why to an admin; Grant… follows mayGrant whatever maySign says', async () => {
    renderSection(signing(notSigning), { 'org.view': () => viewWith({ maySign: false, machines: [machine({ name: 'mini', ref: MINI, mayGrant: true }), machine({ name: 'build-vm', ref: VM, owners: 'org' })] }) });
    await found('build-vm');
    expect(buttons('mini')).toEqual(['Grant…']); // an owner who isn't a root grants on their own machine (Fork B)
    expect(buttons('build-vm')).toEqual([]);
    expect(buttons('Enroll a machine')).toEqual([]);
    expect(within(row('Enroll a machine')).getByText('This Mac can’t sign: enroll from an admin’s Mac that does.')).toBeTruthy();

    // a member who isn't an admin is told who enrolls
    resetHarness();
    renderSection(signing(notSigning), { 'org.view': () => viewWith({ maySign: false, members: VIEW.members.map((m) => (m.you ? { ...m, role: 'member' as const } : m)) }) });
    expect(within(await found('Enroll a machine')).getByText('An admin enrolls machines from their Org page.')).toBeTruthy();
  });

  it('a grant left sending across a restart reads that this Mac stopped, not that the machine refused it', async () => {
    renderSection(signing(ROOT), {
      'org.view': () => viewWith({ machines: [machine({ name: 'mini', ref: MINI, mayGrant: true })] }),
      'org.grants.view': (input: { ref: string }) => grantsOf(input.ref, { grants: [{ member: BEN, rights: ['spawn'], version: 3, state: 'refused', reason: 'outcome-unknown' }] }),
    });
    const mini = await found('mini');
    expect(await within(mini).findByText('This Mac stopped before mini’s answer came: sign again')).toBeTruthy();
    expect(within(mini).queryByText(/refused it/)).toBeNull();
    expect(within(mini).queryByText('outcome-unknown')).toBeNull(); // no machine's code to show beside it
    expect(within(mini).getByRole('button', { name: 'Sign again…' })).toBeTruthy();
  });

  it('each row lists who holds a grant and their rights, from org.grants.view read once when the row opens, again at its org.grants.changed, never at org.changed', async () => {
    let answer: GrantsView = grantsOf(MINI, {
      grants: [
        { member: BEN, rights: ['spawn', 'shell'], version: 3, state: 'on-machine' },
        { member: CAT, rights: ['machine-admin'], version: 2, state: 'pending' },
        { member: ANA, rights: ['spawn'], version: 5, state: 'refused', reason: 'not-newer' },
        { member: 'ffffffffffffffffffffffffffffffff', rights: [], version: 4, state: 'refused', reason: 'not-held' },
      ],
    });
    renderSection(signing(ROOT), {
      'org.view': () => viewWith({ machines: [machine({ name: 'mini', ref: MINI, mayGrant: true }), machine({ name: 'build-vm', ref: VM, owners: 'org' })] }),
      'org.grants.view': (input: { ref: string }) => (input.ref === MINI ? answer : grantsOf(input.ref)),
    });
    const mini = await found('mini');
    expect(await within(mini).findByText('spawn and shell')).toBeTruthy();
    const line = (name: string) => within(row('mini')).getByText(name).closest('[data-org-grant]') as HTMLElement;
    expect(within(line('Ben')).getByText('spawn and shell')).toBeTruthy();
    expect(within(line('Cat')).getByText('machine-admin')).toBeTruthy();
    expect(within(line('Cat')).getByText('Not yet on mini')).toBeTruthy();
    expect(within(line('Ana')).getByText('Another device changed this grant: sign again')).toBeTruthy();
    expect(within(line('Ana')).getByRole('button', { name: 'Sign again…' })).toBeTruthy();
    expect(within(line('a former member')).getByText('every right withdrawn')).toBeTruthy();
    expect(within(line('a former member')).getByText('mini refused it: it no longer holds the key this grant names. Sign again')).toBeTruthy();
    expect(within(line('a former member')).getByText('not-held')).toBeTruthy(); // the code, beside its line
    expect(within(row('build-vm')).getByText('Only its owners have rights on it, and they hold every one.')).toBeTruthy();
    expect(sent('org.grants.view')).toEqual([{ ref: MINI }, { ref: VM }]);

    // a new head reads the view again, never a machine's ledger
    emit(signing(ROOT, { head: { version: 13, issued: new Date().toISOString() } }));
    await vi.waitFor(() => expect(sent('org.view')).toHaveLength(2));
    expect(sent('org.grants.view')).toHaveLength(2);

    // mini's grants moved (a delivery's outcome): its row alone reads them again
    answer = grantsOf(MINI, { grants: [{ member: CAT, rights: ['machine-admin'], version: 2, state: 'on-machine' }] });
    emitGrants(MINI);
    await vi.waitFor(() => expect(within(row('mini')).queryByText('Not yet on mini')).toBeNull());
    expect(sent('org.grants.view')).toEqual([{ ref: MINI }, { ref: VM }, { ref: MINI }]);
    expect(within(row('mini')).queryByText('Ben')).toBeNull();
  });

  it('a machine that didn’t answer shows its rights as of its last answer, or as this Mac issued them; a member who isn’t its owner sees their own', async () => {
    renderSection(signing(ROOT), {
      'org.view': () => viewWith({ machines: [machine({ name: 'mini', ref: MINI }), machine({ name: 'build-vm', ref: VM, owners: [ANA] })] }),
      'org.grants.view': (input: { ref: string }) =>
        input.ref === MINI ? grantsOf(MINI, { live: false, asOf: '2026-10-28T09:30:00.000Z', grants: [{ member: BEN, rights: ['spawn'], version: 1, state: 'on-machine' }] }) : grantsOf(VM, { live: false, asOf: null }),
    });
    const mini = await found('mini');
    expect(await within(mini).findByText(/^mini didn’t answer: as of its last answer, /)).toBeTruthy();
    expect(within(row('build-vm')).getByText('build-vm hasn’t answered yet: as this Mac issued them')).toBeTruthy();
    expect(within(row('build-vm')).getByText('You hold no rights on it.')).toBeTruthy(); // Ana's machine: you see only your own entry
  });

  it('a damaged grants record says grants can’t be signed here, and nothing offers to sign one', async () => {
    renderSection(signing(ROOT), {
      'org.view': () => viewWith({ machines: [machine({ name: 'mini', ref: MINI, mayGrant: true })] }),
      'org.grants.view': (input: { ref: string }) => ({ ok: false, ref: input.ref, reason: 'damaged' }) satisfies GrantsView,
    });
    const mini = await found('mini');
    expect(await within(mini).findByText('Grants can’t be signed on this Mac: its record of the grants it issued is damaged. Sign them from another device of the machine’s owner.')).toBeTruthy();
    expect(buttons('mini')).toEqual(['Owners…', 'Re-enroll…', 'Drop…', 'Retry']); // Retry reads again; nothing signs
  });

  // U11a board 540: an enrollment's end on its row names who can act, or what to do next
  it('an enrollment that ended on a problem says it on its row, beside Show…: on the Enroll row for a new machine, on the machine’s row for a re-enrollment', async () => {
    const words = {
      'not-yours': 'Another admin started this enrollment, and the hub answers only to them. Ask them to finish it, or Start over to enroll the machine yourself.',
      'machine-names': 'That name is bound to another machine for the life of the org. Start over with a different name.',
    } as const;
    for (const [problem, line] of Object.entries(words) as [keyof typeof words, string][]) {
      for (const replace of [null, MINI]) {
        const enrolling = { generation: 3, name: replace === null ? 'gpu-box' : 'mini', replace, expires: '2026-10-28T13:00:00.000Z', candidate: null, problem };
        renderSection(signing(ROOT, { enrolling }));
        const at = await found(replace === null ? 'Enroll a machine' : 'mini');
        expect(within(at).getByText(line)).toBeTruthy();
        expect(within(at).getByRole('button', { name: 'Show…' })).toBeTruthy();
        resetHarness();
      }
    }
  });

  it('missing grants are counted on the row with Re-grant…; none is offered where this Mac may not grant', async () => {
    const missing = [
      { member: BEN, rights: ['spawn' as const], version: 3 },
      { member: CAT, rights: ['spawn' as const, 'shell' as const], version: 2 },
    ];
    renderSection(signing(ROOT), {
      'org.view': () => viewWith({ machines: [machine({ name: 'mini', ref: MINI, mayGrant: true }), machine({ name: 'build-vm', ref: VM })] }),
      'org.grants.view': (input: { ref: string }) => grantsOf(input.ref, { missing: input.ref === MINI ? missing : missing.slice(0, 1), digest: 'missing-digest' }),
    });
    expect(await within(await found('mini')).findByText('2 grants this Mac issued are missing on mini')).toBeTruthy();
    expect(within(row('mini')).getByRole('button', { name: 'Re-grant…' })).toBeTruthy();
    expect(within(row('build-vm')).getByText('1 grant this Mac issued is missing on build-vm')).toBeTruthy();
    expect(within(row('build-vm')).queryByRole('button', { name: 'Re-grant…' })).toBeNull();
  });

  it('a row’s read answered once its sign-in has ended draws nothing, and the next sign-in reads again', async () => {
    let release: (view: GrantsView) => void = () => {};
    let held = true;
    renderSection(signing(ROOT), {
      'org.view': () => viewWith({ machines: [machine({ name: 'mini', ref: MINI })] }),
      'org.grants.view': (input: { ref: string }) => (held ? new Promise<GrantsView>((resolve) => (release = resolve)) : grantsOf(input.ref, { grants: [{ member: CAT, rights: ['shell'], version: 1, state: 'on-machine' }] })),
    });
    await found('mini');
    await vi.waitFor(() => expect(sent('org.grants.view')).toHaveLength(1));
    emit(signing(ROOT, { session: 'signed-out' })); // the read is still out
    await act(async () => release(grantsOf(MINI, { grants: [{ member: BEN, rights: ['spawn'], version: 1, state: 'on-machine' }] })));
    expect(within(row('mini')).queryByText('Ben')).toBeNull();
    expect(sent('org.grants.view')).toHaveLength(1); // nothing is read while signed out

    held = false;
    emit(signing(ROOT));
    expect(await within(row('mini')).findByText('Cat')).toBeTruthy();
    expect(sent('org.grants.view')).toHaveLength(2);

    // signed out and in again as the same member and device: what the last sign-in read is gone until the new read lands
    held = true;
    emit(signing(ROOT, { session: 'signed-out' }));
    emit(signing(ROOT));
    await vi.waitFor(() => expect(sent('org.grants.view')).toHaveLength(3));
    expect(within(row('mini')).queryByText('Cat')).toBeNull();
    await act(async () => release(grantsOf(MINI, { grants: [{ member: BEN, rights: ['spawn'], version: 2, state: 'on-machine' }] })));
    expect(within(row('mini')).getByText('Ben')).toBeTruthy();
  });

  it('a dropped machine whose hub row is still listed reads “Signed. The hub still lists <name>: Retry”, and Retry sends the route alone', async () => {
    let answer: DropRetryResult = { ok: false, reason: 'hub', detail: 'the hub was not reached: offline' };
    renderSection(signing(ROOT, { hubRowsLeft: [{ name: 'old-render', ref: 'OldRenderRef00000009' }] }), { 'org.drop.retry': () => answer });
    const left = await found('old-render');
    expect(within(left).getByText('Signed. The hub still lists old-render:')).toBeTruthy();
    fireEvent.click(within(left).getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(sent('org.drop.retry')).toEqual([{ name: 'old-render' }]));
    expect((await within(left).findByRole('alert')).textContent).toBe('Not deleted · Couldn’t reach the hub. · the hub was not reached: offline');
    expect(sent('org.change')).toEqual([]); // Retry signs nothing

    answer = { ok: true };
    fireEvent.click(within(left).getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(sent('org.drop.retry')).toHaveLength(2));
    await vi.waitFor(() => expect(within(left).queryByRole('alert')).toBeNull());
    emit(signing(ROOT, { hubRowsLeft: [] })); // main's status drops the row
    expect(screen.queryByRole('group', { name: 'old-render' })).toBeNull();
  });
});
