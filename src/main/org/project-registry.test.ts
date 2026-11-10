// The registry main hands the page (the project registry, docs/doperpowers/plans/2026-11-10-project-registry.md,
// Interfaces §I; M10's Proves, "the member's view in the three cases"): `assembleProjects` over the verified records, less
// the projects with no location, filtered to what the signed-in member may see: the locations on machines they own (with
// actions) or hold a grant on (without), and a project they see only through a session with no locations. Each project's
// row key comes from the key table, one of this device's rows lending its label; a held removal's location is left out
// and listed; signed out the value is empty. Over a fake feed, session, links and rows, with real signed records.
import { afterEach, describe, expect, it } from 'vitest';
import { machineProjectId } from '@shared/machine/project-ids';
import { repoProjectId } from '@shared/machine/project-ids';
import type { OrgProjects } from '@shared/ipc/schema/org';
import type { ProjectRecord } from '@shared/ipc/schema/session';
import type { MachineRef } from '@shared/machine/ref';
import type { LinkState } from '../machines/manager';
import type { CallResult } from '../machines/remote/link';
import { iso } from '../../../test/endpoint/org-fixtures';
import { fakeFeed, location, memoryFiles, ORG, World } from '../../../test/org/rows-world';
import type { RemovalAnswer, RemovalInput } from './held-removals';
import { createProjectRegistry, type ProjectRegistry, type RegistryLink } from './project-registry';

const running: ProjectRegistry[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) await r.close();
});

const P = '0a0a0a0a-0000-4000-8000-000000000001';
const Q = '0a0a0a0a-0000-4000-8000-000000000002';
const R = '0a0a0a0a-0000-4000-8000-000000000003';
const LOCAL = 'mac-local-ref-000000000' as MachineRef;

const own = (id: string, key: string, smnsId: string | null, over: Partial<ProjectRecord> = {}): ProjectRecord =>
  ({ id, name: key, directory: `/work/${id}`, order: 0, createdAt: iso(0), org: { key, name: key, source: key.startsWith('remote:') ? 'remote' : 'folder', smnsId }, ...over }) as ProjectRecord;

