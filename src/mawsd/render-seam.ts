// The render seam (P5 O5 M4; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §A, §B, §E, §G): `mawsd`'s
// side of the render service. The render host is the app's own binary run windowless (src/render-host/), a `machine.sock`
// client whose hello lists `render.client`; this starts it at the first request, holds each request while it starts,
// hands it over as `render.request` (the front posts it to that client alone), takes its `render.answer` and answers the
// asker: the engine host's capture and export bridges through `maws.artifact.captured` and `maws.artifact.exported`, the
// library's Export (`artifacts.export`, machine-owned, and O4's Send to through `RenderService`) as the command's answer.
// After `quietMs` with nothing in its table it ends the host (`render.exit`, then SIGTERM after EXIT_GRACE_MS).
//
// A deferred chunk: `daemon.ts` loads it at the first request, never at start, so nothing of it is resident while no
// render was asked (acceptance 8; the bundle guard holds it off mawsd.js's run path). Electron-free: it spawns the render
// runtime, it never loads it.
//
// States (Interfaces §B): `off` → `starting` at the first request (the spawn, the client's ready awaited); `starting` →
// `ready` at the client's ready; a start that fails (a spawn refused, the host's exit before its ready) or a host that
// ends unasked is a failure: the next start waits the detached transport's backoff, and a second failure within
// FAILURE_WINDOW_MS makes the seam `unavailable` (every request answered at once with the reason) until a window after
// it, when a request tries again. `ready` → `ending` after the quiet period → `off` at the host's exit, which a request
// that came meanwhile follows with a new start. A request while the runtime is reported absent is answered at once with
// its reason and spawns nothing. No request outlives its asker's deadline in the table unanswered: one still waiting for
// the host's ready at its start deadline (inside the bridge's own) is answered with the start's reason and dropped; one
// handed over is answered with a sentence at its answer deadline (ANSWER_DEADLINE_MS, from its admission: inside the
// bridge's for a session's tool, the start's and the library's own budgets for the library's Export) if the host has not
// answered it by then. A host that has not said ready within START_WATCHDOG_MS of its spawn is ended (SIGTERM, SIGKILL
// after the grace) and its exit counted as a failed start, so a hung start never holds the requests after it; it stays
// the seam's child until that exit (a late ready of its connection not taken, `stop()` waiting for it), and no successor
// starts beside it.
//
// `stop()` (the daemon's exit order, before the spine's stop ends the engine-host link): admission closes, every request
// in the table is answered `ok: false` over the still-live link, then the host is ended (render.exit and SIGTERM
// together, SIGKILL at the grace) and its exit awaited, bounded past the SIGKILL's settle. A request the seam answered
// itself after handing it over (its answer deadline, or the stop) is remembered until the host exits, so the host's late
// answer is taken (not refused as unknown) and an inspection export's file it names is removed: nobody will read it.
import { spawn as spawnProcess, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { HostCommandError } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import type { DaemonRender } from '@shared/ipc/schema/daemon';
import type { MawsArtifactCapture, MawsArtifactCapturedResult, MawsArtifactExport, MawsArtifactExportAnswer } from '@shared/ipc/schema/maws';
import { RENDER_AUTHOR_SESSIONS_MAX, type RenderAuthors, type RenderRequest } from '@shared/ipc/schema/render';
import { renderCapabilities, type RenderCapabilities } from './session-capabilities'; // P5 O5 M5

export type RenderState = 'off' | 'starting' | 'ready' | 'ending' | 'unavailable';
export type RenderRuntime = { available: true } | { available: false; reason: string };

// The render host's process as the seam holds it.
export interface RenderChild {
  pid: number | null;
  kill(signal: NodeJS.Signals): void;
  onExit(listener: (code: number | null, signal: string | null) => void): void;
  lastLine(): string | null; // the last `[render-host]` line it wrote to stderr: its own reason for an exit
}

export interface RenderSeamOptions {
  machine: string; // this machine's name, in every reason
  spawn(): RenderChild; // the platform's command line (Interfaces §E); throws with the reason it cannot start
  post(request: RenderRequest): boolean; // the front's: to the ready render.client alone; false with none
  postExit(): boolean; // `render.exit`, likewise
  // an answer to the engine host's bridge; the outcome it gave, or null when it could not be delivered (the link closed)
  answerEngine(name: 'maws.artifact.captured' | 'maws.artifact.exported', input: unknown): Promise<'delivered' | 'not_pending' | null>;
  quietMs(): number; // MAWS_RENDER_QUIET_MS, else DEFAULT_QUIET_MS
  runtime(): RenderRuntime; // whether this machine can run the render host (a Mac with the app binary always can; M6 reads Linux's cache)
  engineHostRenders(): boolean; // none is connected (a cold one starts as this build), or its welcome lists host.render: its bridges send with no app attached
  appAttached(): boolean; // an app is attached to the engine host (an older host's bridges send then)
  // the Word comment authors, sent with each export: the request waits for them before it is handed over (its deadlines
  // running from its admission), the host's start meanwhile; the daemon bounds what it waits for them
  authors?(): RenderAuthors | undefined | Promise<RenderAuthors | undefined>;
  hold(reason: string): () => void; // the daemon's clocks: no idle exit while a request is in the table
  onState?(state: RenderState, detail: string | null): void;
  log(line: string): void;
  startDeadlineMs?: Partial<Record<'capture' | 'export' | 'libraryExport', number>>;
  answerDeadlineMs?: Partial<Record<'capture' | 'export' | 'libraryExport', number>>;
  startWatchdogMs?: number;
  restartBackoffMs?: readonly number[]; // the detached transport's RESTART_BACKOFF_MS unless a test says
  exitGraceMs?: number;
  removeFile?(path: string): Promise<void>;
}

export interface RenderService {
  // `artifacts.export`'s handler (the front's), and O4's Send to in `mawsd` (Interfaces §G); the Notion dialect rides the
  // input. Rejects with a HostCommandError, as the embedded root's registration does.
  exportForLibrary(input: CommandInput<'artifacts.export'>): Promise<CommandOutput<'artifacts.export'>>;
}

export interface RenderSeam extends RenderService {
  state(): RenderState;
  capture(request: MawsArtifactCapture): void; // the engine host's raw event; answered through answerEngine
  captureForE2e(request: MawsArtifactCapture): Promise<MawsArtifactCapturedResult>; // `daemon.e2eRender`'s: the answer returned
  export(request: MawsArtifactExport): void; // likewise
  clientReady(): void; // the front's: a render.client said ready
  clientGone(): void; // the front's: a ready render.client's connection ended
  answer(input: { id: string; answer: unknown }): boolean; // the front's: false for an id the seam did not post
  capabilities(): RenderCapabilities;
  status(): DaemonRender;
  stop(): Promise<void>;
}

export const DEFAULT_QUIET_MS = 120_000;
// Inside the bridges' 45 s (CAPTURE_ANSWER_MS) and 60 s (EXPORT_ANSWER_MS); the library's Export has the export's.
export const START_DEADLINE_MS = { capture: 40_000, export: 55_000, libraryExport: 55_000 } as const;
// A request's whole time in the seam, from its admission, handed over or not. A session's tool: the bridge's own, less
// ANSWER_MARGIN_MS for the event's way here and the answer's way back, so its asker hears a sentence, never a timeout.
// The library's Export (its own command budget, COMMAND_BUDGETS_MS['artifacts.export']): the start's, then the render
// library's own export budget (src/render/export.ts's EXPORT_BUDGET_MS, which this chunk does not load).
const ANSWER_MARGIN_MS = 2_000;
const LIBRARY_EXPORT_MS = 55_000;
export const ANSWER_DEADLINE_MS = { capture: 45_000 - ANSWER_MARGIN_MS, export: 60_000 - ANSWER_MARGIN_MS, libraryExport: START_DEADLINE_MS.libraryExport + LIBRARY_EXPORT_MS } as const;
// A spawned host that has not said ready by then is hung: ended, and counted as a failed start (the backoff, then the
// second failure's unavailability). Under the shortest start deadline, so a request waiting for it sees a second start.
export const START_WATCHDOG_MS = 30_000;
export const FAILURE_WINDOW_MS = 60_000;
export const EXIT_GRACE_MS = 5_000;
const DELIVERY_BOUND_MS = 2_000; // stop()'s wait for its refusals' answers from the engine host
const STOP_MARGIN_MS = 1_000; // stop()'s wait past its SIGKILL's settle: the exit's way to the seam
const RESTART_BACKOFF_MS = [500, 2_000, 5_000] as const; // @shared/host/host-supervisor's, which this chunk does not load

type Kind = RenderRequest['kind'];
interface Entry {
  id: string;
  kind: Kind;
  request: RenderRequest;
  posted: boolean;
  authoring: boolean; // its Word comment authors are still being resolved: not handed over yet
  deadline: ReturnType<typeof setTimeout> | null; // its start deadline, while it waits for the host
  overall: ReturnType<typeof setTimeout> | null; // its answer deadline
  settle(answer: unknown): void; // the render host's answer, or a failure the seam names ({ok: false, error})
}

export function createRenderSeam(options: RenderSeamOptions): RenderSeam {
  const { machine, log } = options;
  const deadlines = { ...START_DEADLINE_MS, ...options.startDeadlineMs };
  const answerDeadlines = { ...ANSWER_DEADLINE_MS, ...options.answerDeadlineMs };
  const startWatchdogMs = options.startWatchdogMs ?? START_WATCHDOG_MS;
  const backoff = options.restartBackoffMs ?? RESTART_BACKOFF_MS;
  const exitGraceMs = options.exitGraceMs ?? EXIT_GRACE_MS;
  const removeFile = options.removeFile ?? ((path: string) => rm(path, { force: true }));
  const table = new Map<string, Entry>();
  // Handed over, then answered by the seam (its answer deadline, the stop): the host's late answer is taken, and an
  // inspection export's file it names removed. Kept until the host exits, after which no answer comes.
  const abandoned = new Map<string, Entry>();
  const removals = new Set<Promise<void>>(); // stop() awaits them
  let state: RenderState = 'off';
  let detail: string | null = null;
  let child: RenderChild | null = null;
  let childReady = false; // the host takes requests: its client said ready and its connection holds
  let reached = false; // the host said ready once (its exit is then no failed start)
  let starts = 0;
  let next = 0;
  let failures: number[] = []; // the times of failures inside the window
  let lastFailure: string | null = null; // the last failure's reason
  let unavailableUntil = 0;
  let stopped = false;
  let release: (() => void) | null = null;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let startTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null; // a spawned host's time to say ready
  let retiring = false; // `child` did not say ready in time and is being ended: its ready is not taken, nothing follows it until its exit
  let killTimer: ReturnType<typeof setTimeout> | null = null;
  let exited: (() => void) | null = null; // stop()'s wait for the host's exit
  const deliveries = new Set<Promise<unknown>>(); // answers on their way to the engine host (stop() awaits them)

  const set = (to: RenderState, why: string | null = null) => {
    if (to === state && why === detail) return;
    state = to;
    detail = why;
    options.onState?.(to, why);
  };
  const clear = (timer: ReturnType<typeof setTimeout> | null) => {
    if (timer) clearTimeout(timer);
    return null;
  };
  const failed = (error: string) => ({ ok: false as const, error });
  const couldNotStart = (reason: string) => `the render service could not start on ${machine}: ${reason}`;

  // --- the table ------------------------------------------------------------------------------------------------------
  const settled = (entry: Entry) => {
    entry.deadline = clear(entry.deadline);
    entry.overall = clear(entry.overall);
    table.delete(entry.id);
    if (table.size === 0) {
      release?.();
      release = null;
      armQuiet();
    }
  };
  const answerWith = (entry: Entry, answer: unknown) => {
    settled(entry);
    entry.settle(answer);
  };
  // The seam's own answer to what it holds; one the host holds is remembered for the host's late answer
  const failAll = (error: string, which: (entry: Entry) => boolean = () => true) => {
    for (const entry of [...table.values()].filter(which)) {
      if (entry.posted && child !== null) abandoned.set(entry.id, entry);
      answerWith(entry, failed(error));
    }
  };
  // A file nobody will read: removed, a failure logged
  const removeUnread = (path: string, why: string) => {
    log(`[render] ${why}: its file removed`);
    const removal = removeFile(path).catch((error: unknown) => log(`[render] could not remove ${path}: ${error instanceof Error ? error.message : String(error)}`));
    removals.add(removal);
    void removal.finally(() => removals.delete(removal));
    return removal;
  };

  function admit(request: RenderRequest, settle: Entry['settle']): void {
    const refused = refusal();
    if (refused !== null) return settle(failed(refused));
    const entry: Entry = { id: request.id, kind: request.kind, request, posted: false, authoring: false, deadline: null, overall: null, settle };
    if (request.kind !== 'capture' && options.authors) {
      const withAuthors = (authors: RenderAuthors | undefined) => {
        if (authors && entry.request.kind !== 'capture') entry.request = { ...entry.request, authors };
      };
      const unresolved = (error: unknown) => log(`[render] the export's comment authors could not be resolved: ${error instanceof Error ? error.message : String(error)}`);
      let authors: ReturnType<NonNullable<RenderSeamOptions['authors']>>;
      try {
        authors = options.authors();
      } catch (error) {
        authors = undefined;
        unresolved(error);
      }
      if (authors instanceof Promise) {
        entry.authoring = true; // resolved on demand (a cold spine's load): handed over once they are
        void authors.then(withAuthors, unresolved).then(() => {
          entry.authoring = false;
          if (table.has(entry.id)) pump();
        });
      } else withAuthors(authors);
    }
    entry.deadline = setTimeout(() => {
      entry.deadline = null;
      if (entry.posted || !table.has(entry.id)) return; // handed over: its answer deadline bounds it
      log(`[render] ${entry.kind} ${entry.id} waited ${deadlines[entry.kind] / 1000} s for the render host: answered with the start's reason`);
      answerWith(entry, failed(lastFailure !== null ? couldNotStart(lastFailure) : `the render service on ${machine} did not start within ${deadlines[entry.kind] / 1000} s`));
    }, deadlines[entry.kind]);
    entry.overall = setTimeout(() => {
      entry.overall = null;
      if (!table.has(entry.id)) return;
      const s = answerDeadlines[entry.kind] / 1000;
      log(`[render] ${entry.kind} ${entry.id} was not answered by the render host within ${s} s of its arrival: answered with a failure`);
      if (child !== null) abandoned.set(entry.id, entry);
      answerWith(entry, failed(`the render service on ${machine} did not finish the ${entry.kind === 'capture' ? 'capture' : 'export'} within ${s} s`));
    }, answerDeadlines[entry.kind]);
    table.set(entry.id, entry);
    release ??= options.hold('a render in flight');
    quietTimer = clear(quietTimer);
    pump(entry.kind);
  }

  // Why a request is answered at once, or null to take it
  function refusal(): string | null {
    if (stopped) return `the render service is restarting on ${machine}`;
    const runtime = options.runtime();
    if (!runtime.available) return runtime.reason;
    if (state === 'unavailable') {
      if (Date.now() < unavailableUntil) return couldNotStart(lastFailure ?? 'it failed twice');
      failures = [];
      set('off');
    }
    return null;
  }

  // Hand over what waits, or start the host for it
  function pump(why: Kind | null = null): void {
    if (stopped) return;
    if (state === 'ready' && childReady) {
      for (const entry of table.values()) {
        if (entry.posted || entry.authoring) continue;
        if (!options.post(entry.request)) {
          log(`[render] the render host took no request (its connection is going): ${entry.kind} ${entry.id} waits for the next one`);
          return;
        }
        entry.posted = true;
      }
      return;
    }
    if (state === 'off' && [...table.values()].some((entry) => !entry.posted)) start(why);
  }

  // --- the host's life ------------------------------------------------------------------------------------------------
  function start(why: Kind | null): void {
    const recent = failures.filter((at) => Date.now() - at < FAILURE_WINDOW_MS).length;
    const wait = recent === 0 ? 0 : backoff[Math.min(recent - 1, backoff.length - 1)]!;
    set('starting', wait === 0 ? null : `waiting ${wait} ms after a failure`);
    if (wait === 0) return spawnNow(why);
    startTimer = setTimeout(() => {
      startTimer = null;
      spawnNow(why);
    }, wait);
  }

  function spawnNow(why: Kind | null): void {
    if (stopped || state !== 'starting') return;
    let started: RenderChild;
    try {
      started = options.spawn();
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
    child = started;
    childReady = false;
    reached = false;
    starts += 1;
    log(`[render] starting the render host${why ? ` for ${why === 'capture' ? 'artifact_screenshot' : why === 'export' ? 'artifact_export' : 'the library’s Export'}` : ''} (pid ${started.pid ?? 'unknown'})`);
    started.onExit((code, signal) => onExit(started, code, signal));
    watchdog = clear(watchdog);
    watchdog = setTimeout(() => {
      watchdog = null;
      if (child !== started || reached) return;
      hung(started);
    }, startWatchdogMs);
  }

  // A host that did not say ready within the watchdog: ended (SIGTERM, then SIGKILL after the grace) and kept as the
  // seam's child until it exits, so no successor runs beside it and a late ready of its connection is not taken; its
  // exit is the failed start (onExit), whose backoff then starts the next host for what waits
  function hung(which: RenderChild): void {
    retiring = true;
    set('starting', 'ending a render host that did not say ready');
    log(`[render] the render host (pid ${which.pid ?? 'unknown'}) did not say ready within ${startWatchdogMs / 1000} s: SIGTERM, then SIGKILL after ${exitGraceMs / 1000} s`);
    which.kill('SIGTERM');
    killTimer = clear(killTimer);
    killTimer = setTimeout(() => {
      killTimer = null;
      if (child === which) which.kill('SIGKILL');
    }, exitGraceMs);
  }

  function onExit(which: RenderChild, code: number | null, signal: string | null): void {
    if (which !== child) return;
    const wasReady = reached;
    const hungStart = retiring;
    const expected = state === 'ending';
    child = null;
    childReady = false;
    retiring = false;
    killTimer = clear(killTimer);
    watchdog = clear(watchdog);
    abandoned.clear(); // no late answer comes from a host that has exited
    log(`[render] the render host exited (${signal ? `signal ${signal}` : `code ${code}`})${expected ? '' : hungStart ? ': it had not said ready in time' : wasReady ? ': unasked' : ' before it was ready'}`);
    failAll(`the render service ended on ${machine}`, (entry) => entry.posted);
    const done = exited;
    exited = null;
    done?.();
    if (stopped) return set('off');
    if (expected) {
      set('off');
      return pump();
    }
    if (hungStart) return failure(`the render host did not say ready within ${startWatchdogMs / 1000} s`);
    failure(wasReady ? `the render host ended unasked (${signal ? `signal ${signal}` : `code ${code}`})` : exitReason(code, signal, which.lastLine()));
  }

  function failure(reason: string): void {
    const now = Date.now();
    failures = [...failures.filter((at) => now - at < FAILURE_WINDOW_MS), now];
    lastFailure = reason;
    log(`[render] ${couldNotStart(reason)}`);
    if (failures.length >= 2) {
      unavailableUntil = now + FAILURE_WINDOW_MS;
      set('unavailable', reason);
      log(`[render] two failures within ${FAILURE_WINDOW_MS / 1000} s: every request is answered with the reason until ${new Date(unavailableUntil).toISOString()}`);
      return failAll(couldNotStart(reason));
    }
    set('off', reason);
    pump();
  }

  function armQuiet(): void {
    if (stopped || state !== 'ready' || table.size > 0 || quietTimer) return;
    const ms = options.quietMs();
    quietTimer = setTimeout(() => {
      quietTimer = null;
      if (state !== 'ready' || table.size > 0) return;
      log(`[render] quiet for ${ms / 1000} s: ending the render host`);
      end();
    }, ms);
  }

  // render.exit, then SIGTERM after the grace
  function end(): void {
    set('ending');
    if (!options.postExit()) log('[render] render.exit reached no render host: SIGTERM after the grace');
    killTimer = clear(killTimer);
    const ending = child;
    killTimer = setTimeout(() => {
      killTimer = null;
      if (ending && child === ending) {
        log(`[render] the render host did not exit within ${exitGraceMs / 1000} s: SIGTERM`);
        ending.kill('SIGTERM');
      }
    }, exitGraceMs);
  }

  // --- the answers ----------------------------------------------------------------------------------------------------
  const engineAnswer = (name: 'maws.artifact.captured' | 'maws.artifact.exported', input: unknown) => {
    const delivery = options.answerEngine(name, input).catch((error: unknown) => {
      log(`[render] ${name} could not be delivered: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    deliveries.add(delivery);
    void delivery.finally(() => deliveries.delete(delivery));
    return delivery;
  };
  const seam: RenderSeam = {
    state: () => state,
    capture(request) {
      const { appSessionId, requestId } = request;
      admit({ id: `capture-${++next}`, kind: 'capture', request }, (answer) => {
        void engineAnswer('maws.artifact.captured', { appSessionId, requestId, result: captureResult(answer) });
      });
    },
    captureForE2e(request) {
      return new Promise((resolve) => admit({ id: `capture-${++next}`, kind: 'capture', request }, (answer) => resolve(captureResult(answer))));
    },
    export(request) {
      const { appSessionId, requestId } = request;
      admit({ id: `export-${++next}`, kind: 'export', request }, (answer) => {
        const result = exportAnswer(answer);
        void engineAnswer('maws.artifact.exported', { appSessionId, requestId, answer: result }).then(async (outcome) => {
          // an inspection's file is unique and has no cache consumer: it is the bridge's once delivered, else removed here
          if (request.inspection && result.ok && outcome !== 'delivered') await removeUnread(result.path, `an inspection export's answer was not delivered (${outcome ?? 'no link'})`);
        });
      });
    },
    exportForLibrary(input) {
      return new Promise((resolve, reject) => {
        admit({ id: `library-${++next}`, kind: 'libraryExport', request: input }, (answer) => {
          const value = answer as { ok?: unknown; error?: unknown; ipcError?: unknown; path?: unknown };
          if (value.ok === false) {
            const error = typeof value.error === 'string' ? value.error : 'the render host failed';
            return reject(new HostCommandError(value.ipcError ? (value.ipcError as never) : ipcError('host_unavailable', error)));
          }
          if (typeof value.path !== 'string') return reject(new HostCommandError(ipcError('internal', 'the render host answered something other than an export')));
          resolve(answer as CommandOutput<'artifacts.export'>);
        });
      });
    },
    clientReady() {
      if (retiring) return log('[render] a render client said ready after its host’s start watchdog: not taken (it is being ended)');
      if (state !== 'starting' || child === null) return log(`[render] a render client said ready while the seam is ${state}: not taken`);
      childReady = true;
      reached = true;
      watchdog = clear(watchdog);
      set('ready');
      log(`[render] the render host is ready (pid ${child.pid ?? 'unknown'})`);
      pump();
      armQuiet();
    },
    clientGone() {
      if (!childReady) return;
      childReady = false; // nothing more is handed over; its exit (a failure unless asked) follows its connection's end
      failAll(`the render service ended on ${machine}`, (entry) => entry.posted);
      const going = child;
      killTimer = clear(killTimer);
      killTimer = setTimeout(() => {
        killTimer = null;
        if (going && child === going) {
          log(`[render] the render host's connection ended and it did not exit within ${exitGraceMs / 1000} s: SIGTERM`);
          going.kill('SIGTERM');
        }
      }, exitGraceMs);
    },
    answer({ id, answer }) {
      const late = abandoned.get(id);
      if (late) {
        // answered already by the seam: taken, and an inspection's file nobody will read removed
        abandoned.delete(id);
        const value = answer as { ok?: unknown; path?: unknown };
        if (late.kind === 'export' && (late.request.request as MawsArtifactExport).inspection && value.ok === true && typeof value.path === 'string') void removeUnread(value.path, `an inspection export answered after the seam had answered it (${id})`);
        return true;
      }
      const entry = table.get(id);
      if (!entry || !entry.posted) return false;
      answerWith(entry, answer);
      return true;
    },
    // P5 O5 M5: the reasons are session-capabilities.ts's, shared with the render handle's reading while this is not loaded
    capabilities: () =>
      renderCapabilities({
        machine,
        runtime: options.runtime(),
        failure: state === 'unavailable' && Date.now() < unavailableUntil ? (lastFailure ?? 'it failed twice') : null,
        engineHostRenders: options.engineHostRenders(),
        appAttached: options.appAttached(),
      }),
    status: () => ({ state, detail, pid: child?.pid ?? null, starts, requests: table.size }),
    async stop() {
      if (stopped) return;
      stopped = true;
      quietTimer = clear(quietTimer);
      startTimer = clear(startTimer);
      watchdog = clear(watchdog);
      failAll(`the render service is restarting on ${machine}`);
      // the refusals answered over the live engine-host link (the spine's stop, after this, ends it), each bounded
      if (deliveries.size > 0) await Promise.race([Promise.allSettled([...deliveries]), new Promise((resolve) => setTimeout(resolve, DELIVERY_BOUND_MS))]);
      if (child === null) set('off');
      else {
        // A daemon stop is no quiet exit: render.exit and SIGTERM together, SIGKILL at the grace (a host being ended for
        // its start watchdog is not asked: it was sent SIGTERM already). The wait covers the SIGKILL and the settle after
        // it (a group's retirement reports its exit within KILL_SETTLE_MS of its SIGKILL), so mawsd never exits while
        // the escalation is still pending: nothing would retire a detached group after it (KillMode=process).
        const going = child;
        const hungStart = retiring;
        const gone = new Promise<void>((resolve) => (exited = resolve));
        set('ending');
        if (!hungStart) {
          options.postExit();
          going.kill('SIGTERM');
        }
        const kill = setTimeout(() => {
          if (child !== going) return;
          log(`[render] the render host did not exit within ${exitGraceMs / 1000} s of mawsd's stop: SIGKILL`);
          going.kill('SIGKILL');
        }, exitGraceMs);
        let bound: ReturnType<typeof setTimeout> | null = null;
        await Promise.race([gone, new Promise((resolve) => (bound = setTimeout(resolve, exitGraceMs + KILL_SETTLE_MS + STOP_MARGIN_MS)))]);
        for (const timer of [kill, bound]) clear(timer);
      }
      // an undelivered or late inspection answer's file removal, whichever branch (bounded)
      if (removals.size > 0) await Promise.race([Promise.allSettled([...removals]), new Promise((resolve) => setTimeout(resolve, DELIVERY_BOUND_MS))]);
    },
  };
  return seam;
}

