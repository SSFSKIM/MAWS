// The project registry's endpoint half on fakes (docs/doperpowers/plans/2026-11-10-project-registry.md, M9; Interfaces §H,
// §D): the machine's own projects record signed from the index's snapshot, sent again byte for byte, signed above the
// floor the hub's copy gives, never from an index that is not loaded, and the statements a rebuilt index takes back; the
// locations sminos is told, their `gen` raised by an anchor alone; the other machines' records held by their marks,
// dropped once their machine is retired, and `complete` as §D defines it; and the seam the machine's services ask.
import { generateSigningKey, keyId, NO_CERTIFICATES, signRecord, SIGNING_DOMAINS, verifyProjectsRecord, type OrgState, type ProjectsRecord, type Signed, type SigningKey } from 'org-protocol';
import { machineProjectId } from 'desk-hub/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { DeclaredRow, KeptStatement, ProjectsSource } from '../../src/shared/machine/registry';
import type { HubUpFrame } from '../../src/endpoint/hub-link';
import { HeldProjects, type HeldMachines } from '../../src/endpoint/projects-held';
import { OwnProjects, type OwnContext } from '../../src/endpoint/projects';
import { Registry, RESTATE_WAIT_MS, type SminosView } from '../../src/endpoint/registry';
import { NO_PROJECTS_KEPT, type ProjectsKeptFile } from '../../src/endpoint/state/store';
import { mintRef } from './fake-services';
import { genesis, memberId, newDevice, successor } from './org-fixtures';

const ORG = 'org-registry';
const ANCHOR = { dev: '16777232', ino: '4242', birth: '1731234567000000000' };

/** A declared row as the index states it: a minted plain folder unless `fields` says otherwise. */
const row = (path: string, fields: Partial<DeclaredRow> = {}): DeclaredRow => ({
  pid: `pid-${path.split('/').pop()}`,
  path,
  name: path.split('/').pop()!,
  org: { key: `folder:r:${path}` as DeclaredRow['org']['key'], name: path.split('/').pop()!, source: 'folder', smnsId: `id-${path.split('/').pop()}` },
  stated: 'minted',
  statedAt: path,
  ...fields,
});
const statement = (path: string, fields: Partial<KeptStatement> = {}): KeptStatement => ({ path, minted: `id-${path.split('/').pop()}`, linked: null, anchor: ANCHOR, name: path.split('/').pop()!, nameRev: null, hidden: false, ...fields });

