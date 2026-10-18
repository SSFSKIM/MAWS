// The org's directory (the sminos org directory's M2) on the local runtime: the `org` frame every machine's stream
// carries after its `welcome` and again on every change, follow-only hellos, machine projects at the Registry, and
// machines' online state as the projects' leases report it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeMachine } from '../fake-machine';
import type { GridDown, ProjectDown, ProjectSummary } from '../src/protocol/browser';
import { machineProjectId } from '../src/protocol/identity';
import type { DownFrame, OrgFrame } from '../src/protocol/machine';
import type { SessionMessage } from '../src/protocol/session';
import { BrowserClient, enroll, GridClient, MachineClient, waitFor } from './support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';

let hub: LocalHub;
beforeAll(async () => {
  hub = await startLocalHub();
});
afterAll(() => hub?.close());

let projects = 0;
const newProject = () => `3e5f0a8e-3b2d-4c5e-9f70-${(++projects).toString(16).padStart(12, '0')}`;
let machines = 0;
const newName = () => `od-${++machines}`;

/** An enrolled machine with its stream open; `timing` shortens its heartbeat and lease first. */
async function connected(name = newName(), timing?: { heartbeatMs: number; leaseMs: number }): Promise<MachineClient> {
  const client = new MachineClient(hub, name, await enroll(hub, ADMIN, name));
  if (timing) await hub.timing(name, timing);
  await client.connect();
  return client;
}

/** The machine's own DX4 presence in the project, as a daemon that holds it posts after its hello. */
async function presence(m: MachineClient, project: string): Promise<void> {
  const body = { online: true, policy: { read_only: false, ceiling: 'default' }, checkouts: [] };
  await m.postOk([{ t: 'session', message: { project, machine: m.name, session: null, kind: 'machine', sub: null, n: null, body } as unknown as SessionMessage }]);
}

const isOrg = (frame: DownFrame): frame is OrgFrame => frame.t === 'org';
const projectIn = (frame: OrgFrame, id: string) => frame.projects.find((p) => p.id === id);
const machineIn = (frame: OrgFrame, name: string) => frame.machines.find((m) => m.name === name);

/** The first `org` frame after `from` for which `predicate` holds. */
async function nextOrg(m: MachineClient, from: number, predicate: (frame: OrgFrame) => boolean, what: string): Promise<OrgFrame> {
  return (await m.next((f) => isOrg(f) && predicate(f), what, from)) as OrgFrame;
}

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

const machinesFrames = (b: BrowserClient, from = 0) => b.frames.slice(from).filter((f): f is Extract<ProjectDown, { t: 'machines' }> => f.t === 'machines');

describe('the org frame', () => {
  it("is the first frame after welcome: every project of the org with its kind, and every enrolled machine with its online state", async () => {
    const holder = await connected();
    const project = newProject();
    const from = holder.frames.length;
    await holder.sync(project, 'directory-demo');
    // The holder is online once its hello's lease reaches the Registry through the project's report.
    const seenHolder = machineIn(await nextOrg(holder, from, (f) => machineIn(f, holder.name)?.online === true, 'the holder online'), holder.name)!;
    expect(seenHolder.seen).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);

    const m = await connected();
    const welcome = m.frames.findIndex((f) => f.t === 'welcome');
    const first = m.frames[welcome + 1];
    expect(first?.t).toBe('org');
    const org = first as OrgFrame;
    expect(projectIn(org, project)).toEqual({ id: project, name: 'directory-demo', kind: 'hub', retired: false });
    // Each enrolled machine's project is registered when its enrollment is confirmed, before any hello names it.
    const own = machineProjectId(ORG, m.name);
    expect(projectIn(org, own)).toEqual({ id: own, name: m.name, kind: 'machine', machine: m.name, retired: false });
    expect(projectIn(org, machineProjectId(ORG, holder.name))).toMatchObject({ kind: 'machine', machine: holder.name, retired: false });
    expect(machineIn(org, holder.name)).toEqual(seenHolder);
    expect(machineIn(org, m.name)).toEqual({ name: m.name, online: false, seen: null });
    await m.close();
    await holder.close();
  });

  it('goes again to every connected machine when a project is registered, or a machine is enrolled', async () => {
    const a = await connected();
    let from = a.frames.length;
    const b = await connected();
    const own = machineProjectId(ORG, b.name);
    const enrolled = await nextOrg(a, from, (f) => machineIn(f, b.name) !== undefined, 'the new machine');
    expect(projectIn(enrolled, own)).toMatchObject({ kind: 'machine', machine: b.name, retired: false });

    from = a.frames.length;
    const project = newProject();
    await b.sync(project, 'registered-later');
    const registered = await nextOrg(a, from, (f) => projectIn(f, project) !== undefined, 'the new project');
    expect(projectIn(registered, project)).toEqual({ id: project, name: 'registered-later', kind: 'hub', retired: false });
    // The listing says so too.
    const listed = ((await (await hub.fetchAs(ADMIN, '/api/projects')).json()) as { projects: Array<{ id: string; kind: string; retired: boolean }> }).projects;
    expect(listed.find((p) => p.id === project)).toMatchObject({ kind: 'hub', retired: false });
    expect(listed.find((p) => p.id === own)).toMatchObject({ kind: 'machine', retired: false });
    await a.close();
    await b.close();
  });
});

