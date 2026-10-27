// The app on the daemon shape (P5 O2 M7; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7's Proves): the mode table
// over every combination of MAWS_HOST_MODE, the harness flags, the setting, packaged, the default profile and an
// installed unit, through the real installer and fake unit managers in a scratch home; the switch to embedded changing
// nothing in the running launch and the next embedded launch uninstalling the unit before its hosts exist; how main's
// three transports start and reach `mawsd`; the build check.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { daemonPaths } from '@shared/daemon/files';
import type { HostState } from '@shared/ipc/schema';
import { daemonStatus } from '../../../test/support/builders';
import { FakeManagers } from '../../../test/support/fake-units';
import type { HostMode } from './mode';
import {
  daemonHostSpecs,
  daemonStart,
  endSocketPtyHost,
  prepareShape,
  resolveLaunch,
  UNAVAILABLE,
  unitRunsThisApp,
  watchDaemon,
  type LaunchDeps,
  type LaunchShape,
} from './daemon';

let home: string;
let managers: FakeManagers;
const PACKAGED = { runtime: '/Applications/MAWS.app/Contents/MacOS/MAWS', entry: '/Applications/MAWS.app/Contents/Resources/app.asar/out/main/mawsd.js' };
const CHECKOUT = { runtime: '/Users/u/src/MAWS/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', entry: '/Users/u/src/MAWS/out/main/mawsd.js' };
const LABEL = 'dev.maws.mawsd';
const plistPath = () => join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
const defaultProfile = () => join(home, 'Library', 'Application Support', 'MAWS');
const scratchProfile = () => join(home, 'scratch', 'ud');

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'maws-m7-'));
  managers = new FakeManagers();
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const logs: string[] = [];
beforeEach(() => (logs.length = 0));
const deps = (over: Partial<LaunchDeps> = {}): LaunchDeps => ({
  platform: 'darwin',
  run: managers.run,
  home,
  env: {},
  uid: 501,
  user: 'u',
  sleep: async () => {},
  endPtyHost: async () => void logs.push('pty host ended'),
  log: (line) => void logs.push(line),
  ...over,
});
const settle = async (launch: LaunchShape | Promise<LaunchShape>) => await launch;

// The facts the installer knows of: the default profile's LaunchAgent written by a packaged app, loaded in launchd.
async function installUnit(): Promise<void> {
  await settle(resolveLaunch({ env: {}, shape: 'daemon', packaged: true, profileDir: defaultProfile(), program: PACKAGED }, deps()));
  expect(managers.loaded.has(LABEL)).toBe(true);
  managers.calls.length = 0;
}

