// The app on the daemon shape (P5 O2 M7; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7): which shape this launch
// runs, what has to happen to the default profile's unit before the hosts start, how main reaches `mawsd`, and the check
// of the daemon's build. No Electron here: index.ts brings the app's facts.
//
// The shape, read once per launch (mode.ts gives the mode; Settings' switch changes nothing in a running launch):
// - another profile than the default one (a dev run, an e2e run) gets a private `mawsd`, which the app starts;
// - the default profile (its real path is the platform default): a packaged app installs or repairs the LaunchAgent so it
//   runs this bundle, before the hosts start; an unpackaged run uses an installed and loaded unit and never writes one,
//   and otherwise runs embedded for the launch, saying why (the log, Diagnostics). A unit the system refuses (MAWS turned
//   off in Login Items) also runs embedded, with the reason, and so does a loaded unit that does not start `mawsd`: the
//   unit is asked to start and `mawsd` must welcome a hello on its machine.sock within UNIT_READY_MS (a rejected
//   kickstart, a job whose program is gone, or a `mawsd` whose start fails after its lock never gets there). `mawsd`'s
//   canonical label refuses an unpackaged program before it writes anything (M6), so an unpackaged run never asks;
// - the embedded shape on the default profile of a packaged app uninstalls a LaunchAgent it finds before the hosts
//   start (which ends `mawsd`, whose hosts keep running);
// - an embedded launch of any profile that finds the daemon shape's processes named in its `mawsd/` directory leaves
//   the shape before its hosts start: it ends that profile's `mawsd` (its hosts keep running), then the socket-mode pty
//   host, whose terminals end as an embedded app's do at its quit, and connects to the engine host directly, with its
//   sessions. A launch that runs embedded only because the daemon was unavailable leaves them as they are.
//
// Main's hosts on the daemon shape are three detached transports over `mawsd`'s file set, one per relay socket
// (engine-host.sock, pty-host.sock, machine.sock). Each starts `mawsd` the profile's way (the lock arbitrates their race:
// a loser exits 3 and the transport connects), serves whatever build of the major answers (`serve`), is `relayed`, and
// waits for its welcome as long as the start budget, since `mawsd` holds a hello while it wakes a host (relay.ts).
// `daemon.*` is main-only: main reaches it through its `machine` host, never the router.
//
// The build check: at the `machine` host's first `ready` of a launch, main reads `daemon.status`; a daemon of another
// build than this app's out/main/mawsd.js that runs this app's files (a private daemon, or a unit whose program is this
// bundle) is asked `daemon.restart` once for the launch. Its hosts, and so the sessions, keep running.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DAEMON_FILES, daemonHostFiles, daemonPaths, type DaemonPaths, type DaemonSocket } from '@shared/daemon/files';
import { START_TIMEOUT_MS, supervisorEnv, type DetachedTransportOptions, type StartStrategy } from '@shared/host/detached-transport';
import type { HostOwner, HostSpec, HostSupervisor } from '@shared/host/host-supervisor';
import { appIdentity } from '@shared/host/identity';
import type { DaemonStatus } from '@shared/ipc/schema/daemon';
import type { SupervisorShape } from '@shared/ipc/schema/settings';
import { installDaemon, isDefaultProfile, uninstallDaemon, unitFor, type InstallDeps } from '../../mawsd/install';
import { HELLO_TIMEOUT_MS, reachMachine } from '../../mawsd/machine-client';
import { DEFAULT_LABEL, readIfPresent, UnitError, type Unit, type UnitProgram, type UnitState } from '../../mawsd/units/unit';
import { isAlive, isSameProcess, procStartOf, readLock } from '../../engine-host/supervisor-files';
import { PTY_HOST_FILES } from '../../pty-host/files';
import { hostModeFromEnv, testLaunchRefusal, type HostMode } from './mode';

// ---- the shape ---------------------------------------------------------------------------------------------------------

export interface ShapeFacts {
  mode: HostMode; // hostModeFromEnv's
  shape: SupervisorShape; // the setting
  packaged: boolean;
  defaultProfile: boolean; // the profile's real path is the platform default
  unit: UnitState; // the default profile's unit (read only for the default profile; else nothing installed)
}

export type ShapePlan =
  | { mode: 'daemon'; daemon: 'private' }
  | { mode: 'daemon'; daemon: 'unit'; install: boolean } // install: written or repaired to run this bundle, then loaded
  | { mode: 'utility' | 'detached'; uninstall: boolean; unavailable: string | null };

