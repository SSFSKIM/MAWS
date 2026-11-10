// The project registry's endpoint half against the hub itself (docs/doperpowers/plans/2026-11-10-project-registry.md, M9's
// Proves): desk-hub's Worker in Miniflare (miniflare-hub.ts) and two endpoints enrolled and listed in a throwaway org,
// each with a stand-in index (`StandInIndex`, the `ProjectsSource` mawsd hands it) and sminos's stand-in on its RL10
// socket advertising `locations` (sminos's M5 is not merged). A folder declared on A is in B's held records, and B's org
// frame lists its project as a hub project, `complete` once the hub's snapshot ended; after B restarts with the hub out of
// reach it still does, incomplete. An index that is not loaded signs nothing. An endpoint started on a state file older
// than what the hub holds, its clock behind that revision, is refused once, takes its floor from its own record in the
// hub's snapshot, and its next record is stored. A replaced index takes its statements back from the kept file, and the
// next record carries the same ids. A statement change's answer waits for sminos's acknowledgement, and answers
// `restated: false` after the wait. Across a restart sminos's stand-in is told the same locations. A retired machine's
// record is dropped, and its project leaves B's directory.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { base64urlEncode, generateSigningKey, keyId, type OrgState, type ProjectsRecord, type Signed, type SignedOrgState, type SigningKey } from 'org-protocol';
import { encodeEnrollmentCodeV2, type EnrollmentIssued, type EnrollmentKey } from 'desk-hub/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import type { DeclaredRow, KeptStatement, ProjectsSource } from '../../src/shared/machine/registry';
import { fakeServices, type FakeServices } from './fake-services';
import { ADMIN, ORG, startMiniflareHub, type LocalHub } from './miniflare-hub';
import { genesis, newDevice, successor, type TestDevice } from './org-fixtures';
import { FakeSminos, type Frame } from './rl10/fake-sminos';

let hub: LocalHub;
let stopHub: () => Promise<void>;
let a1: TestDevice;
let recovery: SigningKey;
let head: SignedOrgState;
let A: string;
const started: Array<{ endpoint: Endpoint; services?: FakeServices }> = [];
const sminoses: FakeSminos[] = [];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until<T>(check: () => T | Promise<T>, what: string, ms = 15_000): Promise<NonNullable<T>> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = await check();
    if (found) return found as NonNullable<T>;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(25);
  }
}

async function accept(edit: (s: OrgState) => void | Promise<void>): Promise<void> {
  const next = await successor(head, [a1], edit);
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: next });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
  head = next;
}

beforeAll(async () => {
  ({ hub, stop: stopHub } = await startMiniflareHub());
  A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
  head = await genesis(ORG, A, a1, recovery);
  expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
}, 120_000);

afterAll(async () => {
  for (const s of sminoses) s.close();
  for (const { endpoint, services } of started) {
    await endpoint.stop();
    services?.cleanup();
  }
  await stopHub?.();
});

const ANCHOR = { dev: '16777232', ino: '77', birth: '1731234567000000000' };

