// The local lane A driver (P5 O9 M2, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md): for every session on this
// machine held by a terminal or a `--bg` job, main finds whether its bridge (sminos's DX5 child) answers and, when it
// does, keeps the session's `LaneAState` and drives its controls through the bridge's socket. `laneA.*` answers the
// renderer.
//
// - Discovery: a session is probed (`GET /status`, 2 s) when its holder becomes foreign, when its socket appears in the
//   bridge directory (watched while any foreign session is held), and after its state stream ends. A probe that fails,
//   or answers another session, means no bridge: the session has no lane A state and stays read-only as today.
// - One state stream (`GET /events`) per live or starting bridged session, for as long as it is held and bridged: its
//   pending requests feed attention and its deliveries' fates come on it. On an end it resubscribes with backoff (0.5 s
//   doubling to 8 s, reset by a snapshot that holds for a minute). A starting bridge becomes live by it: the child holds
//   the subscription until the mod's first resync, and the first snapshot re-reads `/status`.
// - Each watch (`laneA.watch`, one per page) is a stream of its own, whose own snapshot seeds that watcher; its events go
//   out as `laneA.plane` reshaped to DX4 (./reshape.ts). A stream that ends under a live watch is announced as a reset
//   and resubscribed.
// - Jobs: while a session has a watch, its transcript is followed (./transcript-jobs.ts) and its background shells and
//   monitors, derived by sminos's rules (./jobs.ts), go to each watch in its snapshot and as a `subagents` message each
//   time they change. When the session's holder ends or its bridge goes, its process is taken as gone: each watch hears
//   its running jobs `exited` before it ends. A stop is refused for a job the transcript holds ended.
// - Controls post `POST /command?wait=10000` carrying the launch `/status` named. A 504 or a closed socket is `unknown`:
//   the op may have run. Nothing is retried on its own but `deliver` (./deliveries.ts). Decisions are built from typed
//   fields (./decisions.ts) after a fresh `GET /requests/<id>`, with `by: 'maws'`. `from` is never sent.
// - Media (M7): an upload is checked, saved under the session's own directory and handed to the bridge's `media` op
//   (./media.ts), retried under its upload id; the roots it wrote are swept once no upload went to them for a day.
// - The uid boundary (RL §5.11): the driver authenticates nothing and is authorized by the uid, as `sminos steer` is, so
//   it makes the checks sminos's daemon makes on a remote RPC itself.
//
// Electron-free and machine-bound (eslint's MACHINE_BOUND), so O3 moves it into `mawsd` with main's other services.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { RequestAnswer } from '@shared/engine/answers';
import type { SessionRecord } from '@shared/graph/session';
import type { AppSessionId } from '@shared/graph/ids';
import type { ClientRef } from '@shared/ipc/client';
import type { CommandName, EventPayload } from '@shared/ipc/schema';
import type { ControlResult, LaneAAnswerOutput, LaneACatalog, LaneASendOutput, LaneAState } from '@shared/ipc/schema/lane-a';
import type { MainHandler } from '../ipc/router';
// eslint-disable-next-line no-restricted-imports -- P5 O3-C: lane A is spine (O3 Decision Log 13); the fold after this merge moves it to src/services/lane-a/
import { createGitRunner, type GitRun } from '../../services/git/runner';
import { BridgeUnreachable, call, subscribe, type BridgeAnswer, type EventStream } from './bridge-client';
import { decisionFor } from './decisions';
import { DeliveryLane, fileSeqStore, LANE_TIMING, type LaneTiming, type PostResult, type SeqStore } from './deliveries';
import { bridgeSocket, watchBridgeDir, type BridgeDirWatch } from './discovery';
import { sendMedia, uploadRecords } from './media';
import { Reshaper } from './reshape';
import { classify, SessionFold, type BridgeState, type MainTool } from './state';
import { TranscriptJobs } from './transcript-jobs';

export interface LaneATiming {
  probeMs: number;
  commandWaitMs: number; // a command's `?wait=`; the socket waits a little longer
  requestMs: number; // a request's re-read before a decision
  decisionMs: number; // a decision's post (an async question's answer is relayed to the mod, up to 5 s)
  backoff: { firstMs: number; maxMs: number; healthyMs: number };
  dirPollMs: number;
  jobsPollMs: number; // how often a watched session's transcript is read for its jobs
  sweepMs: number; // how often the upload roots are swept of those a day old (M7)
  lane: LaneTiming;
}

export const LANE_A_TIMING: LaneATiming = {
  probeMs: 2000,
  commandWaitMs: 10_000,
  requestMs: 5000,
  decisionMs: 10_000,
  backoff: { firstMs: 500, maxMs: 8000, healthyMs: 60_000 },
  dirPollMs: 2000,
  jobsPollMs: 1000,
  sweepMs: 3600_000,
  lane: LANE_TIMING,
};

type LaneAEvent = 'laneA.changed' | 'laneA.plane';