describe('a follow-only hello', () => {
  it("leases the machine without counting it: the grid's machines and machines_online and the project's machines frame leave it out", async () => {
    const project = newProject();
    const holder = await connected();
    await holder.sync(project);
    await presence(holder, project);
    const grid = await GridClient.open(hub, ADMIN);
    await nextGrid(grid, 0, (f) => summariesOf(f).some((p) => p.id === project && p.machines === 1 && p.machines_online === 1), 'the holder counted');

    const follower = await connected();
    const from = holder.frames.length;
    await follower.postOk([{ t: 'hello', project, name: 'demo', have: {}, follow: true }]);
    await follower.next((f) => f.t === 'have' && f.project === project, 'have');
    // The follower is online at the Registry only through this project's report, so that report has arrived.
    await nextOrg(holder, from, (f) => machineIn(f, follower.name)?.online === true, 'the follower online');
    expect(lastSummary(grid, project)).toMatchObject({ machines: 1, machines_online: 1 });
    const b = await BrowserClient.open(hub, ADMIN, project);
    await b.next((f) => f.t === 'machines', 'machines');
    expect(machinesFrames(b).at(-1)!.machines.map((m) => m.machine)).toEqual([holder.name]);

    // It holds the project once a session of it joins there: a hello without follow, and its presence.
    let gridFrom = grid.frames.length;
    await follower.postOk([{ t: 'hello', project, name: 'demo', have: follower.vector(project), follow: false }]);
    await presence(follower, project);
    await nextGrid(grid, gridFrom, (f) => summariesOf(f).some((p) => p.id === project && p.machines === 2 && p.machines_online === 2), 'both counted');

    // And follows it again when the last one leaves: out of the counts and of the machines frame at once.
    gridFrom = grid.frames.length;
    const bFrom = b.frames.length;
    await follower.postOk([{ t: 'hello', project, name: 'demo', have: follower.vector(project), follow: true }]);
    await nextGrid(grid, gridFrom, (f) => summariesOf(f).some((p) => p.id === project && p.machines === 1 && p.machines_online === 1), 'the follower out again');
    await b.next((f) => f.t === 'machines' && f.machines.every((m) => m.machine !== follower.name), 'the machines frame without the follower', bFrom);
    // Still online: a follow lease is a lease.
    expect(machineIn(orgFramesOf(holder).at(-1)!, follower.name)).toMatchObject({ online: true });
    b.close();
    grid.close();
    await follower.close();
    await holder.close();
  });

  it("renews with the stream's heartbeats and lapses without them: the Registry's online flips and every machine is sent org", async () => {
    const project = newProject();
    const watcher = await connected();
    const follower = await connected(newName(), { heartbeatMs: 200, leaseMs: 600 });
    let from = watcher.frames.length;
    await follower.postOk([{ t: 'hello', project, name: 'demo', have: {}, follow: true }]);
    const online = machineIn(await nextOrg(watcher, from, (f) => machineIn(f, follower.name)?.online === true, 'the follower online'), follower.name)!;

    // Three lease periods with its heartbeats answered: still online.
    from = watcher.frames.length;
    await new Promise((resolve) => setTimeout(resolve, 1800));
    expect(orgFramesOf(watcher, from).every((f) => machineIn(f, follower.name)?.online !== false)).toBe(true);

    // A suspended daemon answers none: the lease lapses, and the Registry says when it went offline.
    follower.autoAck = false;
    const offline = machineIn(await nextOrg(watcher, from, (f) => machineIn(f, follower.name)?.online === false, 'the follower offline'), follower.name)!;
    expect(Date.parse(offline.seen!)).toBeGreaterThan(Date.parse(online.seen!));
    await follower.close();
    await watcher.close();
  });

  it('is played by the fake machine: its hello follows, and it posts no presence', async () => {
    const project = newProject();
    const holder = await connected();
    await holder.sync(project);
    await presence(holder, project);
    const name = newName();
    const fake = new FakeMachine({ hub: hub.url, machine: name, credentials: await enroll(hub, ADMIN, name), orgKey: new Uint8Array(32).fill(5), project, follow: true });
    const from = holder.frames.length;
    await fake.connect();
    await nextOrg(holder, from, (f) => machineIn(f, name)?.online === true, 'the fake machine online');
    expect(fake.frames[fake.frames.findIndex((f) => f.t === 'welcome') + 1]?.t).toBe('org');
    expect(fake.directory?.projects.find((p) => p.id === project)).toMatchObject({ kind: 'hub', retired: false });
    const b = await BrowserClient.open(hub, ADMIN, project);
    await b.next((f) => f.t === 'machines', 'machines');
    expect(machinesFrames(b).at(-1)!.machines.map((m) => m.machine)).toEqual([holder.name]);
    b.close();
    await fake.close();
    await holder.close();
  });
});

