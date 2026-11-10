// The project registry's main half against the hub itself (docs/doperpowers/plans/2026-11-10-project-registry.md, M10's
// Proves; design acceptance 7 and 8): desk-hub's Worker in Miniflare (local-org.ts), the app's session registered through
// `pair`, and real endpoints enrolled in the same org, each over a stand-in index (`ProjectsSource`, as mawsd hands it)
// whose declared folders it signs into its projects record. Through the app's `?app=1` feed the registry lists an
// endpoint's project, with its location and the member's actions on it. A record whose location carries another
// project's label moves no session: each listing is filed under the key the key table gives its own project. A retired
// machine's locations are gone. After a relaunch with the hub stopped, the registry still lists the project, from the file.
import { rmSync } from 'node:fs';
import { keyId } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import { orgFiles } from '../../src/main/org/files';
import type { OrgSessionService } from '../../src/main/org/org-session';
import { createProjectRegistry, type ProjectRegistry } from '../../src/main/org/project-registry';
import { createRegistryFeed, type RegistryFeed } from '../../src/main/org/registry-feed';
import { createRemoteRows, type RemoteRows } from '../../src/main/org/rows';
import type { OrgProjects, OrgRows } from '../../src/shared/ipc/schema/org';
import type { ProjectRecord } from '../../src/shared/ipc/schema/session';
import type { OrgKey } from '../../src/shared/machine/org-key';
import type { MachineRef } from '../../src/shared/machine/ref';
import type { DeclaredRow, KeptStatement, ProjectsSource } from '../../src/shared/machine/registry';
import { fakeServices, type FakeServices } from '../endpoint/fake-services';
import { enrollEndpoint, orgSession, registerThroughPair, scratchDir, sleep, startLocalOrg, until, type LocalOrg } from './local-org';

const scratch = scratchDir('maws-registry-main-');
const profile = scratch.dir('profile');
const LOCAL = 'registry-local-mac-0000' as MachineRef;
const ANCHOR = { dev: '16777232', ino: '77', birth: '1731234567000000000' };