export interface LaneADeps {
  machine: string; // this machine's MachineRef: the delivery writer's and the plane's envelope's
  home: string | Promise<string>; // the sminos home (./discovery.ts `sminosHome`); a rejection leaves lane A off
  userData: string;
  transcript?(appId: AppSessionId, engineSessionId: string): Promise<string | null>; // the session's transcript path, null while none is known
  emit<N extends LaneAEvent>(name: N, payload: EventPayload<N>): void;
  log?(line: string): void;
  git?: GitRun; // the uploads' exclude entry (M7); main's read runner by default
  timing?: Partial<LaneATiming>;
}

export interface SessionHold {
  appId: AppSessionId;
  engineSessionId: string | null;
  holder: SessionRecord['holder'];
}

// What main's own consumers of a bridged session read (P5 O9 M6: its attention items and its digest): its state, whether
// the state stream holds a current snapshot (`fresh`: false from the stream's end until its next snapshot, while what it
// said of the pending requests may be out of date), and the main loop's latest tool call. Null: the session left lane A.
export interface LaneAView {
  state: LaneAState;
  fresh: boolean;
  tool: MainTool | null;
}
export type LaneAListener = (appId: AppSessionId, view: LaneAView | null) => void;

type ReadKind = 'usage' | 'config' | 'settings' | 'mcp' | 'status' | 'rows' | 'diff' | 'output';
type ReadOutput = { ok: true; result: unknown } | { ok: false; code: 'no-bridge' | 'unsupported' | 'timeout' | 'busy' | 'failed'; message: string };

class Backoff {
  private attempts = 0;
  private healthy: NodeJS.Timeout | null = null;
  constructor(private readonly timing: LaneATiming['backoff']) {}
  next(): number {
    const delay = Math.min(this.timing.firstMs * 2 ** this.attempts, this.timing.maxMs);
    this.attempts += 1;
    return delay;
  }
  holding(): void {
    this.broke();
    this.healthy = setTimeout(() => (this.attempts = 0), this.timing.healthyMs);
    this.healthy.unref();
  }
  broke(): void {
    if (this.healthy) clearTimeout(this.healthy);
    this.healthy = null;
  }
}

interface Watch {
  id: string;
  stream: EventStream | null;
  reshaper: Reshaper | null;
  backoff: Backoff;
  timer: NodeJS.Timeout | null;
  offGone: () => void;
  ended: boolean;
  jobs: string | null; // the jobs it last carried, as JSON
}

interface Session {
  appId: AppSessionId;
  engine: string;
  holder: string; // the holder as JSON: a new process holding the same session is probed again
  socket: { path: string; fits: boolean };
  status: Record<string, unknown> | null;
  bridge: BridgeState | null; // null: no bridge answered; the session is not lane A
  fold: SessionFold;
  stream: EventStream | null;
  snapshotted: boolean; // the current state stream's snapshot came
  backoff: Backoff;
  reconnect: NodeJS.Timeout | null;
  probing: boolean;
  again: boolean;
  lane: DeliveryLane;
  watches: Map<string, Watch>;
  modelChain: Promise<unknown>;
  jobs: TranscriptJobs | null; // followed while it has a watch
  jobsTimer: NodeJS.Timeout | null;
  gone: boolean;
}

const NO_BRIDGE = 'this session has no bridge MAWS can drive';
const record = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
const refused = (code: string, message: string): ControlResult => ({ state: 'refused', code, message });

export interface LaneADriver {
  observe(hold: SessionHold): void;
  forget(appId: AppSessionId): void;
  list(): LaneAState[];
  state(appId: AppSessionId): LaneAState | null;
  catalog(appId: AppSessionId): LaneACatalog | null;
  watch(appId: AppSessionId, client: ClientRef): { watch: string };
  unwatch(appId: AppSessionId, watch: string): void;
  read(appId: AppSessionId, kind: ReadKind, args?: Record<string, unknown>): Promise<ReadOutput>;
  send(appId: AppSessionId, text: string): Promise<LaneASendOutput>;
  interrupt(appId: AppSessionId): Promise<ControlResult>;
  answer(appId: AppSessionId, request: string, answer: RequestAnswer): Promise<LaneAAnswerOutput>;
  model(appId: AppSessionId, change: { model?: string | null; effort?: string | null }): Promise<ControlResult>;
  command(appId: AppSessionId, name: string, args: string): Promise<ControlResult>;
  btw(appId: AppSessionId, prompt: string): Promise<ControlResult>;
  compact(appId: AppSessionId, instructions?: string): Promise<ControlResult>;
  stopAgent(appId: AppSessionId, agentId: string): Promise<ControlResult>;
  tell(appId: AppSessionId, agentId: string, text: string): Promise<ControlResult>;
  stopTask(appId: AppSessionId, taskId: string): Promise<ControlResult>;
  media(appId: AppSessionId, files: readonly { name: string; mediaType: string; data: string }[]): Promise<ControlResult>;
  onChange(listener: LaneAListener): () => void; // M6: each session's view as it changes, from now on
  stop(): void;
}

