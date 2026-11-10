// "+ Session" on another machine (P5 O7 M9, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Remote setup";
// §U's rows; 2026-11-06, the machine first): which machines the menu offers and how (the local project's checkout there,
// no place yet, or why not), a machine's places (its projects, New project and its home, or why not), the paths the
// project's other checkouts use, and the setup's three reads and act in words.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectId } from '@shared/graph/ids';
import type { ProjectRecord } from '@shared/ipc/schema';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import type { OrgKey } from '@shared/machine/org-key';
import type { TrustState } from '@shared/sessions/trust';
import { project } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { useMachines } from '../stores/machines';
import { EMPTY_REGISTRY, type OrgProjectLocation } from '../stores/registry';
import { useSessions } from '../stores/sessions';
import { SPAWN_HOME_CAPABILITY } from '@shared/ipc/schema/session';
import { checkTrust, knownCheckouts, listFolders, readMachines, readPlaces, registerFolder, setupErrorWords, SETUP_WORDS, suggestionsFor } from './remote-setup';
import { SPAWN_WORDS } from './remote-spawn';

const THIRD = 'ThirdMachineRef0000000' as MachineRef;
const KEY = 'repo:github.com/acme/app' as OrgKey;
const org = { key: KEY, name: 'app', source: 'remote' as const, smnsId: null };
const machine = (ref: MachineRef, name: string, over: Partial<MachineState> = {}): MachineState => ({ ref, name, local: false, state: 'up', since: '2026-10-31T10:00:00Z', generation: 1, carrier: 'relay', ...over });
const projectOn = (ref: MachineRef, id: string, directory: string, over: Partial<ProjectRecord> = {}): ProjectRecord => ({ ...project(id, 0), id: addressOf(ref, id as ProjectId), directory, org, ...over });
// the tab's local project: its record's label is the org project the menu looks for on the other machines
const HERE = addressOf(TEST_MACHINE, 'here' as ProjectId);
const hereWith = (over: Partial<ProjectRecord> = {}) => useSessions.setState({ projects: new Map([[HERE, projectOn(TEST_MACHINE, 'here', '/Users/owner/Developer/GitHub/app', over)]]) });
const ID = '11111111-2222-4333-8444-555555555555';
const location = (ref: MachineRef, pid: string, path: string, over: Partial<OrgProjectLocation> = {}): OrgProjectLocation => ({ machine: ref, pid, path, key: KEY, name: 'app', source: 'remote', acts: true, ...over });
const HOME_PAGE = { entries: [{ name: 'Developer', path: '/Users/mini/Developer', protected: false }, { name: 'Documents', path: '/Users/mini/Documents', protected: true }], cursor: null };
const trustOf = (over: Partial<TrustState> = {}): TrustState => ({ directory: '/Users/mini/Developer/GitHub/app', trustKey: '/Users/mini/Developer/GitHub/app', keyKind: 'repo', configPath: '/Users/mini/.claude.json', trusted: false, source: null, isHome: false, found: [], ...over });

beforeEach(() => {
  useMachines.getState().applyRoster([{ ...machine(TEST_MACHINE, 'This Mac'), local: true, carrier: undefined }, machine(OTHER_MACHINE, 'mini'), machine(THIRD, 'vm', { carrier: 'direct' })]);
});
afterEach(() => {
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
  useSessions.setState({ projects: new Map(), registry: EMPTY_REGISTRY });
});

