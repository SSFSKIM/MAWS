// The app on the daemon shape (P5 O2 M7; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7): which shape this launch
// runs, what has to happen to the default profile's unit before the hosts start, how main reaches `mawsd`, and the check
// of the daemon's build. No Electron here: index.ts brings the app's facts.
//
// The shape, read once per launch (mode.ts gives the mode; Settings' switch changes nothing in a running launch):
// - another profile than the default one (a dev run, an e2e run) gets a private `mawsd`, which the app starts;
// - the default profile (its real path is the platform default): a packaged app installs or repairs the LaunchAgent so it
//   runs this bundle, before the hosts start; an unpackaged run uses an installed and loaded unit and never writes one,
//   and otherwise runs embedded for the launch, saying why (the log, Diagnostics). A unit the system refuses (MAWS turned
//   off in Login Items) also runs embedded, with the reason. `mawsd`'s canonical label refuses an unpackaged program
//   before it writes anything (M6), so an unpackaged run never asks;
// - the embedded shape on the default profile of a packaged app uninstalls a LaunchAgent it finds before the hosts
//   start (which ends `mawsd`, whose hosts keep running), then ends the socket-mode pty host, whose terminals end as an
//   embedded app's do at its quit, and connects to the engine host directly, with its sessions.
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
import { setTimeout as sleep } from 'node:timers/promises';
import { daemonHostFiles, daemonPaths, type DaemonPaths, type DaemonSocket } from '@shared/daemon/files';
import { START_TIMEOUT_MS, supervisorEnv, type DetachedTransportOptions, type StartStrategy } from '@shared/host/detached-transport';
import type { HostOwner, HostSpec, HostSupervisor } from '@shared/host/host-supervisor';
import { appIdentity } from '@shared/host/identity';
import type { DaemonStatus } from '@shared/ipc/schema/daemon';
import type { SupervisorShape } from '@shared/ipc/schema/settings';
import { installDaemon, isDefaultProfile, uninstallDaemon, unitFor, type InstallDeps } from '../../mawsd/install';
import { DEFAULT_LABEL, readIfPresent, UnitError, type Unit, type UnitProgram, type UnitState } from '../../mawsd/units/unit';
import { isAlive, isSameProcess, procStartOf, readLock } from '../../engine-host/supervisor-files';
import { PTY_HOST_FILES } from '../../pty-host/files';
import { hostModeFromEnv, type HostMode } from './mode';

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
  uninstall(): Promise<unknown>;
  endPtyHost(): Promise<void>; // the socket-mode pty host of the profile, if one runs
  log(line: string): void;
}

// The unit work the plan names, before any host exists; synchronous when there is none (every profile but the default
// one), so a scratch profile's launch starts as it always has.
export function prepareShape(plan: ShapePlan, deps: PrepareDeps): LaunchShape | Promise<LaunchShape> {
  if (plan.mode === 'daemon') {
    if (plan.daemon === 'private' || !plan.install) return settled({ mode: 'daemon', daemon: plan.daemon, unavailable: null }, deps);
    return deps.install().then(
      () => settled({ mode: 'daemon', daemon: 'unit', unavailable: null }, deps),
      (error: unknown) => settled({ mode: 'detached', daemon: null, unavailable: UNAVAILABLE.refused(messageOf(error)) }, deps),
    );
  }
  const embedded: LaunchShape = { mode: plan.mode, daemon: null, unavailable: plan.unavailable };
  if (!plan.uninstall) return settled(embedded, deps);
  deps.log('[hosts] the embedded shape: uninstalling the LaunchAgent before the hosts start');
  return deps
    .uninstall()
    .catch((error: unknown) => deps.log(`[hosts] the LaunchAgent could not be uninstalled: ${messageOf(error)}`))
    .then(() => deps.endPtyHost())
    .then(() => settled(embedded, deps));
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
  endPtyHost?(dir: string): Promise<void>; // endSocketPtyHost unless a test brings its own
  log(line: string): void;
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

// The mode table (mode.ts, then planShape) over the launch's facts, and the plan's unit work, before any host exists.
export function resolveLaunch(input: LaunchInput, deps: LaunchDeps): LaunchShape | Promise<LaunchShape> {
  const mode = hostModeFromEnv(input.env, input.shape);
  const defaultProfile = isDefaultProfile(input.profileDir, deps.platform, deps.env, deps.home);
  const unit = defaultProfile ? defaultUnit(deps) : null;
  const plan = planShape({ mode, shape: input.shape, packaged: input.packaged, defaultProfile, unit: unit?.state() ?? { installed: false, loaded: false } });
  const target = { profileDir: input.profileDir, label: DEFAULT_LABEL };
  return prepareShape(plan, {
    install: () => installDaemon({ ...target, program: input.program }, deps),
    uninstall: () => uninstallDaemon(target, deps),
    endPtyHost: () => (deps.endPtyHost ?? endSocketPtyHost)(daemonPaths(input.profileDir).ptyHost),
    log: deps.log,
  });
}

// Whether the default profile's unit runs this bundle: its file is the one this app would write.
export function unitRunsThisApp(input: Pick<LaunchInput, 'profileDir' | 'program'>, deps: InstallDeps): boolean {
  const unit = defaultUnit(deps);
  return unit !== null && readIfPresent(unit.file) === unit.render({ label: DEFAULT_LABEL, profileDir: input.profileDir, program: input.program });
}

// ---- the socket-mode pty host, ended when the profile leaves the daemon shape -------------------------------------------

export const PTY_HOST_END_MS = 5_000; // its kill ladders end every pty; past this the app starts without waiting longer

export interface EndPtyHostDeps {
  readLock: typeof readLock;
  isAlive(pid: number): boolean;
  procStartOf(pid: number): string | null;
  kill(pid: number, signal: NodeJS.Signals): void;
  sleep(ms: number): Promise<unknown>;
  log(line: string): void;
}

const END_POLL_MS = 100;

// SIGTERM to the pty host its lock names, when that is still the process it records (a pid is believed only with its
// start time), then a bounded wait for it to go: its exit order ends every pty through the kill ladder.
export async function endSocketPtyHost(dir: string, deps: EndPtyHostDeps = { readLock, isAlive, procStartOf, kill: (pid, signal) => process.kill(pid, signal), sleep, log: console.log }): Promise<void> {
  const lock = deps.readLock(dir, undefined, PTY_HOST_FILES.lock);
  if (!lock || !isSameProcess(lock, deps)) return;
  deps.log(`[hosts] ending the socket-mode pty host, pid ${lock.pid}, whose terminals end with it`);
  try {
    deps.kill(lock.pid, 'SIGTERM');
  } catch (error) {
    return deps.log(`[hosts] the pty host could not be signalled: ${messageOf(error)}`);
  }
  for (let waited = 0; waited < PTY_HOST_END_MS; waited += END_POLL_MS) {
    if (!isSameProcess(lock, deps)) return;
    await deps.sleep(END_POLL_MS);
  }
  deps.log(`[hosts] the pty host, pid ${lock.pid}, is still running ${PTY_HOST_END_MS / 1000} s after its SIGTERM; starting anyway`);
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
  const onReady = (owner: 'machine' | 'engine-host') =>
    deps.hosts.onState(owner, (state) => {
      if (state.state === 'ready' && !stopped) void read();
    });
  const offs = [onReady('machine'), onReady('engine-host')];
  return {
    status: () => current,
    stop() {
      stopped = true;
      for (const off of offs) off();
    },
  };
}
