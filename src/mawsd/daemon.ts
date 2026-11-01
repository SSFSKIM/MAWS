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
//
// P5 O5 M2 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §A, §C): a fourth socket at step (6),
// `artifacts.sock`, the artifact endpoint (artifacts-endpoint.ts): `maws-artifact:` URLs over HTTP for the app's and the
// render host's scheme proxy, resolved through the engine host's `artifacts.content`, its handler a chunk loaded at the
// first use. Every welcome lists `machine.artifacts`; `daemon.status.artifacts` says whether the handler is loaded; the
// exit ends its connections with the clients' and removes the socket with the others.
//
// P5 O5 M4 (Interfaces §A, §B, §F, §G): the render seam (render-handle.ts, its chunk render-seam.ts loaded at the first
// request). The engine host's `maws.artifact.capture` and `maws.artifact.export` go to it, never to a relay or the
// endpoint; it starts the render host (a machine.sock client the front tells it about), and its `stop()` runs in the
// exit order after the endpoint's and before the spine's, whose release ends the engine-host link its refusals travel
// over. To an engine host whose welcome lists `host.render`, `host.attachment` says `render: true` at each streaming
// of the permanent link and at each presence change; every welcome lists `machine.render`; `daemon.status.render` is
// the seam's state; a render client is no client for the clocks (the seam holds the daemon while a request is in flight).
//
// P5 O5 M5 (Interfaces §H, §I): the per-session cua sockets (cua-socket.ts) in the cua directory, made at step (6) with
// the other sockets. A launch is told the daemon's socket for its session (the spine's `browserSocket`), which listens
// while the attached app's `machine.client` names its own cua directory (the relay's target) and relays each checked
// connection there; a raw `session.status` names the session's engine for the peer check (and sets up the socket of an
// engine that outlived a daemon, D-16); a removed session's socket goes. The peer identity addon loads from the app's
// Resources as the app loads it, at the first session's socket (never at an idle start, acceptance 14). `session.capabilities` is the front's, answered from the render handle's and the cua
// sockets' readings; `session.capabilitiesChanged` follows each flip of a session the daemon holds a socket for.
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
import { cuaSocketDir } from '@shared/daemon/files'; // P5 O5 M5
import { daemonCuaSocketPath } from '@shared/browser/cua-socket';
import { idleCollector, type Collect } from '@shared/host/idle-collect';
import { makePrivateDirectory, clearSocketPath } from '@shared/host/private-listen';
import { PrivatePathError } from '@shared/host/private-path';
import { captureShellEnvironment } from '@shared/host/shell-env';
import { writeToken } from '@shared/host/socket-host';
import { CLOSE_GRACE_MS } from '@shared/host/socket-port';
import { ATTACHMENT_CAPABILITY, HOST_RENDER_CAPABILITY, MACHINE_SPINE_CAPABILITY, PEER_CAPABILITIES, SOCKET_PROTOCOL, type DocumentsOpen, type ServerRefuse } from '@shared/host/socket-protocol';
import { serveSocketClients, type SocketClients, type SupervisorIdentity } from '@shared/host/socket-server';
import type { AppSessionId } from '@shared/graph/ids';
import { endableClientRef, type ClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import type { HostResponse } from '@shared/ipc/host-protocol';
import { MAX_IDLE_EXIT_MS } from '@shared/ipc/schema/host';
import type { DaemonHost, DaemonStatus } from '@shared/ipc/schema/daemon';
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import { WIRE_MINOR } from '@shared/ipc/wire';
import { wireFingerprint } from '@shared/ipc/wire-fingerprint';
import { machineEnrollment, machineName, machineProject } from '@shared/machine/identity';
import { readOrMintMachineRef } from '@shared/machine/identity-file';
import { settingsPaths } from '@shared/settings/paths'; // P5 O5 M4: the export name the render seam sends
import type { MachineRef } from '@shared/machine/ref';
import { readMachineRole, type MachineRole } from '../engine-host/role';
import { buildIdOf, currentBuildIdOf, isAlive, procStartOf, readLock, START_EXIT_HELD, takeLock } from '../engine-host/supervisor-files';
import { LOG_ROTATE_BYTES, openSupervisorLog } from '../engine-host/supervisor-log';
import { ptyHostFiles } from '../pty-host/files';
import { DaemonClocks, DEFAULT_IDLE_EXIT_MS } from './clocks';
import { engineRequests } from './engine-requests';
import { createArtifactsEndpoint, loadEndpointChunk } from './artifacts-endpoint'; // P5 O5 M2
import { ENDPOINT_CHANNEL_BASE, ENDPOINT_STOP_MS, loadEndpointModule, NO_ENDPOINT_MODULE, type CheckoutSource, type DaemonServices, type EndpointModule } from './endpoint-seam';
import { createServicesFront, spineTakes } from './front';
import { runE2eRender, runE2eSeam } from './e2e-seam'; // M5b fix round 2; P5 O5 M4
import { createRenderHandle, loadRenderChunk, type RenderChunk } from './render-handle'; // P5 O5 M4
import type { RenderChild, RenderRuntime, RenderService } from './render-seam'; // types alone: the chunk loads at the first request
import { DEPARTURE_BOUND_MS, Relay, type RelayRequest } from './relay';
import { createLazySpine, loadServicesEntry, type SpineEntry, type SpineTiming } from './spine-seam';
import { SpineReaders } from './spine-readers';
import { discoveryWake } from './discovery-wake';
import { trashPath } from './trash';
import { createCuaSockets, type CuaSockets } from './cua-socket'; // P5 O5 M5
import { browserCapability, createSessionCapabilities } from './session-capabilities'; // P5 O5 M5
import { loadPeerAddon, peerAddonPath, type PeerAddon } from '../main/browser/cua/peer'; // P5 O5 M5: the app's policy, loaded here too

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
  // P5 O5 M4: the render seam's chunk, the render host's spawn and the runtime's report (a fake host and platform)
  render?: { load?(): Promise<RenderChunk>; spawn?(): RenderChild; runtime?(): RenderRuntime };
  cua?: { loadAddon?: () => PeerAddon | null; relayConnectWaitMs?: number }; // P5 O5 M5: the peer identity addon's load (a double), the relay's wait
}

