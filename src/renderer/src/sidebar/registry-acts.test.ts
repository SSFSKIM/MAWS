import { describe, expect, it } from 'vitest';
import type { ProjectId } from '@shared/graph/ids';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { fakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { addInput, machineChoices, pickedMachine } from './AddProjectSheet';
import { actWords, addFolder, cancelRemoval, removeLocation, servesProjectActs } from './registry-acts';

// The project registry's acts from the page (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §G, §I, §J.3).
const MINI = 'MiniMachineRef00000000' as MachineRef;
const SINCE = '2026-11-10T09:00:00.000Z';
const machine = (ref: MachineRef, name: string, over: Partial<MachineState> = {}): MachineState => ({ ref, name, local: false, state: 'up', since: SINCE, generation: 1, carrier: 'direct', capabilities: ['rl2.project-acts'], ...over });
const ADDRESS = addressOf(OTHER_MACHINE, 'p-1' as ProjectId);

describe('a project act’s refusal in words', () => {
  it('says what to update, and who may act, naming the machine', () => {
    expect(actWords({ code: 'internal', message: 'statements-unavailable: sminos-too-old: no locations here' }, 'mini')).toBe('Update sminos on mini to add this folder to a project.');
    expect(actWords({ code: 'internal', message: 'refused', issues: { refusal: 'not-offered' } }, 'mini')).toBe('Update MAWS on mini to add this folder to a project.');
    expect(actWords({ code: 'internal', message: 'refused', issues: { refusal: 'owners-only' } }, 'mini')).toBe('Only mini’s owners can change its projects');
    expect(actWords({ code: 'internal', message: 'refused', issues: { refusal: 'step-up-cancelled' } }, 'mini')).toBe('Not set up: the confirmation was cancelled'); // the setup's words
    expect(actWords({ code: 'internal', message: 'machine mini is not reachable' }, 'mini')).toBe('machine mini is not reachable');
  });

  it('takes a machine to serve the acts when it is this Mac or its link listed the capability', () => {
    expect(servesProjectActs(machine(TEST_MACHINE, 'This Mac', { local: true, capabilities: undefined }))).toBe(true); // not known yet: main decides at the act
    // panel scalpel-3#2: this Mac's daemon of a build that predates them, as main read its welcome
    expect(servesProjectActs(machine(TEST_MACHINE, 'This Mac', { local: true, capabilities: [] }))).toBe(false);
    expect(servesProjectActs(machine(TEST_MACHINE, 'This Mac', { local: true }))).toBe(true);
    expect(servesProjectActs(machine(OTHER_MACHINE, 'studio'))).toBe(true);
    expect(servesProjectActs(machine(OTHER_MACHINE, 'studio', { capabilities: [] }))).toBe(false);
    expect(servesProjectActs(machine(OTHER_MACHINE, 'studio', { capabilities: undefined }))).toBe(false);
    expect(servesProjectActs(undefined)).toBe(false);
  });
});

describe('the acts’ commands', () => {
  it('removes a location on its machine while it is up, and asks main to hold the removal while it is off', async () => {
    const fake = fakeClient({ 'session.projects.remove': {}, 'org.removals.hold': { id: 'r1' } });
    expect(await removeLocation({ address: ADDRESS, machine: OTHER_MACHINE, pid: 'p-1', up: true }, 'studio', fake.client)).toEqual({ ok: true });
    expect(fake.invoked('session.projects.remove')).toEqual([{ id: ADDRESS }]);
    expect(await removeLocation({ address: ADDRESS, machine: OTHER_MACHINE, pid: 'p-1', up: false }, 'studio', fake.client)).toEqual({ ok: true });
    expect(fake.invoked('org.removals.hold')).toEqual([{ machine: OTHER_MACHINE, pid: 'p-1' }]);
  });

  it('adds a folder on the machine chosen, and says a refusal in the registry’s words', async () => {
    const fake = fakeClient();
    const added = addFolder(MINI, 'mini', { directory: '/srv/scrape', into: 'project-1' }, fake.client);
    await fake.fail('session.projects.addFolder', 'statements-unavailable: sminos-too-old: no locations here');
    expect(await added).toEqual({ ok: false, words: 'Update sminos on mini to add this folder to a project.' });
    expect(fake.invoked('session.projects.addFolder')).toEqual([{ directory: '/srv/scrape', into: 'project-1' }]);
    expect(fake.machines('session.projects.addFolder')).toEqual([MINI]);
  });

  it('cancels a held removal by its id', async () => {
    const fake = fakeClient({ 'org.removals.cancel': {} });
    expect(await cancelRemoval('r1', fake.client)).toEqual({ ok: true });
    expect(fake.invoked('org.removals.cancel')).toEqual([{ id: 'r1' }]);
  });
});

describe('Add project’s machines and input', () => {
  it('offers this Mac first, then every other machine up over RL2 by name, one whose rights hold no machine-admin closed with why', () => {
    const machines = new Map<MachineRef, MachineState>([
      [TEST_MACHINE, machine(TEST_MACHINE, 'macbook', { local: true })],
      [OTHER_MACHINE, machine(OTHER_MACHINE, 'studio', { rights: ['spawn'] })],
      [MINI, machine(MINI, 'mini', { capabilities: [] })],
      ['DownMachineRef00000000' as MachineRef, machine('DownMachineRef00000000' as MachineRef, 'down', { state: 'down' })],
      ['SockMachineRef00000000' as MachineRef, machine('SockMachineRef00000000' as MachineRef, 'socket', { carrier: 'socket' })],
    ]);
    expect(machineChoices(machines, TEST_MACHINE)).toEqual([
      { ref: TEST_MACHINE, name: 'This Mac', local: true, serves: true, closed: null },
      { ref: MINI, name: 'mini', local: false, serves: false, closed: null },
      { ref: OTHER_MACHINE, name: 'studio', local: false, serves: true, closed: 'Only studio’s owners can change its projects' },
    ]);
  });

  // panel scalpel-3#2: this Mac is negotiated as another machine is, so a daemon that predates the acts gets a plain add
  it('offers this Mac a plain add alone when its daemon does not serve the acts', () => {
    const older = new Map([[TEST_MACHINE, machine(TEST_MACHINE, 'macbook', { local: true, capabilities: [] })]]);
    expect(machineChoices(older, TEST_MACHINE)).toEqual([{ ref: TEST_MACHINE, name: 'This Mac', local: true, serves: false, closed: null }]);
    expect(machineChoices(new Map(), TEST_MACHINE)[0]?.serves, 'before the machines are listed: main decides at the act').toBe(true);
  });

  it('keeps the machine chosen once it is no longer offered, closed with why, never another in its place', () => {
    const choices = machineChoices(new Map([[TEST_MACHINE, machine(TEST_MACHINE, 'macbook', { local: true })]]), TEST_MACHINE);
    expect(pickedMachine(choices, MINI, 'mini')).toEqual({ ref: MINI, name: 'mini', local: false, serves: false, closed: 'mini isn’t reachable now; choose another machine' });
    expect(pickedMachine(choices, TEST_MACHINE, 'macbook')).toBe(choices[0]);
  });

  it('sends the chosen project, else a separate project where asked, and nothing more to a machine that predates them', () => {
    expect(addInput('/srv/a', { serves: true, project: 'p', own: true })).toEqual({ directory: '/srv/a', into: 'p' });
    expect(addInput('/srv/a', { serves: true, project: null, own: true })).toEqual({ directory: '/srv/a', own: true });
    expect(addInput('/srv/a', { serves: true, project: null, own: false })).toEqual({ directory: '/srv/a' });
    expect(addInput('/srv/a', { serves: false, project: 'p', own: true })).toEqual({ directory: '/srv/a' });
  });
});
