// `maws project` against a real mawsd (docs/doperpowers/plans/2026-11-10-project-registry.md, M12's Proves; Interfaces
// §K). Aimed at another machine: the terminal's `projects.forward` reaches main's real handler over its machine.sock link
// (`startProjectActs` on main's own host supervisor), the person's Confirm sends the act through a remote's lane B step-up
// to a real endpoint with a real index, and the terminal prints the result; main's connection ending while a request
// waits ends the wait with §K's refusal, exit 2. With no app, on a daemon whose endpoint is enrolled and holds another
// machine's record: `list` prints a project held only there, and `--into` resolves it by name.
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningKey, signRecord, SIGNING_DOMAINS, type ProjectsRecord } from 'org-protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import type { OrgProjects, ProjectActAsks } from '@shared/ipc/schema/org';
import type { MachineRef } from '@shared/machine/ref';
import { notRunningHere } from '@shared/machine/maws-words';
import { startProjectActs } from '../../src/main/org/project-acts';
import { registerAppWindow } from '../../src/main/windows';
import { runMaws } from '../../src/mawsd/maws-cli';
import type { EndpointModule } from '../../src/mawsd/endpoint-seam';
import { Index } from '../../src/services/index/index';
import { registerIndexHandlers } from '../../src/services/index/register';
import { registerFolders } from '../../src/services/machine/folders';
import type { SetupGuard } from '../../src/services/machine/setup';
import { act, done, makeOrg, openRemote, ORG, sminos, startEndpoint, stopAll, until as reached, type Fixture, type Org, type Remote } from './sub-harness';
import { mintRef } from './fake-services';
import { MawsdScene, until } from '../support/mawsd-scene';

let org: Org;
const started: Fixture[] = [];
const scenes: MawsdScene[] = [];
const dirs: string[] = [];
const indexes: Index[] = [];
const stops: Array<() => void> = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  for (const scene of scenes.splice(0)) await scene.dispose();
  await stopAll(started);
  for (const index of indexes.splice(0)) index.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
afterAll(() => stopAll(started));

const tempDir = (prefix: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};

/** A terminal on this Mac: `maws` over the scene's machine.sock, its output kept. */
async function maws(scene: MawsdScene, argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const home = tempDir('maws-project-home-');
  const code = await runMaws(argv, { env: { MAWS_USER_DATA: scene.root }, platform: 'darwin', home, cwd: home, out: (text) => void (out += text), err: (text) => void (err += text), build: 'maws-test' });
  return { code, out, err };
}

/** `mini`: a real endpoint with a fake macOS home and a real index answering the project commands, as M9's suite has it. */
async function mini(): Promise<{ f: Fixture; home: string; index: Index; a: Remote }> {
  const home = tempDir('maws-project-mini-');
  mkdirSync(join(home, 'work/scrape'), { recursive: true });
  const f = await startEndpoint(org, started, { setup: { home, platform: 'darwin' } });
  const index = new Index(join(tempDir('maws-project-index-'), 'index.sqlite'), { registry: f.endpoint.registry });
  indexes.push(index);
  const guard: SetupGuard = { where: { home, platform: 'darwin' } };
  registerIndexHandlers(index, f.spine.bus as never, guard);
  registerFolders(f.spine.bus.register as never, guard);
  await sminos(f, [], ['audience', 'record', 'locations']);
  await index.refreshOrgProjects({ machine: f.services.machine.ref, enrollment: () => ({ org: ORG, machine: 'mini' }), home });
  return { f, home, index, a: await openRemote(f, org.a1, org.A) };
}

/** Remote lane B as main's `remoteLaneB.dispatch` gives it: the act signed with the device's step-up, its outcome. */
async function viaLaneB(f: Fixture, r: Remote, name: CommandName, input: unknown): Promise<CommandResult<CommandName>> {
  const action = await r.device.stepUp(r.device.action({ machine: f.ref, action: name, args: input as Record<string, unknown> }));
  const from = r.inbox.length;
  if ((await act(r, action)) !== 'ok') return { ok: false, error: { code: 'internal', message: `${name} was not admitted` } };
  const outcome = (await done(r, action, from)) as { state: string; result?: unknown; reason?: string; error?: { message?: string } };
  return outcome.state === 'done' ? ({ ok: true, value: outcome.result } as CommandResult<CommandName>) : { ok: false, error: { code: 'invalid_input', message: outcome.error?.message ?? outcome.reason ?? outcome.state } };
}

