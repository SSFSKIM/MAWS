// The app on the daemon shape (P5 O2 M7; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7's Proves): the mode table
// over every combination of MAWS_HOST_MODE, the harness flags, the setting, packaged, the default profile and an
// installed unit, through the real installer and fake unit managers in a scratch home; the switch to embedded changing
// nothing in the running launch and the next embedded launch uninstalling the unit before its hosts exist; how main's
// three transports start and reach `mawsd`; the build check.
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { daemonPaths } from '@shared/daemon/files';
import { createHostRuntime } from '@shared/host/runtime';
import { writeToken } from '@shared/host/socket-host';
import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import { serveSocketClients } from '@shared/host/socket-server';
import type { HostState } from '@shared/ipc/schema';
import { WIRE_MINOR } from '@shared/ipc/wire';
import { daemonStatus } from '../../../test/support/builders';
import { FakeManagers } from '../../../test/support/fake-units';
import { procStartOf } from '../../engine-host/supervisor-files';
import { HELLO_TIMEOUT_MS, reachMachine } from '../../mawsd/machine-client';
import { DEFAULT_PROFILE_REFUSAL, type HostMode } from './mode';
import {
  awaitDaemonWelcome,
  type AwaitDaemonDeps,
  daemonHostSpecs,
  daemonStart,
  endSocketPtyHost,
  prepareShape,
  resolveLaunch,
  UNAVAILABLE,
  UNIT_READY_MS,
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
// The process's exit, which never returns: a test sees it as this error, its code recorded.
class Exited extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}
const exits: number[] = [];
beforeEach(() => (exits.length = 0));
const deps = (over: Partial<LaunchDeps> = {}): LaunchDeps => ({
  platform: 'darwin',
  run: managers.run,
  home,
  env: {},
  uid: 501,
  user: 'u',
  sleep: async () => {},
  leaveDaemon: async () => void logs.push('left the daemon shape'),
  awaitDaemon: async () => {}, // the unit's mawsd up at once, unless a test says otherwise
  log: (line) => void logs.push(line),
  exit: (code, line) => {
    logs.push(line);
    exits.push(code);
    throw new Exited(code);
  },
  ...over,
});
const settle = async (launch: LaunchShape | Promise<LaunchShape>) => await launch;
// a lock as takeLock writes it, naming `pid` with its start time
const writeLock = (path: string, pid: number, procStart: string) => writeFileSync(path, JSON.stringify({ pid, procStart, protocol: 3, buildId: 'b', socketPath: `${path}.sock`, startedAt: new Date().toISOString() }));

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
  // P5 O3-B: a harness launch takes the setting's shape as any other (it reaches here only off the default profile)
  const expected = (asked: (typeof MODES)[number], shape: 'embedded' | 'daemon', packaged: boolean, isDefault: boolean, unit: boolean) => {
    const mode: HostMode = asked ?? (shape === 'daemon' ? 'daemon' : 'detached');
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
                if (Object.keys(harness).length > 0 && isDefault) {
                  // a test or harness launch never plans against the default profile (testLaunchRefusal)
                  logs.length = 0;
                  expect(() => resolveLaunch({ env, shape, packaged, profileDir: defaultProfile(), program: packaged ? PACKAGED : CHECKOUT }, deps({ env }))).toThrow(Exited);
                  expect(exits).toEqual([1]);
                  expect(managers.changes(), 'no unit is written, loaded or removed').toEqual([]);
                  expect(existsSync(plistPath())).toBe(unit);
                  expect(logs).toEqual([DEFAULT_PROFILE_REFUSAL]);
                  return;
                }
                const launch = await settle(resolveLaunch({ env, shape, packaged, profileDir: isDefault ? defaultProfile() : scratchProfile(), program: packaged ? PACKAGED : CHECKOUT }, deps({ env })));
                const want = expected(asked, shape, packaged, isDefault, unit);
                expect(launch).toEqual(want.launch);
                const changes = managers.changes();
                const started = want.launch.daemon === 'unit' ? [`launchctl kickstart gui/501/${LABEL}`] : []; // and its mawsd awaited
                if (want.install && !unit) expect(changes).toEqual([`launchctl bootstrap gui/501 ${plistPath()}`, ...started]);
                else if (want.install) expect(changes, 'a repair of a unit already running this bundle changes nothing').toEqual(started);
                else if (want.uninstall) expect(changes).toEqual([`launchctl bootout gui/501/${LABEL}`]);
                else expect(changes, 'no unit is written, loaded or removed').toEqual(started);
                expect(existsSync(plistPath())).toBe(want.uninstall ? false : unit || want.install);
                expect(logs.includes('left the daemon shape')).toBe(want.uninstall);
              });
            }
});