export function createLaneADriver(deps: LaneADeps): LaneADriver {
  const timing: LaneATiming = { ...LANE_A_TIMING, ...deps.timing };
  const log = deps.log ?? ((line: string) => console.log(`[lane-a] ${line}`));
  const writer = `maws/${deps.machine}`;
  const sessions = new Map<AppSessionId, Session>();
  let seqs: SeqStore | null = null;
  let home: string | null = null;
  let disabled = false;
  let dirWatch: BridgeDirWatch | null = null;
  let stopped = false;
  const warned = new Set<string>();
  const listeners = new Set<LaneAListener>();
  const uploads = uploadRecords(join(deps.userData, 'lane-a', 'uploads.json'), { log });
  let git: GitRun | null = deps.git ?? null;
  const sweep = () => {
    try {
      const swept = uploads.sweep();
      if (swept > 0) log(`swept ${swept} upload root${swept === 1 ? '' : 's'} no upload went to for a day`);
    } catch (error) {
      log(`the upload roots were not swept (${error instanceof Error ? error.message : String(error)})`);
    }
  };
  const sweeper = setInterval(sweep, timing.sweepMs);
  sweeper.unref();
  setImmediate(() => {
    if (!stopped) sweep();
  });

  void Promise.resolve(deps.home).then(
    (resolved) => {
      if (stopped) return;
      home = resolved;
      for (const s of sessions.values()) s.socket = bridgeSocket(resolved, s.engine);
      syncDirWatch();
      for (const s of sessions.values()) void probe(s);
    },
    (error: unknown) => {
      disabled = true;
      log(`off: ${error instanceof Error ? error.message : String(error)}`);
    },
  );

  // ---- discovery ------------------------------------------------------------------------------------------------------
  function syncDirWatch(): void {
    if (home === null) return;
    if (sessions.size > 0 && dirWatch === null) {
      dirWatch = watchBridgeDir(home, (name) => onDirChange(name), { pollMs: timing.dirPollMs });
    } else if (sessions.size === 0 && dirWatch !== null) {
      dirWatch.close();
      dirWatch = null;
    }
  }

  function onDirChange(name: string | null): void {
    if (name !== null && (name.startsWith('.') || !name.endsWith('.sock'))) return; // a socket bound at its temporary name, a kept <id>.json
    const engine = name?.slice(0, -'.sock'.length);
    for (const s of sessions.values()) {
      if (engine === undefined ? s.bridge === null : s.engine === engine) void probe(s);
    }
  }

  async function probe(s: Session): Promise<void> {
    if (s.gone || home === null || disabled) return;
    if (s.probing) {
      s.again = true;
      return;
    }
    s.probing = true;
    try {
      do {
        s.again = false;
        const status = await statusOf(s);
        if (s.gone) return;
        apply(s, status);
      } while (s.again && !s.gone);
    } finally {
      s.probing = false;
    }
  }

  async function statusOf(s: Session): Promise<Record<string, unknown> | null> {
    if (!s.socket.fits) {
      if (!warned.has(s.engine)) log(`${s.engine}: its bridge's socket path is over 103 bytes (${s.socket.path}); a shorter SMINOS_HOME fixes it`);
      warned.add(s.engine);
      return null;
    }
    try {
      const answer = await call(s.socket.path, 'GET', '/status', undefined, timing.probeMs);
      return answer.status === 200 && answer.body?.session === s.engine ? answer.body : null;
    } catch {
      return null; // no socket, a stale one, a timeout
    }
  }

  function apply(s: Session, status: Record<string, unknown> | null): void {
    if (status === null) {
      unbridge(s, 'the session’s bridge went away');
      return;
    }
    s.status = status;
    s.bridge = classify(status);
    if (s.bridge.bridge === 'live' || s.bridge.bridge === 'starting') openState(s);
    else {
      closeState(s);
      endWatches(s, s.bridge.reason ?? NO_BRIDGE);
    }
    changed(s);
  }

  function unbridge(s: Session, reason: string): void {
    closeState(s);
    jobsChanged(s, false); // no bridge: the session's process is taken as gone
    endWatches(s, reason);
    s.lane.dropQueued(reason);
    if (s.bridge === null) return;
    s.bridge = null;
    s.status = null;
    changed(s);
  }

  // ---- the state stream -----------------------------------------------------------------------------------------------
  function openState(s: Session): void {
    if (s.stream !== null || s.reconnect !== null) return;
    s.snapshotted = false;
    const stream: EventStream = subscribe(s.socket.path, {
      onLines: (lines) => {
        if (s.stream !== stream) return;
        let dirty = false;
        const toolBefore = JSON.stringify(s.fold.mainTool());
        for (const line of lines) {
          if (!s.snapshotted) {
            if (line.type !== 'snapshot') return stateEnded(s, stream, 'the stream did not open with a snapshot');
            s.snapshotted = true;
            s.fold.snapshot(line);
            s.lane.snapshotArrived();
            s.backoff.holding();
            void probe(s); // a starting bridge's first snapshot: /status again, which names it live
            dirty = true;
          } else if (line.type === 'gap') {
            return stateEnded(s, stream, 'the bridge’s stream lost events');
          } else if (line.type === 'delivered') {
            const key = record(line.key) ?? {};
            s.lane.fate(key, String(line.outcome), typeof line.uuid === 'string' ? line.uuid : undefined, typeof line.reason === 'string' ? line.reason : undefined);
          } else if (s.fold.event(line)) dirty = true;
        }
        if (dirty) changed(s);
        else if (JSON.stringify(s.fold.mainTool()) !== toolBefore) tell(s);
      },
      onEnd: (reason) => stateEnded(s, stream, reason),
    });
    s.stream = stream;
  }

  function stateEnded(s: Session, stream: EventStream, reason: string): void {
    if (s.stream !== stream) return;
    stream.close();
    s.stream = null;
    s.backoff.broke();
    if (s.snapshotted) s.lane.streamLost();
    if (s.gone) return;
    tell(s); // its requests are no longer current
    const delay = s.backoff.next();
    log(`${s.engine}: its state stream ended (${reason}); again in ${delay} ms`);
    s.reconnect = setTimeout(() => {
      s.reconnect = null;
      void probe(s);
    }, delay);
    s.reconnect.unref();
  }

  function closeState(s: Session): void {
    // A stream closed here (discovery found no bridge, or another state) ends without `onEnd`, so the lane is told
    // itself: the fates its sends were waiting for went with it.
    if (s.stream !== null && s.snapshotted) s.lane.streamLost();
    s.stream?.close();
    s.stream = null;
    if (s.reconnect) clearTimeout(s.reconnect);
    s.reconnect = null;
    s.backoff.broke();
  }

  // ---- watches --------------------------------------------------------------------------------------------------------
  function openWatch(s: Session, w: Watch): void {
    w.reshaper = null;
    const stream: EventStream = subscribe(s.socket.path, {
      onLines: (lines) => {
        if (w.stream !== stream) return;
        const messages = [];
        for (const line of lines) {
          if (w.reshaper === null) {
            if (line.type !== 'snapshot') return watchEnded(s, w, stream);
            w.reshaper = new Reshaper({ machine: deps.machine, session: s.engine, sub: w.id });
            const jobs = s.jobs?.body(true) ?? [];
            w.jobs = JSON.stringify(jobs);
            messages.push(...w.reshaper.snapshot(line, jobs));
            w.backoff.holding();
            continue;
          }
          const out = w.reshaper.event(line);
          if (out === 'discontinuity') {
            if (messages.length > 0) deps.emit('laneA.plane', { appSessionId: s.appId, watch: w.id, messages });
            return watchEnded(s, w, stream);
          }
          messages.push(...out);
        }
        if (messages.length > 0) deps.emit('laneA.plane', { appSessionId: s.appId, watch: w.id, messages });
      },
      onEnd: () => watchEnded(s, w, stream),
    });
    w.stream = stream;
  }

  function watchEnded(s: Session, w: Watch, stream: EventStream): void {
    if (w.stream !== stream) return;
    stream.close();
    w.stream = null;
    w.backoff.broke();
    if (w.ended || s.gone) return;
    if (w.reshaper !== null) deps.emit('laneA.plane', { appSessionId: s.appId, watch: w.id, reset: true }); // what it drew no longer follows
    // its reshaper stays until the stream opens again, so the jobs' last word reaches it if the bridge went meanwhile
    w.timer = setTimeout(() => {
      w.timer = null;
      if (!w.ended) openWatch(s, w);
    }, w.backoff.next());
    w.timer.unref();
  }

  function endWatch(s: Session, w: Watch, reason: string | null): void {
    if (w.ended) return;
    w.ended = true;
    w.stream?.close();
    w.stream = null;
    if (w.timer) clearTimeout(w.timer);
    w.backoff.broke();
    w.offGone();
    s.watches.delete(w.id);
    if (s.watches.size === 0) unfollowJobs(s);
    if (reason !== null) deps.emit('laneA.plane', { appSessionId: s.appId, watch: w.id, ended: reason });
  }

  function endWatches(s: Session, reason: string): void {
    for (const w of [...s.watches.values()]) endWatch(s, w, reason);
  }

  // ---- jobs ---------------------------------------------------------------------------------------------------------------
  const transcriptJobs = (s: Session) => new TranscriptJobs(() => deps.transcript?.(s.appId, s.engine) ?? Promise.resolve(null));

  function followJobs(s: Session): void {
    if (s.jobs !== null) return;
    const jobs = (s.jobs = transcriptJobs(s));
    const poll = () => {
      jobs.read().then(
        () => jobsChanged(s, true),
        (error: unknown) => log(`${s.engine}: its transcript could not be read for its jobs (${error instanceof Error ? error.message : String(error)})`),
      ).finally(() => {
        if (s.jobs !== jobs) return;
        s.jobsTimer = setTimeout(poll, timing.jobsPollMs);
        s.jobsTimer.unref();
      });
    };
    poll();
  }

  function unfollowJobs(s: Session): void {
    if (s.jobsTimer) clearTimeout(s.jobsTimer);
    s.jobsTimer = null;
    s.jobs = null;
  }

  // Each watch that carried other jobs hears these; `running` false once the session's process is gone, which a watch
  // whose stream broke under it hears too.
  function jobsChanged(s: Session, running: boolean): void {
    if (s.jobs === null) return;
    const jobs = s.jobs.body(running);
    const key = JSON.stringify(jobs);
    for (const w of s.watches.values()) {
      if (w.reshaper === null || (running && w.stream === null) || w.jobs === key) continue;
      w.jobs = key;
      deps.emit('laneA.plane', { appSessionId: s.appId, watch: w.id, messages: [w.reshaper.jobs(jobs)] });
    }
  }

  // A stop for a job the transcript holds ended is refused; one it doesn't hold (a subagent's, say) is the bridge's to
  // judge, as sminos's `running_task` reads every loop.
  async function stopTask(appId: AppSessionId, taskId: string): Promise<ControlResult> {
    const s = liveFor(appId, 'stop');
    if (!('appId' in s)) return s;
    const launch = launchOf(s);
    const jobs = s.jobs ?? transcriptJobs(s);
    await jobs.read().catch(() => {}); // unreadable: the bridge judges
    if (jobs.body(true).some((j) => j.taskId === taskId && j.status !== 'running')) return refused('not-running', 'that background task is not running: it ended');
    return resultOf(await post(s, { op: 'stop', taskId }, launch));
  }

  // ---- the state ------------------------------------------------------------------------------------------------------
  function stateOf(s: Session): LaneAState | null {
    if (s.bridge === null || s.status === null) return null;
    const capabilities = record(s.status.capabilities);
    const controls = record(capabilities?.controls) ?? {};
    return {
      appSessionId: s.appId,
      engineSessionId: s.engine,
      bridge: s.bridge.bridge,
      reason: s.bridge.reason,
      launch: typeof s.status.launch === 'string' ? s.status.launch : null,
      sminos: typeof capabilities?.sminos === 'string' ? capabilities.sminos : null,
      ops: strings(capabilities?.ops),
      reads: strings(capabilities?.reads),
      controls: controls as LaneAState['controls'],
      ...s.fold.view(),
      deliveries: s.lane.entries(),
    };
  }

  function changed(s: Session): void {
    if (s.gone) return;
    deps.emit('laneA.changed', { appSessionId: s.appId, state: stateOf(s) });
    tell(s);
  }

  // Main's own consumers (M6), told on each change of the state, of the stream's currency or of the main loop's tool.
  function tell(s: Session): void {
    const state = stateOf(s);
    const view = state === null ? null : { state, fresh: s.stream !== null && s.snapshotted, tool: s.fold.mainTool() };
    for (const listener of listeners) listener(s.appId, view);
  }

  // ---- sessions -------------------------------------------------------------------------------------------------------
  function create(hold: SessionHold & { engineSessionId: string }): Session {
    const s: Session = {
      appId: hold.appId,
      engine: hold.engineSessionId,
      holder: JSON.stringify(hold.holder),
      socket: home === null ? { path: '', fits: false } : bridgeSocket(home, hold.engineSessionId),
      status: null,
      bridge: null,
      fold: new SessionFold(hold.engineSessionId),
      stream: null,
      snapshotted: false,
      backoff: new Backoff(timing.backoff),
      reconnect: null,
      probing: false,
      again: false,
      lane: new DeliveryLane({ writer, session: hold.engineSessionId, seqs: (seqs ??= fileSeqStore(join(deps.userData, 'lane-a', 'deliveries.json'), log)), launch: () => launchOf(s), post: (body, launch) => post(s, body, launch), changed: () => changed(s), timing: timing.lane }),
      watches: new Map(),
      modelChain: Promise.resolve(),
      jobs: null,
      jobsTimer: null,
      gone: false,
    };
    return s;
  }

  function drop(s: Session): void {
    s.gone = true;
    closeState(s);
    jobsChanged(s, false); // its holder ended: the session's process is gone
    for (const w of [...s.watches.values()]) endWatch(s, w, 'the session left the terminal');
    s.lane.close('the session left the terminal');
    sessions.delete(s.appId);
    if (s.bridge !== null) deps.emit('laneA.changed', { appSessionId: s.appId, state: null });
    for (const listener of listeners) listener(s.appId, null);
    syncDirWatch();
  }

  // ---- controls -------------------------------------------------------------------------------------------------------
  // The launch an operation is admitted under: taken once, when it is admitted, and carried by each of its posts and
  // retries, so a post after the session's process changed is refused `launch` at the child, never retargeted at the new
  // process. Null when /status named none (a local caller's, unfenced).
  const launchOf = (s: Session): string | null => (typeof s.status?.launch === 'string' ? s.status.launch : null);

  async function post(s: Session, body: Record<string, unknown>, launch: string | null): Promise<PostResult> {
    try {
      const answer = await call(s.socket.path, 'POST', `/command?wait=${timing.commandWaitMs}`, { ...body, ...(launch !== null && { launch }) }, timing.commandWaitMs + 2000);
      return { kind: 'answer', status: answer.status, body: answer.body };
    } catch (error) {
      return { kind: 'lost', why: error instanceof BridgeUnreachable ? error.why : 'gone' };
    }
  }

  function liveFor(appId: AppSessionId, op: string): Session | ControlResult {
    const s = sessions.get(appId);
    if (!s || s.bridge === null) return refused('no-bridge', NO_BRIDGE);
    if (s.bridge.bridge !== 'live') return refused('no-bridge', s.bridge.reason ?? NO_BRIDGE);
    const capabilities = record(s.status?.capabilities);
    if (!strings(capabilities?.ops).includes(op)) return refused('unsupported', `not in this session’s sminos${typeof capabilities?.sminos === 'string' ? ` (${capabilities.sminos})` : ''}`);
    return s;
  }

  function resultOf(posted: PostResult): ControlResult {
    if (posted.kind === 'lost') return { state: 'unknown', why: posted.why ?? 'gone' };
    const body = posted.body ?? {};
    const id = typeof body.id === 'string' ? body.id : undefined;
    if (posted.status === 504) return { state: 'unknown', why: 'timeout', ...(id !== undefined && { id }) };
    if (posted.status === 503) return { state: 'unknown', why: 'gone' };
    if (posted.status === 200 && body.ok === true) {
      const result = record(body.result);
      return { state: 'done', result: result !== null && id !== undefined && result.id === undefined ? { ...result, id } : (body.result ?? null) };
    }
    const code = typeof body.code === 'string' ? body.code : posted.status === 200 ? 'refused' : posted.status === 400 ? 'bad-args' : `http-${posted.status}`;
    return refused(code, typeof body.error === 'string' ? body.error : `the bridge answered ${posted.status}`);
  }

  async function control(appId: AppSessionId, op: string, body: Record<string, unknown> = {}): Promise<ControlResult> {
    const s = liveFor(appId, op);
    if (!('appId' in s)) return s;
    return resultOf(await post(s, { op, ...body }, launchOf(s)));
  }

  const notPending = (settled: Record<string, unknown> | null, message: string, terminalOnly?: boolean): LaneAAnswerOutput => ({
    outcome: 'not_pending',
    settled,
    ...(terminalOnly === true && { terminalOnly: true }),
    message,
  });

  async function answer(appId: AppSessionId, request: string, given: RequestAnswer): Promise<LaneAAnswerOutput> {
    const s = sessions.get(appId);
    if (!s || s.bridge?.bridge !== 'live') return { outcome: 'refused', code: 'no-bridge', message: s?.bridge?.reason ?? NO_BRIDGE };
    const launch = launchOf(s);
    const path = `/requests/${encodeURIComponent(request)}`;
    let current: BridgeAnswer;
    try {
      current = await call(s.socket.path, 'GET', path, undefined, timing.requestMs);
    } catch {
      return { outcome: 'refused', code: 'no-bridge', message: 'the session’s bridge did not answer; nothing was sent' };
    }
    if (current.status === 410 || current.status === 404) {
      const settled = record(current.body?.settled) ?? s.fold.settledOf(request);
      return notPending(settled, settled ? `already answered: ${String(settled.outcome)} by ${String(settled.by)}` : 'it is no longer pending');
    }
    if (current.status !== 200 || current.body === null) return { outcome: 'refused', code: 'failed', message: `the bridge answered ${current.status} for the request` };
    const controls = (record(record(s.status?.capabilities)?.controls) ?? {}) as Record<string, { available: boolean; reason?: string }>;
    const decision = await decisionFor({ current: current.body, held: s.fold.raised(request), answer: given, controls });
    if (!decision.ok) return { outcome: 'refused', code: decision.code, message: decision.message };
    let posted: BridgeAnswer;
    try {
      posted = await call(s.socket.path, 'POST', `${path}/decision`, { ...decision.body, by: 'maws', ...(launch !== null && { launch }) }, timing.decisionMs);
    } catch (error) {
      return { outcome: 'unknown', why: error instanceof BridgeUnreachable ? error.why : 'gone' };
    }
    const body = posted.body ?? {};
    const message = typeof body.error === 'string' ? body.error : `the bridge answered ${posted.status}`;
    if (posted.status === 200) return { outcome: 'delivered' };
    if (posted.status === 409 && (body.code === 'launch' || body.code === 'lane-b')) return { outcome: 'refused', code: body.code, message };
    if (posted.status === 409) {
      // another answer won: its settlement, as the child names it (or follows)
      const settled = record(body.settled) ?? (typeof body.winner === 'string' || typeof body.by === 'string' ? { ...(typeof body.winner === 'string' && { winner: body.winner }), ...(typeof body.by === 'string' && { by: body.by }) } : null);
      return notPending(settled, message, body.terminalOnly === true);
    }
    if (posted.status === 404) return notPending(s.fold.settledOf(request), message);
    // An async question's answer is relayed to the mod as an `answer` command, whose wait can run out after it went: the
    // answer may have been taken.
    if (posted.status === 504) return { outcome: 'unknown', why: 'timeout' };
    if (posted.status === 503) return { outcome: 'unknown', why: 'gone' };
    return { outcome: 'refused', code: posted.status === 400 ? 'bad-args' : 'failed', message };
  }

  function model(appId: AppSessionId, change: { model?: string | null; effort?: string | null }): Promise<ControlResult> {
    const s = liveFor(appId, 'model');
    if (!('appId' in s)) return Promise.resolve(s);
    const launch = launchOf(s);
    // One change at a time per session; the field not being changed is read fresh under that lock and sent as read, since
    // the bridge's `model` op replaces both and a change made in the terminal meanwhile must not be undone.
    const run = async (): Promise<ControlResult> => {
      const read = await post(s, { op: 'read', what: 'status' }, launch);
      const result = read.kind === 'answer' && read.status === 200 && read.body?.ok === true ? record(read.body.result) : null;
      if (result === null) return refused('read-failed', 'the session’s model and effort could not be read, so neither was changed');
      const now = record(result.override);
      const current = { model: typeof now?.model === 'string' ? now.model : null, effort: typeof now?.effort === 'string' ? now.effort : null };
      return resultOf(await post(s, {
        op: 'model',
        model: change.model !== undefined ? change.model : current.model,
        effort: change.effort !== undefined ? change.effort : current.effort,
      }, launch));
    };
    const next = s.modelChain.then(run, run);
    s.modelChain = next.catch(() => {});
    return next;
  }

  async function read(appId: AppSessionId, kind: ReadKind, args?: Record<string, unknown>): Promise<ReadOutput> {
    if (kind === 'rows' || kind === 'diff' || kind === 'output') return { ok: false, code: 'unsupported', message: 'a local session’s rows, diff and output come from this machine’s own readers' };
    const s = liveFor(appId, 'read');
    if (!('appId' in s)) return { ok: false, code: s.state === 'refused' && s.code === 'unsupported' ? 'unsupported' : 'no-bridge', message: s.state === 'refused' ? s.message : NO_BRIDGE };
    const reads = strings(record(s.status?.capabilities)?.reads);
    if (!reads.includes(kind)) return { ok: false, code: 'unsupported', message: `this session’s bridge serves no ${kind} read` };
    const posted = await post(s, { op: 'read', what: kind, ...(args !== undefined && { args }) }, launchOf(s));
    if (posted.kind === 'lost') return { ok: false, code: posted.why === 'timeout' ? 'timeout' : 'failed', message: 'the session’s bridge did not answer' };
    if (posted.status === 504) return { ok: false, code: 'timeout', message: 'the session did not answer in time' };
    if (posted.status === 200 && posted.body?.ok === true) return { ok: true, result: posted.body.result ?? null };
    return { ok: false, code: 'failed', message: typeof posted.body?.error === 'string' ? posted.body.error : `the bridge answered ${posted.status}` };
  }

  return {
    observe(hold) {
      if (stopped) return;
      const foreign = hold.engineSessionId !== null && (hold.holder.kind === 'terminal' || hold.holder.kind === 'background_job');
      const s = sessions.get(hold.appId);
      if (!foreign) {
        if (s) drop(s);
        return;
      }
      if (s && s.engine === hold.engineSessionId) {
        const holder = JSON.stringify(hold.holder);
        if (holder !== s.holder) {
          s.holder = holder; // another process holds it now: its bridge is another child
          void probe(s);
        }
        return;
      }
      if (s) drop(s); // a new engine id is a new transcript: nothing follows one into the other
      const fresh = create(hold as SessionHold & { engineSessionId: string });
      sessions.set(hold.appId, fresh);
      syncDirWatch();
      void probe(fresh);
    },
    forget(appId) {
      const s = sessions.get(appId);
      if (s) drop(s);
    },
    list: () => [...sessions.values()].map(stateOf).filter((state): state is LaneAState => state !== null),
    state: (appId) => {
      const s = sessions.get(appId);
      return s ? stateOf(s) : null;
    },
    catalog: (appId) => {
      const s = sessions.get(appId);
      return s && s.bridge !== null ? s.fold.catalogBody() : null;
    },
    watch(appId, client) {
      const s = sessions.get(appId);
      if (!s || (s.bridge?.bridge !== 'live' && s.bridge?.bridge !== 'starting')) throw new Error(`${appId}: ${s?.bridge?.reason ?? NO_BRIDGE}`);
      const w: Watch = { id: randomUUID(), stream: null, reshaper: null, backoff: new Backoff(timing.backoff), timer: null, offGone: () => {}, ended: false, jobs: null };
      s.watches.set(w.id, w);
      followJobs(s);
      w.offGone = client.onGone(() => endWatch(s, w, null));
      if (!w.ended) openWatch(s, w);
      return { watch: w.id };
    },
    unwatch(appId, watch) {
      const s = sessions.get(appId);
      const w = s?.watches.get(watch);
      if (s && w) endWatch(s, w, null);
    },
    read,
    async send(appId, text) {
      if (text.startsWith('/')) return { key: null, state: 'refused', reason: 'a slash command goes as a command, not as words', code: 'bad-args' };
      const s = liveFor(appId, 'deliver');
      if (!('appId' in s)) return { key: null, state: 'refused', reason: s.state === 'refused' ? s.message : NO_BRIDGE, code: s.state === 'refused' ? s.code : 'no-bridge' };
      return s.lane.send(text);
    },
    interrupt: (appId) => control(appId, 'interrupt'),
    answer,
    model,
    command: (appId, name, args) => control(appId, 'command', { name, args }),
    btw: (appId, prompt) => control(appId, 'btw', { prompt }),
    compact: (appId, instructions) => control(appId, 'compact', instructions === undefined ? {} : { instructions }),
    stopAgent: (appId, agentId) => control(appId, 'stop-agent', { agentId }),
    tell: (appId, agentId, text) => control(appId, 'tell', { agentId, text }),
    stopTask,
    async media(appId, files) {
      const s = liveFor(appId, 'media');
      if (!('appId' in s)) return s;
      const given = record(record(record(s.status?.capabilities)?.controls)?.media);
      if (given?.available !== true) return refused('unsupported', typeof given?.reason === 'string' ? given.reason : 'this session’s bridge takes no images or PDFs');
      git ??= createGitRunner();
      return sendMedia({ session: s.engine, launch: launchOf(s), post: (body, launch) => post(s, body, launch), records: uploads, git, retryDelaysMs: timing.lane.retryDelaysMs, log }, files);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    stop() {
      stopped = true;
      clearInterval(sweeper);
      for (const s of [...sessions.values()]) drop(s);
      dirWatch?.close();
      dirWatch = null;
    },
  };
}

type LaneACommand = Extract<CommandName, `laneA.${string}`>;
type Register = <N extends LaneACommand>(name: N, handler: MainHandler<N>) => void;

// `laneA.*`'s handlers in main, over the driver. Main handles bare ids (the router lowers addresses).
export function registerLaneA(driver: LaneADriver, register: Register): void {
  const id = (appSessionId: string) => appSessionId as AppSessionId;
  register('laneA.list', () => ({ states: driver.list() }));
  register('laneA.state', ({ appSessionId }) => driver.state(id(appSessionId)));
  register('laneA.watch', ({ appSessionId }, ctx) => driver.watch(id(appSessionId), ctx.client));
  register('laneA.unwatch', ({ appSessionId, watch }) => driver.unwatch(id(appSessionId), watch));
  register('laneA.catalog', ({ appSessionId }) => driver.catalog(id(appSessionId)));
  register('laneA.read', ({ appSessionId, kind, args }) => driver.read(id(appSessionId), kind, args));
  register('laneA.send', ({ appSessionId, text }) => driver.send(id(appSessionId), text));
  register('laneA.interrupt', ({ appSessionId }) => driver.interrupt(id(appSessionId)));
  register('laneA.answer', ({ appSessionId, request, answer }) => driver.answer(id(appSessionId), request, answer as RequestAnswer)) // validated: the schema's output;
  register('laneA.model', ({ appSessionId, model, effort }) => driver.model(id(appSessionId), { ...(model !== undefined && { model }), ...(effort !== undefined && { effort }) }));
  register('laneA.command', ({ appSessionId, name, args }) => driver.command(id(appSessionId), name, args));
  register('laneA.btw', ({ appSessionId, prompt }) => driver.btw(id(appSessionId), prompt));
  register('laneA.compact', ({ appSessionId, instructions }) => driver.compact(id(appSessionId), instructions));
  register('laneA.stopAgent', ({ appSessionId, agentId }) => driver.stopAgent(id(appSessionId), agentId));
  register('laneA.tell', ({ appSessionId, agentId, text }) => driver.tell(id(appSessionId), agentId, text));
  register('laneA.stopTask', ({ appSessionId, taskId }) => driver.stopTask(id(appSessionId), taskId));
  register('laneA.media', ({ appSessionId, files }) => driver.media(id(appSessionId), files));
}

