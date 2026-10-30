// `mawsd`, the machine daemon's composition root (P5 O2 M5; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M5). One
// host supervisor (@shared/host/host-supervisor) reaches two upstream hosts, both on demand: the engine host over the
// supervisor's own files under `<profile>/supervisor/` (one engine host per profile in either shape), ready only when the
// app says so (`readyBy: 'external'`), and the pty host over `<profile>/mawsd/pty-host/`, ready at its connect. A relay
// socket per host serves one app at a time (relay.ts), and `machine.sock` serves the `daemon` namespace to any number of
// clients. The interest union, the clocks (clocks.ts), the pty credit and the endpoint seam (endpoint-seam.ts) live here.
//
// Start, in order: (1) the directory, private (created 0700 when missing; a symlink, another owner or a wider mode
// stops the start, the refusal going to stderr, never into the refused directory); (2) the lock (held → exit 3 for a
// private daemon, 0 for a unit one, so launchd does not loop against a live holder); (3) the token and the machine ref
// (a malformed identity file stops the start, exit 1); (4) on macOS, the backup exclusion of `<profile>/mawsd/`; (5) the
// log (opened as soon as the directory passed, so (2) to (4) are logged), and `endpoint/` created or corrected to 0700;
// (6) the three sockets; (7) the endpoint module's start; (8) the adoption of hosts already running, with no spawn.
//
// Exit order: stop accepting; the endpoint's stop, awaited up to 2.5 s; close the client connections; leave both hosts
// running (`mawsd` never stops a session); remove the sockets and the lock if they are still ours; exit 0, 75 for a
// requested restart (the units restart on it), 1 on a fatal error.
//
// One upstream connection per app attachment, until O3: when an app is welcomed on engine-host.sock the engine-host link
// is recycled, and again when the app leaves, so the engine host sees one client per attachment exactly as with main
// today (its resync, its connect burst and undelivered tail, its client-gone hooks, its per-connection interest and its
// login-shell recapture). Between attachments `mawsd` holds a link that never says ready, for its own requests. The pty
// relay is not recycled; while no app holds `pty-host.sock`, `mawsd` owns the pty host's output credit.
//
// P5 O3-D M2 (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §A and §B): `machine.sock` is served by
// the services front (front.ts), and the spine runs here too, composed by the seam (spine-seam.ts) from the services
// chunk at its first trigger, never at start: refused by `spine.lock` while an app that composes its own holds it,
// released after the quiet period (the daemon's own idle time, or MAWS_SPINE_QUIET_MS under a measured scene), and
// loaded again at the next trigger; a unit daemon re-executes after a release (exit 75, its unit restarts it cold) only
// with the switch on (SPINE_REEXECUTE_DEFAULT, MAWS_SPINE_REEXECUTE=1; D38). The exit order stops its parts
// once their work settled, before the client connections close.
//
// P5 O3-D M3 (Interfaces §D; D4, D8, D30): the permanent client, built behind the option `permanentClient` (off in the
// product until M5, src/mawsd/index.ts). With it on, the hello to the engine host lists `host.attachment`, and to a host
// whose welcome lists it too the engine-host link is one connection for mawsd's life: said ready at its welcome, the
// loaded spine's resync running at its streaming (the seam's adapter, spine-hosts.ts; nothing while the spine is cold),
// never recycled at an app's attach or departure, each of which is told by `host.attachment` instead (the departure's
// drain ends at that request's answer, after every event the host wrote before it). To a host that lists it not, or with
// the option off, the recycle per attachment above stays, chosen again at each welcome. The endpoint seam's
// `onAttachment` says whether events are available: true from a permanent link's streaming on, whatever app comes and
// goes; an app's attachment otherwise.
//
// P5 O3-D M4 (Interfaces §B, §C, §E): each machine.sock client follows its sessions' streams with its own cursors on the
// front (front-streams.ts), every stream catching up at each streaming of the engine-host link (D41); the spine's
// client port asks the client whose request minted the asking ref, or the app attached on engine-host.sock for none
// (client-port.ts); the endpoint's `dispatch('machine', …)` is the front's table and its `onEvent` carries the spine's
// events with owner `machine`.
//
// P5 O3-D M5a (Interfaces §L; D10, D21, D44(3)): `mawsd`'s side of the cutover, built behind the option `claimSpine`,
// off in the product until M5b turns it on with `permanentClient`, `spine.wakeOnEvents` and the app's `machine.spine`
// (src/mawsd/index.ts), so nothing changes for an app of today. With it on, a hello on engine-host.sock that lists no
// `machine.spine` (an app that runs a spine of its own) is refused with `mawsd`'s own `refuse wire` line, waking no
// host, and its one exit asks nothing of the engine host; and when that app's pid holds no `spine.lock` (an app from
// before O3-A) the spine yields to it while it lives. The second signal, the profile's `SingletonLock` read at each load
// attempt, has its own switch (`singletonSignal`), on since its probe (e2e/spine-lock.spec.ts) showed macOS Electron
// writes the app's pid there. Whatever the option, an app whose hello lists `machine.spine` hears no event on its
// engine relay (its events come on machine.sock), and its relayed requests that the spine intercepts go through the
// spine's intercepts, as a machine.sock client's and the endpoint's do (front.ts). The spine's trash is `mawsd`'s own
// move into the user's trash directory (trash.ts), and a load logs `[spine] loaded in N ms`.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createServer, type Server } from 'node:net';
import { homedir, hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { daemonPaths, DAEMON_FILES, DAEMON_LOCK_BREAKER, type DaemonPaths } from '@shared/daemon/files';
import { createHostSupervisor, type HostSupervisor } from '@shared/host/host-supervisor';
import { supervisorEnv, type DetachedTransportOptions } from '@shared/host/detached-transport';
import type { RelayPort } from '@shared/host/doc-relay';
import { appIdentity } from '@shared/host/identity';
import { cuaSocketPath } from '@shared/browser/cua-socket';
import { idleCollector, type Collect } from '@shared/host/idle-collect';
import { makePrivateDirectory, clearSocketPath } from '@shared/host/private-listen';
import { PrivatePathError } from '@shared/host/private-path';
import { captureShellEnvironment } from '@shared/host/shell-env';
import { writeToken } from '@shared/host/socket-host';
import { CLOSE_GRACE_MS } from '@shared/host/socket-port';
import { ATTACHMENT_CAPABILITY, MACHINE_SPINE_CAPABILITY, PEER_CAPABILITIES, SOCKET_PROTOCOL, type DocumentsOpen, type ServerRefuse } from '@shared/host/socket-protocol';
import { serveSocketClients, type SocketClients, type SupervisorIdentity } from '@shared/host/socket-server';
import type { AppSessionId } from '@shared/graph/ids';
import { endableClientRef, type ClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import type { HostResponse } from '@shared/ipc/host-protocol';
import { MAX_IDLE_EXIT_MS } from '@shared/ipc/schema/host';
import type { DaemonHost, DaemonStatus } from '@shared/ipc/schema/daemon';
import type { CommandInput } from '@shared/ipc/schema';
import { WIRE_MINOR } from '@shared/ipc/wire';
import { wireFingerprint } from '@shared/ipc/wire-fingerprint';
import { machineEnrollment, machineName, machineProject } from '@shared/machine/identity';
import { readOrMintMachineRef } from '@shared/machine/identity-file';
import type { MachineRef } from '@shared/machine/ref';
import { readMachineRole, type MachineRole } from '../engine-host/role';
import { buildIdOf, isAlive, procStartOf, readLock, START_EXIT_HELD, takeLock } from '../engine-host/supervisor-files';
import { LOG_ROTATE_BYTES, openSupervisorLog } from '../engine-host/supervisor-log';
import { ptyHostFiles } from '../pty-host/files';
import { DaemonClocks, DEFAULT_IDLE_EXIT_MS } from './clocks';
import { ENDPOINT_CHANNEL_BASE, ENDPOINT_STOP_MS, loadEndpointModule, NO_ENDPOINT_MODULE, type CheckoutSource, type DaemonServices, type EndpointModule } from './endpoint-seam';
import { createServicesFront, spineTakes } from './front';
import { runE2eSeam } from './e2e-seam'; // M5b fix round 2
import { DEPARTURE_BOUND_MS, Relay, type RelayRequest } from './relay';
import { createLazySpine, loadServicesEntry, type SpineEntry, type SpineTiming } from './spine-seam';
import { SpineReaders } from './spine-readers';
import { discoveryWake } from './discovery-wake';
import { trashPath } from './trash';

export const EXIT_RESTART = 75; // a requested restart: the units restart on it
// P5 O3-D D38 (the owner's ruling on D5): re-executing a unit daemon after its spine's release is built and off; a later
// PR flips this default once M7's whole-set reading asks for it. MAWS_SPINE_REEXECUTE=1, read by a unit daemon at
// start, turns it on for that daemon (the measured scene's seam). A private daemon never re-executes.
export const SPINE_REEXECUTE_DEFAULT = false;
// P5 O3-D M5a (D21): whether the profile's `SingletonLock` is read as the yield's second signal, under claimSpine. On
// since M5's probe (e2e/spine-lock.spec.ts, hosted e2e:settings run 40978897272) answered: macOS Electron writes a
// symlink `<host>-<pid>` naming the app's own pid there, and removes it at a clean quit.
export const SINGLETON_LOCK_SIGNAL_DEFAULT = true;
export const SPINE_LOCK_FILE = 'spine.lock'; // src/services/settings/spine-lock.ts's SPINE_LOCK, which mawsd's eager graph cannot import
export const SINGLETON_LOCK_FILE = 'SingletonLock'; // Electron's single-instance lock in the profile (src/main/files/profile-lock.ts)
const STATUS_BOUND_MS = 5_000; // daemon.status waits this long for the engine host's own status
const MAX_INTEREST = 10_000; // host.interest's bound

export interface DaemonOptions {
  kind: 'unit' | 'private';
  dir: string; // <profile>/mawsd, as `--dir` named it
  profileDir: string; // MAWS_USER_DATA
  modules: { self: string; engineHost: string; ptyHost: string }; // this bundle's entry (its build id), and the hosts' bundles
  build: { version: string; commit: string; builtAt: string };
  env: NodeJS.ProcessEnv;
  exit(code: number): void;
  // The log, opened once the directory passed its check (default `<dir>/mawsd.log`, rotated); before that, `refuse`
  // (default stderr) takes the refusal.
  openLog?(dir: string): (line: string) => void;
  refuse?(line: string): void;
  endpoint?: EndpointModule | null; // loadEndpointModule(<this build's id>) unless a test brings one (or none)
  // test seams
  detached?: Partial<Omit<DetachedTransportOptions, 'modulePath'>>; // spawn, processes, timing: both hosts' transports
  runCommand?(command: string, args: string[]): { status: number | null; stdout: string };
  platform?: NodeJS.Platform;
  role?: MachineRole;
  tmp?: string;
  execPath?: string;
  halfOpen?: boolean; // engine-host.sock's server allows half-open (default true; a test shows the drain needs it)
  departureBoundMs?: number;
  helloHoldMs?: number;
  restartBackoffMs?: readonly number[];
  collect?: Collect; // the idle collection (@shared/host/idle-collect.ts's lastResortCollect)
  // P5 O3-D M2: the spine seam's (spine-seam.ts): the chunk's load, whether a batch while cold loads the spine (on in the
  // product since M5b, when main stopped composing its own spine; off, an app quitting would leave its last batches to
  // mawsd's link, and a spine loaded by them would hold spine.lock against an embedded app's next launch), the timings
  // and the lock's wait
  spine?: { load?(): Promise<SpineEntry>; wakeOnEvents?: boolean; timing?: Partial<SpineTiming>; lockWaitMs?: number };
  // P5 O3-D M3 (D30): the engine host's permanent client (above), on in the product since M5b with the front's session
  // streams and `wakeOnEvents` (off, a kept session's events while no app is attached would reach no spine)
  permanentClient?: boolean;
  // P5 O3-D M5a (Interfaces §L): the spine is the machine's, and an app that runs its own is refused at engine-host.sock
  // and yielded to (above); on in the product since M5b, with permanentClient, when apps list machine.spine
  claimSpine?: boolean;
  singletonSignal?: boolean; // D21's second signal (SINGLETON_LOCK_SIGNAL_DEFAULT unless a test says), under claimSpine
}

export interface RunningDaemon {
  paths: DaemonPaths;
  ref: MachineRef;
  hosts: HostSupervisor;
  services: DaemonServices;
  projects: CheckoutSource; // the endpoint's injected source of MAWS's own projects
  status(): Promise<DaemonStatus>;
  stop(reason: string, code?: number): Promise<void>; // the exit order; a second call joins the first
}

type FrameListener = Parameters<DaemonServices['onFrame']>[0];
type ClosedListener = Parameters<DaemonServices['documents']['onClosed']>[0];

// Starts the daemon; null when it exited instead (a refused directory, a held lock, a malformed identity, a socket it
// could not make).
export async function startDaemon(options: DaemonOptions): Promise<RunningDaemon | null> {
  const { kind, dir, profileDir, env } = options;
  const refuse = options.refuse ?? ((line: string) => void process.stderr.write(`${line}\n`));
  const platform = options.platform ?? process.platform;
  const paths = daemonPaths(profileDir, options.tmp ?? tmpdir());
  const startedAt = new Date().toISOString();

  // (1) the directory
  try {
    makePrivateDirectory(dir);
  } catch (error) {
    refuse(`mawsd cannot start in ${dir}: ${error instanceof Error ? error.message : String(error)}`);
    options.exit(1);
    return null;
  }
  const log = (options.openLog ?? ((at: string) => openSupervisorLog(at, LOG_ROTATE_BYTES, DAEMON_FILES.log)))(dir);
  const buildId = buildIdOf(options.modules.self);
  log(`mawsd ${options.build.version} (${options.build.commit}) pid ${process.pid} build ${buildId} starting in ${dir} (${kind})`);

  // (2) the lock
  const lockNames = { lock: DAEMON_FILES.lock, breaker: DAEMON_LOCK_BREAKER };
  const lockDeps = { fs, isAlive, procStartOf, now: () => Date.now(), sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };
  if ((await takeLock(dir, { protocol: SOCKET_PROTOCOL, buildId, socketPath: paths.sockets.machine }, lockDeps, lockNames)) === 'held') {
    const code = kind === 'private' ? START_EXIT_HELD : 0;
    log(`another mawsd (pid ${readLock(dir, fs, DAEMON_FILES.lock)?.pid ?? 'unknown'}) holds the lock; exiting ${code}`);
    options.exit(code);
    return null;
  }
  const written = readLock(dir, fs, DAEMON_FILES.lock);
  const owner = { pid: process.pid, procStart: written?.pid === process.pid ? written.procStart : '' };
  const lockNamesMe = () => {
    const lock = readLock(dir, fs, DAEMON_FILES.lock);
    return lock !== null && lock.pid === owner.pid && lock.procStart === owner.procStart;
  };
  const releaseLock = () => {
    if (lockNamesMe()) unlinkQuietly(join(dir, DAEMON_FILES.lock));
  };

  // (3) the token and the machine ref
  const token = writeToken(join(dir, DAEMON_FILES.token));
  let ref: MachineRef;
  try {
    ref = readOrMintMachineRef(profileDir);
  } catch (error) {
    log(`fatal: ${error instanceof Error ? error.message : String(error)}`);
    releaseLock();
    options.exit(1);
    return null;
  }
  log(`machine ${ref}`);

  // (4) out of backups (RL §5.3): the sticky exclusion follows the directory and needs no root; a failure is not fatal
  if (platform === 'darwin') excludeFromBackups(dir, options.runCommand ?? runCommand, log);

  // (5) the endpoint's directory, which mawsd never reads inside
  try {
    privateOrCorrected(paths.endpoint);
  } catch (error) {
    log(`fatal: ${error instanceof Error ? error.message : String(error)}`);
    releaseLock();
    options.exit(1);
    return null;
  }

  const role = options.role ?? readMachineRole(env);
  const packaged = /\.asar[/\\]/.test(options.modules.self);
  const execPath = options.execPath ?? process.execPath;
  const identity: SupervisorIdentity = { protocol: SOCKET_PROTOCOL, minor: WIRE_MINOR, buildId, capabilities: PEER_CAPABILITIES.daemon, wire: wireFingerprint(), pid: process.pid, startedAt }; // P5 O3-D: its own list
  // P5 O3-D M3: `host.attachment` declared only with the permanent client on, since a declaring client must send it
  const permanentClient = options.permanentClient ?? false;
  const engineHello = permanentClient ? PEER_CAPABILITIES.daemonToEngineHost : PEER_CAPABILITIES.daemonToEngineHost.filter((name) => name !== ATTACHMENT_CAPABILITY);
  const engineIdentity = appIdentity(options.modules.engineHost, env, 'detached', engineHello); // the e2e seams stand in, as for main
  // P5 O3-D M5a (§L): off until M5b; the second signal under it, behind its own switch until its probe answers (D21)
  const claimSpine = options.claimSpine ?? false;
  const singletonSignal = options.singletonSignal ?? SINGLETON_LOCK_SIGNAL_DEFAULT;
  // P5 O3-D M4 (Interfaces §E, D11): MAWS's own projects, checkouts the endpoint knows beside RL10's: every project row of
  // the loaded spine while its view is available (none while it is cold, refused, or a scenario's)
  const projects: CheckoutSource = {
    known: (path) => {
      const view = spine.root()?.view;
      return view !== undefined && view.unavailable() === null && view.projectRows().some((row) => row.directory === path);
    },
  };
  const endpoint = options.endpoint === undefined ? loadEndpointModule(buildId, { projects }) : options.endpoint;
  // The machine's enrollment, the endpoint's in process (D16, D38): machine.identity's project and the spine's org projects
  const enrollment = () => machineEnrollment(() => endpoint?.enrollment() ?? null);

  // --- the upstreams --------------------------------------------------------------------------------------------------
  let stopping: Promise<void> | null = null;
  const parked = { 'engine-host': true, 'pty-host': true };
  const hosts = createHostSupervisor({
    hosts: {
      'engine-host': { modulePath: options.modules.engineHost, serviceName: 'maws-supervisor', transport: 'detached', readyBy: 'external', onDemand: true, detached: { buildPolicy: 'replace', identity: engineIdentity } },
      'pty-host': {
        modulePath: options.modules.ptyHost,
        serviceName: 'maws-pty-host',
        transport: 'detached',
        onDemand: true,
        detached: {
          buildPolicy: 'replace',
          files: ptyHostFiles(paths.ptyHost),
          identity: appIdentity(options.modules.ptyHost, env, 'utility', PEER_CAPABILITIES.daemonToPtyHost), // never the e2e seams, which are the engine host's
          start: { kind: 'spawn', command: execPath, args: ['--disable-sigusr1', options.modules.ptyHost, '--detached', paths.ptyHost], env: supervisorEnv(env, { userData: profileDir, packaged }), argv0: 'maws-pty-host' },
        },
      },
    },
    emit: () => true, // every event is relayed as received (onRaw), none through this build's schemas
    userData: () => profileDir,
    packaged: () => packaged,
    detached: { env: () => env, log: (line) => log(`[hosts] ${line}`), ...options.detached },
    restartBackoffMs: options.restartBackoffMs,
    onReplaced: (host) => {
      // an embedded-shape app took the engine host: stop reaching it and exit 0, so no unit restarts into a tug of war
      log(`the ${host} was taken by another client; exiting`);
      void stop('replaced', 0);
    },
    onParked: (host, isParked) => {
      if (host === 'machine') return;
      parked[host] = isParked;
      clocks.hosts({ engine: parked['engine-host'], pty: parked['pty-host'] });
    },
  });

  // --- the spine (P5 O3-D M2; spine-seam.ts): cold at start, loaded from the services chunk at the first trigger ---------
  const spineQuietMs = positiveInteger(env.MAWS_SPINE_QUIET_MS); // the measured scene's quiet period (D6)
  const spine = createLazySpine({
    profileDir,
    build: `${options.build.version}+${options.build.commit}`,
    hosts,
    intercept: (request) => interceptEngine(request),
    load: options.spine?.load ?? loadServicesEntry,
    deps: () => ({
      profile: profileDir,
      machine: ref,
      bus: front.bus,
      clientPort: front.port, // §E: the asking client's connection, or the attached app's
      interest: () => new Set(union()),
      // the session's socket in the attached app's cua directory, from its machine.client (P5 O3-D M5b)
      browserSocket: (appSessionId) => {
        const dir = front.browserSocket();
        return dir === null ? null : cuaSocketPath(dir, appSessionId);
      },
      trash: (path) => trashPath(path, { platform, home: homedir(), env }), // D10: mawsd's own move into the user's trash
      engineEnv: captureShellEnvironment({ cache: false }), // one capture per load
      env,
      packaged,
      appPath: join(dirname(options.modules.self), '..', '..'),
      devRoot: process.cwd(),
      home: homedir(),
      enrollment,
    }),
    quietMs: () => spineQuietMs ?? clocks.idleMs() ?? DEFAULT_IDLE_EXIT_MS,
    reexecute: kind === 'unit' && (SPINE_REEXECUTE_DEFAULT || env.MAWS_SPINE_REEXECUTE === '1'),
    wakeOnEvents: options.spine?.wakeOnEvents ?? false,
    endLink: async () => {
      const drained = hosts.stop(); // the terminal draining close: what the engine host wrote before it saw the end folds now
      if (drained) await Promise.race([drained, sleep(CLOSE_GRACE_MS + 250)]);
    },
    restart: (reason) => void stop(reason, EXIT_RESTART),
    exitForYield: () => void stop('yield', kind === 'unit' ? EXIT_RESTART : 0),
    collected: () => idle.dropped(),
    yieldCandidate: () => (claimSpine && singletonSignal ? singletonHolder() : null), // D21's second signal
    onState: (state) => {
      if (state !== 'loading' && state !== 'loaded' && state !== 'releasing') front.unbind(); // the parts stopped: the next load registers afresh
    },
    log,
    ...(options.spine?.timing && { timing: options.spine.timing }),
    ...(options.spine?.lockWaitMs !== undefined && { lockWaitMs: options.spine.lockWaitMs }),
  });

  // --- the lock's daemon side (P5 O3-D M5a, Interfaces §L) -------------------------------------------------------------
  // The apps whose hello listed machine.spine, on any of the three sockets, by pid and start: never yielded to.
  const spineReaders = new SpineReaders(procStartOf); // M6 fix round 1: pruned at each client change, so a departed app's entry goes
  const readsSpine = (pid: number) => spineReaders.reads(pid);
  const announced = (connected: boolean, peer: { capabilities: readonly string[] } | undefined, appPid: number | undefined) => {
    spineReaders.prune();
    if (!connected || appPid === undefined || !peer?.capabilities.includes(MACHINE_SPINE_CAPABILITY)) return;
    spineReaders.announce(appPid);
    if (spine.yieldedTo() !== appPid) return;
    log(`[spine] pid ${appPid} reads the machine’s spine (its hello lists ${MACHINE_SPINE_CAPABILITY}): the yield to it lifted`);
    spine.yield(null);
  };
  // `spine.lock` names this pid, at this start (the lock's own liveness rule)
  const holdsSpineLock = (pid: number) => {
    const lock = readLock(profileDir, fs, SPINE_LOCK_FILE);
    return lock !== null && lock.pid === pid && lock.procStart === procStartOf(pid);
  };
  // The first signal: a hello refused for lacking machine.spine. An app from before O3-A holds no spine.lock and is
  // yielded to; one from O3-A to O3-C holds it, and the lock refuses mawsd's spine while it runs.
  const refuseSpineless = (peer: { build: string; capabilities: readonly string[] }, appPid: number): ServerRefuse | null => {
    if (!claimSpine || peer.capabilities.includes(MACHINE_SPINE_CAPABILITY)) return null;
    const holds = holdsSpineLock(appPid);
    log(`engine-host.sock: refuse wire to appPid ${appPid} (build ${peer.build}): its hello lists no ${MACHINE_SPINE_CAPABILITY}, so it runs a spine of its own${holds ? ', and holds spine.lock' : ''}`);
    if (!holds) spine.yield(appPid);
    return { t: 'refuse', reason: 'wire', protocol: identity.protocol, buildId: identity.buildId, wire: identity.wire, liveSessions: hosts.welcome('engine-host')?.liveSessions ?? 0 };
  };
  // The second signal (D21): the profile's SingletonLock, a symlink `<host>-<pid>` as Chromium writes it, naming a live
  // app of this host that no post-D hello announced and that holds no spine.lock.
  // A lock a crash left behind (a clean quit removes it) is no signal: its pid gone, or alive but known to have started
  // after the lock was written, so not its writer (a pid reused since). A start ps cannot give leaves the signal standing.
  const singletonHolder = (): number | null => {
    let target: string;
    let written: number;
    try {
      const path = join(profileDir, SINGLETON_LOCK_FILE);
      target = fs.readlinkSync(path);
      written = fs.lstatSync(path).mtimeMs;
    } catch {
      return null; // none, or not a symlink
    }
    const named = /^(.+)-(\d+)$/.exec(target);
    if (!named || named[1] !== hostname()) return null;
    const pid = Number(named[2]);
    if (pid === process.pid || !isAlive(pid) || !startedBy(pid, written) || readsSpine(pid) || holdsSpineLock(pid)) return null;
    log(`[spine] ${SINGLETON_LOCK_FILE} names pid ${pid}, a live app that reads no spine of the machine’s and holds no spine.lock`);
    return pid;
  };

  // --- the clocks -----------------------------------------------------------------------------------------------------
  const idle = idleCollector({ log, collect: options.collect, quiet: () => clocks.quiet() }); // P5 Decision Log 124's lever: a collection at each quiet entry, asked again as it collects
  const clocks = new DaemonClocks(kind, {
    armEnginePark: (why) => {
      log(why === 'discovery' ? '[spine] discovery: the wake is over: asking the engine host to exit when idle' : 'no app and no interest for the idle time: asking the engine host to exit when idle');
      const sent = hosts.exitSupervisor('idle', 'engine-host');
      if (!sent) log('the engine host’s exit when idle was not sent (no link): asked again at its next ready');
      return sent;
    },
    disarmEnginePark: () => {
      log('taking back the engine host’s exit when idle');
      hosts.disarmExit('engine-host');
      void hosts.dispatch('engine-host', 'host.exitWhenIdle', { armed: false }).then((result) => {
        if (!result.ok) log(`host.exitWhenIdle {armed: false} failed: ${result.error.message}`);
      });
    },
    exitDaemon: () => {
      log('no client, both hosts parked and no hold for the idle time');
      void stop('idle', 0);
    },
    quiet: (quiet) => {
      idle.set(quiet);
      spine.quiet(quiet); // the spine's release runs on the daemon's quiet, with no working session (spine-seam.ts)
    },
  });

  // --- the interest union (OX5): the relay connection's set and the endpoint's remote viewers -------------------------
  const interests = new Map<string, readonly AppSessionId[]>();
  let interestSent = '';
  const union = (): AppSessionId[] => [...new Set([...interests.values()].flat())].sort();
  const sendInterest = async (force = false): Promise<HostResponse> => {
    const sessions = union();
    clocks.interest(sessions.length === 0);
    const key = sessions.join('\n');
    const ok: HostResponse = { t: 'res', id: 'interest', ok: true, value: undefined };
    if ((!force && key === interestSent) || hosts.parked('engine-host')) return ok; // a parked host hears it at its next link
    interestSent = key;
    if (sessions.length > MAX_INTEREST) log(`the interest union holds ${sessions.length} sessions; sending the first ${MAX_INTEREST}`);
    return hosts.forward('engine-host', { name: 'host.interest', input: { sessions: sessions.slice(0, MAX_INTEREST) } });
  };
  const setInterest = (holder: string, sessions: readonly AppSessionId[] | null) => {
    if (sessions === null) interests.delete(holder);
    else interests.set(holder, sessions);
  };

  // --- listeners the seam offers ---------------------------------------------------------------------------------------
  const eventListeners = new Set<(owner: 'engine-host' | 'pty-host' | 'machine', message: { name: string; payload: unknown }) => void>();
  const attachmentListeners = new Set<(attached: boolean) => void>();
  let available = false; // what a listener that comes later is told at once (an endpoint loaded at its first command)
  const frameListeners = new Set<FrameListener>();
  const closedListeners = new Set<ClosedListener>();
  const upstreamListeners = new Set<(link: { connected: boolean; generation: number }) => void>();
  const each = <T extends unknown[]>(listeners: Set<(...args: T) => void>, ...args: T) => {
    for (const listener of [...listeners]) {
      try {
        listener(...args);
      } catch (error) {
        log(`a listener of the endpoint seam failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  // --- the engine host's link: recycled per attachment, or permanent (P5 O3-D M3) --------------------------------------
  // Chosen at each welcome: permanent with the option on and a host that serves `host.attachment`, O2's recycle otherwise.
  let permanentLink = false;
  // Whether events are available, as the endpoint seam's onAttachment says it (O2's recycle: an app is attached).
  const availability = (value: boolean) => {
    available = value;
    each(attachmentListeners, value);
  };
  // The app's attachment, told to a permanent link's host. Never to a parked one, which has no connection (whose end
  // already counted as {attached: false}) and must not be woken for it; one restarting hears it once it is up.
  let departure: Promise<void> = Promise.resolve(); // the latest {attached: false}'s answer: the departure's drain
  let appOnEngine = false; // an app is attached on engine-host.sock (a second attach without a departure replaces it)
  const tellAttachment = (attached: boolean): Promise<void> => {
    if (hosts.parked('engine-host')) return Promise.resolve();
    return hosts.forward('engine-host', { name: 'host.attachment', input: { attached } }).then((answer) => {
      if (!answer.ok) log(`host.attachment {attached: ${attached}} failed: ${answer.error.message}`);
    });
  };

  // --- the engine host's relay ---------------------------------------------------------------------------------------
  let recycling = 0;
  let recycled: Promise<void> = Promise.resolve(); // the latest recycle's end
  const recycleEngine = (drained?: () => void) => {
    recycling += 1;
    recycled = hosts.recycle('engine-host', { drained }).then(() => {
      recycling -= 1;
      if (recycling === 0 && hosts.snapshot('engine-host').state !== 'ready') engineRelay.dropApp(`the engine host is ${hosts.snapshot('engine-host').state} after its recycle`);
    });
  };
  // A stop-all's close is deliberate (the host parks until the next attach or request). It is marked on the link the
  // request is written to, so one sent just after an attach waits for that attach's recycle.
  const stopAll = (request: { input: unknown; client?: string }): Promise<HostResponse> =>
    recycled.then(() => {
      hosts.expectExit('engine-host');
      return hosts.forward('engine-host', { name: 'host.stopAll', input: request.input, ...(request.client && { client: request.client }) });
    });
  // host.exitWhenIdle, forwarded and tracked: the link that answers it is marked armed (its exit once idle is
  // deliberate and parks the host) or disarmed. Sent after an attach's recycle, as a stop-all is.
  const exitWhenIdle = (request: { input: unknown; client?: string }): Promise<HostResponse> =>
    recycled.then(async () => {
      const armed = (request.input as { armed?: unknown } | null)?.armed;
      const answer = await hosts.forward('engine-host', { name: 'host.exitWhenIdle', input: request.input, ...(request.client && { client: request.client }) });
      if (answer.ok && armed === true) hosts.expectIdleExit('engine-host');
      if (answer.ok && armed === false) hosts.disarmExit('engine-host');
      return answer;
    });
  const engineRelay = new Relay({
    owner: 'engine-host',
    hosts,
    log: (line) => log(`engine-host.sock: ${line}`),
    startedAt: (pid) => lockStartedAt(join(profileDir, 'supervisor'), pid),
    // P5 O3-D M5a (D44(3)): a post-D app's request the spine intercepts goes through it, the spine loaded for it if cold
    intercept: (request, app) => (app.capabilities.includes(MACHINE_SPINE_CAPABILITY) && spineTakes(request.name, request.input) ? throughSpine(request) : interceptEngine(request)),
    refuseHello: refuseSpineless, // P5 O3-D M5a (§L), under claimSpine
    deliverTo: (capabilities) => !capabilities.includes(MACHINE_SPINE_CAPABILITY), // P5 O3-D M5a: a post-D app's events come on machine.sock
    onDocument: (message, end) => {
      // the app's channels are below 2^31; one at or above is the endpoint's range (P5 Decision Log 42: a value rule)
      if (message.channel >= ENDPOINT_CHANNEL_BASE) return end.close();
      // one opened just after the attach rides the fresh link, not the one its recycle ends
      let closed = false;
      end.on('close', () => void (closed = true));
      void recycled.then(() => {
        if (!closed && !hosts.postDocPort(message, end, 'app')) end.close();
      });
    },
    onExit: (when, refused) => {
      if (when === 'idle') return log('exit idle from the app ignored: the daemon’s clocks decide');
      if (refused) {
        log('Restart now on a refused connection: replacing the incompatible engine host');
        return void hosts.restartSupervisor({ stopSessions: false });
      }
      log('exit now from the app: the engine host exits now and parks');
      hosts.exitSupervisor('now', 'engine-host');
    },
    attached: () => {
      clocks.engineAttached(true); // disarms a park first
      setInterest('app', []);
      // before anything of the app's is forwarded; an app it replaced departs first (the relay calls no departed() for
      // it), so its route E, direct operations and holds end and the new one is the owner back, on the same connection
      if (permanentLink && appOnEngine) void tellAttachment(false);
      if (permanentLink) void tellAttachment(true);
      else availability(true);
      appOnEngine = true;
      clientsChanged();
      if (!permanentLink) recycleEngine(); // a fresh link for this attachment
    },
    ready: () => {
      if (!permanentLink) hosts.sayReady('engine-host'); // a permanent link said ready at its own welcome
    },
    departed: () => {
      clocks.engineAttached(false);
      setInterest('app', null);
      void sendInterest();
      if (permanentLink) departure = tellAttachment(false);
      else availability(false);
      appOnEngine = false;
      clientsChanged();
    },
    // the upstream's draining close (O2), or a permanent link's {attached: false}, whose answer follows every event the
    // host wrote before it saw the departure
    drain: { start: (drained) => (permanentLink ? void departure.then(drained) : recycleEngine(drained)), boundMs: options.departureBoundMs ?? DEPARTURE_BOUND_MS },
    holdMs: options.helloHoldMs,
    between: () => clientsChanged(), // P5 Decision Log 124: the quiet's
  });

  // A post-D app's relayed request through the spine's intercept for it; one the spine cannot take (it cannot load: the
  // lock's holder keeps its own note) goes on raw, its client named, as the relay forwards any other.
  const relayClient = endableClientRef('engine-host.sock');
  async function throughSpine(request: RelayRequest): Promise<HostResponse> {
    const answered = await front.intercepted(request.name, request.input, relayClient);
    if (answered) return { t: 'res', id: request.id, ...answered } as HostResponse;
    return hosts.forward('engine-host', { name: request.name, input: request.input, ...(request.client && { client: request.client }) });
  }

  function interceptEngine(request: RelayRequest): Promise<HostResponse> | null {
    const input = (request.input ?? {}) as Record<string, unknown>;
    switch (request.name) {
      case 'host.interest': {
        if (!Array.isArray(input.sessions) || !input.sessions.every((id) => typeof id === 'string')) return null; // the host refuses it as it is
        setInterest('app', input.sessions as AppSessionId[]);
        return sendInterest();
      }
      case 'host.stopAll':
        return stopAll(request);
      case 'host.configure': {
        const ms = input.idleExitMs;
        if (ms === null || (typeof ms === 'number' && Number.isInteger(ms) && ms > 0 && ms <= MAX_IDLE_EXIT_MS)) clocks.configure(ms);
        return null;
      }
      case 'host.exitWhenIdle':
        return exitWhenIdle(request);
      case 'host.attachment': // P5 O3-D M3: mawsd's own signal; the relay's welcome lists the upstream's capability, never for an app to use
        return Promise.resolve({ t: 'res', id: request.id, ok: false, error: ipcError('forbidden_sender', 'host.attachment is mawsd’s own signal to the engine host') });
      default:
        return null;
    }
  }

  // --- the pty host's relay, and its output credit -------------------------------------------------------------------
  let credit: 'daemon' | 'app' = 'daemon';
  let ptyCheck = 0; // a park check in flight is stale once this moved
  let ptyRequests = 0; // the endpoint's requests to the pty host in flight: no park under them
  const ptyReady = () => hosts.snapshot('pty-host').state === 'ready' && !hosts.parked('pty-host');
  // The credit while no app holds it: every live pty acknowledged at its offset (a pty paused while mawsd was down
  // resumes), then the pty host parks when nothing lives.
  const settleCredit = async () => {
    if (credit !== 'daemon' || !ptyReady()) return;
    const check = ++ptyCheck;
    const listed = await hosts.dispatch('pty-host', 'pty.list', undefined);
    if (!listed.ok || credit !== 'daemon' || check !== ptyCheck) return;
    const { ptys } = listed.value as { ptys: { ptyId: string; alive: boolean; offset: number }[] };
    for (const pty of ptys.filter((p) => p.alive)) void hosts.dispatch('pty-host', 'pty.ack', { ptyId: pty.ptyId, offset: pty.offset });
    if (ptys.some((p) => p.alive) || ptyRelay.attachedApp() || ptyRequests > 0) return;
    log('no app on pty-host.sock and no pty alive: the pty host exits now and parks');
    hosts.exitSupervisor('now', 'pty-host');
  };
  const ptyRelay = new Relay({
    owner: 'pty-host',
    hosts,
    log: (line) => log(`pty-host.sock: ${line}`),
    startedAt: (pid) => lockStartedAt(paths.ptyHost, pid),
    onExit: (when, refused) => {
      if (when === 'idle' || refused) return log(`exit ${when} from the app on pty-host.sock ignored`);
      log('exit now from the app: the pty host exits now and parks');
      hosts.exitSupervisor('now', 'pty-host');
    },
    attached: () => {
      credit = 'app'; // before anything is forwarded: the renderer's pty.attach takes the credit back (stepFlow's attach)
      ptyCheck += 1;
      clientsChanged();
      // the pty host outlives every app: a fresh login-shell capture per attachment (M8's login-shell decision)
      void hosts.dispatch('pty-host', 'pty.recaptureEnv', undefined).then((result) => {
        if (!result.ok) log(`pty.recaptureEnv failed: ${result.error.message}`);
      });
    },
    ready: () => {},
    departed: () => {
      credit = 'daemon';
      clientsChanged();
      void settleCredit();
    },
    holdMs: options.helloHoldMs,
    between: () => clientsChanged(), // P5 Decision Log 124: the quiet's
  });

  // --- what the upstreams send ---------------------------------------------------------------------------------------
  let generation = 0;
  let upstreamConnected = false;
  hosts.onState('engine-host', (state) => {
    const ready = state.state === 'ready';
    clocks.engineHost(ready ? state.pid : null);
    if (ready) permanentLink = permanentClient && (hosts.peer('engine-host')?.capabilities.includes(ATTACHMENT_CAPABILITY) ?? false); // P5 O3-D M3: at each welcome
    if (ready && !upstreamConnected) {
      upstreamConnected = true;
      generation += 1;
      each(upstreamListeners, { connected: true, generation });
      void sendInterest(true); // a fresh link starts with no interest of its own
    } else if (!ready && upstreamConnected) {
      upstreamConnected = false;
      each(upstreamListeners, { connected: false, generation }); // after every endpoint channel's `upstream` close (doc-relay)
    }
    if (!ready && recycling === 0) engineRelay.dropApp(`the engine host is ${state.state}`);
    if (!ready) return;
    // P5 O3-D M3: a permanent link is ready by its own resync (D8): said at once, the loaded spine's resync then runs at
    // the streaming in the seam's adapter, what arrives meanwhile held; a recycled one waits for the app's ready line,
    // and what is available follows the app again (a permanent link replaced by an older host's)
    if (permanentLink) hosts.sayReady('engine-host');
    else if (available !== engineRelay.attachedApp()) availability(engineRelay.attachedApp());
  });
  hosts.onStreaming('engine-host', () => {
    if (permanentLink && !available) availability(true); // P5 O3-D M3: events are available from here on, with or without an app
  });
  hosts.onRaw('engine-host', (message) => {
    engineRelay.deliver(message);
    each(eventListeners, 'engine-host', message);
  });
  hosts.onState('pty-host', (state) => {
    if (state.state === 'ready') return void settleCredit(); // every link while no app holds the credit
    ptyRelay.dropApp(`the pty host is ${state.state}`);
  });
  hosts.onRaw('pty-host', (message) => {
    ptyRelay.deliver(message);
    each(eventListeners, 'pty-host', message);
    const payload = message.payload as { ptyId?: unknown; offset?: unknown; data?: unknown } | null;
    if (message.name === 'pty.data' && payload && typeof payload.ptyId === 'string' && typeof payload.offset === 'number' && payload.data instanceof Uint8Array) {
      each(frameListeners, { owner: 'pty-host', ptyId: payload.ptyId, offset: payload.offset, data: payload.data });
      if (credit === 'daemon') void hosts.dispatch('pty-host', 'pty.ack', { ptyId: payload.ptyId, offset: payload.offset + payload.data.byteLength });
    }
    if (message.name === 'pty.exit' && credit === 'daemon') void settleCredit();
  });

  // --- the daemon namespace -------------------------------------------------------------------------------------------
  const hostOf = (host: 'engine-host' | 'pty-host', live: number | null = null): DaemonHost => {
    const state = hosts.snapshot(host);
    const welcome = hosts.welcome(host);
    const named = hosts.parked(host) ? 'parked' : state.state === 'crashed' && hosts.refusal(host) ? 'waiting' : state.state;
    return { state: named, pid: state.pid, build: welcome?.peer.build ?? null, liveSessions: live ?? welcome?.liveSessions ?? null };
  };
  async function status(): Promise<DaemonStatus> {
    // the engine host's own count, fresh (a status read wakes it, as `mawsd status` does; the pty host is never woken)
    const asked = hosts.dispatch('engine-host', 'host.supervisorStatus', undefined);
    const answered = await Promise.race([asked, new Promise<null>((resolve) => setTimeout(() => resolve(null), STATUS_BOUND_MS).unref())]);
    const live = answered?.ok ? (answered.value as { liveSessions: number }).liveSessions : null;
    return {
      pid: process.pid,
      startedAt,
      kind,
      build: { ...options.build, buildId, engineHostBuildId: engineIdentity.buildId() },
      machine: ref,
      profile: profileDir,
      platform,
      role,
      hosts: { 'engine-host': hostOf('engine-host', live), 'pty-host': hostOf('pty-host') },
      clients: { engineHost: engineRelay.attachedApp(), ptyHost: ptyRelay.attachedApp(), machine: machineClients?.count() ?? 0 },
      idleExitAt: clocks.idleExitAt(),
      logPath: paths.log,
      endpoint: { present: endpoint !== null, detail: endpoint ? safely(() => endpoint.status(), log) : null },
      spine: spine.status(),
    };
  }
  // M5b fix round 2, round 3: whether the e2e's spine seams answer, read once from mawsd's own environment at its start,
  // never from a request (daemon.e2eSeam, ./e2e-seam.ts)
  const e2eSeamsAllowed = env.MAWS_E2E === '1';
  async function daemonCommand(name: string, input: unknown): Promise<unknown> {
    switch (name) {
      case 'daemon.status':
        return status();
      case 'daemon.restart':
        log('restart asked');
        setImmediate(() => void stop('restart', EXIT_RESTART)); // after the answer is written
        return undefined;
      case 'daemon.e2eSeam':
        return runE2eSeam(input as CommandInput<'daemon.e2eSeam'>, e2eSeamsAllowed); // M5b fix round 2: the e2e's seams with the spine
      case 'daemon.endpoint': {
        const { command, args, secret } = input as { command: string; args: string[]; secret?: string };
        if (!endpoint) return { code: 2, out: NO_ENDPOINT_MODULE };
        return endpoint.cli(command, args, secret); // the secret is passed, never logged
      }
      default:
        throw new Error(`mawsd serves no ${name}`);
    }
  }

  // --- the discovery wake (P5 O3-D M6 fix rounds 1, 2; discovery-wake.ts) ---------------------------------------------
  const wakeForDiscovery = discoveryWake({
    discovery: () => spine.root()?.discovery,
    parked: () => hosts.parked('engine-host'),
    wake: () => hosts.wake('engine-host'),
    parkNow: () => clocks.parkNow(),
    log,
  });

  // --- the services front (P5 O3-D M2, M4; front.ts): machine.sock's commands, events, streams and client port --------
  let engineAppPid: number | null = null; // the app welcomed on engine-host.sock: the port's requests with no client go to its machine.sock connection
  const front = createServicesFront({
    spine,
    hosts,
    intercept: (request) => interceptEngine(request),
    daemon: daemonCommand,
    identity: () => {
      const name = machineName(env, hostname());
      return { ref, name, project: machineProject(ref, name, enrollment()) };
    },
    isApp: (appPid) => engineAppPid !== null && engineRelay.attachedApp() && appPid === engineAppPid,
    beforeSpineCommand: wakeForDiscovery,
    log,
  });
  front.events((name, payload) => each(eventListeners, 'machine', { name, payload })); // the endpoint's owner `machine`

  // --- the endpoint seam -----------------------------------------------------------------------------------------------
  const holds = new Map<number, string>();
  let nextHold = 0;
  const endpointChannels = new Map<number, EndpointChannel>();
  const services: DaemonServices = {
    machine: { ref, profileDir, stateDir: paths.endpoint, kind },
    async dispatch(host, name, input, client?: ClientRef) {
      const refused = (why: string): HostResponse => ({ t: 'res', id: 'endpoint', ok: false, error: ipcError('internal', why) });
      // P5 O3-D M4: the front's table, as a machine.sock client's request (the spine loaded for a spine command), the
      // endpoint's ref for its device the asking client (the client port answers it noClient until O7 M5)
      if (host === 'machine') return { t: 'res', id: 'endpoint', ...(await front.dispatch(name, input, client)) } as HostResponse;
      if (host === 'pty-host' && (name === 'pty.ack' || name === 'pty.checkpoint')) return refused(`${name} through the endpoint: the credit is the app's or the daemon's`);
      if (host === 'engine-host' && name === 'host.interest') return refused('a remote viewer’s interest arrives through interest.report');
      if (host === 'engine-host' && name === 'host.stopAll') return stopAll({ input, ...(client && { client: client.id }) });
      if (host === 'engine-host' && name === 'host.exitWhenIdle') return exitWhenIdle({ input, ...(client && { client: client.id }) });
      // a remote viewer never holds a pty's output credit: every attach through the seam reads without taking it
      const sent = host === 'pty-host' && name === 'pty.attach' ? { ...(input as object), credit: false } : input;
      // P5 O3-D M5a (D44(3), D47): under claimSpine, an intercepted name (a phone's claimed `host.op` of one included)
      // goes through the spine's intercept, the spine loaded for it, so its rewind is noted with the spine cold; one the
      // spine cannot take goes on raw, as every one does with claimSpine off
      if (host === 'engine-host' && claimSpine && spineTakes(name, input)) {
        const answered = await front.intercepted(name, input, client);
        if (answered) return { t: 'res', id: 'endpoint', ...answered } as HostResponse;
      }
      if (host === 'engine-host') return hosts.forward(host, { name, input: sent, ...(client && { client: client.id }) });
      // the pty host it woke stays up for the request (a spawn), and parks after it if nothing lives and no app is on
      ptyRequests += 1;
      try {
        return await hosts.forward(host, { name, input: sent, ...(client && { client: client.id }) });
      } finally {
        ptyRequests -= 1;
        if (ptyRequests === 0) void settleCredit();
      }
    },
    onEvent: (listener) => (eventListeners.add(listener), () => void eventListeners.delete(listener)),
    // A listener hears the state as it stands when it comes (O10 M10: an endpoint loaded at its first command); at start
    // step 7 no app is attached and no link is up, so the endpoint's start hears nothing at once. P5 O3-D M3: whether
    // events are available (the permanent link's streaming, or an app's attachment), above.
    onAttachment: (listener) => {
      attachmentListeners.add(listener);
      if (available) listener(true);
      return () => void attachmentListeners.delete(listener);
    },
    onFrame: (listener) => (frameListeners.add(listener), () => void frameListeners.delete(listener)),
    documents: {
      open(message: DocumentsOpen) {
        if (message.channel < ENDPOINT_CHANNEL_BASE || endpointChannels.has(message.channel)) return false;
        const channel = new EndpointChannel(message.channel, frameListeners, (number, reason) => {
          endpointChannels.delete(number);
          each(closedListeners, number, reason);
        });
        const { channel: number, artifactId, actor, doc } = message;
        if (!hosts.postDocPort({ t: 'doc', channel: number, artifactId, actor, ...(doc && { doc }) }, channel, 'endpoint')) return false;
        endpointChannels.set(number, channel);
        return true;
      },
      close(channel) {
        endpointChannels.get(channel)?.endFromEndpoint();
        endpointChannels.delete(channel);
      },
      frame(channel, bytes) {
        const open = endpointChannels.get(channel);
        return open !== undefined && upstreamConnected && open.send(bytes);
      },
      onClosed: (listener) => (closedListeners.add(listener), () => void closedListeners.delete(listener)),
    },
    onUpstream: (listener) => {
      upstreamListeners.add(listener);
      if (upstreamConnected) listener({ connected: true, generation });
      return () => void upstreamListeners.delete(listener);
    },
    hold(reason) {
      const id = ++nextHold;
      holds.set(id, reason);
      clocks.holds(holds.size);
      return () => {
        if (!holds.delete(id)) return;
        clocks.holds(holds.size);
      };
    },
    interest: {
      report(viewer, sessions) {
        setInterest(`viewer:${viewer}`, [...sessions]);
        void sendInterest();
      },
      drop(viewer) {
        setInterest(`viewer:${viewer}`, null);
        void sendInterest();
      },
    },
    log: (line) => log(`[endpoint] ${line}`),
  };

  // --- (6) the sockets --------------------------------------------------------------------------------------------------
  const servers: Server[] = [];
  let engineClients: SocketClients | null = null;
  let ptyClients: SocketClients | null = null;
  let machineClients: SocketClients | null = null;
  const clientsChanged = () => {
    clocks.relaysBetween(engineRelay.between() || ptyRelay.between());
    clocks.clients(Number(engineRelay.attachedApp()) + Number(ptyRelay.attachedApp()) + (machineClients?.count() ?? 0));
  };
  const counts = (host: 'engine-host' | 'pty-host') => () => {
    const welcome = hosts.welcome(host);
    return { liveSessions: welcome?.liveSessions ?? 0, rows: welcome?.rows ?? 0 };
  };
  try {
    if (paths.socketDir !== dir) makePrivateDirectory(paths.socketDir);
    const engineServer = createServer({ allowHalfOpen: options.halfOpen ?? true });
    engineClients = serveSocketClients(engineServer, {
      runtime: engineRelay,
      badToken: 'close',
      admitHello: (peer, appPid) => engineRelay.admit(peer, appPid),
      onClientEnd: () => engineRelay.ended(),
      onClient: (connected, peer, appPid) => {
        engineAppPid = connected ? (appPid ?? null) : null;
        announced(connected, peer, appPid);
      },
      identity: () => identity,
      counts: counts('engine-host'),
      token: () => token,
      onExit: (when, from) => engineRelay.exit(when, from),
      log: (line) => log(`engine-host.sock: ${line}`),
    });
    engineRelay.bind(engineClients);
    const ptyServer = createServer();
    ptyClients = serveSocketClients(ptyServer, {
      runtime: ptyRelay,
      badToken: 'close',
      admitHello: (peer, appPid) => ptyRelay.admit(peer, appPid),
      identity: () => identity,
      counts: counts('pty-host'),
      token: () => token,
      onExit: (when, from) => ptyRelay.exit(when, from),
      onClient: announced,
      log: (line) => log(`pty-host.sock: ${line}`),
    });
    ptyRelay.bind(ptyClients);
    const machineServer = createServer();
    machineClients = serveSocketClients(machineServer, {
      many: { runtimeFor: (client) => front.runtimeFor(client) },
      badToken: 'close',
      identity: () => identity,
      counts: () => ({ liveSessions: 0, rows: 0 }),
      token: () => token,
      onExit: (when) => {
        if (when === 'idle') return log('exit idle on machine.sock ignored');
        log('exit now on machine.sock: restarting');
        void stop('exit', EXIT_RESTART);
      },
      onClient: (connected, peer, appPid) => {
        announced(connected, peer, appPid);
        clientsChanged();
      },
      log: (line) => log(`machine.sock: ${line}`),
    });
    for (const [server, path] of [
      [engineServer, paths.sockets['engine-host']],
      [ptyServer, paths.sockets['pty-host']],
      [machineServer, paths.sockets.machine],
    ] as const) {
      clearSocketPath(path); // a dead mawsd's socket goes; anything else at the path is refused in place
      await listen(server, path);
      fs.chmodSync(path, 0o600);
      server.on('error', (error) => log(`${path}: ${error.message}`)); // an accept failure must not become fatal
      servers.push(server);
      log(`listening on ${path}`);
    }
  } catch (error) {
    log(`fatal: cannot listen: ${error instanceof Error ? error.message : String(error)}`);
    for (const server of servers) server.close();
    releaseLock();
    options.exit(1);
    return null;
  }

  function stop(reason: string, code = 0): Promise<void> {
    stopping ??= (async () => {
      log(`exiting (${reason})`);
      for (const server of servers) server.close(); // no new client
      clocks.stop();
      idle.stop(); // nothing collects through the bounded exit, an entry the last evaluation queued included
      if (endpoint) {
        await Promise.race([endpoint.stop().catch((error: unknown) => log(`the endpoint's stop failed: ${error instanceof Error ? error.message : String(error)}`)), sleep(ENDPOINT_STOP_MS)]);
      }
      await spine.stop(); // its parts stopped once its work settled (bounded: the exit ends what is left)
      for (const clients of [engineClients, ptyClients, machineClients]) clients?.closeClient();
      front.close();
      const drained = hosts.stop(); // both hosts keep running: mawsd never stops a session
      if (drained) await Promise.race([drained, sleep(CLOSE_GRACE_MS + 250)]);
      if (code !== 1 && lockNamesMe()) {
        for (const path of Object.values(paths.sockets)) unlinkQuietly(path);
        if (paths.socketDir !== dir) rmdirQuietly(paths.socketDir);
        unlinkQuietly(join(dir, DAEMON_FILES.lock));
      }
      log(`exited (${reason}, code ${code})`);
      options.exit(code);
    })();
    return stopping;
  }

  // (7) the endpoint, as soon as the sockets are up; (8) hosts already running, adopted with no spawn
  void hosts.start();
  if (endpoint) {
    try {
      await endpoint.start(services);
    } catch (error) {
      log(`the endpoint module failed to start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const [engineAdopted, ptyAdopted] = await Promise.all([hosts.adopt('engine-host'), hosts.adopt('pty-host')]);
  log(`serving; engine host ${engineAdopted ? 'adopted' : 'parked'}, pty host ${ptyAdopted ? 'adopted' : 'parked'}`);
  clocks.served(); // its quiet is told from here: no client yet is its first entry, with the start's garbage behind it

  return { paths, ref, hosts, services, projects, status, stop };
}

// An endpoint document channel's end, as main's relay holds a window's port (doc-relay.ts's RelayPort).
class EndpointChannel implements RelayPort {
  private readonly messageListeners: ((event: { data: unknown }) => void)[] = [];
  private readonly closeListeners: (() => void)[] = [];
  private reason: 'host' | 'reset' | 'upstream' = 'host';
  private closed = false;

  constructor(
    private readonly channel: number,
    private readonly frames: Set<FrameListener>,
    private readonly ended: (channel: number, reason: 'host' | 'reset' | 'upstream') => void,
  ) {}

  // a frame from the host, to the endpoint
  postMessage(message: unknown): void {
    if (this.closed || !(message instanceof Uint8Array)) return;
    for (const listener of [...this.frames]) listener({ owner: 'engine-host', channel: this.channel, bytes: message });
  }

  on(event: 'message' | 'close', listener: ((event: { data: unknown }) => void) | (() => void)): this {
    if (event === 'message') this.messageListeners.push(listener as (event: { data: unknown }) => void);
    else this.closeListeners.push(listener as () => void);
    return this;
  }

  start(): void {}

  closedBy(reason: 'host' | 'reset' | 'upstream'): void {
    this.reason = reason;
  }

  // the relay ended it (the host's documents.closed, or the link's end)
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.ended(this.channel, this.reason);
  }

  // a frame from the endpoint, to the host
  send(bytes: Uint8Array): boolean {
    if (this.closed) return false;
    for (const listener of this.messageListeners) listener({ data: bytes });
    return true;
  }

  // the endpoint closed it: the relay sends documents.close
  endFromEndpoint(): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.closeListeners) listener();
  }
}

// A directory mawsd creates, or corrects to 0700, and never reads inside (the endpoint's). A symlink, a non-directory or
// another uid's directory is refused.
function privateOrCorrected(path: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    fs.mkdirSync(path, { mode: 0o700 });
    return;
  }
  if (stat.isSymbolicLink()) throw new PrivatePathError(path, 'symlink', 'is a symlink');
  if (!stat.isDirectory()) throw new PrivatePathError(path, 'not_directory', 'is not a directory');
  const uid = process.getuid?.();
  if (uid !== undefined && stat.uid !== uid) throw new PrivatePathError(path, 'owner', `is owned by uid ${stat.uid}, not this process's ${uid}`);
  if ((stat.mode & 0o077) !== 0) fs.chmodSync(path, 0o700);
}

function excludeFromBackups(dir: string, run: NonNullable<DaemonOptions['runCommand']>, log: (line: string) => void): void {
  try {
    const checked = run('/usr/bin/tmutil', ['isexcluded', dir]);
    if (checked.status === 0 && /\[Excluded\]/.test(checked.stdout)) return;
    const added = run('/usr/bin/tmutil', ['addexclusion', dir]);
    if (added.status === 0) log(`excluded ${dir} from Time Machine`);
    else log(`could not exclude ${dir} from Time Machine (tmutil exited ${added.status})`);
  } catch (error) {
    log(`could not exclude ${dir} from Time Machine: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function positiveInteger(value: string | undefined): number | null {
  const parsed = value === undefined ? NaN : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function runCommand(command: string, args: string[]): { status: number | null; stdout: string } {
  try {
    return { status: 0, stdout: execFileSync(command, args, { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] }) };
  } catch (error) {
    const failed = error as { status?: number | null; stdout?: string };
    return { status: failed.status ?? null, stdout: failed.stdout ?? '' };
  }
}

// A host's start, as its lock recorded it, when the lock names `pid`; now otherwise.
function lockStartedAt(dir: string, pid: number): string {
  const lock = readLock(dir);
  return lock?.pid === pid ? lock.startedAt : new Date().toISOString();
}

function safely(read: () => unknown, log: (line: string) => void): unknown {
  try {
    return read();
  } catch (error) {
    log(`the endpoint's status failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

function unlinkQuietly(path: string): void {
  try {
    fs.unlinkSync(path);
  } catch {
    // already gone
  }
}

function rmdirQuietly(path: string): void {
  try {
    fs.rmdirSync(path);
  } catch {
    // not empty, or already gone
  }
}

// Whether `pid` can have written what was written at `writtenMs` (`ps`'s start, whole seconds UTC, read as procStartOf
// reads it)
function startedBy(pid: number, writtenMs: number): boolean {
  return couldHaveWritten(procStartOf(pid), writtenMs);
}

// A process of start `start` (procStartOf's line) against what was written at `writtenMs`: only a start known to come
// after it rules the process out; an unknown one (ps failed, or its line does not parse) does not, so a live pid named
// by the lock holds the signal.
export function couldHaveWritten(start: string | null, writtenMs: number): boolean {
  const startMs = start === null ? NaN : Date.parse(`${start} UTC`);
  return !Number.isFinite(startMs) || startMs <= writtenMs;
}
