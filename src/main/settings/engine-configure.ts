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
import type { LaunchResult } from '@shared/ipc/schema/session'; // C12
import { type Custody, custodyRefusal } from '../engine/custody'; // C12

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
  launchGate(): Promise<GateRefusal | null>; // null, or the refusal a launch answers
}

// Custody's refusals, and the two a bounded wait ends in: the copy still being made, or a host that never took the push.
export type GateRefusal = { status: 'refused'; reason: Extract<LaunchResult, { status: 'refused' }>['reason'] | 'host_unavailable'; message: string };

// How long the gate and `applied` wait for custody and the host's answer before they give up with words naming what
// they waited on (M4 review fix). The supervisor has no start timeout of its own; 30 s is well past its longest restart
// backoff (5 s) and its request timeout (10 s) together, and past a first start's copy and hash on this Mac (3.1 s), so
// only a host or copy that is stuck reaches it, and a setup never sits at "Starting" for good.
export const CONFIGURE_WAIT_MS = 30_000;

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
  // C12 start: the configure push, serialized behind custody. Each push's result is recorded for the settings and the
  // host generation it stood for; `applied`, the launch gate and the Settings row read one verdict from it (review fix:
  // answered is not applied, and a crashed host or a custody that failed is a verdict, not a wait).
  type CustodyAnswer = Custody | { state: 'failed'; message: string };
  const custodies = new Map<string, Promise<CustodyAnswer>>(); // one custody per version per app run, never rejecting
  const custodyDone = new Set<string>(); // versions whose custody has answered
  const custodyOf = (version: string): Promise<CustodyAnswer> => {
    let pending = custodies.get(version);
    if (!pending) {
      pending = deps.custody!(version).then(
        (c): CustodyAnswer => c,
        (error: unknown): CustodyAnswer => {
          console.warn('[custody] the check failed', error);
          const why = error instanceof Error ? error.message : String(error);
          return { state: 'failed', message: `MAWS could not check its copy of Claude Code ${version} (${why}). Restart MAWS, or choose a binary path in Settings › Engine.` };
        },
      );
      custodies.set(version, pending);
      void pending.then(() => {
        custodyDone.add(version);
        notify();
      });
    }
    return pending;
  };
  // What the last push (or the push custody's failure withheld) stood for and came to.
  interface Pushed { key: string; generation: number; custody: CustodyAnswer | null; applied: boolean; pushError: string | null }
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
    const chosen = deps.settings().engine.binaryPath !== null;
    const c = last.custody;
    if (!chosen && c !== null && c.state === 'failed') return { kind: 'done', refusal: { reason: 'binary_missing', message: c.message }, appliedError: c.message };
    const custodyRefused = !chosen && c !== null && c.state !== 'ok' && c.state !== 'failed' ? custodyRefusal(c) : null;
    if (!last.applied) {
      const message = `The engine host did not take the engine configuration: ${last.pushError}`;
      return { kind: 'done', refusal: custodyRefused ?? { reason: 'host_unavailable', message }, appliedError: custodyRefused?.message ?? last.pushError };
    }
    return { kind: 'done', refusal: custodyRefused, appliedError: custodyRefused?.message ?? null };
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
  // What a wait that ran out was waiting on: the copy for the pin, else the host in the state it is in.
  const stalled = (): Omit<GateRefusal, 'status'> => {
    const version = deps.settings().engine.pinnedVersion;
    if (deps.custody && deps.settings().engine.binaryPath === null && !custodyDone.has(version)) return { reason: 'binary_missing', message: `MAWS's copy of Claude Code ${version} was not ready within ${seconds} s. Try again in a moment, or restart MAWS.` };
    return { reason: 'host_unavailable', message: `The engine host is ${hostState()} and did not take the engine configuration within ${seconds} s. Try again once it is ready, or restart MAWS.` };
  };

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (hostState() === 'ready') {
        const settings = deps.settings();
        const key = settingsKey(settings);
        if (last?.key === key && last.generation === generation) break;
        const { binaryPath, pinnedVersion } = settings.engine;
        // custody for the pin, unless the owner chose a path (used as chosen) or custody does not run; without an await
        // the push goes at once
        const custody = deps.custody && binaryPath === null ? await custodyOf(pinnedVersion) : null;
        if (settingsKey(deps.settings()) !== key) continue; // the latest settings win
        if (hostState() !== 'ready') break;
        const pushGeneration = generation;
        if (custody !== null && custody.state === 'failed') {
          // nothing to push: binaryPath null would put the host on the installer's file
          last = { key, generation: pushGeneration, custody, applied: false, pushError: custody.message };
          continue;
        }
        let pushError: string | null = null;
        try {
          const result = await deps.dispatch({ binaryPath: binaryPath ?? custody?.path ?? null, expectedVersion: pinnedVersion });
          if (!result.ok) {
            console.warn('[settings] engine.configure failed', result.error);
            pushError = result.error.message;
          }
        } catch (failure) {
          console.warn('[settings] engine.configure failed', failure);
          pushError = failure instanceof Error ? failure.message : String(failure);
        }
        last = { key, generation: pushGeneration, custody, applied: pushError === null, pushError };
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
      notify(); // a crashed host is a verdict
      // C12 end
      if (state.state === 'ready') sendPolicy(budgetPolicyOf(deps.settings(), deps.totalMemBytes)); // C12
    }),
    deps.onSettingsChanged((settings) => {
      // C12 start
      if (deps.custody) void custodyOf(settings.engine.pinnedVersion); // a pin change runs custody before its push
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
    custody: async () => {
      if (!deps.custody) return null;
      const c = await custodyOf(deps.settings().engine.pinnedVersion);
      if (c.state === 'failed') throw new Error(c.message);
      return c;
    },
    launchGate: async () => {
      if (!deps.custody) return null;
      // custody's answer and the push for the settings as they stand (a launch in the first seconds after a first start
      // waits for the copy and for the host to hold its path); it fails closed, and never waits past CONFIGURE_WAIT_MS
      const v = await settle();
      if (v === null) return { status: 'refused', ...stalled() };
      return v.refusal === null ? null : { status: 'refused', ...v.refusal };
    },
  };
  // C12 end
}
