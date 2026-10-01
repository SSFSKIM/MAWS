// The settings C10's session service consults (C11 execution document, Ask of C10 (1), (2) and (4); M1 refresh task
// "feed C10's settings seam"): the default route a new intent is seeded with, the relay-unreachable policy its start
// reads, the subagent model its launch mapping passes, and (W3) the mode a refused auto falls back to. Read at each call, so a change reaches the next create and
// the next launch without a restart.
import type { Settings } from '@shared/ipc/schema';
import type { C10Settings } from '../sessions/launch-mapping';

export function sessionSettingsOf(settings: Settings): C10Settings {
  return {
    gateway: { defaultRoute: settings.gateway.defaultRoute, relayUnreachable: settings.gateway.relayUnreachable },
    engine: { subagentModel: settings.engine.subagentModel },
    permissions: { autoFallback: settings.permissions.autoFallback }, // W3
  };
}
