// P5 O7 M4 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, §O's `session.spawn` and its Proves): the
// composed spawn on the spine's root (src/services/spine-root.test.ts's pattern), against the fake engine host and the
// fake bus: a session created on the project of its checkout, patched with the mode as sent and started on the
// machine's own settings, with and without a brief; `launchedBy` with the sealed action on the record when
// `machine.op` claimed it; an untrusted checkout and an existing branch refused with nothing left behind; a replayed
// `machine.op` answering the first spawn's id; a parked engine host woken by the spawn's need (#411); a new worktree on a
// branch of exactly its name from HEAD.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientPort } from '@shared/client/port';
import { NO_CLIENT } from '@shared/client/port';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { AppSessionId } from '@shared/graph/ids';
import type { MachineRef } from '@shared/machine/ref';
import { status } from '../../../test/support/builders';
import { fakeBus, type FakeBus } from '../../../test/support/fake-bus';
import { FakeSpineHost } from '../../../test/support/fake-spine-host';
import { tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';
import { openSpineData, startSpine, type SpineData, type SpineRoot } from '../spine-root';

const MACHINE = 'TestMachineRef00000000' as MachineRef;
const BUILD = '0.0.0+spawn-test';
const noClientPort = new Proxy({}, { get: () => async () => NO_CLIENT }) as unknown as ClientPort;
const ACTION = { action: 'session.spawn', args: { checkout: '/c' }, signature: 'sig-1' }; // the sealed action as a device sent it

describe('session.spawn on the spine', () => {
  let dir: ReturnType<typeof tempDir>;
  let profile: string;
  let config: string;
  let checkout: string;
  let sminos: string;
  let held: { data: SpineData; spine: SpineRoot }[];

  beforeEach(() => {
    dir = tempDir('maws-spawn-');
    profile = join(dir.path, 'ud');
    config = join(dir.path, 'claude');
    for (const path of [profile, config, join(dir.path, 'home')]) mkdirSync(path);
    checkout = realpathSync(mkdtempSync(join(dir.path, 'checkout-')));
    execFileSync('git', ['init', '-q', '-b', 'main', checkout]);
    execFileSync('git', ['-C', checkout, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'one']);
    sminos = mkdtempSync('/tmp/o7-s-');
    held = [];
  });
  afterEach(() => {
    for (const { data, spine } of held.reverse()) {
      spine.stop();
      data.lock.release();
    }
    rmSync(sminos, { recursive: true, force: true });
    dir.dispose();
  });

  const trust = (directory: string) => writeFileSync(join(config, '.claude.json'), JSON.stringify({ projects: { [directory]: { hasTrustDialogAccepted: true } } }));

  // The spine with a project on the checkout and the direct route as the machine's setting; its engine host answers a
  // launch with the session ready, and a first message as sent. `parked`: the host is not up until a command's need
  // wakes it (mawsd's parked engine host; #411), and `need` counts those wakes.
  const composed = async ({ parked = false } = {}) => {
    const seeded = new Index(join(profile, 'index.sqlite'));
    seeded.projects.add(checkout);
    seeded.close();
    const data = await openSpineData(profile, { build: BUILD });
    data.machineSettings.update({ gateway: { defaultRoute: 'direct' } });
    const host = new FakeSpineHost();
    const launched: LaunchSpec[] = [];
    const sent: unknown[] = [];
    // the launch gate's configuration, accepted (the fake's own answers are void, which its schemas refuse: no other test
    // of it reaches a launch)
    host.answer('engine.configure', () => ({ path: '/usr/local/bin/claude', testedVersion: '2.1.0', version: '2.1.0', ok: true, error: null }));
    host.answer('engine.policy.set', () => ({ enabled: false, limitKiB: 0, totalKiB: 0, sampledAt: null, over: false, overWithoutCandidate: false, candidates: 0, settling: 0, releasing: null, blocked: [], lastRelease: null }));
    host.answer('session.launch', ({ spec }: { spec: LaunchSpec }) => {
      launched.push(spec);
      setTimeout(() => host.emit('session.status', { appSessionId: spec.appSessionId, status: status(spec.appSessionId) }), 5);
      return { status: 'launching', session: status(spec.appSessionId, { process: 'starting' }) };
    });
    host.answer('session.send', ({ content }: { content: unknown }) => {
      sent.push(content);
      return { messageUuid: null, disposition: 'sent', queueId: 'q-1' };
    });
    let woken = false;
    const need = vi.fn(() => {
      if (woken) return;
      woken = true;
      void host.ready();
    });
    if (parked) Object.assign(host, { need });
    const bus = fakeBus();
    const spine = startSpine({
      profile, machine: MACHINE, data, hosts: host, bus, clientPort: noClientPort, interest: () => new Set(), browserSocket: () => null,
      trash: async () => {}, engineEnv: Promise.resolve({ HOME: join(dir.path, 'home'), CLAUDE_CONFIG_DIR: config }), env: { SMINOS_HOME: sminos },
      packaged: false, appPath: dir.path, devRoot: dir.path, home: join(dir.path, 'home'),
    });
    held.push({ data, spine });
    if (!parked) await host.ready();
    return { bus, host, launched, sent, need };
  };

  const record = async (bus: FakeBus, appSessionId: string) => {
    const got = await bus.invoke('session.get', { appSessionId });
    if (!got.ok) throw new Error(got.error.message);
    return got.value;
  };

  it('creates a session on the checkout’s project, with the mode as sent, on the machine’s route, and starts it with the brief', async () => {
    trust(checkout);
    const { bus, launched, sent } = await composed();
    const spawned = await bus.invoke('session.spawn', { checkout, brief: 'look at the tests', model: 'claude-opus-4', effort: 'high', permission_mode: 'acceptEdits' });
    expect(spawned).toEqual({ ok: true, value: { status: 'ok', appSessionId: expect.any(String) } });
    const appSessionId = (spawned as { value: { appSessionId: AppSessionId } }).value.appSessionId;
    await expect.poll(() => launched).toEqual([expect.objectContaining({ appSessionId, cwd: checkout, model: 'claude-opus-4', effort: 'high', permissionMode: 'acceptEdits', gateway: 'direct' })]);
    expect(await record(bus, appSessionId)).toMatchObject({ appId: appSessionId, directory: checkout });
    expect((await record(bus, appSessionId))?.launchedBy).toBeUndefined(); // a local client's own command claims nothing
    await expect.poll(() => sent).toEqual(['look at the tests']); // the brief, once the engine is ready
  });

  it('starts with no first message when no brief is sent, the model and effort the machine’s own', async () => {
    trust(checkout);
    const { bus, launched, sent } = await composed();
    const spawned = await bus.invoke('session.spawn', { checkout, permission_mode: 'default' });
    expect(spawned).toMatchObject({ ok: true, value: { status: 'ok' } });
    await expect.poll(() => launched).toEqual([expect.objectContaining({ cwd: checkout, model: null, effort: null, permissionMode: 'default', gateway: 'direct' })]);
    await expect.poll(() => bus.emittedOf('session.setup').map((event) => event.phase)).toContain('ready');
    expect(sent).toEqual([]);
  });

  it('writes the claim and its sealed action as launchedBy, and answers a replayed op id with the first spawn', async () => {
    trust(checkout);
    const { bus, launched } = await composed();
    const op = {
      opId: '9b8f3a52-0000-4000-8000-0000000000b1', opCreated: new Date().toISOString(), claim: { member: 'mem-a', device: 'dev-1', fingerprint: 'fp-1' },
      name: 'session.spawn', input: { checkout, permission_mode: 'plan' }, action: ACTION,
    };
    const first = await bus.main('machine.op', op);
    expect(first).toMatchObject({ ok: true, value: { state: 'done', result: { ok: true, value: { status: 'ok' } } } });
    const appSessionId = (first as { value: { result: { value: { appSessionId: string } } } }).value.result.value.appSessionId;
    expect((await record(bus, appSessionId))?.launchedBy).toEqual({ member: 'mem-a', device: 'dev-1', opId: op.opId, action: ACTION });
    expect(await bus.main('machine.op', op)).toEqual(first);
    await expect.poll(() => launched.map((spec) => spec.appSessionId)).toEqual([appSessionId]); // one session, launched once
  });

  // #411's rule: the spawn's create waits on the session service's boot, which is a need for a parked engine host, and
  // nothing before the command wakes it
  it('wakes a parked engine host through its need, and spawns once the host is up', async () => {
    trust(checkout);
    const { bus, launched, need } = await composed({ parked: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(need).not.toHaveBeenCalled(); // composing and its events load nothing that wakes the host
    const spawned = await bus.invoke('session.spawn', { checkout, permission_mode: 'default' });
    expect(spawned).toMatchObject({ ok: true, value: { status: 'ok' } });
    expect(need).toHaveBeenCalled();
    await expect.poll(() => launched).toEqual([expect.objectContaining({ cwd: checkout, permissionMode: 'default' })]);
  });

  it('spawns in a new worktree of the requested name, on a new branch of exactly that name from HEAD', async () => {
    trust(checkout);
    const { bus, launched } = await composed();
    const head = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const spawned = await bus.invoke('session.spawn', { checkout, worktree: 'feature-x', permission_mode: 'default' });
    expect(spawned).toMatchObject({ ok: true, value: { status: 'ok' } });
    const appSessionId = (spawned as { value: { appSessionId: string } }).value.appSessionId;
    const created = await record(bus, appSessionId);
    expect(created?.worktree).toEqual({ path: expect.stringContaining(join(checkout, '.claude', 'worktrees')), branch: 'feature-x' });
    const path = created!.worktree!.path;
    expect(execFileSync('git', ['-C', checkout, 'rev-parse', 'refs/heads/feature-x'], { encoding: 'utf8' }).trim()).toBe(head);
    expect(execFileSync('git', ['-C', path, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('feature-x');
    await expect.poll(() => launched).toEqual([expect.objectContaining({ appSessionId, cwd: path })]);
  });

  it('refuses an untrusted checkout, an unknown one, an existing branch and a mode that is none, leaving no intent', async () => {
    const { bus, launched } = await composed();
    expect(await bus.invoke('session.spawn', { checkout, permission_mode: 'default' })).toEqual({ ok: true, value: { status: 'refused', reason: 'untrusted' } });
    trust(checkout);
    expect(await bus.invoke('session.spawn', { checkout: join(checkout, 'sub'), permission_mode: 'default' })).toEqual({ ok: true, value: { status: 'refused', reason: 'unknown-checkout' } });
    execFileSync('git', ['-C', checkout, 'branch', 'existing'], { stdio: 'ignore' });
    expect(await bus.invoke('session.spawn', { checkout, worktree: 'existing', permission_mode: 'default' })).toEqual({ ok: true, value: { status: 'refused', reason: 'worktree-exists' } });
    expect(await bus.invoke('session.spawn', { checkout, permission_mode: 'yolo' })).toEqual({ ok: true, value: { status: 'refused', reason: 'permission_mode: yolo is not a permission mode' } });
    expect(await bus.invoke('session.intent.list', undefined)).toEqual({ ok: true, value: { intents: [] } });
    expect(launched).toEqual([]);
  });
});
