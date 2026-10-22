// The desk's latency instrument (desk ticket #57): every hop between a session and the web that the frames already
// carry a timestamp for, measured always and shown only when asked. Each path keeps its last `RING` samples in a ring
// buffer (no allocation per sample), counters keep the reconnects, and nothing is drawn or logged until the readout is
// on: `localStorage['desk.latency'] = '1'` or a `?latency` query, read at load. Then each sample is logged as one
// `console.info('[desk latency] <path> <ms>')` line and a small overlay lists each path's n, p50, p95 and max
// (`LatencyOverlay.tsx`). `window.deskLatency()` returns the same numbers for a scripted read, on or off.
//
// A measurement run joins samples to its own repetitions and to the machine's log, so the last `LOG` samples of every path
// are also kept raw, each with the wall-clock time it was taken (`at`, ms since the epoch) and, where the hop has one, the
// id that names its item on the other side (`ref`: a send's or an RPC's nonce, a request, a session):
// `window.deskLatency.samples(since)` returns those taken after `since`, oldest first (spikes/desk-latency reads them).
//
// Two clocks. A path within the browser is timed on `performance.now()`. A path that starts on another clock — the Mac's
// engine timestamp on a row, the machine's `ts` on a log event, the bridge's `t` on a chunk — is timed as the browser's
// `Date.now()` less that stamp, so it carries the skew between the two clocks; its label says so ("cross-clock").
//
// "Drawn" is the next animation frame after the store the view reads has applied the change: React commits a store's
// update before the frame, and the frame is the one that paints it. Samples that wait for a frame are batched into one
// frame callback. A hidden page paints nothing and its browser suspends the frames while rows and chunks keep coming, so
// nothing waits for a frame while the page is hidden, and at most `PENDING` samples wait for any one frame.

/** How many samples each path keeps: its last ones. */
export const RING = 200;

/** Every path the instrument measures, with what its numbers mean. */
export const PATHS = {
  'owner.ack': 'owner message: sent → human-ack (web↔hub)',
  'owner.delivered': 'owner message: sent → delivered outcome in (web→hub→machine→session, and back)',
  'owner.row': 'owner message: sent → its row in the transcript (cross-clock: browser → Mac engine timestamp)',
  'session.message': "session's message or question: logged → drawn (cross-clock: machine ts → browser)",
  'request.drawn': 'permission prompt or question: raised in → drawn (web)',
  'request.row': "permission prompt or question: its call's row → drawn (cross-clock: Mac engine timestamp → browser)",
  'view.snapshot': 'session view: subscribe sent → snapshot in (web↔hub↔machine)',
  'view.drawn': 'session view: snapshot in → first rows drawn (web)',
  'view.first-rows': 'session view: subscribe sent → first rows drawn',
  'stream.chunk': 'streaming chunk: bridge stamp → drawn (cross-clock: Mac → browser)',
  'stream.row': 'live row: engine timestamp → drawn (cross-clock: Mac → browser)',
  'resume.gap': 'subscription resume: disruption → fresh snapshot merged',
  'view.older-page': 'session view: an older page asked → its rows in (web↔hub↔machine)',
  'app.me': 'cold load: navigation start → /api/me answered, the desk drawn (web↔hub)',
  'app.key': "cold load: navigation start → the device's org key read and held, unlocked (web)",
  'app.grid': "cold load: navigation start → the grid drawn with the hub's counts (web)",
  'grid.socket': 'grid socket: connecting → the whole grid in (web↔hub)',
  'project.caught-up': "project opened: its log read and socket started → the hub's backlog caught up and verified, drawn (web↔hub)",
  'socket.gap': 'project socket: dropped → welcomed, caught up again and verified, drawn (web↔hub)',
  'wake.caught-up': 'tab shown again → caught up and verified after the reconnect that followed, drawn (web↔hub)',
  'online.caught-up': 'browser back online → caught up and verified after the reconnect that followed, drawn (web↔hub)',
  'rpc.steer': 'steer: sent → its result in (web→hub→machine→session, and back)',
  'rpc.interrupt': 'interrupt: sent → its result in (web→hub→machine→session, and back)',
  'rpc.decide': 'allow or deny: sent → its result in (web→hub→machine→session, and back)',
  'rpc.answer': 'answer: sent → its result in (web→hub→machine→session, and back)',
  'rpc.spawn': 'spawn: sent → its result in (web→hub→machine, and back)',
  'rpc.resume': 'resume: sent → its result in (web→hub→machine, and back)',
  // The desk control surface (its spec, §12): budgets B.read, B.op, B.ran, B.readback.
  'palette.open': 'slash keystroke → palette drawn (local, budget 50 ms)',
  'catalog.ready': 'subscribe sent → catalog usable, cache or snapshot (B.catalog)',
  'read.catalog': 'catalog read: sent → answer in (B.read)',
  'read.status': 'status read: read sent → its answer in (web↔hub↔machine↔bridge)',
  'op.queued': 'command: RPC sent → queued (web↔hub↔machine↔bridge)',
  'op.ran': 'command: RPC sent → its op end in, the session idle when sent',
  'op.ran.busy': 'command: RPC sent → its op end in, sent mid-turn: it waited for the turn (kept apart from op.ran)',
  'op.readback': 'command: RPC sent → its readback drawn',
} as const;
export type LatencyPath = keyof typeof PATHS;
const PATH_NAMES = Object.keys(PATHS) as LatencyPath[];
const PATH_INDEX = new Map(PATH_NAMES.map((path, i) => [path, i]));

