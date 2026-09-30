// Quitting with turns in flight asks first (D-16; C5 execution document, "Quit guard"; residue *Quit coordination*).
// Mid-turn is counted from C3's engine statuses in the read model (`midTurnCount`), never from the folded digest.
// C12 start: the widened question (C12 execution document, Interfaces "The quit question"; charter §3 P0 quit line as
// aligned by D8). The report counts sessions mid-turn or launching, sessions running background tasks or workflows that
// are not mid-turn, and terminals whose shell has a foreground command (C9's `pty.foreground`, asked in parallel, an
// unanswered probe counted busy as C9's close check does). `before-quit` must prevent synchronously and the report is
// asynchronous, so the guard always holds the quit while it computes the report: all zero, it disarms and quits through
// the existing path; otherwise it asks Quit, Quit when idle or Cancel. Quit stops the engine host's sessions
// (`engine.shutdown`) and quits; Quit when idle holds the quit, publishes the waiting report for the page's banner,
// re-reads it on every status change and every 2 s, and quits at zero. Foreign-live sessions and the owner's terminals
// outside MAWS are never waited on (the statuses and the pty table are MAWS's own). Quitting is one flight: once it
// starts, outside quits stay held and any report, question or wait still out is inert until the one final app.quit()
// (review fix). The end-to-end smoke answers
// without a dialog. The `Restart` wording waits for P1's updater.
// C12 end
import { app, type MessageBoxOptions } from 'electron';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionReadModel } from '../sessions/read-model';

// C12 start
export type QuitAnswer = 'quit' | 'when_idle' | 'cancel';
// terminalsUnknown: a live pty host did not list its terminals in time, so they count as one busy terminal, said so
export interface BusyReport { midTurn: number; backgroundWork: number; busyTerminals: number; terminalsUnknown: boolean }

export const PROBE_TIMEOUT_MS = 2_000; // per terminal, and for the list
export const WAIT_POLL_MS = 2_000;

export interface QuitPty {
  list(): Promise<readonly { ptyId: string; alive: boolean }[]>;
  foreground(ptyId: string): Promise<{ busy: boolean }>;
  hostGone(): boolean; // the supervisor's state: a pty host that is not running holds no terminal
}

const LIVE = new Set<EngineSessionStatus['process']>(['starting', 'initializing', 'ready']);
const LAUNCHING = new Set<EngineSessionStatus['process']>(['starting', 'initializing']);
const total = (r: BusyReport) => r.midTurn + r.backgroundWork + r.busyTerminals;

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
    promise.then(
      (value) => (clearTimeout(timer), resolve(value)),
      (error: unknown) => (clearTimeout(timer), reject(error)),
    );
  });
}

