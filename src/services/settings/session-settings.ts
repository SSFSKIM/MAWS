// The settings C10's session service consults (C11 execution document, Ask of C10 (1), (2) and (4); M1 refresh task
// "feed C10's settings seam"): the default route a new intent is seeded with, the relay-unreachable policy its start
// reads, the subagent model its launch mapping passes, (W3) the mode a refused auto falls back to, (P4-R8) the MCP servers every launch passes and (P4-A2) the launch profile every launch runs under. Read at each
// call, so a change reaches the next create and the next launch without a restart.
// P5 O7 M9: `route`, the machine's default route resolved (MachineSettingsService.defaultRoute()), which seeds a new
// intent's `route` beside the legacy `defaultRoute`.
import type { MachineSettings } from '@shared/ipc/schema/settings';
import type { Route } from '@shared/engine/route';
import type { C10Settings } from '../sessions/launch-mapping';

export function sessionSettingsOf(settings: Pick<MachineSettings, 'gateway' | 'engine' | 'permissions'>, route?: Route): C10Settings {
  return {
    gateway: { defaultRoute: settings.gateway.defaultRoute, relayUnreachable: settings.gateway.relayUnreachable, ...(route !== undefined && { route }) },
    engine: { subagentModel: settings.engine.subagentModel, mcpServers: settings.engine.mcpServers, launchProfile: settings.engine.launchProfile }, // P4-R8; P4-A2
    permissions: { autoFallback: settings.permissions.autoFallback }, // W3
  };
}