describe('the machines the menu offers', () => {
  // 2026-11-06 (the machine first): every up RL2 machine, project or none; the local project's checkout there taken when
  // the machine holds one, else no place yet (the project chip's to choose there)
  it('offers every up RL2 machine with no place yet when no project is chosen, reading nothing of them', async () => {
    const fake = fakeClient({});
    expect(await readMachines(null, fake.client)).toEqual([
      { kind: 'ready', target: { machine: OTHER_MACHINE, name: 'mini', checkout: null, key: null } },
      { kind: 'ready', target: { machine: THIRD, name: 'vm', checkout: null, key: null } },
    ]);
    expect(fake.invoked('session.projects.list')).toEqual([]);
  });

  it('takes the local project’s checkout on a machine that holds one, and no place on one that doesn’t or can’t be read', async () => {
    const fake = fakeClient({
      'session.projects.list': (_input: unknown, on: MachineRef) => (on === THIRD ? { projects: [projectOn(THIRD, 'app', '/home/vm/src/app')], revision: 1 } : { projects: [], revision: 1 }),
    });
    hereWith();
    expect(await readMachines(HERE, fake.client)).toEqual([
      { kind: 'ready', target: { machine: OTHER_MACHINE, name: 'mini', checkout: null, key: null } },
      { kind: 'ready', target: { machine: THIRD, name: 'vm', checkout: '/home/vm/src/app', key: KEY } },
    ]);
    const failing = fakeClient({});
    const read = readMachines(HERE, failing.client);
    await vi.waitFor(() => expect(failing.pending('session.projects.list')).toBe(2));
    await failing.fail('session.projects.list', 'unreachable', 'host_unavailable');
    await failing.reply('session.projects.list', { projects: [projectOn(THIRD, 'app', '/srv/app', { discovered: true })], revision: 1 }); // a discovered project is no checkout
    expect((await read).map((choice) => choice.kind === 'ready' && choice.target.checkout)).toEqual([null, null]);
  });

  it('asks only the up RL2 machines, and greys one where the member’s rights are known and hold no spawn', async () => {
    useMachines.getState().applyRoster([
      machine(OTHER_MACHINE, 'mini', { rights: ['shell'] }),
      machine(THIRD, 'vm', { rights: ['spawn'] }),
      machine('DownMachineRef00000000' as MachineRef, 'away', { state: 'down' }),
      machine('SocketMachineRef000000' as MachineRef, 'profile-b', { carrier: 'socket' }),
    ]);
    expect(await readMachines(null, fakeClient({}).client)).toEqual([
      { kind: 'closed', machine: OTHER_MACHINE, name: 'mini', words: SETUP_WORDS.noSpawn('mini') },
      { kind: 'ready', target: { machine: THIRD, name: 'vm', checkout: null, key: null } },
    ]);
  });

  // The project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §J; design §6): a project the
  // registry holds takes its location on each machine from its record, with no read over the link; a location missing
  // there is no place to start in.
  it('takes a registry project’s location on each machine from its record, reading nothing of them', async () => {
    useSessions.setState({
      projects: new Map([[HERE, projectOn(TEST_MACHINE, 'here', '/Users/owner/app', { org: { ...org, smnsId: ID } })]]),
      registry: { ...EMPTY_REGISTRY, projects: [{ id: ID, name: 'app', hub: true, renamable: true, locations: [location(TEST_MACHINE, 'here', '/Users/owner/app'), location(OTHER_MACHINE, 'p-2', '/Users/mini/app', { state: 'missing' }), location(THIRD, 'p-3', '/home/vm/app')] }] },
    });
    const fake = fakeClient({});
    expect(await readMachines(HERE, fake.client)).toEqual([
      { kind: 'ready', target: { machine: OTHER_MACHINE, name: 'mini', checkout: null, key: null } },
      { kind: 'ready', target: { machine: THIRD, name: 'vm', checkout: '/home/vm/app', key: KEY } },
    ]);
    expect(fake.invoked('session.projects.list')).toEqual([]);
    expect(knownCheckouts(HERE).sort()).toEqual(['/Users/mini/app', '/Users/owner/app', '/home/vm/app']);
  });

  // review 1, finding 2: two of this Mac's projects with one label and two ids: each tab's own project decides
  it('reads the registry project of the tab’s own project, not the first that shares its label', async () => {
    const OTHER_ID = '66666666-7777-4888-9999-aaaaaaaaaaaa';
    const SECOND = addressOf(TEST_MACHINE, 'second' as ProjectId);
    useSessions.setState({
      projects: new Map([
        [HERE, projectOn(TEST_MACHINE, 'here', '/Users/owner/app', { org: { ...org, smnsId: ID } })],
        [SECOND, projectOn(TEST_MACHINE, 'second', '/Users/owner/app-fork', { org: { ...org, smnsId: OTHER_ID } })],
      ]),
      registry: {
        ...EMPTY_REGISTRY,
        projects: [
          { id: ID, name: 'app', hub: true, renamable: true, locations: [location(OTHER_MACHINE, 'p-app', '/Users/mini/app')] },
          { id: OTHER_ID, name: 'app-fork', hub: true, renamable: true, locations: [location(THIRD, 'p-fork', '/home/vm/app-fork')] },
        ],
      },
    });
    expect(await readMachines(SECOND, fakeClient({}).client)).toEqual([
      { kind: 'ready', target: { machine: OTHER_MACHINE, name: 'mini', checkout: null, key: null } },
      { kind: 'ready', target: { machine: THIRD, name: 'vm', checkout: '/home/vm/app-fork', key: KEY } },
    ]);
    expect(knownCheckouts(SECOND)).toContain('/home/vm/app-fork');
    expect(knownCheckouts(SECOND)).not.toContain('/Users/mini/app');
  });
});

