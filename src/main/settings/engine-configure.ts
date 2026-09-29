// Main keeps the engine host's binary configuration equal to `settings.engine` (C11 execution document, Interfaces
// "Settings, version 3"): `engine.configure` goes to the host whenever the host is ready (its configuration is process
// state, so a restarted host is configured again) and whenever the binary path or the pinned version changes. A
// change while sessions are live affects the next launch only; a live process keeps the binary it started with.
import type { CommandResult, EngineBinaryConfig, HostState, Settings } from '@shared/ipc/schema';

export interface EngineConfigureDeps {
  settings(): Settings;
  onSettingsChanged(listener: (settings: Settings) => void): () => void; // settings.changed as main emits it
  hostState(): HostState;
  onHostState(listener: (state: HostState) => void): () => void; // the engine host's transitions
  dispatch(config: EngineBinaryConfig): Promise<CommandResult<'engine.configure'>>;
}

const configOf = ({ engine }: Settings): EngineBinaryConfig => ({ binaryPath: engine.binaryPath, expectedVersion: engine.pinnedVersion });
const same = (a: EngineBinaryConfig, b: EngineBinaryConfig) => a.binaryPath === b.binaryPath && a.expectedVersion === b.expectedVersion;

export function startEngineConfigure(deps: EngineConfigureDeps): () => void {
  let sent = configOf(deps.settings());
  const send = (config: EngineBinaryConfig) => {
    sent = config;
    deps.dispatch(config).then(
      (result) => {
        if (!result.ok) console.warn('[settings] engine.configure failed', result.error);
      },
      (error: unknown) => console.warn('[settings] engine.configure failed', error),
    );
  };
  const offs = [
    deps.onHostState((state) => {
      if (state.state === 'ready') send(configOf(deps.settings()));
    }),
    deps.onSettingsChanged((settings) => {
      const config = configOf(settings);
      if (!same(config, sent)) send(config);
    }),
  ];
  if (deps.hostState().state === 'ready') send(sent);
  return () => offs.forEach((off) => off());
}
