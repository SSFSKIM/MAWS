import { describe, expect, it } from 'vitest';
import { formatDayTime } from '@shared/app/date-format';
import type { OrgKey } from '@shared/machine/org-key';
import type { MachineRef } from '@shared/machine/ref';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { EMPTY_REGISTRY, type OrgProjectLocation, type OrgProjects, type RegistryProject } from '../stores/registry';
import type { MachineState } from '@shared/ipc/schema/machines'; // the UX wave, U9
import { locationView } from './location-view'; // the UX wave, U9
import { defaultLinkOf, insideOf, intoChoices, locationLines, locationState, machinesWords, pendingWords, suggestionOf, type LocationView, type Resolved } from './locations';

// The project registry's words on the page (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §J.3).
const ID = '11111111-2222-4333-8444-555555555555';
const OTHER_ID = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const MINI = 'MiniMachineRef00000000' as MachineRef;
const DOWN_SINCE = '2026-11-09T18:30:00.000Z';
const SEEN = '2026-11-09T20:15:00.000Z';
const NAMES: Record<string, string> = { [TEST_MACHINE]: 'This Mac', [OTHER_MACHINE]: 'studio', [MINI]: 'mini' };
const view = (up: MachineRef[] = [TEST_MACHINE, OTHER_MACHINE], seen: OrgProjects['seen'] = {}): LocationView => ({
  machine: (ref) => ({ name: NAMES[ref] ?? ref, local: ref === TEST_MACHINE, up: up.includes(ref), since: ref === MINI ? DOWN_SINCE : null }),
  seen,
});
const location = (machine: MachineRef, pid: string, over: Partial<OrgProjectLocation> = {}): OrgProjectLocation => ({
  machine, pid, path: `/srv/${pid}`, key: `folder:${machine}:${pid}` as OrgKey, name: pid, source: 'folder', acts: true, ...over,
});
const registered = (id: string, name: string, locations: OrgProjectLocation[], hub = true): RegistryProject => ({ id, name, hub, renamable: true, locations });
const registryOf = (...projects: RegistryProject[]): OrgProjects => ({ ...EMPTY_REGISTRY, projects });

