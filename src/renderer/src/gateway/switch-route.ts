// The route switch (C11 execution document, Interfaces "Gateway", *The switch*; M4 decisions and refresh task "the
// switch's failure and the queue"). A session's route is a launch-environment fact (X6), so changing it is a stop and a
// resume. The machine, one in flight per session, in the gateway store's `switching` map:
//   confirming   the sheet: the background work of a fresh status (§4.4: exit never silently discards it) and, for a
//                Direct target on a gateway model, a Claude model chosen before anything is stopped
//   interrupting session.interrupt when a turn is open, then the turn's end (10 s)
//   rechecking   one more session.status; a background task the confirm did not name returns to confirming
//   stopping     session.stop { reason: 'stop' }, then the exit (C3's ladder; the queue and grants stay in its state file)
//   starting     C10's session.start with options { gateway, model?, effort? }, then a ready status on the new route
//   done         a toast, and the queue resumed when the switch's own interrupt paused it
//   failed       at any phase: the session left where that phase reached, said in words, never retried by itself
// Each dependency is injected, so the machine runs the same over the app's IPC and over a scripted store.
import type { Effort } from '@shared/engine/launch-spec';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { toast } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { isGatewayModel } from '@shared/sessions/models';
import { runAction } from '../keymap/actions-runtime';
import { FOOTER, SWITCH, type Route } from './copy';
import { switchRefusal } from './routing-facts';
import { sessionStartOver, type SessionStart, type StartOptions } from './session-start';
import { useGateway, type GatewayStore, type SwitchConfirm, type SwitchState } from './store';

export type SwitchOutcome = 'done' | 'cancelled' | 'failed';
// What the sheet answers: the Direct model chosen (with its display name for the toast, and the effort the launch needs
// when the chosen entry does not admit the current one), or all null for a switch that needs no model; and the
// background work its disclosure showed when it was answered (C10's `BackgroundWorkDisclosure` lists it live), which
// is what the recheck compares against, since that is what the human confirmed.
export type SwitchAnswer = { model: string | null; displayName: string | null; effort: Effort | null; backgroundTasks?: EngineSessionStatus['backgroundTasks'] };

export interface SwitchTimeouts {
  turnMs: number; // the interrupted turn's end
  exitMs: number; // the process's exit when session.stop answered before it
  readyMs: number; // the restarted process ready on its new route (the initialize bound under the owner's settings)
}
const TIMEOUTS: SwitchTimeouts = { turnMs: 10_000, exitMs: 10_000, readyMs: 60_000 };

export interface SwitchDeps {
  client: MawsBridge;
  record(appSessionId: AppSessionId): SessionRecord | null;
  status(appSessionId: AppSessionId): EngineSessionStatus | null; // the latest status held for the session
  start: SessionStart; // C10's session.start (the resume) and its setup failures
  toast(text: string, action?: { label: string; run(): void }): void;
  timeouts?: Partial<SwitchTimeouts>;
}

// The sheet's confirm button (Interfaces: `Stop them and switch` when background work is listed).
export const switchButtonLabel = (confirm: SwitchConfirm): string => (confirm.backgroundTasks.length > 0 ? SWITCH.stopAndSwitch : SWITCH.restart[confirm.target]);

const LIVE: ReadonlySet<EngineSessionStatus['process']> = new Set(['starting', 'initializing', 'ready', 'exiting']);

class Failed extends Error {}