export interface RunningDaemon {
  paths: DaemonPaths;
  ref: MachineRef;
  hosts: HostSupervisor;
  services: DaemonServices;
  projects: CheckoutSource; // the endpoint's injected source of MAWS's own projects
  status(): Promise<DaemonStatus>;
  stop(reason: string, code?: number): Promise<void>; // the exit order; a second call joins the first
  render: RenderService; // P5 O5 M4 (Interfaces §G): the library's Export as artifacts.export runs it, for O4's Send to
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
  // P5 O2 (the bundle swap): an upgrade replaces the bundle under a running daemon, whose module paths then name the new
  // bundle's files. So before each host spawn, and each deferred chunk's load that would read the files as they are now
  // (from a directory: a checkout's out/main; from an app.asar it reads the archive this process holds, the build it
  // started from), the entry this daemon started from is read again past any held archive: another build there spawns
  // and loads nothing, and counts no crash. A unit daemon restarts (its unit starts the new bundle's mawsd, which adopts
  // the running hosts); a private one keeps serving what runs and refuses what needs new code, until the next app's
  // build check restarts it. The hosts' build ids, which a hello presents, are read now, while they are this build's.
  const entryOnDisk = realpathOr(options.modules.self); // a Linux unit's entry names `current`, which an install flips
  const bundleReplaced = (): string | null => {
    const now = currentBuildIdOf(entryOnDisk);
    if (now === buildId) return null;
    const reason = `mawsd's bundle was replaced: ${entryOnDisk} ${now === null ? 'is gone' : `is build ${now}`}, this mawsd runs build ${buildId}; ${kind === 'unit' ? 'mawsd restarts into the new bundle' : 'the next app to attach restarts mawsd'}`;
    if (kind === 'unit') void stop('bundle replaced', EXIT_RESTART);
    return reason;
  };
  const deferredLoadRefused = () => (packaged ? null : bundleReplaced());
  for (const host of [options.modules.engineHost, options.modules.ptyHost]) {
    try {
      buildIdOf(host); // cached for the hello
    } catch {
      // read at the hello, as before
    }
  }
  const endpoint = options.endpoint === undefined ? loadEndpointModule(buildId, { projects }, deferredLoadRefused) : options.endpoint;
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
    detached: { env: () => env, log: (line) => log(`[hosts] ${line}`), beforeSpawn: bundleReplaced, ...options.detached },
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
    load: () => {
      const refused = deferredLoadRefused(); // P5 O2 (the bundle swap, above)
      return refused === null ? (options.spine?.load ?? loadServicesEntry)() : Promise.reject(new Error(refused));
    },
    deps: () => ({
      profile: profileDir,
      machine: ref,
      bus: front.bus,
      clientPort: front.port, // §E: the asking client's connection, or the attached app's
      interest: () => new Set(union()),
      // P5 O5 M5: the daemon's own socket for the session, stable for its life, listening while a tab engine is attached
      // (the app's machine.client) and relayed to it; P5 O3-D M5b told the app's own, absent while no app was attached
      browserSocket: (appSessionId) => browserSocketFor(appSessionId),
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
    // P5: a command waits on the engine host (the session service's boot, for its first streaming). The park clock starts
    // again from the need, and a host that is not streaming is sent a ping, which the supervisor holds while the host
    // starts or closes and for which it launches a parked one.
    needEngine: () => {
      clocks.engineNeeded();
      if (hosts.streaming('engine-host')) return;
      log(`[spine] a command waits on the engine host, which is ${hosts.parked('engine-host') ? 'parked' : hosts.snapshot('engine-host').state}: waking it`);
      void hosts.dispatch('engine-host', 'engine.ping', undefined).then((result) => {
        if (!result.ok) log(`[spine] the wake's engine.ping failed: ${result.error.message}`);
      });
    },
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
    // a provisional yield waits as long as a hello may wait for its upstream (the relay's hold)
    timing: { ...(options.helloHoldMs !== undefined && { provisionalYieldMs: options.helloHoldMs }), ...options.spine?.timing },
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

  // P5 O5 (landing 1; engine-requests.ts): a client's request to the engine host (the front's, the endpoint's, the artifact
  // endpoint's, the render seam's answers) is a need, holds the park off while in flight, and one sent after the park's
  // ask waits for that host's exit, so none is sent to a host leaving under it
  const clientEngine = engineRequests({ hosts, clocks, log });

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
  let appReadsMachine = false; // its hello listed machine.spine: its events come on machine.sock, not on the relay
  let toldPresent = false; // the last attachment told the permanent link's host
  // P5 O5 M4 (Interfaces §F): `render: true` to a host whose welcome lists host.render, an older one never hearing the field
  const engineHostRenders = () => hosts.peer('engine-host')?.capabilities.includes(HOST_RENDER_CAPABILITY) ?? false;
  const tellAttachment = (attached: boolean): Promise<void> => {
    if (hosts.parked('engine-host')) return Promise.resolve();
    const input = engineHostRenders() ? { attached, render: true } : { attached };
    return hosts.forward('engine-host', { name: 'host.attachment', input }).then((answer) => {
      if (!answer.ok) log(`host.attachment {attached: ${attached}} failed: ${answer.error.message}`);
    });
  };
  // P5 O3-D fix wave (scalpel-4#1; D40): the app is present while the connection that receives its events can: the relay
  // for an app that hears them there, machine.sock once that app's connection there said ready for one that reads them
  // there (the front drops an event until then). A machine.sock-only departure is a departure for the host: its
  // app-bound requests settle noClient and its holds go, as at the relay's.
  const appPresent = () => appOnEngine && (!appReadsMachine || front.appReady());
  const presenceChanged = () => {
    const present = appPresent();
    if (!permanentLink || present === toldPresent) return;
    toldPresent = present;
    void tellAttachment(present);
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
    attached: (app) => {
      clocks.engineAttached(true); // disarms a park first
      setInterest('app', []);
      // before anything of the app's is forwarded; an app it replaced departs first (the relay calls no departed() for
      // it), so its route E, direct operations and holds end and the new one is the owner back, on the same connection;
      // one that reads its events on machine.sock is told once that connection is ready (presenceChanged)
      if (permanentLink && toldPresent) {
        toldPresent = false;
        void tellAttachment(false);
      }
      appOnEngine = true;
      appReadsMachine = app.capabilities.includes(MACHINE_SPINE_CAPABILITY);
      engineAppPid = null; // the replaced app's: this one's comes with its welcome (onClient), just after
      if (permanentLink) presenceChanged();
      else availability(true);
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
      appOnEngine = false;
      if (permanentLink) {
        toldPresent = false;
        departure = tellAttachment(false); // told even when it was not present: its answer ends the drain
      } else availability(false);
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
  // P5 O5 M4: the engine-host link's losses, as the embedded root counts them (src/main/artifacts/index.ts's hostLosses):
  // the render host's `hostGeneration`, posted at each loss, before the loss's failed requests are answered (the
  // supervisor fails them before it tells the state, and their answers go out after this), so a dashboard export whose
  // read the loss refused captures again once, whenever the next host welcomes
  let renderGeneration = 0;
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
      renderGeneration += 1;
      front.postRender('render.hostGeneration', { generation: renderGeneration }); // P5 O5 M4: at the loss, above
      each(upstreamListeners, { connected: false, generation }); // after every endpoint channel's `upstream` close (doc-relay)
    }
    if (!ready && recycling === 0) engineRelay.dropApp(`the engine host is ${state.state}`);
    if (!ready) return;
    // P5 O3-D M3: a permanent link is ready by its own resync (D8): said at once, the loaded spine's resync then runs at
    // the streaming in the seam's adapter, what arrives meanwhile held; a recycled one waits for the app's ready line,
    // and what is available follows the app again (a permanent link replaced by an older host's)
    if (permanentLink) hosts.sayReady('engine-host');
    else if (available !== engineRelay.attachedApp()) availability(engineRelay.attachedApp());
    sessionCapabilities.refresh(); // P5 O5 M5: whether this engine host renders (its welcome) reads in the render entries
  });
  hosts.onStreaming('engine-host', () => {
    if (permanentLink && !available) availability(true); // P5 O3-D M3: events are available from here on, with or without an app
    // P5 O5 M4 (§F): each streaming of the permanent link (the first, and each after an engine host's restart, whose
    // signal resets at connect), so a machine where no app ever attaches has the render gate open
    if (permanentLink && engineHostRenders()) {
      toldPresent = appPresent();
      void tellAttachment(toldPresent);
    }
  });
  hosts.onRaw('engine-host', (message) => {
    if (render.event(message.name, message.payload)) return; // P5 O5 M4: the render seam answers it, no client hears it
    if (message.name === 'session.status') engineSeen(message.payload); // P5 O5 M5: the cua socket's peer check
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
      artifacts: artifacts.status(), // P5 O5 M2
      render: render.status(), // P5 O5 M4
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
      case 'daemon.e2eRender':
        return runE2eRender(input as CommandInput<'daemon.e2eRender'>, e2eSeamsAllowed, (request) => render.captureForE2e(request)); // P5 O5 M4
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
    waking: () => clocks.discoveryWaking(),
    parkNow: () => clocks.parkNow(),
    log,
  });

  // --- the render seam (P5 O5 M4; render-handle.ts, render-seam.ts): its chunk loaded at the first request ----------------
  const RENDER_AUTHORS_SPINE_WAIT_MS = 10_000; // an export's wait for a cold spine's session titles (its comment authors)
  const machine = machineName(env, hostname());
  const renderQuietMs = positiveInteger(env.MAWS_RENDER_QUIET_MS); // the measured scene's quiet period
  const answerEngine = async (name: 'maws.artifact.captured' | 'maws.artifact.exported', input: unknown) => {
    const answer = await clientEngine.forward('engine-host', { name, input });
    if (!answer.ok) {
      log(`[render] ${name} failed: ${answer.error.message}`);
      return null;
    }
    return (answer.value as { outcome: 'delivered' | 'not_pending' }).outcome;
  };
  // the render runtime on this machine: a Mac with the app binary always has it; Linux's is M6's
  const renderRuntime = options.render?.runtime ?? ((): RenderRuntime => (platform === 'darwin' ? { available: true } : { available: false, reason: `the render runtime is not installed on ${machine}` }));
  const render = createRenderHandle({
    machine,
    load: () => {
      const refused = deferredLoadRefused(); // P5 O2 (the bundle swap, above)
      return refused === null ? (options.render?.load ?? loadRenderChunk)() : Promise.reject(new Error(refused));
    },
    compose: (chunk) => ({
      machine,
      spawn:
        options.render?.spawn ??
        (() => {
          const replaced = bundleReplaced(); // as the hosts' beforeSpawn: another build's binary renders nothing for this one
          if (replaced !== null) throw new Error(replaced);
          return chunk.spawnRenderHost(chunk.renderCommand({ platform, packaged, execPath, appRoot: join(dirname(options.modules.self), '..', '..'), profile: profileDir, env }), log);
        }),
      post: (request) => front.postRender('render.request', request),
      postExit: () => front.postRender('render.exit', {}),
      answerEngine,
      quietMs: () => renderQuietMs ?? chunk.DEFAULT_QUIET_MS,
      runtime: renderRuntime,
      engineHostRenders,
      appAttached: () => appPresent(),
      // the session titles a document's comments name are the spine's records: a cold or released spine is loaded for
      // the export (a trigger, never at idle: acceptance 14), waited for at most RENDER_AUTHORS_SPINE_WAIT_MS of the
      // request's time, the render host's start meanwhile; else the exporters' own label, logged
      authors: async () => {
        let root = spine.root();
        if (root === null) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          root = await Promise.race([
            spine.ensure('command').catch((error: unknown) => (log(`[render] the spine did not load for an export's comment authors: ${error instanceof Error ? error.message : String(error)}`), null)),
            new Promise<null>((resolve) => (timer = setTimeout(() => (log(`[render] the spine did not load within ${RENDER_AUTHORS_SPINE_WAIT_MS / 1000} s for an export's comment authors`), resolve(null)), RENDER_AUTHORS_SPINE_WAIT_MS))),
          ]);
          clearTimeout(timer);
        }
        const view = root?.view;
        return chunk.renderAuthors(settingsPaths(profileDir).client, view && view.unavailable() === null ? view.records() : null);
      },
      hold: (reason) => services.hold(reason),
      // P5 O5 M5: a session's render entries follow the seam's state; an unavailable seam reads available again once its
      // window has passed, with no state change of its own, so the reading is taken again then
      onState: (state) => {
        sessionCapabilities.refresh();
        if (state === 'unavailable') setTimeout(() => sessionCapabilities.refresh(), chunk.FAILURE_WINDOW_MS + 100).unref();
      },
      log,
    }),
    answerEngine,
    facts: () => ({ machine, runtime: renderRuntime(), engineHostRenders: engineHostRenders(), appAttached: appPresent() }), // P5 O5 M5
    log,
  });