/** The index's side as mawsd hands it: its declared rows and statements, and the restore a rebuilt index takes. */
class StandInIndex implements ProjectsSource {
  value: ReturnType<ProjectsSource['snapshot']> = null;
  restored: KeptStatement[][] = [];
  readonly #listeners = new Set<() => void>();
  snapshot() {
    return this.value === null ? null : structuredClone(this.value);
  }
  /** As the index restores: each statement's row back, under the index's id. */
  restore(statements: readonly KeptStatement[]) {
    this.restored.push([...statements]);
    const indexId = this.value?.indexId ?? 'index';
    this.set(statements.filter((s) => !s.hidden).map((s) => folderRow(s.path, s.linked ?? s.minted!)), [...statements], indexId);
  }
  onChange(listener: () => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  set(rows: DeclaredRow[], statements: KeptStatement[], indexId = 'index-1') {
    this.value = { indexId, rows, statements };
    for (const listener of [...this.#listeners]) listener();
  }
  /** A minted plain folder declared at `path`. */
  declare(path: string, id: string, indexId = this.value?.indexId ?? 'index-1') {
    const rows = [...(this.value?.rows ?? []).filter((r) => r.path !== path), folderRow(path, id)];
    const statements = [...(this.value?.statements ?? []).filter((s) => s.path !== path), { path, minted: id, linked: null, anchor: ANCHOR, name: path.split('/').pop()!, nameRev: null, hidden: false }];
    this.set(rows, statements, indexId);
  }
}
const folderRow = (path: string, id: string): DeclaredRow => ({
  pid: `p${Buffer.from(path).toString('hex').slice(-30)}`,
  path,
  name: path.split('/').pop()!,
  org: { key: `folder:x:${path}` as DeclaredRow['org']['key'], name: path.split('/').pop()!, source: 'folder', smnsId: id },
  stated: 'minted',
  statedAt: path,
});

type Listed = { endpoint: Endpoint; services: FakeServices; ref: string; name: string; index: StandInIndex };

/** A started endpoint over `index`, enrolled through its command line and listed by the admin; resolves once its link is welcomed. */
async function listedEndpoint(name: string, index = new StandInIndex()): Promise<Listed> {
  const services = fakeServices();
  const endpoint = createEndpoint({ build: 'registry-suite', sleep: (ms) => sleep(Math.min(ms, 50)), projectsSource: index });
  await endpoint.start(services);
  started.push({ endpoint, services });
  const ref = services.machine.ref;
  const issued = (await (await hub.fetchAs(ADMIN, '/api/enrollments', { body: {} })).json()) as EnrollmentIssued;
  const code = encodeEnrollmentCodeV2({ hub: hub.url, token: issued.token, roots: [await keyId(a1.stepUp.pub)], recoveryPub: recovery.pub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
  const enrolling = endpoint.cli('enroll', ['--name', name, '--wait', '30', '--json'], code);
  const key = await until(async () => {
    const response = await hub.fetchAs(ADMIN, `/api/enrollments/${issued.enrollment.id}/key`);
    return response.status === 200 ? ((await response.json()) as EnrollmentKey) : (await response.body?.cancel(), null);
  }, 'the posted key');
  await accept((s) => {
    s.machines.push({ name, ref, pub: key.pub, owners: [A] });
    s.machineNames.push({ name, ref });
  });
  expect((await enrolling).code).toBe(0);
  await until(() => endpoint.hub.connected, 'the hub link’s welcome');
  return { endpoint, services, ref, name, index };
}

/** The same machine's endpoint started again on its state directory (`now`, its clock), over `index`. */
async function restarted(listed: Listed, options: { index?: StandInIndex; now?: () => number } = {}): Promise<Listed> {
  await listed.endpoint.stop();
  const index = options.index ?? listed.index;
  const services = fakeServices({ ref: listed.services.machine.ref, profileDir: listed.services.machine.profileDir });
  const endpoint = createEndpoint({ build: 'registry-suite', sleep: (ms) => sleep(Math.min(ms, 50)), projectsSource: index, ...(options.now === undefined ? {} : { now: options.now }) });
  await endpoint.start(services);
  started.push({ endpoint });
  return { ...listed, endpoint, services, index };
}

/** sminos's stand-in on the endpoint's RL10 socket, its hello advertising `locations`; `ack`: it acknowledges each kept frame. */
async function attachSminos(listed: Listed, ack = true): Promise<FakeSminos> {
  const path = join(listed.services.machine.stateDir, 'rl10.json');
  await until(() => listed.endpoint.rl10.serving && fs.existsSync(path), 'rl10.json');
  const info = JSON.parse(fs.readFileSync(path, 'utf8')) as { socket: string; token: string };
  const s = await FakeSminos.open(info.socket);
  sminoses.push(s);
  s.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: ['audience', 'record', 'locations'], token: info.token, sminos: { version: 'registry-suite' }, policy: { read_only: false, ceiling: 'settings' } });
  const welcome = await s.next((f) => f.t === 'welcome', 'the RL10 welcome');
  expect(welcome.capabilities).toContain('locations');
  s.send({ t: 'restated' });
  if (ack) {
    let seen = 0;
    const timer = setInterval(() => {
      for (; seen < s.received.length; seen++) {
        const frame = s.received[seen];
        const gen = (frame.locations as { gen?: number } | undefined)?.gen;
        if (frame.t === 'org' && typeof gen === 'number') s.send({ t: 'locations-kept', gen });
      }
      if (s.closed) clearInterval(timer);
    }, 10);
    timer.unref();
  }
  return s;
}

type OrgFrame = Frame & { projects: Array<{ id: string; kind: string; name: string }>; complete?: boolean; locations?: { gen: number; at: Array<Record<string, unknown>> } };
/** The latest org frame sminos's stand-in holds that `match` holds for. */
const orgFrame = (s: FakeSminos, match: (f: OrgFrame) => boolean, what: string) => until(() => [...s.received].reverse().find((f): f is OrgFrame => f.t === 'org' && match(f as OrgFrame)) ?? null, what);
const hubProject = (f: OrgFrame, id: string) => f.projects.some((p) => p.id === id && p.kind === 'hub');
const heldRecord = (listed: Listed, ref: string): Signed<ProjectsRecord> | undefined => listed.endpoint.parts?.state.projectsHeld[ref]?.record;

const uuid = () => crypto.randomUUID();
let pair: { a: Listed; b: Listed; sb: FakeSminos } | null = null;
/** Two machines, A and B, each with sminos's stand-in; made once, the cases building on it in order. */
async function machines(): Promise<{ a: Listed; b: Listed; sb: FakeSminos }> {
  if (pair !== null) return pair;
  const a = await listedEndpoint('reg-a');
  const b = await listedEndpoint('reg-b');
  await attachSminos(a);
  const sb = await attachSminos(b);
  pair = { a, b, sb };
  return pair;
}

describe('a folder declared on one machine', () => {
  it('is in the other machine’s held records, and its org frame lists the project as a hub project once the snapshot ended', async () => {
    const { a, b, sb } = await machines();
    const id = uuid();
    a.index.declare('/srv/scrape', id);
    const record = await until(() => heldRecord(b, a.ref), 'A’s record held by B');
    expect(record.body.locations).toEqual([expect.objectContaining({ id, path: '/srv/scrape', stated: 'minted' })]);
    const frame = await orgFrame(sb, (f) => hubProject(f, id) && f.complete === true, 'B’s org frame listing the project, complete');
    expect(frame.projects.find((p) => p.id === id)?.name).toBe('scrape');
  });

  it('is still listed after the other machine restarts with the hub out of reach, the directory incomplete', async () => {
    const { a, b } = await machines();
    const id = a.index.value!.rows[0].org.smnsId!;
    const enrollment = join(b.services.machine.stateDir, 'enrollment.json');
    const held = fs.readFileSync(enrollment, 'utf8');
    fs.writeFileSync(enrollment, held.replace(JSON.stringify(hub.url), JSON.stringify('http://127.0.0.1:9')), { mode: 0o600 });
    const away = await restarted(b);
    const s = await attachSminos(away);
    const frame = await orgFrame(s, (f) => hubProject(f, id), 'the project listed with the hub away');
    expect(frame.complete).toBe(false);
    expect(away.endpoint.hub.connected).toBe(false);
    // back in reach: the next cases use it
    await away.endpoint.stop();
    fs.writeFileSync(enrollment, held, { mode: 0o600 });
    const back = await restarted(away);
    await until(() => back.endpoint.hub.connected, 'B’s link again');
    pair = { ...pair!, b: back, sb: await attachSminos(back) };
  });
});

describe('the machine’s own record', () => {
  it('is not signed from an index that is not loaded, and is once it is', async () => {
    const { b } = await machines();
    const c = await listedEndpoint('reg-c');
    await sleep(500);
    expect(c.endpoint.parts?.state.projects.record).toBeNull();
    expect(heldRecord(b, c.ref)).toBeUndefined();
    const id = uuid();
    c.index.declare('/srv/late', id);
    await until(() => heldRecord(b, c.ref)?.body.locations.some((l) => l.id === id), 'C’s record, once its index loaded');
  });

  it('is refused once when started on a state file older than the hub’s, with its clock behind, and the next is stored above the floor', async () => {
    const { a, b } = await machines();
    const file = join(a.services.machine.stateDir, 'projects.json');
    const older = fs.readFileSync(file, 'utf8');
    const olderRevision = (JSON.parse(older) as { record: Signed<ProjectsRecord> }).record.body.revision;
    await sleep(2500); // the next record's revision well ahead of the restarted clock
    a.index.declare('/srv/second', uuid());
    const held = await until(() => (heldRecord(b, a.ref)?.body.locations.length === 2 ? heldRecord(b, a.ref) : null), 'A’s second record held by B');
    expect(held.body.revision).toBeGreaterThan(olderRevision);
    // the state file restored from the older copy, the clock just past it and behind what the hub holds
    await a.endpoint.stop();
    fs.writeFileSync(file, older, { mode: 0o600 });
    const skew = Date.now() - (olderRevision + 1);
    const again = await restarted(a, { now: () => Date.now() - skew });
    await until(() => again.endpoint.hub.connected, 'A’s link after the restart');
    const next = await until(() => ((heldRecord(b, a.ref)?.body.revision ?? 0) > held.body.revision ? heldRecord(b, a.ref) : null), 'A’s record above the hub’s');
    expect(next.body.revision).toBe(held.body.revision + 1);
    expect(next.body.locations).toHaveLength(2);
    expect(again.services.lines.filter((line) => line.includes('`projects` frame') && line.includes('stale-projects'))).toHaveLength(1);
    pair = { ...pair!, a: again };
    await attachSminos(again);
  });

  it('gives a replaced index its statements back from the kept file, and the next record carries the same ids', async () => {
    const { a, b } = await machines();
    const before = heldRecord(b, a.ref)!;
    const ids = before.body.locations.map((l) => l.id).sort();
    a.index.set([], [], 'index-rebuilt'); // a new, empty index
    await until(() => a.index.restored.length === 1, 'the restore');
    expect(a.endpoint.parts?.state.projects.indexId).toBe('index-rebuilt');
    await sleep(300);
    expect(heldRecord(b, a.ref)?.body.revision).toBe(before.body.revision); // nothing signed from the empty index, nor from the same rows restored
    const added = uuid();
    a.index.declare('/srv/after-rebuild', added);
    const after = await until(() => ((heldRecord(b, a.ref)?.body.revision ?? 0) > before.body.revision ? heldRecord(b, a.ref) : null), 'the next record');
    expect(after.body.locations.map((l) => l.id).sort()).toEqual([...ids, added].sort());
  });
});

describe('a statement change’s answer', () => {
  it('waits for sminos’s acknowledgement, and answers `restated: false` after the wait when none comes', async () => {
    const { a } = await machines();
    a.index.declare('/srv/acked', uuid());
    expect(await a.endpoint.registry.published()).toEqual({ restated: true });
    const quiet = await attachSminos(a, false); // a sminos that keeps and never acknowledges
    await quiet.next((f) => f.t === 'org', 'the quiet sminos’s org frame');
    a.index.declare('/srv/unacked', uuid());
    const asked = Date.now();
    expect(await a.endpoint.registry.published()).toEqual({ restated: false });
    expect(Date.now() - asked).toBeGreaterThanOrEqual(1900);
  });
});

describe('across a restart', () => {
  it('sminos’s stand-in is told the same locations', async () => {
    const { a } = await machines();
    const s1 = await attachSminos(a);
    const before = await orgFrame(s1, (f) => f.locations !== undefined && f.locations.at.length === a.index.value!.rows.length, 'the locations before');
    const again = await restarted(a);
    const s2 = await attachSminos(again);
    await orgFrame(s2, (f) => f.locations !== undefined, 'the locations after');
    await sleep(300);
    const told = s2.received.filter((f): f is OrgFrame => f.t === 'org' && (f as OrgFrame).locations !== undefined).map((f) => f.locations!.at);
    expect(told.length).toBeGreaterThan(0);
    for (const at of told) expect(at).toEqual(before.locations!.at);
    pair = { ...pair!, a: again };
  });
});

describe('a retired machine', () => {
  it('has its record dropped, and its project leaves the other machine’s directory', async () => {
    const { a, b, sb } = await machines();
    const ids = heldRecord(b, a.ref)!.body.locations.map((l) => l.id);
    // retired as an admin retires a machine: its key retired from now, its entry gone
    await accept(async (s) => {
      const { pub } = s.machines.find((m) => m.ref === a.ref)!;
      s.retired.push({ keyId: await keyId(pub), pub, notAfter: new Date().toISOString(), holder: { machine: a.ref } });
      s.machines = s.machines.filter((m) => m.ref !== a.ref);
    });
    await until(() => heldRecord(b, a.ref) === undefined, 'A’s record dropped by B');
    await orgFrame(sb, (f) => ids.every((id) => !hubProject(f, id)), 'B’s directory without A’s projects');
  });
});
