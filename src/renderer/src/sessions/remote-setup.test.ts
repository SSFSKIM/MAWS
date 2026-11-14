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
import { act, renderHook } from '@testing-library/react';
import { checkTrust, forgetRemotePlaces, knownCheckouts, listFolders, readFolderPlaces, readMachines, registerFolder, setupErrorWords, SETUP_WORDS, suggestionsFor, useRemotePlaces } from './remote-setup';
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
  forgetRemotePlaces();
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

describe('a New chat in a project with no folder here (the project registry)', () => {
  const P = '5d8e1c72-4b3a-4f6e-8d9c-0a1b2c3d4e5f';
  // re-review, finding 1: the tab names the registry project, and every machine's place in it comes from the registry
  it('offers each machine its location of the registry project, the project kept, reading nothing of them', async () => {
    useSessions.setState({ registry: { ...EMPTY_REGISTRY, projects: [{ id: P, name: 'scrape', hub: true, renamable: true, locations: [location(OTHER_MACHINE, 'p-a', '/srv/a'), location(THIRD, 'p-b', '/srv/b', { state: 'replaced' })] }] } });
    const fake = fakeClient({});
    expect(await readMachines({ registry: P }, fake.client)).toEqual([
      { kind: 'ready', target: { machine: OTHER_MACHINE, name: 'mini', checkout: '/srv/a', key: null, label: 'scrape', registry: P } },
      { kind: 'ready', target: { machine: THIRD, name: 'vm', checkout: null, key: null } }, // replaced there: no place in it
    ]);
    expect(fake.invoked('session.projects.list')).toEqual([]);
    expect(knownCheckouts({ registry: P }).sort()).toEqual(['/srv/a', '/srv/b']);
  });

  // re-review, the minor: a project the registry identifies takes its own records, never another's that shares the label
  it('suggests the paths of the registry project’s own records alone, never those of another project sharing its label', () => {
    const OTHER_ID = '66666666-7777-4888-9999-aaaaaaaaaaaa';
    useSessions.setState({
      projects: new Map([
        [HERE, projectOn(TEST_MACHINE, 'here', '/Users/owner/app', { org: { ...org, smnsId: ID } })],
        [addressOf(TEST_MACHINE, 'fork' as ProjectId), projectOn(TEST_MACHINE, 'fork', '/Users/owner/app-fork', { org: { ...org, smnsId: OTHER_ID } })],
        [addressOf(THIRD, 'there' as ProjectId), projectOn(THIRD, 'there', '/home/vm/app', { org: { ...org, smnsId: ID } })],
      ]),
      registry: { ...EMPTY_REGISTRY, projects: [{ id: ID, name: 'app', hub: true, renamable: true, locations: [location(OTHER_MACHINE, 'p-app', '/Users/mini/app')] }] },
    });
    const paths = knownCheckouts(HERE);
    expect(paths.sort()).toEqual(['/Users/mini/app', '/Users/owner/app', '/home/vm/app']);
    expect(paths).not.toContain('/Users/owner/app-fork');
  });
});

