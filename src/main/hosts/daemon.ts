// The app's one arrangement (P5 O2 M7, docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7; P5 O15 M2,
// docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, Interfaces §A): the launch's outcome, which is `mawsd` or a
// reason it cannot start, how main reaches `mawsd`, and the check of the daemon's build. No Electron here: index.ts
// brings the app's facts.
//
// The outcome, read at each attempt (the repair window's retry runs the table again from the top):
// - a profile that is not the main one (a dev run, an e2e run) gets a private `mawsd`, which the app's transports start;
//   nothing is started here (MAWS_E2E_UNIT_FAULT, an unpackaged e2e launch's, stands a failure in for it: §C);
// - the main profile (its real path is the platform default): a packaged app installs or repairs the LaunchAgent so it
//   runs this bundle, asks it to start, and waits for `mawsd`'s welcome on its machine.sock within UNIT_READY_MS; an
//   unpackaged run uses an installed and loaded unit the same way and never writes one. Anything else is a failure,
//   classified so the repair window can say why (`UnavailableKind`). The main profile's machine runs under its unit or
//   not at all: no launch composes the machine's services in main.
//
// Main's hosts are three detached transports over `mawsd`'s file set, one per relay socket (engine-host.sock,
// pty-host.sock, machine.sock). Each starts `mawsd` the profile's way (the lock arbitrates their race: a loser exits 3
// and the transport connects), serves whatever build of the major answers (`serve`), is `relayed`, and waits for its
// welcome as long as the start budget, since `mawsd` holds a hello while it wakes a host (relay.ts). `daemon.*` is
// main-only: main reaches it through its `machine` host, never the router.
//
// The build check: at the `machine` host's first `ready` of a launch, main reads `daemon.status`; a daemon of another
// build than this app's out/main/mawsd.js that runs this app's files (a private daemon, or a unit whose program is this
// bundle) is asked `daemon.restart` once for the launch. Its hosts, and so the sessions, keep running.
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { DAEMON_FILES, daemonHostFiles, daemonPaths, type DaemonPaths, type DaemonSocket } from '@shared/daemon/files';
import { START_TIMEOUT_MS, supervisorEnv, type DetachedTransportOptions, type StartStrategy } from '@shared/host/detached-transport';
import type { HostOwner, HostSpec, HostSupervisor } from '@shared/host/host-supervisor';
import { appIdentity } from '@shared/host/identity';
import type { DaemonStatus } from '@shared/ipc/schema/daemon';
import { installDaemon, isDefaultProfile, unitFor, type InstallDeps } from '../../mawsd/install';
import { HELLO_TIMEOUT_MS, reachMachine } from '../../mawsd/machine-client';
import { DEFAULT_LABEL, readIfPresent, UnitError, type Unit, type UnitProgram } from '../../mawsd/units/unit';
import { isAlive, isSameProcess, procStartOf, readLock } from '../../engine-host/supervisor-files';
import { testLaunchRefusal } from './mode';

// ---- the launch's outcome ----------------------------------------------------------------------------------------------

export type LaunchShape = { daemon: 'unit' | 'private' };
export type UnavailableKind = 'no-unit' | 'not-loaded' | 'install-refused' | 'not-started';
export interface Unavailable {
  kind: UnavailableKind;
  why: string; // the system's or mawsd's own words, one line
}
export type LaunchOutcome = { ok: true; launch: LaunchShape } | { ok: false; unavailable: Unavailable };

export const UNAVAILABLE_KINDS: readonly UnavailableKind[] = ['no-unit', 'not-loaded', 'install-refused', 'not-started'];

export const UNAVAILABLE_WHY = {
  noUnit: 'no LaunchAgent is installed for the main profile, and a development build never installs one',
  notLoaded: 'the LaunchAgent is installed but not loaded',
  loadedNotRun: 'macOS loaded mawsd but did not run it', // §A (iii)
  e2eFault: 'e2e fault', // §C
} as const;

export interface LaunchInput {
  env: NodeJS.ProcessEnv;
  packaged: boolean;
  profileDir: string; // Electron's userData
  program: UnitProgram; // this app as a unit would run it: its binary as Node and its out/main/mawsd.js
}

export interface LaunchDeps extends InstallDeps {
  awaitDaemon?(paths: DaemonPaths): Promise<void>; // awaitDaemonWelcome unless a test brings its own
  log(line: string): void;
  exit(code: number, line: string): never; // the process ends, saying why on its last line (testLaunchRefusal)
}

