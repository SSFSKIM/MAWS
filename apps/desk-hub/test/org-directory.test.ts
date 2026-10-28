// The org's directory (the sminos org directory's M2) on the local runtime: follow-only hellos, machine projects at the
// Registry, and machines' online state as the projects' leases report it, which `GET /api/machines` and the grid show;
// and a project's summary report, sent again after a failure the suites inject, since Miniflare fails none. DX2's `org`
// frame, the directory the Registry pushed down every machine's stream, left the hub with that stream (O14 M5b): the
// machines here are on RL1, or, where only their enrollment matters, v1 credentials confirmed by their own request.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GridDown, ProjectSummary } from '../src/protocol/browser';
import { machineProjectId, type MachineView } from '../src/protocol/identity';
import { RETRY_ATTEMPTS } from '../src/objects/retry';
import { enroll, GridClient, waitFor, type Credentials } from './support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';
import { Rl1Machine, TestOrg } from './support/rl1';

let hub: LocalHub;
let org: TestOrg;
beforeAll(async () => {
  hub = await startLocalHub();
  org = await TestOrg.root(hub);
});
afterAll(() => hub?.close());

let projects = 0;
const newProject = () => `3e5f0a8e-3b2d-4c5e-9f70-${(++projects).toString(16).padStart(12, '0')}`;
let machines = 0;
const newName = () => `od-${++machines}`;

/** A listed machine on RL1, its socket open; `timing` shortens its heartbeat, lease, or grace first. */
async function connected(name = newName(), timing?: { heartbeatMs: number; leaseMs: number; graceMs?: number }): Promise<Rl1Machine> {
  const machine = new Rl1Machine(hub, await org.listed(name));
  if (timing) await hub.timing(`ref:${machine.machine.ref}`, timing);
  await machine.connect();
  return machine;
}

/** A v1 machine enrolled under `name`, confirmed by its first request (which registers its machine project). */
async function confirmed(name: string): Promise<Credentials> {
  const credentials = await enroll(hub, ADMIN, name);
  expect((await hub.fetchAs(credentials, '/machine/enrollment')).status).toBe(200);
  return credentials;
}

/** A machine's row in `GET /api/machines`: its online state as the projects' leases report it. */
const listedRow = async (name: string) =>
  ((await (await hub.fetchAs(ADMIN, '/api/machines')).json()) as { machines: MachineView[] }).machines.find((m) => m.name === name);
/** Waits until the machine's row says `online`, and answers the row. */
const onlineIs = (name: string, online: boolean, ms?: number) =>
  waitFor(async () => {
    const row = await listedRow(name);
    return row?.online === online ? row : undefined;
  }, ms);
const directory = async () => ((await (await hub.fetchAs(ADMIN, '/api/projects')).json()) as { projects: Array<{ id: string; name: string; kind: string; registered_by: string; retired: boolean }> }).projects;
const machineIn = (report: { machines: MachineView[] }, name: string) => report.machines.find((m) => m.name === name);

const summariesOf = (frame: GridDown): ProjectSummary[] => (frame.t === 'grid' ? frame.projects : frame.t === 'summary' ? [frame.project] : []);

/** The first grid frame after `from` for which `predicate` holds. */
async function nextGrid(grid: GridClient, from: number, predicate: (frame: GridDown) => boolean, what: string): Promise<GridDown> {
  return waitFor(() => grid.frames.slice(from).find(predicate)).catch(() => {
    throw new Error(`no ${what}; got ${JSON.stringify(grid.frames.slice(from).slice(-5))}`);
  });
}

/** The project's line as the grid last drew it. */
const lastSummary = (grid: GridClient, project: string) =>
  grid.frames
    .flatMap(summariesOf)
    .filter((p) => p.id === project)
    .at(-1);

/** A project's counts, for a report handed to the Registry straight. */
const COUNTS = { machines: 1, machines_online: 1, working: 0, waiting: 0 };

