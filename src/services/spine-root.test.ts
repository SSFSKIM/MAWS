// The spine composed under plain Node (P5 O3-C, docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, acceptance
// 1 and the bundle-free half of 3; D25): `openSpineData` over a scratch profile, `startSpine` against a fake engine host
// and the fake bus, a replay played through `session.replay.start` and folded into the index, the read model and
// attention, the checkouts over the spine's view (P5 O3-E M2: composed by the root itself, its last parts), and the
// root's stop releasing what it held. The exact commands, intercepts and taps the root installs are pinned here.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_CLIENT, type ClientPort } from '@shared/client/port';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import { REGISTRY } from '@shared/ipc/registry';
import type { CommandName } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { captureConsole } from '../../test/support/console-capture';
import { fakeBus, type FakeBus } from '../../test/support/fake-bus';
import { startFakeBridge, type FakeBridge } from '../../test/support/fake-bridge';
import { FakeSpineHost } from '../../test/support/fake-spine-host';
import { CHECKOUTS_COMMANDS, CONNECTORS_COMMANDS, SPINE_COMMANDS } from '../../test/support/spine-lists';
import { FIXTURE_DIR } from '../../test/support/fixtures';
import { summary, tempDir } from '../../test/support/index-fixture';
import { GitService } from './git/service';
import { Index } from './index/index';
import { ScmService } from './scm/service';
import { openSpineData, startSpine, type SpineData, type SpineRoot } from './spine-root';
import { takeSpineLock } from './settings/spine-lock';

const JOURNAL = join(FIXTURE_DIR, 'permission-roundtrip.jsonl');
const MACHINE = 'TestMachineRef00000000' as MachineRef;
const BUILD = '0.0.0+spine-root-test';

// A client port with no client behind it: the spine composes without a screen (OX4's noClient answers)
const noClientPort = {
  pick: async () => NO_CLIENT,
  save: async () => NO_CLIENT,
  confirm: async () => NO_CLIENT,
  reveal: async () => NO_CLIENT,
  openExternal: async () => NO_CLIENT,
  notify: () => NO_CLIENT,
  badge: () => NO_CLIENT,
  focus: () => NO_CLIENT,
} as unknown as ClientPort;

// What the root installs through its bus (D25), sorted: the commands mawsd's services front serves for it (P5 O3-E: the
// checkouts' among them), the intercepts on another owner's commands, and the emitted events the root taps. A run
// refused the spine (O3-A) registers the spine's commands but those of the parts it does not start (the checkouts start
// in it too: they write no spine file). SPINE_COMMANDS is test/support/spine-lists.ts's, which mawsd's front is held to
// as well (P5 O3-D M2).
const SPINE_REFUSED_COMMANDS = [
  ...CHECKOUTS_COMMANDS,
  ...CONNECTORS_COMMANDS, // P5 O4 M2: the connectors and delivery hold no spine file either
  'library.fileLinkedPaths', 'library.get', 'library.list', 'library.spaces',
  'machineSettings.get', 'machineSettings.set', // P5 O3-D M5b: read, and a set refused (the machine half is read-only)
  'session.appEvents', 'session.digests', 'session.drafts.get', 'session.drafts.set', 'session.engineStatuses', 'session.get', 'session.launchMode', 'session.list', 'session.observedFacts',
  'session.projects.add', 'session.projects.addFolder', 'session.projects.list', 'session.projects.remove', 'session.projects.update',
  'session.recentTurns', 'session.search', 'session.setVisible', 'session.update', 'session.visible',
  'settings.engineApplied', 'settings.userEngineDefaults',
].sort();
// P5 O3-D M4 (D18): the rewind's last-act note and the conversation acts that clear it, in launch mode index; M5a (D47):
// lane B's claimed op, for a phone's rewind or act
const SPINE_INTERCEPTS = ['session.answer', 'session.rewind', 'session.send', 'session.steer', 'session.queue.promote', 'session.bash', 'host.op'];
const SPINE_REFUSED_INTERCEPTS = ['session.answer']; // no session service: nothing to repair
const SPINE_TAPS = ['attention.changed', 'session.eventBatch', 'session.intent.changed', 'session.projects.changed'];
const SPINE_REFUSED_TAPS = ['attention.changed', 'session.eventBatch', 'session.intent.changed']; // no projects to follow: the index is unavailable
// P5 O3-D M1 (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §I): what the services front emits of
// its own beside the spine's events; with them, the machine host's event list (`REGISTRY.machineEvents`). M5b: the
// machine half's and the visible set's changes are the spine's own emits (the parts that hold them emit them), so the
// front's own is the client port's request alone.
const FRONT_EVENTS = ['clientPort.request'];
// Every event the spine's parts emit through the bus, read from the library's source: each `emit('<event>'` under
// src/services/ (P5 O3-E: the checkouts' root's `git.changed`, `files.changed` and `scm.remote.output` included). A part
// emits through a function it was handed, always with the event's name written.
function spineEmits(): string[] {
  const root = __dirname;
  const names = new Set<string>();
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
    for (const [, name] of readFileSync(path, 'utf8').matchAll(/\bemit\(\s*'([a-zA-Z]+(?:\.[a-zA-Z]+)+)'/g)) names.add(name!);
  }
  return [...names].sort();
}

