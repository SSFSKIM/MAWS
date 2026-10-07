// Which transport carries the engine host (E10 execution document, §Design 8). `detached`: the supervisor, a process
// that outlives the app, reached over a Unix socket; `utility`: an Electron utility process forked by main, as before.
// The pty host is always a utility process. The e2e harness (MAWS_E2E=1) and the component harness (MAWS_HARNESS=1)
// default to `utility`, so every existing suite runs unchanged; MAWS_HOST_MODE overrides any default.
export type HostMode = 'utility' | 'detached';

export function hostModeFromEnv(env: NodeJS.ProcessEnv): HostMode {
  const asked = env.MAWS_HOST_MODE;
  if (asked === 'utility' || asked === 'detached') return asked;
  if (asked) console.warn(`[hosts] MAWS_HOST_MODE=${asked} is neither utility nor detached; using the default`);
  return env.MAWS_E2E === '1' || env.MAWS_HARNESS === '1' ? 'utility' : 'detached';
}