// A capture's answer as the bridge reads it: the render host's, or the failure in the bridge's own shape
function captureResult(answer: unknown): MawsArtifactCapturedResult {
  const value = answer as { ok?: unknown; png?: unknown; error?: unknown };
  if (value.ok === true && typeof value.png === 'string') return answer as MawsArtifactCapturedResult;
  return { ok: false, error: typeof value.error === 'string' ? value.error : 'the render host answered something other than a capture' };
}

// An export's answer as the bridge reads it: the failure arm without the render host's `ipcError`
function exportAnswer(answer: unknown): MawsArtifactExportAnswer {
  const value = answer as { ok?: unknown; error?: unknown; ipcError?: unknown; path?: unknown };
  if (value.ok === true && typeof value.path === 'string') return answer as MawsArtifactExportAnswer;
  if (value.ok === false && value.ipcError === undefined && typeof value.error === 'string') return answer as MawsArtifactExportAnswer;
  return { ok: false, error: typeof value.error === 'string' ? value.error : 'the render host answered something other than an export' };
}

// What the render host's exit before its ready says (src/render-host/host.ts's exit codes; the entry's 70)
export function exitReason(code: number | null, signal: string | null, line: string | null): string {
  const said = line?.replace(/^\[render-host\]\s*(cannot start:\s*|failed:\s*)?/, '') ?? null;
  if (signal !== null) return `the render host was ended by ${signal}${said ? ` (${said})` : ''}`;
  switch (code) {
    case 2:
      return `the render host was started without a profile${said ? ` (${said})` : ''}`;
    case 1:
      return `the render host could not reach mawsd${said ? `: ${said}` : ''}`;
    case 70:
      return `the render host failed${said ? `: ${said}` : ''}`;
    case 3: // P5 O5 M6: src/render-host/host.ts's EXIT_NO_SANDBOX
      return `the render host refused to run without Chromium’s sandbox${said ? `: ${said}` : ''}`;
    case 0:
      return 'the render host exited before it was ready';
    default:
      return `the render host exited ${code}${said ? `: ${said}` : ''}`;
  }
}