describe('a follow-only hello', () => {
  it("leases the machine without counting it: the grid's machines and machines_online leave it out", async () => {
    const project = newProject();
    const holder = await connected();
    await holder.sync(project);
    const grid = await GridClient.open(hub, ADMIN);
    await nextGrid(grid, 0, (f) => summariesOf(f).some((p) => p.id === project && p.machines === 1 && p.machines_online === 1), 'the holder counted');

    const follower = await connected();
    const from = follower.frames.length;
    follower.send([{ t: 'hello', project, name: 'demo', have: {}, follow: true }]);
    await follower.next((f) => f.t === 'have' && f.project === project, 'have', from);
    // The follower is online at the Registry only through this project's report, so that report has arrived.
    await onlineIs(follower.name, true);
    expect(lastSummary(grid, project)).toMatchObject({ machines: 1, machines_online: 1 });

    // It holds the project once a session of it joins there: a hello without follow.
    let gridFrom = grid.frames.length;
    follower.send([{ t: 'hello', project, name: 'demo', have: follower.vector(project), follow: false }]);
    await nextGrid(grid, gridFrom, (f) => summariesOf(f).some((p) => p.id === project && p.machines === 2 && p.machines_online === 2), 'both counted');

    // And follows it again when the last one leaves: out of the counts at once.
    gridFrom = grid.frames.length;
    follower.send([{ t: 'hello', project, name: 'demo', have: follower.vector(project), follow: true }]);
    await nextGrid(grid, gridFrom, (f) => summariesOf(f).some((p) => p.id === project && p.machines === 1 && p.machines_online === 1), 'the follower out again');
    // Still online: a follow lease is a lease.
    expect(await listedRow(follower.name)).toMatchObject({ online: true });
    grid.close();
    follower.close();
    holder.close();
  });

  it("renews with the connection's heartbeats and lapses without them: the Registry's online flips", async () => {
    const project = newProject();
    // A lease of 15 heartbeats (the deployed one is 3 of 15 s): each renewal goes from the endpoint's timer through the
    // suite's proxy and back through the Worker to the project, and a short lease lapses on one landing late.
    const leaseMs = 3000;
    const follower = await connected(newName(), { heartbeatMs: 200, leaseMs });
    const from = follower.frames.length;
    follower.send([{ t: 'hello', project, name: 'demo', have: {}, follow: true }]);
    const helloed = Date.now(); // the hello's lease started before its `have` was answered
    await follower.next((f) => f.t === 'have' && f.project === project, 'have', from);
    const online = await onlineIs(follower.name, true);

    // Its heartbeats answered, it is still online a second past the lease its hello started.
    await new Promise((resolve) => setTimeout(resolve, helloed + leaseMs + 1000 - Date.now()));
    expect(await listedRow(follower.name)).toMatchObject({ online: true });

    // A suspended daemon sends none: the lease lapses, and the Registry says when it went offline.
    follower.heartbeats = false;
    const offline = await onlineIs(follower.name, false, leaseMs + 5000);
    expect(Date.parse(offline.seen!)).toBeGreaterThan(Date.parse(online.seen ?? '1970-01-01T00:00:00.000Z'));
    follower.close();
  });
});