  // --- the cua sockets and the session capabilities (P5 O5 M5; cua-socket.ts, session-capabilities.ts) -----------------
  const cuaDir = cuaSocketDir(profileDir, options.tmp ?? tmpdir());
  let cua: CuaSockets | null = null; // made at step (6), with the other sockets
  const launchedHere = new Set<AppSessionId>(); // told to a launch: kept past its engine's exit (its next launch names it)
  const sessionCapabilities = createSessionCapabilities({
    render: () => render.capabilities(),
    browser: (appSessionId) => browserCapability({ machine, appSessionId, path: daemonCuaSocketPath(cuaDir, appSessionId), tabEngine: cua?.tabEngine() ?? null }),
    emit: (appSessionId, capabilities) => void front.bus.emit('session.capabilitiesChanged', { appSessionId, capabilities }),
  });
  // The attached app's cua directory, as its machine.client said it (none while no app is attached): the sockets listen
  // or stop; and whatever a session's capabilities read may have changed with it
  const followTabEngine = () => {
    if (stopping !== null) return; // the exit closes the sockets and the clients: no flip to tell
    cua?.target(front.browserSocket());
    sessionCapabilities.refresh();
  };
  const browserSocketFor = (appSessionId: AppSessionId): string | null => {
    const path = cua?.ensure(appSessionId) ?? null;
    if (path === null) return null;
    launchedHere.add(appSessionId);
    sessionCapabilities.track(appSessionId);
    return path;
  };
  // Each raw session.status names the session's engine for the peer check (never the spine's view, so a browser
  // connection loads nothing); one that runs sets up its socket (an engine that outlived a daemon keeps the path it was
  // told, D-16), and an exited one whose socket no launch of this daemon was told gives it up (a trust bootstrap's).
  const engineSeen = (payload: unknown) => {
    const { appSessionId, status } = (payload ?? {}) as { appSessionId?: unknown; status?: { process?: unknown; pid?: unknown } };
    if (cua === null || typeof appSessionId !== 'string' || typeof status !== 'object' || status === null) return;
    const id = appSessionId as AppSessionId;
    const running = status.process !== 'exited';
    if (running && cua.ensure(id) !== null) sessionCapabilities.track(id);
    cua.engineProcess(id, running && typeof status.pid === 'number' ? status.pid : null);
    if (!running && !launchedHere.has(id)) {
      cua.remove(id);
      sessionCapabilities.forget(id);
    }
  };
  const sessionRemoved = (appSessionId: AppSessionId) => {
    launchedHere.delete(appSessionId);
    cua?.remove(appSessionId);
    sessionCapabilities.forget(appSessionId);
  };