export const UNAVAILABLE = {
  noUnit: 'no LaunchAgent is installed for the default profile, and a development build never installs one',
  notLoaded: 'the LaunchAgent is installed but not loaded (MAWS may be turned off in Login Items)',
  refused: (why: string) => `the LaunchAgent could not be installed: ${why}`,
  notStarted: (why: string) => `the LaunchAgent did not start mawsd: ${why}`,
} as const;

export function planShape({ mode, shape, packaged, defaultProfile, unit }: ShapeFacts): ShapePlan {
  if (mode !== 'daemon') return { mode, uninstall: shape === 'embedded' && packaged && defaultProfile && (unit.installed || unit.loaded), unavailable: null };
  if (!defaultProfile) return { mode, daemon: 'private' };
  if (packaged) return { mode, daemon: 'unit', install: true };
  if (unit.installed && unit.loaded) return { mode, daemon: 'unit', install: false };
  return { mode: 'detached', uninstall: false, unavailable: unit.installed ? UNAVAILABLE.notLoaded : UNAVAILABLE.noUnit };
}

// What a launch runs, once its unit work is done.
export interface LaunchShape {
  mode: HostMode;
  daemon: 'unit' | 'private' | null; // how `mawsd` is started; null off the daemon shape
  unavailable: string | null; // why the daemon shape the setting asks for does not run this launch
}

export interface PrepareDeps {
  install(): Promise<unknown>; // the default profile's unit, written or repaired to run this bundle, and loaded
  startUnit(): Promise<unknown>; // the unit asked to start, and its `mawsd` up; rejects saying why not
  uninstall(): Promise<unknown>;
  daemonLeft(): boolean; // the profile's `mawsd/` directory has a lock of `mawsd` or of a socket-mode pty host
  leaveDaemon(): Promise<void>; // the profile's `mawsd`, then its socket-mode pty host, ended where they run
  log(line: string): void;
}

// The unit work the plan names, before any host exists; synchronous when there is none (every profile but the default
// one, with no daemon-shape locks), so a scratch profile's launch starts as it always has.
export function prepareShape(plan: ShapePlan, deps: PrepareDeps): LaunchShape | Promise<LaunchShape> {
  if (plan.mode === 'daemon') {
    if (plan.daemon === 'private') return settled({ mode: 'daemon', daemon: 'private', unavailable: null }, deps);
    const embedded = (why: string) => settled({ mode: 'detached', daemon: null, unavailable: why }, deps);
    const start = () =>
      deps.startUnit().then(
        () => settled({ mode: 'daemon', daemon: 'unit', unavailable: null }, deps),
        (error: unknown) => embedded(UNAVAILABLE.notStarted(messageOf(error))),
      );
    if (!plan.install) return start();
    return deps.install().then(start, (error: unknown) => embedded(UNAVAILABLE.refused(messageOf(error))));
  }
  const embedded: LaunchShape = { mode: plan.mode, daemon: null, unavailable: plan.unavailable };
  // the daemon shape left by choice (the setting, the environment), not a launch the daemon was unavailable to
  if (!plan.uninstall && !(plan.unavailable === null && deps.daemonLeft())) return settled(embedded, deps);
  let uninstalled: Promise<unknown> = Promise.resolve();
  if (plan.uninstall) {
    deps.log('[hosts] the embedded shape: uninstalling the LaunchAgent before the hosts start');
    uninstalled = deps.uninstall().catch((error: unknown) => deps.log(`[hosts] the LaunchAgent could not be uninstalled: ${messageOf(error)}`));
  }
  return uninstalled.then(() => deps.leaveDaemon()).then(() => settled(embedded, deps));
}

