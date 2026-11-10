// The launch's outcome (P5 O2 M7, docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7's Proves; P5 O15 M2,
// docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, Interfaces §A and §C): every row of the table and each of
// a packaged start's four cases, through the real installer and fake unit managers in a scratch home; a test launch on
// the main profile refused before anything; how main's three transports start and reach `mawsd`; the build check.
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { daemonPaths } from '@shared/daemon/files';
import { defaultProfileDir } from '@shared/daemon/profile';
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
import { DEFAULT_PROFILE_REFUSAL } from './mode';
import {
  awaitDaemonWelcome,
  type AwaitDaemonDeps,
  daemonHostSpecs,
  daemonStart,
  daemonWrites,
  resolveLaunch,
  UNAVAILABLE_KINDS,
  UNAVAILABLE_WHY,
  UNIT_READY_MS,
  unitRunsThisApp,
  watchDaemon,
  type LaunchDeps,
  type LaunchOutcome,
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
  awaitDaemon: async () => {}, // the unit's mawsd up at once, unless a test says otherwise
  log: (line) => void logs.push(line),
  exit: (code, line) => {
    logs.push(line);
    exits.push(code);
    throw new Exited(code);
  },
  ...over,
});
const settle = async (launch: LaunchOutcome | Promise<LaunchOutcome>) => await launch;
const unit: LaunchOutcome = { ok: true, launch: { daemon: 'unit' } };
const privateDaemon: LaunchOutcome = { ok: true, launch: { daemon: 'private' } };
const failure = (kind: string, why: string | RegExp): LaunchOutcome => ({ ok: false, unavailable: { kind: kind as never, why: typeof why === 'string' ? why : (expect.stringMatching(why) as never) } });
// a lock as takeLock writes it, naming `pid` with its start time
const writeLock = (path: string, pid: number, procStart: string) => writeFileSync(path, JSON.stringify({ pid, procStart, protocol: 3, buildId: 'b', socketPath: `${path}.sock`, startedAt: new Date().toISOString() }));
const launchMain = (packaged: boolean, over: Partial<LaunchDeps> = {}) => settle(resolveLaunch({ env: {}, packaged, profileDir: defaultProfile(), program: packaged ? PACKAGED : CHECKOUT }, deps(over)));

// The facts the installer knows of: the default profile's LaunchAgent written by a packaged app, loaded in launchd.
async function installUnit(): Promise<void> {
  expect(await launchMain(true)).toEqual(unit);
  expect(managers.loaded.has(LABEL)).toBe(true);
  managers.calls.length = 0;
  logs.length = 0;
}