export async function busyReport(model: Pick<SessionReadModel, 'midTurnCount' | 'engineStatuses'>, pty: QuitPty): Promise<BusyReport> {
  // The sessions are read after the terminals (review fix): a status can only arrive between awaits, so the counts a
  // zero decision rests on are never older than the terminal read.
  const sessions = () => ({
    midTurn: model.midTurnCount(),
    // a session is counted once: background work only when it is not already counted mid-turn; ambient tasks are the
    // engine's housekeeping, as the budget's hard reasons read them
    backgroundWork: model.engineStatuses().filter((s) => LIVE.has(s.process) && s.turn === null && !LAUNCHING.has(s.process) && s.backgroundTasks.some((t) => !t.ambient)).length,
  });
  let ptys: readonly { ptyId: string; alive: boolean }[] = [];
  try {
    ptys = await within(pty.list(), PROBE_TIMEOUT_MS);
  } catch (error) {
    // review fix: only a pty host that is gone holds no terminal; a slow live one may hold busy ones
    if (!pty.hostGone()) {
      console.warn('[quit-guard] the pty host did not list its terminals; counting them busy', error);
      return { ...sessions(), busyTerminals: 1, terminalsUnknown: true };
    }
  }
  const probes = ptys.filter((p) => p.alive).map((p) => within(pty.foreground(p.ptyId), PROBE_TIMEOUT_MS).then((f) => f.busy, () => true));
  const busyTerminals = (await Promise.all(probes)).filter(Boolean).length;
  return { ...sessions(), busyTerminals, terminalsUnknown: false };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function quitQuestion(report: BusyReport, verb: 'Quit' | 'Restart'): MessageBoxOptions {
  const parts = [
    report.midTurn > 0 ? `${plural(report.midTurn, 'session', 'sessions')} mid-turn` : null,
    report.backgroundWork > 0 ? `${plural(report.backgroundWork, 'session', 'sessions')} running background work` : null,
    report.terminalsUnknown ? 'the terminals did not answer' : report.busyTerminals > 0 ? `${plural(report.busyTerminals, 'terminal', 'terminals')} running a command` : null,
  ].filter((p): p is string => p !== null);
  return {
    type: 'warning',
    buttons: [verb, `${verb} when idle`, 'Cancel'],
    defaultId: 2,
    cancelId: 2,
    message: parts.join(' · '),
    detail: `${verb === 'Quit' ? 'Quitting' : 'Restarting'} stops them. Transcripts stay on disk and can be resumed.`,
  };
}

// The e2e's words for a report: C5's `4 mid-turn` stays as it was when only turns are busy.
function logParts(r: BusyReport): string {
  const parts = [
    r.midTurn > 0 ? `${r.midTurn} mid-turn` : null,
    r.backgroundWork > 0 ? `${r.backgroundWork} background work` : null,
    r.terminalsUnknown ? 'terminals unknown' : r.busyTerminals > 0 ? plural(r.busyTerminals, 'busy terminal', 'busy terminals') : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(', ') : 'nothing busy';
}
// C12 end

// The question as the app asks it: the native dialog, or under `MAWS_E2E=1` the answer `MAWS_E2E_QUIT_ANSWER` gives
// (quit by default; C12: `cancel` and `when_idle` too), logged to stderr for the smoke to read.
export async function askToQuit(
  report: BusyReport, // C12: the report, not C5's mid-turn count
  deps: { env: Record<string, string | undefined>; show(options: MessageBoxOptions): Promise<{ response: number }> },
): Promise<QuitAnswer> {
  if (deps.env.MAWS_E2E === '1') {
    const asked = deps.env.MAWS_E2E_QUIT_ANSWER;
    const answer: QuitAnswer = asked === 'cancel' || asked === 'when_idle' ? asked : 'quit';
    console.error(`quit-guard: ${logParts(report)}, auto-answered ${answer}`);
    return answer;
  }
  const { response } = await deps.show(quitQuestion(report, 'Quit'));
  return response === 0 ? 'quit' : response === 1 ? 'when_idle' : 'cancel'; // C12: three buttons
}

// C12 start
export interface QuitGuardDeps {
  pty: QuitPty;
  ask(report: BusyReport): Promise<QuitAnswer>;
  shutdownEngine(): Promise<void>;
  publish(waiting: BusyReport | null): void; // the page's "MAWS will quit when … finish" banner
  log?(line: string): void; // the report's latency, for the e2e
  pollMs?: number;
}

export interface QuitGuard {
  waiting(): BusyReport | null;
  quitNow(): void; // the banner's Quit now
  cancelWait(): void; // the banner's Cancel
}

export function installQuitGuard(model: Pick<SessionReadModel, 'midTurnCount' | 'engineStatuses' | 'on'>, deps: QuitGuardDeps): QuitGuard {
  let disarmed = false; // set only right before the one final app.quit()
  let quitting: Promise<void> | null = null; // the one quit in flight: outside quits stay held, outstanding work is inert
  let asking = false; // a report or a question is under way
  let wait: { report: BusyReport; stop: () => void } | null = null; // each wait is its own object: a cancelled one's reads are inert
  const report = () => busyReport(model, deps.pty);

  const finalQuit = () => {
    disarmed = true;
    app.quit();
  };
  // nothing busy: the existing quit path stops the hosts
  const quit = () => {
    if (quitting) return;
    stopWaiting();
    quitting = Promise.resolve();
    finalQuit();
  };
  const stopWaiting = () => {
    if (!wait) return;
    wait.stop();
    wait = null;
    deps.publish(null);
  };
  const quitNow = (): Promise<void> => {
    if (quitting) return quitting;
    stopWaiting();
    quitting = (async () => {
      try {
        await deps.shutdownEngine();
      } catch (error) {
        console.error('[quit-guard] stopping the engine failed; quitting anyway', error);
      }
      finalQuit();
    })();
    return quitting;
  };
  const startWaiting = (first: BusyReport) => {
    if (wait) {
      wait.report = first;
      deps.publish(first);
      return;
    }
    let reading = false;
    let again = false; // something changed while a read was out: that read decides nothing, the next one does
    const recheck = () => {
      if (wait !== mine) return;
      if (reading) return void (again = true);
      reading = true;
      void report()
        .then((next) => {
          if (wait !== mine || again) return;
          if (total(next) === 0) {
            quit();
          } else {
            mine.report = next;
            deps.publish(next);
          }
        })
        .finally(() => {
          reading = false;
          if (again && wait === mine) {
            again = false;
            recheck();
          }
        });
    };
    const off = model.on('engine', recheck);
    const timer = setInterval(recheck, deps.pollMs ?? WAIT_POLL_MS);
    const mine = { report: first, stop: () => (off(), clearInterval(timer)) };
    wait = mine;
    deps.publish(first);
  };

  app.on('before-quit', (event) => {
    if (disarmed) return;
    event.preventDefault();
    if (asking || quitting) return;
    asking = true;
    const started = Date.now();
    void report()
      .then(async (r) => {
        if (quitting) return;
        deps.log?.(`quit-report: ${Date.now() - started} ms · ${logParts(r)}`);
        if (total(r) === 0) return quit();
        const answer = await deps.ask(r).catch((error: unknown) => {
          console.error('[quit-guard] the quit question failed; treating it as Cancel', error);
          return 'cancel' as const;
        });
        if (quitting) return; // the banner's Quit now answered first
        if (answer === 'quit') await quitNow();
        else if (answer === 'when_idle') startWaiting(r);
        // Cancel keeps the app, and leaves a wait already under way as it was (the banner has its own Cancel)
      })
      .finally(() => {
        asking = false;
      });
  });

  return {
    waiting: () => wait?.report ?? null,
    quitNow: () => void quitNow(),
    cancelWait: stopWaiting,
  };
}
// C12 end
