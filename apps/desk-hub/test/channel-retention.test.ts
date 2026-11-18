// A sminos declared channel's row at the hub (docs/doperpowers/plans/2026-11-18-mw-sminos-channels.md, M3; Interfaces
// §F). A channel's log is registered by a hello as any project's is, as a `hub` row; nothing declares it. Its row stays
// on the grid while some machine's projects record lists it as known, and once no counted record has for seven days it
// is retired: off the grid, retired in the directory, its log kept and still answered. The next stored record that lists
// it makes it active again; a hello alone does not. A record counts while it verifies under the head as it stands, so a
// retired machine's kept record lists nothing. A listing record can reach the Registry before the hello that registers
// the row, and the registration reads the records already held. A row whose id is not a channel's is never touched.
import { base64urlEncode, generateSigningKey, keyId, type ProjectsRecord, type Signed, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeEndpoint } from '../fake-machine/endpoint';
import { enrollV2, projectsRecord, type V2Machine } from '../fake-machine/org';
import type { GridDown } from '../src/protocol/browser';
import { newNonce } from '../src/protocol/codes';
import { encodeEnrollmentCodeV2 } from '../src/protocol/identity';
import type { LogEvent } from '../src/protocol/log';
import { GridClient, waitFor } from './support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';
import { genesis, newDevice, next, signedBy, type TestDevice } from './support/org';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The Registry's `CHANNEL_RETENTION_MS`, `CHANNEL_RECHECK_MS` and retry wait (registry.ts, which Node cannot load). */
const RETENTION = 7 * DAY;
const RECHECK = DAY;
const RETRY = 60_000;

/** A declared channel's id, version 8 and variant 9 (Interfaces §A), one per case. */
const channel = (n: number) => `5c2a9e10-7b3d-8f41-9a6c-${String(n).padStart(12, '0')}`;
/** Project ids as machines from before this work mint (version 4) and derive (version 5). */
const V4 = '7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c4d';
const V5 = '2ed02f3c-5d7b-5e0a-9b1f-6a4c8d2e0f13';
const SESSION = '17646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';

let hub: LocalHub;
let a1: TestDevice;
let recovery: SigningKey;
let head: SignedOrgState;
let A: string;

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const mac = () => ({ nonce: newNonce(), value: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url') });
const event = (writer: string, seq: number): LogEvent => ({ ts: new Date().toISOString(), writer, seq, kind: 'say', text: `say ${seq}`, mac: mac() }) as unknown as LogEvent;

async function accept(edit: Parameters<typeof next>[1]): Promise<void> {
  const s = await signedBy(await next(head, edit), a1);
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: s });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
  head = s;
}

/** A machine the org state lists, connected on RL1, and the revision its next projects record takes. */
type Online = { machine: V2Machine; endpoint: FakeEndpoint; revision: number };