// --- the Word comment authors (Inputs from M3) -----------------------------------------------------------------------

// The names a document's Word comments carry, as the embedded root resolves them (src/main/app.ts's exportAuthors, WR 73):
// each session's title from the spine's records, and the person's export name from the profile's client settings
// (`artifacts.exportAuthorName`). Sent with each export, read at its admission. The routed account's display name, the
// embedded root's fallback, is main's usage reader's and absent here: without a saved name the exporters' neutral label.
export function renderAuthors(clientSettings: string, sessions: readonly { appId: string; title: { text: string } }[] | null): RenderAuthors | undefined {
  const authors: RenderAuthors = {};
  const human = savedAuthorName(clientSettings);
  if (human !== null) authors.human = human;
  if (sessions && sessions.length > 0) {
    const titles: Record<string, string> = {};
    let count = 0;
    for (const { appId, title } of sessions) {
      if (count >= RENDER_AUTHOR_SESSIONS_MAX) break;
      if (appId.length > 128 || title.text.trim() === '') continue;
      titles[appId] = title.text.slice(0, 1_000);
      count += 1;
    }
    if (count > 0) authors.sessions = titles;
  }
  return authors.human === undefined && authors.sessions === undefined ? undefined : authors;
}

function savedAuthorName(path: string): string | null {
  try {
    const settings = JSON.parse(readFileSync(path, 'utf8')) as { artifacts?: { exportAuthorName?: unknown } };
    const saved = settings.artifacts?.exportAuthorName;
    const name = typeof saved === 'string' ? saved.trim() : '';
    return name === '' ? null : name.slice(0, 200);
  } catch {
    return null; // no client settings yet (a profile no app has opened), or unreadable: no saved name
  }
}