// P5 O2 landing (O3's planner, P9): a test launch with no MAWS_USER_DATA lands on the default profile, where the owner's
// mawsd may be up. Planned like any launch, an embedded plan would end that mawsd and its pty host (their terminals and
// kept sessions with them), and a packaged one install or uninstall the owner's unit. It exits first, with one line.
describe('a test or harness launch on the default profile', () => {
  for (const harness of [{ MAWS_E2E: '1' }, { MAWS_HARNESS: '1' }])
    for (const asked of [undefined, 'utility', 'detached', 'daemon'] as const)
      for (const shape of ['embedded', 'daemon'] as const)
        for (const packaged of [false, true])
          it(`${Object.keys(harness)[0]} MAWS_HOST_MODE=${asked ?? '(unset)'} shape ${shape} ${packaged ? 'packaged' : 'unpackaged'}: exits non-zero before touching the owner's unit or daemon`, async () => {
            await installUnit(); // the owner's LaunchAgent, loaded
            const paths = daemonPaths(defaultProfile()); // the owner's mawsd and socket-mode pty host up
            mkdirSync(paths.ptyHost, { recursive: true });
            writeLock(join(paths.dir, 'mawsd.lock'), process.pid, 'owner');
            writeLock(join(paths.ptyHost, 'host.lock'), process.pid, 'owner');
            logs.length = 0;
            const reached: string[] = [];
            const env = { ...harness, ...(asked ? { MAWS_HOST_MODE: asked } : {}) };
            const launch = () =>
              resolveLaunch(
                { env, shape, packaged, profileDir: defaultProfile(), program: packaged ? PACKAGED : CHECKOUT },
                deps({ env, leaveDaemon: async () => void reached.push('leaveDaemon'), awaitDaemon: async () => void reached.push('awaitDaemon') }),
              );
            expect(launch).toThrow(Exited);
            expect(exits).toEqual([1]);
            expect(logs).toEqual([DEFAULT_PROFILE_REFUSAL]);
            expect(reached, 'the owner’s daemon is never left or awaited').toEqual([]);
            expect(managers.changes(), 'the owner’s unit is never installed, started or uninstalled').toEqual([]);
            expect(existsSync(plistPath())).toBe(true);
          });

  // P5 O3-B: on its scratch profile a test launch runs the daemon shape with a private mawsd, as the owner's app would
  it('the same launch on a scratch profile runs a private mawsd, the shape the owner runs', async () => {
    for (const harness of [{ MAWS_E2E: '1' }, { MAWS_HARNESS: '1' }]) {
      const launch = await settle(resolveLaunch({ env: harness, shape: 'daemon', packaged: false, profileDir: scratchProfile(), program: CHECKOUT }, deps({ env: harness })));
      expect(launch).toEqual({ mode: 'daemon', daemon: 'private', unavailable: null });
    }
    expect(exits).toEqual([]);
    expect(managers.calls, 'no unit of the default profile is read or touched').toEqual([]);
  });
});

