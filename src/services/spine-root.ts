// The spine's root (P5 O3-C, docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, Interfaces §D; O3 §5, §6): the
// one function that composes what O3-D moves into `mawsd`, from injected dependencies alone. Main's embedded root
// (src/main/index.ts) calls it today; at O3-D `mawsd` calls the same function. It composes settings' machine half (as
// `openSpineData` opened it), the index with its session source, replay and the read model, attention's core, the owner
// channel and mods, the session service with intents, worktrees, prompt history, side threads, yield, observed facts
// and the sweep, the engine host's configure relays, the design-system defaults relay, the library's derived index and
// O9's lane A driver, in the order main composed them, and returns the one view staying code reads them through, and
// its stop.
//
// O3-A's refused run (contract O3X2; O3 Decision Log 11) is the root's: a run that does not hold `spine.lock` opens the
// index unavailable and starts none of the parts that write the machine's files or launch a session (attention's core,
// replays, lane A, the prompt history's commands, the worktree and session services, the owner channel, the sweep,
// yield, side threads, the configure and defaults relays, the retired custody's removal); the read model, the inert index source,
// observed facts and the library still answer, and the view says why the spine cannot be read.
import { rm } from 'node:fs/promises';
import { totalmem } from 'node:os';
import { join } from 'node:path';
import { isActionable as archiveActionable, isOpen as archiveOpen } from '@shared/attention/kinds';
import type { ClientPort } from '@shared/client/port';
import { claudeConfigDir } from '@shared/engine/config-dir';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { HostSupervisor } from '@shared/host/host-supervisor';
import { OpLedger } from '@shared/host/op-ledger';
import type { CommandResult } from '@shared/ipc/schema';
import type { Enrollment } from '@shared/machine/identity';
import type { MachineRef } from '@shared/machine/ref';
import { settingsPaths } from '@shared/settings/paths';
import type { ServicesBus } from '@shared/spine/bus';
import type { MachineSettingsService } from '@shared/spine/machine-settings';
import type { SpineView } from '@shared/spine/view';
import { startArtifactDefaults } from './artifacts/defaults';
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
import { createLaneADriver, registerLaneA } from './lane-a/driver';
import { startLibrary } from './library';
import { registerMachineOps } from './machine-ops';
import { startOwnerChannel } from './owner/register';
import { startEngineConfigure } from './settings/engine-configure';
import { startHostConfigure } from './settings/host-configure';
import { startMachineSettings } from './settings/machine';
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
import { createSpineView } from './sessions/spine-view';
import { stopParts, type Part } from './stop-parts';
import { allSettling, Work, type Settling } from './work';
import { startYield } from './sessions/yield';

export interface SpineData {
  readonly lock: SpineLock;
  readonly refused: string | null; // why this run may not write the spine's files; null: it holds spine.lock
  readonly machineSettings: MachineSettingsService; // the machine half (O3X3), from which main composes the client half
  readonly paths: { client: string; machine: string };
}

// O3-A's data start (O3 §2, §3; contracts O3X2, O3X3): `spine.lock` before either settings file is migrated or written
// and before the index opens (startSpine); then, holding it, the split of a unified settings file, once, and the machine
// half. Refused, nothing is migrated and the machine half is read, never written. The lock is held for the process's
// life: released at its exit, never at a shutdown step, since the steps' promises settle after the last step is called
// and a writer still finishing (an intent's rename) must not run beside a candidate that took the lock.
// P5 O3-D M2 (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §A, D26): a process that loads the spine
// more than once (`mawsd`) takes the lock once itself (`takeSpineLock`) and opens each load's data under it (`lock`),
// since the lock refuses this very process's second take; with none given, the one-shot form above (main's).
export async function openSpineData(profile: string, { build, lock: given }: { build: string; lock?: SpineLock }): Promise<SpineData> {
  const paths = settingsPaths(profile);
  const lock = given ?? (await takeSpineLock(profile, { build }));
  if (!given) process.once('exit', lock.release);
  const split = lock.refused === null ? splitSettingsFiles(paths) : null;
  const machineSettings = startMachineSettings(paths.machine, { refused: lock.refused ?? split?.machineRefused ?? null, unsplit: split?.unsplit });
  return { lock, refused: lock.refused, machineSettings, paths };
}