// --- the command line (Interfaces §E) ---------------------------------------------------------------------------------

export interface RenderCommandFacts {
  platform: NodeJS.Platform;
  packaged: boolean;
  execPath: string; // the binary `mawsd` runs as (Electron run as Node on a Mac: the app's own, or a checkout's Electron)
  appRoot: string; // a checkout's app root (out/main/../..), the script argument a checkout's Electron needs; on Linux the release's root
  profile: string;
  env: NodeJS.ProcessEnv;
  linux?: { electron: string; xvfbRun: string }; // P5 O5 M6: the render runtime's reading (render-runtime.ts)
}

export interface RenderCommand {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  argv0?: string;
  group?: boolean; // P5 O5 M6: a process group of its own, every kill addressed to it whole
}

// The display the render host's GTK needs on Linux (FINDINGS §1.2): one Xvfb per render host's life, its own display
// number (-a), no TCP listener
export const XVFB_SERVER_ARGS = '-screen 0 1280x800x24 -nolisten tcp';

// The render host's command line (Interfaces §E). On a Mac: the app's binary without ELECTRON_RUN_AS_NODE (the unit's
// environment sets it for `mawsd`), its profile named, from a checkout the app root as the script argument. On Linux
// (P5 O5 M6): the release's entry (the dispatcher, whose bootstrap loads no native module of the hosts') under the render
// cache's Electron, inside xvfb-run, `--headless` for Chromium's software compositing and `--hide-scrollbars` for the
// captures; never `--no-sandbox` (the render host refuses it, and Chromium aborts without its helper configured). Its own
// process group, since a SIGTERM to xvfb-run's shell does not reliably reach Electron and Xvfb must end with it.
export function renderCommand({ platform, packaged, execPath, appRoot, profile, env, linux }: RenderCommandFacts): RenderCommand {
  if (platform !== 'darwin' && (platform !== 'linux' || linux === undefined)) throw new Error(`the render runtime is not installed on this ${platform} machine`);
  const childEnv: NodeJS.ProcessEnv = { ...env, MAWS_USER_DATA: profile };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.NODE_OPTIONS;
  if (platform === 'linux' && linux !== undefined) {
    const args = ['-a', '-s', XVFB_SERVER_ARGS, linux.electron, '--headless', '--hide-scrollbars', join(appRoot, 'out', 'main', 'index.js'), '--render-host', profile];
    return { command: linux.xvfbRun, args, env: childEnv, cwd: profile, group: true };
  }
  return { command: execPath, args: [...(packaged ? [] : [appRoot]), '--render-host', profile], env: childEnv, cwd: profile, argv0: 'maws-render-host' };
}