describe('a machine’s places (the project chip on it)', () => {
  it('reads its projects and its home’s first page: an owner’s New project, and Don’t work in a project where its endpoint takes a chat in its home', async () => {
    useMachines.getState().applyRoster([machine(OTHER_MACHINE, 'mini', { capabilities: ['rl2.feeds', SPAWN_HOME_CAPABILITY] }), machine(THIRD, 'vm', { capabilities: ['rl2.feeds'] })]);
    const fake = fakeClient({ 'session.projects.list': { projects: [projectOn(OTHER_MACHINE, 'app', '/Users/mini/app'), projectOn(OTHER_MACHINE, 'old', '/Users/mini/old', { hidden: true })], revision: 1 }, 'machine.folders.list': HOME_PAGE });
    expect(await readPlaces(OTHER_MACHINE, 'mini', fake.client)).toEqual({ projects: [projectOn(OTHER_MACHINE, 'app', '/Users/mini/app')], error: null, newProject: null, noProject: null, home: '/Users/mini', first: HOME_PAGE });
    expect(fake.invoked('machine.folders.list')).toEqual([{}]);
    // an endpoint that predates the home spawn: no chat in its home there
    expect((await readPlaces(THIRD, 'vm', fake.client)).noProject).toBe(SPAWN_WORDS.noHome('vm'));
  });

  it('greys New project and Don’t work in a project with why for a member who isn’t its owner, and says projects it couldn’t read', async () => {
    useMachines.getState().applyRoster([machine(OTHER_MACHINE, 'mini', { capabilities: [SPAWN_HOME_CAPABILITY] })]);
    const fake = fakeClient({});
    const read = readPlaces(OTHER_MACHINE, 'mini', fake.client);
    await vi.waitFor(() => expect(fake.pending('machine.folders.list')).toBe(1));
    await fake.fail('session.projects.list', 'unreachable', 'host_unavailable');
    await fake.fail('machine.folders.list', 'machine.folders.list: refused owners-only by machine mini', 'internal', { refusal: 'owners-only' });
    expect(await read).toEqual({ projects: null, error: SETUP_WORDS.projectsUnread('mini'), newProject: SETUP_WORDS.notOwner('mini'), noProject: SETUP_WORDS.homeNotOwner('mini'), home: null, first: null });
  });

  it('suggests the paths the local project’s other checkouts use, on every machine the store holds', () => {
    useSessions.setState({
      projects: new Map([
        [addressOf(TEST_MACHINE, 'here' as ProjectId), projectOn(TEST_MACHINE, 'here', '/Users/owner/Developer/GitHub/app')],
        [addressOf(THIRD, 'app' as ProjectId), projectOn(THIRD, 'app', '/home/vm/src/app')],
        [addressOf(THIRD, 'other' as ProjectId), projectOn(THIRD, 'other', '/home/vm/other', { org: undefined })],
      ]),
    });
    expect(knownCheckouts(addressOf(TEST_MACHINE, 'here' as ProjectId)).sort()).toEqual(['/Users/owner/Developer/GitHub/app', '/home/vm/src/app']);
    expect(knownCheckouts(null)).toEqual([]);
  });

  it('turns the other checkouts into the same paths under the machine’s home, each once, the home itself never', () => {
    expect(suggestionsFor(['/Users/owner/Developer/GitHub/app', '/home/vm/Developer/GitHub/app', '/Users/owner', '/srv/app', '/home/vm/src/app'], '/Users/mini')).toEqual([
      '/Users/mini/Developer/GitHub/app',
      '/Users/mini/src/app',
    ]);
    expect(suggestionsFor(['/Users/owner/app'], null)).toEqual([]);
  });
});

