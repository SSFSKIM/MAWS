// Quitting asks first about what the app alone holds (D-16; C5 execution document, "Quit guard"; residue *Quit
// coordination*). P5 O15 M2 (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, "Quitting"): the sessions and
// the terminals belong to `mawsd`, which outlives the app, so a quit never stops them and never asks about them; the
// embedded shape's keep-or-stop question, its stop-all and SIGKILL rung, and the when-idle wait went with that shape.
// C12 start: the busy report (C12 execution document, Interfaces "The quit question"; charter §3 P0 quit line as aligned
// by D8). It counts sessions mid-turn, launching or otherwise working (host work in flight, or the engine running or
// waiting, with no turn; counted from C3's engine statuses in the read model, `midTurnCount`, never from the folded
// digest), sessions running background tasks or workflows that are not counted so, and terminals whose shell has a
// foreground command (C9's `pty.foreground`, asked in parallel, an unanswered probe counted busy as C9's close check
// does). `before-quit` must prevent synchronously and the report is asynchronous, so the guard always holds the quit
// while it computes the report. The report is logged whole; a quit with sessions busy and no file unsaved logs what it
// did not ask, for the e2e. Foreign-live sessions and the owner's terminals outside MAWS are never counted (the statuses
// and the pty table are MAWS's own). Quitting is one flight: once it starts, outside quits are not asked about again and
// any report or question still out is inert (review fix). The end-to-end smoke answers without a dialog. The `Restart`
// wording waits for P1's updater.
// C12 end
// E5 start: unsaved editor files (E5 execution document, Interfaces "The quit guard and unsaved files (M5)"; the owner's
// ruling of 2026-10-06). Each window pushes its dirty file tabs (`layout.unsavedFiles`); the report carries their union.
// With files unsaved the question offers Save all, Quit anyway and Cancel: Save all asks every window to save
// (`layout.saveAll`), waits for each window holding files to answer, bounded, then reads the report again, quitting when
// no file is left unsaved and asking again otherwise; the question asked again names each file a window could not save
// with its reason. A tab in the merge view is never saved by Save all (the renderer answers it as the conflict it is).
// Under MAWS_E2E a question asked again is answered Cancel, so a save that keeps failing cannot loop a test. With no file
// unsaved the app quits without asking.
// E5 end
import { randomUUID } from 'node:crypto'; // E5
import { basename } from 'node:path'; // E5
import { app, type MessageBoxOptions } from 'electron';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { ClientId, ClientRef } from '@shared/ipc/client';
import type { SpineView } from '@shared/spine/view';

// C12 start
export type QuitAnswer = 'quit' | 'cancel' | 'save_all' /* E5 */;
// terminalsUnknown: a live pty host did not list its terminals in time, so they count as one busy terminal, said so
// E5: unsavedFiles, the absolute paths of every window's dirty file tabs, sorted
export interface BusyReport { midTurn: number; backgroundWork: number; busyTerminals: number; terminalsUnknown: boolean; unsavedFiles: string[] }

export const PROBE_TIMEOUT_MS = 2_000; // per terminal, and for the list

export interface QuitPty {
  list(): Promise<readonly { ptyId: string; alive: boolean }[]>;
  foreground(ptyId: string): Promise<{ busy: boolean }>;
  hostGone(): boolean; // the supervisor's state: a pty host that is not running holds no terminal
}

const LIVE = new Set<EngineSessionStatus['process']>(['starting', 'initializing', 'ready']);
const LAUNCHING = new Set<EngineSessionStatus['process']>(['starting', 'initializing']);

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
    promise.then(
      (value) => (clearTimeout(timer), resolve(value)),
      (error: unknown) => (clearTimeout(timer), reject(error)),
    );
  });
}