function fakeLink(initial: LinkState = 'down', capabilities: string[] = ['rl2.project-acts']) {
  const listeners = new Set<(state: LinkState) => void>();
  let state = initial;
  const calls: string[] = [];
  const answers: CallResult[] = [];
  const link: RegistryLink = {
    state: () => state,
    onState: (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    peerCapabilities: () => (state === 'up' ? capabilities : null),
    call: async (name) => (calls.push(name), answers.shift() ?? { ok: false, error: { code: 'offline' } }),
  };
  return { link, calls, answers, set: (next: LinkState) => ((state = next), listeners.forEach((l) => l(next))) };
}

async function start(w: World, options: { files?: ReturnType<typeof memoryFiles>; local?: ProjectRecord[]; sessions?: string[]; links?: Record<string, ReturnType<typeof fakeLink>> } = {}) {
  const feed = fakeFeed();
  const files = options.files ?? memoryFiles();
  let local = options.local ?? [];
  let sessions = options.sessions ?? [];
  const localListeners = new Set<() => void>();
  const links = options.links ?? {};
  const emitted: OrgProjects[] = [];
  const removed: Array<{ machine: string; input: RemovalInput }> = [];
  const told: string[] = [];
  const registry = createProjectRegistry({
    session: w.session,
    feed: feed.feed,
    local: LOCAL,
    files,
    roster: () => Object.keys(links) as MachineRef[],
    onRoster: () => () => {},
    link: (ref) => links[ref]?.link ?? null,
    localProjects: async () => local,
    onLocalProjects: (listener) => (localListeners.add(listener), () => void localListeners.delete(listener)),
    sessions: () => sessions,
    remove: async (machine, input): Promise<RemovalAnswer> => (removed.push({ machine, input }), { ok: true, value: undefined }),
    emit: (value) => emitted.push(value),
    notify: (text) => told.push(text),
    now: () => w.clock,
    timing: { ROWS_COALESCE_MS: 1, ROWS_CACHE_WRITE_MS: 1 },
    log: () => {},
  });
  running.push(registry);
  await registry.loaded;
  return {
    registry,
    feed,
    files,
    emitted,
    removed,
    told,
    async page(...records: Parameters<typeof feed.projectsPage>[0]) {
      feed.projectsPage(records, true);
      await registry.settled();
    },
    async setLocal(next: ProjectRecord[]) {
      local = next;
      localListeners.forEach((l) => l());
      await registry.settled();
    },
    async setSessions(next: string[]) {
      sessions = next;
      registry.refresh();
      await registry.settled();
    },
    value: () => registry.projects(),
  };
}

describe('the member’s view', () => {
  it('lists the locations on machines they own, with actions; those on a machine they hold a grant on, without; and a project seen only through a session, with none', async () => {
    const w = await World.make(); // A owns m1, B owns m2; A is signed in
    const m2 = fakeLink('down');
    const h = await start(w, { links: { [w.m2.ref]: m2 } });
    await h.page(await w.projects(w.m1, 1, [location('a1', P, '/srv/p')]), await w.projects(w.m2, 1, [location('b1', P, '/srv/p-too'), location('b2', Q, '/srv/q'), location('b3', R, '/srv/r')]));
    expect(h.value().projects.map((p) => [p.id, p.locations.map((l) => [l.pid, l.acts])])).toEqual([[P, [['a1', true]]]]);
    // a session of R that A sees: R listed with no locations
    await h.setSessions([R]);
    expect(h.value().projects.map((p) => [p.id, p.locations.length])).toEqual([
      [P, 1],
      [R, 0],
    ]);
    // a grant on m2, read from its ledger when its link comes up: its locations, no actions
    m2.answers.push({ ok: true, output: { members: [{ member: w.A, grant: { body: { org: ORG, machine: w.m2.ref, machineKey: 'k', member: w.A, rights: ['spawn'], version: 1, issued: iso(w.clock) }, sig: { kid: 'k', value: 'v' } }, highWater: 1 }] } });
    m2.set('up');
    await h.registry.settled();
    expect(m2.calls).toEqual(['endpoint.grants']);
    expect(h.value().projects.map((p) => [p.id, p.locations.map((l) => [l.pid, l.acts])])).toEqual([
      [P, [['a1', true], ['b1', false]]],
      [Q, [['b2', false]]],
      [R, [['b3', false]]],
    ]);
    expect(h.emitted.at(-1)).toEqual(h.value());
  });

  it('names a project by §A’s rule over all its locations, leaves a machine’s own project out, and a project only known somewhere', async () => {
    const w = await World.make();
    const h = await start(w);
    const machineProject = machineProjectId(ORG, 'mac-one');
    await h.page(await w.projects(w.m1, 1, [location('a1', P, '/srv/scrape', { nameRev: 2, name: 'Scrape' }), location('a2', machineProject, '/Users/a')], [{ id: Q, name: 'known only' }]));
    expect(h.value().projects).toEqual([
      { id: P, name: 'Scrape', hub: true, renamable: true, locations: [{ machine: w.m1.ref, pid: 'a1', path: '/srv/scrape', key: 'folder:x:a1', name: 'Scrape', source: 'folder', stated: 'minted', acts: true }] },
    ]);
  });

  it('is empty signed out', async () => {
    const w = await World.make();
    const h = await start(w);
    await h.page(await w.projects(w.m1, 1, [location('a1', P, '/srv/p')]));
    w.session.set(null);
    await h.registry.settled();
    expect(h.value()).toEqual({ projects: [], keys: {}, moved: {}, removals: [], seen: {} });
  });
});

describe('the row keys', () => {
  it('take this device’s row’s label, else `id:`, and are told to the rows', async () => {
    const w = await World.make();
    const h = await start(w, { local: [own('l1', 'folder:mac:l1', P)] });
    let told = 0;
    h.registry.onKeys(() => told++);
    await h.page(await w.projects(w.m1, 1, [location('a1', P, '/srv/p', { key: 'remote:github.com/a/b' }), location('a2', Q, '/srv/q')]));
    expect(h.value().keys).toEqual({ [P]: 'folder:mac:l1', [Q]: `id:${Q}` });
    expect(h.registry.keyOf(P)).toBe('folder:mac:l1');
    expect(h.registry.keyOf(R)).toBeNull();
    expect(told).toBeGreaterThan(0);
  });

  it('on a Mac signed in and not enrolled, give a `remote:` row the id its key derives', async () => {
    const w = await World.make();
    const h = await start(w, { local: [own('l1', 'remote:github.com/a/b', null)] });
    expect(h.registry.keyOf(repoProjectId(ORG, 'github.com/a/b'))).toBe('remote:github.com/a/b');
  });

  it('name in `moved` the project that took the last location of one that has none now', async () => {
    const w = await World.make();
    const h = await start(w, { local: [own('l1', 'folder:mac:l1', P)] });
    await h.setLocal([own('l1', 'folder:mac:l1', Q, { stated: 'linked' })]);
    expect(h.value().moved).toEqual({ 'folder:mac:l1': `id:${Q}` });
  });
});

describe('a held removal', () => {
  it('hides its location here, is listed, and is sent with its expectation when its machine’s link comes up', async () => {
    const w = await World.make();
    const m1 = fakeLink('down');
    const h = await start(w, { links: { [w.m1.ref]: m1 } });
    await h.page(await w.projects(w.m1, 1, [location('a1', P, '/srv/p'), location('a2', P, '/srv/p2')]));
    await h.registry.hold({ machine: w.m1.ref as MachineRef, pid: 'a1' });
    await h.registry.settled();
    expect(h.value().projects[0].locations.map((l) => l.pid)).toEqual(['a2']);
    expect(h.value().removals).toEqual([{ id: expect.any(String), project: P, machine: w.m1.ref, pid: 'a1', path: '/srv/p', askedAt: iso(w.clock) }]);
    m1.set('up');
    await h.registry.settled();
    expect(h.removed).toEqual([{ machine: w.m1.ref, input: { id: 'a1', expect: { path: '/srv/p', project: P } } }]);
    expect(h.value().removals).toEqual([]);
  });

  it('is not sent to a machine whose endpoint does not serve the project acts', async () => {
    const w = await World.make();
    const m1 = fakeLink('down', []);
    const h = await start(w, { links: { [w.m1.ref]: m1 } });
    await h.page(await w.projects(w.m1, 1, [location('a1', P, '/srv/p')]));
    await h.registry.hold({ machine: w.m1.ref as MachineRef, pid: 'a1' });
    m1.set('up');
    await h.registry.settled();
    expect(h.removed).toEqual([]);
    expect(h.value().removals).toHaveLength(1);
    expect(h.value().projects).toEqual([]);
  });
});

describe('seen', () => {
  it('says when each machine was last seen', async () => {
    const w = await World.make();
    const m1 = fakeLink('down');
    const h = await start(w, { links: { [w.m1.ref]: m1 } });
    const issued = w.clock;
    await h.page(await w.projects(w.m1, 1, [location('a1', P, '/srv/p')]));
    expect(h.value().seen).toEqual({ [w.m1.ref]: iso(issued) });
    w.clock += 60_000;
    m1.set('up');
    await h.registry.settled();
    expect(h.value().seen).toEqual({ [w.m1.ref]: iso(issued + 60_000) });
  });
});
