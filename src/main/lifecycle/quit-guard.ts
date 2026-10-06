// Quitting with turns in flight asks first (D-16; C5 execution document, "Quit guard"; residue *Quit coordination*).
// Mid-turn is counted from C3's engine statuses in the read model (`midTurnCount`), never from the folded digest.
// C12 start: the widened question (C12 execution document, Interfaces "The quit question"; charter §3 P0 quit line as
// aligned by D8). The report counts sessions mid-turn, launching or otherwise working (host work in flight, or the
// engine running or waiting, with no turn), sessions running background tasks or workflows that are not counted so,
// and terminals whose shell has a foreground command (C9's `pty.foreground`, asked in parallel, an unanswered probe
// counted busy as C9's close check does). `before-quit` must prevent synchronously and the report is
// asynchronous, so the guard always holds the quit while it computes the report: all zero, it quits; otherwise it asks
// Quit, Quit when idle or Cancel. Quit quits; Quit when idle holds the quit, publishes the waiting report for the page's
// banner, re-reads it on every status change and every 2 s, and quits at zero. Every quit first stops the engine host's
// sessions (`engine.shutdown`, each through its ladder) and waits for that answer, bounded by SHUTDOWN_BOUND_MS, before
// the final app.quit(): will-quit then kills the hosts, and an engine still running there would outlive the app.
// Foreign-live sessions and the owner's terminals outside MAWS are never waited on (the statuses and the pty table are
// MAWS's own). Quitting is one flight: once it starts, outside quits stay held and any report, question or wait still
// out is inert until the one final app.quit() (review fix). The end-to-end smoke answers without a dialog. The
// `Restart` wording waits for P1's updater.
// C12 end
// E5 start: unsaved editor files (E5 execution document, Interfaces "The quit guard and unsaved files (M5)"; the owner's
// ruling of 2026-10-06). Each window pushes its dirty file tabs (`layout.unsavedFiles`); the report carries their union
// and counts it, so a wait also waits for a file dirtied during it. With files unsaved the question offers Save all,
// Quit anyway and Cancel: Save all asks every window to save (`layout.saveAll`), waits for each window holding files to
// answer, bounded, then reads the report again, quitting when nothing is left and asking again otherwise; the question
// asked again names each file a window could not save with its reason. A tab in the merge view is never saved by Save
// all (the renderer answers it as the conflict it is). Under MAWS_E2E a question asked again about unsaved files is
// answered Cancel, so a save that keeps failing cannot loop a test.
// E5 end
// E10 start: keeping the sessions running (E10 execution document, §Design 5; ruled by A-29). In detached mode the engine
// host is the supervisor, which outlives the app, so a non-zero report is asked with "Quit and keep sessions running"
// first (the default button when the setting says so, else Quit; Cancel stays the cancel button). Keep skips the engine
// shutdown and the SIGKILL rung and quits: will-quit then closes the supervisor's socket without an exit, and it serves
// its sessions on. Every other quit stops the sessions as before (shutdownEngine). With files unsaved E5's question
// comes first, unchanged; after Save all the ordinary question, keep included, follows. An unbusy quit is never asked.
// E10 end
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto'; // E5
import { basename } from 'node:path'; // E5
import { app, type MessageBoxOptions } from 'electron';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionReadModel } from '../sessions/read-model';
import { QUIT_KEEP } from './copy'; // E10

// C12 start
export type QuitAnswer = 'quit' | 'when_idle' | 'cancel' | 'save_all' /* E5 */ | 'keep' /* E10 */;
// terminalsUnknown: a live pty host did not list its terminals in time, so they count as one busy terminal, said so
// E5: unsavedFiles, the absolute paths of every window's dirty file tabs, sorted
export interface BusyReport { midTurn: number; backgroundWork: number; busyTerminals: number; terminalsUnknown: boolean; unsavedFiles: string[] }