// P5 O3-D M2: `replay`, a host adapter that replays what it held while the spine loaded (mawsd's; sessions/index.ts)
export type SpineHosts = Pick<HostSupervisor, 'dispatch' | 'onEvent' | 'onState' | 'onStreaming' | 'streaming' | 'snapshot' | 'setResync'> & { replay?: HeldReplay };

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
}

export function startSpine(deps: SpineDeps): SpineRoot {
  const { profile, data, hosts, engineEnv } = deps;
  const machineSettings = data.machineSettings;
  const spineRuns = data.refused === null;
  const parts: Part[] = []; // in today's shutdown order (D21), each stopped whatever an earlier one threw
  // P5 O3-D M2: every command and intercept the parts register counted while it runs, and what each part has in flight
  const commands = new Work();
  const bus = countingBus(deps.bus, commands);
  const settling: Settling[] = [commands];

  // C4: the index (<profile>/index.sqlite) answers the record side of session.*, and its session source folds the
  // engine host's store events into it once the host is ready; the read model starts the source (refused unstarted in
  // launch mode scenario) and stops it. P5 O3-A: unavailable, its file never opened, in a run refused the spine.
  const index = new Index(join(profile, 'index.sqlite'), { refused: data.refused });
  void index.refreshOrgProjects({ machine: deps.machine, enrollment: deps.enrollment }); // P5 O6 M5: each project's org project, derived again at every start (OX3)
  registerIndexHandlers(index, bus);
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
    // M6: each bridged session's pending requests are attention items, and its digest reads its live phase from the
    // bridge while the bridge is live (today's `foreign` otherwise)
    const laneAItems = laneAAttention({ set: (appId, entries) => attention.setLaneAItems(appId, entries) });
    const offLaneAView = laneA.onChange((appId, view) => {
      laneAItems.update(appId, view);
      indexSource.setBridged(appId, view?.state.bridge === 'live' ? { running: view.state.turn.running, pending: view.state.pending.length, tool: view.tool } : null);
    });
    parts.push(['lane A attention', () => {
      offLaneAView();
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
      settings: () => sessionSettingsOf(machineSettings.state()), // C11: the route, the relay policy and the subagent model
      userDefaults, // W3: the user's defaultMode seeds a new intent's mode (read only)
      launchGate: () => engineConfigure!.launchGate(), // C12: a launch waits for the host to hold the binary settings name
      browserBackend: deps.browserSocket, // E13
      ownerChannel: ownerChannel.launches, // P2-C
      acquisitions: sessions.model, // P2-A (X16): the digest's availability follows each acquisition
    });
    const unintercept = registerSessionServiceHandlers(service, bus, sessions.mode); // P5 O3-D M4: the rewind repair's intercepts in launch mode index only
    sessionService = service;
    settling.push(service.work);
    // The sweep keeps the machine's interest union (D11): on the embedded shape main's interest report's set
    const inactiveArchive = new InactiveArchive({
      index, git: createGitRunner(), status: (id) => sessions.model.engineStatus(id),
      waiting: (id) => sessions.model.attention(id).some((item) => archiveOpen(item) && archiveActionable(item)),
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
  let machineRevision = 0;
  const offMachineChanged = machineSettings.onChange((settings) => {
    machineRevision += 1;
    bus.emit('machineSettings.changed', { settings });
  });
  parts.push(['machine settings', offMachineChanged]);
  bus.register('machineSettings.get', () => ({ settings: machineSettings.state(), version: machineRevision }));
  bus.register('machineSettings.set', async ({ patch }) => ({ settings: await machineSettings.update(patch) }));
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
  if (spineRuns) registerMachineOps(bus, OpLedger.open(profile, 'spine-ops.jsonl', { log: (line) => console.warn(`[spine-ops] ${line}`) }));

  const root = allSettling(settling);
  return {
    view: spineView.view,
    settled: () => root.settled(),
    busy: () => root.busy(),
    stop: () => stopParts('spine', parts),
    discovery: { applied: () => indexSource.discoveryApplied(), onApplied: (listener) => indexSource.onDiscoveryApplied(listener) },
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