  // --- the services front (P5 O3-D M2, M4; front.ts): machine.sock's commands, events, streams and client port --------
  let engineAppPid: number | null = null; // the app welcomed on engine-host.sock: the port's requests with no client go to its machine.sock connection
  const front = createServicesFront({
    spine,
    hosts: { forward: clientEngine.forward, onRaw: hosts.onRaw, onStreaming: hosts.onStreaming, parked: hosts.parked }, // P5 O5: forward through the park's guard
    intercept: (request) => interceptEngine(request),
    daemon: daemonCommand,
    identity: () => {
      const name = machineName(env, hostname());
      return { ref, name, project: machineProject(ref, name, enrollment()) };
    },
    isApp: (appPid) => engineAppPid !== null && engineRelay.attachedApp() && appPid === engineAppPid,
    readiness: () => presenceChanged(),
    beforeSpineCommand: wakeForDiscovery,
    // P5 O5 M4: a render client hears the engine-host link's loss count at its ready, before any work (and at each loss,
    // onState above), so its dashboard exports capture again once across an engine host's restart
    render: { ...render.front, clientReady: () => (front.postRender('render.hostGeneration', { generation: renderGeneration }), render.front.clientReady()) },
    // P5 O5 M5: a session asked about is followed from then on, so the asker hears its next flip (forgotten at its removal)
    capabilities: (appSessionId) => (sessionCapabilities.track(appSessionId), sessionCapabilities.of(appSessionId)),
    browserChanged: followTabEngine, // P5 O5 M5
    log,
  });
  front.events((name, payload) => each(eventListeners, 'machine', { name, payload })); // the endpoint's owner `machine`
  // P5 O5 M5: a removed session's cua socket goes with it
  front.events((name, payload) => {
    if (name === 'session.removed') sessionRemoved((payload as { appSessionId: AppSessionId }).appSessionId);
  });