describe('a location’s state in words', () => {
  it('says offline for a machine that is off, and in the card since it was last seen: main’s seen, else the roster’s', () => {
    const off = view([TEST_MACHINE]);
    expect(locationState(location(MINI, 'p', { state: 'missing' }), off)).toEqual({ kind: 'offline', words: 'offline', card: `offline since ${formatDayTime(Date.parse(DOWN_SINCE))}` });
    expect(locationState(location(MINI, 'p'), view([TEST_MACHINE], { [MINI]: SEEN }))).toMatchObject({ card: `offline since ${formatDayTime(Date.parse(SEEN))}` });
    expect(locationState(location(OTHER_MACHINE, 'p'), off)).toEqual({ kind: 'offline', words: 'offline', card: 'offline' }); // never seen
  });

  // The UX wave, U9 (O-39, A2): the card (ProjectLocations.tsx's `data-location-words`) reads the link's phase as the rows
  // do (`locationView`): a machine that connects, or reconnects within the minute, is not offline; offline past the
  // minute or after a first attempt that failed, and removed, it is. Only the words follow the phase: the link not up,
  // the line is not `up`, so it suggests nothing and its acts stay closed (`acts = location.acts && line.up`).
  it('says offline in the card only when offline or removed, not while the machine connects or reconnects, its acts closed while the link is down', () => {
    const NOW = Date.parse('2026-11-13T09:00:00.000Z');
    const recently = new Date(NOW - 30_000).toISOString();
    const smns = location(MINI, 'p', { stated: 'linked', source: 'smns', key: `smns:${OTHER_ID}` as OrgKey });
    const project = registered(ID, 'scrape', [smns]);
    const registry = registryOf(project, registered(OTHER_ID, 'other', []));
    const roster = (over: Partial<MachineState>) =>
      new Map<MachineRef, MachineState>([[MINI, { ref: MINI, name: 'mini', local: false, state: 'up', since: DOWN_SINCE, generation: 1, ...over }]]);
    const lineAt = (over: Partial<MachineState>, now = NOW) => locationLines(project, registry, locationView(roster(over), {}, TEST_MACHINE, now))[0]!;
    const closed = { up: false, suggestion: null };
    expect(lineAt({ state: 'connecting', generation: 0 }), 'connecting').toMatchObject({ ...closed, state: null });
    expect(lineAt({ state: 'down', since: recently }), 'reconnecting').toMatchObject({ ...closed, state: null });
    expect(lineAt({ state: 'down', since: recently }, NOW + 30_000), 'offline past the minute').toMatchObject({ ...closed, state: { kind: 'offline', card: `offline since ${formatDayTime(Date.parse(recently))}` } });
    expect(lineAt({ state: 'down', generation: 0 }), 'offline after a first attempt that failed').toMatchObject({ ...closed, state: { kind: 'offline', words: 'offline', card: `offline since ${formatDayTime(Date.parse(DOWN_SINCE))}` } });
    expect(lineAt({ state: 'down', since: recently, refusal: 'removed' }), 'removed').toMatchObject({ ...closed, state: { kind: 'offline' } });
    expect(lineAt({}), 'up: its acts open again').toMatchObject({ up: true, state: null });
  });

  it('says a missing folder on its machine, a replaced one, and nothing for one that is there', () => {
    expect(locationState(location(OTHER_MACHINE, 'p', { state: 'missing' }), view())).toEqual({ kind: 'missing', words: 'folder not found on studio' });
    expect(locationState(location(OTHER_MACHINE, 'p', { state: 'replaced' }), view())).toEqual({ kind: 'replaced', words: 'replaced: another folder is at this path' });
    expect(locationState(location(OTHER_MACHINE, 'p'), view())).toBeNull();
  });

  it('names a row’s machines joined by a middle dot, one that is off said offline, and none where they are this Mac’s alone', () => {
    expect(machinesWords([TEST_MACHINE, OTHER_MACHINE, MINI], view())).toBe('This Mac · studio · mini offline');
    expect(machinesWords([OTHER_MACHINE, MINI], view([TEST_MACHINE, OTHER_MACHINE, MINI]))).toBe('studio · mini');
    expect(machinesWords([TEST_MACHINE], view())).toBeNull();
  });

  it('says a held removal waits for its machine', () => {
    expect(pendingWords({ id: 'r1', project: ID, machine: MINI, pid: 'p', path: '/srv/p', askedAt: SEEN }, view())).toBe('removal pending until mini is back');
  });

  it('lists this Mac’s locations first, each with its machine’s name, and suggests nothing on a machine that is off', () => {
    const smns = location(MINI, 'q', { stated: 'linked', source: 'smns', key: `smns:${OTHER_ID}` as OrgKey });
    const project = registered(ID, 'scrape', [location(OTHER_MACHINE, 'a'), location(TEST_MACHINE, 'b'), smns]);
    const lines = locationLines(project, registryOf(project, registered(OTHER_ID, 'other', [])), view());
    expect(lines.map((l) => [l.machine, l.location.pid])).toEqual([['This Mac', 'b'], ['studio', 'a'], ['mini', 'q']]);
    expect(lines[2]).toMatchObject({ up: false, suggestion: null, state: { kind: 'offline' } });
  });
});