export const PROBE_TIMEOUT_MS = 2_000; // per terminal, and for the list
export const WAIT_POLL_MS = 2_000;
// How long a quit waits for engine.shutdown. The host's ladder (session-ladder.ts) writes end_session and waits 3 s for
// the exit, then closes stdin and sends SIGTERM (2.1.283's own handler exits 143: pass3/sigterm-disposition.mjs), then
// SIGKILL at 6 s. 5 s covers the end_session rung and 2 s of the SIGTERM rung, so only an engine that ignores both
// would lose its SIGKILL rung, since will-quit kills the engine host (debt wave 6): past the bound main sends that rung
// itself (`killEngines`) before the final app.quit().
export const SHUTDOWN_BOUND_MS = 5_000;
export const KILL_PS_TIMEOUT_MS = 1_000; // the process listing that confirms each pid before its SIGKILL

// The engine host's processes as main reaches them at the bound: its pid (the supervisor's), the process listing
// (`ps -axo pid=,ppid=`) and the signal.
export interface EngineKill {
  hostPid(): number | null;
  ps(): Promise<string>;
  kill(pid: number): void; // SIGKILL
}

export const listProcesses = (): Promise<string> =>
  new Promise((resolve, reject) => execFile('/bin/ps', ['-axo', 'pid=,ppid='], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout))));

class BoundExpired extends Error {}

export interface QuitPty {
  list(): Promise<readonly { ptyId: string; alive: boolean }[]>;
  foreground(ptyId: string): Promise<{ busy: boolean }>;
  hostGone(): boolean; // the supervisor's state: a pty host that is not running holds no terminal
}

const LIVE = new Set<EngineSessionStatus['process']>(['starting', 'initializing', 'ready']);
const LAUNCHING = new Set<EngineSessionStatus['process']>(['starting', 'initializing']);
const total = (r: BusyReport) => r.midTurn + r.backgroundWork + r.busyTerminals + r.unsavedFiles.length; // E5: an unsaved file holds a quit too

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new BoundExpired(`no answer within ${ms} ms`)), ms);
    promise.then(
      (value) => (clearTimeout(timer), resolve(value)),
      (error: unknown) => (clearTimeout(timer), reject(error)),
    );
  });
}

