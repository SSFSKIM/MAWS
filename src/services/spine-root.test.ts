// The spine composed under plain Node (P5 O3-C, docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, acceptance
// 1 and the bundle-free half of 3; D25): `openSpineData` over a scratch profile, `startSpine` against a fake engine host
// and the fake bus, a replay played through `session.replay.start` and folded into the index, the read model and
// attention, `startCheckouts` over the spine's view, and both roots' stops releasing what they held. The exact commands,
// intercepts and taps each root installs are pinned here for O3-D's retag.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
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
import { FIXTURE_DIR } from '../../test/support/fixtures';
import { summary, tempDir } from '../../test/support/index-fixture';
import { startCheckouts, type CheckoutsRoot } from './checkouts-root';
import { GitService } from './git/service';
import { Index } from './index/index';
import { ScmService } from './scm/service';
import { openSpineData, startSpine, type SpineData, type SpineRoot } from './spine-root';

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

// What each root installs through its bus (D25), sorted: the commands O3-D's services front serves for the spine and
// O3-E's for the checkouts, the intercepts on another owner's commands, and the emitted events the root taps. A run
// refused the spine (O3-A) registers the spine's commands but those of the parts it does not start.
const SPINE_COMMANDS = [
  'attention.acknowledge', 'attention.list', 'attention.request',
  'git.worktree.add', 'git.worktree.branch', 'git.worktree.deleteBranch', 'git.worktree.list', 'git.worktree.remove', 'git.worktree.status',
  // P5 O9's lane A driver (O3 Decision Log 13): composed only while the run holds spine.lock, with no intercept or tap
  'laneA.answer', 'laneA.btw', 'laneA.catalog', 'laneA.command', 'laneA.compact', 'laneA.interrupt', 'laneA.list', 'laneA.media', 'laneA.model',
  'laneA.read', 'laneA.send', 'laneA.state', 'laneA.stopAgent', 'laneA.stopTask', 'laneA.tell', 'laneA.unwatch', 'laneA.watch',
  'library.get', 'library.list', 'library.spaces',
  'mods.list', 'mods.setSessionOverride',
  'ownerChannel.answered', 'ownerChannel.cancel', 'ownerChannel.markRead', 'ownerChannel.state',
  'session.acquire', 'session.appEvents', 'session.archive', 'session.archiveOlder', 'session.create', 'session.delete',
  'session.deletions.keep', 'session.deletions.list', 'session.deletions.preview', 'session.digests', 'session.drafts.get', 'session.drafts.set',
  'session.fork', 'session.get', 'session.history.append', 'session.history.list',
  'session.intent.discard', 'session.intent.get', 'session.intent.list', 'session.intent.patch', 'session.intent.release', 'session.intent.resolveWorktree',
  'session.launchMode', 'session.list', 'session.observedFacts',
  'session.projects.add', 'session.projects.addFolder', 'session.projects.list', 'session.projects.remove', 'session.projects.update',
  'session.recentTurns', 'session.rename', 'session.replay.fixtures', 'session.replay.start', 'session.revealPath', 'session.search',
  'session.setVisible', 'session.start', 'session.takeOver', 'session.takeOverPane', 'session.trust.check', 'session.update',
  'settings.engineApplied', 'settings.userEngineDefaults',
  'side.screenshot.preview', 'side.sendToMain', 'side.thread.open',
];
const SPINE_REFUSED_COMMANDS = [
  'library.get', 'library.list', 'library.spaces',
  'session.appEvents', 'session.digests', 'session.drafts.get', 'session.drafts.set', 'session.get', 'session.launchMode', 'session.list', 'session.observedFacts',
  'session.projects.add', 'session.projects.addFolder', 'session.projects.list', 'session.projects.remove', 'session.projects.update',
  'session.recentTurns', 'session.search', 'session.setVisible', 'session.update',
  'settings.engineApplied', 'settings.userEngineDefaults',
];
const SPINE_INTERCEPTS = ['session.answer'];
const SPINE_TAPS = ['attention.changed', 'session.eventBatch', 'session.intent.changed', 'session.projects.changed'];
const SPINE_REFUSED_TAPS = ['attention.changed', 'session.eventBatch', 'session.intent.changed']; // no projects to follow: the index is unavailable
// P5 O3-D M1 (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §I): what the services front emits of
// its own beside the spine's events; with them, the machine host's event list (`REGISTRY.machineEvents`)
const FRONT_EVENTS = ['clientPort.request', 'machineSettings.changed', 'session.visibleChanged'];
// Every event the spine's parts emit through the bus, read from the library's source: each `emit('<event>'` under
// src/services/ but the checkouts' root, whose events (`git.changed`, `files.changed`, `scm.remote.output`) are main's
// until O3-E moves the checkouts. A part emits through a function it was handed, always with the event's name written.
function spineEmits(): string[] {
  const root = __dirname;
  const names = new Set<string>();
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts') || relative(root, path) === 'checkouts-root.ts') continue;
    for (const [, name] of readFileSync(path, 'utf8').matchAll(/\bemit\(\s*'([a-zA-Z]+(?:\.[a-zA-Z]+)+)'/g)) names.add(name!);
  }
  return [...names].sort();
}
const CHECKOUTS_COMMANDS = [
  'files.list', 'files.openExternal', 'files.read', 'files.reveal', 'files.unwatch', 'files.watch', 'files.write',
  'git.branches', 'git.diff', 'git.log', 'git.lsFiles', 'git.status', 'git.unwatch', 'git.watch',
  'scm.commit', 'scm.discard', 'scm.pr.create', 'scm.pr.plan', 'scm.pr.state', 'scm.push', 'scm.push.plan', 'scm.remote.cancel', 'scm.remote.last',
  'scm.stage', 'scm.status', 'scm.unstage',
];

