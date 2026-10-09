// Main's owner channel (the P2-C document, §2, §5, §6, §9): the decided launches' bookkeeping, which the session service
// consults before every MAWS-owned launch (src/main/owner/launch.ts), fed the engine host's event batches for the
// mismatch check; `mods.list` and `mods.setSessionOverride` over the index; and (M4) the marks, answers and attention
// projection of ./service.ts with `ownerChannel.*`, fed the same batches, told when the host leaves `ready` and when it
// streams again (the recovery read), and when the lane's switch moves. The config home is the engine's, from the captured
// login-shell environment, never main's own `process.env`.
import { homedir } from 'node:os';
import type { AppSessionId } from '@shared/graph/ids';
import type { HostState } from '@shared/ipc/schema';
import type { Settings } from '@shared/ipc/schema/settings';
import type { AttentionService } from '../attention/service';
import { claudeConfigDir } from '../history/prompt-history';
import type { Index } from '../index/index';
import type { HostDispatch, registerMainHandler } from '../ipc/router';
import { transcriptPathOf, type HostEvents } from '../sessions/context';
import { OwnerChannelLaunches } from './launch';
import { modsList, setSessionOverride, type ModsDeps } from './mods';
import { transcriptEvidence } from './prompt-state';
import { OwnerChannelService, type OwnerChannelServiceDeps } from './service';

export interface OwnerChannelDeps {
  index: Pick<Index, 'ownerChannel' | 'sessions' | 'unavailable'>;
  settings: () => Settings;
  engineEnv: Promise<NodeJS.ProcessEnv>; // the captured login-shell environment the engine is launched with
  onEvent: HostEvents;
  register: typeof registerMainHandler;
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
}

export interface OwnerChannel {
  launches: OwnerChannelLaunches; // the session service's
  stop(): void;
}

export function startOwnerChannel(deps: OwnerChannelDeps): OwnerChannel {
  const log = deps.log ?? ((message) => console.warn(`[owner] ${message}`));
  const appEnabled = () => deps.settings().mods.toHuman.enabled;
  const launches = new OwnerChannelLaunches({
    store: deps.index.ownerChannel,
    appEnabled,
    log,
    subscribe: (listener) => void deps.onEvent('session.eventBatch', ({ appSessionId, events }) => listener(appSessionId, events)),
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
  const service = new OwnerChannelService({
    store: deps.index.ownerChannel,
    sessions: deps.index.sessions,
    appEnabled,
    attention: deps.attention,
    dispatch: deps.dispatch,
    transcriptEvidence: async (appSessionId, uuids) => {
      const record = deps.index.sessions.get(appSessionId);
      if (record?.engineSessionId == null) return null;
      return transcriptEvidence(await transcriptPathOf(await deps.engineEnv, record.directory, record.engineSessionId), uuids);
    },
    emit: deps.emit,
    log,
  });
  const offs: (() => void)[] = [];
  if (deps.index.unavailable === null) {
    service.start({ streaming: deps.streaming() });
    let enabled = appEnabled();
    offs.push(
      deps.onEvent('session.eventBatch', ({ appSessionId, events }) => service.onEvents(appSessionId as AppSessionId, events)),
      deps.onHostState((state) => {
        if (state.state !== 'ready') service.hostDown();
      }),
      deps.onStreaming(() => void service.hostStreaming()),
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

  deps.register('mods.list', ({ appSessionId }) => modsList(mods, appSessionId as AppSessionId | undefined));
  deps.register('mods.setSessionOverride', ({ appSessionId, id, value }) => {
    setSessionOverride(mods, { appSessionId: appSessionId as AppSessionId, id, value });
    service.laneChanged(appSessionId as AppSessionId); // M4: presentation and items follow at once
  });
  return {
    launches,
    stop: () => {
      offs.forEach((off) => off());
      service.stop();
    },
  };
}