/** How many raw samples are kept across every path (`samples`): the latest ones. */
export const LOG = 1000;

/** One raw sample: its path, its ms, when it was taken (ms since the epoch), and the id of what it timed, where it has one. */
export type Sample = { path: LatencyPath; ms: number; at: number; ref?: string };

/** How long after the tab is shown again (or the browser is back online) a reconnect counts as the one that return needed. */
export const RETURN_WINDOW_MS = 60_000;

/** Every count the instrument keeps. */
export const COUNTS = {
  'socket.reconnects': "the project socket welcomed again after a drop",
  'subscription.resumes': 'a transcript subscription resumed from a fresh snapshot after a disruption',
} as const;
export type LatencyCount = keyof typeof COUNTS;

export type PathStats = { label: string; n: number; p50: number; p95: number; max: number };
export type LatencyReport = { on: boolean; paths: Partial<Record<LatencyPath, PathStats>>; counts: Partial<Record<LatencyCount, number>> };

/** The value at percentile `p` (0–100) of ascending `sorted`, by nearest rank; NaN when empty. */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** A path's last `RING` samples. */
class Ring {
  private readonly samples = new Float64Array(RING);
  private next = 0;
  size = 0;

  push(ms: number): void {
    this.samples[this.next] = ms;
    this.next = (this.next + 1) % RING;
    this.size = Math.min(RING, this.size + 1);
  }

  /** The samples held, ascending (a copy: read only when asked). */
  sorted(): Float64Array {
    return this.samples.slice(0, this.size).sort();
  }
}

/** An owner's send's event, once the hub stored it: what a delivery frame names it by. */
export type SendRef = { writer: string; seq: number; wake: boolean };

/** An owner's send, from its sending until its row, delivery and acknowledgement are measured. */
type Send = { nonce: string; sentPerf: number; sentWall: number; wake: boolean; ref: SendRef | null; delivered: boolean; row: boolean };

/** How many sends, calls and awaited draws are remembered at most: older ones are forgotten unmeasured. */
const REMEMBERED = 64;

/** How many samples wait for one frame at most: those past it are not taken. */
export const PENDING = 512;

const now = () => performance.now();
/** The page is hidden (a background tab): nothing it draws is painted. Under Node there is no page. */
const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
const nextFrame = (callback: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : setTimeout(callback, 0));