describe('the spine and the checkouts composed under plain Node', () => {
  let dir: ReturnType<typeof tempDir>;
  let profile: string;
  let sminos: string; // lane A's sminos home: short, since a bridge's socket path must stay under 104 bytes
  let held: { data: SpineData; spine: SpineRoot; checkouts: CheckoutsRoot | null; stopped?: boolean }[];
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
      stopBoth(composed);
      composed.data.lock.release();
    }
    for (const bridge of bridges) await bridge.close();
    vi.restoreAllMocks();
    rmSync(sminos, { recursive: true, force: true });
    dir.dispose();
  });

  // Both roots' stops in production's order (main's shutdown steps: 'spine', then 'checkouts'), once
  const stopBoth = (composed: (typeof held)[number]) => {
    if (composed.stopped) return;
    composed.stopped = true;
    composed.spine.stop();
    composed.checkouts?.stop();
  };

  // Both roots as main composes them, each on its bus (one bus for both unless a test tells them apart)
  const compose = (data: SpineData, host: FakeSpineHost, bus: FakeBus, { checkouts = true, checkoutsBus = bus } = {}) => {
    const engineEnv = Promise.resolve({ HOME: join(dir.path, 'home'), CLAUDE_CONFIG_DIR: join(dir.path, 'claude') });
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
    const composed = { data, spine, checkouts: checkouts ? startCheckouts({ view: spine.view, bus: checkoutsBus, clientPort: noClientPort, engineEnv, env: {} }) : null };
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
    compose(await openSpineData(profile, { build: BUILD }), new FakeSpineHost(), bus, { checkouts: false });

    await expect.poll(async () => bus.invoke('laneA.state', { appSessionId }), { timeout: 5000 }).toMatchObject({ ok: true, value: { appSessionId, engineSessionId, bridge: 'live' } });
    bridge.raise({ request: 'req-1', tool: 'Bash', input: { command: 'ls' } });
    await expect.poll(async () => bus.invoke('attention.list', undefined), { timeout: 5000 }).toMatchObject({
      ok: true, value: [expect.objectContaining({ id: `lane-a:${engineSessionId}:req-1`, appSessionId, kind: 'permission', state: 'pending' })],
    });
    const digests = await bus.invoke('session.digests', undefined);
    if (!digests.ok) throw new Error(digests.error.message);
    expect(digests.value.digests.find((d) => d.appSessionId === appSessionId)).toMatchObject({ phase: 'waiting', pendingRequests: 1 });
  });

  it('composes the checkouts over the spine’s view: git.status answers for a scratch repository', async () => {
    const bus = fakeBus();
    compose(await openSpineData(profile, { build: BUILD }), new FakeSpineHost(), bus);
    const repository = join(dir.path, 'repository');
    mkdirSync(repository);
    execFileSync('git', ['init', '-q', '-b', 'main', repository]);
    const status = await bus.invoke('git.status', { directory: repository });
    expect(status).toMatchObject({ ok: true, value: { repoRoot: repository, branch: 'main', dirty: false } });
  });

  // D12: the spine reads the machine half alone and follows its changes, with no client half or settings.changed event
  it('relays a change of the machine half to the engine host', async () => {
    const data = await openSpineData(profile, { build: BUILD });
    const host = new FakeSpineHost();
    compose(data, host, fakeBus(), { checkouts: false });
    await host.ready();
    const pushed = () => host.calls.filter((call) => call.name === 'host.configure').map((call) => call.input);
    expect(pushed().at(-1)).toEqual({ idleExitMs: data.machineSettings.state().supervisor.idleExitMinutes! * 60_000 });
    data.machineSettings.update({ supervisor: { idleExitMinutes: 7 } });
    expect(pushed().at(-1)).toEqual({ idleExitMs: 7 * 60_000 });
  });

  it('installs exactly its commands, intercepts and taps, and both stops release every listener the spine held on the host', async () => {
    const host = new FakeSpineHost();
    const spineBus = fakeBus();
    const checkoutsBus = fakeBus();
    const composed = compose(await openSpineData(profile, { build: BUILD }), host, spineBus, { checkoutsBus });
    await host.ready();
    expect(spineBus.registered().sort()).toEqual(SPINE_COMMANDS);
    expect(spineBus.intercepted()).toEqual(SPINE_INTERCEPTS);
    expect(spineBus.tapped().sort()).toEqual(SPINE_TAPS);
    expect(checkoutsBus.registered().sort()).toEqual(CHECKOUTS_COMMANDS);
    expect(checkoutsBus.intercepted()).toEqual([]);
    expect(checkoutsBus.tapped()).toEqual([]); // the checkouts follow the spine through its view
    expect(host.held()).toBeGreaterThan(0);

    stopBoth(composed);
    expect(host.held()).toBe(0);
    expect(spineBus.intercepted()).toEqual([]);
    expect(spineBus.tapped()).toEqual([]);
  });

  // P5 O3-D M1 (Interfaces §I): the spine's commands are `machine`-owned, so the services front serves them (M2) and main's
  // embedded binding answers them until the cutover; the checkouts' stay main's until O3-E
  it('owns by machine every command the spine registers, and by main every command the checkouts register', () => {
    for (const name of SPINE_COMMANDS) expect(REGISTRY.commands[name as CommandName].owner, name).toBe('machine');
    for (const name of CHECKOUTS_COMMANDS) expect(REGISTRY.commands[name as CommandName].owner, name).toBe('main');
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
    stopBoth(composed);
    expect(failures.lines()).toEqual(['[shutdown] spine: index failed; going on', '[shutdown] checkouts: git failed; going on']);
    // the spine's parts after the index (the owner channel, the sweep, yield, side threads, the relays, the library)
    // released what they held on the host, and the checkouts' after git (files, scm) stopped
    expect(host.held()).toBe(0);
    expect(scmStopped).toHaveBeenCalledOnce();
  });

  it('a refused run composes with the view unavailable and registers none of the parts it does not start', async () => {
    held.push({ data: await openSpineData(profile, { build: BUILD }), spine: { view: null as never, stop: () => {} }, checkouts: null }); // a live holder of spine.lock: this process
    const refusal = captureConsole('error', /^\[spine\] spine\.lock is held by pid /);
    const data = await openSpineData(profile, { build: BUILD }); // waits SPINE_LOCK_WAIT_MS for the holder, then is refused
    expect(refusal.lines()).toHaveLength(1);
    expect(data.refused).toMatch(/^spine\.lock is held by pid \d+ \(build 0\.0\.0\+spine-root-test\)/);
    const bus = fakeBus();
    const index = captureConsole('error', /^\[index\] index unavailable: spine\.lock is held/);
    const library = captureConsole('warn', /^\[library\] the index is unavailable/);
    const { spine } = compose(data, new FakeSpineHost(), bus, { checkouts: false });
    expect([...index.lines(), ...library.lines()]).toHaveLength(2);
    expect(spine.view.unavailable()).toBe(data.refused);
    await expect(spine.view.acquire('11111111-1111-4111-8111-111111111111' as AppSessionId, 'read')).rejects.toThrow(`MAWS cannot reach its sessions this run: ${data.refused}`);
    await expect(bus.invoke('settings.engineApplied', undefined)).resolves.toMatchObject({ ok: false, error: { message: `the engine settings are not applied this run: ${data.refused}` } });
    expect(bus.registered().sort()).toEqual(SPINE_REFUSED_COMMANDS);
    expect(bus.intercepted()).toEqual(SPINE_INTERCEPTS);
    expect(bus.tapped().sort()).toEqual(SPINE_REFUSED_TAPS);
  });
});