describe('a suggestion against a stored statement', () => {
  const remote = 'example.org/scrape';
  // the project the remote derives (`remoteProject`, main's uuid5), its clone decided by the remote itself
  const repository = registered(OTHER_ID, 'scrape-repo', [location(OTHER_MACHINE, 'clone', { source: 'remote', key: `remote:${remote}` as OrgKey, remote, remoteProject: OTHER_ID })]);

  it('offers to follow a .smns that names another project, with that project’s name', () => {
    const follows = location(OTHER_MACHINE, 'app', { stated: 'linked', source: 'smns', key: `smns:${OTHER_ID}` as OrgKey, path: '/srv/app' });
    const project = registered(ID, 'scrape', [follows]);
    expect(suggestionOf(follows, project, registryOf(project, repository), 'studio')).toEqual({ words: 'app on studio has a .smns that names scrape-repo.', button: 'Follow the file', into: OTHER_ID });
    // the file naming the project's own id, or no statement stored: nothing to follow
    expect(suggestionOf({ ...follows, key: `smns:${ID}` as OrgKey }, project, registryOf(project), 'studio')).toBeNull();
    expect(suggestionOf({ ...follows, stated: undefined }, project, registryOf(project), 'studio')).toBeNull();
  });

  it('offers to link a minted clone to the project its remote decides, and nothing for a replaced location or where the member may not act', () => {
    const minted = location(TEST_MACHINE, 'fork', { stated: 'minted', source: 'remote', key: `remote:${remote}` as OrgKey, remote, remoteProject: OTHER_ID, path: '/Users/me/fork' });
    const project = registered(ID, 'fork', [minted]);
    const registry = registryOf(project, repository);
    expect(suggestionOf(minted, project, registry, 'This Mac')).toEqual({ words: 'fork on This Mac is a clone of scrape-repo\'s repository.', button: 'Link', into: OTHER_ID });
    expect(suggestionOf({ ...minted, state: 'replaced' }, project, registry, 'This Mac')).toBeNull();
    expect(suggestionOf({ ...minted, acts: false }, project, registry, 'This Mac')).toBeNull();
    // review 1, finding 5: the remote's project is found by its id, though every clone of it pins a `.smns`
    const pinned = registered(OTHER_ID, 'scrape-repo', [location(OTHER_MACHINE, 'clone', { source: 'smns', key: `smns:${OTHER_ID}` as OrgKey, remote, remoteProject: OTHER_ID, stated: 'linked' })]);
    expect(suggestionOf(minted, project, registryOf(project, pinned), 'This Mac')).toMatchObject({ button: 'Link', into: OTHER_ID });
    // the remote's project not in the registry, or the location's own: nothing to link
    expect(suggestionOf(minted, project, registryOf(project), 'This Mac')).toBeNull();
    expect(suggestionOf({ ...minted, remoteProject: ID }, project, registryOf(project, repository), 'This Mac')).toBeNull();
  });
});

describe('Add project’s readings of the folder’s rule', () => {
  const label = (key: string, source: 'smns' | 'remote' | 'folder' = 'folder'): Resolved['label'] => ({ key: key as OrgKey, name: 'app', source, smnsId: null });
  const project = registered(ID, 'scrape', [location(OTHER_MACHINE, 'root', { path: '/srv/scrape', stated: 'minted', remote: 'example.org/scrape' })]);

  it('says a folder inside a project’s folder, by the registry’s name for it', () => {
    const inside: Resolved = { project: ID, by: 'minted', at: '/srv/scrape', label: label('folder:x') };
    expect(insideOf(inside, '/srv/scrape/sub', registryOf(project))).toBe('scrape');
    expect(insideOf({ ...inside, at: '/srv/scrape' }, '/srv/scrape', registryOf(project))).toBeNull(); // the folder itself
    expect(insideOf({ ...inside, by: 'machine' }, '/srv/scrape/sub', registryOf(project))).toBeNull(); // the machine's own project
    expect(insideOf({ ...inside, at: '/srv/scrap' }, '/srv/scrape/sub', registryOf(project))).toBeNull(); // not a folder above it
    expect(insideOf(null, '/srv/scrape/sub', registryOf(project))).toBeNull();
  });

  it('defaults to the project a minted location of the same remote holds, a hub project other than the folder’s own', () => {
    const clone: Resolved = { project: null, by: 'remote', at: null, label: label('remote:example.org/scrape', 'remote') };
    expect(defaultLinkOf(clone, registryOf(project))).toBe(ID);
    expect(defaultLinkOf({ ...clone, project: ID }, registryOf(project))).toBeNull();
    expect(defaultLinkOf(clone, registryOf({ ...project, hub: false }))).toBeNull();
    expect(defaultLinkOf({ ...clone, label: label('folder:x') }, registryOf(project))).toBeNull();
    // design §10: a replaced location (another folder at its path) is never the source of a remote-based link
    const replaced = registered(ID, 'scrape', [location(OTHER_MACHINE, 'root', { path: '/srv/scrape', stated: 'minted', remote: 'example.org/scrape', state: 'replaced' })]);
    expect(defaultLinkOf(clone, registryOf(replaced))).toBeNull();
  });

  it('offers the hub projects to add a folder to, by name', () => {
    const projects = [registered('b', 'beta', []), registered('a', 'Alpha', []), registered('c', 'own', [], false)];
    expect(intoChoices(registryOf(...projects)).map((p) => p.id)).toEqual(['a', 'b']);
  });
});
