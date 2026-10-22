// The scale gate's host seam (M9 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, Acceptance 6; parent Decision
// Log 37): what `e2e/document-scale.spec.ts` drives the engine host through, started only when the host runs under
// MAWS_E2E=1 and MAWS_DOCUMENT_PERF=1. It is the "test-only command" through which two agent sessions are driven by the
// host's own writer: each command names a session, and the document tools of this child run through their real `call`
// with that session as the context (the read warms the session's replica and records its view; a batch is planned and
// written by the patch writer through A's `writeAs`, its op recorded, its presence published), so what is measured is
// the path an agent's `artifact_edit` takes in the host, less the engine's wire. The host's own event-loop delay is
// sampled around each call (a histogram of this seam's, running all along, reset before the call and read once the loop
// has turned after it): the longest the call kept the loop, its first synchronous stretch included. A's `artifacts.testLoopDelay` stays the run-wide measure.
// P4-R6: each call's answer also says what shared its loop (`background`): the main thread's CPU time inside the longest
// gap (where the platform tells it), the host's own work and V8's collections that overlapped that gap, and all of it
// over the call by kind (`./host-work.ts`), so a slow row names its cause from its record.
//
// Commands arrive as JSON files in `<dir>/in` (written beside and renamed in, so a file is whole when seen) and run one
// at a time in name order; each answer is written to `<dir>/out` under the command's name (again by rename). No IPC
// name is added: the channel is the profile's directory, which only the e2e that launched the app writes.
//
//   seed     {artifactId, state (base64 V2)}       the document's tabs replaced by the state's, as the human
//   call     {session, tool, args}                 artifact_read (a document's, a deck's, a design's, a dashboard's),
//                                                  artifact_edit, artifact_reply, artifact_publish or artifact_dataset
//                                                  (P4-A2 G2) as `session`; `baseRevision: 'last'` stands for the
//                                                  revision the session last saw (its read, its batch or its publish);
//                                                  `args.toolUseId`, when given, is the call's tool-use id (P4-A2)
//   stream   {session, toolUseId, name, deltas,    P4-A2 (X35; the child's R12): the pieces of a call's input fed to the
//             tickMs?}                             session's provisional emitter one per `tickMs` (20), as the engine's
//                                                  deltas would; answered once the last tick ran, with how many
//                                                  streaming frames the call sent. A `call` under the same id commits it
//   drop     {session, toolUseId}                  P4-A2: the call's layer dropped, as an ending without a commit drops it
//   heap     {}                                    the heap after two collections
//   release  {session}                             the session's replicas closed (its end), its layers dropped first
//   loop     {reset?}                              the loop's gaps since the last reset (a run-wide measure beside A's)
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { TABS } from '@artifacts/document/tabs';
import { applyV2 } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import { PROVISIONAL_TICK_MS, type ProvisionalTool } from '@shared/artifacts/provisional';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { ArtifactSession } from '../../tool-server/artifact-context'; // P4-A2 G2
import { artifactPublishTool } from '../../tool-server/artifact-publish'; // P4-A2 G2
import { artifactReadTool } from '../../tool-server/artifact-tools'; // P4-A2 G2
import { artifactDatasetTool } from '../../tool-server/datasets'; // P4-A2 G2
import { artifactEditTool, artifactReplyTool /* P4-B1 */, documentReadTool, DocumentToolSession } from '../../tool-server/documents';
import { ProvisionalEmitter } from '../../tool-server/provisional';
import type { McpToolDefinition } from '../../tool-server/server';
import { holdHostWork, hostWorkBetween, watchHostWork, type HostWork } from '../host-work'; // P4-R6
import type { ArtifactStore } from '../store';

const HUMAN: Actor = { kind: 'human' };
const LOOP_TICK_MS = 1;
const STREAM_TICK_MS = 20; // P4-A2: `stream`'s default pace, a little over the emitter's tick, so each piece is a frame

