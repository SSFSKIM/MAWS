// Main keeps the engine host's binary configuration equal to `settings.engine` (C11 execution document, Interfaces
// "Settings, version 3"): `engine.configure` goes to the host whenever the host is ready (its configuration is process
// state, so a restarted host is configured again) and whenever the binary path changes. A change while sessions are
// live affects the next launch only; a live process keeps the binary it started with.
// C12 start: main is the only sender of `engine.configure` (C12 execution document, Interfaces "Engine custody",
// Configure; the Settings tab writes settings and awaits `settings.engineApplied`). Pushes go one at a time, the latest
// settings winning. W13: custody of a pinned copy is retired with the pin; the push carries the chosen path, or null
// for the installed Claude Code, which the host resolves per launch.
// C12 end
import type { CommandInput, CommandResult, EngineBinaryConfig, HostState, Settings } from '@shared/ipc/schema';
import { defaultBudgetKiB } from '../../engine-host/budget'; // C12
import type { LaunchResult } from '@shared/ipc/schema/session'; // C12

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

// C12 start: what main answers besides the pushes (C12 execution document, Interfaces "X2 additions"):
// `settings.engineApplied`, and the launch gate C10's setup and resume consult.
export interface EngineConfigure {
  stop(): void;
  applied(): Promise<void>; // the push for settings.engine as it now stands has been answered; rejects with the push's message
  launchGate(): Promise<GateRefusal | null>; // null, or the refusal a launch answers
}

// The refusal a bounded wait ends in: a host that is crashed, refused the push, or never took it.
export type GateRefusal = { status: 'refused'; reason: Extract<LaunchResult, { status: 'refused' }>['reason'] | 'host_unavailable'; message: string };

// How long the gate and `applied` wait for the host's answer before they give up with words naming what they waited on
// (M4 review fix). The supervisor has no start timeout of its own; 30 s is well past its longest restart backoff (5 s)
// and its request timeout (10 s) together, so only a host that is stuck reaches it, and a setup never sits at
// "Starting" for good.
export const CONFIGURE_WAIT_MS = 30_000;

export type BudgetPolicy = CommandInput<'engine.policy.set'>;

// settings.engine's budget as the host takes it: the setting in KiB, or 25% of physical memory while it is null. W7:
// whether it is on; the limit goes either way, so the host's state names it and turning the budget on needs no more.
export const budgetPolicyOf = ({ engine }: Settings, totalMemBytes: number): BudgetPolicy => ({
  enabled: engine.memoryBudget.enabled, // W7
  limitKiB: engine.memoryBudgetMiB !== null ? engine.memoryBudgetMiB * 1024 : defaultBudgetKiB(totalMemBytes),
  statefulMcpServers: [...engine.statefulMcpServers],
});
const samePolicy = (a: BudgetPolicy, b: BudgetPolicy) => a.enabled === b.enabled /* W7 */ && a.limitKiB === b.limitKiB && a.statefulMcpServers.join('\n') === b.statefulMcpServers.join('\n');

// The settings a configure push stands for (C11's `configOf` and `same` gave way to it; W13: the path alone).
const settingsKey = ({ engine }: Settings) => engine.binaryPath ?? '';
// C12 end