// §A: the profile, the build and the main profile's unit decide; nothing else does (no setting, no environment)
describe('the launch table', () => {
  it('a profile that is not the main one answers private at once, reading no unit, packaged or not, whatever MAWS_HOST_MODE says', () => {
    for (const packaged of [false, true])
      for (const env of [{}, { MAWS_HOST_MODE: 'detached' }, { MAWS_HOST_MODE: 'utility' }, { MAWS_E2E: '1' }, { MAWS_HARNESS: '1' }]) {
        const launch = resolveLaunch({ env, packaged, profileDir: scratchProfile(), program: packaged ? PACKAGED : CHECKOUT }, deps({ env }));
        expect(launch, 'synchronous: nothing is started here').toEqual(privateDaemon);
      }
    expect(managers.calls, 'not even a read of launchd for another profile').toEqual([]);
    expect(logs.at(-1)).toBe('[hosts] the machine daemon: a private mawsd');
  });

  it('packaged, main profile, no unit yet: installed for this bundle, started, welcomed: unit', async () => {
    expect(await launchMain(true)).toEqual(unit);
    expect(managers.changes()).toEqual([`launchctl bootstrap gui/501 ${plistPath()}`, `launchctl kickstart gui/501/${LABEL}`]);
    expect(logs.at(-1)).toBe("[hosts] the machine daemon: the main profile's LaunchAgent");
  });

  it('packaged, main profile, a unit running this bundle: started and welcomed, nothing rewritten', async () => {
    await installUnit();
    expect(await launchMain(true)).toEqual(unit);
    expect(managers.changes()).toEqual([`launchctl kickstart gui/501/${LABEL}`]);
  });

  it('packaged, main profile, a unit running another bundle: repaired to run this one, loaded again, started', async () => {
    await installUnit();
    const moved = { runtime: '/Applications/MAWS 2.app/Contents/MacOS/MAWS', entry: '/Applications/MAWS 2.app/Contents/Resources/app.asar/out/main/mawsd.js' };
    expect(unitRunsThisApp({ profileDir: defaultProfile(), program: moved }, deps())).toBe(false);
    expect(await settle(resolveLaunch({ env: {}, packaged: true, profileDir: defaultProfile(), program: moved }, deps()))).toEqual(unit);
    expect(managers.changes()).toEqual([`launchctl bootout gui/501/${LABEL}`, `launchctl bootstrap gui/501 ${plistPath()}`, `launchctl kickstart gui/501/${LABEL}`]);
    expect(readFileSync(plistPath(), 'utf8')).toContain('/Applications/MAWS 2.app/Contents/Resources/app.asar/out/main/mawsd.js');
    expect(unitRunsThisApp({ profileDir: defaultProfile(), program: moved }, deps())).toBe(true);
  });

  it('unpackaged, main profile, a unit installed and loaded: started and welcomed: unit, the unit never written', async () => {
    await installUnit();
    expect(await launchMain(false)).toEqual(unit);
    expect(managers.changes()).toEqual([`launchctl kickstart gui/501/${LABEL}`]);
  });

  it('unpackaged, main profile, a unit installed and loaded that does not welcome: not-started, with the wait’s answer', async () => {
    await installUnit();
    const silent = async () => Promise.reject(new Error('no mawsd welcomed a hello on machine.sock within 10 s of the unit’s start (last: nothing answered)'));
    expect(await launchMain(false, { awaitDaemon: silent })).toEqual(failure('not-started', 'no mawsd welcomed a hello on machine.sock within 10 s of the unit’s start (last: nothing answered)'));
    expect(logs.at(-1)).toBe('[hosts] mawsd cannot start (not-started): no mawsd welcomed a hello on machine.sock within 10 s of the unit’s start (last: nothing answered)');
  });

  it('unpackaged, main profile, a kickstart refused: not-started with launchctl’s words, never a throw', async () => {
    await installUnit();
    managers.script('launchctl kickstart', { status: 5, stderr: 'Could not kickstart service "dev.maws.mawsd": 5: Input/output error' });
    expect(await launchMain(false)).toEqual(failure('not-started', /^launchctl kickstart gui\/501\/dev\.maws\.mawsd failed \(5\): Could not kickstart service "dev\.maws\.mawsd": 5: Input\/output error$/));
  });

  it('unpackaged, main profile, a unit installed but not loaded: not-loaded, nothing asked of launchd but its state', async () => {
    await installUnit();
    managers.loaded.clear(); // turned off in Login Items: the file stays, launchd has no job
    expect(await launchMain(false)).toEqual(failure('not-loaded', UNAVAILABLE_WHY.notLoaded));
    expect(managers.changes()).toEqual([]);
  });

  it('unpackaged, main profile, no unit installed: no-unit, the unit never written', async () => {
    expect(await launchMain(false)).toEqual(failure('no-unit', UNAVAILABLE_WHY.noUnit));
    expect(managers.changes()).toEqual([]);
    expect(existsSync(plistPath())).toBe(false);
  });

  it('main profile where there is no unit manager: no-unit, packaged or not', async () => {
    const profileDir = defaultProfileDir('win32', {}, home);
    for (const packaged of [false, true]) expect(await settle(resolveLaunch({ env: {}, packaged, profileDir, program: PACKAGED }, deps({ platform: 'win32' })))).toEqual(failure('no-unit', /no unit manager on win32/));
    expect(managers.calls).toEqual([]);
  });
});

