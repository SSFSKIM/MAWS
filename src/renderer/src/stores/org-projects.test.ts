import { describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { ProjectRecord } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import { machineKey, type OrgKey } from '@shared/machine/org-key';
import { project, record, remoteRow } from '../../../../test/support/builders';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { labelOf, localProjectOfSet, machineOrder, orgIndex, primaryCheckout, reachableCheckouts, registryOnly, rowOfListed, rowOfSession, sessionSetKey, sessionsOfRow, successorOf, type RowKey } from './org-projects';
import { EMPTY_REGISTRY, registryRecords, type OrgProjectLocation, type OrgProjects, type RegistryProject } from './registry';
import type { ListedSession } from './sessions';

// P5 O6 M5 ("Assembly"): every machine's projects grouped by their org key.
const studio = <T extends string>(id: T): T => addressOf(OTHER_MACHINE, id);
const org = (key: string, name: string): ProjectRecord['org'] => ({ key: key as OrgKey, name, source: 'remote', smnsId: null });
const here = project(at('maws'), 0, { name: 'maws-local', org: org('repo:maws', 'MAWS') });
const there = project(studio('maws-b'), 0, { name: 'maws-b', org: org('repo:maws', 'MAWS (studio)') });
const tmp = project(studio('tmp'), 1, { discovered: true, org: org(`folder:${OTHER_MACHINE}:tmp`, 'tmp') });
const state = (projects: ProjectRecord[], records = [record(at('s'), { projectId: here.id })]) => ({
  projects: new Map(projects.map((p) => [p.id, p])),
  records: new Map(records.map((r) => [r.appId, r])),
});

describe('org projects', () => {
  it('names an org project after this machine’s checkout, lists checkouts only, local first', () => {
    const index = orgIndex([there, here, tmp], TEST_MACHINE);
    expect(index.orgs.get('repo:maws' as OrgKey)).toEqual({
      id: 'repo:maws', name: 'MAWS', kind: 'project', smnsId: null,
      checkouts: [{ machine: TEST_MACHINE, path: here.directory, projectId: here.id }, { machine: OTHER_MACHINE, path: there.directory, projectId: there.id }],
    });
    expect(index.orgs.get(`folder:${OTHER_MACHINE}:tmp` as OrgKey)?.checkouts).toEqual([]); // discovered: no checkout
    expect([...index.listed]).toEqual(['repo:maws']);
    expect(orgIndex([there], TEST_MACHINE).orgs.get('repo:maws' as OrgKey)?.name).toBe('MAWS (studio)'); // else the first machine's
  });

  it('names a key after this machine’s checkout, not a discovered clone of it on this machine', () => {
    const clone = project(at('maws-clone'), 3, { name: 'maws-clone', discovered: true, org: org('repo:maws', 'maws-clone') });
    for (const order of [[clone, here], [here, clone]]) expect(orgIndex(order, TEST_MACHINE).orgs.get('repo:maws' as OrgKey)?.name).toBe('MAWS');
    expect(machineOrder(TEST_MACHINE, () => 'x')(TEST_MACHINE, TEST_MACHINE)).toBe(0); // the machine rows' order: a machine is its own equal
  });

  it('acts on the local checkout when there is one, else another machine’s, reaching only machines that are up', () => {
    const index = orgIndex([there, here], TEST_MACHINE);
    expect(primaryCheckout(index, 'repo:maws' as OrgKey, TEST_MACHINE)?.id).toBe(here.id);
    expect(primaryCheckout(orgIndex([{ ...here, hidden: true }, there], TEST_MACHINE), 'repo:maws' as OrgKey, TEST_MACHINE)?.id).toBe(there.id);
    expect(reachableCheckouts(index, 'repo:maws' as OrgKey, (m) => m === TEST_MACHINE).map((p) => p.id)).toEqual([here.id]);
  });

  it('files a session’s tabs under its row: the org key while listed, else its machine’s row', () => {
    const s = state([here, there, tmp], [record(at('s'), { projectId: here.id }), record(studio('t'), { projectId: tmp.id }), record(studio('h'))]);
    const none = () => undefined;
    expect(sessionSetKey(s, TEST_MACHINE, at('s' as AppSessionId), none)).toBe('repo:maws');
    expect(sessionSetKey(s, TEST_MACHINE, studio('t' as AppSessionId), none)).toBe(machineKey(OTHER_MACHINE)); // a folder nobody opened
    expect(sessionSetKey(s, TEST_MACHINE, studio('h' as AppSessionId), none)).toBe(machineKey(OTHER_MACHINE));
    expect(sessionSetKey(s, TEST_MACHINE, at('new' as AppSessionId), () => here.id)).toBe('repo:maws'); // an unstarted one, by its intent
    expect(sessionSetKey(s, TEST_MACHINE, at('new' as AppSessionId), () => null)).toBeNull();
    expect(sessionSetKey(s, TEST_MACHINE, at('new' as AppSessionId), none)).toBeUndefined();
  });

  // P5 O7 M2 (one row per address): another machine's lane B session files where its listing does, before its record
  // (the tab a click opens) and after (main read the record over the link), so neither its row nor its tab moves when
  // the record arrives. A lane A listing keeps O9's rule.
  it('files a listed lane B session’s tabs where its listing is filed, with or without its record', () => {
    const listed = (session: string, lane: 'A' | 'B', orgKey: string | null): [AppSessionId, ListedSession] => {
      const appId = studio(session) as AppSessionId;
      return [appId, { ...remoteRow(OTHER_MACHINE, session, { lane, orgKey: orgKey as OrgKey | null }), appId }];
    };
    const rows = new Map([listed('b', 'B', 'repo:maws'), listed('n', 'B', null), listed('a', 'A', 'repo:maws')]);
    const none = () => undefined;
    const without = { ...state([here]), listed: rows };
    expect(sessionSetKey(without, TEST_MACHINE, studio('b' as AppSessionId), none)).toBe('repo:maws');
    expect(sessionSetKey(without, TEST_MACHINE, studio('n' as AppSessionId), none)).toBe(machineKey(OTHER_MACHINE));
    expect(sessionSetKey(without, TEST_MACHINE, studio('a' as AppSessionId), none)).toBeUndefined(); // lane A: the current set, as before
    const recorded = { ...state([here], [record(studio('b'), { projectId: studio('maws-b') as ProjectId })]), listed: rows };
    expect(sessionSetKey(recorded, TEST_MACHINE, studio('b' as AppSessionId), none)).toBe('repo:maws');
    const hidden = { ...state([{ ...here, hidden: true }]), listed: rows };
    expect(sessionSetKey(hidden, TEST_MACHINE, studio('b' as AppSessionId), none)).toBe('repo:maws'); // a hidden project's sessions keep its key
  });

  it('a set stands for this machine’s checkout of its org project, none for another machine’s only or a machine’s row', () => {
    expect(localProjectOfSet(state([here, there]), 'repo:maws', TEST_MACHINE)?.id).toBe(here.id);
    expect(localProjectOfSet(state([there]), 'repo:maws', TEST_MACHINE)).toBeUndefined();
    expect(localProjectOfSet(state([here]), machineKey(TEST_MACHINE), TEST_MACHINE)).toBeUndefined();
    const fresh = project(at('fresh'), 2); // not derived yet: its set is keyed by its address
    expect(localProjectOfSet(state([fresh]), fresh.id, TEST_MACHINE)?.id).toBe(fresh.id);
    expect(localProjectOfSet(state([fresh]), 'none', TEST_MACHINE)).toBeUndefined();
    expect(localProjectOfSet(state([there]), there.id as ProjectId, TEST_MACHINE)).toBeUndefined();
  });

  // P5 O8 M2 ("How a row is filed")
  it('files a listed session under its org key while listed, nowhere when that key’s checkouts are all hidden, else its machine’s row', () => {
    const listed = (orgKey: string | null): ListedSession => ({ ...remoteRow(OTHER_MACHINE, 'r', { orgKey: orgKey as OrgKey | null }), appId: studio('r' as AppSessionId) });
    const index = orgIndex([here, tmp], TEST_MACHINE);
    expect(rowOfListed(index, listed('repo:maws'))).toBe('repo:maws');
    expect(rowOfListed(index, listed(null))).toBe(machineKey(OTHER_MACHINE));
    expect(rowOfListed(index, listed('repo:elsewhere'))).toBe(machineKey(OTHER_MACHINE));
    expect(rowOfListed(index, listed(`folder:${OTHER_MACHINE}:tmp`))).toBe(machineKey(OTHER_MACHINE)); // a key with no checkout
    expect(rowOfListed(index, listed(`folder:${OTHER_MACHINE}:tmp`), new Set([`folder:${OTHER_MACHINE}:tmp` as OrgKey]))).toBe(`folder:${OTHER_MACHINE}:tmp`);
    expect(rowOfListed(orgIndex([{ ...here, hidden: true }], TEST_MACHINE), listed('repo:maws'))).toBeNull();
  });
});

// The project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §J.1 and §J.2): one row per
// project id, by main's key table; a record with no id by its label, as before.
describe('the project registry: rows by project id', () => {
  const ID = '11111111-2222-4333-8444-555555555555';
  const OTHER_ID = '66666666-7777-4888-9999-aaaaaaaaaaaa';
  const withId = (key: string, smnsId: string | null, source: 'smns' | 'remote' | 'folder' = 'remote'): ProjectRecord['org'] => ({ key: key as OrgKey, name: key, source, smnsId });
  const location = (machine: typeof TEST_MACHINE, pid: string, over: Partial<OrgProjectLocation> = {}): OrgProjectLocation => ({
    machine, pid, path: `/work/${pid}`, key: 'remote:example.org/app' as OrgKey, name: pid, source: 'remote', acts: true, ...over,
  });
  const registered = (id: string, name: string, locations: OrgProjectLocation[]): RegistryProject => ({ id, name, hub: true, renamable: true, locations });
  const registryOf = (projects: RegistryProject[], keys: Record<string, string>, moved: Record<string, string> = {}): OrgProjects => ({
    ...EMPTY_REGISTRY, projects, keys: keys as OrgProjects['keys'], moved: moved as OrgProjects['moved'],
  });

  it('files two labels of one id under one row, the key table’s', () => {
    const pinned = project(at('pinned'), 0, { org: withId(`smns:${ID}`, ID, 'smns') });
    const clone = project(studio('clone'), 0, { org: withId('remote:example.org/app', ID) });
    const index = orgIndex([pinned, clone], TEST_MACHINE, registryOf([], { [ID]: `smns:${ID}` }));
    expect([...index.listed]).toEqual([`smns:${ID}`]);
    expect(index.projects.get(`smns:${ID}` as OrgKey)?.map((p) => p.id)).toEqual([pinned.id, clone.id]);
    expect(index.orgs.get(`smns:${ID}` as OrgKey)?.smnsId).toBe(ID);
  });

  it('keeps one label of two ids as two rows, and a record with no id under its label', () => {
    const minted = project(at('minted'), 0, { org: withId('remote:example.org/app', ID) });
    const linked = project(at('linked'), 1, { org: withId('remote:example.org/app', OTHER_ID) });
    const plain = project(at('plain'), 2, { org: withId(`folder:${TEST_MACHINE}:plain`, null, 'folder') });
    const index = orgIndex([minted, linked, plain], TEST_MACHINE, registryOf([], { [ID]: 'remote:example.org/app', [OTHER_ID]: `id:${OTHER_ID}` }));
    expect([...index.listed].sort()).toEqual([`folder:${TEST_MACHINE}:plain`, `id:${OTHER_ID}`, 'remote:example.org/app'].sort());
    expect(index.keyOf(linked)).toBe(`id:${OTHER_ID}`);
    expect(index.keyOf(plain)).toBe(`folder:${TEST_MACHINE}:plain`);
    // signed out (no table), every record by its label, as before
    expect([...orgIndex([minted, linked, plain], TEST_MACHINE).listed].sort()).toEqual([`folder:${TEST_MACHINE}:plain`, 'remote:example.org/app']);
  });

  it('names a registry project’s row as main assembled it, and lists one seen only through its sessions with no checkout', () => {
    const here = project(at('app'), 0, { name: 'app-local', org: withId('remote:example.org/app', ID) });
    const registry = registryOf([registered(ID, 'Northwind app', [location(TEST_MACHINE, 'app')]), registered(OTHER_ID, 'Shared reports', [])], { [ID]: 'remote:example.org/app', [OTHER_ID]: `id:${OTHER_ID}` });
    const index = orgIndex([here], TEST_MACHINE, registry);
    expect(index.orgs.get('remote:example.org/app' as OrgKey)?.name).toBe('Northwind app');
    expect(index.orgs.get(`id:${OTHER_ID}` as OrgKey)).toMatchObject({ name: 'Shared reports', smnsId: OTHER_ID, checkouts: [] });
    expect(index.listed.has(`id:${OTHER_ID}` as OrgKey)).toBe(true);
    // a listing of that project files under its row, by the key main gave its listing
    const listing = { ...remoteRow(OTHER_MACHINE, 's', { orgKey: `id:${OTHER_ID}` as OrgKey, project: OTHER_ID }), appId: studio('s' as AppSessionId) };
    expect(rowOfListed(index, listing)).toBe(`id:${OTHER_ID}`);
  });

  // panel sweep#2: §I, a project the member sees only through a session of it is listed; §J.1, a row is listed when
  // `OrgProjects.projects` holds it. A record of this Mac that is no checkout (discovered) already giving its key a row
  // makes no difference; checkouts all hidden do, hiding being the owner's word on the project.
  it('lists a project seen only through its sessions when a discovered record here already names its key, not when its checkouts here are hidden', () => {
    const discovered = project(at('reports'), 0, { discovered: true, org: withId('remote:example.org/reports', OTHER_ID) });
    const registry = registryOf([registered(OTHER_ID, 'Shared reports', [])], { [OTHER_ID]: 'remote:example.org/reports' });
    const index = orgIndex([discovered], TEST_MACHINE, registry);
    expect(index.orgs.get('remote:example.org/reports' as OrgKey)).toMatchObject({ name: 'Shared reports', smnsId: OTHER_ID, checkouts: [] });
    expect(index.listed.has('remote:example.org/reports' as OrgKey)).toBe(true);
    const listing = { ...remoteRow(OTHER_MACHINE, 's', { orgKey: 'remote:example.org/reports' as OrgKey, project: OTHER_ID }), appId: studio('s' as AppSessionId) };
    expect(rowOfListed(index, listing)).toBe('remote:example.org/reports');
    const hidden = project(at('reports'), 0, { hidden: true, org: withId('remote:example.org/reports', OTHER_ID) });
    expect(orgIndex([hidden], TEST_MACHINE, registry).listed.has('remote:example.org/reports' as OrgKey)).toBe(false);
  });

  // panel sweep#3: a New chat opened in a project with no folder here (sidebar/registry-new-chat.ts) has no project here,
  // so its intent's is null; its tab belongs in its registry project's set, not the no-project set
  it('files an unstarted New chat of a registry project in that project’s set while the project is a row', () => {
    const registry = registryOf([registered(ID, 'app', [location(OTHER_MACHINE, 'app')])], { [ID]: 'remote:example.org/app' });
    const tab = at('new' as AppSessionId);
    const s = { projects: registryRecords(registry, TEST_MACHINE), registry, records: new Map(), unstarted: new Map([[tab, { projectId: null, createdAt: 't', registry: ID }]]) };
    expect(sessionSetKey(s, TEST_MACHINE, tab, () => null)).toBe('remote:example.org/app');
    expect(sessionSetKey(s, TEST_MACHINE, tab, () => undefined), 'a session not known now').toBeUndefined();
    const gone = { ...s, unstarted: new Map([[tab, { projectId: null, createdAt: 't', registry: OTHER_ID }]]) }; // no row of it now
    expect(sessionSetKey(gone, TEST_MACHINE, tab, () => null)).toBeNull();
  });

  // ticket 644: a tab of another machine's session files where the sidebar files its row (`rowOfListedRecord`): by its
  // listing, though the registry places its project on that machine; this Mac's session by its known project, as before
  it('files the tabs of another machine’s session at a listed address by its listing, though the registry knows its project', () => {
    const registry = registryOf([registered(ID, 'app', [location(OTHER_MACHINE, 'app')])], { [ID]: 'remote:example.org/app' });
    const mine = project(at('app'), 0, { org: withId('remote:example.org/app', ID) });
    const b = studio('b' as AppSessionId);
    const a = at('a' as AppSessionId);
    const s = (orgKey: OrgKey | null) => ({
      projects: new Map([[mine.id, mine], ...registryRecords(registry, TEST_MACHINE)]),
      registry,
      records: new Map([[b, record(b, { projectId: studio('app') as ProjectId })], [a, record(a, { projectId: mine.id })]]),
      listed: new Map<AppSessionId, ListedSession>([
        [b, { ...remoteRow(OTHER_MACHINE, 'b', { orgKey, project: orgKey === null ? null : ID }), appId: b }],
        [a, { ...remoteRow(TEST_MACHINE, 'a'), appId: a }],
      ]),
    });
    const none = () => undefined;
    expect(sessionSetKey(s(null), TEST_MACHINE, b, none), 'its listing’s key is none of the table’s').toBe(machineKey(OTHER_MACHINE));
    expect(sessionSetKey(s('remote:example.org/app' as OrgKey), TEST_MACHINE, b, none), 'listing and registry agree').toBe('remote:example.org/app');
    expect(sessionSetKey(s(null), TEST_MACHINE, a, none), 'this Mac’s, by its project').toBe('remote:example.org/app');
  });

  // ticket 644: a row's sessions (its Mark all read, its archive count and ids) are the ones the sidebar files under it:
  // another machine's record by its listing, though the registry places its project on that machine
  it('takes into a row’s sessions another machine’s record its listing files there, not one its listing files elsewhere', () => {
    const registry = registryOf([registered(ID, 'app', [location(OTHER_MACHINE, 'app')])], { [ID]: 'remote:example.org/app' });
    const b = studio('b' as AppSessionId);
    const s = (orgKey: OrgKey | null) => ({
      projects: registryRecords(registry, TEST_MACHINE),
      registry,
      records: new Map([[b, record(b, { projectId: studio('app') as ProjectId, unread: true })]]),
      listed: new Map<AppSessionId, ListedSession>([[b, { ...remoteRow(OTHER_MACHINE, 'b', { orgKey, project: orgKey === null ? null : ID }), appId: b }]]),
    });
    const ids = (state: ReturnType<typeof s>, key: string) => sessionsOfRow(state, TEST_MACHINE, key as RowKey).map((r) => r.appId);
    expect(ids(s(null), 'remote:example.org/app'), 'its listing’s key is none of the table’s: not the registry project’s').toEqual([]);
    expect(ids(s(null), machineKey(OTHER_MACHINE)), 'its machine’s row').toEqual([b]);
    expect(ids(s('remote:example.org/app' as OrgKey), 'remote:example.org/app'), 'listing and registry agree').toEqual([b]);
  });

  // panel scalpel-2#1: on a Mac signed in and not enrolled, a clone here carries no id; main computes it from the
  // `remote:` label (`ownIds`), and the page groups the clone by it, one row with the project's location elsewhere
  it('groups a clone here that carries no id by the id main computed for it', () => {
    const clone = project(at('clone'), 0, { org: withId('remote:example.org/app', null) });
    const registry = { ...registryOf([registered(ID, 'app', [location(OTHER_MACHINE, 'app')])], { [ID]: `id:${ID}` }), ownIds: { [clone.id]: ID } };
    const index = orgIndex([clone, ...registryRecords(registry, TEST_MACHINE).values()], TEST_MACHINE, registry);
    expect([...index.listed]).toEqual([`id:${ID}`]);
    expect(index.projects.get(`id:${ID}` as OrgKey)?.map((p) => p.id)).toEqual([clone.id, studio('app')]);
    expect(index.orgs.get(`id:${ID}` as OrgKey)).toMatchObject({ smnsId: ID, name: 'app' });
    expect(registryOnly(index, `id:${ID}` as OrgKey), 'a clone here answers for it').toBe(false);
  });

  it('makes no row of a machine’s own project: main leaves it out of the registry, so its location makes no record and its sessions sit under the machine’s row', () => {
    const registry = registryOf([registered(ID, 'app', [location(OTHER_MACHINE, 'app')])], { [ID]: 'remote:example.org/app' });
    const records = registryRecords(registry, TEST_MACHINE);
    expect([...records.keys()]).toEqual([studio('app')]);
    const index = orgIndex(records.values(), TEST_MACHINE, registry);
    const own = { ...remoteRow(OTHER_MACHINE, 'h', { orgKey: null, project: 'machine-project-id' }), appId: studio('h' as AppSessionId) };
    expect(rowOfListed(index, own)).toBe(machineKey(OTHER_MACHINE));
    expect([...index.listed]).toEqual(['remote:example.org/app']);
    // a session of a record whose project is no registry project and carries no id stays under its label's row or its machine's
    expect(rowOfSession(index, new Map(), record(studio('x')))).toBe(machineKey(OTHER_MACHINE));
  });

  it('tells a row the registry alone holds from one a machine of this app answered', () => {
    const registry = registryOf([registered(ID, 'app', [location(OTHER_MACHINE, 'app')])], { [ID]: 'remote:example.org/app' });
    const remote = orgIndex(registryRecords(registry, TEST_MACHINE).values(), TEST_MACHINE, registry);
    expect(registryOnly(remote, 'remote:example.org/app' as OrgKey)).toBe(true);
    const here = project(at('app'), 0, { org: withId('remote:example.org/app', ID) });
    const both = orgIndex([here, ...registryRecords(registry, TEST_MACHINE).values()], TEST_MACHINE, registry);
    expect(registryOnly(both, 'remote:example.org/app' as OrgKey)).toBe(false);
    expect(registryOnly(orgIndex([here], TEST_MACHINE), 'remote:example.org/app' as OrgKey)).toBe(false); // signed out: no registry row
  });

  // §J.2: a key that is no row's any more moves to its successor
  it('finds a key’s successor: itself while a row, main’s moved, else the first record with that label, this Mac’s first', () => {
    const LABEL = 'remote:example.org/app' as OrgKey;
    const linkedHere = project(at('app'), 0, { org: withId(LABEL, OTHER_ID) }); // this Mac's clone, linked into OTHER_ID
    const there = project(studio('app'), 0, { org: withId(LABEL, '99999999-0000-4000-8000-000000000000') });
    const registry = registryOf([], { [OTHER_ID]: `id:${OTHER_ID}`, '99999999-0000-4000-8000-000000000000': 'id:99999999-0000-4000-8000-000000000000' }, { [`id:${ID}`]: `id:${OTHER_ID}` });
    const index = orgIndex([there, linkedHere], TEST_MACHINE, registry);
    expect(successorOf(index, `id:${OTHER_ID}` as OrgKey, TEST_MACHINE)).toBe(`id:${OTHER_ID}`); // a row's own
    expect(successorOf(index, `id:${ID}` as OrgKey, TEST_MACHINE)).toBe(`id:${OTHER_ID}`); // linked into another: main names it
    expect(successorOf(index, LABEL, TEST_MACHINE)).toBe(`id:${OTHER_ID}`); // the label's records: this Mac's first
    expect(labelOf(linkedHere)).toBe(LABEL);
    expect(successorOf(index, 'smns:nobody' as OrgKey, TEST_MACHINE)).toBe('smns:nobody'); // none: it stays
    const hidden = orgIndex([{ ...linkedHere, hidden: true }], TEST_MACHINE, registry);
    expect(successorOf(hidden, LABEL, TEST_MACHINE)).toBe(LABEL); // a hidden project's set stays
  });
});