export function startEngineConfigure(deps: EngineConfigureDeps): EngineConfigure {
  // C12 start: the configure push, serialized. Each push's result is recorded for the settings and the host generation
  // it stood for; `applied` and the launch gate read one verdict from it (review fix: answered is not applied, and a
  // crashed host is a verdict, not a wait).
  interface Pushed { key: string; generation: number; applied: boolean; pushError: string | null }
  let generation = 0; // host generations seen ready; each starts unconfigured
  let last: Pushed | null = null;
  let pumping = false;
  const waiters = new Set<() => void>();
  const notify = () => [...waiters].forEach((check) => check());
  const hostState = () => deps.hostState().state;
  const seconds = CONFIGURE_WAIT_MS / 1000;

  // The verdict for settings.engine as it stands: still to come, or what the gate and `applied` answer.
  type Verdict = { kind: 'pending' } | { kind: 'done'; refusal: Omit<GateRefusal, 'status'> | null; appliedError: string | null };
  const verdict = (): Verdict => {
    if (hostState() === 'crashed') {
      const message = 'The engine host is crashed and holds no engine configuration. Restart MAWS.';
      return { kind: 'done', refusal: { reason: 'host_unavailable', message }, appliedError: message };
    }
    if (hostState() !== 'ready' || pumping || last === null || last.key !== settingsKey(deps.settings()) || last.generation !== generation) return { kind: 'pending' };
    if (!last.applied) {
      const message = `The engine host did not take the engine configuration: ${last.pushError}`;
      return { kind: 'done', refusal: { reason: 'host_unavailable', message }, appliedError: last.pushError };
    }
    return { kind: 'done', refusal: null, appliedError: null };
  };
  // The verdict once it is in, or null when CONFIGURE_WAIT_MS passes first; a waiter that times out is removed.
  const settle = (): Promise<Extract<Verdict, { kind: 'done' }> | null> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(check);
        resolve(null);
      }, CONFIGURE_WAIT_MS);
      const check = () => {
        const v = verdict();
        if (v.kind === 'pending') return;
        clearTimeout(timer);
        waiters.delete(check);
        resolve(v);
      };
      waiters.add(check);
      check();
    });
  // What a wait that ran out was waiting on: the host in the state it is in.
  const stalled = (): Omit<GateRefusal, 'status'> => ({
    reason: 'host_unavailable',
    message: `The engine host is ${hostState()} and did not take the engine configuration within ${seconds} s. Try again once it is ready, or restart MAWS.`,
  });

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (hostState() === 'ready') {
        const settings = deps.settings();
        const key = settingsKey(settings);
        if (last?.key === key && last.generation === generation) break;
        const pushGeneration = generation;
        let pushError: string | null = null;
        try {
          const result = await deps.dispatch({ binaryPath: settings.engine.binaryPath });
          if (!result.ok) {
            console.warn('[settings] engine.configure failed', result.error);
            pushError = result.error.message;
          }
        } catch (failure) {
          console.warn('[settings] engine.configure failed', failure);
          pushError = failure instanceof Error ? failure.message : String(failure);
        }
        last = { key, generation: pushGeneration, applied: pushError === null, pushError };
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
  // C12 end
  const offs = [
    deps.onHostState((state) => {
      // C12 start: each generation is configured again, through the serialized push
      if (state.state === 'ready') generation += 1;
      if (state.state === 'ready') void pump();
      notify(); // a crashed host is a verdict
      // C12 end
      if (state.state === 'ready') sendPolicy(budgetPolicyOf(deps.settings(), deps.totalMemBytes)); // C12
    }),
    deps.onSettingsChanged((settings) => {
      // C12 start
      void pump();
      notify(); // a change made while the host is down is answered from its state
      const next = budgetPolicyOf(settings, deps.totalMemBytes);
      if (!samePolicy(next, policy)) sendPolicy(next);
      // C12 end
    }),
  ];
  // C12 start
  if (hostState() === 'ready') generation += 1;
  void pump();
  if (hostState() === 'ready') sendPolicy(policy);
  return {
    stop: () => offs.forEach((off) => off()),
    applied: async () => {
      const v = await settle();
      if (v === null) throw new Error(stalled().message);
      if (v.appliedError !== null) throw new Error(v.appliedError);
    },
    // The push for the settings as they stand (a launch in the first seconds after a start, or right after the binary
    // changed in Settings, waits for the host to hold that path); it fails closed, and never waits past CONFIGURE_WAIT_MS.
    launchGate: async () => {
      const v = await settle();
      if (v === null) return { status: 'refused', ...stalled() };
      return v.refusal === null ? null : { status: 'refused', ...v.refusal };
    },
  };
  // C12 end
}
