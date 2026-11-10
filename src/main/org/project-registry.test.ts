// The registry main hands the page (the project registry, docs/doperpowers/plans/2026-11-10-project-registry.md,
// Interfaces §I; M10's Proves, "the member's view in the three cases"): `assembleProjects` over the verified records, less
// the projects with no location, filtered to what the signed-in member may see: the locations on machines they own (with
// actions) or hold a grant on (without), and a project they see only through a session with no locations. Each project's
// row key comes from the key table, one of this device's rows lending its label; a held removal's location is left out
// and listed; signed out the value is empty. Over a fake feed, session, links and rows, with real signed records.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { machineProjectId, repoProjectId } from '@shared/machine/project-ids';
import type { OrgProjects } from '@shared/ipc/schema/org';
import type { ProjectRecord } from '@shared/ipc/schema/session';
import type { MachineRef } from '@shared/machine/ref';
import type { LinkState } from '../machines/manager';
import type { CallResult } from '../machines/remote/link';
import { iso } from '../../../test/endpoint/org-fixtures';
import { fakeFeed, HOUR, location, memoryFiles, ORG, World } from '../../../test/org/rows-world';
import type { OrgFiles } from './files';
import type { RemovalAnswer, RemovalInput } from './held-removals';
import { PROJECT_KEYS_FILE } from './project-keys';
import { createProjectRegistry, type ProjectRegistry, type RegistryLink } from './project-registry';

const running: ProjectRegistry[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) await r.close();
  vi.useRealTimers();
});

const P = '0a0a0a0a-0000-4000-8000-000000000001';
const Q = '0a0a0a0a-0000-4000-8000-000000000002';
const R = '0a0a0a0a-0000-4000-8000-000000000003';
const LOCAL = 'mac-local-ref-000000000' as MachineRef;

const own = (id: string, key: string, smnsId: string | null, over: Partial<ProjectRecord> = {}): ProjectRecord =>
  ({ id, name: key, directory: `/work/${id}`, order: 0, createdAt: iso(0), org: { key, name: key, source: key.startsWith('remote:') ? 'remote' : 'folder', smnsId }, ...over }) as ProjectRecord;