// The default profile's unit, or none where there is no unit manager (the app runs on a Mac; a test may run on Linux).
function defaultUnit(deps: InstallDeps): Unit | { none: string } {
  try {
    return unitFor(DEFAULT_LABEL, deps);
  } catch (error) {
    if (error instanceof UnitError) return { none: error.message };
    throw error;
  }
}

// §A's table over the launch's facts, before any host exists, and never a throw or a rejection: a refused install or
// start is a failure with launchctl's words, and any other error on the main profile's way (fix wave 1: a unit whose
// state cannot be read, a plist path that is a directory or unreadable) is `install-refused` with the error's own words,
// so the repair window, all the owner sees of a launch that fails, always opens. A test or harness launch on the main
// profile exits first, before the unit is read (testLaunchRefusal). Synchronous where nothing is started (every profile
// but the main one), so a scratch profile's launch starts as it always has.
export function resolveLaunch(input: LaunchInput, deps: LaunchDeps): LaunchOutcome | Promise<LaunchOutcome> {
  const mainProfile = isDefaultProfile(input.profileDir, deps.platform, deps.env, deps.home);
  const refusal = testLaunchRefusal(input.env, mainProfile);
  if (refusal !== null) deps.exit(1, refusal);
  if (!mainProfile) return told(e2eFault(input) ?? { ok: true, launch: { daemon: 'private' } }, deps);
  try {
    const launch = resolveMainLaunch(input, deps);
    return launch instanceof Promise ? launch.catch((error: unknown) => launchFailed(error, deps)) : launch;
  } catch (error) {
    return launchFailed(error, deps);
  }
}

// An error nothing on the launch's way classified: `install-refused`, its own words on one line, told as every outcome is
export function launchFailed(error: unknown, deps: Pick<LaunchDeps, 'log'>): LaunchOutcome {
  return told(failed('install-refused', messageOf(error)), deps);
}

function resolveMainLaunch(input: LaunchInput, deps: LaunchDeps): LaunchOutcome | Promise<LaunchOutcome> {
  const unit = defaultUnit(deps);
  if ('none' in unit) return told(failed('no-unit', unit.none), deps);
  const paths = daemonPaths(input.profileDir);
  const awaitDaemon = deps.awaitDaemon ?? ((p: DaemonPaths) => awaitDaemonWelcome(p, { reach: reachMachine, now: Date.now, sleep: deps.sleep }));
  if (input.packaged) return startPackaged(unit, input, paths, awaitDaemon, deps).then((outcome) => told(outcome, deps));
  const state = unit.state();
  if (!state.installed) return told(failed('no-unit', UNAVAILABLE_WHY.noUnit), deps);
  if (!state.loaded) return told(failed('not-loaded', UNAVAILABLE_WHY.notLoaded), deps);
  // an unpackaged run never writes the unit; a start it is refused, or one that never welcomes, is `not-started`
  return (async (): Promise<LaunchOutcome> => {
    try {
      unit.start();
      await awaitDaemon(paths);
      return { ok: true, launch: { daemon: 'unit' } };
    } catch (error) {
      return failed('not-started', messageOf(error));
    }
  })().then((outcome) => told(outcome, deps));
}

// A packaged app's start (§A, "A start that does not end in a welcome"): the unit installed or repaired, then started,
// then welcomed. (i) a refused install and (ii) a refused start are `install-refused` with launchctl's words; a start
// that reported success and was not welcomed is (iii) `install-refused` when `mawsd` wrote nothing since the attempt
// began and no live process holds its lock (macOS never ran it), else (iv) `not-started` with the wait's last answer.
async function startPackaged(unit: Unit, input: LaunchInput, paths: DaemonPaths, awaitDaemon: (paths: DaemonPaths) => Promise<void>, deps: LaunchDeps): Promise<LaunchOutcome> {
  const before = daemonWrites(paths); // at the attempt's start, so a `mawsd` the repair's bootstrap ran counts as written
  try {
    await installDaemon({ profileDir: input.profileDir, label: DEFAULT_LABEL, program: input.program }, deps);
  } catch (error) {
    return failed('install-refused', messageOf(error)); // (i)
  }
  try {
    unit.start(); // throws launchctl's answer when the system will not start the job
  } catch (error) {
    return failed('install-refused', messageOf(error)); // (ii)
  }
  try {
    await awaitDaemon(paths);
    return { ok: true, launch: { daemon: 'unit' } };
  } catch (error) {
    const wrote = daemonWrites(paths) !== before;
    if (!wrote && !lockHeldByLiveProcess(paths)) return failed('install-refused', UNAVAILABLE_WHY.loadedNotRun); // (iii)
    return failed('not-started', messageOf(error)); // (iv)
  }
}