async function online(name: string): Promise<Online> {
  const response = await hub.fetchAs(ADMIN, '/api/enrollments', { body: {} });
  const { token } = (await response.json()) as { token: string };
  const code = encodeEnrollmentCodeV2({ hub: hub.url, token, roots: [await keyId(a1.stepUp!.pub)], recoveryPub: recovery.pub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
  const machine = await enrollV2(code, name);
  await accept((s) => {
    s.machines.push({ name, ref: machine.ref, pub: machine.key.pub, owners: [A] });
    s.machineNames.push({ name, ref: machine.ref });
  });
  const endpoint = new FakeEndpoint({ hub: hub.url, credentials: machine.credentials, ref: machine.ref });
  await endpoint.connect();
  return { machine, endpoint, revision: 0 };
}

/** The machine's next projects record, listing `known` as known (no folder). */
const nextRecord = (m: Online, known: string[]) => projectsRecord(m.machine, ++m.revision, [], known.map((id) => ({ id, name: 'desk-integration' })));

/** Stores the machine's next record through its socket, and answers when it was sent once the record came back to the
 * machine: the Registry's pass over the channels' rows has run by then, since it runs before the record is relayed. */
async function store(m: Online, known: string[]): Promise<number> {
  const record = await nextRecord(m, known);
  const from = m.endpoint.frames.length;
  const sent = Date.now();
  m.endpoint.sendText({ t: 'projects', record });
  await m.endpoint.next((f) => f.t === 'projects' && (f.record as Signed<ProjectsRecord>).body.machine === m.machine.ref && (f.record as Signed<ProjectsRecord>).body.revision === record.body.revision, 'its record back', from);
  return sent;
}

/** Takes the machine out of the org state, its key retired: its kept record no longer verifies. */
async function retire(m: Online): Promise<void> {
  m.endpoint.close();
  const kid = await keyId(m.machine.key.pub);
  await accept((s) => {
    s.machines = s.machines.filter((e) => e.ref !== m.machine.ref);
    s.retired.push({ keyId: kid, pub: m.machine.key.pub, notAfter: new Date().toISOString(), holder: { machine: m.machine.ref } });
  });
}

/** The Registry's answer to a projects record. */
type Stored = { ok: boolean; value?: { stored: boolean } };
/** Whether `f` is the machine's own record of `revision` come back to it: the store that sent it was answered. */
const backAt = (m: Online, revision: number) => (f: { t: string } & Record<string, unknown>) =>
  f.t === 'projects' && (f.record as Signed<ProjectsRecord>).body.machine === m.machine.ref && (f.record as Signed<ProjectsRecord>).body.revision === revision;
/** Waits until the Registry holds the machine's record of `revision`. */
const heldAt = (m: Online, revision: number) =>
  waitFor(async () => ((await hub.passHold()).records.some((r) => r.machine === m.machine.ref && r.revision === revision) ? true : undefined), 10_000);
const passHeld = () => waitFor(async () => ((await hub.passHold()).held ? true : undefined), 10_000);

/** Opens the channel's log on the machine's socket, which registers its row when the hub holds none. */
const hello = (m: Online, id: string) => m.endpoint.project(id, 'desk-integration');

type Row = { id: string; name: string; kind: string; registered_by: string; created: string; retired: boolean };
const directory = async () => ((await (await hub.fetchAs(ADMIN, '/api/projects')).json()) as { projects: Row[] }).projects;
const row = async (id: string) => (await directory()).find((p) => p.id === id);
const unlistedMs = async (id: string) => {
  const unlisted = await hub.unlisted(id);
  if (unlisted === null) throw new Error(`${id} reads as listed`);
  return Date.parse(unlisted);
};

/** The first frame from frame `from` on that `predicate` holds for. */
function gridFrame<T extends GridDown>(grid: GridClient, from: number, predicate: (f: GridDown) => f is T, what: string): Promise<T> {
  return waitFor(() => grid.frames.slice(from).find(predicate), 10_000).catch(() => {
    throw new Error(`no ${what}; got ${JSON.stringify(grid.frames.slice(from)).slice(0, 600)}`);
  });
}
const whole = (f: GridDown): f is Extract<GridDown, { t: 'grid' }> => f.t === 'grid';

beforeAll(async () => {
  hub = await startLocalHub();
  // A failed push or announcement is retried a minute on, not a second: no alarm the suite did not cause runs a sweep
  // between two of its steps.
  await hub.retryBase('registry', RETRY);
  A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
  head = await signedBy(await genesis(ORG, A, ADMIN, a1, recovery), a1);
  expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
});
afterAll(() => hub?.close());

describe('a sminos channel’s row', () => {
  // First: until here the hub holds no channel's row, as a hub with M3 among machines from before this work does.
  it('is the only row retention touches: rows of version 4 and 5 and a machine’s own, listed and left out, thirty days on, keep the grid, the directory and the alarm', async () => {
    const m = await online('cr-older');
    for (const id of [V4, V5]) await hello(m, id);
    await store(m, [V4, V5]);
    await store(m, []);
    const own = (await directory()).find((p) => p.kind === 'machine' && p.name === 'cr-older')!;
    await hub.backdate({ projects: [V4, V5, own.id].map((id) => ({ id, created: ago(30 * DAY) })) });
    const grid = await GridClient.open(hub, ADMIN);
    const before = await directory();
    // The shapes as they were before this work: no key added to a directory row or a grid line.
    for (const id of [V4, V5, own.id]) expect(Object.keys(before.find((p) => p.id === id)!).sort()).toEqual(['archive_machine', 'created', 'id', 'kind', 'name', 'registered_by', 'retired']);
    expect(grid.frames[0]?.t).toBe('grid');
    const first = grid.frames.find(whole)!;
    for (const id of [V4, V5, own.id]) expect(Object.keys(first.projects.find((p) => p.id === id)!).sort()).toEqual(['id', 'kind', 'live', 'machines', 'machines_online', 'name', 'waiting', 'working']);
    await sleep(300);
    const from = grid.frames.length;

    await hub.registrySweep();
    await store(m, [V5]);
    await store(m, []);
    await hub.registrySweep();
    expect(await directory()).toEqual(before);
    for (const id of [V4, V5, own.id]) expect(await hub.unlisted(id)).toBeNull();
    // Not a frame more: no grid again whole, and no summary.
    await sleep(300);
    expect(grid.frames.slice(from)).toEqual([]);
    // No deadline from them: once what the steps owed is done, a sweep leaves no alarm.
    await waitFor(async () => ((await hub.registrySweep({ clear: true })) === null ? true : undefined), 10_000);
    grid.close();
    m.endpoint.close();
  });

  it('never listed, retires seven days after its registration and not at six days and twenty-three hours; its log is kept and answered, and a hello does not bring it back', async () => {
    const m = await online('cr-never');
    const C = channel(1);
    const writer = `cr-never/${SESSION}`;
    const before = Date.now();
    await hello(m, C);
    const registered = Date.now();
    const since = await unlistedMs(C);
    expect(since).toBeGreaterThanOrEqual(before);
    expect(since).toBeLessThanOrEqual(registered);
    m.endpoint.upload(C, [event(writer, 1), event(writer, 2)]);
    const grid = await GridClient.open(hub, ADMIN);

    await hub.backdate({ projects: [{ id: C, unlisted: ago(RETENTION - HOUR) }] });
    await hub.registrySweep();
    expect(await row(C)).toMatchObject({ retired: false });

    const from = grid.frames.length;
    await hub.backdate({ projects: [{ id: C, unlisted: ago(RETENTION) }] });
    await hub.registrySweep();
    expect(await row(C)).toMatchObject({ id: C, kind: 'hub', retired: true });
    const again = await gridFrame(grid, from, whole, 'the grid again whole');
    expect(again.projects.map((p) => p.id)).not.toContain(C);
    expect(again.projects.map((p) => p.id)).toContain((await directory()).find((p) => p.name === 'cr-never')!.id);

    const have = await hello(m, C);
    expect(have.have[writer]).toBe(2);
    expect(await row(C)).toMatchObject({ retired: true });
    grid.close();
    m.endpoint.close();
  });

  it('registered after a record that lists it was stored, reads as listed, and its seven days run from the record that leaves it out', async () => {
    const m = await online('cr-early');
    const C = channel(2);
    // (1) The listing is stored while the table holds no row of the channel.
    expect(await row(C)).toBeUndefined();
    await store(m, [C]);
    // (2) The row registered by a hello, read straight after its answer, no record stored since and the alarm cleared
    // first: the registration read the records, not a pass.
    await hub.registryAlarm(true);
    await hello(m, C);
    expect(await hub.unlisted(C)).toBeNull();
    const registered = Date.now();
    // (3) The machine's next record leaves it out.
    const sent = await store(m, []);
    const since = await unlistedMs(C);
    expect(since).toBeGreaterThanOrEqual(sent);
    expect(since).toBeGreaterThan(registered);
    // (4) Seven full days from that removal.
    await hub.backdate({ projects: [{ id: C, unlisted: new Date(since - (RETENTION - HOUR)).toISOString() }] });
    await hub.registrySweep();
    expect(await row(C)).toMatchObject({ retired: false });
    await hub.backdate({ projects: [{ id: C, unlisted: new Date(since - RETENTION).toISOString() }] });
    await hub.registrySweep();
    expect(await row(C)).toMatchObject({ retired: true });
    m.endpoint.close();
  });

  it('registered while a retired machine’s kept record names it, reads as listed, and the next pass starts its clock', async () => {
    const gone = await online('cr-gone');
    const C = channel(3);
    await store(gone, [C]);
    await retire(gone);
    const m = await online('cr-after');
    await hub.registryAlarm(true);
    await hello(m, C);
    expect(await hub.unlisted(C)).toBeNull();
    const before = Date.now();
    await hub.registrySweep();
    expect(await unlistedMs(C)).toBeGreaterThanOrEqual(before);
    expect(await row(C)).toMatchObject({ retired: false });
    m.endpoint.close();
  });

  it('listed, then left out of the machine’s next record: the clock starts at that store', async () => {
    const m = await online('cr-left');
    const C = channel(4);
    await hello(m, C);
    await store(m, [C]);
    expect(await hub.unlisted(C)).toBeNull();
    const sent = await store(m, []);
    expect(await unlistedMs(C)).toBeGreaterThanOrEqual(sent);
    m.endpoint.close();
  });

  it('listed by two machines: the clock starts when the second leaves it out', async () => {
    const [a, b] = [await online('cr-two-a'), await online('cr-two-b')];
    const C = channel(5);
    await hello(a, C);
    await store(a, [C]);
    await store(b, [C]);
    await store(a, []);
    expect(await hub.unlisted(C)).toBeNull();
    const sent = await store(b, []);
    expect(await unlistedMs(C)).toBeGreaterThanOrEqual(sent);
    a.endpoint.close();
    b.endpoint.close();
  });

  it('listed for as long as it is listed: not retired, and the alarm is set no later than a day ahead', async () => {
    const m = await online('cr-kept');
    const C = channel(6);
    await hello(m, C);
    await store(m, [C]);
    await hub.backdate({ projects: [{ id: C, created: ago(30 * DAY) }] });
    const alarm = await hub.registrySweep({ clear: true });
    expect(await hub.unlisted(C)).toBeNull();
    expect(await row(C)).toMatchObject({ retired: false });
    expect(alarm).not.toBeNull();
    expect(alarm!).toBeLessThanOrEqual(Date.now() + RECHECK);
    m.endpoint.close();
  });

  it('retired, then listed: active again, its summary on the grid, its clock cleared', async () => {
    const m = await online('cr-back');
    const C = channel(7);
    await hello(m, C);
    await hub.backdate({ projects: [{ id: C, unlisted: ago(RETENTION) }] });
    await hub.registrySweep();
    expect(await row(C)).toMatchObject({ retired: true });
    const grid = await GridClient.open(hub, ADMIN);
    expect((grid.frames.find(whole)?.projects ?? []).map((p) => p.id)).not.toContain(C);
    const from = grid.frames.length;

    await store(m, [C]);
    expect(await row(C)).toMatchObject({ retired: false });
    expect(await hub.unlisted(C)).toBeNull();
    const summary = await gridFrame(grid, from, (f): f is Extract<GridDown, { t: 'summary' }> => f.t === 'summary' && f.project.id === C, 'its summary');
    expect(summary.project).toMatchObject({ id: C, kind: 'hub' });
    grid.close();
    m.endpoint.close();
  });

  it('listed only by a machine the head has since retired: that record stops counting at the next pass', async () => {
    const x = await online('cr-retired');
    const C = channel(8);
    await hello(x, C);
    await store(x, [C]);
    expect(await hub.unlisted(C)).toBeNull();
    await retire(x);
    const before = Date.now();
    await hub.registrySweep();
    expect(await unlistedMs(C)).toBeGreaterThanOrEqual(before);
  });

  it('follows the later of two records stored at once, and a record sent again unchanged runs a pass', async () => {
    const m = await online('cr-race');
    const C = channel(9);
    await hello(m, C);
    const both = async (first: string[], second: string[]) => {
      const records = [await nextRecord(m, first), await nextRecord(m, second)];
      const answers = await hub.registryRpcs<Stored>(records.map((record) => ({ method: 'storeProjects' as const, args: [record] })));
      expect(answers[1]).toEqual({ ok: true, value: { stored: true } });
      return records[1];
    };
    await both([], [C]);
    expect(await hub.unlisted(C)).toBeNull();
    const last = await both([C], []);
    await unlistedMs(C);

    // Its seven days gone by, and no alarm left to sweep: the same bytes again retire it.
    await hub.backdate({ projects: [{ id: C, unlisted: ago(RETENTION + 60_000) }], clearAlarm: true });
    expect(await row(C)).toMatchObject({ retired: false });
    expect(await hub.registryRpc<Stored>('storeProjects', last)).toEqual({ ok: true, value: { stored: false } });
    expect(await row(C)).toMatchObject({ retired: true });
    m.endpoint.close();
  });

  it('past its deadline while the head cannot be read: not retired, and the alarm waits the retry', async () => {
    const m = await online('cr-blind');
    const C = channel(10);
    await hello(m, C);
    await hub.headFault(true);
    try {
      await hub.backdate({ projects: [{ id: C, unlisted: ago(RETENTION + HOUR) }], clearAlarm: true });
      // Once the steps' own owed work is done, the alarm the sweep leaves is the retry's.
      await waitFor(async () => {
        const at = Date.now();
        const alarm = await hub.registrySweep({ clear: true });
        return alarm !== null && alarm >= at + RETRY ? true : undefined;
      }, 10_000);
      expect(await row(C)).toMatchObject({ retired: false });
    } finally {
      await hub.headFault(false);
    }
    await store(m, []);
    expect(await row(C)).toMatchObject({ retired: true });
    m.endpoint.close();
  });

  it('applies no pass over records replaced while it verified: a sweep held past its verification never takes off the grid a row a record stored meanwhile lists', async () => {
    const m = await online('cr-order');
    const C = channel(12);
    await hello(m, C);
    await hub.backdate({ projects: [{ id: C, unlisted: ago(RETENTION + HOUR) }], clearAlarm: true });
    const grid = await GridClient.open(hub, ADMIN);
    expect((grid.frames.find(whole)?.projects ?? []).map((p) => p.id)).toContain(C);
    const from = grid.frames.length;

    // The sweep's pass verifies the records that do not list the channel, and is held there.
    await hub.passHold({ hold: 1 });
    const sweep = hub.registrySweep();
    await passHeld();
    // A record that lists it is stored meanwhile; its store's pass waits its turn.
    const record = await nextRecord(m, [C]);
    const back = m.endpoint.frames.length;
    m.endpoint.sendText({ t: 'projects', record });
    await heldAt(m, record.body.revision);
    await hub.passHold({ release: true });
    await sweep;
    await m.endpoint.next(backAt(m, record.body.revision), 'its record back', back);

    expect(await row(C)).toMatchObject({ retired: false });
    expect(await hub.unlisted(C)).toBeNull();
    expect(grid.frames.slice(from).filter((f) => whole(f) && !f.projects.some((p) => p.id === C))).toEqual([]);
    grid.close();
    m.endpoint.close();
  });

  it('answers a record once a pass has applied the records held after it, so its listing reaches the row before the machine can withdraw it', async () => {
    const [a, b] = [await online('cr-lost-a'), await online('cr-lost-b')];
    const C = channel(13);
    await hello(a, C);
    // Six days unlisted: one day short of its retirement.
    await hub.backdate({ projects: [{ id: C, unlisted: ago(RETENTION - DAY) }], clearAlarm: true });

    // A lists it; A's pass is held after verifying, and B stores meanwhile, so A's pass finds the records replaced.
    await hub.passHold({ hold: 1 });
    const listing = await nextRecord(a, [C]);
    const back = a.endpoint.frames.length;
    a.endpoint.sendText({ t: 'projects', record: listing });
    await passHeld();
    const other = await nextRecord(b, []);
    const bStored = hub.registryRpc<Stored>('storeProjects', other);
    await heldAt(b, other.body.revision);
    // Released, A's pass applies nothing; the next pass (B's) is held in its turn.
    await hub.passHold({ hold: 1, release: true });
    await passHeld();
    // A is not answered: no pass has yet applied the records held since its listing was stored.
    await sleep(300);
    expect(a.endpoint.frames.slice(back).filter(backAt(a, listing.body.revision))).toEqual([]);

    // A withdraws it, behind its listing on the connection.
    const withdrawal = await nextRecord(a, []);
    const sent = Date.now();
    a.endpoint.sendText({ t: 'projects', record: withdrawal });
    await hub.passHold({ release: true });
    expect(await bStored).toEqual({ ok: true, value: { stored: true } });
    await a.endpoint.next(backAt(a, withdrawal.body.revision), 'the withdrawal back', back);
    // The listing reached the row, so its seven days run from the withdrawal.
    expect(await unlistedMs(C)).toBeGreaterThanOrEqual(sent);
    a.endpoint.close();
    b.endpoint.close();
  });

  it('runs no pass for a redemption, which Access does not guard: only the alarm’s sweep retires a row past its deadline', async () => {
    const m = await online('cr-redeem');
    const C = channel(14);
    await hello(m, C);
    m.endpoint.close();
    await hub.backdate({ projects: [{ id: C, unlisted: ago(RETENTION + HOUR) }], clearAlarm: true });
    const response = await hub.fetchAs(null, '/machine/enroll', { body: { token: 'B'.repeat(43), machine: 'cr-ghost' } });
    expect(response.status).toBe(404);
    expect(await row(C)).toMatchObject({ retired: false });
    await hub.registrySweep();
    expect(await row(C)).toMatchObject({ retired: true });
  });

  it('past its deadline on a fresh instance, which knows of no pass that tried: the alarm is set no sooner than the retry wait', async () => {
    const m = await online('cr-fresh');
    const C = channel(15);
    await hello(m, C);
    m.endpoint.close();
    await hub.backdate({ projects: [{ id: C, unlisted: ago(RETENTION + HOUR) }], clearAlarm: true });
    await hub.evict('Registry', ORG);
    await waitFor(async () => {
      await hub.registryAlarm(true);
      const at = Date.now();
      const alarm = await hub.backdate({});
      return alarm !== null && alarm >= at + RETRY ? true : undefined;
    }, 10_000);
    expect(await row(C)).toMatchObject({ retired: false });
    // Not left behind: the alarm's sweep retires it.
    await hub.registrySweep({ clear: true });
    expect(await row(C)).toMatchObject({ retired: true });
  });

  // Last: it evicts the Registry.
  it('in a table stored before the column, reads as never unlisted, and the next pass starts its clock', async () => {
    const m = await online('cr-before');
    const C = channel(11);
    await hello(m, C);
    await unlistedMs(C);
    m.endpoint.close();
    await hub.projectsBeforeUnlisted();
    await hub.evict('Registry', ORG);
    expect(await hub.unlisted(C)).toBeNull();
    expect(await row(C)).toMatchObject({ retired: false });
    const before = Date.now();
    await hub.registrySweep();
    expect(await unlistedMs(C)).toBeGreaterThanOrEqual(before);
  });
});
