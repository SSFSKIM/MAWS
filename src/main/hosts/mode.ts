// Which transport carries the hosts (E10 execution document, §Design 8; P5 O2 M7, docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md,
// M7 "The shape setting"), read once before the hosts start. `daemon`: the machine daemon, `mawsd`, owns the engine host
// and the pty host, and main reaches both (and `mawsd`'s own `daemon` namespace) over its three relay sockets;
// `detached`: the supervisor, a process that outlives the app, reached over a Unix socket, with the pty host a utility
// process (the embedded shape); `utility`: both are Electron utility processes forked by main, as before E10.
// MAWS_HOST_MODE wins; the e2e harness (MAWS_E2E=1) and the component harness (MAWS_HARNESS=1) take `utility`, so every
// existing suite runs unchanged; otherwise the setting `supervisor.shape` decides (daemon: `daemon`, embedded: `detached`).
// Whether the daemon shape can run this launch (the default profile's unit) is daemon.ts's to say.
import type { SupervisorShape } from '@shared/ipc/schema/settings';

export type HostMode = 'utility' | 'detached' | 'daemon';
const MODES: readonly string[] = ['utility', 'detached', 'daemon'] satisfies HostMode[];

export function hostModeFromEnv(env: NodeJS.ProcessEnv, shape: SupervisorShape): HostMode {
  const asked = env.MAWS_HOST_MODE;
  if (asked && MODES.includes(asked)) return asked as HostMode;
  if (asked) console.warn(`[hosts] MAWS_HOST_MODE=${asked} is none of ${MODES.join(', ')}; using the default`);
  if (env.MAWS_E2E === '1' || env.MAWS_HARNESS === '1') return 'utility';
  return shape === 'daemon' ? 'daemon' : 'detached';
}

// P5 O2 landing (O3's planner, P9): a launch under the e2e or the component harness belongs on a scratch profile. On
// the default profile its plan would act on the owner's daemon: an embedded plan leaves the shape (ending the owner's
// `mawsd` and its socket-mode pty host, their terminals and kept sessions with them), a packaged one installs or
// uninstalls the owner's unit. So it is refused before any host work, whatever MAWS_HOST_MODE says; null lets it run.
export const DEFAULT_PROFILE_REFUSAL = '[hosts] a test or harness launch (MAWS_E2E=1 or MAWS_HARNESS=1) refuses the default profile, whose daemon and LaunchAgent are the owner\'s: set MAWS_USER_DATA to a scratch profile';

export function testLaunchRefusal(env: NodeJS.ProcessEnv, defaultProfile: boolean): string | null {
  return defaultProfile && (env.MAWS_E2E === '1' || env.MAWS_HARNESS === '1') ? DEFAULT_PROFILE_REFUSAL : null;
}