export class LatencyRecorder {
  /** The readout is on: each sample is logged and the overlay is told. */
  on = false;
  private readonly rings = new Map<LatencyPath, Ring>();
  private readonly counts = new Map<LatencyCount, number>();
  private readonly listeners = new Set<() => void>();
  /** Samples waiting for the next frame: their paths, their starts, which clock each start is on, and their refs. */
  private readonly framePaths: LatencyPath[] = [];
  private readonly frameStarts: number[] = [];
  private readonly frameWall: boolean[] = [];
  private readonly frameRefs: Array<string | undefined> = [];
  private frameAsked = false;
  /** The last `LOG` samples of every path, raw: a ring of their paths (by index), ms, wall-clock times and refs. */
  private readonly rawPath = new Uint8Array(LOG);
  private readonly rawMs = new Float64Array(LOG);
  private readonly rawAt = new Float64Array(LOG);
  private readonly rawRef: Array<string | undefined> = new Array<string | undefined>(LOG);
  private rawNext = 0;
  private rawSize = 0;
  /** The owner's sends by nonce, then by their event once acknowledged. */
  private readonly sends = new Map<string, Send>();
  /** When each tool call's row was written (its engine timestamp, ms), by tool-use id: a raised request's anchor. */
  private readonly calls = new Map<string, number>();
  /** The RPCs sent and not answered yet, by nonce: the path each is timed on and when it was sent. */
  private readonly rpcs = new Map<string, { path: LatencyPath; sent: number }>();
  /**
   * The commands sent from this tab, by their RPC's nonce: when, whether the session was mid-turn then, and which of
   * their moments (queued, ended, drawn) are timed already — they may come in any order.
   */
  private readonly commands = new Map<string, { sent: number; busy: boolean; queued: boolean; ended: boolean; drawn: boolean }>();

  constructor(private readonly log: (line: string) => void = (line) => console.info(line)) {}

  /** One sample of `path`, `ref` naming what it timed; a non-finite one (a stamp absent or unparseable) is not kept. */
  record(path: LatencyPath, ms: number, ref?: string): void {
    if (!Number.isFinite(ms)) return;
    let ring = this.rings.get(path);
    if (!ring) this.rings.set(path, (ring = new Ring()));
    ring.push(ms);
    const at = this.rawNext;
    this.rawPath[at] = PATH_INDEX.get(path)!;
    this.rawMs[at] = ms;
    this.rawAt[at] = Date.now();
    this.rawRef[at] = ref;
    this.rawNext = (at + 1) % LOG;
    this.rawSize = Math.min(LOG, this.rawSize + 1);
    if (!this.on) return;
    this.log(`[desk latency] ${path} ${Math.round(ms)}`);
    this.changed();
  }

  /**
   * Records `path` at the next frame, from `start` on the browser's clock (`performance.now()`), or on the wall clock
   * (`Date.now()`) when `wall`; not while the page is hidden, nor past the `PENDING` samples already waiting for it.
   */
  drawn(path: LatencyPath, start: number, wall = false, ref?: string): void {
    if (!Number.isFinite(start) || hidden() || this.framePaths.length >= PENDING) return;
    this.framePaths.push(path);
    this.frameStarts.push(start);
    this.frameWall.push(wall);
    this.frameRefs.push(ref);
    if (this.frameAsked) return;
    this.frameAsked = true;
    nextFrame(() => {
      this.frameAsked = false;
      const perf = now();
      const wallNow = Date.now();
      for (let i = 0; i < this.framePaths.length; i++) this.record(this.framePaths[i], (this.frameWall[i] ? wallNow : perf) - this.frameStarts[i], this.frameRefs[i]);
      this.framePaths.length = 0;
      this.frameStarts.length = 0;
      this.frameWall.length = 0;
      this.frameRefs.length = 0;
    });
  }

  count(name: LatencyCount): void {
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
    if (this.on) this.changed();
  }

