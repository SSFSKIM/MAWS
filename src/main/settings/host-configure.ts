// Main keeps the supervisor's idle time equal to `settings.supervisor.idleExitMinutes` (E10 execution document, §Design 1
// "Idle exit, and idle rows"; Interfaces "X2 additions"): `host.configure` goes to the engine host whenever it is ready
// (the idle time is process state, and a supervisor main reconnects to may have been started by another app run) and
// whenever the setting changes while it is. A supervisor never told keeps its own default of 10 minutes. Under the e2e
// harness MAWS_E2E_SUPERVISOR_IDLE_MS takes the setting's place, so a test sees an idle exit in seconds.
import type { CommandInput, CommandResult, HostState, Settings } from '@shared/ipc/schema';

export const DEFAULT_IDLE_EXIT_MS = 10 * 60_000; // the setting's default (settings version 10), and the supervisor's own

export interface HostConfigureDeps {
  settings(): Settings;
  onSettingsChanged(listener: (settings: Settings) => void): () => void; // settings.changed as main emits it
  hostState(): HostState;
  onHostState(listener: (state: HostState) => void): () => void; // the engine host's transitions
  dispatch(input: CommandInput<'host.configure'>): Promise<CommandResult<'host.configure'>>;
  env: Record<string, string | undefined>;
}

// The idle time to push: the e2e seam, else the setting in minutes (null: never), else the default.
// Settings version 10 (M3) adds the `supervisor` section; until then it is read where present.
export function idleExitMsOf(settings: Settings, env: Record<string, string | undefined>): number | null {
  const seam = env.MAWS_E2E === '1' ? env.MAWS_E2E_SUPERVISOR_IDLE_MS : undefined;
  if (seam !== undefined) {
    const ms = Number(seam);
    if (Number.isInteger(ms) && ms > 0) return ms;
    console.warn(`[settings] MAWS_E2E_SUPERVISOR_IDLE_MS=${seam} is not a positive whole number of milliseconds; using the setting`);
  }
  const minutes = (settings as { supervisor?: { idleExitMinutes?: number | null } }).supervisor?.idleExitMinutes;
  if (minutes === undefined) return DEFAULT_IDLE_EXIT_MS;
  return minutes === null ? null : minutes * 60_000;
}

export function startHostConfigure(deps: HostConfigureDeps): () => void {
  let pushed: { idleExitMs: number | null } | null = null; // what the host now serving was last sent
  const push = () => {
    if (deps.hostState().state !== 'ready') return;
    const idleExitMs = idleExitMsOf(deps.settings(), deps.env);
    if (pushed?.idleExitMs === idleExitMs) return;
    pushed = { idleExitMs };
    deps.dispatch({ idleExitMs }).then(
      (result) => {
        if (!result.ok) console.warn('[settings] host.configure failed', result.error);
      },
      (error: unknown) => console.warn('[settings] host.configure failed', error),
    );
  };
  const offs = [
    deps.onHostState((state) => {
      pushed = null; // every connection (a restart, a reconnect, another supervisor) is told again at its ready
      if (state.state === 'ready') push();
    }),
    deps.onSettingsChanged(() => push()),
  ];
  push();
  return () => offs.forEach((off) => off());
}