// §A, "A start that does not end in a welcome, on a packaged build": the rule holds whichever step macOS refuses
describe('a packaged start that does not end in a welcome', () => {
  const paths = () => daemonPaths(defaultProfile());
  const files = () => {
    mkdirSync(paths().dir, { recursive: true });
    return { log: join(paths().dir, 'mawsd.log'), out: join(paths().dir, 'mawsd.out'), lock: join(paths().dir, 'mawsd.lock') };
  };
  const silent = (during: () => void = () => {}) => async () => {
    during();
    throw new Error('no mawsd welcomed a hello on machine.sock within 10 s of the unit’s start (last: its socket is left from a daemon that has exited)');
  };

  it('(i) a bootstrap that answers non-zero: install-refused, with launchctl’s words', async () => {
    managers.script('launchctl bootstrap', { status: 119, stderr: 'Bootstrap failed: 119: Service is disabled' });
    expect(await launchMain(true)).toEqual(failure('install-refused', /^launchctl bootstrap gui\/501 .* failed.*119: Service is disabled$/));
    expect(existsSync(plistPath()), 'the failed first install leaves no file behind (M6)').toBe(false);
    expect(managers.changes().some((call) => call.startsWith('launchctl kickstart')), 'no start is asked').toBe(false);
  });

  it('(ii) a kickstart that answers non-zero: install-refused, with launchctl’s words', async () => {
    await installUnit();
    managers.script('launchctl kickstart', { status: 1, stderr: 'Could not kickstart service "dev.maws.mawsd": 1: Operation not permitted' });
    expect(await launchMain(true)).toEqual(failure('install-refused', /^launchctl kickstart gui\/501\/dev\.maws\.mawsd failed \(1\): .*1: Operation not permitted$/));
  });

  it('(iii) a start that reported success, both files unchanged and no live lock holder: install-refused, macOS loaded mawsd but did not run it', async () => {
    await installUnit();
    const { log, lock } = files();
    writeFileSync(log, 'an earlier launch\n'); // there, unchanged; mawsd.out missing throughout
    writeLock(lock, 2 ** 22 + 12_345, 'gone'); // a lock left by a process that is gone
    expect(await launchMain(true, { awaitDaemon: silent() })).toEqual(failure('install-refused', 'macOS loaded mawsd but did not run it'));
  });

  it('(iv) no welcome and mawsd.log written since the attempt began: not-started, with the wait’s last answer', async () => {
    await installUnit();
    const { log } = files();
    writeFileSync(log, 'an earlier launch\n');
    expect(await launchMain(true, { awaitDaemon: silent(() => appendFileSync(log, 'starting\n')) })).toEqual(failure('not-started', /^no mawsd welcomed a hello on machine\.sock within 10 s .*\(last: its socket is left from a daemon that has exited\)$/));
  });

  it('(iv) no welcome and mawsd.out appearing since the attempt began: not-started', async () => {
    await installUnit();
    const { out } = files();
    expect(await launchMain(true, { awaitDaemon: silent(() => writeFileSync(out, 'node: bad option\n')) })).toEqual(failure('not-started', /^no mawsd welcomed/));
  });

  it('(iv) no welcome and mawsd.log rotated (a new inode at the same size): not-started', async () => {
    await installUnit();
    const { log } = files();
    writeFileSync(log, 'x'.repeat(10));
    expect(
      await launchMain(true, {
        awaitDaemon: silent(() => {
          renameSync(log, `${log}.1`);
          writeFileSync(log, 'y'.repeat(10));
        }),
      }),
    ).toEqual(failure('not-started', /^no mawsd welcomed/));
  });

  it('(iv) no welcome, the files unchanged, and a live process holding mawsd.lock (a mawsd already running, silent): not-started', async () => {
    await installUnit();
    const { lock } = files();
    writeLock(lock, process.pid, procStartOf(process.pid) ?? '');
    expect(await launchMain(true, { awaitDaemon: silent() })).toEqual(failure('not-started', /^no mawsd welcomed/));
  });

  it('reads whether mawsd wrote with no clock: size and inode of both files, a missing file a value of its own', () => {
    const p = paths();
    const missing = daemonWrites(p);
    expect(missing).toBe('missing missing');
    const { log } = files();
    writeFileSync(log, 'a');
    const one = daemonWrites(p);
    expect(one).not.toBe(missing);
    expect(daemonWrites(p), 'read again, nothing written').toBe(one);
  });

  it('never throws, whatever step fails: every row and case is an outcome', async () => {
    managers.script('launchctl bootstrap', { status: 5, stderr: 'Bootstrap failed: 5: Input/output error' }, 10);
    await expect(launchMain(true)).resolves.toMatchObject({ ok: false, unavailable: { kind: 'install-refused' } });
    await expect(launchMain(true, { awaitDaemon: async () => Promise.reject('a string, not an Error') })).resolves.toMatchObject({ ok: false });
  });

  it('a why that spans lines is told on one', async () => {
    await installUnit();
    managers.script('launchctl kickstart', { status: 5, stderr: 'line one\n  line two\n' });
    const outcome = await launchMain(true);
    expect(outcome.ok).toBe(false);
    expect((outcome as Extract<LaunchOutcome, { ok: false }>).unavailable.why).not.toContain('\n');
    expect((outcome as Extract<LaunchOutcome, { ok: false }>).unavailable.why).toMatch(/line one line two$/);
  });
});