const NO_PROJECTS: OrgProjects = { projects: [], keys: {}, moved: {}, removals: [], seen: {} };

/** Main on this Mac, signed in with one window open: its host supervisor on the daemon and the project acts' handler. */
async function mainOn(scene: MawsdScene, target: { f: Fixture; a: Remote }, options: { withdrawals?: false } = {}) {
  const hosts = scene.appHosts({}, { machine: true });
  void hosts.start();
  await until(() => hosts.snapshot('engine-host').state === 'ready' && hosts.snapshot('machine').state === 'ready' && hosts.streaming('engine-host'), 10_000, 'main’s two links to the daemon');
  let closed = () => {};
  registerAppWindow({ focus: () => {}, isDestroyed: () => false, once: (_event: string, listener: () => void) => void (closed = listener) } as never);
  stops.push(() => closed());
  const handlers = new Map<string, (input: unknown) => unknown>();
  const asks: ProjectActAsks[] = [];
  const answers: Array<Promise<unknown>> = []; // main's answers to the daemon, settled before the scene ends
  const acts = startProjectActs({
    hosts: {
      // `withdrawals: false` leaves the daemon's withdrawals unheard, so only the connection's loss can drop an ask
      onEvent: ((name: Parameters<typeof hosts.onEvent>[0], listener: never) => (options.withdrawals === false && name === 'projects.act.withdrawn' ? () => {} : hosts.onEvent(name, listener))) as never,
      onState: hosts.onState.bind(hosts),
      dispatch: ((owner: 'machine', name: CommandName, input: unknown) => {
        const sent = hosts.dispatch(owner, name, input as never);
        answers.push(sent);
        return sent;
      }) as never,
    },
    registry: { projects: () => NO_PROJECTS, machines: async () => [{ ref: target.f.ref as MachineRef, name: 'mini' }] },
    roster: () => [target.f.ref as MachineRef],
    link: (ref) => (ref === target.f.ref ? target.a : null),
    send: (r, name, input) => viaLaneB(target.f, r, name, input),
    register: ((name: string, handler: (input: unknown) => unknown) => void handlers.set(name, handler)) as never,
    emit: (value) => void asks.push(value),
    log: () => {},
  });
  stops.push(acts.stop);
  const waiting = () => asks.at(-1)?.asks ?? [];
  const decide = (id: string, confirm: boolean) => handlers.get('org.projectActs.decide')!({ id, confirm }) as Promise<void>;
  return { hosts, waiting, decide, answered: () => Promise.all(answers) };
}