/** The index's side as mawsd hands the endpoint it: declared rows and their statements. */
class StandInIndex implements ProjectsSource {
  value: ReturnType<ProjectsSource['snapshot']> = null;
  readonly #listeners = new Set<() => void>();
  snapshot() {
    return this.value === null ? null : structuredClone(this.value);
  }
  /** A rebuilt index: none in this suite. */
  restore() {}
  onChange(listener: () => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  /** A minted folder declared at `path` with project `id`, its label `key`. */
  declare(path: string, id: string, key = `folder:x:${path}`) {
    const name = path.split('/').pop()!;
    const row: DeclaredRow = { pid: `p${Buffer.from(path).toString('hex').slice(-30)}`, path, name, org: { key: key as OrgKey, name, source: 'folder', smnsId: id }, stated: 'minted', statedAt: path };
    const statement: KeptStatement = { path, minted: id, linked: null, anchor: ANCHOR, name, nameRev: null, hidden: false };
    this.value = { indexId: 'index-1', rows: [...(this.value?.rows ?? []), row], statements: [...(this.value?.statements ?? []), statement] };
    for (const listener of [...this.#listeners]) listener();
  }
}

type Machine = { endpoint: Endpoint; services: FakeServices; ref: string; index: StandInIndex };

let org: LocalOrg;
const machines: Machine[] = [];
let session: OrgSessionService;
let feed: RegistryFeed;
let registry: ProjectRegistry;
let rows: RemoteRows;
let latest: OrgProjects | null = null;
let latestRows: OrgRows | null = null;
const logs: string[] = [];
const uuid = () => crypto.randomUUID();

/** This Mac's own row: a clone whose label is `remote:github.com/acme/tool`, in project LOCAL_PROJECT. */
const LOCAL_PROJECT = uuid();
const LABEL = 'remote:github.com/acme/tool';
const localRow: ProjectRecord = {
  id: 'p-local' as ProjectRecord['id'],
  name: 'tool',
  directory: '/work/tool',
  order: 0,
  createdAt: new Date(0).toISOString(),
  org: { key: LABEL as OrgKey, name: 'tool', source: 'remote', smnsId: LOCAL_PROJECT },
};

async function machine(name: string): Promise<Machine> {
  const services = fakeServices();
  const index = new StandInIndex();
  const endpoint = createEndpoint({ build: 'registry-main-local', sleep: (ms) => sleep(Math.min(ms, 50)), projectsSource: index });
  await endpoint.start(services);
  const m: Machine = { endpoint, services, ref: services.machine.ref, index };
  machines.push(m);
  await enrollEndpoint(org, endpoint, m.ref, name);
  await until(() => endpoint.hub.connected, `${name}'s hub link`);
  return m;
}

/** The app's registry and rows over `s`, its files under the profile, no RL2 link (the hub's records alone). */
function startApp(s: OrgSessionService): { feed: RegistryFeed; registry: ProjectRegistry; rows: RemoteRows } {
  const f = createRegistryFeed({ session: s, log: (l) => void logs.push(l) });
  s.attach(f);
  const files = orgFiles({ userData: profile, log: (l) => void logs.push(l) });
  let r: RemoteRows | null = null;
  const reg = createProjectRegistry({
    session: s,
    feed: f,
    local: LOCAL,
    files,
    roster: () => machines.map((m) => m.ref as MachineRef),
    onRoster: () => () => {},
    link: () => null,
    localProjects: async () => [localRow],
    onLocalProjects: () => () => {},
    sessions: () => r?.rows().rows.map((row) => row.project) ?? [],
    remove: async () => ({ ok: false, error: { code: 'host_unavailable', message: 'no link in this suite' } }),
    emit: (next) => void (latest = next),
    notify: () => {},
    log: (l) => void logs.push(l),
  });
  r = createRemoteRows({
    session: s,
    feed: f,
    roster: () => machines.map((m) => m.ref as MachineRef),
    onRoster: () => () => {},
    keys: reg,
    link: () => null,
    files,
    emit: (next) => {
      latestRows = next;
      reg.refresh();
    },
    log: (l) => void logs.push(l),
  });
  return { feed: f, registry: reg, rows: r };
}

const project = (id: string) => latest?.projects.find((p) => p.id === id);
const rowOf = (s: string) => latestRows?.rows.find((r) => r.session === s);

beforeAll(async () => {
  org = await startLocalOrg(scratch);
  session = orgSession({ userData: profile, build: 'registry-main-local', log: (l) => void logs.push(l) });
  await registerThroughPair(org, session);
  await machine('reg-mini');
  ({ feed, registry, rows } = startApp(session));
  await registry.loaded;
}, 120_000);

afterAll(async () => {
  await rows?.close();
  await registry?.close();
  feed?.close();
  await session?.close();
  for (const m of machines) {
    await m.endpoint.stop();
    m.services.cleanup();
  }
  await org?.stop();
  rmSync(scratch.root, { recursive: true, force: true });
});

const SCRAPE = uuid();

describe('the registry on the local hub', { timeout: 120_000 }, () => {
  it('lists a real endpoint’s declared folder as a project, with its location and the member’s actions', async () => {
    const mini = machines[0];
    mini.index.declare('/srv/scrape', SCRAPE);
    await until(() => project(SCRAPE), 'the project in the registry');
    expect(project(SCRAPE)).toEqual({
      id: SCRAPE,
      name: 'scrape',
      hub: true,
      renamable: true,
      locations: [{ machine: mini.ref, pid: expect.any(String), path: '/srv/scrape', key: 'folder:x:/srv/scrape', name: 'scrape', source: 'folder', stated: 'minted', acts: true }],
    });
    expect(latest!.keys[SCRAPE]).toBe(`id:${SCRAPE}`);
    expect(latest!.seen[mini.ref]).toEqual(expect.any(String));
  });

  it('moves no session by a record’s location that carries another project’s label', async () => {
    const mini = machines[0];
    const OTHER = uuid();
    // a location on mini in project OTHER whose label is this Mac's row's, the row of LOCAL_PROJECT
    mini.index.declare('/srv/tool-copy', OTHER, LABEL);
    await until(() => project(OTHER), 'the other project in the registry');
    expect(latest!.keys[LOCAL_PROJECT]).toBe(LABEL);
    expect(latest!.keys[OTHER]).toBe(`id:${OTHER}`);
    const inLocal = uuid();
    const inOther = uuid();
    // each project known to the hub, as a machine's sminos hello makes it, so its listings are kept
    for (const id of [LOCAL_PROJECT, OTHER]) mini.endpoint.hub.openProject(id, { hello: () => ({ name: 'tool', have: {} }), down: () => {} });
    await mini.endpoint.listings.report({ session: inLocal, project: LOCAL_PROJECT, lane: 'A', state: 'busy', title: 'In the local project', owners: ['@machine'] });
    await mini.endpoint.listings.report({ session: inOther, project: OTHER, lane: 'A', state: 'busy', title: 'In the other project', owners: ['@machine'] });
    await until(() => rowOf(inLocal) && rowOf(inOther), 'both rows');
    expect(rowOf(inLocal)!.orgKey).toBe(LABEL);
    expect(rowOf(inOther)!.orgKey).toBe(`id:${OTHER}`);
  });

  it('drops a retired machine’s locations', async () => {
    const vm = await machine('reg-vm');
    const ON_VM = uuid();
    vm.index.declare('/home/vm/work', ON_VM);
    await until(() => project(ON_VM), 'the vm’s project in the registry');
    const pub = (await org.served()).head.state.machines.find((m) => m.ref === vm.ref)!.pub;
    const kid = await keyId(pub);
    await org.amend((state) => {
      state.retired.push({ keyId: kid, pub, notAfter: new Date().toISOString(), holder: { machine: vm.ref } });
      state.machines = state.machines.filter((m) => m.ref !== vm.ref);
    });
    await until(() => project(ON_VM) === undefined && latest, 'the vm’s project gone');
    expect(project(SCRAPE)).toBeDefined();
  });

  it('still lists the project after a relaunch with the hub stopped', async () => {
    await until(() => project(SCRAPE), 'the project before');
    await rows.close();
    await registry.close();
    feed.close();
    await session.close();
    await org.stop();
    latest = null;

    const again = orgSession({ userData: profile, build: 'registry-main-local', log: (l) => void logs.push(l) });
    await again.loaded;
    session = again;
    ({ feed, registry, rows } = startApp(again));
    await registry.loaded;
    await until(() => project(SCRAPE), 'the project from the file');
    expect(project(SCRAPE)!.locations.map((l) => l.path)).toEqual(['/srv/scrape']);
    expect(feed.connected()).toBe(false);
  });
});