describe('the mode table', () => {
  // Every combination, against what M7 says of each: the mode the environment and the setting ask for, then what the
  // default profile, a packaged build and an installed unit make of it.
  const MODES = [undefined, 'utility', 'detached', 'daemon'] as const;
  const HARNESSES = [{}, { MAWS_E2E: '1' }, { MAWS_HARNESS: '1' }] as const;
  const expected = (asked: (typeof MODES)[number], harness: boolean, shape: 'embedded' | 'daemon', packaged: boolean, isDefault: boolean, unit: boolean) => {
    const mode: HostMode = asked ?? (harness ? 'utility' : shape === 'daemon' ? 'daemon' : 'detached');
    if (mode !== 'daemon') return { launch: { mode, daemon: null, unavailable: null }, install: false, uninstall: shape === 'embedded' && packaged && isDefault && unit };
    if (!isDefault) return { launch: { mode, daemon: 'private', unavailable: null }, install: false, uninstall: false };
    if (packaged) return { launch: { mode, daemon: 'unit', unavailable: null }, install: true, uninstall: false };
    if (unit) return { launch: { mode, daemon: 'unit', unavailable: null }, install: false, uninstall: false };
    return { launch: { mode: 'detached', daemon: null, unavailable: UNAVAILABLE.noUnit }, install: false, uninstall: false };
  };

  for (const asked of MODES)
    for (const harness of HARNESSES)
      for (const shape of ['embedded', 'daemon'] as const)
        for (const packaged of [false, true])
          for (const isDefault of [false, true])
            for (const unit of [false, true]) {
              const name = `MAWS_HOST_MODE=${asked ?? '(unset)'} ${Object.keys(harness)[0] ?? 'no harness'} shape ${shape} ${packaged ? 'packaged' : 'unpackaged'} ${isDefault ? 'default' : 'other'} profile, ${unit ? 'a unit' : 'no unit'} installed`;
              it(name, async () => {
                if (unit) await installUnit();
                const env = { ...harness, ...(asked ? { MAWS_HOST_MODE: asked } : {}) };
                const launch = await settle(resolveLaunch({ env, shape, packaged, profileDir: isDefault ? defaultProfile() : scratchProfile(), program: packaged ? PACKAGED : CHECKOUT }, deps({ env })));
                const want = expected(asked, Object.keys(harness).length > 0, shape, packaged, isDefault, unit);
                expect(launch).toEqual(want.launch);
                const changes = managers.changes();
                if (want.install && !unit) expect(changes).toEqual([`launchctl bootstrap gui/501 ${plistPath()}`]);
                else if (want.install) expect(changes, 'a repair of a unit already running this bundle changes nothing').toEqual([]);
                else if (want.uninstall) expect(changes).toEqual([`launchctl bootout gui/501/${LABEL}`]);
                else expect(changes, 'no unit is written, loaded or removed').toEqual([]);
                expect(existsSync(plistPath())).toBe(want.uninstall ? false : unit || want.install);
                expect(logs.includes('pty host ended')).toBe(want.uninstall);
              });
            }
});

describe('the default profile’s unit', () => {
  it('is repaired to run this bundle when a packaged app finds it running another, then loaded again', async () => {
    await installUnit();
    const moved = { runtime: '/Applications/MAWS 2.app/Contents/MacOS/MAWS', entry: '/Applications/MAWS 2.app/Contents/Resources/app.asar/out/main/mawsd.js' };
    expect(unitRunsThisApp({ profileDir: defaultProfile(), program: moved }, deps())).toBe(false);
    await settle(resolveLaunch({ env: {}, shape: 'daemon', packaged: true, profileDir: defaultProfile(), program: moved }, deps()));
    expect(managers.changes()).toEqual([`launchctl bootout gui/501/${LABEL}`, `launchctl bootstrap gui/501 ${plistPath()}`]);
    expect(readFileSync(plistPath(), 'utf8')).toContain('/Applications/MAWS 2.app/Contents/Resources/app.asar/out/main/mawsd.js');
    expect(unitRunsThisApp({ profileDir: defaultProfile(), program: moved }, deps())).toBe(true);
  });

  it('a unit the system refuses runs the launch embedded, with the reason', async () => {
    managers.script('launchctl bootstrap', { status: 119, stderr: 'Bootstrap failed: 119: Service is disabled' });
    const launch = await settle(resolveLaunch({ env: {}, shape: 'daemon', packaged: true, profileDir: defaultProfile(), program: PACKAGED }, deps()));
    expect(launch).toEqual({ mode: 'detached', daemon: null, unavailable: expect.stringMatching(/^the LaunchAgent could not be installed: .*119: Service is disabled/) });
    expect(logs).toContainEqual(expect.stringMatching(/^\[hosts\] the daemon shape does not run this launch: the LaunchAgent could not be installed: .*; running embedded$/));
    expect(existsSync(plistPath()), 'the failed first install leaves no file behind (M6)').toBe(false);
  });

  it('an unpackaged run with a unit installed but not loaded runs embedded, saying so', async () => {
    await installUnit();
    managers.loaded.clear(); // turned off in Login Items: the file stays, launchd has no job
    const launch = await settle(resolveLaunch({ env: {}, shape: 'daemon', packaged: false, profileDir: defaultProfile(), program: CHECKOUT }, deps()));
    expect(launch).toEqual({ mode: 'detached', daemon: null, unavailable: UNAVAILABLE.notLoaded });
    expect(managers.changes()).toEqual([]);
  });

  it('is never written by an unpackaged run, whatever the shape', async () => {
    for (const shape of ['daemon', 'embedded'] as const) await settle(resolveLaunch({ env: {}, shape, packaged: false, profileDir: defaultProfile(), program: CHECKOUT }, deps()));
    expect(managers.calls.filter((call) => !call.startsWith('launchctl print'))).toEqual([]);
    expect(existsSync(plistPath())).toBe(false);
  });
});