describe('the spine and the checkouts composed under plain Node', () => {
  let dir: ReturnType<typeof tempDir>;
  let profile: string;
  let sminos: string; // lane A's sminos home: short, since a bridge's socket path must stay under 104 bytes
  let held: { data: SpineData; spine: SpineRoot; stopped?: boolean }[];
  let bridges: FakeBridge[];

  beforeEach(() => {
    dir = tempDir('maws-spine-root-');
    profile = join(dir.path, 'ud');
    mkdirSync(profile);
    mkdirSync(join(dir.path, 'home'));
    sminos = mkdtempSync('/tmp/o3c-s-');
    held = [];
    bridges = [];
  });
  afterEach(async () => {
    for (const composed of held.reverse()) {
      stopOnce(composed);
      composed.data.lock.release();
    }
    for (const bridge of bridges) await bridge.close();
    vi.restoreAllMocks();
    rmSync(sminos, { recursive: true, force: true });
    dir.dispose();
  });

  // The root's stop, once
  const stopOnce = (composed: (typeof held)[number]) => {
    if (composed.stopped) return;
    composed.stopped = true;
    composed.spine.stop();
  };

  // The root as either process composes it, on its bus
  const compose = (data: SpineData, host: FakeSpineHost, bus: FakeBus, { engineEnv = Promise.resolve<Record<string, string>>({ HOME: join(dir.path, 'home'), CLAUDE_CONFIG_DIR: join(dir.path, 'claude') }) } = {}) => {
    const spine = startSpine({
      profile,
      machine: MACHINE,
      data,
      hosts: host,
      bus,
      clientPort: noClientPort,
      interest: () => new Set(),
      browserSocket: () => null,
      trash: async () => {},
      engineEnv,
      env: { SMINOS_HOME: sminos },
      packaged: false,
      appPath: dir.path, // no checkout's fixtures beside it
      devRoot: dir.path,
      home: join(dir.path, 'home'),
    });
    const composed = { data, spine };
    held.push(composed);
    return composed;
  };

  it('plays a replay into the index, the read model and attention, and answers session.list, session.digests and attention.list', async () => {
    const data = await openSpineData(profile, { build: BUILD });
    expect(data.refused).toBeNull();
    const host = new FakeSpineHost();
    const bus = fakeBus();
    const { spine } = compose(data, host, bus);
    expect(spine.view.unavailable()).toBeNull();
    await host.ready();

    const progress: string[] = [];
    host.onEvent('session.replay.progress', ({ state }) => void progress.push(state));
    const started = await bus.invoke('session.replay.start', { source: { kind: 'journal', path: JOURNAL }, speed: 'instant' });
    if (!started.ok) throw new Error(started.error.message);
    const appSessionId = started.value.appSessionId as AppSessionId;
    await vi.waitFor(() => expect(progress).toContain('done'), { timeout: 20_000 });

    const listed = await bus.invoke('session.list', { includeArchived: false });
    expect(listed).toMatchObject({ ok: true });
    expect((listed as { value: { sessions: { appId: string; title: { text: string } }[] } }).value.sessions).toContainEqual(
      expect.objectContaining({ appId: appSessionId, title: expect.objectContaining({ text: 'replay · permission-roundtrip' }) }),
    );
    const digests = await bus.invoke('session.digests', undefined);
    if (!digests.ok) throw new Error(digests.error.message);
    const digest = digests.value.digests.find((candidate) => candidate.appSessionId === appSessionId);
    expect(digest?.lastAssistantLine).toBe('DONE'); // the journal's last assistant text (seq 275), its last turn's reply
    const attention = await bus.invoke('attention.list', undefined);
    if (!attention.ok) throw new Error(attention.error.message);
    expect(attention.value).toContainEqual(expect.objectContaining({ appSessionId, kind: 'permission', state: 'pending' }));
    // the view reads what the renderer was told
    expect(spine.view.record(appSessionId)?.title.text).toBe('replay · permission-roundtrip');
    expect(spine.view.attention(appSessionId).map((item) => item.kind)).toContain('permission');
    // P5 O3-D M1: everything the spine emitted is the machine host's to emit (the front's gate at M2)
    for (const { name } of bus.emitted) expect(REGISTRY.machineEvents, name).toContain(name);
  });

  // P5 O3-D M2 (Interfaces §A, D26): a process that loads the spine more than once holds the lock itself and opens
  // each load's data under it; a second one-shot open in the same process would refuse itself
  it('opens a second load under the lock the process holds, after the first load stopped', async () => {
    const lock = await takeSpineLock(profile, { build: BUILD });
    expect(lock.refused).toBeNull();
    const first = await openSpineData(profile, { build: BUILD, lock });
    expect(first.refused).toBeNull();
    const one = compose(first, new FakeSpineHost(), fakeBus());
    stopOnce(one);
    const second = await openSpineData(profile, { build: BUILD, lock });
    expect(second.refused).toBeNull();
    const two = compose(second, new FakeSpineHost(), fakeBus());
    expect(two.spine.view.unavailable()).toBeNull();
    stopOnce(two);
    lock.release();
  });

  // P5 O3-D M2 (Interfaces §A, D27): the root reports a command its parts registered while it runs, and settles at its
  // end, so a release never closes the index under it
  it('is busy while a command it registered runs and settles once it answered', async () => {
    const data = await openSpineData(profile, { build: BUILD });
    const host = new FakeSpineHost();
    const bus = fakeBus();
    const { spine } = compose(data, host, bus);
    await spine.settled();
    expect(spine.busy()).toBe(false);
    // the session service answers nothing before the engine host streams, so a start waits on it
    const start = bus.invoke('session.start', { appSessionId: '11111111-1111-4111-8111-111111111111', message: null, options: {} });
    await vi.waitFor(() => expect(spine.busy()).toBe(true));
    let settled = false;
    const settling = spine.settled().then(() => void (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    await host.ready();
    expect(await start).toMatchObject({ ok: true, value: { status: 'refused', reason: 'unknown_session' } });
    await settling;
    expect(spine.busy()).toBe(false);
  });

  // P5 O3-D M2 review (Interfaces §A, D27): a yield settles the root and gives spine.lock up while the session service's
  // startup still waits at an async boundary (here the login-shell capture); the startup must not resume into the
  // recovery, a subscription or a write once the root stopped and another process may hold the lock
  it('a root stopped while the session service’s startup waits resumes into no recovery and no subscription after the handover', async () => {
    const data = await openSpineData(profile, { build: BUILD });
    const host = new FakeSpineHost();
    await host.ready(); // the host streams: nothing but the environment holds the startup
    let capture!: (env: Record<string, string>) => void;
    const engineEnv = new Promise<Record<string, string>>((resolve) => (capture = resolve));
    const composed = compose(data, host, fakeBus(), { engineEnv });
    await composed.spine.settled();
    expect(composed.spine.busy()).toBe(false);
    stopOnce(composed);
    data.lock.release(); // the yield's handover
    const candidate = await takeSpineLock(profile, { build: 'the next writer', waitMs: 10, log: () => {} });
    expect(candidate.refused).toBeNull();
    const asked = host.calls.length;
    capture({ HOME: join(dir.path, 'home'), CLAUDE_CONFIG_DIR: join(dir.path, 'claude') });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host.calls.slice(asked).map((call) => call.name)).toEqual([]); // no recovery's engine.sessions, nothing at all
    expect(host.held()).toBe(0); // no late subscription
    candidate.release();
  });

  // P5 O3-D fix wave (D27): the owner channel's transcript-chain read for a rewind this run cannot place continues into
  // the index (the marks it retires), so the root is busy until it settled and a release never closes the index under it
  it('is busy while the owner channel’s read for a rewind is in flight, and settles once it folded', async () => {
    const engineSessionId = '0e5b1c0d-0000-4000-8000-0000000000b2';
    const seeded = new Index(join(profile, 'index.sqlite'));
    const appSessionId = seeded.sessions.upsertFromSummary(summary({ sessionId: engineSessionId as SessionId })).record.appId;
    seeded.close();
    const data = await openSpineData(profile, { build: BUILD });
    const host = new FakeSpineHost();
    await host.ready();
    let capture!: (env: Record<string, string>) => void;
    const engineEnv = new Promise<Record<string, string>>((resolve) => (capture = resolve)); // holds the transcript's path
    const { spine } = compose(data, host, fakeBus(), { engineEnv });
    await spine.settled();
    expect(spine.busy()).toBe(false);
    const rewind = {
      id: 'ev-rewind-1', sessionId: engineSessionId, at: '2026-10-30T10:00:00.000Z', seq: 1, agentId: null, parentToolUseId: null,
      kind: 'boundary.rewind', targetMessageUuid: '6f1d2c3b-0000-4000-8000-0000000000c3', precedingAssistantUuid: null, prefillText: null,
    } as const;
    host.emit('session.eventBatch', { appSessionId, events: [rewind] } as never);
    expect(spine.busy()).toBe(true);
    let settled = false;
    const settling = spine.settled().then(() => void (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    capture({ HOME: join(dir.path, 'home'), CLAUDE_CONFIG_DIR: join(dir.path, 'claude') });
    await settling;
    expect(spine.busy()).toBe(false);
  });

  // P5 O9 (O3 Decision Log 13): lane A drives, from the spine, a terminal session the index held at start, and its
  // bridge's request reaches attention and the session's digest
  it('drives a terminal session the index holds through its bridge: laneA.state, its request in attention, its digest', async () => {
    const engineSessionId = '0e5b1c0d-0000-4000-8000-0000000000a1';
    const seeded = new Index(join(profile, 'index.sqlite'));
    const appSessionId = seeded.sessions.upsertFromSummary(summary({ sessionId: engineSessionId as SessionId })).record.appId;
    seeded.sessions.setHolder(engineSessionId as SessionId, { kind: 'terminal', pid: 4242 });
    seeded.close();
    const bridge = await startFakeBridge({ home: sminos, session: engineSessionId });
    bridges.push(bridge);
    const bus = fakeBus();
    compose(await openSpineData(profile, { build: BUILD }), new FakeSpineHost(), bus);

    await expect.poll(async () => bus.invoke('laneA.state', { appSessionId }), { timeout: 5000 }).toMatchObject({ ok: true, value: { appSessionId, engineSessionId, bridge: 'live' } });
    bridge.raise({ request: 'req-1', tool: 'Bash', input: { command: 'ls' } });
    await expect.poll(async () => bus.invoke('attention.list', undefined), { timeout: 5000 }).toMatchObject({
      ok: true, value: [expect.objectContaining({ id: `lane-a:${engineSessionId}:req-1`, appSessionId, kind: 'permission', state: 'pending' })],
    });
    const digests = await bus.invoke('session.digests', undefined);
    if (!digests.ok) throw new Error(digests.error.message);
    expect(digests.value.digests.find((d) => d.appSessionId === appSessionId)).toMatchObject({ phase: 'waiting', pendingRequests: 1 });
  });

  // P5 O3-E M2 (docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, acceptance 1 and 7): the checkouts answer from
  // startSpine alone, over a session the index holds in a scratch repository, and files' admission of a File artifact
  // outside the session's directories reads the in-process view, with no library.fileLinkedPaths through the bus
  it('composes the checkouts over the spine’s view: git.status, git.lsFiles, files.list and scm.status for a session’s repository', async () => {
    const repository = realpathSync(mkdtempSync(join(dir.path, 'repository-')));
    execFileSync('git', ['init', '-q', '-b', 'main', repository]);
    writeFileSync(join(repository, 'notes.md'), '# notes\n');
    const outside = join(dir.path, 'delivered.csv');
    writeFileSync(outside, 'a,b\n');
    const seeded = new Index(join(profile, 'index.sqlite'));
    const appSessionId = seeded.sessions.upsertFromSummary(summary({ directory: repository })).record.appId;
    seeded.close();
    const bus = fakeBus();
    const register = bus.register;
    let linkedReads = 0; // the interim admission command's runs through the bus
    bus.register = (name, handler) => register(name, (name === 'library.fileLinkedPaths' ? (input: never, context: never) => ((linkedReads += 1), handler(input, context)) : handler) as typeof handler);
    const { spine } = compose(await openSpineData(profile, { build: BUILD }), new FakeSpineHost(), bus);

    expect(await bus.invoke('git.status', { directory: repository })).toMatchObject({ ok: true, value: { repoRoot: repository, branch: 'main', dirty: true } });
    expect(await bus.invoke('git.lsFiles', { directory: repository, query: 'not', limit: 10 })).toMatchObject({ ok: true, value: { paths: ['notes.md'], source: 'git' } });
    expect(await bus.invoke('files.list', { appSessionId, path: repository })).toMatchObject({ ok: true, value: { root: repository, entries: expect.arrayContaining([expect.objectContaining({ name: 'notes.md', kind: 'file' })]) } });
    expect(await bus.invoke('scm.status', { appSessionId })).toMatchObject({ ok: true, value: { directory: repository, repository: true, trusted: false } });
    // M3 (acceptance 5): an upload lands in the session's attachments directory, excluded from git, its root recorded
    const uploaded = await bus.invoke('files.upload', { appSessionId, files: [{ name: 'a.txt', bytes: 'YQ==' }] });
    expect(uploaded).toMatchObject({ ok: true, value: { status: 'ok', paths: [expect.stringMatching(new RegExp(`^${repository}/\\.claude/desk-uploads/${appSessionId}/[A-Za-z0-9_-]{22}\\.0\\.txt$`))] } });
    const [stored] = uploaded.ok && uploaded.value.status === 'ok' ? uploaded.value.paths : [];
    expect(readFileSync(stored!, 'utf8')).toBe('a');
    expect(execFileSync('git', ['-C', repository, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' })).toBe('?? notes.md\n');
    expect(JSON.parse(readFileSync(join(profile, 'sessions', 'uploads.json'), 'utf8')).roots).toEqual([expect.objectContaining({ path: join(repository, '.claude', 'desk-uploads', appSessionId), session: appSessionId })]);

    const linked = vi.spyOn(spine.view, 'fileLinkedPaths');
    expect(await bus.invoke('files.read', { appSessionId, path: outside })).toMatchObject({ ok: false }); // linked to nothing: refused
    linked.mockResolvedValue([outside]); // a File artifact delivered outside the session's directories
    expect(await bus.invoke('files.read', { appSessionId, path: outside })).toMatchObject({ ok: true, value: { content: 'a,b\n' } });
    expect(linked).toHaveBeenCalledWith(appSessionId);
    expect(linkedReads).toBe(0);
    // library.read's reach: main-only, a resolved path read with files.read's rules
    expect(await bus.invoke('files.readResolved', { path: outside })).toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
    expect(await bus.main('files.readResolved', { path: outside })).toMatchObject({ ok: true, value: { content: 'a,b\n' } });
    expect(await bus.main('files.readResolved', { path: join(dir.path, 'gone.csv') })).toMatchObject({ ok: false, error: { message: `not found: ${join(dir.path, 'gone.csv')}` } });
  });

  // P5 O3-E M2 (acceptance 4): the checkouts' acts run under the services' ledger: a replayed op id answers its stored
  // result without a second run
  it('runs a checkout act claimed by machine.op once, and answers a replayed op id from the ledger', async () => {
    const repository = realpathSync(mkdtempSync(join(dir.path, 'repository-')));
    execFileSync('git', ['init', '-q', '-b', 'main', repository]);
    const seeded = new Index(join(profile, 'index.sqlite'));
    const appSessionId = seeded.sessions.upsertFromSummary(summary({ directory: repository })).record.appId;
    seeded.close();
    const bus = fakeBus();
    compose(await openSpineData(profile, { build: BUILD }), new FakeSpineHost(), bus);
    const stage = vi.spyOn(ScmService.prototype, 'stage');
    const op = { opId: '9b8f3a52-0000-4000-8000-0000000000a1', opCreated: new Date().toISOString(), claim: { member: 'mem-a', device: 'dev-1', fingerprint: 'fp-1' }, name: 'scm.stage', input: { appSessionId, paths: ['a.txt'] } };
    const first = await bus.main('machine.op', op);
    expect(first).toMatchObject({ ok: true, value: { state: 'done', result: { ok: true, value: { refused: 'untrusted' } } } }); // the engine trusts no scratch checkout
    expect(await bus.main('machine.op', op)).toEqual(first);
    expect(stage).toHaveBeenCalledOnce();

    // M3 (acceptance 4's upload half): an upload claimed once writes once, and its replay answers the stored paths
    const upload = { ...op, opId: '9b8f3a52-0000-4000-8000-0000000000a2', name: 'files.upload', input: { appSessionId, files: [{ name: 'a.png', bytes: 'iVBORw0KGgo=' }] } };
    const uploaded = await bus.main('machine.op', upload);
    expect(uploaded).toMatchObject({ ok: true, value: { state: 'done', result: { ok: true, value: { status: 'ok', paths: [expect.stringMatching(/\.0\.png$/)] } } } });
    expect(await bus.main('machine.op', upload)).toEqual(uploaded);
    expect(readdirSync(join(repository, '.claude', 'desk-uploads', appSessionId))).toHaveLength(1); // a second run would mint a second id
  });

  // M3 (Interfaces §F): the upload roots are swept when the checkouts start (then hourly), of a root a day after its
  // last upload, its lane B files alone
  it('sweeps the upload roots a day after their last upload when the checkouts start', async () => {
    const root = join(realpathSync(dir.path), 'checkout', '.claude', 'desk-uploads', '11111111-1111-4111-8111-111111111111');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'up1.0.txt'), 'old');
    writeFileSync(join(root, 'notes.md'), 'not an upload');
    mkdirSync(join(profile, 'sessions'), { recursive: true });
    writeFileSync(join(profile, 'sessions', 'uploads.json'), JSON.stringify({ version: 1, roots: [{ path: root, session: '11111111-1111-4111-8111-111111111111', at: new Date(Date.now() - 25 * 3600_000).toISOString() }] }));
    captureConsole('warn', /^\[files\] swept 1 upload root /);
    compose(await openSpineData(profile, { build: BUILD }), new FakeSpineHost(), fakeBus());
    await vi.waitFor(() => expect(readdirSync(root)).toEqual(['notes.md']));
    await vi.waitFor(() => expect(JSON.parse(readFileSync(join(profile, 'sessions', 'uploads.json'), 'utf8')).roots).toEqual([]));
  });

  it('composes the checkouts in a run refused the spine too: git.status answers, the rest are registered', async () => {
    held.push({ data: await openSpineData(profile, { build: BUILD }), spine: { view: null as never, settled: async () => {}, busy: () => false, stop: () => {} } }); // a live holder of spine.lock: this process
    captureConsole('error', /^\[(spine|index)\] /);
    captureConsole('warn', /^\[library\] /);
    const data = await openSpineData(profile, { build: BUILD });
    expect(data.refused).not.toBeNull();
    const repository = join(dir.path, 'repository');
    mkdirSync(repository);
    execFileSync('git', ['init', '-q', '-b', 'main', repository]);
    const bus = fakeBus();
    compose(data, new FakeSpineHost(), bus);
    expect(await bus.invoke('git.status', { directory: repository })).toMatchObject({ ok: true, value: { repoRoot: realpathSync(repository), branch: 'main' } });
    const unknown = '11111111-1111-4111-8111-111111111111';
    expect(await bus.invoke('files.list', { appSessionId: unknown })).toMatchObject({ ok: false, error: { message: `unknown app session: ${unknown}` } });
    expect(await bus.invoke('scm.status', { appSessionId: unknown })).toMatchObject({ ok: false, error: { message: `unknown app session: ${unknown}` } });
    expect(await bus.invoke('git.lsFiles', { directory: repository, query: '', limit: 10 })).toMatchObject({ ok: false, error: { message: expect.stringContaining('is not a directory of any session or project') } });
    expect(await bus.invoke('files.upload', { appSessionId: unknown, files: [{ name: 'a.txt', bytes: 'YQ==' }] })).toEqual({ ok: true, value: { status: 'refused', reason: 'uploads are not available this run' } }); // M3: no record of the roots
  });

  // P5 O3-E M2 (D14): a push or a pull request outlives its command's answer; the root's release waits for it
  it('is busy while scm has a run in flight, and settles when it ends', async () => {
    const { spine } = compose(await openSpineData(profile, { build: BUILD }), new FakeSpineHost(), fakeBus());
    await spine.settled();
    let end!: () => void;
    const runs = vi.spyOn(ScmService.prototype, 'runs', 'get').mockReturnValue({ busy: () => end !== undefined, settled: () => new Promise<void>((resolve) => (end = resolve)) });
    expect(spine.busy()).toBe(false);
    let settled = false;
    const settling = spine.settled().then(() => void (settled = true));
    await vi.waitFor(() => expect(end).toBeDefined());
    expect(spine.busy()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    runs.mockReturnValue({ busy: () => false, settled: async () => {} });
    end();
    await settling;
  });

  // D12: the spine reads the machine half alone and follows its changes, with no client half or settings.changed event
  it('relays a change of the machine half to the engine host', async () => {
    const data = await openSpineData(profile, { build: BUILD });
    const host = new FakeSpineHost();
    compose(data, host, fakeBus());
    await host.ready();
    const pushed = () => host.calls.filter((call) => call.name === 'host.configure').map((call) => call.input);
    expect(pushed().at(-1)).toEqual({ idleExitMs: data.machineSettings.state().supervisor.idleExitMinutes! * 60_000 });
    data.machineSettings.update({ supervisor: { idleExitMinutes: 7 } });
    expect(pushed().at(-1)).toEqual({ idleExitMs: 7 * 60_000 });
  });

  // P5 O3-D M5b (Interfaces §F, §G): what main's mirror and its settings mirror read of the spine over the services front
  // on the daemon shape: the machine half with its revision and its changes, the visible set with its changes, and files'
  // admission read
  it('answers the machine half, the visible set and files’ admission read, and emits each change', async () => {
    const data = await openSpineData(profile, { build: BUILD });
    const host = new FakeSpineHost();
    const bus = fakeBus();
    compose(data, host, bus);
    await host.ready();
    expect(await bus.main('machineSettings.get', undefined)).toEqual({ ok: true, value: { settings: data.machineSettings.state(), version: 0 } });
    const set = await bus.main('machineSettings.set', { patch: { supervisor: { idleExitMinutes: 7 } } });
    expect(set).toMatchObject({ ok: true, value: { settings: { supervisor: { idleExitMinutes: 7 } } } });
    expect(JSON.parse(readFileSync(data.paths.machine, 'utf8'))).toMatchObject({ supervisor: { idleExitMinutes: 7 } }); // persisted before the answer
    expect(bus.emittedOf('machineSettings.changed')).toEqual([{ settings: data.machineSettings.state() }]);
    expect(await bus.main('machineSettings.get', undefined)).toMatchObject({ ok: true, value: { version: 1 } });

    const id = '11111111-1111-4111-8111-111111111111';
    expect(await bus.main('session.visible', undefined)).toEqual({ ok: true, value: { sessions: [] } });
    expect(await bus.invoke('session.setVisible', { appSessionId: id, visible: true })).toMatchObject({ ok: true });
    expect(await bus.main('session.visible', undefined)).toEqual({ ok: true, value: { sessions: [id] } });
    expect(await bus.invoke('session.setVisible', { appSessionId: id, visible: false })).toMatchObject({ ok: true });
    expect(bus.emittedOf('session.visibleChanged')).toEqual([{ appSessionId: id, visible: true }, { appSessionId: id, visible: false }]);
    expect(await bus.main('session.engineStatuses', undefined)).toEqual({ ok: true, value: { statuses: [] } }); // M5b fix round 6

    expect(await bus.main('library.fileLinkedPaths', { appSessionId: id })).toEqual({ ok: true, value: { paths: [] } });
  });

  // P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, M2's Proves): the connectors, their sign-in and
  // delivery composed by the root alone, over the fake engine host, a scratch custody under the profile and a fake gws
  // on the engine environment's PATH; a release takes the receipts with it (they are the load's, D30)
  it('composes the connectors and delivery: a lease, its declaration, the owner’s rows, Drive’s state, a delivery and its receipt', async () => {
    const ART = '11111111-1111-4111-8111-111111111111';
    const bin = join(dir.path, 'bin');
    mkdirSync(bin);
    const gws = join(bin, 'gws');
    writeFileSync(gws, [
      '#!/bin/sh',
      'case "$1 $2" in',
      `  "auth status") echo '{"auth_method":"oauth2","credential_source":"encrypted","user":"owner@example.com","scopes":["https://www.googleapis.com/auth/drive"]}' ;;`,
      `  "drive files") echo '{"id":"f1","name":"Quarterly memo.docx","webViewLink":"https://drive.google.com/file/d/f1/view"}' ;;`,
      '  *) exit 3 ;;',
      'esac',
      '',
    ].join('\n'));
    chmodSync(gws, 0o755);
    const engineEnv = Promise.resolve<Record<string, string>>({ HOME: join(dir.path, 'home'), CLAUDE_CONFIG_DIR: join(dir.path, 'claude'), PATH: `${bin}:/usr/bin:/bin` });
    const lock = await takeSpineLock(profile, { build: BUILD });
    const host = new FakeSpineHost();
    const at = 1_793_000_000_000;
    host.answer('artifacts.get', () => ({ artifact: { id: ART, kind: 'document', title: 'Quarterly memo', createdBy: { kind: 'human' }, createdAt: at, updatedAt: at, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 7 } }));
    const bus = fakeBus();
    const first = compose(await openSpineData(profile, { build: BUILD, lock }), host, bus, { engineEnv });
    await host.ready();

    expect(await bus.main('connectors.windowShown', { shown: true })).toEqual({ ok: true, value: { ok: true } });
    const opened = await bus.invoke('connectors.open', { artifactId: ART });
    if (!opened.ok) throw new Error(opened.error.message);
    expect(await bus.invoke('connectors.declare', { leaseId: opened.value.leaseId, tools: [{ server: 'notes', tool: 'search' }] })).toMatchObject({ ok: true });
    expect(await bus.invoke('connectors.servers', { artifactId: ART, tools: [{ server: 'notes', tool: 'search' }] })).toMatchObject({ ok: true });
    expect(await bus.invoke('delivery.status', { target: 'drive', artifactId: ART })).toEqual({ ok: true, value: { target: 'drive', state: 'ready', user: 'owner@example.com' } });
    expect(await bus.invoke('delivery.receipts', undefined)).toEqual({ ok: true, value: { receipts: [] } });

    // main's export, as it leaves it under the profile, handed over
    const exports = join(profile, 'artifacts', ART, 'exports');
    mkdirSync(exports, { recursive: true });
    const exportPath = join(exports, `7-docx-${'22222222-2222-4222-8222-222222222222'}.docx`);
    writeFileSync(exportPath, 'bytes');
    const delivered = await bus.main('delivery.deliver', { runId: '33333333-3333-4333-8333-333333333333', target: 'drive', artifactId: ART, format: 'docx', destination: { kind: 'default' }, exportPath, revision: 7, title: 'Quarterly memo' });
    expect(delivered).toMatchObject({ ok: true, value: { ok: true, receipt: { target: 'drive', name: 'Quarterly memo.docx', url: 'https://drive.google.com/file/d/f1/view' } } });
    expect(readdirSync(exports)).toEqual([]); // the export removed
    expect(bus.emittedOf('delivery.receipt')).toHaveLength(1);
    expect(await bus.invoke('delivery.receipts', undefined)).toMatchObject({ ok: true, value: { receipts: [{ artifactId: ART, target: 'drive' }] } });

    stopOnce(first);
    const again = fakeBus();
    compose(await openSpineData(profile, { build: BUILD, lock }), new FakeSpineHost(), again, { engineEnv });
    expect(await again.invoke('delivery.receipts', undefined)).toEqual({ ok: true, value: { receipts: [] } });
    lock.release();
  });

  // P5 O4 M2: on the daemon shape a dispatch to a parked engine host starts it, and the discovery wake waits only for a
  // host it woke itself (src/mawsd/discovery-wake.ts): a load asks a host that does not stream nothing (CI run
  // 41205847879, where sign-in's listing at the load spawned the host before the wake)
  it('asks an engine host that does not stream nothing at its load', async () => {
    const host = new FakeSpineHost();
    compose(await openSpineData(profile, { build: BUILD }), host, fakeBus());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host.calls.map(({ name }) => name)).toEqual([]);
  });

  it('installs exactly its commands, intercepts and taps, and its stop releases every listener the spine held on the host', async () => {
    const host = new FakeSpineHost();
    const spineBus = fakeBus();
    const composed = compose(await openSpineData(profile, { build: BUILD }), host, spineBus);
    await host.ready();
    expect(spineBus.registered().sort()).toEqual(SPINE_COMMANDS);
    for (const name of CHECKOUTS_COMMANDS) expect(SPINE_COMMANDS, name).toContain(name); // P5 O3-E: the checkouts' with them
    for (const name of CONNECTORS_COMMANDS) expect(SPINE_COMMANDS, name).toContain(name); // P5 O4: the connectors' and delivery's
    expect(spineBus.intercepted()).toEqual(SPINE_INTERCEPTS); // the checkouts intercept nothing
    expect(spineBus.tapped().sort()).toEqual(SPINE_TAPS); // and tap nothing: they follow the spine through its view
    expect(host.held()).toBeGreaterThan(0);

    stopOnce(composed);
    expect(host.held()).toBe(0);
    expect(spineBus.intercepted()).toEqual([]);
    expect(spineBus.tapped()).toEqual([]);
  });

  // P5 O3-D M1 (Interfaces §I): the spine's commands are `machine`-owned, so the services front serves them on the daemon
  // shape and main's embedded binding on the embedded one; P5 O3-E M2: the checkouts' with them
  it('owns by machine every command the root registers, the checkouts’ included', () => {
    for (const name of SPINE_COMMANDS) expect(REGISTRY.commands[name as CommandName].owner, name).toBe('machine');
  });

  it('lists as the machine host’s events exactly what the spine’s parts emit and the services front’s own', () => {
    const emitted = spineEmits();
    expect(emitted).toEqual(expect.arrayContaining(['attention.changed', 'session.changed', 'session.eventBatch', 'laneA.plane']));
    expect([...REGISTRY.machineEvents].sort()).toEqual([...emitted, ...FRONT_EVENTS].sort());
  });

  // D21: one stop per root, which still stops every later part when one throws, as main's shutdown steps did per part
  it('stops every part of each root, in order, whatever an earlier part threw', async () => {
    const host = new FakeSpineHost();
    const composed = compose(await openSpineData(profile, { build: BUILD }), host, fakeBus());
    await host.ready();
    const failures = captureConsole('error', /^\[shutdown\] (spine|checkouts): /);
    const close = Index.prototype.close;
    vi.spyOn(Index.prototype, 'close').mockImplementationOnce(function (this: Index) {
      close.call(this);
      throw new Error('the index would not close');
    });
    const dispose = GitService.prototype.dispose;
    vi.spyOn(GitService.prototype, 'dispose').mockImplementationOnce(function (this: GitService) {
      dispose.call(this);
      throw new Error('a watch would not close');
    });
    const scmStopped = vi.spyOn(ScmService.prototype, 'dispose');
    stopOnce(composed);
    expect(failures.lines()).toEqual(['[shutdown] spine: index failed; going on', '[shutdown] checkouts: git failed; going on']);
    // the spine's parts after the index (the owner channel, the sweep, yield, side threads, the relays, the library)
    // released what they held on the host, and the checkouts' after git (files, scm) stopped
    expect(host.held()).toBe(0);
    expect(scmStopped).toHaveBeenCalledOnce();
  });

  it('a refused run composes with the view unavailable and registers none of the parts it does not start', async () => {
    held.push({ data: await openSpineData(profile, { build: BUILD }), spine: { view: null as never, settled: async () => {}, busy: () => false, stop: () => {} } }); // a live holder of spine.lock: this process
    const refusal = captureConsole('error', /^\[spine\] spine\.lock is held by pid /);
    const data = await openSpineData(profile, { build: BUILD }); // waits SPINE_LOCK_WAIT_MS for the holder, then is refused
    expect(refusal.lines()).toHaveLength(1);
    expect(data.refused).toMatch(/^spine\.lock is held by pid \d+ \(build 0\.0\.0\+spine-root-test\)/);
    const bus = fakeBus();
    const index = captureConsole('error', /^\[index\] index unavailable: spine\.lock is held/);
    const library = captureConsole('warn', /^\[library\] the index is unavailable/);
    const { spine } = compose(data, new FakeSpineHost(), bus);
    expect([...index.lines(), ...library.lines()]).toHaveLength(2);
    expect(spine.view.unavailable()).toBe(data.refused);
    await expect(spine.view.acquire('11111111-1111-4111-8111-111111111111' as AppSessionId, 'read')).rejects.toThrow(`MAWS cannot reach its sessions this run: ${data.refused}`);
    await expect(bus.invoke('settings.engineApplied', undefined)).resolves.toMatchObject({ ok: false, error: { message: `the engine settings are not applied this run: ${data.refused}` } });
    expect(bus.registered().sort()).toEqual(SPINE_REFUSED_COMMANDS);
    // P5 O3-D M5b: the machine half is read, and a set is refused with nothing changed or told
    expect(await bus.main('machineSettings.get', undefined)).toMatchObject({ ok: true, value: { settings: data.machineSettings.state() } });
    expect(await bus.main('machineSettings.set', { patch: { supervisor: { idleExitMinutes: 7 } } })).toMatchObject({ ok: false });
    expect(bus.emittedOf('machineSettings.changed')).toEqual([]);
    expect(bus.intercepted()).toEqual(SPINE_REFUSED_INTERCEPTS);
    expect(bus.tapped().sort()).toEqual(SPINE_REFUSED_TAPS);
    // P5 O4 M2: the connectors and delivery answer in a refused run too (no spine file of theirs)
    expect(await bus.invoke('connectors.open', { artifactId: '11111111-1111-4111-8111-111111111111' })).toMatchObject({ ok: true, value: { leaseId: expect.any(String) } });
    expect(await bus.invoke('connectors.servers', { artifactId: '11111111-1111-4111-8111-111111111111', tools: [] })).toMatchObject({ ok: true });
    expect(await bus.invoke('delivery.status', { target: 'drive', artifactId: '11111111-1111-4111-8111-111111111111' })).toEqual({ ok: true, value: { target: 'drive', state: 'absent' } }); // no gws on its PATH
    expect(await bus.invoke('delivery.receipts', undefined)).toEqual({ ok: true, value: { receipts: [] } });
  });
});
