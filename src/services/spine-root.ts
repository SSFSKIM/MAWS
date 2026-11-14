// The spine's root (P5 O3-C, docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, Interfaces §D; O3 §5, §6): the
// one function that composes the machine's services, from injected dependencies alone. `mawsd` calls it
// (src/mawsd/spine-seam.ts); main's embedded root, which called it until P5 O15 M2
// (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md), is gone, and the app imports nothing of it. It composes settings' machine half (as
// `openSpineData` opened it), the index with its session source, replay and the read model, attention's core, the owner
// channel and mods, the session service with intents, worktrees, prompt history, side threads, yield, observed facts
// and the sweep, the engine host's configure relays, the design-system defaults relay, the library's derived index and
// O9's lane A driver, in the order main composed them, and returns the one view staying code reads them through, and
// its stop. P5 O3-E M2: and, as its last parts, the checkouts (./checkouts-root.ts). P5 O4 M2: and after them the
// connectors (with the engine's MCP sign-in) and the owner's delivery, stopped before the checkouts; M3: the library's
// reads of a stored file and the catalog's machine half beside them.
//
// O3-A's refused run (contract O3X2; O3 Decision Log 11) is the root's: a run that does not hold `spine.lock` opens the
// index unavailable and starts none of the parts that write the machine's files or launch a session (attention's core,
// replays, lane A, the prompt history's commands, the worktree and session services, the owner channel, the sweep,
// yield, side threads, the configure and defaults relays, the retired custody's removal); the read model, the inert index source,
// observed facts and the library still answer, and the view says why the spine cannot be read.
import { rm } from 'node:fs/promises';
import { hostname, totalmem } from 'node:os';
import { join } from 'node:path';
import { isActionable as archiveActionable, waits as archiveWaits } from '@shared/attention/kinds';
import type { ClientPort } from '@shared/client/port';
import { claudeConfigDir } from '@shared/engine/config-dir';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { HostSupervisor } from '@shared/host/host-supervisor';
import { OpLedger } from '@shared/host/op-ledger';
import type { HandlerContext } from '@shared/ipc/client'; // P5 O7 M5c
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import { exportHeldFor } from '@shared/delivery/export-hold'; // P5 O7 M5c
import { machineName, type Enrollment } from '@shared/machine/identity';
import type { ProjectsSource, RegistrySeam } from '@shared/machine/registry'; // the project registry
import type { MachineRef } from '@shared/machine/ref';
import { settingsPaths } from '@shared/settings/paths';
import type { ServicesBus } from '@shared/spine/bus';
import type { MachineSettingsService } from '@shared/spine/machine-settings';
import type { SpineView } from '@shared/spine/view';
import { startArtifactDefaults } from './artifacts/defaults';
import { startCatalogMachine } from './catalog/machine';
import { startCheckouts } from './checkouts-root';
import { startConnectors } from './connectors';
import { fileKeyCustody } from './connectors/custody';
import { listenLoopback, type ListenLoopback } from './connectors/oauth-callback';
import { createRelayedCallbacks } from './connectors/relayed-callback'; // P5 O7 M5c
import { startSignIn } from './connectors/sign-in';
import { startDelivery } from './delivery';
import { uploadRootsOf } from './files/upload';
import { createGitRunner } from './git/runner';
import { WorktreeService } from './git/worktrees';
import { registerWorktreeHandlers } from './git/worktrees-register';
import { PromptHistory } from './history/prompt-history';
import { startIndexAttention } from './index/attention-service';
import { Index } from './index/index';
import { registerIndexHandlers } from './index/register';
import { registerReplayHandlers } from './index/replay';
import { appRoot, seedReplayFixtures } from './index/replay-fixtures';
import { IndexSessionSource } from './index/source';
import { laneAAttention } from './lane-a/attention';
import { sminosHome } from './lane-a/discovery';
import { createLaneADriver, registerLaneA, type LaneAView } from './lane-a/driver';
import { startLibrary } from './library';
import { registerLibraryReads } from './library/files';
import { registerMachineOps } from './machine-ops';
import { registerFolders } from './machine/folders'; // P5 O7 M9
import { registerSetupTrust, type SetupGuard } from './machine/setup'; // P5 O7 M9
import { startOwnerChannel } from './owner/register';
import { startChannel, type ChannelRecorder } from './channel/register'; // P5 O8 M7b
import { startEngineConfigure } from './settings/engine-configure';
import { startHostConfigure } from './settings/host-configure';
import { startMachineSettings } from './settings/machine';
import type { LegacyRoute } from '@shared/engine/route'; // P5 O7 M9
import { legacyOfResolution, machineBaseUrl } from './sessions/machine-route'; // P5 O7 M9
import { sessionSettingsOf } from './settings/session-settings';
import { takeSpineLock, type SpineLock } from './settings/spine-lock';
import { splitSettingsFiles } from './settings/split';
import { readUserEngineDefaults } from './settings/user-engine-defaults';
import { sideThreadEvents, startSideThreads } from './side/side-threads';
import { startSessions, type HeldReplay } from './sessions';
import { transcriptPathOf } from './sessions/context';
import { trashFor } from './sessions/e2e-trash';
import { InactiveArchive, scheduleInactiveArchive } from './sessions/inactive-archive';
import { BootstrapNotes, FileIntentStore } from './sessions/intents';
import { registerObservedFacts } from './sessions/observed';
import { readRecentTurns } from './sessions/recent-turns';
import { ReplaySeam } from './sessions/replay-seam';
import { readRestoredCost } from './sessions/restored-cost';
import { SessionService } from './sessions/service';
import { engineHostSettled, registerSessionServiceHandlers } from './sessions/service-register';
import { registerSpawn } from './sessions/spawn'; // P5 O7 M4
import { createSpineView } from './sessions/spine-view';
import { stopParts, type Part } from './stop-parts';
import { allSettling, Work, type Settling } from './work';
import { startYield } from './sessions/yield';