/**
 * The host loop's occupancy, sampled by a 1 ms interval timer reading `performance.now()`: each gap between two ticks is
 * how long the loop could not run a timer. M9's review found `monitorEventLoopDelay` missing a block that starts in the
 * same pass of the loop as its own sampling timer (an 80 ms synchronous call read as 1.3 ms), so the gaps are measured
 * here directly; a gap includes the tick itself (about 1 to 1.5 ms when idle).
 */
export class LoopSampler { // P3-C M10: exported for the deck's scale seam (src/engine-host/presentations/scale-seam.ts)
  private last = performance.now();
  private lastCpu = threadCpuMs();
  private gaps: number[] = [];
  private longest: LongestGap | null = null; // P4-R6
  private readonly timer = setInterval(() => {
    const now = performance.now();
    const cpu = threadCpuMs();
    const gap = now - this.last;
    this.gaps.push(gap);
    if (!this.longest || gap > this.longest.ms) this.longest = { at: this.last, ms: gap, cpuMs: cpu === null || this.lastCpu === null ? null : cpu - this.lastCpu };
    this.last = now;
    this.lastCpu = cpu;
  }, LOOP_TICK_MS);

  constructor() {
    this.timer.unref();
  }

  reset(): void {
    this.gaps = [];
    this.longest = null;
    this.last = performance.now();
    this.lastCpu = threadCpuMs();
  }

  // P4-R6: the longest gap since the reset (the one `stats().max` reads), when it began, and the main thread's CPU time
  // inside it: near its length, the thread ran (script, a collection, a synchronous call); well under it, the thread
  // waited (an fsync, the scheduler).
  longestGap(): LongestGap | null {
    return this.longest;
  }

  stats(): LoopStats {
    if (this.gaps.length === 0) return { max: 0, p99: 0, mean: 0 };
    const sorted = [...this.gaps].sort((a, b) => a - b);
    return { max: sorted[sorted.length - 1]!, p99: sorted[Math.min(sorted.length - 1, Math.ceil(0.99 * sorted.length) - 1)]!, mean: sorted.reduce((sum, gap) => sum + gap, 0) / sorted.length };
  }

  // P3-C M10: the loop's busy time since the reset, the sum of every gap's excess over the tick (a gap within twice the
  // tick is the timer's own idle jitter, not work). Event-loop utilization reads 0 in Electron's utility process.
  busy(): number {
    return this.gaps.reduce((sum, gap) => (gap > 2 * LOOP_TICK_MS ? sum + gap - LOOP_TICK_MS : sum), 0);
  }

  close(): void {
    clearInterval(this.timer);
  }
}

export type PerfCommand =
  | { cmd: 'seed'; artifactId: string; state: string }
  | { cmd: 'call'; session: string; tool: PerfTool; args: Record<string, unknown> }
  | { cmd: 'heap' }
  | { cmd: 'release'; session: string }
  | { cmd: 'loop'; reset?: boolean }
  | { cmd: 'stream'; session: string; toolUseId: string; name: ProvisionalTool; deltas: string[]; tickMs?: number } // P4-A2
  | { cmd: 'drop'; session: string; toolUseId: string }; // P4-A2

export interface LoopStats {
  max: number;
  p99: number;
  mean: number;
}

// P4-R6: the main thread's CPU time so far (user and system), where the platform tells it (Node 23.9 and later).
function threadCpuMs(): number | null {
  if (typeof process.threadCpuUsage !== 'function') return null;
  const { user, system } = process.threadCpuUsage();
  return (user + system) / 1000;
}

export interface LongestGap {
  at: number; // performance.now() when the gap began
  ms: number;
  cpuMs: number | null; // the main thread's CPU time inside it; null where the platform does not tell it
}

/** P4-R6: what shared a call's loop. `at` is ms after the call's start; entries may nest; `partial` when the record
 * dropped some of the call's window (a call far past the host's usual load). */