describe('switching the shape', () => {
  it('changes nothing in the running launch; the next embedded launch uninstalls the unit and ends the pty host before its hosts exist', async () => {
    let setting: 'daemon' | 'embedded' = 'daemon';
    const order: string[] = [];
    const launchApp = async () => {
      const run: LaunchDeps['run'] = (command, args) => {
        if (args[0] !== 'print') order.push(`${command} ${args[0]}`);
        return managers.run(command, args);
      };
      const launch = await settle(resolveLaunch({ env: {}, shape: setting, packaged: true, profileDir: defaultProfile(), program: PACKAGED }, deps({ run, endPtyHost: async () => void order.push('pty host ended'), log: () => {} })));
      order.push(`hosts created (${launch.mode})`);
      managers.calls.length = 0;
      return launch;
    };
    expect(await launchApp()).toEqual({ mode: 'daemon', daemon: 'unit', unavailable: null });
    setting = 'embedded'; // the owner flips the switch: the launch keeps its daemon and its links
    expect(managers.calls, 'nothing is asked of launchd').toEqual([]);
    expect(managers.loaded.has(LABEL)).toBe(true);
    expect(await launchApp()).toEqual({ mode: 'detached', daemon: null, unavailable: null });
    expect(order).toEqual(['launchctl bootstrap', 'hosts created (daemon)', 'launchctl bootout', 'pty host ended', 'hosts created (detached)']);
    expect(existsSync(plistPath())).toBe(false);
    expect(await launchApp(), 'and after it, nothing is left to remove').toEqual({ mode: 'detached', daemon: null, unavailable: null });
    expect(order.slice(5)).toEqual(['hosts created (detached)']);
  });

  it('settles synchronously when there is no unit work, so a scratch profile starts as it always has', () => {
    const launch = resolveLaunch({ env: { MAWS_HOST_MODE: 'daemon' }, shape: 'embedded', packaged: false, profileDir: scratchProfile(), program: CHECKOUT }, deps());
    expect(launch).toEqual({ mode: 'daemon', daemon: 'private', unavailable: null });
    expect(managers.calls, 'not even a read of launchd for another profile').toEqual([]);
  });

  it('ends the pty host even when the uninstall fails', async () => {
    const launch = await settle(
      prepareShape({ mode: 'detached', uninstall: true, unavailable: null }, { install: async () => {}, uninstall: async () => Promise.reject(new Error('bootout failed')), endPtyHost: async () => void logs.push('pty host ended'), log: (l) => void logs.push(l) }),
    );
    expect(launch).toEqual({ mode: 'detached', daemon: null, unavailable: null });
    expect(logs.slice(1)).toEqual(['[hosts] the LaunchAgent could not be uninstalled: bootout failed', 'pty host ended']);
  });
});