export function createRouteSwitcher(deps: SwitchDeps, store: GatewayStore) {
  const timeouts = { ...TIMEOUTS, ...deps.timeouts };
  const asks = new Map<AppSessionId, (answer: SwitchAnswer | null) => void>();

  const put = (id: AppSessionId, state: SwitchState) => store.setState((s) => ({ switching: new Map(s.switching).set(id, state) }));
  const clear = (id: AppSessionId) =>
    store.setState((s) => {
      const switching = new Map(s.switching);
      switching.delete(id);
      return { switching };
    });

  // A status for the session that `test` accepts (answering a value), from the one held now or the next ones; null
  // after `ms`, or when `abort` fires first.
  function awaitStatus<T>(id: AppSessionId, test: (s: EngineSessionStatus) => T | undefined, ms: number, abort?: (stop: (value: T | null) => void) => () => void): Promise<T | null> {
    return new Promise((resolve) => {
      let settled = false;
      const offs: (() => void)[] = [];
      const finish = (value: T | null) => {
        if (settled) return;
        settled = true;
        offs.forEach((off) => off());
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), ms);
      offs.push(
        deps.client.on('session.status', ({ appSessionId, status }) => {
          const value = appSessionId === id ? test(status) : undefined;
          if (value !== undefined) finish(value);
        }),
      );
      if (abort) offs.push(abort(finish));
      const held = deps.status(id);
      const value = held ? test(held) : undefined;
      if (value !== undefined) finish(value);
    });
  }

  async function invoke<T>(run: () => Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }>, words: (why: string) => string): Promise<T> {
    const result = await run();
    if (!result.ok) throw new Failed(words(result.error.message));
    return result.value;
  }

  const relayAnswers = async (): Promise<boolean> => {
    try {
      return (await store.getState().refreshRelay(true)).ok;
    } catch {
      return false; // the check itself failed: nothing is stopped on a relay no one could read
    }
  };

  const readStatus = (id: AppSessionId) => invoke(() => deps.client.invoke('session.status', { appSessionId: id }), SWITCH.readFailed);

  function ask(id: AppSessionId, state: SwitchState): Promise<SwitchAnswer | null> {
    put(id, state);
    return new Promise((resolve) => asks.set(id, resolve));
  }

  async function switchRoute(id: AppSessionId, target: Route): Promise<SwitchOutcome> {
    const current = store.getState().switching.get(id);
    if (current && current.phase !== 'done' && current.phase !== 'failed') {
      deps.toast(SWITCH.alreadySwitching);
      return 'failed';
    }
    const { start } = deps;
    const record = deps.record(id);
    const refusal = record ? switchRefusal(record) : SWITCH.notRunning;
    if (!record || refusal) {
      deps.toast(refusal ?? SWITCH.notRunning);
      return 'failed';
    }

    // Claimed before the first await, so a second call (a double click, or both targets of an unrecorded route) meets
    // the guard above and never starts a second machine. The sheet renders only once the confirm is known.
    let state: SwitchState = { target, phase: 'confirming', confirm: null, error: null };
    put(id, state);
    let queueRunning: boolean | null = null;
    // The queue the switch's own interrupt paused, resumed: only when it ran before and is still paused for that (at
    // done, on a cancel after the interrupt, and on every failure, since the process, or its resume, keeps the queue
    // held otherwise). A no-op before the interrupt, when `queueRunning` is not read yet.
    const resumeQueue = async () => {
      if (!queueRunning) return;
      const queue = await deps.client.invoke('session.queue.list', { appSessionId: id });
      if (queue.ok && queue.value.paused && queue.value.pauseReason === 'interrupt') await deps.client.invoke('session.queue.setPaused', { appSessionId: id, paused: false });
    };
    const fail = async (error: string): Promise<SwitchOutcome> => {
      try {
        await resumeQueue();
      } catch (resumeError) {
        console.error('[gateway] the queue could not be resumed after a failed switch', resumeError);
      }
      put(id, { ...state, phase: 'failed', error });
      return 'failed';
    };
    try {
      const held = deps.status(id);
      const live = held !== null && LIVE.has(held.process);
      const fresh = live ? await readStatus(id) : null;
      const beforeLaunch = (fresh ?? held)?.launchId ?? null;
      // The model the resume would launch: the record's (C3 keeps it current from every status after a set_model), read
      // from the live status first, which the record is patched from.
      const launching = fresh?.model.requested ?? record.model.requested ?? fresh?.model.resolved ?? record.model.resolved;
      let confirm: SwitchConfirm = { target, backgroundTasks: fresh?.backgroundTasks ?? [], requiresModel: target === 'direct' && launching !== null && isGatewayModel(launching), model: null, effort: null };
      let error: string | null = null;
      let answer: SwitchAnswer | null = null;

      for (;;) {
        state = { target, phase: 'confirming', confirm, error };
        answer = await ask(id, state);
        if (answer === null) {
          await resumeQueue();
          clear(id);
          return 'cancelled';
        }
        confirm = { ...confirm, model: answer.model, effort: answer.effort, backgroundTasks: answer.backgroundTasks ?? confirm.backgroundTasks };
        state = { ...state, confirm };
        if (!live) break;

        // Toward the gateway, the relay is asked before anything stops: a restart onto a relay that does not answer would
        // leave the session stopped behind C10's relay card.
        if (target === 'gateway' && !(await relayAnswers())) {
          deps.toast(SWITCH.relayDown, { label: FOOTER.openClaudeUsageAction, run: () => runAction('gateway.openClaudeUsage') });
          return fail(SWITCH.relayDown);
        }

        // Whether the app queue runs now, read before the interrupt that would pause it (once per switch).
        if (queueRunning === null) {
          const queue = await deps.client.invoke('session.queue.list', { appSessionId: id });
          queueRunning = queue.ok && !queue.value.paused;
        }
        if (deps.status(id)?.turn) {
          state = { ...state, phase: 'interrupting', error: null };
          put(id, state);
          await invoke(() => deps.client.invoke('session.interrupt', { appSessionId: id, cancelEngineQueued: false }), SWITCH.interruptFailed);
          if ((await awaitStatus(id, (s) => (s.turn === null ? true : undefined), timeouts.turnMs)) === null) return fail(SWITCH.turnDidNotStop);
        }

        state = { ...state, phase: 'rechecking', error: null };
        put(id, state);
        const recheck = await readStatus(id);
        const named = new Set(confirm.backgroundTasks.map((t) => t.taskId));
        if (recheck.backgroundTasks.some((t) => !named.has(t.taskId))) {
          confirm = { ...confirm, backgroundTasks: recheck.backgroundTasks };
          error = SWITCH.newWork;
          continue;
        }
        break;
      }

      if (live) {
        state = { ...state, phase: 'stopping', error: null };
        put(id, state);
        const stopped = await invoke(() => deps.client.invoke('session.stop', { appSessionId: id, reason: 'stop' }), SWITCH.stopFailed);
        if (!stopped.exited && (await awaitStatus(id, (s) => (s.process === 'exited' ? true : undefined), timeouts.exitMs)) === null) return fail(SWITCH.didNotExit);
      }

      state = { ...state, phase: 'starting', error: null };
      put(id, state);
      const options: StartOptions = { gateway: target };
      if (answer.model !== null) options.model = answer.model;
      if (answer.effort !== null) options.effort = answer.effort;
      // Subscribed before the start, so a setup failure that follows at once is heard.
      let offFailure: (() => void) | null = null;
      let failure: string | null = null;
      const failed = new Promise<void>((resolve) => {
        offFailure = start.onSetupFailure(id, (reason) => {
          failure = reason;
          resolve();
        });
      });
      try {
        const started = await start.start(id, options);
        if (started.status !== 'starting') return fail(SWITCH.refused(started.reason));
        const verdict = await awaitStatus<'ready' | 'mismatch'>(
          id,
          (s) => {
            if (s.launchId === beforeLaunch || s.process !== 'ready' || s.gateway.verified === 'pending') return undefined;
            // verified on the route asked for; a mismatch, or a verified launch on the other route, fails at once
            const verified = s.gateway.verified === 'routed' || s.gateway.verified === 'direct';
            return verified && s.gateway.mode === target ? 'ready' : 'mismatch';
          },
          timeouts.readyMs,
          (stop) => {
            void failed.then(() => stop(null));
            return () => {};
          },
        );
        if (failure !== null) return fail(SWITCH.refused(failure));
        if (verdict === 'mismatch') return fail(SWITCH.mismatch(target));
        if (verdict === null) return fail(SWITCH.notReady);
      } finally {
        (offFailure as (() => void) | null)?.();
      }

      await resumeQueue();
      put(id, { ...state, phase: 'done', error: null });
      deps.toast(SWITCH.toast(record.title.text, target, answer.displayName));
      return 'done';
    } catch (error) {
      if (error instanceof Failed) return fail(error.message);
      console.error('[gateway] the route switch failed', error);
      return fail(error instanceof Error ? error.message : String(error));
    } finally {
      asks.delete(id);
    }
  }

  // The sheet's answer; refused (false) while a required model is missing, or when nothing is asking.
  function answer(id: AppSessionId, reply: SwitchAnswer | null): boolean {
    const resolve = asks.get(id);
    if (!resolve) return false;
    const confirm = store.getState().switching.get(id)?.confirm;
    if (reply !== null && confirm?.requiresModel && reply.model === null) return false;
    asks.delete(id);
    resolve(reply);
    return true;
  }

  return { switchRoute, answer };
}

// The app's switcher: the IPC client, C5's sessions store, C10's start, C5's toasts.
const app = createRouteSwitcher(
  {
    client: ipc,
    record: (id) => useSessions.getState().records.get(id) ?? null,
    status: (id) => useSessions.getState().engine.get(id) ?? null,
    start: sessionStartOver(ipc),
    toast: (text, action) => void toast({ level: action ? 'warning' : 'info', text, actions: action ? [action] : [], dismissible: true }),
  },
  useGateway,
);

export const switchRoute = (appSessionId: AppSessionId, target: Route): Promise<SwitchOutcome> => app.switchRoute(appSessionId, target);
export const answerSwitch = (appSessionId: AppSessionId, reply: SwitchAnswer | null): boolean => app.answer(appSessionId, reply);