export interface CallBackground {
  longest: { at: number; ms: number; cpuMs: number | null; work: Array<{ what: HostWork; at: number; ms: number; detail?: string }> } | null;
  call: Partial<Record<HostWork, { count: number; ms: number }>>;
  partial?: true;
}

/** A tool call's answer: its result (or, refused, the tool's text), its wall time and the loop's delay around it. */
export interface CallAnswer {
  ok: true;
  isError: boolean;
  result?: unknown;
  text: string;
  wallMs: number;
  loop: LoopStats;
  background: CallBackground; // P4-R6
}

const tenth = (ms: number) => Math.round(ms * 10) / 10;

/** P4-R6: the host's work over [from, to), and inside the sampler's longest gap. */
export function backgroundOf(sampler: LoopSampler, from: number, to: number): CallBackground {
  const { work, partial } = hostWorkBetween(from, to);
  const call: CallBackground['call'] = {};
  for (const entry of work) {
    const sum = (call[entry.what] ??= { count: 0, ms: 0 });
    sum.count += 1;
    sum.ms = tenth(sum.ms + entry.ms);
  }
  const gap = sampler.longestGap();
  const longest =
    gap === null
      ? null
      : {
          at: tenth(gap.at - from),
          ms: tenth(gap.ms),
          cpuMs: gap.cpuMs === null ? null : tenth(gap.cpuMs),
          work: work.filter((entry) => entry.at < gap.at + gap.ms && entry.at + entry.ms > gap.at).map((entry) => ({ what: entry.what, at: tenth(entry.at - from), ms: tenth(entry.ms), ...(entry.detail !== undefined && { detail: entry.detail }) })),
        };
  return { longest, call, ...(partial && { partial: true as const }) };
}

export type PerfAnswer =
  | { ok: false; error: string }
  | { ok: true; revision: number }
  | CallAnswer
  | { ok: true; heapUsed: number; rss: number; collected: boolean }
  | { ok: true; loop: LoopStats }
  | { ok: true; frames: number } // P4-A2: `stream`
  | { ok: true };

export const documentPerfSeamRequested = (env: Record<string, string | undefined>): boolean => env.MAWS_E2E === '1' && env.MAWS_DOCUMENT_PERF === '1';

/** P4-B1: the tools the seam runs as a session; `artifact_reply` for the margin's e2e (an agent's reply growing a card).
 * P4-A2 G2 (G-R9): `artifact_publish` and `artifact_dataset` for the deck's, the design's and the dashboard's layers. */
export type PerfTool = 'artifact_read' | 'artifact_edit' | 'artifact_reply' | 'artifact_publish' | 'artifact_dataset';

interface PerfSession {
  tools: Partial<Record<PerfTool, McpToolDefinition>>;
  calls: number;
  lastRevision: number;
  provisional: ProvisionalEmitter; // P4-A2: the session's layers, which its edits commit or drop
  streamed: Map<string, number>; // P4-A2: the streaming frames each call sent
}