export async function busyReport(
  model: Pick<SessionReadModel, 'midTurnCount' | 'engineStatuses'>,
  pty: QuitPty,
  unsavedFiles: () => readonly string[] = () => [], // E5: the windows' last pushes
): Promise<BusyReport> {
  // The sessions are read after the terminals (review fix): a status can only arrive between awaits, so the counts a
  // zero decision rests on are never older than the terminal read. E5: nor are the unsaved files, read with them.
  const sessions = () => {
    // with no open turn, a live session still works when the host has work in flight (`busy`: a `!` command, a message
    // not yet started) or the engine reports itself running or waiting (whole-branch review); it counts with the turns
    const idleTurn = model.engineStatuses().filter((s) => LIVE.has(s.process) && s.turn === null && !LAUNCHING.has(s.process));
    const working = idleTurn.filter((s) => s.busy || s.engineState === 'running' || s.engineState === 'requires_action');
    return {
      midTurn: model.midTurnCount() + working.length,
      // a session is counted once: background work only when it is not already counted working or mid-turn; ambient tasks
      // are the engine's housekeeping, as the budget's hard reasons read them
      backgroundWork: idleTurn.filter((s) => !working.includes(s) && s.backgroundTasks.some((t) => !t.ambient)).length,
      unsavedFiles: [...unsavedFiles()], // E5
    };
  };
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

// Debt wave 6: the ladder's SIGKILL rung for every engine the statuses name as not yet exited, sent only to a pid the
// listing still shows as the engine host's child, so a pid the OS reused after an exit main has not heard of yet is
// never signalled. A listing that fails or is late kills nothing; the quit goes on either way.
export async function killEngines(statuses: readonly EngineSessionStatus[], deps: EngineKill): Promise<number[]> {
  const host = deps.hostPid();
  const known = statuses.flatMap((s) => (s.process !== 'exited' && s.pid !== null ? [s.pid] : []));
  if (host === null || known.length === 0) return [];
  const parents = new Map<number, number>();
  for (const line of (await within(deps.ps(), KILL_PS_TIMEOUT_MS)).split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (Number.isInteger(pid) && Number.isInteger(ppid)) parents.set(pid!, ppid!);
  }
  const killed: number[] = [];
  for (const pid of known) {
    if (parents.get(pid) !== host) continue;
    try {
      deps.kill(pid);
      killed.push(pid);
    } catch {
      // exited between the listing and the signal
    }
  }
  return killed;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// E10: keep is offered (detached mode), as the default button or not; `kept()` counts the sessions a keep leaves
// running, read when the answer is logged
export interface KeepOffer { isDefault: boolean; kept(): number }

// E5: the unsaved question's detail names the files by basename, at most five. A file the last Save all could not save
// gets a line of its own with the reason its window gave (`app.ts: Changed on disk since you opened it`); the others
// share the `Unsaved:` line.
const UNSAVED_NAMES_MAX = 5;
function unsavedDetail(paths: readonly string[], reasons: ReadonlyMap<string, string>): string {
  const shown = paths.slice(0, UNSAVED_NAMES_MAX);
  const more = paths.length > shown.length ? `and ${paths.length - shown.length} more` : null;
  const named = shown.flatMap((path) => (reasons.has(path) ? [`${basename(path)}: ${reasons.get(path)}`] : []));
  const plain = shown.filter((path) => !reasons.has(path)).map((path) => basename(path));
  const listing = plain.length > 0 ? `Unsaved: ${[plain.join(', '), more].filter(Boolean).join(' ')}` : more;
  return [...named, ...(listing ? [listing] : [])].join('\n');
}

export function quitQuestion(
  report: BusyReport,
  verb: 'Quit' | 'Restart',
  reasons: ReadonlyMap<string, string> = new Map(), // E5
  keep: KeepOffer | null = null, // E10
): MessageBoxOptions {
  const parts = [
    report.midTurn > 0 ? `${plural(report.midTurn, 'session', 'sessions')} mid-turn` : null,
    report.backgroundWork > 0 ? `${plural(report.backgroundWork, 'session', 'sessions')} running background work` : null,
    report.terminalsUnknown ? 'the terminals did not answer' : report.busyTerminals > 0 ? `${plural(report.busyTerminals, 'terminal', 'terminals')} running a command` : null,
  ].filter((p): p is string => p !== null);
  const stops = `${verb === 'Quit' ? 'Quitting' : 'Restarting'} stops them. Transcripts stay on disk and can be resumed.`;
  // E5 start: unsaved files are named first and the buttons are theirs: Save all, or go on without saving. "When idle"
  // is not offered while files are unsaved (save first; the ordinary question follows).
  const unsaved = report.unsavedFiles;
  if (unsaved.length > 0) {
    return {
      type: 'warning',
      buttons: ['Save all', `${verb} anyway`, 'Cancel'],
      defaultId: 2,
      cancelId: 2,
      message: [plural(unsaved.length, 'unsaved file', 'unsaved files'), ...parts].join(' · '),
      detail: [unsavedDetail(unsaved, reasons), ...(parts.length > 0 ? [stops] : [])].join('\n'),
    };
  }
  // E5 end
  // E10: keep first; terminals cannot be kept, which the detail says when one is busy
  if (keep) {
    return {
      type: 'warning',
      buttons: [QUIT_KEEP.button, verb, `${verb} when idle`, 'Cancel'],
      defaultId: keep.isDefault ? 0 : 1,
      cancelId: 3,
      message: parts.join(' · '),
      detail: [stops, ...(report.busyTerminals > 0 ? [QUIT_KEEP.terminalsClose] : [])].join('\n'),
    };
  }
  return {
    type: 'warning',
    buttons: [verb, `${verb} when idle`, 'Cancel'],
    defaultId: 2,
    cancelId: 2,
    message: parts.join(' · '),
    detail: stops,
  };
}

// The e2e's words for a report: C5's `4 mid-turn` stays as it was when only turns are busy.
function logParts(r: BusyReport): string {
  const parts = [
    r.unsavedFiles.length > 0 ? plural(r.unsavedFiles.length, 'unsaved file', 'unsaved files') : null, // E5
    r.midTurn > 0 ? `${r.midTurn} mid-turn` : null,
    r.backgroundWork > 0 ? `${r.backgroundWork} background work` : null,
    r.terminalsUnknown ? 'terminals unknown' : r.busyTerminals > 0 ? plural(r.busyTerminals, 'busy terminal', 'busy terminals') : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(', ') : 'nothing busy';
}
// C12 end

// E5: which question of its flight this is (0 the first; each Save all that leaves work asks once more) and the reasons
// the last Save all's windows gave by path for the files they could not save
export interface QuitRound { round: number; reasons: ReadonlyMap<string, string> }
const FIRST_ROUND: QuitRound = { round: 0, reasons: new Map() };

// The question as the app asks it: the native dialog, or under `MAWS_E2E=1` the answer `MAWS_E2E_QUIT_ANSWER` gives
// (quit by default; C12: `cancel` and `when_idle` too; E5: `save_all`; E10: `keep`; each only when the question offers
// it), logged to stderr for the smoke to read. E5: under MAWS_E2E a later question of the flight that still names
// unsaved files is answered `cancel`, so a Save all that keeps failing ends the flight instead of looping; a later
// ordinary question (Save all saved everything, sessions still busy) cannot loop, none of its answers asking again, and
// is answered as at first. E10: a keep, scripted or chosen, is logged with the sessions it keeps.
export async function askToQuit(
  report: BusyReport, // C12: the report, not C5's mid-turn count
  deps: { env: Record<string, string | undefined>; show(options: MessageBoxOptions): Promise<{ response: number }> },
  asked: QuitRound = FIRST_ROUND, // E5
  keep: KeepOffer | null = null, // E10
): Promise<QuitAnswer> {
  // E5: the question's buttons as answers, in order; with unsaved files Save all, Quit anyway (a quit) and Cancel
  const unsaved = report.unsavedFiles.length > 0;
  const offered: readonly QuitAnswer[] = unsaved ? ['save_all', 'quit', 'cancel'] : keep ? ['keep', 'quit', 'when_idle', 'cancel'] /* E10 */ : ['quit', 'when_idle', 'cancel'];
  const kept = (answer: QuitAnswer) => (answer === 'keep' && keep ? `, ${plural(keep.kept(), 'session', 'sessions')} kept` : ''); // E10
  if (deps.env.MAWS_E2E === '1') {
    const repeated = asked.round > 0 && unsaved;
    const answer: QuitAnswer = repeated ? 'cancel' : (offered.find((a) => a === deps.env.MAWS_E2E_QUIT_ANSWER) ?? 'quit');
    console.error(`quit-guard: ${logParts(report)}, auto-answered ${answer}${kept(answer)}`);
    return answer;
  }
  const { response } = await deps.show(quitQuestion(report, 'Quit', asked.reasons, keep));
  const answer = offered[response] ?? 'cancel'; // C12: three buttons (E10: four with keep)
  if (answer === 'keep') console.error(`quit-guard: ${logParts(report)}, answered keep${kept(answer)}`); // E10
  return answer;
}

// C12 start
export interface QuitGuardDeps {
  pty: QuitPty;
  ask(report: BusyReport, asked: QuitRound /* E5 */, keep: KeepOffer | null /* E10 */): Promise<QuitAnswer>;
  shutdownEngine(): Promise<void>;
  engines: EngineKill; // debt wave 6: the SIGKILL rung past the bound
  publish(waiting: BusyReport | null): void; // the page's "MAWS will quit when … finish" banner
  log?(line: string): void; // the report's latency, for the e2e
  pollMs?: number;
  // E5 start
  unsavedFiles(): readonly string[]; // every window's dirty file tabs, as last pushed
  // asks every window to save its dirty tabs; settles once each has answered, or at the bound, with the reasons the
  // answers gave by path for the files not saved
  saveAll(): Promise<ReadonlyMap<string, string>>;
  // E5 end
  // E10 start
  keepOffered(): boolean; // the engine host runs detached: its sessions can outlive the app
  keepDefault(): boolean; // the setting `supervisor.keepRunningDefault`: keep is the default button
  // E10 end
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
  const report = () => busyReport(model, deps.pty, deps.unsavedFiles);

  const finalQuit = () => {
    disarmed = true;
    app.quit();
  };
  const stopWaiting = () => {
    if (!wait) return;
    wait.stop();
    wait = null;
    deps.publish(null);
  };
  // Every quit, busy or not: the engines end through their ladders, bounded, then the one final app.quit(). E10: a keep
  // leaves them running (no shutdown, no SIGKILL rung) and quits.
  const quit = (keep = false): Promise<void> => {
    if (quitting) return quitting;
    stopWaiting();
    quitting = (async () => {
      if (keep) return finalQuit(); // the answer's log line names the sessions kept (askToQuit)
      try {
        await within(deps.shutdownEngine(), SHUTDOWN_BOUND_MS);
      } catch (error) {
        console.error('[quit-guard] stopping the engine failed or ran past its bound; quitting anyway', error);
        if (error instanceof BoundExpired) {
          await killEngines(model.engineStatuses(), deps.engines).then(
            (killed) => killed.length > 0 && console.error(`[quit-guard] sent SIGKILL to engines still running at the bound: ${killed.join(', ')}`),
            (failure: unknown) => console.error('[quit-guard] could not list the engines at the bound; quitting without SIGKILL', failure),
          );
        }
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
    let again = false; // a status changed while a read was out: that read decides nothing, the next one does
    // A status change invalidates a read already out; the 2 s poll only starts one when none is (re-review fix: a tick
    // that invalidated would discard every read slower than the poll, and a wait would never end).
    const changed = () => {
      if (wait !== mine) return;
      if (reading) return void (again = true);
      recheck();
    };
    const tick = () => {
      if (wait === mine && !reading) recheck();
    };
    const recheck = () => {
      reading = true;
      void report()
        .then((next) => {
          if (wait !== mine || again) return;
          if (total(next) === 0) {
            void quit();
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
    const off = model.on('engine', changed);
    const timer = setInterval(tick, deps.pollMs ?? WAIT_POLL_MS);
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
      .then(async (first) => {
        if (quitting) return;
        deps.log?.(`quit-report: ${Date.now() - started} ms · ${logParts(first)}`);
        // E5: Save all saves, then the report is read again and decides: nothing left quits, anything left asks again
        // (each round waits for the owner's answer, so the loop needs no bound), naming the files Save all could not save
        // with their reasons; outside quits stay held throughout
        let reasons: ReadonlyMap<string, string> = new Map();
        for (let r = first, round = 0; ; r = await report(), round += 1) {
          if (quitting) return;
          if (total(r) === 0) return quit();
          // E10: keep is offered in detached mode, its default read at each question; it keeps every live session
          const keep = deps.keepOffered() ? { isDefault: deps.keepDefault(), kept: () => model.engineStatuses().filter((s) => s.process !== 'exited').length } : null;
          const answer = await deps.ask(r, { round, reasons }, keep).catch((error: unknown) => {
            console.error('[quit-guard] the quit question failed; treating it as Cancel', error);
            return 'cancel' as const;
          });
          if (quitting) return; // the banner's Quit now answered first
          if (answer === 'quit') return quit();
          if (answer === 'keep') return quit(true); // E10
          if (answer === 'when_idle') return startWaiting(r);
          // Cancel keeps the app, and leaves a wait already under way as it was (the banner has its own Cancel)
          if (answer !== 'save_all') return;
          // E5: a Save all that fails ends the flight as Cancel does, as a failed question does
          const saved = await deps.saveAll().catch((error: unknown) => {
            console.error('[quit-guard] Save all failed; treating it as Cancel', error);
            return null;
          });
          if (saved === null) return;
          reasons = saved;
        }
      })
      .finally(() => {
        asking = false;
      });
  });

  return {
    waiting: () => wait?.report ?? null,
    quitNow: () => void quit(),
    cancelWait: stopWaiting,
  };
}
// C12 end

// E5 start: the unsaved files each window pushed, and Save all's round trip. A window's set is its whole dirty set, sent
// on every change of it (`layout.unsavedFiles`); main trusts it as the window's last word and never reads the disk for
// it, and forgets it when the window navigates (a reload starts from an empty viewer) or closes, as `files.*` releases
// a window's watches. Save all sends one request to every window and waits for an answer to it from each window that
// held files when it was sent; a window that closes or navigates meanwhile is not waited on, and one that never
// answers is waited on for SAVE_ALL_BOUND_MS. It settles with that request's answers' failures by path, which the
// question asked next names; an answer to another request (one already settled) records none. A window's saves push
// its new set before it answers (one ordered IPC channel, each handler run on receipt), so the report read after Save
// all is current.
export const SAVE_ALL_BOUND_MS = 10_000;

// A window's webContents, as far as the tracker needs one
export interface UnsavedFilesSender {
  readonly id: number;
  once(event: 'destroyed', listener: () => void): unknown;
  on(event: 'did-navigate', listener: () => void): unknown;
}

export interface UnsavedFiles {
  update(sender: UnsavedFilesSender, paths: readonly string[]): void; // `layout.unsavedFiles`
  done(sender: UnsavedFilesSender, requestId: string, failed: readonly { path: string; message: string }[]): void; // `layout.saveAllDone`
  paths(): string[]; // every window's, once each, sorted
  saveAll(send: (requestId: string) => void): Promise<ReadonlyMap<string, string>>; // `send` emits `layout.saveAll` to every window
}

export function trackUnsavedFiles(): UnsavedFiles {
  const sets = new Map<number, readonly string[]>();
  const followed = new WeakSet<UnsavedFilesSender>();
  const waits = new Map<string, { windows: Set<number>; failed: Map<string, string>; finish(): void }>();
  const answered = (requestId: string, windowId: number) => {
    const wait = waits.get(requestId);
    if (wait?.windows.delete(windowId) && wait.windows.size === 0) wait.finish();
  };
  const forget = (windowId: number) => {
    sets.delete(windowId);
    for (const requestId of [...waits.keys()]) answered(requestId, windowId); // it will not answer now
  };
  return {
    update(sender, paths) {
      const id = sender.id; // read now: a destroyed webContents' properties may no longer answer
      if (!followed.has(sender)) {
        followed.add(sender);
        sender.once('destroyed', () => forget(id));
        sender.on('did-navigate', () => forget(id));
      }
      sets.set(id, [...paths]);
    },
    done(sender, requestId, failed) {
      for (const { path, message } of failed) console.warn(`[quit-guard] could not save ${path}: ${message}`);
      const wait = waits.get(requestId);
      if (wait) for (const { path, message } of failed) wait.failed.set(path, message);
      answered(requestId, sender.id);
    },
    paths: () => [...new Set([...sets.values()].flat())].sort(),
    saveAll(send) {
      const windows = new Set([...sets].flatMap(([id, paths]) => (paths.length > 0 ? [id] : [])));
      if (windows.size === 0) return Promise.resolve(new Map());
      const requestId = randomUUID();
      const failed = new Map<string, string>();
      return new Promise((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          waits.delete(requestId);
          resolve(failed);
        };
        const timer = setTimeout(() => {
          console.warn(`[quit-guard] ${plural(windows.size, 'window', 'windows')} did not answer Save all within ${SAVE_ALL_BOUND_MS} ms; their files stay unsaved`);
          finish();
        }, SAVE_ALL_BOUND_MS);
        waits.set(requestId, { windows, failed, finish });
        send(requestId);
      });
    },
  };
}
// E5 end