export async function busyReport(
  model: Pick<SpineView, 'midTurnCount' | 'engineStatuses'>, // P5 O3-C (reader R3): the spine's view
  pty: QuitPty,
  unsavedFiles: () => readonly string[] = () => [], // E5: the windows' last pushes
): Promise<BusyReport> {
  // The sessions are read after the terminals (review fix): a status can only arrive between awaits, so the counts the
  // report gives are never older than the terminal read. E5: nor are the unsaved files, read with them.
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const unsavedCount = (paths: readonly string[]) => plural(paths.length, 'unsaved file', 'unsaved files');

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

// E5: the question names the unsaved files and its buttons are theirs: Save all, or go on without saving. P5 O15 M2: it
// is the only question a quit asks, so it names nothing else.
export function quitQuestion(
  unsavedFiles: readonly string[],
  verb: 'Quit' | 'Restart',
  reasons: ReadonlyMap<string, string> = new Map(), // E5
): MessageBoxOptions {
  return {
    type: 'warning',
    buttons: ['Save all', `${verb} anyway`, 'Cancel'],
    defaultId: 2,
    cancelId: 2,
    message: unsavedCount(unsavedFiles),
    detail: unsavedDetail(unsavedFiles, reasons),
  };
}

// The e2e's words for a report: C5's `4 mid-turn` stays as it was when only turns are busy.
function logParts(r: BusyReport): string {
  const parts = [
    r.unsavedFiles.length > 0 ? unsavedCount(r.unsavedFiles) : null, // E5
    r.midTurn > 0 ? `${r.midTurn} mid-turn` : null,
    r.backgroundWork > 0 ? `${r.backgroundWork} background work` : null,
    r.terminalsUnknown ? 'terminals unknown' : r.busyTerminals > 0 ? plural(r.busyTerminals, 'busy terminal', 'busy terminals') : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(', ') : 'nothing busy';
}
// C12 end

// E5: which question of its flight this is (0 the first; each Save all that leaves a file unsaved asks once more) and the
// reasons the last Save all's windows gave by path for the files they could not save
export interface QuitRound { round: number; reasons: ReadonlyMap<string, string> }
const FIRST_ROUND: QuitRound = { round: 0, reasons: new Map() };

// The question as the app asks it: the native dialog, or under `MAWS_E2E=1` the answer `MAWS_E2E_QUIT_ANSWER` gives
// (quit by default; C12: `cancel` too; E5: `save_all`), logged to stderr for the smoke to read. E5: under MAWS_E2E a
// later question of the flight is answered `cancel`, so a Save all that keeps failing ends the flight instead of looping.
export async function askToQuit(
  unsavedFiles: readonly string[], // P5 O15 M2: what the question is about, the files alone
  deps: { env: Record<string, string | undefined>; show(options: MessageBoxOptions): Promise<{ response: number }> },
  asked: QuitRound = FIRST_ROUND, // E5
): Promise<QuitAnswer> {
  const offered: readonly QuitAnswer[] = ['save_all', 'quit', 'cancel']; // the buttons as answers, in order
  if (deps.env.MAWS_E2E === '1') {
    const answer: QuitAnswer = asked.round > 0 ? 'cancel' : (offered.find((a) => a === deps.env.MAWS_E2E_QUIT_ANSWER) ?? 'quit');
    console.error(`quit-guard: ${unsavedCount(unsavedFiles)}, auto-answered ${answer}`);
    return answer;
  }
  const { response } = await deps.show(quitQuestion(unsavedFiles, 'Quit', asked.reasons));
  return offered[response] ?? 'cancel';
}

// C12 start
export interface QuitGuardDeps {
  pty: QuitPty;
  ask(unsavedFiles: readonly string[], asked: QuitRound /* E5 */): Promise<QuitAnswer>;
  log?(line: string): void; // the report's latency and what a quit did not ask, for the e2e
  // E5 start
  unsavedFiles(): readonly string[]; // every window's dirty file tabs, as last pushed
  // asks every window to save its dirty tabs; settles once each has answered, or at the bound, with the reasons the
  // answers gave by path for the files not saved
  saveAll(): Promise<ReadonlyMap<string, string>>;
  // E5 end
}

// The banner's surface (`layout.quitWait`, `layout.quitWaitAnswer`). P5 O15 M2: no quit waits any more, so there is
// never a waiting report and nothing to cancel; Quit now still quits.
export interface QuitGuard {
  report(): Promise<BusyReport>; // the report a quit would read now (the e2e reads it through app.ts's seam)
  waiting(): null;
  quitNow(): void; // the banner's Quit now
  cancelWait(): void; // the banner's Cancel
}

export function installQuitGuard(model: Pick<SpineView, 'midTurnCount' | 'engineStatuses'>, deps: QuitGuardDeps): QuitGuard {
  let quitting = false; // set only right before the one final app.quit(); outstanding reports and questions are inert
  let asking = false; // a report or a question is under way
  const report = () => busyReport(model, deps.pty, deps.unsavedFiles);

  // Every quit, busy or not, leaves the sessions and the terminals running under `mawsd` (P5 O3-D, Q1; P5 O15 M2).
  const quit = () => {
    if (quitting) return;
    quitting = true;
    app.quit();
  };

  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    if (asking) return;
    asking = true;
    const started = Date.now();
    void report()
      .then(async (first) => {
        if (quitting) return;
        deps.log?.(`quit-report: ${Date.now() - started} ms · ${logParts(first)}`);
        // P5 O3-D (Q1): a quit that would have asked about its sessions says what it left running, for the e2e
        if (first.unsavedFiles.length === 0 && first.midTurn + first.backgroundWork > 0) deps.log?.(`quit-guard: ${logParts(first)}, not asked: they outlive the app`);
        // E5: Save all saves, then the report is read again and decides: no file left quits, any file left asks again
        // (each round waits for the owner's answer, so the loop needs no bound), naming the files Save all could not save
        // with their reasons; outside quits stay held throughout
        let reasons: ReadonlyMap<string, string> = new Map();
        for (let files = first.unsavedFiles, round = 0; ; files = (await report()).unsavedFiles, round += 1) {
          if (quitting) return;
          if (files.length === 0) return quit();
          const answer = await deps.ask(files, { round, reasons }).catch((error: unknown) => {
            console.error('[quit-guard] the quit question failed; treating it as Cancel', error);
            return 'cancel' as const;
          });
          if (quitting) return; // the banner's Quit now answered first
          if (answer === 'quit') return quit();
          if (answer !== 'save_all') return; // Cancel keeps the app
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
    report,
    waiting: () => null,
    quitNow: quit,
    cancelWait: () => {},
  };
}
// C12 end

// E5 start: the unsaved files each window pushed, and Save all's round trip. A window's set is its whole dirty set, sent
// on every change of it (`layout.unsavedFiles`) by its page's client; main trusts it as the client's last word and never
// reads the disk for it, and forgets it when the client ends: its page navigates (a reload starts from an empty
// viewer), its renderer crashes (E11) or it closes, as `files.*` releases a client's watches. Save all sends one request to every window and waits for an answer to it from each window that
// held files when it was sent; a window that closes or navigates meanwhile is not waited on, and one that never
// answers is waited on for SAVE_ALL_BOUND_MS. It settles with that request's answers' failures by path, which the
// question asked next names; an answer to another request (one already settled) records none. A window's saves push
// its new set before it answers (one ordered IPC channel, each handler run on receipt), so the report read after Save
// all is current.
export const SAVE_ALL_BOUND_MS = 10_000;

export interface UnsavedFiles {
  update(client: ClientRef, paths: readonly string[]): void; // `layout.unsavedFiles`
  done(client: ClientRef, requestId: string, failed: readonly { path: string; message: string }[]): void; // `layout.saveAllDone`
  paths(): string[]; // every window's, once each, sorted
  saveAll(send: (requestId: string) => void): Promise<ReadonlyMap<string, string>>; // `send` emits `layout.saveAll` to every window
}

export function trackUnsavedFiles(): UnsavedFiles {
  const sets = new Map<ClientId, readonly string[]>();
  const followed = new Set<ClientId>();
  const waits = new Map<string, { windows: Set<ClientId>; failed: Map<string, string>; finish(): void }>();
  const answered = (requestId: string, clientId: ClientId) => {
    const wait = waits.get(requestId);
    if (wait?.windows.delete(clientId) && wait.windows.size === 0) wait.finish();
  };
  const forget = (clientId: ClientId) => {
    sets.delete(clientId);
    for (const requestId of [...waits.keys()]) answered(requestId, clientId); // it will not answer now
  };
  return {
    update(client, paths) {
      const { id } = client;
      sets.set(id, [...paths]);
      if (followed.has(id)) return;
      followed.add(id);
      client.onGone(() => {
        // E11: a crashed renderer's edits are gone too; Save all waits for none. At once for a client already gone.
        followed.delete(id);
        forget(id);
      });
    },
    done(client, requestId, failed) {
      for (const { path, message } of failed) console.warn(`[quit-guard] could not save ${path}: ${message}`);
      const wait = waits.get(requestId);
      if (wait) for (const { path, message } of failed) wait.failed.set(path, message);
      answered(requestId, client.id);
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
