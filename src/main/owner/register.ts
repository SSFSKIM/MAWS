// Main's owner channel, the launch half (the P2-C document, §2, §9; M2): the decided launches' bookkeeping, which the
// session service consults before every MAWS-owned launch (src/main/owner/launch.ts), fed the engine host's event
// batches for the mismatch check; and `mods.list` and `mods.setSessionOverride` over the index. The config home is the
// engine's, from the captured login-shell environment, never main's own `process.env`.
import { homedir } from 'node:os';
import type { AppSessionId } from '@shared/graph/ids';
import type { Settings } from '@shared/ipc/schema/settings';
import { claudeConfigDir } from '../history/prompt-history';
import type { Index } from '../index/index';
import type { registerMainHandler } from '../ipc/router';
import type { HostEvents } from '../sessions/context';
import { OwnerChannelLaunches } from './launch';
import { modsList, setSessionOverride, type ModsDeps } from './mods';

export interface OwnerChannelDeps {
  index: Pick<Index, 'ownerChannel' | 'sessions'>;
  settings: () => Settings;
  engineEnv: Promise<NodeJS.ProcessEnv>; // the captured login-shell environment the engine is launched with
  onEvent: HostEvents;
  register: typeof registerMainHandler;
  log?: (message: string) => void;
}

// Answers the launches' bookkeeping for the session service.
export function startOwnerChannel(deps: OwnerChannelDeps): OwnerChannelLaunches {
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
  deps.register('mods.list', ({ appSessionId }) => modsList(mods, appSessionId as AppSessionId | undefined));
  deps.register('mods.setSessionOverride', ({ appSessionId, id, value }) => setSessionOverride(mods, { appSessionId: appSessionId as AppSessionId, id, value }));
  return launches;
}