  // The owner's message: sent, acknowledged, delivered, and its row.

  /** A web `human` handed to the socket (or held for it), by its seal's nonce. */
  humanSent(nonce: string, wake: boolean): void {
    this.sends.set(nonce, { nonce, sentPerf: now(), sentWall: Date.now(), wake, ref: null, delivered: false, row: false });
    this.forgetOldest(this.sends);
  }

  /** The hub stored it as event `(writer, seq)`. */
  humanAcked(nonce: string, event: { writer: string; seq: number }): void {
    const send = this.sends.get(nonce);
    if (!send) return;
    this.record('owner.ack', now() - send.sentPerf, nonce);
    send.ref = { writer: event.writer, seq: event.seq, wake: send.wake };
  }

  /** A delivery outcome came in: the first `delivered` of an owner's send is its delivery. */
  delivery(event: { writer: string; seq: number }, outcome: string): void {
    if (outcome !== 'delivered') return;
    const send = this.sendOf(event);
    if (!send || send.delivered) return;
    send.delivered = true;
    this.record('owner.delivered', now() - send.sentPerf, send.nonce);
    this.done(send);
  }

  /** The owner's sends acknowledged and not yet found in a transcript: `matches` says whether a row is one's delivery. */
  ownerRow(matches: (ref: SendRef) => boolean, timestamp: unknown): void {
    for (const send of this.sends.values()) {
      if (send.ref === null || send.row || !matches(send.ref)) continue;
      send.row = true;
      this.record('owner.row', parseTime(timestamp) - send.sentWall, send.nonce);
      this.done(send);
      return;
    }
  }

  // An RPC: sent, and its result.

  /** An RPC was sent, by its nonce: timed until its result when its name has a path (`rpc.<name>`). */
  rpcSent(nonce: string, name: string): void {
    const path = `rpc.${name}`;
    if (!(path in PATHS) || this.rpcs.has(nonce)) return; // a retry keeps the first send's time
    this.rpcs.set(nonce, { path: path as LatencyPath, sent: now() });
    this.forgetOldest(this.rpcs);
  }

  /** The hub reported an RPC's state: `done` is its result (a failure is not a latency, and `forwarded` not its end). */
  rpcState(nonce: string, state: string): void {
    const rpc = this.rpcs.get(nonce);
    if (!rpc || (state !== 'done' && state !== 'failed')) return;
    this.rpcs.delete(nonce);
    if (state === 'done') this.record(rpc.path, now() - rpc.sent, nonce);
  }

  // A read's answer, and a command's three moments.

  /** A read answered after `ms`: its kind's path, when the instrument has one (`read.status`). */
  readAnswered(what: string, ms: number): void {
    const path = `read.${what}`;
    if (path in PATHS) this.record(path as LatencyPath, ms);
  }

  /** A command RPC sent, by its nonce; `busy`: a turn was running, so its end waits for the turn. */
  commandSent(nonce: string, busy: boolean): void {
    this.commands.set(nonce, { sent: now(), busy, queued: false, ended: false, drawn: false });
    this.forgetOldest(this.commands);
  }

  /** Its RPC answered `queued` (the hub's `rpc-state` done), which may come after its `op` end: each moment once. */
  commandQueued(nonce: string): void {
    const command = this.commands.get(nonce);
    if (!command || command.queued) return;
    command.queued = true;
    this.record('op.queued', now() - command.sent, nonce);
    this.settleCommand(nonce, command);
  }

  /** Its `op` end came in: ran, kept apart when sent mid-turn. */
  commandEnded(nonce: string): void {
    const command = this.commands.get(nonce);
    if (!command || command.ended) return;
    command.ended = true;
    this.record(command.busy ? 'op.ran.busy' : 'op.ran', now() - command.sent, nonce);
  }