function settled(launch: LaunchShape, deps: PrepareDeps): LaunchShape {
  if (launch.unavailable !== null) deps.log(`[hosts] the daemon shape does not run this launch: ${launch.unavailable}; running embedded`);
  else if (launch.daemon !== null) deps.log(`[hosts] the daemon shape: ${launch.daemon === 'unit' ? "the default profile's LaunchAgent" : 'a private mawsd'}`);
  return launch;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// ---- the launch: the facts read, the plan made, the unit work done -------------------------------------------------------

export interface LaunchInput {
  env: NodeJS.ProcessEnv;
  shape: SupervisorShape; // the setting, read once before the hosts start
  packaged: boolean;
  profileDir: string; // Electron's userData
  program: UnitProgram; // this app as a unit would run it: its binary as Node and its out/main/mawsd.js
}

export interface LaunchDeps extends InstallDeps {
  leaveDaemon?(paths: DaemonPaths): Promise<void>; // leaveDaemonShape unless a test brings its own
  awaitDaemon?(paths: DaemonPaths): Promise<void>; // awaitDaemonWelcome unless a test brings its own
  log(line: string): void;
  exit(code: number, line: string): never; // the process ends, saying why on its last line (testLaunchRefusal)
}

// The default profile's unit, or none where there is no unit manager (the app runs on a Mac; a test may run on Linux).
function defaultUnit(deps: InstallDeps): Unit | null {
  try {
    return unitFor(DEFAULT_LABEL, deps);
  } catch (error) {
    if (error instanceof UnitError) return null;
    throw error;
  }
}

// The mode table (mode.ts, then planShape) over the launch's facts, and the plan's unit work, before any host exists. A
// test or harness launch on the default profile exits first, before the unit is read (testLaunchRefusal).
export function resolveLaunch(input: LaunchInput, deps: LaunchDeps): LaunchShape | Promise<LaunchShape> {
  const defaultProfile = isDefaultProfile(input.profileDir, deps.platform, deps.env, deps.home);
  const refusal = testLaunchRefusal(input.env, defaultProfile);
  if (refusal !== null) deps.exit(1, refusal);
  const mode = hostModeFromEnv(input.env, input.shape);
  const unit = defaultProfile ? defaultUnit(deps) : null;
  const plan = planShape({ mode, shape: input.shape, packaged: input.packaged, defaultProfile, unit: unit?.state() ?? { installed: false, loaded: false } });
  const target = { profileDir: input.profileDir, label: DEFAULT_LABEL };
  const paths = daemonPaths(input.profileDir);
  return prepareShape(plan, {
    install: () => installDaemon({ ...target, program: input.program }, deps),
    startUnit: async () => {
      unit!.start(); // throws launchctl's answer when the system will not start the job
      await (deps.awaitDaemon ?? ((p) => awaitDaemonWelcome(p, { reach: reachMachine, now: Date.now, sleep: deps.sleep })))(paths);
    },
    uninstall: () => uninstallDaemon(target, deps),
    daemonLeft: () => existsSync(join(paths.dir, DAEMON_FILES.lock)) || existsSync(join(paths.ptyHost, PTY_HOST_FILES.lock)),
    leaveDaemon: () => (deps.leaveDaemon ?? leaveDaemonShape)(paths),
    log: deps.log,
  });
}

// ---- the unit's daemon, up ----------------------------------------------------------------------------------------------

export const UNIT_READY_MS = 10_000; // from the kickstart: a started job's `mawsd` listens within a second or two; past this it is not starting
const READY_POLL_MS = 100;
// The hello's `build`, which machine.sock only logs: it names the probe in `mawsd`'s log rather than a build to compare.
const READY_PROBE_BUILD = 'main-ready-probe';

export interface AwaitDaemonDeps {
  reach: typeof reachMachine;
  now(): number;
  sleep(ms: number): Promise<unknown>;
}

// `mawsd` up is an authenticated welcome on its own machine.sock within `budgetMs`; rejects past it, and at once when a
// `mawsd` refuses the hello. Its lock alone is not: `mawsd` takes it before it writes its token, reads its identity and
// listens, and a start that fails past it releases the lock and exits. machine.sock is `mawsd`'s, not relayed, so the
// welcome is immediate; the probe closes with no request (`daemon.status` would wake the engine host).
export async function awaitDaemonWelcome(paths: DaemonPaths, deps: AwaitDaemonDeps, budgetMs = UNIT_READY_MS): Promise<void> {
  const until = deps.now() + budgetMs;
  let why = 'nothing answered';
  for (;;) {
    const left = until - deps.now();
    if (left <= 0) throw new Error(`no mawsd welcomed a hello on machine.sock within ${budgetMs / 1000} s of the unit's start (last: ${why})`);
    const reached = await deps.reach(paths, { build: READY_PROBE_BUILD, helloTimeoutMs: Math.min(HELLO_TIMEOUT_MS, left) });
    if (reached.ok) return reached.link.close();
    if (reached.state === 'incompatible') throw new Error(reached.why);
    why = reached.why; // down, or a path not yet private (a socket between its listen and its chmod): asked again
    await deps.sleep(Math.min(READY_POLL_MS, Math.max(0, until - deps.now())));
  }
}

// Whether the default profile's unit runs this bundle: its file is the one this app would write.
export function unitRunsThisApp(input: Pick<LaunchInput, 'profileDir' | 'program'>, deps: InstallDeps): boolean {
  const unit = defaultUnit(deps);
  return unit !== null && readIfPresent(unit.file) === unit.render({ label: DEFAULT_LABEL, profileDir: input.profileDir, program: input.program });
}

// ---- the daemon shape's processes, ended when the profile leaves it -----------------------------------------------------

export const PTY_HOST_END_MS = 5_000; // its kill ladders end every pty; past this the app starts without waiting longer
export const DAEMON_END_MS = 5_000; // its endpoint's stop is bounded at 2.5 s (M5); past this the app starts anyway

// The profile's `mawsd` first, so it wakes no pty host again (its hosts keep running, the engine host's sessions with
// them), then its socket-mode pty host, whose terminals end with it.
export async function leaveDaemonShape(paths: DaemonPaths, deps: EndPtyHostDeps = DEFAULT_END_DEPS): Promise<void> {
  await endLockHolder(paths.dir, DAEMON_FILES.lock, 'mawsd', DAEMON_END_MS, deps);
  await endSocketPtyHost(paths.ptyHost, deps);
}

export interface EndPtyHostDeps {
  readLock: typeof readLock;
  isAlive(pid: number): boolean;
  procStartOf(pid: number): string | null;
  kill(pid: number, signal: NodeJS.Signals): void;
  sleep(ms: number): Promise<unknown>;
  log(line: string): void;
}

const END_POLL_MS = 100;

const DEFAULT_END_DEPS: EndPtyHostDeps = { readLock, isAlive, procStartOf, kill: (pid, signal) => process.kill(pid, signal), sleep, log: console.log };

// The socket-mode pty host: its exit order ends every pty through the kill ladder.
export function endSocketPtyHost(dir: string, deps: EndPtyHostDeps = DEFAULT_END_DEPS): Promise<void> {
  return endLockHolder(dir, PTY_HOST_FILES.lock, 'the socket-mode pty host', PTY_HOST_END_MS, deps);
}

// SIGTERM to the process a lock names, when that is still the process it records (a pid is believed only with its start
// time), then a wait of at most `boundMs` for it to go.
async function endLockHolder(dir: string, lockName: string, what: string, boundMs: number, deps: EndPtyHostDeps): Promise<void> {
  const lock = deps.readLock(dir, undefined, lockName);
  if (!lock || !isSameProcess(lock, deps)) return;
  deps.log(`[hosts] ending ${what}, pid ${lock.pid}, as the profile leaves the daemon shape`);
  try {
    deps.kill(lock.pid, 'SIGTERM');
  } catch (error) {
    return deps.log(`[hosts] ${what} could not be signalled: ${messageOf(error)}`);
  }
  for (let waited = 0; waited < boundMs; waited += END_POLL_MS) {
    if (!isSameProcess(lock, deps)) return;
    await deps.sleep(END_POLL_MS);
  }
  deps.log(`[hosts] ${what}, pid ${lock.pid}, is still running ${boundMs / 1000} s after its SIGTERM; starting anyway`);
}

// ---- main's hosts on the daemon shape ----------------------------------------------------------------------------------

export interface DaemonModules {
  engineHost: string; // the bundles `?modulePath` gives main
  ptyHost: string;
  mawsd: string; // out/main/mawsd.js, beside main's own entry
}

export interface StartFacts {
  paths: DaemonPaths;
  modules: DaemonModules;
  execPath: string; // the Electron binary, run as Node
  env: NodeJS.ProcessEnv; // main's, at the spawn
  packaged: boolean;
  unitStart(): void; // the default profile's unit asked to start (launchctl kickstart); throws when it cannot be
}

// How each of main's three transports starts `mawsd` when none answers: the unit, or a private daemon spawned as the
// supervisor is (the Electron binary as Node, `--disable-sigusr1`, in a session of its own), its environment built as
// the supervisor's (supervisorEnv: the e2e seams pass through), argv0 `mawsd`, its directory in argv.
export function daemonStart(daemon: 'unit' | 'private', facts: StartFacts): StartStrategy {
  if (daemon === 'unit') return { kind: 'unit', start: async () => facts.unitStart() };
  return {
    kind: 'spawn',
    command: facts.execPath,
    args: ['--disable-sigusr1', facts.modules.mawsd, 'run', '--private', '--dir', facts.paths.dir],
    env: supervisorEnv(facts.env, { userData: facts.paths.profileDir, packaged: facts.packaged }),
    argv0: 'mawsd',
  };
}

const SERVICE: Record<DaemonSocket, string> = { 'engine-host': 'maws-engine-host', 'pty-host': 'maws-pty-host', machine: 'mawsd' };

// The three hosts, each over its own relay socket. Every hello presents this build with no e2e seam (the identity's
// `utility` mode): the seams are `mawsd`'s to apply to the engine host it reaches (they pass through in its
// environment), and a hello a relay refuses on a seam would never reach the host at all.
export function daemonHostSpecs(paths: DaemonPaths, start: StartStrategy, modules: DaemonModules, env: NodeJS.ProcessEnv): Partial<Record<HostOwner, HostSpec>> {
  const spec = (socket: DaemonSocket, modulePath: string): HostSpec => {
    const detached: Partial<Omit<DetachedTransportOptions, 'modulePath'>> = {
      files: daemonHostFiles(paths, socket),
      start,
      buildPolicy: 'serve',
      relayed: true,
      timing: { helloTimeoutMs: START_TIMEOUT_MS },
      identity: appIdentity(modulePath, env, 'utility'),
    };
    return { modulePath, serviceName: SERVICE[socket], transport: 'detached', detached };
  };
  return { 'engine-host': spec('engine-host', modules.engineHost), 'pty-host': spec('pty-host', modules.ptyHost), machine: spec('machine', modules.mawsd) };
}

// ---- the daemon's status and the build check ---------------------------------------------------------------------------

export interface DaemonWatchDeps {
  hosts: Pick<HostSupervisor, 'onState' | 'dispatch' | 'expectExit'>;
  buildId: string; // this app's out/main/mawsd.js
  unitRunsThisApp(): boolean; // the default profile's unit runs this bundle (its file is what this app would write)
  onChange(status: DaemonStatus | null): void;
  log(line: string): void;
}

export interface DaemonWatch {
  status(): DaemonStatus | null;
  refresh(): void; // P5 O3-D M5b: read it again now (the spine's state changes at no host transition); none until ready
  stop(): void;
}

// `daemon.status`, read at each `ready` of the `machine` host and of the engine host (a new engine host, its pid, its
// build), never while the engine host is leaving: the read wakes a parked engine host (M5), and a quit's stop-all parks
// it. The first read of the launch decides the build check.
export function watchDaemon(deps: DaemonWatchDeps): DaemonWatch {
  let current: DaemonStatus | null = null;
  let checked = false;
  let stopped = false;
  const read = async () => {
    const answer = await deps.hosts.dispatch('machine', 'daemon.status', undefined);
    if (stopped) return;
    if (!answer.ok) return deps.log(`[hosts] daemon.status: ${answer.error.code} ${answer.error.message}`);
    current = answer.value as DaemonStatus;
    deps.onChange(current);
    if (checked) return;
    checked = true;
    await checkBuild(current);
  };
  const checkBuild = async (status: DaemonStatus) => {
    if (status.build.buildId === deps.buildId) return;
    const theirs = `mawsd pid ${status.pid} runs build ${status.build.buildId}, this app's is ${deps.buildId}`;
    if (status.kind === 'unit' && !deps.unitRunsThisApp()) return deps.log(`[hosts] ${theirs}; its unit runs another bundle, so it is left as it is`);
    deps.log(`[hosts] ${theirs}; asking it to restart (its hosts keep running)`);
    deps.hosts.expectExit('machine'); // its close is asked for, not a crash
    const answer = await deps.hosts.dispatch('machine', 'daemon.restart', undefined);
    if (!answer.ok) deps.log(`[hosts] daemon.restart: ${answer.error.code} ${answer.error.message}`);
  };
  let machineReady = false;
  const onReady = (owner: 'machine' | 'engine-host') =>
    deps.hosts.onState(owner, (state) => {
      if (owner === 'machine') machineReady = state.state === 'ready';
      if (state.state === 'ready' && !stopped) void read();
    });
  const offs = [onReady('machine'), onReady('engine-host')];
  return {
    status: () => current,
    refresh: () => void (machineReady && !stopped && read()),
    stop() {
      stopped = true;
      for (const off of offs) off();
    },
  };
}