  // --- the artifact endpoint (P5 O5 M2; artifacts-endpoint.ts): resolved through the engine host, never the spine -------
  const artifacts = createArtifactsEndpoint({
    content: async (input) => {
      const answer = await clientEngine.forward('engine-host', { name: 'artifacts.content', input });
      return (answer.ok ? { ok: true, value: answer.value } : { ok: false, error: answer.error }) as CommandResult<'artifacts.content'>;
    },
    load: () => {
      const refused = deferredLoadRefused(); // P5 O2 (the bundle swap, above)
      return refused === null ? loadEndpointChunk() : Promise.reject(new Error(refused));
    },
    log: (line) => log(`[artifacts] ${line}`),
  });

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
      // P5 O7 M2: the asker goes as a ref, so the endpoint channel's end reaches the host as its clientGone
      if (host === 'engine-host') return clientEngine.forward(host, { name, input: sent, ...(client && { client }) });
      // the pty host it woke stays up for the request (a spawn), and parks after it if nothing lives and no app is on
      ptyRequests += 1;
      try {
        return await hosts.forward(host, { name, input: sent, ...(client && { client }) });
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
    artifacts: { fetch: (request) => artifacts.fetch(request) }, // P5 O5 M2
    log: (line) => log(`[endpoint] ${line}`),
  };

