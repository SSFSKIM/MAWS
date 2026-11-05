// "+ Session" on a machine with no checkout of the org project (P5 O7 M9, docs/doperpowers/plans/2026-10-28-p5-o7-remote-
// lane-b.md, "Remote setup"; §U's rows): which machines the menu offers and how (a checkout there, set it up there, or
// why not), the paths the project's other checkouts use, and the setup's three reads and act in words.
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
import { useSessions } from '../stores/sessions';
import { checkTrust, listFolders, readMachines, registerFolder, setupErrorWords, SETUP_WORDS, suggestionsFor } from './remote-setup';

const THIRD = 'ThirdMachineRef0000000' as MachineRef;
const KEY = 'repo:github.com/acme/app' as OrgKey;
const org = { key: KEY, name: 'app', source: 'remote' as const, smnsId: null };
const machine = (ref: MachineRef, name: string, over: Partial<MachineState> = {}): MachineState => ({ ref, name, local: false, state: 'up', since: '2026-10-31T10:00:00Z', generation: 1, carrier: 'relay', ...over });
const projectOn = (ref: MachineRef, id: string, directory: string, over: Partial<ProjectRecord> = {}): ProjectRecord => ({ ...project(id, 0), id: addressOf(ref, id as ProjectId), directory, org, ...over });
const HOME_PAGE = { entries: [{ name: 'Developer', path: '/Users/mini/Developer', protected: false }, { name: 'Documents', path: '/Users/mini/Documents', protected: true }], cursor: null };
const trustOf = (over: Partial<TrustState> = {}): TrustState => ({ directory: '/Users/mini/Developer/GitHub/app', trustKey: '/Users/mini/Developer/GitHub/app', keyKind: 'repo', configPath: '/Users/mini/.claude.json', trusted: false, source: null, isHome: false, found: [], ...over });

beforeEach(() => {
  useMachines.getState().applyRoster([{ ...machine(TEST_MACHINE, 'This Mac'), local: true, carrier: undefined }, machine(OTHER_MACHINE, 'mini'), machine(THIRD, 'vm', { carrier: 'direct' })]);
});
afterEach(() => {
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
  useSessions.setState({ projects: new Map() });
});

describe('the machines the menu offers for a project', () => {
  it('offers a machine with a checkout as before, one without it to set up there, and names what the other checkouts use', async () => {
    useSessions.setState({ projects: new Map([[addressOf(TEST_MACHINE, 'here' as ProjectId), projectOn(TEST_MACHINE, 'here', '/Users/owner/Developer/GitHub/app')]]) });
    const fake = fakeClient({
      'session.projects.list': (_input: unknown, on: MachineRef) => (on === THIRD ? { projects: [projectOn(THIRD, 'app', '/home/vm/src/app')], revision: 1 } : { projects: [], revision: 1 }),
      'machine.folders.list': HOME_PAGE,
    });
    const read = await readMachines(KEY, fake.client);
    expect(read.choices).toEqual([
      { kind: 'setup', machine: OTHER_MACHINE, name: 'mini', key: KEY, home: '/Users/mini', first: HOME_PAGE },
      { kind: 'ready', target: { machine: THIRD, name: 'vm', checkout: '/home/vm/src/app', key: KEY } },
    ]);
    expect(fake.invoked('machine.folders.list')).toEqual([{}]); // only of the machine without a checkout: the home's first page
    expect(fake.machines('machine.folders.list')).toEqual([OTHER_MACHINE]);
    expect(read.known.sort()).toEqual(['/Users/owner/Developer/GitHub/app', '/home/vm/src/app']);
  });

  // P5 O7 M4's rules, kept: only up RL2 machines are asked, a discovered project is no checkout, a failed read offers nothing
  it('asks only the up RL2 machines, takes no discovered project for a checkout, and leaves out a machine whose read fails', async () => {
    useMachines.getState().applyRoster([
      machine(OTHER_MACHINE, 'mini'),
      machine(THIRD, 'vm'),
      machine('DownMachineRef00000000' as MachineRef, 'away', { state: 'down' }),
      machine('SocketMachineRef000000' as MachineRef, 'profile-b', { carrier: 'socket' }),
    ]);
    const fake = fakeClient({ 'machine.folders.list': HOME_PAGE });
    const read = readMachines(KEY, fake.client);
    await vi.waitFor(() => expect(fake.pending('session.projects.list')).toBe(2));
    expect(fake.machines('session.projects.list').sort()).toEqual([OTHER_MACHINE, THIRD].sort());
    await fake.fail('session.projects.list', 'unreachable', 'host_unavailable');
    await fake.reply('session.projects.list', { projects: [projectOn(THIRD, 'app', '/srv/app', { discovered: true })], revision: 1 });
    expect((await read).choices).toEqual([{ kind: 'setup', machine: THIRD, name: 'vm', key: KEY, home: '/Users/mini', first: HOME_PAGE }]);
  });

  it('names why a machine it can’t set up isn’t offered: not one of its owners, or a machine that predates the setup', async () => {
    const fake = fakeClient({ 'session.projects.list': { projects: [], revision: 1 } });
    const read = readMachines(KEY, fake.client);
    await vi.waitFor(() => expect(fake.pending('machine.folders.list')).toBe(2));
    await fake.fail('machine.folders.list', 'machine.folders.list: refused owners-only by machine mini', 'internal', { refusal: 'owners-only' });
    await fake.fail('machine.folders.list', 'machine.folders.list: refused not-offered by machine vm', 'internal', { refusal: 'not-offered' });
    expect((await read).choices).toEqual([
      { kind: 'closed', machine: OTHER_MACHINE, name: 'mini', words: SETUP_WORDS.notOwner('mini') },
      { kind: 'closed', machine: THIRD, name: 'vm', words: SETUP_WORDS.notOffered('vm') },
    ]);
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
    await expect(registerFolder(OTHER_MACHINE, 'mini', '/Users/mini/Developer/GitHub/app/sub', fake.client)).resolves.toEqual({ ok: true, checkout: '/Users/mini/Developer/GitHub/app' });
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