// §C: the e2e fault stands a failure in for a scratch profile's private daemon, in an unpackaged e2e launch alone
describe('the e2e fault', () => {
  const faultFile = () => join(home, 'fault');
  const launch = (env: NodeJS.ProcessEnv, packaged = false, profileDir = scratchProfile()) => resolveLaunch({ env, packaged, profileDir, program: packaged ? PACKAGED : CHECKOUT }, deps({ env }));

  it('fails the launch with each kind the file names, why `e2e fault`, read at each attempt', () => {
    const env = { MAWS_E2E: '1', MAWS_E2E_UNIT_FAULT: faultFile() };
    for (const kind of UNAVAILABLE_KINDS) {
      writeFileSync(faultFile(), ` ${kind}\n`);
      expect(launch(env)).toEqual(failure(kind, 'e2e fault'));
    }
    rmSync(faultFile());
    expect(launch(env), 'the file removed: the row’s own outcome').toEqual(privateDaemon);
    writeFileSync(faultFile(), 'embedded');
    expect(launch(env), 'a content that is no kind').toEqual(privateDaemon);
  });

  it('is ignored packaged, without MAWS_E2E=1, or for a path that is not absolute', () => {
    writeFileSync(faultFile(), 'not-started');
    expect(launch({ MAWS_E2E: '1', MAWS_E2E_UNIT_FAULT: faultFile() }, true)).toEqual(privateDaemon);
    expect(launch({ MAWS_E2E_UNIT_FAULT: faultFile() })).toEqual(privateDaemon);
    expect(launch({ MAWS_E2E: '1', MAWS_E2E_UNIT_FAULT: 'fault' })).toEqual(privateDaemon);
  });
});