function fakeLink(initial: LinkState = 'down', capabilities: string[] = ['rl2.project-acts']) {
  const listeners = new Set<(state: LinkState) => void>();
  const capsListeners = new Set<() => void>();
  const channelListeners = new Set<(event: 'current' | 'lost') => void>();
  let state = initial;
  /** As the real link's grace: `up` may read while no channel is current (no peers). */
  let channel = true;
  const calls: string[] = [];
  const answers: CallResult[] = [];
  const link: RegistryLink = {
    state: () => state,
    onState: (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    onCaps: (listener) => {
      const told = () => listener(null as never); // the registry reads no field of the caps, only that they came
      capsListeners.add(told);
      return () => void capsListeners.delete(told);
    },
    onChannel: (listener) => (channelListeners.add(listener), () => void channelListeners.delete(listener)),
    peerCapabilities: () => (state === 'up' && channel ? capabilities : null),
    call: async (name) => (calls.push(name), answers.shift() ?? { ok: false, error: { code: 'offline' } }),
  };
  return {
    link,
    calls,
    answers,
    set: (next: LinkState) => ((state = next), listeners.forEach((l) => l(next))),
    /** The channel lost within the grace: still `up`, no peers, nothing said on `onState`. */
    lose: () => ((channel = false), channelListeners.forEach((l) => l('lost'))),
    /** The next channel current, its `caps` after it, as the real link says them. */
    relink: () => ((channel = true), channelListeners.forEach((l) => l('current')), capsListeners.forEach((l) => l())),
    /** A `caps` with no channel change: the endpoint's grant delivered or withdrawn (`refreshCaps`). */
    caps: () => capsListeners.forEach((l) => l()),
  };
}

async function start(w: World, options: { files?: OrgFiles; local?: ProjectRecord[]; sessions?: string[]; links?: Record<string, ReturnType<typeof fakeLink>>; loaded?: false } = {}) {
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
  if (options.loaded !== false) await registry.loaded;
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

// The project registry's M12 (Interfaces §K): main's act handler names another machine by its name in the held head and
// the certificates (review 1's finding 2: a VM that exists only by its certificate), and tells a signed-out app from one
// that is signed in
describe('the machines the registry names', () => {
  it('are the directory’s, by name and ref, a certificate-only VM among them; none signed out', async () => {
    const w = await World.make();
    const h = await start(w);
    expect(h.registry.machines()).toEqual([{ ref: w.m1.ref, name: 'mac-one' }, { ref: w.m2.ref, name: 'mac-two' }, { ref: w.d.ref, name: 'vm-one' }]);
    w.session.set(null);
    expect(h.registry.machines()).toBeNull();
  });
});

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

  // The project registry's M11 (review 1, finding 5): the page has no `uuid5`, so each location with an observed remote
  // carries the project that remote derives in the org (design §8), for the page's Link suggestion.
  it('gives a location with a remote the project its remote derives, and none to one without', async () => {
    const w = await World.make();
    const h = await start(w);
    await h.page(await w.projects(w.m1, 1, [location('a1', P, '/srv/fork', { remote: 'github.com/a/b', source: 'smns', key: `smns:${P}` }), location('a2', P, '/srv/plain')]));
    expect(h.value().projects[0]!.locations.map((l) => [l.pid, l.remoteProject])).toEqual([
      ['a1', repoProjectId(ORG, 'github.com/a/b')],
      ['a2', undefined],
    ]);
  });

  // Review 1, finding 1: a delegated machine's authority, and its owners' actions, end at the delegation's `expires`.
  it('drops a delegated machine’s locations, and their actions, at its delegation’s expiry, with no new head', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const w = await World.make();
    const h = await start(w);
    await h.page(await w.projects(w.d, 1, [location('v1', P, '/srv/vm')]), await w.projects(w.m1, 1, [location('a1', P, '/srv/p')]));
    expect(h.value().projects.map((p) => [p.id, p.locations.map((l) => [l.pid, l.acts])])).toEqual([[P, expect.arrayContaining([['v1', true], ['a1', true]])]]);
    w.clock = Date.parse(w.delegation.expires) + 1;
    await vi.advanceTimersByTimeAsync(HOUR + 1_000);
    await h.registry.settled();
    expect(h.value().projects.map((p) => [p.id, p.locations.map((l) => [l.pid, l.acts])])).toEqual([[P, [['a1', true]]]]);
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

  // Review 1, finding 2: the first computation waits for the persisted table (and the first own rows), so an entry the
  // table already holds is never first given from an empty one and then replaced.
  it('are never computed before the persisted table is read: an entry it holds is the first one given', async () => {
    const w = await World.make();
    const store = new Map<string, string>();
    const first = await start(w, { files: memoryFiles(store) });
    await first.page(await w.projects(w.m1, 1, [location('a1', P, '/srv/p')]));
    expect(first.value().keys).toEqual({ [P]: `id:${P}` });
    await first.registry.close();
    let release!: () => void;
    const held = new Promise<void>((done) => (release = done));
    const base = memoryFiles(store);
    const files: OrgFiles = { ...base, read: async (name) => (name === PROJECT_KEYS_FILE && (await held), base.read(name)) };
    const h = await start(w, { files, local: [own('l1', 'folder:mac:l1', P)], loaded: false });
    let told = 0;
    h.registry.onKeys(() => told++);
    await new Promise((done) => setTimeout(done, 30)); // the held records loaded, a computation's coalescing past
    release();
    await h.registry.loaded;
    expect(h.emitted.map((v) => v.keys[P])).toEqual([`id:${P}`]);
    expect(h.registry.keyOf(P)).toBe(`id:${P}`);
    expect(told).toBe(1);
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

// Review 1, findings 3 and 6: the link's other two signals. A grant delivered or withdrawn reaches main as a `caps` with no
// state change (the endpoint's `refreshCaps`); a channel current again inside the link's grace says nothing on `onState`.
describe('the link’s channel and caps', () => {
  const grant = (w: World) => ({ member: w.A, grant: { body: { org: ORG, machine: w.m2.ref, machineKey: 'k', member: w.A, rights: ['spawn'], version: 1, issued: iso(w.clock) }, sig: { kid: 'k', value: 'v' } }, highWater: 1 });

  it('reads the member’s grant again at each `caps`: one delivered shows the machine’s locations, one withdrawn hides them', async () => {
    const w = await World.make();
    const m2 = fakeLink('down');
    const h = await start(w, { links: { [w.m2.ref]: m2 } });
    await h.page(await w.projects(w.m2, 1, [location('b1', Q, '/srv/q')]));
    m2.answers.push({ ok: true, output: { members: [] } });
    m2.set('up');
    await h.registry.settled();
    expect(h.value().projects).toEqual([]);
    m2.answers.push({ ok: true, output: { members: [grant(w)] } });
    m2.caps();
    await h.registry.settled();
    expect(h.value().projects.map((p) => [p.id, p.locations.map((l) => l.pid)])).toEqual([[Q, ['b1']]]);
    m2.answers.push({ ok: true, output: { members: [] } });
    m2.caps();
    await h.registry.settled();
    expect(h.value().projects).toEqual([]);
    expect(m2.calls).toEqual(['endpoint.grants', 'endpoint.grants', 'endpoint.grants']);
  });

  it('sends a removal held during the link’s grace when the next channel is current', async () => {
    const w = await World.make();
    const m1 = fakeLink('up');
    const h = await start(w, { links: { [w.m1.ref]: m1 } });
    await h.page(await w.projects(w.m1, 1, [location('a1', P, '/srv/p'), location('a2', P, '/srv/p2')]));
    m1.lose();
    await h.registry.hold({ machine: w.m1.ref as MachineRef, pid: 'a1' });
    await h.registry.settled();
    expect(h.removed).toEqual([]);
    m1.relink();
    await h.registry.settled();
    expect(h.removed).toEqual([{ machine: w.m1.ref, input: { id: 'a1', expect: { path: '/srv/p', project: P } } }]);
    expect(h.value().removals).toEqual([]);
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