// P5 O3-B, acceptance 5: the owner's `mawsd` and socket-mode pty host as live processes on the default profile, their locks
// naming them with their start times, and the real teardown (leaveDaemonShape) in place of the stand-in above. A test or
// harness launch, with MAWS_HOST_MODE unset or naming any mode, under either setting, packaged or not, leaves both running
// and never signalled, and the owner's unit as it was.
describe('the owner’s daemon under a test or harness launch', () => {
  let record: string;
  let owner: { mawsd: Awaited<ReturnType<typeof spawnStandIn>>; ptyHost: Awaited<ReturnType<typeof spawnStandIn>> };
  beforeAll(async () => {
    record = join(mkdtempSync(join(tmpdir(), 'maws-o3b-')), 'sigterms');
    owner = { mawsd: await spawnStandIn('mawsd', record), ptyHost: await spawnStandIn('pty host', record) };
  });
  afterAll(() => {
    for (const { child } of Object.values(owner)) child.kill('SIGKILL');
    rmSync(dirname(record), { recursive: true, force: true });
  });

  for (const asked of [undefined, 'utility', 'detached', 'daemon'] as const)
    it(`MAWS_HOST_MODE=${asked ?? '(unset)'}: the owner's mawsd pid and pty host are untouched`, async () => {
      for (const harness of [{ MAWS_E2E: '1' }, { MAWS_HARNESS: '1' }])
        for (const shape of ['embedded', 'daemon'] as const)
          for (const packaged of [false, true]) {
            await installUnit(); // the owner's LaunchAgent, loaded
            const paths = daemonPaths(defaultProfile());
            writeStandInLock(join(paths.dir, 'mawsd.lock'), owner.mawsd);
            writeStandInLock(join(paths.ptyHost, 'host.lock'), owner.ptyHost);
            exits.length = 0;
            const env = { ...harness, ...(asked ? { MAWS_HOST_MODE: asked } : {}) };
            const launch = () => resolveLaunch({ env, shape, packaged, profileDir: defaultProfile(), program: packaged ? PACKAGED : CHECKOUT }, deps({ env, leaveDaemon: undefined, awaitDaemon: undefined }));
            expect(launch).toThrow(Exited);
            expect(exits).toEqual([1]);
            expect(managers.changes(), 'the owner’s unit is never installed, started or uninstalled').toEqual([]);
          }
      await new Promise((resolve) => setTimeout(resolve, 100)); // a SIGTERM sent would have been handled by now
      expect(existsSync(record), 'neither process was sent SIGTERM').toBe(false);
      for (const [name, { child, start }] of Object.entries(owner)) {
        expect(child.exitCode, `${name} runs`).toBeNull();
        expect(procStartOf(child.pid!), `${name} is the same process`).toBe(start);
      }
    });
});