describe("a machine's project", () => {
  it('is retired when the machine is revoked, and active again, under the same id, when the name is enrolled anew', async () => {
    const name = newName();
    const id = machineProjectId(ORG, name);
    const watcher = await connected();
    await confirmed(name);
    const grid = await GridClient.open(hub, ADMIN);
    expect(summariesOf(grid.frames[0]).find((p) => p.id === id)).toMatchObject({ name, kind: 'machine' });
    expect(summariesOf(grid.frames[0]).find((p) => p.id === machineProjectId(ORG, watcher.name))).toMatchObject({ kind: 'machine' });

    let gridFrom = grid.frames.length;
    expect((await hub.fetchAs(ADMIN, `/api/machines/${name}`, { method: 'DELETE' })).status).toBe(200);
    expect((await directory()).find((p) => p.id === id)).toMatchObject({ retired: true });
    expect(await listedRow(name)).toBeUndefined();
    // A summary cannot take a row off the grid: the whole grid comes again without it.
    const resent = (await nextGrid(grid, gridFrom, (f) => f.t === 'grid', 'the grid again')) as Extract<GridDown, { t: 'grid' }>;
    expect(resent.projects.some((p) => p.id === id)).toBe(false);
    const regrid = await GridClient.open(hub, ADMIN);
    expect(summariesOf(regrid.frames[0]).some((p) => p.id === id)).toBe(false);
    regrid.close();

    // A machine may still hello it from a stale directory: the project refuses nothing, and revives nothing.
    const from = watcher.frames.length;
    watcher.send([{ t: 'hello', project: id, name, have: {}, follow: true }]);
    await watcher.next((f) => f.t === 'have' && f.project === id, 'have', from);
    expect((await directory()).find((p) => p.id === id)).toMatchObject({ retired: true });

    gridFrom = grid.frames.length;
    await confirmed(name);
    expect((await directory()).find((p) => p.id === id)).toMatchObject({ id, name, kind: 'machine', registered_by: name, retired: false });
    expect(await listedRow(name)).toMatchObject({ online: false });
    await nextGrid(grid, gridFrom, (f) => summariesOf(f).some((p) => p.id === id && p.kind === 'machine'), 'the project back on the grid');
    grid.close();
    watcher.close();
  });

  it("is not made online by a late report of the revoked enrollment's lease, once the name is enrolled anew", async () => {
    const name = newName();
    const project = newProject();
    const old = await confirmed(name);
    expect(machineIn(await hub.report(project, { ...COUNTS, seq: 1, machines_state: [{ name, online: true, client: old.clientId }] }), name)).toMatchObject({ online: true });
    expect((await hub.fetchAs(ADMIN, `/api/machines/${name}`, { method: 'DELETE' })).status).toBe(200);
    const again = await confirmed(name);
    // A report sent before its project took the revocation, delivered only now and the first the Registry has of that
    // project, so nothing orders it out: its lease is the old enrollment's.
    const late = await hub.report(newProject(), { ...COUNTS, seq: 1, machines_state: [{ name, online: true, client: old.clientId }] });
    expect(machineIn(late, name)).toMatchObject({ online: false, seen: null });
    // The new enrollment's own lease counts as soon as a project reports it.
    const own = await hub.report(project, { ...COUNTS, seq: 2, machines_state: [{ name, online: true, client: again.clientId }] });
    expect(machineIn(own, name)).toMatchObject({ online: true });
  });

  it("keeps its successor online through a stale report of the project, and through a report of a Project on the old version", async () => {
    const name = newName();
    const project = newProject();
    const old = await confirmed(name);
    await hub.report(project, { ...COUNTS, seq: 1, machines_state: [{ name, online: true, client: old.clientId }] });
    expect((await hub.fetchAs(ADMIN, `/api/machines/${name}`, { method: 'DELETE' })).status).toBe(200);
    const again = await confirmed(name);
    expect(machineIn(await hub.report(project, { ...COUNTS, seq: 3, machines_state: [{ name, online: true, client: again.clientId }] }), name)).toMatchObject({ online: true });
    // A report older than the project's latest (it reported the successor since), naming only the old enrollment.
    const stale = await hub.report(project, { ...COUNTS, seq: 2, machines_state: [{ name, online: false, client: old.clientId }] });
    expect(machineIn(stale, name)).toMatchObject({ online: true });
    // A report from a Project still on the version before machines' online state: no sequence and no client.
    const unversioned = await hub.report(project, { ...COUNTS, machines_state: [{ name, online: false }] });
    expect(machineIn(unversioned, name)).toMatchObject({ online: true });
  });

  it("missing at the hub (a machine enrolled before machine projects) is registered as the machine's by its first hello, whoever sends it", async () => {
    const m = await connected();
    const id = machineProjectId(ORG, m.name);
    await hub.unregister(id);
    await m.sync(id, 'whatever-the-hello-says');
    expect((await directory()).find((p) => p.id === id)).toMatchObject({ id, name: m.name, kind: 'machine', registered_by: m.name, retired: false });

    await hub.unregister(id);
    const other = await connected();
    const from = other.frames.length;
    other.send([{ t: 'hello', project: id, name: 'followed', have: {}, follow: true }]);
    await other.next((f) => f.t === 'have' && f.project === id, 'have', from);
    // Registered by the other machine, and the machine's still: its kind and its name are the machine's.
    expect((await directory()).find((p) => p.id === id)).toMatchObject({ name: m.name, kind: 'machine', registered_by: other.name, retired: false });
    other.close();
    m.close();
  });
});