// Whether `mawsd` wrote, read with no clock: the size and the inode of mawsd.log and of mawsd.out (the unit's standard
// output and error), a missing file a value of its own. A `mawsd` that starts writes its `starting` line to mawsd.log
// before it takes its lock, and what it prints before that goes to mawsd.out; a rotation is a new inode.
export function daemonWrites(paths: DaemonPaths): string {
  return [DAEMON_FILES.log, DAEMON_FILES.out]
    .map((name) => {
      try {
        const stat = statSync(join(paths.dir, name));
        return `${stat.size}:${stat.ino}`;
      } catch {
        return 'missing';
      }
    })
    .join(' ');
}

// A live process holds mawsd.lock, read as main reads every lock: a `mawsd` already running and silent (iv), not a job
// macOS never ran (iii). Fix wave 5: the process the lock names, not merely its pid (isSameProcess): a pid reused by
// another process after an unclean exit or a reboot holds nothing, and a lock with no recorded start is taken at its pid.
function lockHeldByLiveProcess(paths: DaemonPaths): boolean {
  const lock = readLock(paths.dir, undefined, DAEMON_FILES.lock);
  return lock !== null && isSameProcess(lock, { isAlive, procStartOf });
}

// §C: MAWS_E2E_UNIT_FAULT=<absolute path>, honoured only under MAWS_E2E=1 in an unpackaged app on a profile that is not
// the main one: while the file holds one of the four kinds, the launch fails with it; otherwise the row's own outcome
function e2eFault({ env, packaged }: LaunchInput): LaunchOutcome | null {
  const file = env.MAWS_E2E_UNIT_FAULT;
  if (packaged || env.MAWS_E2E !== '1' || !file || !isAbsolute(file)) return null;
  let kind: string;
  try {
    kind = readFileSync(file, 'utf8').trim();
  } catch {
    return null; // absent: the row's own outcome
  }
  return UNAVAILABLE_KINDS.includes(kind as UnavailableKind) ? failed(kind as UnavailableKind, UNAVAILABLE_WHY.e2eFault) : null;
}

const failed = (kind: UnavailableKind, why: string): LaunchOutcome => ({ ok: false, unavailable: { kind, why: oneLine(why) } });
const oneLine = (text: string) => text.replace(/\s*\n\s*/g, ' ').trim();

function told(outcome: LaunchOutcome, deps: Pick<LaunchDeps, 'log'>): LaunchOutcome {
  if (outcome.ok) deps.log(`[hosts] the machine daemon: ${outcome.launch.daemon === 'unit' ? "the main profile's LaunchAgent" : 'a private mawsd'}`);
  else deps.log(`[hosts] mawsd cannot start (${outcome.unavailable.kind}): ${outcome.unavailable.why}`);
  return outcome;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

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
  return !('none' in unit) && readIfPresent(unit.file) === unit.render({ label: DEFAULT_LABEL, profileDir: input.profileDir, program: input.program });
}

// ---- main's hosts ----------------------------------------------------------------------------------

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
// `machineBudgetsMs`: the spine's commands that run past a request's default deadline, with their own (the services
// entry's COMMAND_BUDGETS_MS, which main's root hands over; the panel's sweep#3)
// `engineHandingOverAt` (P5 O16 M3c fix wave 2; D63): the engine host's transport runs its start budget whole from it,
// now while `mawsd`'s fresh report says its engine host drains for a handover (engine-handover.ts), during which the
// relay holds main's hello, and from the drain's end after it (fix wave 3)
export function daemonHostSpecs(paths: DaemonPaths, start: StartStrategy, modules: DaemonModules, env: NodeJS.ProcessEnv, machineBudgetsMs?: HostSpec['requestBudgetsMs'], engineHandingOverAt?: () => number | null): Partial<Record<HostOwner, HostSpec>> {
  const spec = (socket: DaemonSocket, modulePath: string): HostSpec => {
    const detached: Partial<Omit<DetachedTransportOptions, 'modulePath'>> = {
      files: daemonHostFiles(paths, socket),
      start,
      buildPolicy: 'serve',
      relayed: true,
      timing: { helloTimeoutMs: START_TIMEOUT_MS },
      identity: appIdentity(modulePath, env, 'utility'),
      ...(socket === 'engine-host' && engineHandingOverAt && { handingOverAt: engineHandingOverAt }),
    };
    return { modulePath, serviceName: SERVICE[socket], transport: 'detached', detached };
  };
  return { 'engine-host': spec('engine-host', modules.engineHost), 'pty-host': spec('pty-host', modules.ptyHost), machine: { ...spec('machine', modules.mawsd), ...(machineBudgetsMs && { requestBudgetsMs: machineBudgetsMs }) } };
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