describe('the socket-mode pty host at the switch to embedded', () => {
  const lock = { pid: 777, procStart: 'Mon Oct 27 10:00:00 2026', socketPath: '/p/host.sock', buildId: 'b', startedAt: 'x' };
  const fakes = (alive: () => boolean, start = lock.procStart) => {
    const kill = vi.fn();
    return { kill, deps: { readLock: () => lock as never, isAlive: alive, procStartOf: () => start, kill, sleep: async () => {}, log: (l: string) => void logs.push(l) } };
  };

  it('is sent SIGTERM and waited for', async () => {
    let polls = 0;
    const { kill, deps: d } = fakes(() => polls++ < 3);
    await endSocketPtyHost('/p/mawsd/pty-host', d);
    expect(kill).toHaveBeenCalledExactlyOnceWith(777, 'SIGTERM');
    expect(polls).toBeGreaterThan(3);
  });

  it('is never signalled when its lock names another process or none', async () => {
    const reused = fakes(() => true, 'Tue Oct 28 09:00:00 2026');
    await endSocketPtyHost('/p/mawsd/pty-host', reused.deps);
    expect(reused.kill).not.toHaveBeenCalled();
    const none = fakes(() => true);
    await endSocketPtyHost('/p/mawsd/pty-host', { ...none.deps, readLock: () => null });
    expect(none.kill).not.toHaveBeenCalled();
  });

  it('is waited for within a bound', async () => {
    const { deps: d } = fakes(() => true);
    await endSocketPtyHost('/p/mawsd/pty-host', d);
    expect(logs.at(-1)).toMatch(/still running 5 s after its SIGTERM; starting anyway$/);
  });
});

describe('main’s hosts on the daemon shape', () => {
  const paths = daemonPaths('/tmp/p/ud', '/tmp');
  const modules = { engineHost: '/app/out/engine-host/index.js', ptyHost: '/app/out/pty-host/index.js', mawsd: '/app/out/main/mawsd.js' };
  const env = { PATH: '/usr/bin', MAWS_HOST_MODE: 'daemon', MAWS_E2E: '1', MAWS_E2E_BUILD_ID: 'stale', MAWS_E2E_WIRE_MAJOR: '4', NODE_OPTIONS: '--inspect' };

  it('start a private mawsd as the supervisor is started, the e2e seams in its environment', () => {
    const start = daemonStart('private', { paths, modules, execPath: '/app/Electron', env, packaged: false, unitStart: () => {} });
    expect(start).toEqual({
      kind: 'spawn',
      command: '/app/Electron',
      args: ['--disable-sigusr1', '/app/out/main/mawsd.js', 'run', '--private', '--dir', '/tmp/p/ud/mawsd'],
      env: { PATH: '/usr/bin', MAWS_E2E: '1', MAWS_E2E_BUILD_ID: 'stale', MAWS_E2E_WIRE_MAJOR: '4', ELECTRON_RUN_AS_NODE: '1', MAWS_USER_DATA: '/tmp/p/ud' },
      argv0: 'mawsd',
    });
  });

  it('ask the unit to start the default profile’s', async () => {
    const unitStart = vi.fn();
    const start = daemonStart('unit', { paths, modules, execPath: '/app/Electron', env, packaged: true, unitStart });
    expect(start.kind).toBe('unit');
    await (start as { start(): Promise<void> }).start();
    expect(unitStart).toHaveBeenCalledOnce();
  });

  it('are three detached transports, one per relay socket, serving any build, relayed, waiting the start budget for a welcome', () => {
    const start = daemonStart('private', { paths, modules, execPath: '/app/Electron', env, packaged: false, unitStart: () => {} });
    const specs = daemonHostSpecs(paths, start, modules, env);
    expect(Object.keys(specs)).toEqual(['engine-host', 'pty-host', 'machine']);
    const socket = { 'engine-host': 'engine-host.sock', 'pty-host': 'pty-host.sock', machine: 'machine.sock' } as const;
    for (const [owner, spec] of Object.entries(specs) as [keyof typeof socket, NonNullable<(typeof specs)['machine']>][]) {
      expect(spec.transport).toBe('detached');
      expect(spec.detached).toMatchObject({
        files: { dir: '/tmp/p/ud/mawsd', lock: 'mawsd.lock', token: 'mawsd.token', socket: `/tmp/p/ud/mawsd/${socket[owner]}`, log: 'mawsd.log' },
        start,
        buildPolicy: 'serve',
        relayed: true,
        timing: { helloTimeoutMs: 15_000 },
      });
      const identity = spec.detached!.identity!;
      expect(identity.major(), `${owner}: no e2e seam in main's hello`).toBe(3);
      expect(identity.capabilities()).toContain('socket.ptyFrames');
    }
    expect(specs.machine!.modulePath).toBe('/app/out/main/mawsd.js');
  });
});

