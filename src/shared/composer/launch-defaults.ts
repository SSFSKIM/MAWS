// The one place C7 lists every X6 launch field (charter §13 X6; C7 execution document, Decision Log "architect's
// note, 2026-09-29"): the Diagnostics resume launcher and C7's replay e2e build their `LaunchSpec` by spreading from
// here, so a field C10 makes mandatory (`inheritGrantsFrom`) is a one-line change. Every choice is the engine's own
// default (null) or the charter's (the gateway, D-19).
import type { LaunchSpec } from '../engine/launch-spec';
import type { AppSessionId } from '../graph/ids';

export function launchDefaults(appSessionId: AppSessionId, cwd: string): LaunchSpec {
  return {
    appSessionId, cwd, additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
    resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay: null,
  };
}
