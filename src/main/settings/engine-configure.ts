// Main keeps the engine host's binary configuration equal to `settings.engine` (C11 execution document, Interfaces
// "Settings, version 3"): `engine.configure` goes to the host whenever the host is ready (its configuration is process
// state, so a restarted host is configured again) and whenever the binary path or the pinned version changes. A
// change while sessions are live affects the next launch only; a live process keeps the binary it started with.
import type { CommandInput, CommandResult, EngineBinaryConfig, HostState, Settings } from '@shared/ipc/schema';
import { defaultBudgetKiB } from '../../engine-host/budget'; // C12

export interface EngineConfigureDeps {
  settings(): Settings;
  onSettingsChanged(listener: (settings: Settings) => void): () => void; // settings.changed as main emits it
  hostState(): HostState;
  onHostState(listener: (state: HostState) => void): () => void; // the engine host's transitions
  dispatch(config: EngineBinaryConfig): Promise<CommandResult<'engine.configure'>>;
  // C12 start: the memory budget's policy, pushed beside the binary's configuration (C12 execution document, Interfaces
  // "Settings, version 4")
  dispatchPolicy(policy: BudgetPolicy): Promise<CommandResult<'engine.policy.set'>>;
  totalMemBytes: number; // os.totalmem(): the default budget is a quarter of it
  // C12 end
}

// C12 start
export type BudgetPolicy = CommandInput<'engine.policy.set'>;

// settings.engine's budget as the host takes it: the setting in KiB, or 25% of physical memory while it is null.
export const budgetPolicyOf = ({ engine }: Settings, totalMemBytes: number): BudgetPolicy => ({
  limitKiB: engine.memoryBudgetMiB !== null ? engine.memoryBudgetMiB * 1024 : defaultBudgetKiB(totalMemBytes),
  statefulMcpServers: [...engine.statefulMcpServers],
});
const samePolicy = (a: BudgetPolicy, b: BudgetPolicy) => a.limitKiB === b.limitKiB && a.statefulMcpServers.join('\n') === b.statefulMcpServers.join('\n');
// C12 end

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
  // C12 start: the policy, on the same two occasions
  let policy = budgetPolicyOf(deps.settings(), deps.totalMemBytes);
  const sendPolicy = (next: BudgetPolicy) => {
    policy = next;
    deps.dispatchPolicy(next).then(
      (result) => {
        if (!result.ok) console.warn('[settings] engine.policy.set failed', result.error);
      },
      (error: unknown) => console.warn('[settings] engine.policy.set failed', error),
    );
  };
  // C12 end
  const offs = [
    deps.onHostState((state) => {
      if (state.state === 'ready') send(configOf(deps.settings()));
      if (state.state === 'ready') sendPolicy(budgetPolicyOf(deps.settings(), deps.totalMemBytes)); // C12
    }),
    deps.onSettingsChanged((settings) => {
      const config = configOf(settings);
      if (!same(config, sent)) send(config);
      // C12 start
      const next = budgetPolicyOf(settings, deps.totalMemBytes);
      if (!samePolicy(next, policy)) sendPolicy(next);
      // C12 end
    }),
  ];
  if (deps.hostState().state === 'ready') send(sent);
  if (deps.hostState().state === 'ready') sendPolicy(policy); // C12
  return () => offs.forEach((off) => off());
}