// The render host started: its stderr read line by line into the daemon's log (its stdout too), its last `[render-host]`
// line kept as its own reason for an exit. For a group (Linux: xvfb-run's shell, Electron and its helpers, the Xvfb), the
// wrapper's exit is not the host's: the rest of the group is ended (SIGTERM, then SIGKILL at `groupGraceMs`) and the exit
// is reported only once no member of the group remains, so the seam's escalation and its successor wait for all of it
// (fix wave 1: a member ignoring SIGTERM outlived the wrapper). After the group's SIGKILL (the retirement's or the
// seam's) the wait is bounded by KILL_SETTLE_MS: a group that still answers then holds only zombies nobody reaps, and
// waiting on them would keep the seam's child forever (PR #428's panel).
export const GROUP_POLL_MS = 50;
export const KILL_SETTLE_MS = 1_000;
export interface SpawnRenderHostOptions {
  groupGraceMs?: number;
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess; // tests: a fake wrapper
  signal?: (pid: number, signal: NodeJS.Signals | 0) => void; // tests: a fake group (process.kill's contract)
}
export function spawnRenderHost(command: RenderCommand, log: (line: string) => void, { groupGraceMs = EXIT_GRACE_MS, spawn = spawnProcess, signal: sendSignal = (pid, sent) => void globalThis.process.kill(pid, sent) }: SpawnRenderHostOptions = {}): RenderChild {
  const group = command.group === true;
  const process: ChildProcess = spawn(command.command, command.args, { env: command.env, cwd: command.cwd, ...(command.argv0 !== undefined && { argv0: command.argv0 }), stdio: ['ignore', 'pipe', 'pipe'], detached: group });
  let last: string | null = null;
  const read = (stream: NodeJS.ReadableStream | null) => {
    if (!stream) return;
    let partial = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      const lines = (partial + chunk).split('\n');
      partial = lines.pop() ?? '';
      for (const line of lines.filter((text) => text.trim() !== '')) {
        if (line.startsWith('[render-host]')) last = line;
        log(line.startsWith('[render-host]') ? line : `[render-host] ${line}`);
      }
    });
  };
  read(process.stdout);
  read(process.stderr);
  const listeners: ((code: number | null, signal: string | null) => void)[] = [];
  let ended: { code: number | null; signal: string | null } | null = null;
  const finish = (code: number | null, signal: string | null) => {
    if (ended) return;
    ended = { code, signal };
    for (const listener of listeners) listener(code, signal);
  };
  // Whether any member of the group is still there (EPERM: one is, under another identity)
  const groupAlive = (pgid: number): boolean => {
    try {
      sendSignal(-pgid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  };
  const signalGroup = (pgid: number, sent: NodeJS.Signals) => {
    try {
      sendSignal(-pgid, sent);
    } catch {
      // the group is gone already
    }
  };
  let killedAt: number | null = null; // when the group was first sent SIGKILL, by the retirement or by the seam
  const killGroup = (pgid: number) => {
    killedAt ??= Date.now();
    signalGroup(pgid, 'SIGKILL');
  };
  // The wrapper exited: the rest of its group retired before the exit is reported. Once the group has been sent SIGKILL
  // nothing of it runs code; what still answers `kill(-pgid, 0)` KILL_SETTLE_MS later is a zombie nobody reaps (an
  // adopter that does not reap), and the exit is reported regardless
  const retireGroup = (pgid: number, code: number | null, signal: string | null) => {
    if (!groupAlive(pgid)) return finish(code, signal);
    if (killedAt === null) signalGroup(pgid, 'SIGTERM');
    const since = Date.now();
    const poll = setInterval(() => {
      if (!groupAlive(pgid)) {
        clearInterval(poll);
        return finish(code, signal);
      }
      if (killedAt === null) {
        if (Date.now() - since < groupGraceMs) return;
        log(`[render] the render host's process group outlived its wrapper by ${groupGraceMs / 1000} s: SIGKILL`);
        return killGroup(pgid);
      }
      if (Date.now() - killedAt >= KILL_SETTLE_MS) {
        clearInterval(poll);
        log(`[render] the render host's process group still answered ${KILL_SETTLE_MS / 1000} s after SIGKILL (members nobody reaped): its exit reported`);
        finish(code, signal);
      }
    }, GROUP_POLL_MS);
  };
  process.on('exit', (code, signal) => (group && process.pid !== undefined ? retireGroup(process.pid, code, signal) : finish(code, signal)));
  process.on('error', (error) => {
    last = `[render-host] ${error.message}`;
    finish(null, null);
  });
  return {
    pid: process.pid ?? null,
    kill: (signal) => {
      if (!group || process.pid === undefined) return void process.kill(signal);
      // the group: Electron, its helpers, xvfb-run and its Xvfb
      if (signal === 'SIGKILL') killGroup(process.pid);
      else signalGroup(process.pid, signal);
    },
    onExit(listener) {
      if (ended) return listener(ended.code, ended.signal);
      listeners.push(listener);
    },
    lastLine: () => last,
  };
}