// P5 O2 landing (O3's planner, P9): a test launch with no MAWS_USER_DATA lands on the default profile, where the owner's
// mawsd may be up. Planned like any launch, a packaged one would install or repair and start the owner's unit. It
// exits first, with one line.
describe('a test or harness launch on the default profile', () => {
  for (const harness of [{ MAWS_E2E: '1' }, { MAWS_HARNESS: '1' }])
    for (const packaged of [false, true])
      it(`${Object.keys(harness)[0]} ${packaged ? 'packaged' : 'unpackaged'}: exits non-zero before touching the owner's unit or daemon`, async () => {
        await installUnit(); // the owner's LaunchAgent, loaded
        const paths = daemonPaths(defaultProfile()); // the owner's mawsd and socket-mode pty host up
        mkdirSync(paths.ptyHost, { recursive: true });
        writeLock(join(paths.dir, 'mawsd.lock'), process.pid, 'owner');
        writeLock(join(paths.ptyHost, 'host.lock'), process.pid, 'owner');
        const reached: string[] = [];
        const env = { ...harness, MAWS_E2E_UNIT_FAULT: join(home, 'fault') };
        const launch = () => resolveLaunch({ env, packaged, profileDir: defaultProfile(), program: packaged ? PACKAGED : CHECKOUT }, deps({ env, awaitDaemon: async () => void reached.push('awaitDaemon') }));
        expect(launch).toThrow(Exited);
        expect(exits).toEqual([1]);
        expect(logs).toEqual([DEFAULT_PROFILE_REFUSAL]);
        expect(reached, 'the owner’s daemon is never awaited').toEqual([]);
        expect(managers.changes(), 'the owner’s unit is never installed or started').toEqual([]);
        expect(existsSync(plistPath())).toBe(true);
      });

  // P5 O3-B: on its scratch profile a test launch runs a private mawsd, the shape the owner runs
  it('the same launch on a scratch profile runs a private mawsd', () => {
    for (const harness of [{ MAWS_E2E: '1' }, { MAWS_HARNESS: '1' }]) expect(resolveLaunch({ env: harness, packaged: false, profileDir: scratchProfile(), program: CHECKOUT }, deps({ env: harness }))).toEqual(privateDaemon);
    expect(exits).toEqual([]);
    expect(managers.calls, 'no unit of the default profile is read or touched').toEqual([]);
  });
});

// P5 O3-B, acceptance 5: the owner's `mawsd` and socket-mode pty host as live processes on the default profile, their
// locks naming them with their start times. A test or harness launch, packaged or not, leaves both running and never
// signalled, and the owner's unit as it was.
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

  it('the owner’s mawsd pid and pty host are untouched', async () => {
    for (const harness of [{ MAWS_E2E: '1' }, { MAWS_HARNESS: '1' }])
      for (const packaged of [false, true]) {
        await installUnit(); // the owner's LaunchAgent, loaded
        const paths = daemonPaths(defaultProfile());
        writeStandInLock(join(paths.dir, 'mawsd.lock'), owner.mawsd);
        writeStandInLock(join(paths.ptyHost, 'host.lock'), owner.ptyHost);
        exits.length = 0;
        const launch = () => resolveLaunch({ env: harness, packaged, profileDir: defaultProfile(), program: packaged ? PACKAGED : CHECKOUT }, deps({ env: harness, awaitDaemon: undefined }));
        expect(launch).toThrow(Exited);
        expect(exits).toEqual([1]);
        expect(managers.changes(), 'the owner’s unit is never installed or started').toEqual([]);
      }
    await new Promise((resolve) => setTimeout(resolve, 100)); // a SIGTERM sent would have been handled by now
    expect(existsSync(record), 'neither process was sent SIGTERM').toBe(false);
    for (const [name, { child, start }] of Object.entries(owner)) {
      expect(child.exitCode, `${name} runs`).toBeNull();
      expect(procStartOf(child.pid!), `${name} is the same process`).toBe(start);
    }
  });
});

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