describe('the default profile’s unit', () => {
  it('is repaired to run this bundle when a packaged app finds it running another, then loaded again', async () => {
    await installUnit();
    const moved = { runtime: '/Applications/MAWS 2.app/Contents/MacOS/MAWS', entry: '/Applications/MAWS 2.app/Contents/Resources/app.asar/out/main/mawsd.js' };
    expect(unitRunsThisApp({ profileDir: defaultProfile(), program: moved }, deps())).toBe(false);
    await settle(resolveLaunch({ env: {}, shape: 'daemon', packaged: true, profileDir: defaultProfile(), program: moved }, deps()));
    expect(managers.changes()).toEqual([`launchctl bootout gui/501/${LABEL}`, `launchctl bootstrap gui/501 ${plistPath()}`, `launchctl kickstart gui/501/${LABEL}`]);
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

  // M7 review I1: a loaded unit is used only once it starts `mawsd`; one the system will not start runs the launch
  // embedded, with the reason
  it('a kickstart the system rejects runs the launch embedded, with launchctl’s answer, packaged or not', async () => {
    await installUnit();
    for (const [packaged, program] of [[false, CHECKOUT], [true, PACKAGED]] as const) {
      managers.script('launchctl kickstart', { status: 5, stderr: 'Could not kickstart service "dev.maws.mawsd": 5: Input/output error' });
      const launch = await settle(resolveLaunch({ env: {}, shape: 'daemon', packaged, profileDir: defaultProfile(), program }, deps()));
      expect(launch, packaged ? 'packaged' : 'unpackaged').toEqual({ mode: 'detached', daemon: null, unavailable: expect.stringMatching(/^the LaunchAgent did not start mawsd: .*5: Input\/output error/) });
    }
    expect(logs).toContainEqual(expect.stringMatching(/^\[hosts\] the daemon shape does not run this launch: the LaunchAgent did not start mawsd: .*; running embedded$/));
  });

  it('asks machine.sock again until the bound, each hello within what is left of it, and stops at once at a refusal', async () => {
    const paths = daemonPaths(defaultProfile());
    let now = 0;
    const hellos: number[] = [];
    const clock = { now: () => now, sleep: async (ms: number) => void (now += ms) };
    const down: AwaitDaemonDeps['reach'] = async (_paths, options) => (hellos.push(options.helloTimeoutMs!), (now += Math.min(20, options.helloTimeoutMs!)), { ok: false, state: 'down', why: 'its socket is left from a daemon that has exited' });
    await expect(awaitDaemonWelcome(paths, { reach: down, ...clock })).rejects.toThrow(`no mawsd welcomed a hello on machine.sock within ${UNIT_READY_MS / 1000} s of the unit's start (last: its socket is left from a daemon that has exited)`);
    expect(now, 'the bound, and no longer').toBe(UNIT_READY_MS);
    expect(hellos[0]).toBe(HELLO_TIMEOUT_MS);
    expect(hellos.at(-1), 'the last hello waits only what is left').toBeLessThan(HELLO_TIMEOUT_MS);
    const refusing: AwaitDaemonDeps['reach'] = async () => ({ ok: false, state: 'incompatible', why: 'mawsd refused the hello (protocol)' });
    now = 0;
    await expect(awaitDaemonWelcome(paths, { reach: refusing, ...clock })).rejects.toThrow('mawsd refused the hello (protocol)');
    expect(now, 'no second hello').toBe(0);
  });

  // M7 re-review I1: `mawsd` up is its authenticated welcome on machine.sock, never its lock. The real client reaches the
  // default profile's sockets here, within a short bound.
  describe('the unit’s mawsd, up', () => {
    const BOUND_MS = 600;
    const cleanups: (() => unknown)[] = [];
    afterEach(async () => {
      for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    });
    const awaitDaemon = (p: Parameters<NonNullable<LaunchDeps['awaitDaemon']>>[0]) => awaitDaemonWelcome(p, { reach: reachMachine, now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }, BOUND_MS);
    const launchUnit = async () => settle(resolveLaunch({ env: {}, shape: 'daemon', packaged: false, profileDir: defaultProfile(), program: CHECKOUT }, deps({ awaitDaemon })));
    // the default profile's daemon files as a `mawsd` past its lock and its token leaves them, private
    const daemonFiles = () => {
      const paths = daemonPaths(defaultProfile());
      mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
      mkdirSync(paths.socketDir, { recursive: true, mode: 0o700 });
      cleanups.push(() => rmSync(paths.socketDir, { recursive: true, force: true })); // under the OS temp directory when the profile's path is long
      return { paths, token: writeToken(join(paths.dir, 'mawsd.token')) };
    };
    const listenAt = async (server: Server, path: string) => {
      await new Promise<void>((resolve, reject) => server.once('error', reject).listen(path, () => resolve()));
      chmodSync(path, 0o600);
      cleanups.push(() => new Promise((resolve) => server.close(resolve)));
    };

    it('a live lock holder whose machine.sock never welcomes runs the launch embedded, saying so', async () => {
      await installUnit();
      const { paths } = daemonFiles();
      writeLock(join(paths.dir, 'mawsd.lock'), process.pid, procStartOf(process.pid) ?? ''); // a live process, as a starting mawsd's
      const accepted: Socket[] = [];
      await listenAt(createServer((socket) => void accepted.push(socket)), paths.sockets.machine); // accepts, never answers
      cleanups.push(() => accepted.forEach((socket) => socket.destroy()));
      const launch = await launchUnit();
      expect(launch).toEqual({ mode: 'detached', daemon: null, unavailable: expect.stringMatching(new RegExp(`^the LaunchAgent did not start mawsd: no mawsd welcomed a hello on machine.sock within ${BOUND_MS / 1000} s of the unit's start \\(last: no answer to the hello within`)) });
      expect(accepted.length, 'it was asked').toBeGreaterThan(0);
    });

    it('a mawsd whose start fails after its lock (the lock released, the process gone) runs the launch embedded', async () => {
      await installUnit();
      const { paths } = daemonFiles();
      const lock = join(paths.dir, 'mawsd.lock');
      const failing = spawn(process.execPath, ['-e', `setTimeout(() => { require('node:fs').rmSync(${JSON.stringify(lock)}, { force: true }); process.exit(1); }, 150); process.stdout.write('ready');`], { stdio: ['ignore', 'pipe', 'ignore'] });
      cleanups.push(() => failing.kill('SIGKILL'));
      await new Promise((resolve) => failing.stdout!.once('data', resolve));
      writeLock(lock, failing.pid!, procStartOf(failing.pid!) ?? '');
      const gone = new Promise((resolve) => failing.once('exit', resolve));
      const launch = await launchUnit();
      expect(launch).toEqual({ mode: 'detached', daemon: null, unavailable: expect.stringMatching(/^the LaunchAgent did not start mawsd: no mawsd welcomed a hello on machine\.sock within/) });
      await gone;
      expect(existsSync(lock)).toBe(false);
    });

    it('a welcome on machine.sock runs the launch on the unit, the probe closed with no request', async () => {
      await installUnit();
      const { paths, token } = daemonFiles();
      const asked: string[] = [];
      const connections: boolean[] = [];
      const server = createServer();
      serveSocketClients(server, {
        many: { runtimeFor: () => createHostRuntime((on) => on('daemon.status', async () => void asked.push('daemon.status') as never)) },
        badToken: 'close',
        identity: () => ({ protocol: SOCKET_PROTOCOL, minor: WIRE_MINOR, buildId: 'mawsd-build', capabilities: [], wire: 'wire', pid: process.pid, startedAt: new Date().toISOString() }),
        counts: () => ({ liveSessions: 0, rows: 0 }),
        token: () => token,
        onExit: () => {},
        onClient: (connected) => void connections.push(connected),
        log: () => {},
      });
      await listenAt(server, paths.sockets.machine);
      expect(await launchUnit()).toEqual({ mode: 'daemon', daemon: 'unit', unavailable: null });
      await vi.waitFor(() => expect(connections, 'welcomed, then closed').toEqual([true, false]), { timeout: 2_000, interval: 10 });
      expect(asked, 'daemon.status would wake the engine host').toEqual([]);
    });
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
      const launch = await settle(resolveLaunch({ env: {}, shape: setting, packaged: true, profileDir: defaultProfile(), program: PACKAGED }, deps({ run, leaveDaemon: async () => void order.push('left the daemon shape'), log: () => {} })));
      order.push(`hosts created (${launch.mode})`);
      managers.calls.length = 0;
      return launch;
    };
    expect(await launchApp()).toEqual({ mode: 'daemon', daemon: 'unit', unavailable: null });
    setting = 'embedded'; // the owner flips the switch: the launch keeps its daemon and its links
    expect(managers.calls, 'nothing is asked of launchd').toEqual([]);
    expect(managers.loaded.has(LABEL)).toBe(true);
    expect(await launchApp()).toEqual({ mode: 'detached', daemon: null, unavailable: null });
    expect(order).toEqual(['launchctl bootstrap', 'launchctl kickstart', 'hosts created (daemon)', 'launchctl bootout', 'left the daemon shape', 'hosts created (detached)']);
    expect(existsSync(plistPath())).toBe(false);
    expect(await launchApp(), 'and after it, nothing is left to remove').toEqual({ mode: 'detached', daemon: null, unavailable: null });
    expect(order.slice(6)).toEqual(['hosts created (detached)']);
  });

  it('settles synchronously when there is no unit work, so a scratch profile starts as it always has', () => {
    const launch = resolveLaunch({ env: { MAWS_HOST_MODE: 'daemon' }, shape: 'embedded', packaged: false, profileDir: scratchProfile(), program: CHECKOUT }, deps());
    expect(launch).toEqual({ mode: 'daemon', daemon: 'private', unavailable: null });
    expect(managers.calls, 'not even a read of launchd for another profile').toEqual([]);
  });

  it('ends the pty host even when the uninstall fails', async () => {
    const launch = await settle(
      prepareShape(
        { mode: 'detached', uninstall: true, unavailable: null },
        { install: async () => {}, startUnit: async () => {}, uninstall: async () => Promise.reject(new Error('bootout failed')), daemonLeft: () => false, leaveDaemon: async () => void logs.push('left the daemon shape'), log: (l) => void logs.push(l) },
      ),
    );
    expect(launch).toEqual({ mode: 'detached', daemon: null, unavailable: null });
    expect(logs.slice(1)).toEqual(['[hosts] the LaunchAgent could not be uninstalled: bootout failed', 'left the daemon shape']);
  });
});

// M7 review I2: any profile, not only the default one, leaves the daemon shape at its next embedded launch: its
// `mawsd` (a private one here) is ended first, then its socket-mode pty host; the engine host, whose sessions carry over
// to the embedded app, is left running. Real processes stand in for the three, each recording its SIGTERM.
// A live process that appends `name` to `record` at its SIGTERM and exits, and its start time as its lock records one.
const spawnStandIn = async (name: string, record: string): Promise<{ child: ChildProcess; start: string }> => {
  const child = spawn(process.execPath, ['-e', `process.on('SIGTERM', () => { require('node:fs').appendFileSync(${JSON.stringify(record)}, ${JSON.stringify(`${name}\n`)}); process.exit(0); }); setInterval(() => {}, 1000); process.stdout.write('ready');`], { stdio: ['ignore', 'pipe', 'ignore'] });
  await new Promise((resolve) => child.stdout!.once('data', resolve)); // its SIGTERM handler is in place
  let start: string | null = null;
  for (let i = 0; i < 50 && (start = procStartOf(child.pid!)) === null; i++) await new Promise((r) => setTimeout(r, 20));
  return { child, start: start ?? '' };
};
const writeStandInLock = (lockPath: string, { child, start }: { child: ChildProcess; start: string }) => {
  mkdirSync(dirname(lockPath), { recursive: true });
  writeLock(lockPath, child.pid!, start);
};

describe('a profile leaving the daemon shape', () => {
  const standIns: ChildProcess[] = [];
  afterEach(() => {
    for (const child of standIns.splice(0)) child.kill('SIGKILL');
  });
  // a stand-in whose lock is written once its handler is in place
  const standIn = async (name: string, lockPath: string, record: string): Promise<ChildProcess> => {
    const spawned = await spawnStandIn(name, record);
    standIns.push(spawned.child);
    writeStandInLock(lockPath, spawned);
    return spawned.child;
  };
  const exited = (child: ChildProcess) => new Promise<void>((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', () => resolve())));

  it('ends a scratch profile’s private mawsd, then its socket-mode pty host, and leaves the engine host, before an embedded launch’s hosts exist', async () => {
    const profile = scratchProfile();
    const paths = daemonPaths(profile);
    const record = join(home, 'sigterms');
    const mawsd = await standIn('mawsd', join(paths.dir, 'mawsd.lock'), record);
    const ptyHost = await standIn('pty host', join(paths.ptyHost, 'host.lock'), record);
    const engine = await standIn('engine host', join(profile, 'supervisor', 'host.lock'), record);
    const launch = resolveLaunch({ env: {}, shape: 'embedded', packaged: false, profileDir: profile, program: CHECKOUT }, deps({ leaveDaemon: undefined }));
    expect(launch, 'the teardown is waited for before the hosts are created').toBeInstanceOf(Promise);
    expect(await launch).toEqual({ mode: 'detached', daemon: null, unavailable: null });
    await Promise.all([exited(mawsd), exited(ptyHost)]);
    expect(readFileSync(record, 'utf8')).toBe('mawsd\npty host\n');
    expect(engine.exitCode, 'the engine host keeps running, its sessions with it').toBeNull();
    expect(managers.calls, 'no unit of the default profile is touched').toEqual([]);
  });

  it('leaves them alone on a launch the daemon was unavailable to, and on a profile with no daemon-shape locks', async () => {
    const profile = defaultProfile(); // an unpackaged run asking for the daemon with no unit: embedded, saying why
    const record = join(home, 'sigterms');
    const ptyHost = await standIn('pty host', join(daemonPaths(profile).ptyHost, 'host.lock'), record);
    expect(await settle(resolveLaunch({ env: {}, shape: 'daemon', packaged: false, profileDir: profile, program: CHECKOUT }, deps({ leaveDaemon: undefined })))).toEqual({ mode: 'detached', daemon: null, unavailable: UNAVAILABLE.noUnit });
    expect(ptyHost.exitCode).toBeNull();
    expect(existsSync(record)).toBe(false);
    const fresh = resolveLaunch({ env: {}, shape: 'embedded', packaged: false, profileDir: join(home, 'fresh'), program: CHECKOUT }, deps());
    expect(fresh, 'synchronous, with nothing to end').toEqual({ mode: 'detached', daemon: null, unavailable: null });
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

  // P5 O3-D M5b: the spine's state is in the status, and it changes at no host transition (a load refused by the lock)
  it('reads the status again when asked, once the machine host is ready', async () => {
    const status = daemonStatus({ build: { ...daemonStatus().build, buildId: THIS } });
    const { watch, calls, changes, ready } = scene({ status });
    watch.refresh(); // not ready yet: nothing asked
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual([]);
    await ready('machine');
    watch.refresh();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(['machine daemon.status', 'machine daemon.status']);
    expect(changes).toHaveLength(2);
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