/** The index's side: a snapshot a test sets, and what it was asked to restore. */
class FakeSource implements ProjectsSource {
  value: ReturnType<ProjectsSource['snapshot']> = null;
  restored: KeptStatement[][] = [];
  readonly #listeners = new Set<() => void>();
  snapshot() {
    return this.value === null ? null : structuredClone(this.value);
  }
  restore(statements: readonly KeptStatement[]) {
    this.restored.push([...statements]);
  }
  onChange(listener: () => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  set(rows: DeclaredRow[], statements: KeptStatement[] = [], indexId = 'index-1') {
    this.value = { indexId, rows, statements };
    for (const listener of this.#listeners) listener();
  }
}

async function world() {
  const admin = memberId();
  const device = await newDevice('a1');
  const recovery = await generateSigningKey();
  const ref = mintRef();
  const other = mintRef();
  const machineKey: SigningKey = await generateSigningKey();
  const otherKey: SigningKey = await generateSigningKey();
  let head = await successor(await genesis(ORG, admin, device, recovery), [device], (s) => {
    s.machines.push({ name: 'mini', ref, pub: machineKey.pub, owners: [admin] });
    s.machines.push({ name: 'vm', ref: other, pub: otherKey.pub, owners: [admin] });
    s.machineNames.push({ name: 'mini', ref }, { name: 'vm', ref: other });
  });
  const kid = await keyId(machineKey.pub);
  let kept: ProjectsKeptFile = NO_PROJECTS_KEPT;
  let held: HeldMachines = {};
  let clock = Date.parse('2026-11-10T10:00:00.000Z');
  let keeps = true;
  const sent: HubUpFrame[] = [];
  const told: number[] = [];
  const lines: string[] = [];
  const source = new FakeSource();
  let known: Array<{ id: string; name: string }> = [];
  const ctx: OwnContext = {
    ref: () => ref,
    enrollment: () => ({ org: ORG, name: 'mini' }),
    key: () => ({ key: machineKey, keyId: kid }),
    head: () => ({ state: head.state, certificates: NO_CERTIFICATES }),
    now: () => clock,
    send: (frame) => (sent.push(frame), true),
    hubKeeps: () => keeps,
    source,
    store: { read: () => kept, write: (file) => void (kept = structuredClone(file)) },
    known: () => known,
    moved: () => void told.push(clock),
    log: (line) => void lines.push(line),
  };
  /** A record of the other machine (`vm`), signed by its key. */
  const otherRecord = async (revision: number, locations: ProjectsRecord['locations'] = [], key = otherKey): Promise<Signed<ProjectsRecord>> =>
    signRecord(SIGNING_DOMAINS.projects, { org: ORG, machine: other, revision, issued: new Date(clock).toISOString(), locations, known: [] }, key.privateKey, key.pub);
  const vmLocation = (id: string, path = '/srv/scrape'): ProjectsRecord['locations'][number] => ({ pid: 'vm-pid', id, key: `folder:${other}:vm-pid`, name: 'scrape', path, source: 'folder', stated: 'minted' });
  return {
    admin,
    ref,
    other,
    machineKey,
    kid,
    ctx,
    source,
    sent,
    told,
    lines,
    otherRecord,
    vmLocation,
    records: () => sent.filter((f): f is { t: 'projects'; record: Signed<ProjectsRecord> } => f.t === 'projects').map((f) => f.record),
    get kept() {
      return kept;
    },
    set kept(file: ProjectsKeptFile) {
      kept = file;
    },
    get held() {
      return held;
    },
    heldStore: { read: () => held, write: (machines: HeldMachines) => void (held = structuredClone(machines)) },
    get head() {
      return head;
    },
    tick: (ms = 1) => void (clock += ms),
    keeps: (on: boolean) => void (keeps = on),
    setKnown: (next: Array<{ id: string; name: string }>) => void (known = next),
    async amend(edit: (s: OrgState) => void) {
      head = await successor(head, [device], edit);
    },
  };
}

describe('the machine’s own projects record', () => {
  it('is signed from the snapshot, verifies under the head, and is signed again only when its content changes', async () => {
    const w = await world();
    const own = new OwnProjects(w.ctx);
    w.source.set([row('/Users/me/scrape')], [statement('/Users/me/scrape')]);
    await own.publish();
    const [first] = w.records();
    expect(await verifyProjectsRecord(w.head.state, first, NO_CERTIFICATES, new Date())).toEqual({ ok: true });
    expect(first.body.locations).toEqual([{ pid: 'pid-scrape', id: 'id-scrape', key: 'folder:r:/Users/me/scrape', name: 'scrape', path: '/Users/me/scrape', source: 'folder', stated: 'minted' }]);
    expect(w.kept.record).toEqual(first); // kept before it was sent
    w.tick();
    await own.publish();
    expect(w.records()).toHaveLength(1);
    w.source.set([row('/Users/me/scrape'), row('/Users/me/other')], [statement('/Users/me/scrape'), statement('/Users/me/other')]);
    await own.publish();
    expect(w.records()).toHaveLength(2);
    expect(w.records()[1].body.revision).toBeGreaterThan(first.body.revision);
  });

  it('carries a row of the machine’s own project with that id, and `known` less the located and the machines’ own', async () => {
    const w = await world();
    const own = new OwnProjects(w.ctx);
    const home = row('/Users/me', { org: { key: 'folder:r:/Users/me' as DeclaredRow['org']['key'], name: 'me', source: 'folder', smnsId: null }, stated: undefined, statedAt: undefined });
    w.setKnown([
      { id: 'id-held', name: 'held here' },
      { id: 'id-scrape', name: 'located here' },
      { id: machineProjectId(ORG, 'vm'), name: 'vm' },
      { id: 'not an id!', name: 'odd' },
    ]);
    w.source.set([home, row('/Users/me/scrape')]);
    await own.publish();
    const body = w.records()[0].body;
    expect(body.locations.find((l) => l.path === '/Users/me')?.id).toBe(machineProjectId(ORG, 'mini'));
    expect(body.known).toEqual([{ id: 'id-held', name: 'held here' }]);
  });

  it('signs and sends nothing while the index is not loaded, and sends the kept record again byte for byte at a welcome', async () => {
    const w = await world();
    const own = new OwnProjects(w.ctx);
    await own.publish();
    await own.welcome();
    own.snapshotEnded();
    await own.settled();
    expect(w.sent).toEqual([]);
    w.source.set([row('/Users/me/scrape')], [statement('/Users/me/scrape')]);
    await own.publish();
    w.source.value = null; // the spine released
    const later = new OwnProjects(w.ctx); // a restart
    await later.welcome();
    later.snapshotEnded();
    expect(w.records()).toHaveLength(2);
    expect(JSON.stringify(w.records()[1])).toBe(JSON.stringify(w.records()[0]));
  });

  it('signs nothing new after a welcome until the hub’s snapshot ended, which carries the floor', async () => {
    const w = await world();
    const own = new OwnProjects(w.ctx);
    w.source.set([row('/Users/me/scrape')]);
    await own.publish();
    await own.welcome();
    expect(w.records()).toHaveLength(2); // the kept record again
    w.source.set([row('/Users/me/scrape'), row('/Users/me/other')]);
    await own.publish();
    expect(w.records()).toHaveLength(2);
    own.snapshotEnded();
    await own.settled();
    expect(w.records()).toHaveLength(3);
    expect(w.records()[2].body.locations).toHaveLength(2);
  });

  it('is sent only to a hub whose welcome lists `projects`, and kept all the same', async () => {
    const w = await world();
    w.keeps(false);
    const own = new OwnProjects(w.ctx);
    w.source.set([row('/Users/me/scrape')]);
    await own.publish();
    expect(w.sent).toEqual([]);
    expect(w.kept.record?.body.locations).toHaveLength(1);
  });

  it('is signed above the hub’s own copy when that copy is not the kept one, its revision past a clock behind it', async () => {
    const w = await world();
    const own = new OwnProjects(w.ctx);
    w.source.set([row('/Users/me/scrape')]);
    await own.publish();
    const kept = w.records()[0];
    // the hub holds a record of this machine from before a lost state directory, far ahead of the clock
    const ahead = await signRecord(SIGNING_DOMAINS.projects, { ...kept.body, revision: kept.body.revision + 10_000_000, locations: [] }, w.machineKey.privateKey, w.machineKey.pub);
    await own.ownSeen(ahead);
    const next = w.records()[1];
    expect(next.body.revision).toBe(ahead.body.revision + 1);
    expect(next.body.locations).toEqual(kept.body.locations);
    // the same record shown again, or an older one, signs nothing
    await own.ownSeen(next);
    await own.ownSeen(kept);
    expect(w.records()).toHaveLength(2);
  });

  it('signs above the hub’s copy once the snapshot ended, when that copy came while the snapshot was awaited', async () => {
    const w = await world();
    const own = new OwnProjects(w.ctx);
    w.source.set([row('/Users/me/scrape')]);
    await own.publish();
    const kept = w.records()[0];
    await own.welcome();
    const ahead = await signRecord(SIGNING_DOMAINS.projects, { ...kept.body, revision: kept.body.revision + 10_000_000 }, w.machineKey.privateKey, w.machineKey.pub);
    await own.ownSeen({ ...ahead, body: { ...ahead.body } });
    expect(w.records()).toHaveLength(2); // the resend at the welcome alone
    own.snapshotEnded();
    await own.settled();
    expect(w.records()).toHaveLength(3);
    expect(w.records()[2].body.revision).toBe(ahead.body.revision + 1);
  });

  it('gives a rebuilt index its statements back before anything is signed from it, and takes the new index’s id', async () => {
    const w = await world();
    const own = new OwnProjects(w.ctx);
    const kept = [statement('/Users/me/scrape', { linked: 'id-elsewhere' }), statement('/Users/me/gone', { hidden: true })];
    w.source.set([row('/Users/me/scrape')], kept, 'index-1');
    await own.publish();
    const before = w.records().length;
    w.source.set([], [], 'index-2'); // a new index: no rows, no statements
    await own.publish();
    expect(w.source.restored).toEqual([kept]);
    expect(w.records()).toHaveLength(before); // nothing signed from the empty index
    expect(w.kept.indexId).toBe('index-2');
    expect(w.kept.statements).toEqual(kept);
    // an upgraded index (no kept statements before it) restores nothing
    const fresh = await world();
    const first = new OwnProjects(fresh.ctx);
    fresh.source.set([row('/Users/me/scrape')], [statement('/Users/me/scrape')], 'index-9');
    await first.publish();
    expect(fresh.source.restored).toEqual([]);
    expect(fresh.records()).toHaveLength(1);
  });

  it('tells sminos the locations, `stated` and `anchor` at a statement’s own folder, its gen raised by an anchor alone', async () => {
    const w = await world();
    const own = new OwnProjects(w.ctx);
    const sub = row('/Users/me/scrape/sub', { org: { key: 'folder:r:/Users/me/scrape/sub' as DeclaredRow['org']['key'], name: 'sub', source: 'folder', smnsId: 'id-scrape' }, statedAt: '/Users/me/scrape' });
    const replaced = row('/Users/me/old', { state: 'replaced', stated: undefined, statedAt: undefined });
    w.source.set([row('/Users/me/scrape'), sub, replaced], [statement('/Users/me/scrape'), statement('/Users/me/old')]);
    await own.publish();
    const first = own.locations()!;
    expect(first.at).toEqual([
      { path: '/Users/me/old', project: 'id-old', state: 'replaced' },
      { path: '/Users/me/scrape', project: 'id-scrape', stated: 'minted', anchor: ANCHOR },
      { path: '/Users/me/scrape/sub', project: 'id-scrape' },
    ]);
    const records = w.records().length;
    w.tick(5);
    // "Use this folder" at the same path: a new anchor, nothing new in the record
    w.source.set([row('/Users/me/scrape'), sub, replaced], [statement('/Users/me/scrape', { anchor: { ...ANCHOR, ino: '4343' } }), statement('/Users/me/old')]);
    await own.publish();
    expect(w.records()).toHaveLength(records);
    expect(own.locations()!.gen).toBeGreaterThan(first.gen);
    expect(own.locations()!.at[1].anchor?.ino).toBe('4343');
    // with the index released and a restart, the kept record and statements say the same
    w.source.value = null;
    const later = new OwnProjects(w.ctx);
    expect(later.locations()!.at).toEqual(own.locations()!.at);
  });

  it('fits a record within §A’s bounds, and refuses one past the thousand locations', async () => {
    const w = await world();
    const own = new OwnProjects(w.ctx);
    const rows = Array.from({ length: 1000 }, (_, i) => row(`/Users/me/f${i}`));
    expect(own.fits(rows)).toBe(true);
    expect(own.fits([...rows, row('/Users/me/f1000')])).toBe(false);
  });
});

describe('the other machines’ held records', () => {
  const held = (w: Awaited<ReturnType<typeof world>>, seen: Array<Signed<ProjectsRecord>> = []) =>
    new HeldProjects({ ref: () => w.ref, ownKeyId: () => w.kid, head: () => ({ state: w.head.state, certificates: NO_CERTIFICATES }), now: Date.now, store: w.heldStore, own: (r) => void seen.push(r), changed: () => {}, snapshotEnded: () => {}, log: (line) => void w.lines.push(line) });

  it('keeps a verified record above its mark, ignores one below it and a conflict at it, and verifies before keeping', async () => {
    const w = await world();
    const h = held(w);
    const r5 = await w.otherRecord(5, [w.vmLocation('id-scrape')]);
    await h.frame({ t: 'projects', record: r5 });
    expect(h.records()).toEqual([r5.body]);
    await h.frame({ t: 'projects', record: await w.otherRecord(4) });
    await h.frame({ t: 'projects', record: await w.otherRecord(5, [w.vmLocation('id-other')]) });
    expect(h.records()).toEqual([r5.body]);
    expect(w.lines.some((l) => l.includes('other content than the one held'))).toBe(true);
    await h.frame({ t: 'projects', record: await w.otherRecord(6, [], w.machineKey) }); // signed by another machine's key
    expect(h.records()).toEqual([r5.body]);
    const r7 = await w.otherRecord(7);
    await h.frame({ t: 'projects', record: r7 });
    expect(h.records()).toEqual([r7.body]);
  });

  it('hands this machine’s own record on as the floor, verified under its own key, and holds none of it', async () => {
    const w = await world();
    const seen: Array<Signed<ProjectsRecord>> = [];
    const h = held(w, seen);
    const mine = await signRecord(SIGNING_DOMAINS.projects, { org: ORG, machine: w.ref, revision: 9, issued: new Date().toISOString(), locations: [], known: [] }, w.machineKey.privateKey, w.machineKey.pub);
    await h.frame({ t: 'projects-all', records: [mine], last: true });
    expect(seen).toEqual([mine]);
    expect(h.records()).toEqual([]);
  });

  it('drops a retired machine’s record at the next head, and the hub’s snapshot removes nothing', async () => {
    const w = await world();
    const h = held(w);
    await h.frame({ t: 'projects', record: await w.otherRecord(5) });
    h.welcomed(true);
    await h.frame({ t: 'projects-all', records: [], last: true }); // a snapshot that lacks it
    expect(h.records()).toHaveLength(1);
    await w.amend((s) => void (s.machines = s.machines.filter((m) => m.ref !== w.other)));
    await h.adopted();
    expect(h.records()).toEqual([]);
  });

  it('is complete once this connection’s snapshot ended holding every machine held at or above its mark, and not after the connection ends', async () => {
    const w = await world();
    const h = held(w);
    const r5 = await w.otherRecord(5);
    expect(h.complete()).toBe(false);
    h.welcomed(true);
    await h.frame({ t: 'projects-all', records: [r5], last: false });
    expect(h.complete()).toBe(false);
    await h.frame({ t: 'projects-all', records: [], last: true });
    expect(h.complete()).toBe(true);
    // a later record raises the mark: still complete, the snapshot having seen it live
    await h.frame({ t: 'projects', record: await w.otherRecord(6) });
    expect(h.complete()).toBe(true);
    h.ended();
    expect(h.complete()).toBe(false);
    // a new connection's snapshot that lacks a machine held here is not complete
    h.welcomed(true);
    await h.frame({ t: 'projects-all', records: [], last: true });
    expect(h.complete()).toBe(false);
    // a hub whose welcome does not list `projects` sends no snapshot: never complete
    h.welcomed(false);
    expect(h.complete()).toBe(false);
  });
});

describe('the registry seam', () => {
  async function registry(w: Awaited<ReturnType<typeof world>>, options: { sminos?: SminosView | null; enrolled?: boolean; kept?: (gen: number, ms: number) => Promise<boolean> } = {}) {
    let state = { projects: w.kept, projectsHeld: w.held };
    const fakeState = {
      get projects() {
        return state.projects;
      },
      get projectsHeld() {
        return state.projectsHeld;
      },
      setProjects: (file: ProjectsKeptFile) => void (state = { ...state, projects: structuredClone(file) }),
      setProjectsHeld: (machines: HeldMachines) => void (state = { ...state, projectsHeld: structuredClone(machines) }),
    };
    let sminos = options.sminos ?? null;
    const asked: Array<[number, number]> = [];
    const r = new Registry({
      ref: () => w.ref,
      enrollment: () => (options.enrolled === false ? null : { org: ORG, name: 'mini' }),
      key: w.ctx.key,
      head: w.ctx.head,
      now: Date.now,
      hub: { send: () => true, capabilities: () => ['projects'] },
      sminos: () => sminos,
      source: w.source,
      state: () => fakeState as never,
      restate: () => {},
      locationsKept: (gen, ms) => (asked.push([gen, ms]), options.kept?.(gen, ms) ?? Promise.resolve(false)),
      log: () => {},
    });
    return { r, asked, file: () => state.projects, setSminos: (next: SminosView | null) => void (sminos = next) };
  }
  const view = (capabilities: string[], fields: Partial<SminosView> = {}): SminosView => ({ capabilities, restating: false, sessionProjects: () => [], logProjects: () => [], ...fields });

  it('makes statements possible on an enrolled machine whose sminos reads locations, remembering the last sminos’s answer while none is connected', async () => {
    const w = await world();
    expect((await registry(w, { enrolled: false })).r.statements()).toEqual({ possible: false, reason: 'not-enrolled' });
    const { r, setSminos, file } = await registry(w);
    expect(r.statements()).toEqual({ possible: false, reason: 'sminos-too-old' });
    let turns = 0;
    r.onStatements(() => turns++);
    setSminos(view(['audience', 'locations']));
    r.sminosLinked();
    expect(r.statements()).toEqual({ possible: true });
    expect(file().sminosLocations).toBe(true);
    setSminos(null); // sminos restarting
    expect(r.statements()).toEqual({ possible: true });
    setSminos(view(['audience']));
    r.sminosLinked();
    expect(r.statements()).toEqual({ possible: false, reason: 'sminos-too-old' });
    expect(turns).toBe(2);
  });

  it('answers a project of the verified records with its hub and highest name counter, none for an unknown id or a machine’s own', async () => {
    const w = await world();
    const { r } = await registry(w);
    await r.held.frame({ t: 'projects', record: await w.otherRecord(5, [{ ...w.vmLocation('id-scrape'), nameRev: 3 }, { ...w.vmLocation('id-git', '/srv/git'), pid: 'vm-pid-2', hub: false }]) });
    expect(r.project('id-scrape')).toEqual({ hub: true, nameRev: 3 });
    expect(r.project('id-git')).toEqual({ hub: false, nameRev: 0 });
    expect(r.project('id-none')).toBeNull();
    expect(r.project(machineProjectId(ORG, 'vm'))).toBeNull();
    expect(r.directory().hub).toEqual([{ id: 'id-scrape', name: 'scrape' }]);
  });

  it('counts as `known` a project sminos holds with sessions here, and keeps the last answer while sminos restates', async () => {
    const w = await world();
    const sessions = ['id-held', 'id-followed'];
    const { r, setSminos } = await registry(w, {
      sminos: view(['locations'], { sessionProjects: () => sessions, logProjects: () => [{ project: 'id-held', name: 'Held', follow: false }, { project: 'id-followed', name: 'Followed', follow: true }, { project: 'id-idle', name: 'Idle', follow: false }] }),
    });
    w.source.set([row('/Users/me/scrape')]);
    await r.own.publish();
    expect(r.own.record()?.body.known).toEqual([{ id: 'id-held', name: 'Held' }]);
    setSminos(view(['locations'], { restating: true }));
    w.source.set([row('/Users/me/scrape'), row('/Users/me/other')]);
    await r.own.publish();
    expect(r.own.record()?.body.known).toEqual([{ id: 'id-held', name: 'Held' }]);
  });

  it('answers a statement change once sminos acknowledged the locations that carry it, unrestated with no sminos that reads them', async () => {
    const w = await world();
    expect(await (await registry(w)).r.published()).toEqual({ restated: false });
    const acked = await registry(w, { sminos: view(['locations']), kept: async () => true });
    w.source.set([row('/Users/me/scrape')], [statement('/Users/me/scrape')]);
    expect(await acked.r.published()).toEqual({ restated: true });
    expect(acked.asked).toEqual([[acked.r.own.locations()!.gen, RESTATE_WAIT_MS]]);
    const silent = await registry(w, { sminos: view(['locations']), kept: async () => false });
    expect(await silent.r.published()).toEqual({ restated: false });
  });
});

// M9's review 1 (.doperpowers/sde/2026-11-10-project-registry/task-9-review-1.md): each finding, reproduced
describe('review 1', () => {
  const heldWith = (w: Awaited<ReturnType<typeof world>>, certificates = NO_CERTIFICATES) =>
    new HeldProjects({ ref: () => w.ref, ownKeyId: () => w.kid, head: () => ({ state: w.head.state, certificates }), now: () => Date.now(), store: w.heldStore, own: () => {}, changed: () => {}, snapshotEnded: () => {}, log: (line) => void w.lines.push(line) });
  const view = (capabilities: string[], fields: Partial<SminosView> = {}): SminosView => ({ capabilities, restating: false, sessionProjects: () => [], logProjects: () => [], ...fields });
  /** A registry over the world's kept files, as the endpoint builds it. */
  function registryOf(w: Awaited<ReturnType<typeof world>>, options: { sminos?: SminosView | null; kept?: (gen: number) => Promise<boolean>; refuseWrite?: (next: ProjectsKeptFile, now: ProjectsKeptFile) => boolean } = {}) {
    const sent: HubUpFrame[] = [];
    const asked: number[] = [];
    let sminos = options.sminos ?? null;
    const fakeState = {
      get projects() {
        return w.kept;
      },
      get projectsHeld() {
        return w.held;
      },
      setProjects: (file: ProjectsKeptFile) => {
        if (options.refuseWrite?.(file, w.kept) === true) throw new Error('ENOSPC: no space left on device');
        w.kept = structuredClone(file);
      },
      setProjectsHeld: (machines: HeldMachines) => w.heldStore.write(machines),
    };
    const r = new Registry({
      ref: () => w.ref,
      enrollment: () => ({ org: ORG, name: 'mini' }),
      key: w.ctx.key,
      head: w.ctx.head,
      now: Date.now,
      hub: { send: (frame) => (sent.push(frame), true), capabilities: () => ['projects'] },
      sminos: () => sminos,
      source: w.source,
      state: () => fakeState as never,
      restate: () => {},
      locationsKept: (gen) => (asked.push(gen), options.kept?.(gen) ?? Promise.resolve(false)),
      log: (line) => void w.lines.push(line),
    });
    return { r, sent, asked, setSminos: (next: SminosView | null) => void (sminos = next) };
  }
  const records = (sent: HubUpFrame[]) => sent.filter((f): f is { t: 'projects'; record: Signed<ProjectsRecord> } => f.t === 'projects').map((f) => f.record);

  it('F2: a restart with the index unloaded tells sminos the locations it was last told, never one rebuilt from a record the signing hold kept behind', async () => {
    const w = await world();
    const own = new OwnProjects(w.ctx);
    w.source.set([row('/Users/me/scrape')], [statement('/Users/me/scrape')]);
    await own.publish();
    await own.welcome(); // the hub keeps records: new signatures wait for its snapshot
    const linked = row('/Users/me/scrape', { org: { key: 'folder:r:/Users/me/scrape' as DeclaredRow['org']['key'], name: 'scrape', source: 'folder', smnsId: 'id-b' }, stated: 'linked' });
    w.source.set([linked], [statement('/Users/me/scrape', { linked: 'id-b' })]);
    await own.publish();
    expect(own.locations()!.at).toEqual([{ path: '/Users/me/scrape', project: 'id-b', stated: 'linked', anchor: ANCHOR }]);
    expect(w.kept.record!.body.locations[0].id).toBe('id-scrape'); // the record still A's: held
    w.source.value = null; // a restart with the index not loaded
    const later = new OwnProjects(w.ctx);
    expect(later.locations()).toEqual(own.locations());
  });

  it('F3: a record whose write failed is neither sent nor kept, and the next one is signed above it', async () => {
    const w = await world();
    let refusing = true;
    const { r, sent } = registryOf(w, { refuseWrite: (next, now) => refusing && next.record !== null && JSON.stringify(next.record) !== JSON.stringify(now.record) });
    w.source.set([row('/Users/me/scrape')]);
    await r.own.publish();
    expect(records(sent)).toEqual([]);
    expect(r.own.record()).toBeNull();
    expect(w.lines.some((l) => l.includes('ENOSPC'))).toBe(true);
    refusing = false;
    w.source.set([row('/Users/me/scrape'), row('/Users/me/other')]);
    await r.own.publish();
    expect(records(sent)).toHaveLength(1);
    expect(records(sent)[0]).toEqual(r.own.record());
  });

  it('F4: held records read from the file count only once verified again, and a record whose authority lapsed with time is dropped then, with no new head', async () => {
    const w = await world();
    const r5 = await w.otherRecord(5);
    const gone = mintRef();
    const goneKey = await generateSigningKey();
    const orphan = await signRecord(SIGNING_DOMAINS.projects, { org: ORG, machine: gone, revision: 3, issued: new Date().toISOString(), locations: [], known: [] }, goneKey.privateKey, goneKey.pub);
    w.heldStore.write({ [w.other]: { revision: 5, hash: 'h5', keyId: r5.sig.kid, record: r5 }, [gone]: { revision: 3, hash: 'h3', keyId: orphan.sig.kid, record: orphan } });
    const h = heldWith(w); // a start: the file as the last run left it
    expect(h.records()).toEqual([]);
    await h.adopted();
    expect(h.records()).toEqual([r5.body]);
    expect(Object.keys(w.held)).toEqual([w.other]);

    // a delegated machine: its authority is its delegation's, which expires
    const delegationKey = await generateSigningKey();
    const dKey = await generateSigningKey();
    const dId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    const dRef = mintRef(dId); // a delegated machine's ref is its delegation's
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      await w.amend((s) => void s.delegations.push({ id: dId, pub: delegationKey.pub, prefix: 'dl-', expires: new Date(Date.now() + 60_000).toISOString(), maxUses: 10, offlineRevokeS: 0, owners: [w.admin] }));
      const cert = await signRecord(SIGNING_DOMAINS.machineCert, { org: ORG, machine: dRef, name: 'dl-one', pub: dKey.pub, delegation: dId, use: 1, issued: new Date().toISOString() }, delegationKey.privateKey, delegationKey.pub);
      const delegated = heldWith(w, { certs: [cert], retirements: [] });
      await delegated.adopted();
      const record = await signRecord(SIGNING_DOMAINS.projects, { org: ORG, machine: dRef, revision: 2, issued: new Date().toISOString(), locations: [], known: [] }, dKey.privateKey, dKey.pub);
      await delegated.frame({ t: 'projects', record });
      expect(delegated.records().map((b) => b.machine)).toContain(dRef);
      await vi.advanceTimersByTimeAsync(61_000);
      await delegated.settled();
      expect(delegated.records().map((b) => b.machine)).not.toContain(dRef);
      delegated.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('F5: a machine counts as seen in the snapshot only by a record that verified, or the very one held', async () => {
    const w = await world();
    const h = heldWith(w);
    await h.frame({ t: 'projects', record: await w.otherRecord(5) });
    h.welcomed(true);
    await h.frame({ t: 'projects-all', records: [await w.otherRecord(6, [], w.machineKey)], last: true }); // signed by another machine's key
    expect(h.complete()).toBe(false);
    h.welcomed(true);
    await h.frame({ t: 'projects-all', records: [await w.otherRecord(5, [w.vmLocation('id-other')])], last: true }); // a conflict at the mark
    expect(h.complete()).toBe(false);
    h.welcomed(true);
    await h.frame({ t: 'projects-all', records: [w.held[w.other].record], last: true });
    expect(h.complete()).toBe(true);
  });

  it('F6: a page queued from a connection that ended does not complete the next connection’s snapshot', async () => {
    const w = await world();
    const h = heldWith(w);
    const r5 = await w.otherRecord(5);
    await h.frame({ t: 'projects', record: r5 });
    h.welcomed(true);
    const queued = h.frame({ t: 'projects-all', records: [r5], last: true });
    h.ended(); // the connection drops before its page was taken, and another is welcomed
    h.welcomed(true);
    await queued;
    expect(h.complete()).toBe(false);
  });

  it('F7: a statement change made while the index is not loaded is answered unrestated, whatever sminos acknowledged before', async () => {
    const w = await world();
    const acknowledged = new Set<number>();
    const { r, asked } = registryOf(w, { sminos: view(['locations']), kept: async (gen) => (acknowledged.add(gen), true) });
    w.source.set([row('/Users/me/scrape')], [statement('/Users/me/scrape')]);
    expect(await r.published()).toEqual({ restated: true });
    expect(asked).toHaveLength(1);
    w.source.value = null; // the spine released: this change's locations are never built
    expect(await r.published()).toEqual({ restated: false });
    expect(asked).toHaveLength(1);
  });

  it('F8: after a restart with sminos away, the record keeps the known projects the kept record carried', async () => {
    const w = await world();
    const first = registryOf(w, { sminos: view(['locations'], { sessionProjects: () => ['id-held'], logProjects: () => [{ project: 'id-held', name: 'Held', follow: false }] }) });
    w.source.set([row('/Users/me/scrape')]);
    await first.r.own.publish();
    expect(w.kept.record!.body.known).toEqual([{ id: 'id-held', name: 'Held' }]);
    const later = registryOf(w); // a restart: no sminos connected yet
    w.source.set([row('/Users/me/scrape'), row('/Users/me/other')]);
    await later.r.own.publish();
    expect(w.kept.record!.body.locations).toHaveLength(2);
    expect(w.kept.record!.body.known).toEqual([{ id: 'id-held', name: 'Held' }]);
  });
});