describe('the unit’s mawsd, up', () => {
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
  describe('through the real client', () => {
    const BOUND_MS = 600;
    const cleanups: (() => unknown)[] = [];
    afterEach(async () => {
      for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    });
    const awaitDaemon = (p: Parameters<NonNullable<LaunchDeps['awaitDaemon']>>[0]) => awaitDaemonWelcome(p, { reach: reachMachine, now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }, BOUND_MS);
    const launchUnit = async () => settle(resolveLaunch({ env: {}, packaged: false, profileDir: defaultProfile(), program: CHECKOUT }, deps({ awaitDaemon })));
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

    it('a live lock holder whose machine.sock never welcomes is not-started, saying so', async () => {
      await installUnit();
      const { paths } = daemonFiles();
      writeLock(join(paths.dir, 'mawsd.lock'), process.pid, procStartOf(process.pid) ?? ''); // a live process, as a starting mawsd's
      const accepted: Socket[] = [];
      await listenAt(createServer((socket) => void accepted.push(socket)), paths.sockets.machine); // accepts, never answers
      cleanups.push(() => accepted.forEach((socket) => socket.destroy()));
      const launch = await launchUnit();
      expect(launch).toEqual(failure('not-started', new RegExp(`^no mawsd welcomed a hello on machine.sock within ${BOUND_MS / 1000} s of the unit's start \\(last: no answer to the hello within`)));
      expect(accepted.length, 'it was asked').toBeGreaterThan(0);
    });

    it('a mawsd whose start fails after its lock (the lock released, the process gone) is not-started', async () => {
      await installUnit();
      const { paths } = daemonFiles();
      const lock = join(paths.dir, 'mawsd.lock');
      const failing = spawn(process.execPath, ['-e', `setTimeout(() => { require('node:fs').rmSync(${JSON.stringify(lock)}, { force: true }); process.exit(1); }, 150); process.stdout.write('ready');`], { stdio: ['ignore', 'pipe', 'ignore'] });
      cleanups.push(() => failing.kill('SIGKILL'));
      await new Promise((resolve) => failing.stdout!.once('data', resolve));
      writeLock(lock, failing.pid!, procStartOf(failing.pid!) ?? '');
      const gone = new Promise((resolve) => failing.once('exit', resolve));
      const launch = await launchUnit();
      expect(launch).toEqual(failure('not-started', /^no mawsd welcomed a hello on machine\.sock within/));
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
      expect(await launchUnit()).toEqual(unit);
      await vi.waitFor(() => expect(connections, 'welcomed, then closed').toEqual([true, false]), { timeout: 2_000, interval: 10 });
      expect(asked, 'daemon.status would wake the engine host').toEqual([]);
    });
  });

});

describe('main’s hosts', () => {
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

  it('give the machine host the spine’s command budgets, and the engine and pty hosts none (the panel’s sweep#3)', () => {
    const start = daemonStart('private', { paths, modules, execPath: '/app/Electron', env, packaged: false, unitStart: () => {} });
    const budgets = { 'session.takeOver': 40_000 };
    const specs = daemonHostSpecs(paths, start, modules, env, budgets);
    expect(specs.machine!.requestBudgetsMs).toEqual(budgets);
    expect(specs['engine-host']!.requestBudgetsMs).toBeUndefined();
    expect(specs['pty-host']!.requestBudgetsMs).toBeUndefined();
  });

  // P5 O16 M3c fix wave 2 (D63; concern 1): the engine host's transport alone holds its start budget while `mawsd`
  // reports its engine host draining (engine-handover.ts), so the relay's held hello stops nothing and fails nothing
  it('give the engine host’s transport alone the handover wait', () => {
    const start = daemonStart('private', { paths, modules, execPath: '/app/Electron', env, packaged: false, unitStart: () => {} });
    const handingOverAt = () => Date.now();
    const specs = daemonHostSpecs(paths, start, modules, env, undefined, handingOverAt);
    expect(specs['engine-host']!.detached!.handingOverAt).toBe(handingOverAt);
    expect(specs['pty-host']!.detached!.handingOverAt).toBeUndefined();
    expect(specs.machine!.detached!.handingOverAt).toBeUndefined();
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