const turned = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class DocumentPerfSeam {
  private readonly sessions = new Map<string, PerfSession>();
  private readonly loop = new LoopSampler();
  private readonly runLoop = new LoopSampler(); // the `loop` command's, over a whole run
  private readonly unwatch = watchHostWork(); // P4-R6: the host's work recorded while the seam runs
  private gc: (() => void) | null = null;

  constructor(
    private readonly store: ArtifactStore,
    private readonly options: { tools?: (deps: { artifacts: () => ArtifactStore; session: DocumentToolSession; provisional: ProvisionalEmitter }) => PerfSession['tools'] } = {},
  ) {}

  async run(command: PerfCommand): Promise<PerfAnswer> {
    try {
      switch (command.cmd) {
        case 'seed':
          return await this.seed(command.artifactId, Buffer.from(command.state, 'base64'));
        case 'call':
          return await this.call(command.session, command.tool, command.args);
        case 'heap':
          return this.heap();
        case 'loop': {
          const stats = this.runLoop.stats();
          if (command.reset) this.runLoop.reset();
          return { ok: true, loop: stats };
        }
        case 'release':
          this.sessions.get(command.session)?.provisional.processExited(); // P4-A2
          this.store.service.closeSession(command.session as AppSessionId);
          this.sessions.delete(command.session);
          return { ok: true };
        case 'stream':
          return await this.stream(command.session, command.toolUseId as ToolUseId, command.name, command.deltas, command.tickMs ?? STREAM_TICK_MS);
        case 'drop':
          this.session(command.session).provisional.dropped(command.toolUseId as ToolUseId);
          return { ok: true };
        default:
          return { ok: false, error: `unknown command ${JSON.stringify((command as { cmd: unknown }).cmd)}` };
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  close(): void {
    this.loop.close();
    this.runLoop.close();
    this.unwatch(); // P4-R6
  }

  // The tabs a document has (the host's first tab) removed and the seed's applied, in one write as the human.
  private async seed(artifactId: string, state: Uint8Array): Promise<PerfAnswer> {
    await this.store.service.writeAs(artifactId, HUMAN, (doc) => {
      const tabs = doc.get(TABS);
      for (const [key] of [...tabs.attrEntries()]) tabs.deleteAttr(String(key));
      applyV2(doc, state);
    });
    return { ok: true, revision: this.store.revision(artifactId) };
  }

  private session(name: string): PerfSession {
    let session = this.sessions.get(name);
    if (!session) {
      const streamed = new Map<string, number>();
      const provisional = new ProvisionalEmitter({
        store: () => this.store, appSessionId: name as AppSessionId,
        onFrame: (frame) => {
          if (frame.state === 'streaming') streamed.set(frame.toolUseId, (streamed.get(frame.toolUseId) ?? 0) + 1);
        },
      });
      // P4-A2 G2: A's tools beside the document's, as `mawsTools` pairs them: one session memory, the document's read
      // handing every other kind to A's
      const artifacts = { artifacts: () => this.store, session: new ArtifactSession(), provisional };
      const deps = { artifacts: () => this.store, session: new DocumentToolSession(artifacts.session.guided), provisional };
      session = {
        tools: this.options.tools?.(deps) ?? {
          artifact_read: documentReadTool(deps, artifactReadTool(artifacts)), artifact_edit: artifactEditTool(deps), artifact_reply: artifactReplyTool(deps) /* P4-B1 */,
          artifact_publish: artifactPublishTool(artifacts), artifact_dataset: artifactDatasetTool(artifacts), // P4-A2 G2
        },
        calls: 0, lastRevision: 0, provisional, streamed,
      };
      this.sessions.set(name, session);
    }
    return session;
  }

  // P4-A2 (R12): a call's input fed as the engine's deltas would arrive, one piece per `tickMs`; answered once the
  // emitter's tick after the last piece ran.
  private async stream(name: string, toolUseId: ToolUseId, tool: ProvisionalTool, deltas: string[], tickMs: number): Promise<PerfAnswer> {
    const session = this.session(name);
    for (const piece of deltas) {
      session.provisional.delta(toolUseId, tool, piece);
      await turned(tickMs);
    }
    await turned(2 * PROVISIONAL_TICK_MS);
    return { ok: true, frames: session.streamed.get(toolUseId) ?? 0 };
  }

  private async call(name: string, tool: PerfTool, args: Record<string, unknown>): Promise<PerfAnswer> {
    const session = this.session(name);
    const definition = session.tools[tool];
    if (!definition) return { ok: false, error: `no tool ${JSON.stringify(tool)}` };
    const { toolUseId, ...rest } = args; // P4-A2: the id a `stream` used, so the call commits or drops its layer
    const input = rest.baseRevision === 'last' ? { ...rest, baseRevision: session.lastRevision } : rest;
    session.calls += 1;
    const ctx = {
      appSessionId: name as AppSessionId, cwd: '/', toolUseId: (typeof toolUseId === 'string' ? toolUseId : `toolu_perf_${name}_${session.calls}`) as ToolUseId,
      requestId: `perf-${name}-${session.calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false,
    };
    // the sampler runs all along, so a call blocking the loop at once is caught by the gap it leaves; the gaps before
    // the call, the command's own parsing among them, are dropped by the reset
    await turned(LOOP_TICK_MS * 3);
    this.loop.reset();
    const started = performance.now();
    const release = holdHostWork(started); // P4-R6: the call's window kept however long it runs
    const { result, wallMs, loop, background } = await (async () => {
      const result = await definition.call(input, ctx);
      const wallMs = performance.now() - started;
      await turned(LOOP_TICK_MS * 5); // the gap the call left closes once the loop turns after it
      return { result, wallMs, loop: this.loop.stats(), background: backgroundOf(this.loop, started, performance.now()) /* P4-R6 */ };
    })().finally(release);
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    const isError = result.isError === true;
    let parsed: unknown;
    if (!isError) {
      parsed = JSON.parse(text);
      const revision = (parsed as { revision?: unknown }).revision;
      if (typeof revision === 'number') session.lastRevision = revision;
    }
    return { ok: true, isError, ...(parsed !== undefined && { result: parsed }), text: isError ? text : '', wallMs, loop, background };
  }

  private heap(): PerfAnswer {
    if (!this.gc) {
      setFlagsFromString('--expose-gc'); // S7b pitfall 7: `--expose-gc` in a utility process's execArgv never reaches V8
      this.gc = runInNewContext('gc') as () => void;
    }
    this.gc();
    this.gc();
    const { heapUsed, rss } = process.memoryUsage();
    return { ok: true, heapUsed, rss, collected: true };
  }
}

/** The seam over the file channel in `dir` (`in`, `out`); `close` stops it. */
export function startDocumentPerfSeam(store: ArtifactStore, dir: string, log: (line: string) => void = (line) => console.warn(`[document-perf] ${line}`)): { close(): void } {
  const seam = new DocumentPerfSeam(store);
  return serveCommandFiles(dir, (command: PerfCommand) => seam.run(command), log, () => seam.close()); // P3-C M10: the channel shared with the deck's scale seam
}

// P3-C M10 start: the file channel, moved out of startDocumentPerfSeam unchanged so the deck's scale seam serves its
// commands the same way.
/** Serves the command files arriving in `<dir>/in` through `run`, one at a time in name order, answering in `<dir>/out`. */
export function serveCommandFiles<C, A>(dir: string, run: (command: C) => Promise<A>, log: (line: string) => void, onClose: () => void = () => {}): { close(): void } {
  const inbox = join(dir, 'in');
  const outbox = join(dir, 'out');
  mkdirSync(inbox, { recursive: true });
  mkdirSync(outbox, { recursive: true });
  let running = false;
  let again = false;
  let closed = false;
  const drain = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        for (const name of readdirSync(inbox).filter((file) => file.endsWith('.json')).sort()) {
          if (closed) return;
          const path = join(inbox, name);
          let command: C;
          try {
            command = JSON.parse(readFileSync(path, 'utf8')) as C;
          } finally {
            rmSync(path, { force: true });
          }
          const answer = await run(command);
          writeFileSync(join(outbox, `${name}.tmp`), JSON.stringify(answer));
          renameSync(join(outbox, `${name}.tmp`), join(outbox, name));
        }
      } while (again && !closed);
    } catch (error) {
      log(`a command failed outside its run: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };
  const watcher: FSWatcher = watch(inbox, () => void drain());
  watcher.unref(); // never what keeps the host running
  // a file watch can drop an event on a loaded machine: the inbox is also read every quarter second
  const poll = setInterval(() => void drain(), 250);
  poll.unref();
  void drain();
  log(`listening in ${dir}`);
  return {
    close: () => {
      closed = true;
      watcher.close();
      clearInterval(poll);
      onClose();
    },
  };
}
// P3-C M10 end
