// Main's owner channel (the P2-C document, §2, §5, §6, §9): the decided launches' bookkeeping, which the session service
// consults before every MAWS-owned launch (src/services/owner/launch.ts), fed the engine host's event batches for the
// mismatch check; `mods.list` and `mods.setSessionOverride` over the index; and (M4) the marks, answers and attention
// projection of ./service.ts with `ownerChannel.*`, fed the same batches and the queue's snapshots, told when the host
// leaves `ready` and when it streams again (the recovery read), and when the lane's switch moves; a launch's record and
// its observed style are published through the service as the session's state. The config home is the engine's, from
// the captured login-shell environment, never main's own `process.env`.
// The UX wave, U2b (docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md, Interfaces §A and §M; M4): who draws
// each session's to-human view, published as the lane's `drawnBy`, follows the engine host's statuses (./drawn-by.ts):
// the subscription beside the event batches', and a read of every live status at the start and at each reconnect, which
// also binds a reservation the host accepted and the daemon never bound (it stopped between the two). `ownerChannel.folds`
// answers the runs of the to-human mod's file for a session (./folds.ts); `mods.setFoldSummaries` writes the switch.
import { homedir } from 'node:os';
import type { AppSessionId } from '@shared/graph/ids';
import type { HostState } from '@shared/ipc/schema';
import type { MachineSettings } from '@shared/ipc/schema/settings';
import type { AttentionService } from '../attention/service';
import { claudeConfigDir } from '@shared/engine/config-dir';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { Index } from '../index/index';
import type { HostDispatch } from '@shared/host/host-supervisor';
import type { ServicesBus } from '@shared/spine/bus';
import { hostCall, transcriptPathOf, type HostEvents } from '../sessions/context';
import { readDeclaration } from './declaration';
import { WhoDraws } from './drawn-by';
import { storedFolds } from './folds';
import { OwnerChannelLaunches } from './launch';
import { modsList, setFoldSummaries, setSessionOverride, type ModsDeps } from './mods';
import { transcriptChain, transcriptEvidence } from './prompt-state';
import { OwnerChannelService, type OwnerChannelServiceDeps } from './service';
import type { Settling } from '../work';

export interface OwnerChannelDeps {
  index: Pick<Index, 'ownerChannel' | 'sessions' | 'unavailable'>;
  settings: () => Pick<MachineSettings, 'mods'>;
  engineEnv: Promise<NodeJS.ProcessEnv>; // the captured login-shell environment the engine is launched with
  onEvent: HostEvents;
  register: ServicesBus['register'];
  log?: (message: string) => void;
  // M4 start (2026-10-09)
  attention: Pick<AttentionService, 'setOwnerItems'>;
  dispatch: HostDispatch;
  onHostState: (listener: (state: HostState) => void) => () => void; // the engine host's
  onStreaming: (listener: () => void) => () => void; // the engine host's: once per connection, after its resync
  streaming: () => boolean;
  emit: OwnerChannelServiceDeps['emit'];
  onSettings: (listener: () => void) => () => void;
  // M4 end
  modRoute?: boolean; // UX wave U2b, the tests' seam: the cutover's switch (TO_HUMAN_MOD_ROUTE)
}

export interface OwnerChannel {
  launches: OwnerChannelLaunches; // the session service's
  work: Settling; // P5 O3-D (D27): the reads in flight whose continuations write the index; the root's barrier counts them
  stop(): void;
}