  /**
   * Its outcome was committed to the page (`CommandStatus`): the readback is timed at the next frame. An outcome no
   * view draws (its status line taken by a later command, the session left) gives no sample.
   */
  commandDrawn(nonce: string): void {
    const command = this.commands.get(nonce);
    if (!command || command.drawn) return;
    command.drawn = true;
    this.drawn('op.readback', command.sent, false, nonce);
    this.settleCommand(nonce, command);
  }

  /** A command whose every moment is timed is forgotten; one never drawn ages out with the oldest. */
  private settleCommand(nonce: string, command: { queued: boolean; drawn: boolean }): void {
    if (command.queued && command.drawn) this.commands.delete(nonce);
  }

  // A raised request's anchor.

  /** A tool call's row is held: when it was written, for the request it may raise. */
  noteCall(toolUseId: string, timestamp: unknown): void {
    const at = parseTime(timestamp);
    if (!Number.isFinite(at) || this.calls.has(toolUseId)) return;
    this.calls.set(toolUseId, at);
    this.forgetOldest(this.calls);
  }

  /** When the call `toolUseId` was written, if a transcript held its row. */
  callAt(toolUseId: string): number | undefined {
    return this.calls.get(toolUseId);
  }

  // Reading.

  report(): LatencyReport {
    const paths: LatencyReport['paths'] = {};
    for (const [path, ring] of this.rings) {
      const sorted = ring.sorted();
      paths[path] = { label: PATHS[path], n: sorted.length, p50: round(percentile(sorted, 50)), p95: round(percentile(sorted, 95)), max: round(sorted[sorted.length - 1]) };
    }
    return { on: this.on, paths, counts: Object.fromEntries(this.counts) };
  }

  /** The raw samples taken after `since` (ms since the epoch), oldest first: at most the last `LOG`. */
  samples(since = Number.NEGATIVE_INFINITY): Sample[] {
    const out: Sample[] = [];
    for (let i = 0; i < this.rawSize; i++) {
      const at = (this.rawNext - this.rawSize + i + LOG) % LOG;
      if (!(this.rawAt[at] > since)) continue;
      const ref = this.rawRef[at];
      out.push({ path: PATH_NAMES[this.rawPath[at]], ms: this.rawMs[at], at: this.rawAt[at], ...(ref !== undefined && { ref }) });
    }
    return out;
  }

  /** Called after each sample while the readout is on. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  private sendOf(event: { writer: string; seq: number }): Send | undefined {
    for (const send of this.sends.values()) if (send.ref?.writer === event.writer && send.ref.seq === event.seq) return send;
    return undefined;
  }

  private done(send: Send): void {
    if (!send.delivered || !send.row) return;
    for (const [nonce, held] of this.sends) if (held === send) this.sends.delete(nonce);
  }

  private forgetOldest(map: Map<string, unknown>): void {
    while (map.size > REMEMBERED) map.delete(map.keys().next().value!);
  }
}

const parseTime = (value: unknown): number => (typeof value === 'string' ? Date.parse(value) : typeof value === 'number' ? value : Number.NaN);
const round = (ms: number) => Math.round(ms * 10) / 10;

/** Whether the readout was asked for: `localStorage['desk.latency'] = '1'`, or `?latency` in the address. */
export function latencyAsked(): boolean {
  try {
    return localStorage.getItem('desk.latency') === '1' || new URLSearchParams(location.search).has('latency');
  } catch {
    return false;
  }
}

/** The desk's one instrument, which every hop records into. */
export const latency = new LatencyRecorder();

/** What scripts read: `window.deskLatency()`, the report, and `window.deskLatency.samples(since)`, the raw samples. */
export type DeskLatency = (() => LatencyReport) & { samples: (since?: number) => Sample[] };

/** Turns the readout on when asked, and gives scripts `window.deskLatency()`. */
export function installLatency(): void {
  latency.on = latencyAsked();
  (window as unknown as { deskLatency: DeskLatency }).deskLatency = Object.assign(() => latency.report(), { samples: (since?: number) => latency.samples(since) });
}
