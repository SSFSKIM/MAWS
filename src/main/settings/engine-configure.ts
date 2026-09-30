// Main keeps the engine host's binary configuration equal to `settings.engine` (C11 execution document, Interfaces
// "Settings, version 3"): `engine.configure` goes to the host whenever the host is ready (its configuration is process
// state, so a restarted host is configured again) and whenever the binary path or the pinned version changes. A
// change while sessions are live affects the next launch only; a live process keeps the binary it started with.
// C12 start: main is the only sender of `engine.configure` (C12 execution document, Interfaces "Engine custody",
// Configure; the Settings tab writes settings and awaits `settings.engineApplied`). With custody, every push waits for
// custody's answer for the pin and carries `binaryPath ?? custody.path`, never null (the host would fall back to the
// installer's file); a pin change runs custody for the new version before its push. Pushes go one at a time, the latest
// settings winning.
// C12 end
import type { CommandInput, CommandResult, EngineBinaryConfig, HostState, Settings } from '@shared/ipc/schema';
import { defaultBudgetKiB } from '../../engine-host/budget'; // C12
import { custodyRefusal, type Custody } from '../engine/custody'; // C12

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
  // MAWS's copy of the pinned engine for a version (custody.ts's ensureCustody); absent when custody does not run
  // (MAWS_E2E, replay), and the host then keeps C3's ENGINE_BIN
  custody?: (version: string) => Promise<Custody>;
  // C12 end
}

// C12 start: what main answers besides the pushes (C12 execution document, Interfaces "Engine custody" and "X2
// additions"): `settings.engineApplied`, `settings.engineCustody`, and the launch gate C10's setup and resume consult.
export interface EngineConfigure {
  stop(): void;
  applied(): Promise<void>; // the push for settings.engine as it now stands has been answered; rejects with custody's or the push's message
  custody(): Promise<Custody | null>; // the copy for the pinned version; null without custody
  launchGate(): Promise<ReturnType<typeof custodyRefusal>>; // null, or the refusal a launch answers
}

export type BudgetPolicy = CommandInput<'engine.policy.set'>;

// settings.engine's budget as the host takes it: the setting in KiB, or 25% of physical memory while it is null.
export const budgetPolicyOf = ({ engine }: Settings, totalMemBytes: number): BudgetPolicy => ({
  limitKiB: engine.memoryBudgetMiB !== null ? engine.memoryBudgetMiB * 1024 : defaultBudgetKiB(totalMemBytes),
  statefulMcpServers: [...engine.statefulMcpServers],
});
const samePolicy = (a: BudgetPolicy, b: BudgetPolicy) => a.limitKiB === b.limitKiB && a.statefulMcpServers.join('\n') === b.statefulMcpServers.join('\n');

// The settings a configure push stands for (C11's `configOf` and `same` gave way to it).
const settingsKey = ({ engine }: Settings) => `${engine.binaryPath ?? ''}\0${engine.pinnedVersion}`;
// C12 end

export function startEngineConfigure(deps: EngineConfigureDeps): EngineConfigure {
  // C12 start: the configure push, serialized behind custody
  const custodies = new Map<string, Promise<Custody>>(); // one custody per version per app run
  const custodyOf = (version: string) => {
    let pending = custodies.get(version);
    if (!pending) custodies.set(version, (pending = deps.custody!(version)));
    return pending;
  };
  let generation = 0; // host generations seen ready; each starts unconfigured
  let pushedFor: { key: string; generation: number } | null = null; // the settings the last answered push stood for
  let outcome: { key: string; error: string | null } | null = null; // what that answer means for `applied`
  let firstAnswered = false;
  let pumping = false;
  const waiters = new Set<() => void>();
  const notify = () => [...waiters].forEach((check) => check());
  const hostReady = () => deps.hostState().state === 'ready';
  // Nothing is left to push for the settings as they stand: the host holds them, or cannot take a push right now.
  const settled = () => !pumping && (!hostReady() || (pushedFor?.key === settingsKey(deps.settings()) && pushedFor.generation === generation));
  const until = (done: () => boolean): Promise<void> =>
    new Promise((resolve) => {
      const check = () => {
        if (!done()) return;
        waiters.delete(check);
        resolve();
      };
      waiters.add(check);
      check();
    });

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (hostReady()) {
        const settings = deps.settings();
        const key = settingsKey(settings);
        if (pushedFor?.key === key && pushedFor.generation === generation) break;
        const { binaryPath, pinnedVersion } = settings.engine;
        const custody = deps.custody ? await custodyOf(pinnedVersion) : null; // without custody nothing is awaited: the push goes at once
        if (settingsKey(deps.settings()) !== key) continue; // the latest settings win
        if (!hostReady()) break;
        const pushGeneration = generation;
        let error = binaryPath === null && custody !== null && custody.state !== 'ok' ? custody.message : null;
        try {
          const result = await deps.dispatch({ binaryPath: binaryPath ?? custody?.path ?? null, expectedVersion: pinnedVersion });
          if (!result.ok) {
            console.warn('[settings] engine.configure failed', result.error);
            error ??= result.error.message;
          }
        } catch (failure) {
          console.warn('[settings] engine.configure failed', failure);
          error ??= failure instanceof Error ? failure.message : String(failure);
        }
        pushedFor = { key, generation: pushGeneration };
        outcome = { key, error };
        firstAnswered = true;
      }
    } finally {
      pumping = false;
      notify();
    }
  };
  // C12 end
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
  if (deps.custody) void custodyOf(deps.settings().engine.pinnedVersion); // custody starts with the app, before any push
  // C12 end
  const offs = [
    deps.onHostState((state) => {
      // C12 start: each generation is configured again, through the serialized push
      if (state.state === 'ready') generation += 1;
      if (state.state === 'ready') void pump();
      notify(); // a host that went away holds no gate
      // C12 end
      if (state.state === 'ready') sendPolicy(budgetPolicyOf(deps.settings(), deps.totalMemBytes)); // C12
    }),
    deps.onSettingsChanged((settings) => {
      // C12 start
      if (deps.custody) void custodyOf(settings.engine.pinnedVersion); // a pin change runs custody before its push
      void pump();
      const next = budgetPolicyOf(settings, deps.totalMemBytes);
      if (!samePolicy(next, policy)) sendPolicy(next);
      // C12 end
    }),
  ];
  // C12 start
  if (hostReady()) generation += 1;
  void pump();
  if (hostReady()) sendPolicy(policy);
  return {
    stop: () => offs.forEach((off) => off()),
    applied: async () => {
      await until(() => settled() && outcome?.key === settingsKey(deps.settings()));
      if (outcome!.error !== null) throw new Error(outcome!.error);
    },
    custody: async () => (deps.custody ? custodyOf(deps.settings().engine.pinnedVersion) : null),
    launchGate: async () => {
      if (!deps.custody) return null;
      // custody's answer and the first push's (a launch in the first seconds after a first start waits for the copy and
      // for the host to hold its path); a crashed host holds nothing up
      await until(() => deps.hostState().state === 'crashed' || (firstAnswered && settled()));
      const { binaryPath, pinnedVersion } = deps.settings().engine;
      if (binaryPath !== null) return null; // a path the owner chose is used as chosen
      return custodyRefusal(await custodyOf(pinnedVersion));
    },
  };
  // C12 end
}