describe("a machine's project", () => {
  it('is retired when the machine is revoked, and active again, under the same id, when the name is enrolled anew', async () => {
    const name = newName();
    const id = machineProjectId(ORG, name);
    const watcher = await connected();
    const m = await connected(name);
    const grid = await GridClient.open(hub, ADMIN);
    expect(summariesOf(grid.frames[0]).find((p) => p.id === id)).toMatchObject({ name, kind: 'machine' });
    expect(summariesOf(grid.frames[0]).find((p) => p.id === machineProjectId(ORG, watcher.name))).toMatchObject({ kind: 'machine' });

    let from = watcher.frames.length;
    let gridFrom = grid.frames.length;
    expect((await hub.fetchAs(ADMIN, `/api/machines/${name}`, { method: 'DELETE' })).status).toBe(200);
    const retired = await nextOrg(watcher, from, (f) => projectIn(f, id)?.retired === true, 'the project retired');
    expect(machineIn(retired, name)).toBeUndefined();
    // A summary cannot take a row off the grid: the whole grid comes again without it.
    const resent = (await nextGrid(grid, gridFrom, (f) => f.t === 'grid', 'the grid again')) as Extract<GridDown, { t: 'grid' }>;
    expect(resent.projects.some((p) => p.id === id)).toBe(false);
    const regrid = await GridClient.open(hub, ADMIN);
    expect(summariesOf(regrid.frames[0]).some((p) => p.id === id)).toBe(false);
    regrid.close();

    // A machine may still hello it from a stale directory: the project refuses nothing, and revives nothing.
    await watcher.postOk([{ t: 'hello', project: id, name, have: {}, follow: true }]);
    await watcher.next((f) => f.t === 'have' && f.project === id, 'have');
    const listed = ((await (await hub.fetchAs(ADMIN, '/api/projects')).json()) as { projects: Array<{ id: string; retired: boolean }> }).projects;
    expect(listed.find((p) => p.id === id)).toMatchObject({ retired: true });

    from = watcher.frames.length;
    gridFrom = grid.frames.length;
    const again = await connected(name);
    const back = await nextOrg(watcher, from, (f) => projectIn(f, id)?.retired === false, 'the project active again');
    expect(projectIn(back, id)).toEqual({ id, name, kind: 'machine', machine: name, retired: false });
    expect(machineIn(back, name)).toMatchObject({ online: false });
    await nextGrid(grid, gridFrom, (f) => summariesOf(f).some((p) => p.id === id && p.kind === 'machine'), 'the project back on the grid');
    grid.close();
    await again.close();
    await m.close();
    await watcher.close();
  });

  it("missing at the hub (a machine enrolled before machine projects) is registered as the machine's by its first hello, whoever sends it", async () => {
    const m = await connected();
    const id = machineProjectId(ORG, m.name);
    await hub.unregister(id);
    let from = m.frames.length;
    await m.sync(id, 'whatever-the-hello-says');
    expect(projectIn(await nextOrg(m, from, (f) => projectIn(f, id) !== undefined, 'the project registered'), id)).toEqual({
      id,
      name: m.name,
      kind: 'machine',
      machine: m.name,
      retired: false,
    });

    await hub.unregister(id);
    const other = await connected();
    from = m.frames.length;
    await other.postOk([{ t: 'hello', project: id, name: 'followed', have: {}, follow: true }]);
    expect(projectIn(await nextOrg(m, from, (f) => projectIn(f, id) !== undefined, 'the project registered again'), id)).toMatchObject({ kind: 'machine', machine: m.name });
    await other.close();
    await m.close();
  });
});

function orgFramesOf(m: MachineClient, from = 0): OrgFrame[] {
  return m.frames.slice(from).filter(isOrg);
}