describe('the build check', () => {
  const THIS = 'mawsd00000000001';
  function scene(answers: { status: ReturnType<typeof daemonStatus> }, unitRunsThisApp = true) {
    const listeners = new Map<string, ((state: HostState) => void)[]>();
    const calls: string[] = [];
    const changes: unknown[] = [];
    const hosts = {
      onState: (owner: string, listener: (state: HostState) => void) => {
        listeners.set(owner, [...(listeners.get(owner) ?? []), listener]);
        return () => {};
      },
      dispatch: vi.fn(async (owner: string, name: string) => {
        calls.push(`${owner} ${name}`);
        return name === 'daemon.status' ? { ok: true as const, value: answers.status } : { ok: true as const, value: undefined };
      }),
      expectExit: vi.fn((owner: string) => (calls.push(`expectExit ${owner}`), true)),
    };
    const watch = watchDaemon({ hosts: hosts as never, buildId: THIS, unitRunsThisApp: () => unitRunsThisApp, onChange: (s) => void changes.push(s), log: (l) => void logs.push(l) });
    const ready = async (owner: string, state: HostState['state'] = 'ready') => {
      for (const listener of listeners.get(owner) ?? []) listener({ state, pid: 1, restarts: 0, revision: 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { watch, calls, changes, ready };
  }

  it('asks a private daemon of another build to restart, once for the launch', async () => {
    const answers = { status: daemonStatus({ build: { ...daemonStatus().build, buildId: 'older00000000000' } }) };
    const { calls, ready } = scene(answers);
    await ready('machine');
    expect(calls).toEqual(['machine daemon.status', 'expectExit machine', 'machine daemon.restart']);
    await ready('machine'); // the restarted daemon, still the old build (a slow restart): not asked again
    expect(calls.filter((c) => c.endsWith('daemon.restart'))).toHaveLength(1);
    expect(logs).toContain(`[hosts] mawsd pid 4100 runs build older00000000000, this app's is ${THIS}; asking it to restart (its hosts keep running)`);
  });

  it('asks a unit daemon of another build to restart when its unit runs this bundle', async () => {
    const { calls, ready } = scene({ status: daemonStatus({ kind: 'unit', build: { ...daemonStatus().build, buildId: 'older00000000000' } }) }, true);
    await ready('machine');
    expect(calls).toContain('machine daemon.restart');
  });

  it('never asks a unit running another bundle', async () => {
    const { calls, ready } = scene({ status: daemonStatus({ kind: 'unit', build: { ...daemonStatus().build, buildId: 'older00000000000' } }) }, false);
    await ready('machine');
    expect(calls).toEqual(['machine daemon.status']);
    expect(logs.at(-1)).toMatch(/its unit runs another bundle, so it is left as it is$/);
  });

  it('asks nothing of a daemon of this build', async () => {
    const { calls, ready } = scene({ status: daemonStatus({ build: { ...daemonStatus().build, buildId: THIS } }) });
    await ready('machine');
    expect(calls).toEqual(['machine daemon.status']);
  });

  it('reads the status at each ready of the machine host and of the engine host, and at no other transition', async () => {
    const status = daemonStatus({ build: { ...daemonStatus().build, buildId: THIS } });
    const { watch, calls, changes, ready } = scene({ status });
    expect(watch.status()).toBeNull();
    await ready('engine-host', 'restarting');
    await ready('engine-host', 'crashed');
    expect(calls).toEqual([]);
    await ready('machine');
    await ready('engine-host');
    expect(calls).toEqual(['machine daemon.status', 'machine daemon.status']);
    expect(changes).toEqual([status, status]);
    expect(watch.status()).toEqual(status);
  });
});