  // --- (6) the sockets --------------------------------------------------------------------------------------------------
  const servers: Server[] = [];
  let engineClients: SocketClients | null = null;
  let ptyClients: SocketClients | null = null;
  let machineClients: SocketClients | null = null;
  const clientsChanged = () => {
    clocks.relaysBetween(engineRelay.between() || ptyRelay.between());
    // P5 O5 M4: a render client is no client for the clocks (the seam holds the daemon while a request is in flight)
    clocks.clients(Number(engineRelay.attachedApp()) + Number(ptyRelay.attachedApp()) + (machineClients?.count() ?? 0) - front.renderClients());
    followTabEngine(); // P5 O5 M5: the attached app (and with it the tab engine) may have come or gone
  };
  const counts = (host: 'engine-host' | 'pty-host') => () => {
    const welcome = hosts.welcome(host);
    return { liveSessions: welcome?.liveSessions ?? 0, rows: welcome?.rows ?? 0 };
  };
  try {
    if (paths.socketDir !== dir) makePrivateDirectory(paths.socketDir);
    // P5 O5 M5: the cua sockets' directory (in the fallback directory when its own paths would not fit), and the peer
    // check's addon from the app's Resources as the app loads it (process.resourcesPath is Electron's, absent here),
    // loaded at the first session's socket, never at start: an idle mawsd holds no native addon (acceptance 14)
    const appPath = join(dirname(options.modules.self), '..', '..');
    const loadAddon = options.cua?.loadAddon ?? (() => loadPeerAddon(peerAddonPath({ packaged, resourcesPath: dirname(appPath), appRoot: appPath })));
    cua = createCuaSockets({
      dir: cuaDir,
      loadAddon: () => {
        const addon = loadAddon();
        if (addon === null) log(platform === 'darwin' ? '[cua] the peer identity addon did not load: every cua connection will be refused (run scripts/build-peer-auth.sh)' : '[cua] no peer identity addon on this platform: the uid is the cua sockets\' boundary');
        else log('[cua] the peer identity addon loaded');
        return addon;
      },
      uidBoundary: platform !== 'darwin',
      log,
      onChange: () => sessionCapabilities.refresh(),
      ...(options.cua?.relayConnectWaitMs !== undefined && { relayConnectWaitMs: options.cua.relayConnectWaitMs }),
    });
    const engineServer = createServer({ allowHalfOpen: options.halfOpen ?? true });
    engineClients = serveSocketClients(engineServer, {
      runtime: engineRelay,
      badToken: 'close',
      admitHello: (peer, appPid) => engineRelay.admit(peer, appPid),
      onClientEnd: () => engineRelay.ended(),
      onClient: (connected, peer, appPid) => {
        engineAppPid = connected ? (appPid ?? null) : null;
        presenceChanged(); // its machine.sock connection may be ready already
        announced(connected, peer, appPid);
        followTabEngine(); // P5 O5 M5: the app the front names as attached is this pid's
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
      [artifacts.server, paths.artifactsSocket], // P5 O5 M2
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
      await render.stop(); // P5 O5 M4: its refusals over the engine-host link, which the spine's stop ends; then its host ended (bounded)
      await spine.stop(); // a loaded spine's work settled, the engine link drained into it (endLink), its parts stopped (bounded: the exit ends what is left)
      for (const clients of [engineClients, ptyClients, machineClients]) clients?.closeClient();
      artifacts.close(); // P5 O5 M2: its connections, a page's load in flight included
      cua?.close(); // P5 O5 M5: every session's socket, its relayed connections with it
      front.close();
      const drained = hosts.stop(); // both hosts keep running: mawsd never stops a session (nothing left to drain once the spine ended the link)
      if (drained) await Promise.race([drained, sleep(CLOSE_GRACE_MS + 250)]);
      if (code !== 1 && lockNamesMe()) {
        for (const path of [...Object.values(paths.sockets), paths.artifactsSocket]) unlinkQuietly(path);
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

  return { paths, ref, hosts, services, projects, status, stop, render: { exportForLibrary: (input) => render.exportForLibrary(input) } };
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

function realpathOr(path: string): string {
  try {
    return fs.realpathSync(path);
  } catch {
    return path;
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
