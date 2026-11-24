// The settings C10's session service consults (C11 execution document, Ask of C10 (1), (2) and (4); M1 refresh task
// "feed C10's settings seam"): the default route a new intent is seeded with, the relay-unreachable policy its start
// reads, the subagent model its launch mapping passes, (W3) the mode a refused auto falls back to, (P4-R8) the MCP servers every launch passes and (P4-A2) the launch profile every launch runs under. Read at each
// call, so a change reaches the next create and the next launch without a restart.
// P5 O7 M9: `route`, the machine's default route resolved (MachineSettingsService.defaultRoute()), which seeds a new
// intent's `route` beside the legacy `defaultRoute`.
// Board ticket 421 (docs/doperpowers/plans/2026-11-23-tool-choice.md, Interfaces §G): `mawsTools`, the machine's
// default set of MAWS's tools (MachineSettingsService.mawsTools()), which seeds a new intent's.
import type { MachineSettings } from '@shared/ipc/schema/settings';
import type { Route } from '@shared/engine/route';
import type { C10Settings } from '../sessions/launch-mapping';
import { FULL_MAWS_TOOL_SET, type MawsToolSet } from '@shared/maws/tool-set'; // board ticket 421

// Board ticket 421 (docs/doperpowers/plans/2026-11-23-tool-choice.md, Interfaces §G): `mawsTools`, the machine's default
// set of MAWS's tools (MachineSettingsService.mawsTools(), `machine-session-defaults.json`'s), which seeds a new intent's;
// absent, the full set.
export function sessionSettingsOf(settings: Pick<MachineSettings, 'gateway' | 'engine' | 'permissions'>, route?: Route, mawsTools: MawsToolSet = FULL_MAWS_TOOL_SET): C10Settings {
  return {
    gateway: { defaultRoute: settings.gateway.defaultRoute, relayUnreachable: settings.gateway.relayUnreachable, ...(route !== undefined && { route }) },
    engine: { subagentModel: settings.engine.subagentModel, mcpServers: settings.engine.mcpServers, launchProfile: settings.engine.launchProfile }, // P4-R8; P4-A2
    permissions: { autoFallback: settings.permissions.autoFallback }, // W3
    mawsTools, // board ticket 421
  };
}
