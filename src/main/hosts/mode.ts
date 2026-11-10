// The launch's environment, read once before anything starts (E10 execution document, §Design 8; P5 O2 M7; P5 O15 M2,
// docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, M2 "`MAWS_HOST_MODE` is retired"). Every launch that reaches
// the app runs on the machine daemon, `mawsd`, which owns the engine host and the pty host; main reaches both (and
// `mawsd`'s own `daemon` namespace) over its three relay sockets. MAWS_HOST_MODE, which once chose the embedded shape,
// chooses nothing: a value other than `daemon` is said once and ignored. The helpers that strip it from a child's
// environment keep stripping it (detached-transport.ts), since a peer build in cross-build still reads it. Whether
// `mawsd` can start for this launch (the main profile's unit) is daemon.ts's to say.

export const RETIRED_HOST_MODE = '[hosts] MAWS_HOST_MODE is retired and ignored: the app runs on mawsd';

// The line main logs once when the environment still names a host mode; null when it names none, or `daemon`.
export function retiredHostModeNotice(env: NodeJS.ProcessEnv): string | null {
  const asked = env.MAWS_HOST_MODE;
  return asked && asked !== 'daemon' ? RETIRED_HOST_MODE : null;
}

// P5 O2 landing (O3's planner, P9): a launch under the e2e or the component harness belongs on a scratch profile. On
// the main profile its launch would act on the owner's daemon: a packaged one installs or repairs the owner's unit and
// starts it. So it is refused before any host work; null lets it run.
export const DEFAULT_PROFILE_REFUSAL = '[hosts] a test or harness launch (MAWS_E2E=1 or MAWS_HARNESS=1) refuses the default profile, whose daemon and LaunchAgent are the owner\'s: set MAWS_USER_DATA to a scratch profile';

export function testLaunchRefusal(env: NodeJS.ProcessEnv, defaultProfile: boolean): string | null {
  return defaultProfile && (env.MAWS_E2E === '1' || env.MAWS_HARNESS === '1') ? DEFAULT_PROFILE_REFUSAL : null;
}
