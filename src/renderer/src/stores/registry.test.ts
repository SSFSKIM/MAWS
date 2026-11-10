import { describe, expect, it } from 'vitest';
import type { ProjectId } from '@shared/graph/ids';
import type { OrgKey } from '@shared/machine/org-key';
import { project } from '../../../../test/support/builders';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { EMPTY_REGISTRY, isRegistryRecord, locationAddress, projectRefusal, registryRecords, type OrgProjectLocation, type OrgProjects } from './registry';
import { createSessionsStore } from './sessions';

// The project registry on the page (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §J.1; M11's
// decision): other machines' locations are project records in the sessions store's one map.
const ID = '11111111-2222-4333-8444-555555555555';
const THIRD = 'ThirdMachineRef0000000' as typeof TEST_MACHINE;
const on = (machine: typeof TEST_MACHINE, id: string) => `${machine}/${id}` as ProjectId;
const location = (machine: typeof TEST_MACHINE, pid: string, over: Partial<OrgProjectLocation> = {}): OrgProjectLocation => ({
  machine, pid, path: `/srv/${pid}`, key: `folder:${machine}:${pid}` as OrgKey, name: pid, source: 'folder', acts: true, ...over,
});
const registryOf = (locations: OrgProjectLocation[]): OrgProjects => ({
  ...EMPTY_REGISTRY,
  projects: [{ id: ID, name: 'scrape', hub: true, renamable: true, locations }],
  keys: { [ID]: `id:${ID}` as OrgKey },
});

describe('the registry’s records', () => {
  it('makes a declared record of each location on another machine, its address the machine and its row id, its project the id', () => {
    const records = registryRecords(registryOf([location(TEST_MACHINE, 'here'), location(OTHER_MACHINE, 'p-1', { stated: 'minted', state: 'missing', remote: 'example.org/scrape' })]), TEST_MACHINE);
    expect([...records.keys()]).toEqual([on(OTHER_MACHINE, 'p-1')]); // this Mac's own location is its own index's record
    const record = records.get(on(OTHER_MACHINE, 'p-1'))!;
    expect(record).toMatchObject({ name: 'p-1', directory: '/srv/p-1', org: { key: `folder:${OTHER_MACHINE}:p-1`, name: 'p-1', source: 'folder', smnsId: ID }, stated: 'minted', state: 'missing', remote: 'example.org/scrape' });
    expect(record.discovered).toBeUndefined(); // a declared folder: a checkout
    expect(isRegistryRecord(record)).toBe(true);
    expect(isRegistryRecord(project(on(OTHER_MACHINE, 'p-1'), 0))).toBe(false);
    expect(locationAddress({ machine: OTHER_MACHINE, pid: 'p-1' })).toBe(on(OTHER_MACHINE, 'p-1'));
  });

  it('tells a project act’s refusal by its message’s code, a statements-unavailable with its reason, and the link’s not-offered', () => {
    expect(projectRefusal({ message: 'statements-unavailable: sminos-too-old: this machine’s sminos does not read locations' })).toEqual({ code: 'statements-unavailable', reason: 'sminos-too-old' });
    expect(projectRefusal({ message: 'unknown-project: no verified record names it' })).toEqual({ code: 'unknown-project', reason: null });
    expect(projectRefusal({ message: 'session.projects.link: refused not-offered by machine mini', issues: { refusal: 'not-offered' } })).toEqual({ code: 'not-offered', reason: null });
    expect(projectRefusal({ message: 'machine mini is not reachable' })).toBeNull();
    expect(projectRefusal({ message: 'outside-home: that folder is outside the home' })).toBeNull(); // the setup's, not a project act's
  });
});

describe('the sessions store’s registry', () => {
  it('holds the registry whole, its other machines’ locations as records beside the machines’ own, and drops them when it changes', () => {
    const store = createSessionsStore();
    store.getState().applyProjects({ projects: [project(at('mine'), 0)], revision: 1 }, TEST_MACHINE);
    const registry = registryOf([location(OTHER_MACHINE, 'p-1'), location(THIRD, 'p-2')]);
    store.getState().applyRegistry(registry, TEST_MACHINE);
    expect(store.getState().registry).toBe(registry);
    expect([...store.getState().projects.keys()].sort()).toEqual([at('mine'), on(OTHER_MACHINE, 'p-1'), on(THIRD, 'p-2')].sort());
    store.getState().applyRegistry(registryOf([location(THIRD, 'p-2')]), TEST_MACHINE);
    expect([...store.getState().projects.keys()].sort()).toEqual([at('mine'), on(THIRD, 'p-2')].sort());
    store.getState().applyRegistry(EMPTY_REGISTRY, TEST_MACHINE); // signed out
    expect([...store.getState().projects.keys()]).toEqual([at('mine')]);
  });

  it('never replaces a record a machine answered itself, and takes the registry’s back where that machine stops answering it', () => {
    const store = createSessionsStore();
    store.getState().applyRegistry(registryOf([location(OTHER_MACHINE, 'p-1')]), TEST_MACHINE);
    const own = project(on(OTHER_MACHINE, 'p-1'), 3, { name: 'its own word' });
    store.getState().applyProjects({ projects: [own], revision: 1 }, OTHER_MACHINE);
    expect(store.getState().projects.get(on(OTHER_MACHINE, 'p-1'))).toBe(own);
    store.getState().applyRegistry(registryOf([location(OTHER_MACHINE, 'p-1', { name: 'renamed' })]), TEST_MACHINE);
    expect(store.getState().projects.get(on(OTHER_MACHINE, 'p-1'))).toBe(own);
    store.getState().applyProjects({ projects: [], revision: 2 }, OTHER_MACHINE);
    expect(store.getState().projects.get(on(OTHER_MACHINE, 'p-1'))?.name).toBe('renamed');
  });
});