export interface SpineData {
  readonly lock: SpineLock;
  readonly refused: string | null; // why this run may not write the spine's files; null: it holds spine.lock
  readonly machineSettings: MachineSettingsService; // the machine half (O3X3), from which main composes the client half
  readonly paths: { client: string; machine: string };
  // P5 O7 M9: the engine's environment the machine route's legacy route is resolved under, told by startSpine (its
  // deps' login-shell capture); until then, setting the machine route as the default is refused
  bindEngineEnv?(env: Promise<Record<string, string>>): void;
  readonly systemRoot?: string; // P5 O7 M9: the tests' seam, the root the machine's managed settings are read beneath
}

// O3-A's data start (O3 §2, §3; contracts O3X2, O3X3): `spine.lock` before either settings file is migrated or written
// and before the index opens (startSpine); then, holding it, the split of a unified settings file, once, and the machine
// half. Refused, nothing is migrated and the machine half is read, never written. The lock is held for the process's
// life: released at its exit, never at a shutdown step, since the steps' promises settle after the last step is called
// and a writer still finishing (an intent's rename) must not run beside a candidate that took the lock.
// P5 O3-D M2 (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §A, D26): a process that loads the spine
// more than once (`mawsd`) takes the lock once itself (`takeSpineLock`) and opens each load's data under it (`lock`),
// since the lock refuses this very process's second take; with none given, the one-shot form above (main's).
export async function openSpineData(profile: string, { build, lock: given, systemRoot }: { build: string; lock?: SpineLock; systemRoot?: string }): Promise<SpineData> {
  const paths = settingsPaths(profile);
  const lock = given ?? (await takeSpineLock(profile, { build }));
  if (!given) process.once('exit', lock.release);
  const split = lock.refused === null ? splitSettingsFiles(paths) : null;
  // P5 O7 M9: choosing `machine` writes, as the legacy field an older build here reads, the legacy route of the machine's
  // base URL resolved with no project (the user and managed settings, the global config, the engine's environment);
  // an uncertain resolution keeps the field as it is
  let engineEnv: Promise<Record<string, string>> | null = null;
  const legacyOfMachine = async (): Promise<LegacyRoute> => {
    if (engineEnv === null) throw new Error('The machine route is not set as the default yet: the engine’s environment is still being read.');
    return legacyOfResolution(await machineBaseUrl({ env: await engineEnv, systemRoot }, { cwd: null }), machineSettings.state().gateway.defaultRoute);
  };
  const machineSettings = startMachineSettings(paths.machine, { refused: lock.refused ?? split?.machineRefused ?? null, unsplit: split?.unsplit, legacyOfMachine });
  return { lock, refused: lock.refused, machineSettings, paths, bindEngineEnv: (env) => void (engineEnv = env), ...(systemRoot !== undefined && { systemRoot }) };
}

// P5 O3-D M2: `replay`, a host adapter that replays what it held while the spine loaded (mawsd's; sessions/index.ts).
// P5: `need`, a command waits on the engine host (mawsd wakes a parked one for it; main's host is never parked).
export type SpineHosts = Pick<HostSupervisor, 'dispatch' | 'onEvent' | 'onState' | 'onStreaming' | 'streaming' | 'snapshot' | 'setResync'> & { replay?: HeldReplay; need?(): void; handoverState?: HostSupervisor['handoverState'] /* O16 panel 1 */; peer?: HostSupervisor['peer'] /* P5 O7 M9: the engine host's welcome, for its capabilities */ };

export interface SpineDeps {
  profile: string; // <userData>, the daemon's profile (O3 §1)
  machine: MachineRef; // this machine
  data: SpineData;
  hosts: SpineHosts; // the engine host
  bus: ServicesBus;
  clientPort: ClientPort; // OX4
  interest(): ReadonlySet<AppSessionId>; // the machine's interest union (OX5), read by the sweep at each check
  browserSocket(appSessionId: AppSessionId): string | null; // the cua socket a launch is told (E13); O5's
  trash(path: string): Promise<void>; // the OS trash; the root applies the e2e seam (trashFor) itself
  engineEnv: Promise<Record<string, string>>; // the login-shell capture (captureShellEnvironment), as it types it
  env: NodeJS.ProcessEnv;
  packaged: boolean;
  appPath: string; // the app's code (Electron's app.getAppPath()): replay fixtures' checkout
  devRoot: string; // the development app root: a scenario's relative path
  home: string;
  enrollment?: () => Enrollment | null; // the machine's (mawsd: its endpoint's in process, D38); main's root has none
  listenLoopback?: ListenLoopback; // P5 O4 M2: the OAuth callbacks' listener on this machine's loopback; tests give their own
  // the project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §H): what the index asks of
  // the machine's endpoint (mawsd: its endpoint's in process); none, `NO_REGISTRY`: no stored statement is made
  registry?: RegistrySeam;
  // the UX wave (docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, M2): whether the machine's ceiling refuses
  // a session started from another machine in `mode` (mawsd: its endpoint's policy as it stands when asked); a fork from
  // another machine is held to it where it is allocated. None (main's root, which no other machine reaches): every mode
  aboveCeiling?(mode: string): boolean;
}