describe('the setup’s reads and its act', () => {
  it('lists a folder a page at a time, opening a private folder only when asked', async () => {
    const fake = fakeClient({ 'machine.folders.list': HOME_PAGE });
    await expect(listFolders(OTHER_MACHINE, 'mini', { path: '/Users/mini/Documents', open: true, cursor: 'b' }, fake.client)).resolves.toEqual({ ok: true, page: HOME_PAGE });
    await listFolders(OTHER_MACHINE, 'mini', { path: null }, fake.client);
    expect(fake.invoked('machine.folders.list')).toEqual([{ path: '/Users/mini/Documents', open: true, cursor: 'b' }, {}]);
    const refused = fakeClient();
    const listing = listFolders(OTHER_MACHINE, 'mini', { path: '/Users/mini/Documents/x' }, refused.client);
    await refused.fail('machine.folders.list', 'protected: ~/Documents: open it first', 'invalid_input');
    await expect(listing).resolves.toEqual({ ok: false, words: SETUP_WORDS.protected });
  });

  it('reads the folder’s trust on the machine, and registers it there, answering the project’s directory as the checkout', async () => {
    const fake = fakeClient({
      'session.trust.check': trustOf(),
      'session.projects.addFolder': { project: projectOn(OTHER_MACHINE, 'app', '/Users/mini/Developer/GitHub/app'), location: { kind: 'directory', path: '/Users/mini/Developer/GitHub/app/sub' } },
    });
    await expect(checkTrust(OTHER_MACHINE, 'mini', '/Users/mini/Developer/GitHub/app/sub', fake.client)).resolves.toEqual({ ok: true, trust: trustOf() });
    await expect(registerFolder(OTHER_MACHINE, 'mini', '/Users/mini/Developer/GitHub/app/sub', fake.client)).resolves.toEqual({ ok: true, checkout: '/Users/mini/Developer/GitHub/app', label: projectOn(OTHER_MACHINE, 'app', '/').name });
    expect(fake.invoked('session.trust.check')).toEqual([{ directory: '/Users/mini/Developer/GitHub/app/sub' }]);
    expect(fake.invoked('session.projects.addFolder')).toEqual([{ directory: '/Users/mini/Developer/GitHub/app/sub' }]);
    expect(fake.machines('session.projects.addFolder')).toEqual([OTHER_MACHINE]);
  });

  it('says each refusal in words a person can act on', () => {
    const refusal = (code: string) => ({ code: 'internal' as const, message: `refused ${code}`, issues: { refusal: code } });
    expect(setupErrorWords(refusal('owners-only'), 'mini')).toBe(SETUP_WORDS.notOwner('mini'));
    expect(setupErrorWords(refusal('not-offered'), 'mini')).toBe(SETUP_WORDS.notOffered('mini'));
    expect(setupErrorWords(refusal('no-folder'), 'mini')).toBe(SETUP_WORDS.noFolder('mini'));
    expect(setupErrorWords(refusal('outside-home'), 'mini')).toBe(SETUP_WORDS.outsideHome('mini'));
    expect(setupErrorWords(refusal('symlink-escape'), 'mini')).toBe(SETUP_WORDS.symlinkEscape('mini'));
    expect(setupErrorWords(refusal('protected'), 'mini')).toBe(SETUP_WORDS.protected);
    expect(setupErrorWords(refusal('step-up-cancelled'), 'mini')).toBe(SETUP_WORDS.cancelled);
    // a listing's refusal is forwarded as its message, the reason its first word
    expect(setupErrorWords({ code: 'invalid_input', message: 'outside-home: /etc: not under the home' }, 'mini')).toBe(SETUP_WORDS.outsideHome('mini'));
    expect(setupErrorWords({ code: 'host_unavailable', message: 'machine.folders.list: machine mini is not reachable' }, 'mini')).toBe('machine.folders.list: machine mini is not reachable');
  });
});