/** The hub's records of a project's failed report (`report-failed`) logged after `from`. */
function failures(event: 'report-failed', from: number): Array<Record<string, unknown>> {
  return hub.runtimeLogs
    .slice(from)
    .map((line) => {
      try {
        return JSON.parse(line.message) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((line): line is Record<string, unknown> => line?.event === event);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const everyAttempt = Array.from({ length: RETRY_ATTEMPTS }, (_, i) => i + 1);

describe("a project's summary report, failed", () => {
  it("is sent again until the Registry takes it: a lease's lapse and its return reach the Registry", async () => {
    const project = newProject();
    await hub.retryBase({ project }, 20);
    const m = await connected(newName(), { heartbeatMs: 200, leaseMs: 60_000, graceMs: 200 });
    await m.sync(project);
    await onlineIs(m.name, true);

    // The daemon stops: its lease lapses in the project, whose report of it fails twice.
    await hub.summaryFault(project, 2);
    m.close();
    await onlineIs(m.name, false);
    expect(await hub.summaryFault(project)).toEqual({ remaining: 0, calls: 3 });

    // It starts again: the report of its return fails twice too.
    await hub.summaryFault(project, 2);
    await m.connect();
    await m.sync(project);
    await onlineIs(m.name, true);
    expect(await hub.summaryFault(project)).toEqual({ remaining: 0, calls: 3 });
    m.close();
  });

  it(`is given up after ${RETRY_ATTEMPTS} sends`, async () => {
    const project = newProject();
    await hub.retryBase({ project }, 5);
    const m = await connected(newName(), { heartbeatMs: 200, leaseMs: 60_000, graceMs: 200 });
    await m.sync(project);
    await onlineIs(m.name, true);
    await hub.summaryFault(project, 1000);
    const logs = hub.runtimeLogs.length;
    m.close();
    const mine = () => failures('report-failed', logs).filter((line) => line.project === project);
    await waitFor(() => mine().find((line) => line.retry_ms === null), 15_000);
    expect(mine().map((line) => line.attempt)).toEqual(everyAttempt);
    expect((await hub.summaryFault(project)).calls).toBe(RETRY_ATTEMPTS);
    await pause(300);
    expect((await hub.summaryFault(project)).calls).toBe(RETRY_ATTEMPTS);
  });

  it('is superseded by a later report, and never brings the Registry an older state', async () => {
    const project = newProject();
    // A retry that waits half a minute at least: whether it was superseded is read, not waited for.
    await hub.retryBase({ project }, 60_000);
    const m = await connected(newName(), { heartbeatMs: 200, leaseMs: 60_000, graceMs: 200 });
    await m.sync(project);
    await onlineIs(m.name, true);

    // The lapse's report fails, and its retry waits; the machine is back meanwhile.
    await hub.summaryFault(project, 1);
    m.close();
    await waitFor(async () => ((await hub.reportRetryWaits(project)) ? true : undefined));
    expect((await hub.summaryFault(project)).calls).toBe(1);
    await m.connect();
    await m.sync(project);
    // The return's report lands, and the retry no longer waits: the Registry was told the return, and nothing older.
    await waitFor(async () => ((await hub.summaryFault(project)).calls === 2 ? true : undefined));
    expect(await hub.reportRetryWaits(project)).toBe(false);
    expect(await listedRow(m.name)).toMatchObject({ online: true });
    m.close();
  });
});