describe('maws aimed at another machine, with the app', () => {
  it('reaches the target endpoint once confirmed, and the terminal prints its result', { timeout: 30_000 }, async () => {
    const target = await mini();
    const scene = new MawsdScene('maws-pa-');
    scenes.push(scene);
    await scene.start();
    const main = await mainOn(scene, target);
    const folder = join(target.home, 'work/scrape');

    const terminal = maws(scene, ['project', 'add', `mini:${folder}`]);
    await until(() => main.waiting().length === 1, 5_000, 'the request on the page');
    expect(main.waiting()[0]).toMatchObject({ verb: 'add', machine: target.f.ref, machineName: 'mini', path: folder });
    await main.decide(main.waiting()[0]!.id, true);
    const { code, out, err } = await terminal;
    expect(await main.answered()).toEqual([{ ok: true, value: undefined }]); // the daemon took the answer

    const row = target.index.projects.list({ includeHidden: true }).find((p) => p.directory === folder && p.hidden !== true);
    expect(row, 'the folder declared on mini').toBeDefined();
    expect([code, err]).toEqual([0, '']);
    expect(out).toBe(`added scrape as a new project (${row!.org?.smnsId})\nsminos has not confirmed yet; a session started now may be filed under mini for a moment\n`);
  });

  it('ends the wait with the refusal when the app’s connection ends while a request waits: exit 2', { timeout: 30_000 }, async () => {
    const target = await mini();
    const scene = new MawsdScene('maws-pa-');
    scenes.push(scene);
    await scene.start();
    const main = await mainOn(scene, target);
    const folder = join(target.home, 'work/scrape');

    const terminal = maws(scene, ['project', 'add', `mini:${folder}`]);
    await until(() => main.waiting().length === 1, 5_000, 'the request on the page');
    main.hosts.stop(); // main quits with the sheet unanswered
    const { code, out, err } = await terminal;
    expect([code, out, err]).toEqual([2, '', `${notRunningHere({ verb: 'add', machine: 'mini', path: folder })}\n`]);
    expect(target.index.projects.list({ includeHidden: true }).some((p) => p.directory === folder && p.hidden !== true)).toBe(false);
  });

  // Decision Log 22, review 1's finding 3: the daemon's connection ending drops what main holds, through the real link
  it('drops the ask from the page when the daemon’s connection ends', { timeout: 30_000 }, async () => {
    const target = await mini();
    const scene = new MawsdScene('maws-pa-');
    scenes.push(scene);
    const daemon = await scene.start();
    const main = await mainOn(scene, target, { withdrawals: false });
    const terminal = maws(scene, ['project', 'add', `mini:${join(target.home, 'work/scrape')}`]);
    await until(() => main.waiting().length === 1, 5_000, 'the request on the page');
    await daemon.stop('test: the daemon goes');
    await until(() => main.hosts.snapshot('machine').state !== 'ready' && main.waiting().length === 0, 5_000, 'the ask dropped at the link’s loss');
    expect((await terminal).code).not.toBe(0);
  });
});

describe('maws against an enrolled endpoint, with no app', () => {
  it('lists a project held only on another machine, and `--into` resolves it by name', { timeout: 30_000 }, async () => {
    const studioKey = await generateSigningKey();
    const studio = mintRef();
    const f = await startEndpoint(org, started, {
      amend: (s) => {
        s.machines.push({ name: 'studio', ref: studio, pub: studioKey.pub, owners: [org.A] });
        s.machineNames.push({ name: 'studio', ref: studio });
      },
    });
    const id = crypto.randomUUID();
    const body: ProjectsRecord = {
      org: ORG,
      machine: studio,
      revision: 1,
      issued: new Date().toISOString(),
      locations: [{ pid: 'p-render', id, key: `folder:${studio}:/srv/render`, name: 'render', path: '/srv/render', source: 'folder', stated: 'minted' }],
      known: [],
    };
    await f.endpoint.registry.held.frame({ t: 'projects', record: await signRecord(SIGNING_DOMAINS.projects, body, studioKey.privateKey, studioKey.pub) });
    await reached(() => f.endpoint.registry.projects().some((p) => p.id === id), 'studio’s record held');

    const scene = new MawsdScene('maws-pr-');
    scenes.push(scene);
    const endpoint: EndpointModule = {
      start: async () => {},
      stop: async () => {},
      status: () => ({ enrolled: true }),
      enrollment: () => ({ name: 'mini', org: ORG }),
      cli: async () => ({ code: 0, out: '' }),
      registryRead: f.endpoint.registry,
    };
    await scene.start({ endpoint });

    const list = await maws(scene, ['project', 'list']);
    expect([list.code, list.err]).toEqual([0, '']);
    expect(list.out).toBe(`render  ${id}  studio:/srv/render\n`);

    // no app: the refusal's command for studio carries the id `--into render` resolved to
    const add = await maws(scene, ['project', 'add', 'studio:/srv/render-2', '--into', 'render']);
    expect([add.code, add.out, add.err]).toEqual([2, '', `${notRunningHere({ verb: 'add', machine: 'studio', path: '/srv/render-2', into: id })}\n`]);
  });
});