describe('a machine’s places (the project chip on it)', () => {
  it('reads its home’s first page: an owner’s New project, and Don’t work in a project where its endpoint takes a chat in its home', async () => {
    useMachines.getState().applyRoster([machine(OTHER_MACHINE, 'mini', { capabilities: ['rl2.feeds', SPAWN_HOME_CAPABILITY] }), machine(THIRD, 'vm', { capabilities: ['rl2.feeds'] })]);
    const fake = fakeClient({ 'machine.folders.list': HOME_PAGE });
    expect(await readFolderPlaces(OTHER_MACHINE, 'mini', fake.client)).toEqual({ newProject: null, noProject: null, home: '/Users/mini', first: HOME_PAGE });
    expect(fake.invoked('machine.folders.list')).toEqual([{}]);
    // an endpoint that predates the home spawn: no chat in its home there
    expect((await readFolderPlaces(THIRD, 'vm', fake.client)).noProject).toBe(SPAWN_WORDS.noHome('vm'));
  });

  it('greys New project and Don’t work in a project with why for a member who isn’t its owner', async () => {
    useMachines.getState().applyRoster([machine(OTHER_MACHINE, 'mini', { capabilities: [SPAWN_HOME_CAPABILITY] })]);
    const fake = fakeClient({});
    const read = readFolderPlaces(OTHER_MACHINE, 'mini', fake.client);
    await vi.waitFor(() => expect(fake.pending('machine.folders.list')).toBe(1));
    await fake.fail('machine.folders.list', 'machine.folders.list: refused owners-only by machine mini', 'internal', { refusal: 'owners-only' });
    expect(await read).toEqual({ newProject: SETUP_WORDS.notOwner('mini'), noProject: SETUP_WORDS.homeNotOwner('mini'), home: null, first: null });
  });

  // The UX wave, U9 (O-39, A1; M5, "The chooser is a hook"): the chooser answers at once with what this window knows of
  // the machine's projects, and the machine's own answer replaces it; the folder read holds nothing back
  describe('useRemotePlaces', () => {
    const registered = (path: string) =>
      useSessions.setState({ registry: { ...EMPTY_REGISTRY, projects: [{ id: ID, name: 'app', hub: true, renamable: true, locations: [location(OTHER_MACHINE, 'pid-app', path), location(OTHER_MACHINE, 'pid-gone', '/Users/mini/gone', { state: 'missing' }), location(THIRD, 'pid-vm', '/home/vm/app')] }] } });

    it('opens with the registry’s projects on the machine, its list replacing them when it answers, without waiting for its folders', async () => {
      registered('/Users/mini/src/app');
      const fake = fakeClient({});
      const { result } = renderHook(() => useRemotePlaces(OTHER_MACHINE, 'mini', fake.client));
      expect(result.current.projects?.map((p) => p.directory)).toEqual(['/Users/mini/src/app']);
      expect(result.current.reading, 'something is known').toBeNull();
      expect(result.current.folders).toBeNull();
      await act(() => fake.reply('session.projects.list', { projects: [projectOn(OTHER_MACHINE, 'notes', '/Users/mini/notes'), projectOn(OTHER_MACHINE, 'old', '/Users/mini/old', { hidden: true })], revision: 2 }));
      expect(result.current.projects?.map((p) => p.directory)).toEqual(['/Users/mini/notes']);
      expect(result.current.folders, 'the folder read is still out').toBeNull();
      await act(() => fake.reply('machine.folders.list', HOME_PAGE));
      expect(result.current.folders).toEqual({ newProject: null, noProject: SPAWN_WORDS.noHome('mini'), home: '/Users/mini', first: HOME_PAGE });
    });

    it('says it reads only while nothing is known, and opened again in the run shows the last listing at once, refreshing behind it', async () => {
      const fake = fakeClient({});
      const first = renderHook(() => useRemotePlaces(OTHER_MACHINE, 'mini', fake.client));
      expect(first.result.current).toEqual({ projects: null, reading: SETUP_WORDS.reading('mini'), error: null, folders: null });
      await act(() => fake.reply('session.projects.list', { projects: [projectOn(OTHER_MACHINE, 'notes', '/Users/mini/notes')], revision: 1 }));
      expect(first.result.current.reading).toBeNull();
      first.unmount();
      const again = renderHook(() => useRemotePlaces(OTHER_MACHINE, 'mini', fake.client));
      expect(again.result.current.projects?.map((p) => p.directory), 'the last listing of this run').toEqual(['/Users/mini/notes']);
      expect(again.result.current.reading).toBeNull();
      expect(fake.pending('session.projects.list'), 'asked again behind it').toBe(1);
      await act(() => fake.reply('session.projects.list', { projects: [projectOn(OTHER_MACHINE, 'app', '/Users/mini/app')], revision: 2 }));
      expect(again.result.current.projects?.map((p) => p.directory)).toEqual(['/Users/mini/app']);
    });

    it('says projects it couldn’t read, keeping what it knew', async () => {
      registered('/Users/mini/src/app');
      const fake = fakeClient({});
      const { result } = renderHook(() => useRemotePlaces(OTHER_MACHINE, 'mini', fake.client));
      await act(() => fake.fail('session.projects.list', 'unreachable', 'host_unavailable'));
      expect(result.current.error).toBe(SETUP_WORDS.projectsUnread('mini'));
      expect(result.current.projects?.map((p) => p.directory)).toEqual(['/Users/mini/src/app']);
      forgetRemotePlaces();
      useSessions.setState({ registry: EMPTY_REGISTRY });
      const none = renderHook(() => useRemotePlaces(THIRD, 'vm', fake.client));
      await act(() => fake.fail('session.projects.list', 'unreachable', 'host_unavailable'));
      expect(none.result.current).toMatchObject({ projects: null, reading: null, error: SETUP_WORDS.projectsUnread('vm') });
    });
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