export interface SpineRoot {
  readonly view: SpineView;
  // P5 O3-D M2 (Interfaces §A, D27): no command or intercept of the spine's running, no session setup, recovery or
  // reconciliation, sweep run, attention write pass or lane A probe in flight (each part reports its own); a release
  // and a yield wait for it before `stop` closes the index. `busy` reads the same facts now.
  settled(): Promise<void>;
  busy(): boolean;
  stop(): void;
  // P5 O3-D M6 (fix round 1; mawsd's discovery wake): whether the index holds the engine host's latest scan, its
  // discoveries applied (IndexSessionSource.discoveryApplied), and each time it comes to. Optional for a stand-in root.
  discovery?: { applied(): boolean; onApplied(listener: () => void): () => void };
  // P5 O8 M7b (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §O): the project channel's journal, to
  // which the endpoint's seam hands lane A's host messages (`EndpointServices.channel`); absent in a run refused the spine.
  channel?: ChannelRecorder;
  // the project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §H): what the machine's
  // endpoint reads of the index (its declared rows and stored statements), which mawsd hands on while the spine is loaded;
  // asked only by mawsd's wiring (src/mawsd/projects-seam.ts), so building a root reads nothing of it
  projects?: () => ProjectsSource;
}

export function startSpine(deps: SpineDeps): SpineRoot {
  const { profile, data, hosts, engineEnv } = deps;
  const machineSettings = data.machineSettings;
  data.bindEngineEnv?.(engineEnv); // P5 O7 M9: the machine route's legacy route resolves under the engine's environment
  const spineRuns = data.refused === null;
  const parts: Part[] = []; // in today's shutdown order (D21), each stopped whatever an earlier one threw
  // P5 O3-D M2: every command and intercept the parts register counted while it runs, and what each part has in flight
  const commands = new Work();
  const bus = countingBus(deps.bus, commands);
  const settling: Settling[] = [commands];

  // C4: the index (<profile>/index.sqlite) answers the record side of session.*, and its session source folds the
  // engine host's store events into it once the host is ready; the read model starts the source (refused unstarted in
  // launch mode scenario) and stops it. P5 O3-A: unavailable, its file never opened, in a run refused the spine.
  const index = new Index(join(profile, 'index.sqlite'), { refused: data.refused, ...(deps.registry === undefined ? {} : { registry: deps.registry }) });
  void index.refreshOrgProjects({ machine: deps.machine, enrollment: deps.enrollment }); // P5 O6 M5: each project's org project, derived again at every start (OX3)
  // the project registry (Interfaces §F.6): a start that failed has its declared folder checked
  if (spineRuns) {
    const offStartFailed = bus.onEmitted('session.setup', ({ appSessionId, outcome }) => {
      if (outcome?.kind === 'error') index.startFailed(appSessionId);
    });
    parts.push(['folder checks', offStartFailed]);
  }
  // P5 O7 M9: a remote setup's home and what the folder list opened, which its handlers check again on this machine
  const setupGuard: SetupGuard = { where: { home: deps.home, platform: process.platform } };
  registerIndexHandlers(index, bus, setupGuard);
  registerFolders(bus.register, setupGuard); // P5 O7 M9: "+ Session"'s folder list on this machine
  const indexSource = new IndexSessionSource(index, hosts, { emit: bus.emit });
  // C3's attention service over the index (its fallback file only when the index cannot be read); none when refused
  const attention = spineRuns
    ? startIndexAttention(index, {
        onEvent: (name, listener) => hosts.onEvent(name, listener),
        onState: (owner, listener) => hosts.onState(owner, listener),
        dispatch: hosts.dispatch,
        emit: bus.emit,
        register: bus.register,
        fallbackFile: join(profile, 'attention.json'),
        seenNow: (id) => indexSource.seenNow(id), // the ruling (2026-10-30): an error a client shows as it arrives is seen, durably
        handingOver: () => hosts.handoverState?.('engine-host')?.state === 'draining', // O16 panel 1: a live handover keeps them
      })
    : null;
  // Replay (C4 M5): run in the engine host; the fixtures table lists the checkout's probe journals (none packaged)
  const replays = spineRuns ? registerReplayHandlers(index, hosts, bus) : null;
  if (index.unavailable === null) seedReplayFixtures(index.fixtures, appRoot(deps.appPath));
  if (replays) parts.push(['replays', () => replays.dispose()]);
  if (attention) parts.push(['attention', () => attention.stop()]);
  if (attention) settling.push(attention.writing);

  // P5 O9 M2, M6 (O3 Decision Log 13): the local lane A driver, the spine's: it writes <profile>/lane-a/ and drives the
  // sessions the index holds, so a run refused the spine starts none and its laneA.* commands have no handler (the
  // renderer starts empty). Each session the index holds for a terminal or a `--bg` job is probed for its sminos bridge,
  // under the sminos home from the process's environment, else the login shell's.
  if (attention) {
    const laneA = createLaneADriver({
      machine: deps.machine,
      home: engineEnv.then((shellEnv) => sminosHome(deps.env, shellEnv)),
      userData: profile,
      // M5: a watched session's jobs are derived from its transcript: the path the index knows, else where the engine writes it
      transcript: async (appId, engineSessionId) => {
        if (index.unavailable !== null) return null;
        const record = index.sessions.get(appId);
        if (record?.engineSessionId !== engineSessionId) return null; // another transcript now: the driver follows the record
        return index.sessions.summaryOf(appId)?.transcriptPath || transcriptPathOf(await engineEnv, record.directory, record.engineSessionId);
      },
      emit: (name, payload) => void bus.emit(name, payload),
    });
    registerLaneA(laneA, bus.register);
    settling.push(laneA.probes);
    // M6: each bridged session's pending requests are attention items, and its digest reads its live state from the bridge
    // while the bridge is live (today's `foreign` otherwise). UX wave U7 (finding 3) and U1a (UC-1): the digest's phase and
    // tool come only from the session's last current view, so before a bridge's first snapshot the digest keeps its seed
    // and inside a reconnect the last snapshot's; its waiting count is, at all times, what the attention list holds as
    // waiting that stops the session (the list is the one holder of an answer the bridge took and has not settled).
    const views = new Map<AppSessionId, LaneAView>(); // each session's last current view
    const bridged = (appId: AppSessionId) => {
      const view = views.get(appId);
      if (view === undefined) return; // no current snapshot yet: the digest keeps what it had
      indexSource.setBridged(appId, { running: view.state.turn.running, pending: laneAItems.stopping(appId), tool: view.tool });
    };
    const laneAItems = laneAAttention({
      set: (appId, entries) => {
        attention.setLaneAItems(appId, entries);
        bridged(appId); // an acceptance or a grace's end changes the list with no new view
      },
    });
    const offLaneAView = laneA.onChange((appId, view) => {
      const live = view !== null && view.state.bridge === 'live';
      if (!live) views.delete(appId);
      else if (view.fresh) views.set(appId, view);
      laneAItems.update(appId, view); // may call `set`, whose `bridged` reads what this view left stored
      if (live) bridged(appId);
      else indexSource.setBridged(appId, null);
    });
    const offLaneAAccepted = laneA.onAccepted((appId, request) => laneAItems.accepted(appId, request));
    parts.push(['lane A attention', () => {
      offLaneAView();
      offLaneAAccepted();
      laneAItems.stop();
    }]);
    if (index.unavailable === null) {
      for (const record of index.sessions.list({ includeArchived: true })) laneA.observe(record);
      const offLaneA = index.sessions.onChange((record, cause) => (cause === 'removed' ? laneA.forget(record.appId) : laneA.observe(record)));
      parts.push(['lane A', () => {
        offLaneA();
        laneA.stop();
      }]);
    } else parts.push(['lane A', () => laneA.stop()]);
  }

  // C5: the read side (launch mode, read model, the stub source in launch mode scenario). A relative scenario path is
  // the development app root's.
  const sessions = startSessions({
    env: deps.env, packaged: deps.packaged, appRoot: deps.devRoot, hosts, bus, indexSource,
    // tracker 2026-09-29: what a resumed process restored, by its transcript's last `cost-state`, from the transcript
    // the index knows for the session, else where the engine writes a launched session's
    restoredCost: async ({ appId, directory, engineSessionId }) => {
      if (engineSessionId === null) return null;
      const known = index.unavailable === null ? index.sessions.summaryOf(appId)?.transcriptPath : null;
      return readRestoredCost(known || (await transcriptPathOf(await engineEnv, directory, engineSessionId)), engineSessionId);
    },
    // E3: a parent's side-thread rows, re-synthesised from the index (none while the index is unavailable)
    appEventsExtra: (appSessionId) => {
      if (index.unavailable !== null) return [];
      try {
        return sideThreadEvents(index, appSessionId);
      } catch (error) {
        console.warn(`[side] ${appSessionId}: the side-thread rows could not be read: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
    },
  });
  const sessionsDir = join(profile, 'sessions');
  const intents = new FileIntentStore(join(sessionsDir, 'intents'));
  let sessionService: SessionService | null = null;
  // The view (Interfaces §B; D9, D10): what the renderer is told, backed by the parts above; its `acquire` the session
  // service's, below, which a refused run does not start
  const spineView = createSpineView({
    mode: sessions.mode,
    model: sessions.model,
    index,
    intents,
    tap: bus.onEmitted,
    acquire: (id, reason) => (sessionService ? sessionService.acquire(id, reason) : Promise.reject(new Error(`MAWS cannot reach its sessions this run: ${data.refused}`))),
  });
  parts.push(['sessions', () => sessions.stop()], ['view', () => spineView.stop()]);
  // P5 O3-D M5b (Interfaces §F): files' admission read for main's mirror of the view on the daemon shape, as the view
  // answers it in process ([] while the index is unavailable)
  bus.register('library.fileLinkedPaths', async ({ appSessionId }) => ({ paths: await spineView.view.fileLinkedPaths(appSessionId as AppSessionId) }));
  // registered after the read model's stop, so the index source has stopped before the index it reads closes
  parts.push(['index', () => index.close()]);

  // C7: the prompt history (MAWS's own file; the terminal's read only) and the resume chooser's preview, under the
  // engine's environment (its config directory, where it writes a session's transcript). D24: they answer the machine's
  // engine configuration and the machine's files.
  const engineConfigDir = engineEnv.then((env) => claudeConfigDir(env, env.HOME || deps.home));
  const userDefaults = async () => readUserEngineDefaults(await engineConfigDir);
  // P2-D: the resume chooser's preview read, from the transcript path the index keeps, else where the engine writes a
  // launched session's transcript (the stub source intercepts it in launch mode scenario)
  bus.register('session.recentTurns', async ({ appSessionId, limit }) => {
    const id = appSessionId as AppSessionId;
    const record = index.unavailable === null ? index.sessions.get(id) : null;
    const known = record ? index.sessions.summaryOf(id)?.transcriptPath : null;
    const path = known || (record?.engineSessionId ? await transcriptPathOf(await engineEnv, record.directory, record.engineSessionId) : null);
    return readRecentTurns(path, limit);
  });
  // a session's record from the read model (both launch modes), else the index; none for an unstarted session
  const recordOf = (appSessionId: AppSessionId) => {
    try {
      return sessions.model.record(appSessionId) ?? index.sessions.get(appSessionId);
    } catch {
      return null; // the index is unavailable
    }
  };
  const history = engineConfigDir.then((configDir) => new PromptHistory({
    file: join(profile, 'prompt-history.jsonl'),
    configDir,
    session: (appSessionId) => {
      const record = recordOf(appSessionId);
      return record && { directory: record.directory, engineSessionId: record.engineSessionId };
    },
  }));
  if (spineRuns) {
    bus.register('session.history.list', async ({ appSessionId, limit }) => ({ entries: await (await history).list(appSessionId as AppSessionId, limit) }));
    bus.register('session.history.append', async ({ appSessionId, display, pastedContents, project }) => (await history).append(appSessionId as AppSessionId, display, pastedContents, project ?? null));
  }

  // C10, P2-C: the worktree service, the owner channel, the session service and the sweep, only while this run holds
  // spine.lock; refused, none starts and their commands have no handler
  let engineConfigure: ReturnType<typeof startEngineConfigure> | null = null;
  let channel: ChannelRecorder | undefined; // P5 O8 M7b
  if (spineRuns) {
    // the worktree service (M2): git.worktree.*, every git mutation MAWS makes, with occupancy from holder authority
    const worktrees = new WorktreeService({ git: createGitRunner(), holders: { dispatch: hosts.dispatch, sessions: index.sessions } });
    registerWorktreeHandlers(worktrees, bus);
    // P2-C: the owner channel's launch half (mods.* over the index, the to-human lane's decision for every launch) and
    // its marks, answers and attention items, over the machine half's settings (D12)
    const ownerChannel = startOwnerChannel({
      index, settings: () => machineSettings.state(), engineEnv, onEvent: (name, listener) => hosts.onEvent(name, listener), register: bus.register,
      attention: attention!, dispatch: hosts.dispatch, onHostState: (listener) => hosts.onState('engine-host', listener), onStreaming: (listener) => hosts.onStreaming('engine-host', listener),
      streaming: () => hosts.streaming('engine-host'), emit: (name, payload) => void bus.emit(name, payload), onSettings: (listener) => machineSettings.onChange(() => listener()),
    });
    parts.push(['owner channel', ownerChannel.stop]);
    settling.push(ownerChannel.work);
    // P5 O8 M7b: the project channel's journal, lane B's entries read from the same batches and the owner channel's states
    const projectChannel = startChannel({ index, onEvent: (name, listener) => hosts.onEvent(name, listener), onEmitted: bus.onEmitted, register: bus.register, emit: bus.emit });
    parts.push(['project channel', projectChannel.stop]);
    channel = projectChannel;
    // The session service (M3): intents, start, fork, archive, delete, rename and the trust check, reading the global
    // config and the store with the environment the engine receives. Its start resets every stale `self` holder at once
    // (D-16), then forgets stale bootstrap ids and reconciles interrupted handoffs once the engine host answers.
    const service = new SessionService({
      index,
      host: {
        dispatch: hosts.dispatch,
        onEvent: (name, listener) => hosts.onEvent(name, listener),
        ready: () => engineHostSettled(hosts),
        onReady: (listener) => hosts.onStreaming('engine-host', listener), // E10: a recovery deferred while the host was unreachable
        need: () => hosts.need?.(),
        capabilities: () => hosts.peer?.('engine-host')?.capabilities ?? null, // P5 O7 M9: engine.route-machine
      },
      git: createGitRunner(),
      worktrees,
      intents,
      bootstraps: new BootstrapNotes(join(sessionsDir, 'bootstraps')),
      userData: profile,
      env: engineEnv,
      emit: bus.emit,
      trash: trashFor(deps.env, deps.trash), // the e2e seam (MAWS_E2E_TRASH_DIR) or the OS trash
      port: deps.clientPort, // session.revealPath
      replay: ReplaySeam.fromEnv(deps.env, deps.devRoot), // the e2e seam (MAWS_E2E_REPLAY_FIXTURES)
      settings: () => sessionSettingsOf(machineSettings.state(), machineSettings.defaultRoute()), // C11: the route, the relay policy and the subagent model; P5 O7 M9: the machine's default route
      userDefaults, // W3: the user's defaultMode seeds a new intent's mode (read only)
      launchGate: () => engineConfigure!.launchGate(), // C12: a launch waits for the host to hold the binary settings name
      browserBackend: deps.browserSocket, // E13
      ownerChannel: ownerChannel.launches, // P2-C
      acquisitions: sessions.model, // P2-A (X16): the digest's availability follows each acquisition
      systemRoot: data.systemRoot, // P5 O7 M9: the machine route's managed settings (the tests' seam)
      ...(deps.aboveCeiling === undefined ? {} : { aboveCeiling: deps.aboveCeiling }), // the UX wave (U9, M2)
    });
    const unintercept = registerSessionServiceHandlers(service, bus, sessions.mode); // P5 O3-D M4: the rewind repair's intercepts in launch mode index only
    registerSpawn(bus, { sessions: service, projects: () => index.projects.list({ includeHidden: true }) }); // P5 O7 M4: a spawn from another device
    registerSetupTrust(bus.register, service, setupGuard); // P5 O7 M9: a remote setup's trust read, guarded
    sessionService = service;
    settling.push(service.work);
    // The sweep keeps the machine's interest union (D11): on the embedded shape main's interest report's set
    const inactiveArchive = new InactiveArchive({
      index, git: createGitRunner(), status: (id) => sessions.model.engineStatus(id),
      waiting: (id) => sessions.model.attention(id).some((item) => archiveWaits(item) && archiveActionable(item)),
      archive: (id, eligible, stillEligible) => service.archive(id, { onlyIfIdle: true, eligible, stillEligible }),
      discovered: (engineSessionId) => indexSource.discoveryCurrent(engineSessionId), // a closed app's CLI use is read first
      interest: deps.interest,
      activity: (id) => {
        const digest = sessions.model.digest(id);
        const times = [digest?.turnStartedAt, digest?.lastTurnEndedAt].flatMap((at) => at ? [Date.parse(at)] : []).filter(Number.isFinite);
        return times.length ? Math.max(...times) : null;
      },
    });
    // P5 O3-D M2: a sweep's run counted to its end, whether a command or its schedule started it
    const sweeping = new Work();
    settling.push(sweeping);
    const sweep: Pick<InactiveArchive, 'ready' | 'run'> = { ready: () => inactiveArchive.ready(), run: (...args) => sweeping.track(inactiveArchive.run(...args)) };
    bus.register('session.archiveOlder', ({ days, projectId }) => sweep.run(days, projectId as ProjectId | null));
    parts.push(['inactive archive', scheduleInactiveArchive(sweep, () => machineSettings.state().sessions.archiveInactiveDays, (changed) => machineSettings.onChange(() => changed()), (scanned) => indexSource.onScanned(scanned))]);
    service.start().catch((error: unknown) => console.error('[sessions] the session service failed to start:', error));
    parts.push(['session service', () => (unintercept(), service.dispose())]); // P5 O3-D M2: a startup still waiting resumes into nothing
  }
  registerObservedFacts(hosts.dispatch, bus); // P2-A (X17): the engine host's observed facts, beside session.digests
  // W7: a live MAWS process yields when a terminal or job that resumed its session starts writing into it; E3: each
  // live turn end of a side thread summarises it in its parent's transcript. Neither in a run refused the spine.
  if (spineRuns) {
    parts.push(['yield', startYield({ dispatch: hosts.dispatch, onEvent: (name, listener) => hosts.onEvent(name, listener), sessions: index.sessions, emit: bus.emit })]);
    parts.push(['side threads', startSideThreads({ onEvent: (name, listener) => hosts.onEvent(name, listener), emit: bus.emit, sessions: index.sessions, sideThreads: index.sideThreads })]);
  }

  // C11, C12, E10: the machine settings' relays to the engine host (engine.configure and the budget's policy, the idle
  // time, the design-system defaults), over the machine half (D12). A run refused the spine pushes none, so nothing it
  // read before the holder changed a setting overwrites what the holder pushed; nor does it remove anything here.
  // W13: custody of a pinned copy is retired; the copy an earlier run kept under <profile>/engine/ is removed.
  if (spineRuns) void rm(join(profile, 'engine'), { recursive: true, force: true }).catch((error: unknown) => console.warn('[engine] could not remove the retired custody copy', error));
  const onMachineSettings = (listener: (settings: ReturnType<MachineSettingsService['state']>) => void) => machineSettings.onChange(listener);
  if (spineRuns) {
    const configure = startEngineConfigure({
      settings: () => machineSettings.state(),
      onSettingsChanged: onMachineSettings,
      hostState: () => hosts.snapshot('engine-host'),
      onHostState: (listener) => hosts.onState('engine-host', listener),
      dispatch: (config) => hosts.dispatch('engine-host', 'engine.configure', config) as Promise<CommandResult<'engine.configure'>>,
      dispatchPolicy: (policy) => hosts.dispatch('engine-host', 'engine.policy.set', policy) as Promise<CommandResult<'engine.policy.set'>>,
      totalMemBytes: totalmem(),
    });
    engineConfigure = configure;
    parts.push(['engine configure', configure.stop]);
    parts.push(['host configure', startHostConfigure({
      settings: () => machineSettings.state(),
      onSettingsChanged: onMachineSettings,
      hostState: () => hosts.snapshot('engine-host'),
      onHostState: (listener) => hosts.onState('engine-host', listener),
      dispatch: (input) => hosts.dispatch('engine-host', 'host.configure', input) as Promise<CommandResult<'host.configure'>>,
      env: deps.env,
    })]);
  }
  // P5 O3-D M5b (Interfaces §G; contract O3X3): the machine half as main's settings mirror reads it on the daemon shape:
  // the settings with their revision (bumped at each persisted change), a patch answered once it persisted and every
  // listener was told (refused, with nothing changed, in a run that may not write the file), and each change emitted
  // P5 O7 M9: each answer and change with the resolved default route; a set's `defaultRoute` chosen after its patch (a
  // set of the default alone writes no patch, so it is told once)
  let machineRevision = 0;
  const offMachineChanged = machineSettings.onChange((settings) => {
    machineRevision += 1;
    bus.emit('machineSettings.changed', { settings, defaultRoute: machineSettings.defaultRoute() });
  });
  parts.push(['machine settings', offMachineChanged]);
  bus.register('machineSettings.get', () => ({ settings: machineSettings.state(), version: machineRevision, defaultRoute: machineSettings.defaultRoute() }));
  bus.register('machineSettings.set', async ({ patch, defaultRoute }) => {
    if (defaultRoute === undefined || Object.keys(patch).length > 0) await machineSettings.update(patch);
    if (defaultRoute !== undefined) await machineSettings.setDefaultRoute(defaultRoute);
    return { settings: machineSettings.state(), defaultRoute: machineSettings.defaultRoute() };
  });
  // C12: the Settings tab's read of the configuration the spine holds for it (P5 O3-A: rejects when refused); W3
  bus.register('settings.engineApplied', () => (engineConfigure ? engineConfigure.applied() : Promise.reject(new Error(`the engine settings are not applied this run: ${data.refused}`))));
  bus.register('settings.userEngineDefaults', userDefaults);
  // D23: the design-system defaults, the machine's settings relayed to the engine host's store
  if (spineRuns) parts.push(['design-system defaults', startArtifactDefaults({
    settings: () => machineSettings.state(),
    onSettingsChanged: onMachineSettings,
    hostState: () => hosts.snapshot('engine-host'),
    onHostState: (listener) => hosts.onState('engine-host', listener),
    dispatch: (input) => hosts.dispatch('engine-host', 'artifacts.setDefaults', input) as Promise<CommandResult<'artifacts.setDefaults'>>,
  })]);
  // P3-L M1 (D22): the library's derived index kept right against the engine host's store, and library.list, .get,
  // .spaces and library.changed answered from it. It stops in the same pass as the index's close, so no sync step runs
  // between them, and after it applies nothing.
  parts.push(['library', startLibrary({ index, hosts, register: bus.register, emit: bus.emit, e2e: deps.env.MAWS_E2E === '1' }).stop]);
  // P5 O3-D M4 (Interfaces §H; O3X7): the services' operation ledger, a spine file under the lock, none in a refused run;
  // a remote act on the spine is claimed and run once through it (machine-ops.ts)
  // P5 O7 M4: a claim the last process left with no result is orphaned; a spawn's is read back from the record it launched
  if (spineRuns) {
    const ledger = OpLedger.open(profile, 'spine-ops.jsonl', { log: (line) => console.warn(`[spine-ops] ${line}`), orphanAtOpen: true });
    registerMachineOps(bus, ledger, (name, opId) => {
      if (name !== 'session.spawn') return null;
      let launched;
      try {
        launched = index.sessions.getByLaunchOp(opId);
      } catch {
        return null; // an index this run cannot read says nothing: the spawn stays unknown
      }
      return launched === null ? null : { ok: true, value: { status: 'ok', appSessionId: launched.appId } };
    });
  }

  // P5 O3-E M2 (docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, Interfaces §D; D4): the checkouts (git's read
  // service and watcher, `git.lsFiles`, files and scm) over the in-process view and the counting bus, composed in a run
  // refused the spine too (they write no spine file but the upload roots' record, which a refused run does not give
  // them) and stopped last, as main's shutdown stopped them after the spine;
  // their acts are claimable by machine.op above, and a release or a yield waits for scm's runs in flight (D14)
  // M3 (Interfaces §F): files.upload's root record, a spine file under the lock beside the intents, none in a refused run
  const uploadRoots = spineRuns ? uploadRootsOf(join(sessionsDir, 'uploads.json'), { log: (line) => console.warn(`[files] ${line}`) }) : null;
  const checkouts = startCheckouts({
    view: spineView.view, bus, clientPort: deps.clientPort, engineEnv, env: deps.env, uploadRoots,
    // UX wave U6c (docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md, decision 13): files' admission by name
    // reads the session's transcript: the path the index keeps when it is the record's engine session's file (not the
    // one before a /clear), else where the engine writes it; none while the index is not read (launch mode scenario, a
    // refused run) or for a record with no engine session id
    transcript: async (appId) => {
      if (spineView.view.unavailable() !== null) return null;
      const record = index.sessions.get(appId);
      if (!record?.engineSessionId) return null;
      const known = index.sessions.summaryOf(appId)?.transcriptPath;
      return known?.endsWith(`/${record.engineSessionId}.jsonl`) ? known : transcriptPathOf(await engineEnv, record.directory, record.engineSessionId);
    },
  });
  parts.push(['checkouts', () => checkouts.stop()]);
  settling.push(checkouts);

  // P5 O4 M3 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §C; D16, D19): the library's reads of a
  // stored file (`library.content`, `library.read` over the files service in process, open and reveal over the client
  // port) and the catalog's machine half (the engine's reads per cwd and the watch of the engine's plugin state, with
  // MAWS's own servers in the machine settings), after the checkouts and stopped before them, in a refused run too (they
  // write nothing)
  registerLibraryReads(bus.register, { hosts, files: checkouts.files, port: deps.clientPort, env: deps.env, artifactsRoot: join(profile, 'artifacts') });
  const catalog = startCatalogMachine({ hosts, bus, machineSettings: settingsPaths(profile).machine });
  parts.splice(parts.length - 1, 0, ['catalog', () => catalog.stop()]);

  // P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §F, §G; D7, D17): the connectors (the
  // broker, routes E and D, MAWS's own OAuth over the machine's key file, the owner's rows and delivery, the agents'
  // dataset refresh), the engine's MCP sign-in and the owner's Send to, over the in-process view, the counting bus, the
  // engine host and the client port. Composed in a run refused the spine too (they write no spine file: the key and the
  // sealed grants are under connectors/oauth/, as main sealed them beside a refused spine), after the checkouts and
  // stopped before them, so a lease's work in flight is withdrawn before the files service stops. A release or a yield
  // waits for an agent's refresh, an owner's action or a sign-in in flight; the commands' own runs are counted above.
  const oauthDirectory = join(profile, 'connectors', 'oauth');
  const listen = deps.listenLoopback ?? listenLoopback;
  // P5 O7 M5c (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Consent and the client port"): a remote
  // asker's consent callbacks, relayed by its device, one registry for the Connect and the engine's sign-in
  const relayed = createRelayedCallbacks();
  const connectors = startConnectors({ hosts, bus, view: spineView.view, port: deps.clientPort, custody: fileKeyCustody(oauthDirectory), directory: oauthDirectory, listen, relayed });
  const signIn = startSignIn({
    bus,
    host: { call: (name, input) => hosts.dispatch('engine-host', name, input) as never },
    onSessionStatus: (listener) => hosts.onEvent('session.status', (payload) => listener(payload)),
    onHostLost: (listener) => hosts.onState('engine-host', (state) => (state.state === 'ready' ? undefined : listener())),
    sessions: async () => {
      const listed = (await hosts.dispatch('engine-host', 'engine.sessions', undefined)) as CommandResult<'engine.sessions'>;
      if (!listed.ok) throw new Error(listed.error.message);
      return listed.value;
    },
    hostStreaming: () => hosts.streaming('engine-host'),
    onHostStreaming: (listener) => hosts.onStreaming('engine-host', listener),
    port: deps.clientPort,
    listen,
    relayed, // P5 O7 M5c
    machine: machineName(deps.env, hostname()), // mawsd's own rule for this machine's name
  });
  // P5 O7 M5c (Interfaces §O): `delivery.send` here, its export the library's Export as this root's bus answers it (the
  // render seam on mawsd's front, main's export service on the embedded root), under the e2e's hold on the export phase
  const exportArtifact = exportHeldFor((input: CommandInput<'artifacts.export'>, context: HandlerContext) => bus.invoke('artifacts.export', input, context), deps.env);
  const delivery = startDelivery({ bus, hosts, connectors: connectors.delivery, shellEnv: () => engineEnv, port: deps.clientPort, artifactsRoot: join(profile, 'artifacts'), exportArtifact });
  parts.splice(parts.length - 1, 0, ['connectors', () => connectors.stop()], ['connector sign-in', () => signIn.stop()], ['delivery', () => delivery.stop()]);
  settling.push(connectors, signIn);

  const root = allSettling(settling);
  return {
    view: spineView.view,
    settled: () => root.settled(),
    busy: () => root.busy(),
    stop: () => stopParts('spine', parts),
    discovery: { applied: () => indexSource.discoveryApplied(), onApplied: (listener) => indexSource.onDiscoveryApplied(listener) },
    ...(channel === undefined ? {} : { channel }), // P5 O8 M7b
    projects: () => index.projectsSource(), // the project registry: asked by mawsd alone
  };
}

// The bus the parts register through: each command handler and intercept counted in `work` while it runs (P5 O3-D M2).
function countingBus(bus: ServicesBus, work: Work): ServicesBus {
  const counted = <H extends (input: never, context: never) => unknown>(handler: H): H =>
    ((input: never, context: never) => work.track(Promise.resolve().then(() => handler(input, context)))) as unknown as H;
  return {
    ...bus,
    register: (name, handler) => bus.register(name, counted(handler)),
    intercept: (name, handler) => bus.intercept(name, counted(handler)),
  };
}