export function startOwnerChannel(deps: OwnerChannelDeps): OwnerChannel {
  const log = deps.log ?? ((message) => console.warn(`[owner] ${message}`));
  const appEnabled = () => deps.settings().mods.toHuman.enabled;
  // U2b: who draws each session's view; the row read as unknown when it cannot be read
  const whoDraws = new WhoDraws({
    row: (appSessionId) => {
      try {
        return deps.index.ownerChannel.session(appSessionId);
      } catch {
        return null;
      }
    },
    declares: readDeclaration,
    changed: (appSessionId) => service.drawnByChanged(appSessionId),
  });
  const launches = new OwnerChannelLaunches({
    store: deps.index.ownerChannel,
    appEnabled,
    log,
    subscribe: (listener) => void deps.onEvent('session.eventBatch', ({ appSessionId, events }) => listener(appSessionId, events)),
    // a launch's record and its observed style are the lane's state; P4-R7z: a record can move the lane in effect (its
    // style may carry none), so the session's items are projected again, silently, beside the state
    changed: (appSessionId) => service.laneChanged(appSessionId),
    bound: (appSessionId, launchId) => whoDraws.bound(appSessionId, launchId), // U2b
    ...(deps.modRoute !== undefined && { modRoute: deps.modRoute }),
  });
  const mods: ModsDeps = {
    store: deps.index.ownerChannel,
    sessions: deps.index.sessions,
    appEnabled,
    configHome: async () => {
      const env = await deps.engineEnv;
      return claudeConfigDir(env, env.HOME || homedir());
    },
  };

  // M4 start (2026-10-09): the marks, the answers and their projection
  const transcriptOf = async (appSessionId: AppSessionId): Promise<string | null> => {
    const record = deps.index.sessions.get(appSessionId);
    return record?.engineSessionId == null ? null : transcriptPathOf(await deps.engineEnv, record.directory, record.engineSessionId);
  };
  const service = new OwnerChannelService({
    store: deps.index.ownerChannel,
    sessions: deps.index.sessions,
    appEnabled,
    attention: deps.attention,
    dispatch: deps.dispatch,
    transcriptEvidence: async (appSessionId, uuids) => {
      const path = await transcriptOf(appSessionId);
      return path === null ? null : transcriptEvidence(path, uuids);
    },
    transcriptChain: async (appSessionId, uuid) => {
      const path = await transcriptOf(appSessionId);
      return path === null ? null : transcriptChain(path, uuid);
    },
    emit: deps.emit,
    log,
    drawnBy: (appSessionId) => whoDraws.drawnBy(appSessionId), // U2b
  });
  // U2b: every live status read once, at the start and at each reconnect. A reservation not yet bound that §A reads as
  // the running launch's (the host accepted it, the daemon stopped before the bind) is bound then.
  const reconcile = (status: EngineSessionStatus) => {
    const appSessionId = status.appSessionId as AppSessionId;
    try {
      const row = deps.index.ownerChannel.session(appSessionId);
      if (row?.advertised && row.advertised.launchId === null && status.launchId !== row.launchId) deps.index.ownerChannel.bindReservation(appSessionId, status.launchId);
    } catch (error) {
      log(`the owner channel could not bind ${appSessionId}'s reservation to its running launch: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const readLive = async () => {
    let statuses: EngineSessionStatus[];
    try {
      statuses = await hostCall(deps.dispatch, 'engine.sessions', undefined);
    } catch (error) {
      log(`the owner channel could not read the live sessions: ${error instanceof Error ? error.message : String(error)}`); // read again at the next reconnect
      return;
    }
    for (const status of statuses) {
      reconcile(status);
      whoDraws.status(status);
    }
    whoDraws.primed();
  };
  const reads = new Set<Promise<void>>();
  const track = (read: Promise<void>) => {
    reads.add(read);
    void read.finally(() => reads.delete(read));
  };
  const offs: (() => void)[] = [];
  if (deps.index.unavailable === null) {
    service.start({ streaming: deps.streaming() });
    if (deps.streaming()) track(readLive()); // U2b
    let enabled = appEnabled();
    offs.push(
      deps.onEvent('session.eventBatch', ({ appSessionId, events }) => service.onEvents(appSessionId as AppSessionId, events)),
      deps.onEvent('session.queue', ({ appSessionId, entries }) => service.queueShown(appSessionId as AppSessionId, entries)), // an answer's entry edited
      deps.onHostState((state) => {
        if (state.state !== 'ready') service.hostDown();
      }),
      deps.onStreaming(() => {
        void service.hostStreaming();
        track(readLive()); // U2b
      }),
      deps.onEvent('session.status', ({ status }) => whoDraws.status(status)), // U2b
      deps.onSettings(() => {
        if (appEnabled() === enabled) return;
        enabled = appEnabled();
        service.laneChanged();
      }),
    );
  } else log(`the owner channel's marks are not kept: index unavailable: ${deps.index.unavailable}`);
  deps.register('ownerChannel.state', ({ appSessionId }) => service.state(appSessionId as AppSessionId));
  deps.register('ownerChannel.answered', (input) => service.answered(input));
  deps.register('ownerChannel.cancel', (input) => service.cancel(input));
  deps.register('ownerChannel.markRead', (input) => service.markRead(input));
  // M4 end
  deps.register('ownerChannel.folds', ({ appSessionId }) => storedFolds({ sessions: deps.index.sessions, configHome: mods.configHome }, appSessionId as AppSessionId)); // U2b

  deps.register('mods.list', ({ appSessionId }) => modsList(mods, appSessionId as AppSessionId | undefined));
  deps.register('mods.setSessionOverride', ({ appSessionId, id, value }) => {
    setSessionOverride(mods, { appSessionId: appSessionId as AppSessionId, id, value });
    service.laneChanged(appSessionId as AppSessionId); // M4: presentation and items follow at once
  });
  deps.register('mods.setFoldSummaries', ({ on }) => setFoldSummaries(mods, { on })); // U2b: the next launches carry it
  const settledReads = async () => {
    while (reads.size > 0) await Promise.allSettled([...reads]);
    await whoDraws.settled();
  };
  return {
    launches,
    work: { busy: () => service.busy() || reads.size > 0 || whoDraws.busy(), settled: async () => (await Promise.all([service.settled(), settledReads()]), undefined) },
    stop: () => {
      offs.forEach((off) => off());
      service.stop();
      whoDraws.stop();
    },
  };
}
