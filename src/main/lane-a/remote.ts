// Remote lane A (P5 O9 M9, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, M9 and Interfaces §A, §C, §D): `laneA.*`
// for a terminal session on another machine, carried over that machine's RL2 link (O7's `RemoteLink`, reached only
// through `Machines.remote(ref)`). The renderer's inputs and outputs are the local driver's; only this adapter knows the
// wire. It opens no channel (O7's boundary.test.ts): every byte goes through the link's `subscribe`, `call` and `act`.
//
// The composition root wraps the router's `remote` option (`routeLaneA`): a `laneA.*` command whose target machine
// `Machines.remote` answers comes here, with its link; every other command, and `laneA.*` for a socket-linked stand-in,
// takes the connection manager's path as before. A remote session's bare id is its engine session id (§G, R1).
//
// - The view. Each `laneA.watch` is its own `full` subscription; its snapshot (the envelope, joined and parsed by the
//   link) and its DX4 messages go out as `laneA.plane` under the watch's id, each once (the link resumes by cursor across
//   drops, sleep and a carrier switch). `paused` and `resumed` pass through and are no discontinuity. A `snapshot` or
//   `missing` subscription after the first, an `omitted` message (the subscription is opened afresh), or a fresh
//   subscription after the endpoint ended one is a reset: `{reset: true}`, then that snapshot. An `ended` is retried with
//   backoff from 1 s doubling to 30 s, announced as `paused` until the fresh snapshot, then `resumed`; only the link's own
//   close ends the watch (`{ended}`). The page's end (`clientGone`) ends its watches.
// - The state. A remote session's `LaneAState` exists while a page watches it, from its oldest watch's subscription
//   (./remote-state.ts), and `laneA.changed` follows it; the last watch's end sends `state: null`. `laneA.list` for the
//   machine answers the states of the sessions watched there. The override and the mode the session reported (sminos
//   1.27.14) are hydrated by `read status` at each watch, after each model change's outcome, and at a main-loop step-end
//   at most once per 10 s. The state carries the link (`link`: its state, this device's member, class and machine rights
//   from `caps`, and the reason no control acts, if so), refreshed at each `caps` and link state change; while that
//   reason stands every act is refused with it here. It also carries each control's act in flight (`acts`) with the
//   link's progress, until its outcome.
// - Reads name the watch's subscription (`input.sub`). `rows`, `diff` and `output` answer `{requested: true}` and arrive
//   as plane messages of their kind; one of each kind is outstanding per watch, a second waiting for the first's answer,
//   the watch's reset or 10 s. Every other read carries an id minted here and is answered by that id's `read` message
//   within 10 s.
// - Acts are built here from typed fields (Interfaces §D) and sealed by the link: `sminos.<rpc>` with the session's
//   lane A context and the launch from the plane's presence; an answer or a decision carries DX6's request digest over
//   the raised input. Step-up is the link's `'if-asked'`. The outcome (which never rejects) maps to the port's results.
// - Sends are `sminos.send` in either turn state, one in flight per session: the next act is created only once the one
//   before it has its outcome (sminos runs each RPC on its own worker, so two accepted sends could reach the bridge in
//   either order). At most 8 wait. A send's fate is its outcome; `laneA.send` answers at it or at 5 s, and the fate
//   follows in `LaneAState.deliveries` under a key minted here (nothing on the wire names it). The lane is the session's,
//   not a watch's: a session whose last watch ended stays held while a send or an act is still out, so a reopen finds
//   the same lane.
// - The gaps: `stopTask` and `media` are refused `unsupported` with their reasons (`stop` isn't offered remotely, P5
//   Decision Log 51; uploads across machines are O7's).
import { randomUUID } from 'node:crypto';
import { inputSha256, type JsonValue } from 'desk-hub/protocol';
import type { RequestAnswer } from '@shared/engine/answers';
import type { AppSessionId } from '@shared/graph/ids';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName, CommandResult, EventName, EventPayload } from '@shared/ipc/schema';
import type { ControlResult, DeliveryKey, LaneAAct, LaneAAnswerOutput, LaneADelivery, LaneASendOutput, LaneAState, PlaneMessage } from '@shared/ipc/schema/lane-a';
import { validateCommandOutput } from '@shared/ipc/validate';
import { answerIntent, suggestionSha256 } from '@shared/lane-a/answers';
import { modeOf } from '@shared/lane-a/mode';
import type { MachineRef } from '@shared/machine/ref';
import type { MainContext, RemoteDispatch } from '../ipc/router';
import type { ActOutcome, ActRequest, RemoteLink, Subscription } from '../machines/remote/link';
import { controlOf, linkView, sendFate } from './remote-outcomes';
import { NO_BRIDGE, RemoteFold, type StatusRead } from './remote-state';

export type LaneACommand = Extract<CommandName, `laneA.${string}`>;
type LaneAEvent = Extract<EventName, `laneA.${string}`>;
type ReadKind = 'usage' | 'config' | 'settings' | 'mcp' | 'status' | 'rows' | 'diff' | 'output';
type ReadOutput = { ok: true; result: unknown } | { ok: false; code: 'no-bridge' | 'unsupported' | 'timeout' | 'busy' | 'failed'; message: string };
type Fields = Record<string, unknown>;

export interface RemoteLaneATiming {
  sendAnswerMs: number; // laneA.send answers by then with the send's state
  deliveryKeptMs: number; // a settled send stays in `deliveries`
  sendQueueMax: number;
  readMs: number; // a read's answer, and a rows, diff or output request's hold on its kind
  hydrateEveryMs: number; // `read status` at a main-loop step-end, at most this often
  backoffMs: readonly [number, number]; // a fresh subscription after `ended`: from, doubling to
  deadlineSlackMs: number; // a background request's window, less this, is the terminal's
}

export const REMOTE_LANE_A_TIMING: RemoteLaneATiming = {
  sendAnswerMs: 5000,
  deliveryKeptMs: 60_000,
  sendQueueMax: 8,
  readMs: 10_000,
  hydrateEveryMs: 10_000,
  backoffMs: [1000, 30_000],
  deadlineSlackMs: 200,
};

export interface RemoteLaneADeps {
  local: MachineRef; // this app's machine: the writer of the keys `deliveries` names its sends by
  emit<N extends LaneAEvent>(machine: MachineRef, name: N, payload: EventPayload<N>): void; // emitFrom
  timing?: Partial<RemoteLaneATiming>;
  now?(): number;
  log(line: string): void;
}

export interface RemoteLaneA {
  dispatch(link: RemoteLink, name: LaneACommand, input: unknown, ctx: MainContext): Promise<CommandResult<CommandName>>;
  stop(): void;
}

/** The router's `remote` with `laneA.*` for an RL2 machine taken by the adapter; everything else goes to `base`. */
export function routeLaneA(base: RemoteDispatch, remote: (machine: MachineRef) => RemoteLink | null, laneA: RemoteLaneA): RemoteDispatch {
  return (machine, name, input, ctx) => {
    const link = name.startsWith('laneA.') ? remote(machine) : null;
    return link === null ? base(machine, name, input, ctx) : laneA.dispatch(link, name as LaneACommand, input, ctx);
  };
}

type Watch = {
  id: string;
  fold: RemoteFold;
  sub: Subscription | null;
  token: object; // the current subscription's: a callback of an earlier one is ignored
  started: boolean; // a snapshot came: a later `snapshot` or `missing` start is a reset
  paused: boolean;
  backoffMs: number;
  retry: ReturnType<typeof setTimeout> | null;
  offGone: () => void;
  requests: Map<string, { busy: boolean; waiting: Array<() => void>; timer: ReturnType<typeof setTimeout> | null }>;
  reads: Map<string, (answer: ReadOutput) => void>;
  ended: boolean;
};
type Delivery = LaneADelivery & { settledAt?: number };
type Send = { key: DeliveryKey; text: string; answer: ((output: LaneASendOutput) => void) | null; timer: ReturnType<typeof setTimeout> | null };
type Session = {
  machine: MachineRef;
  link: RemoteLink;
  id: string; // the engine session id: the address's bare id
  watches: Map<string, Watch>;
  status: StatusRead | null;
  hydratedAt: number;
  deliveries: Map<string, Delivery>;
  sends: Send[];
  sending: boolean;
  acts: Map<string, LaneAAct>; // controls' acts in flight, by opId (a send's is its delivery)
  last: string; // the last state sent
};

const OP_OF: Record<string, string> = { send: 'deliver', interrupt: 'interrupt', model: 'model', command: 'command', btw: 'btw', compact: 'compact', 'stop-agent': 'stop-agent', tell: 'tell' };
const record = (value: unknown): Fields | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Fields) : null);
const refused = (code: string, message: string): ControlResult => ({ state: 'refused', code, message });
const keyOf = (key: DeliveryKey) => `${key.writer}#${key.seq}`;
const NOT_OPEN = 'the session isn’t open here: open it to drive it';
export const STOP_TASK_GAP = 'a background shell on another machine is stopped there: stopping one from here isn’t offered';
export const MEDIA_GAP = 'attachments to a session on another machine wait for uploads across machines';

export function createRemoteLaneA(deps: RemoteLaneADeps): RemoteLaneA {
  const timing: RemoteLaneATiming = { ...REMOTE_LANE_A_TIMING, ...deps.timing };
  const now = deps.now ?? Date.now;
  const machines = new Map<MachineRef, { link: RemoteLink; sessions: Map<string, Session>; off: Array<() => void> }>();
  let sendSeq = 0;
  let readSeq = 0;
  const writer = `remote/${deps.local}`;

  const emitPlane = (s: Session, payload: Fields) => deps.emit(s.machine, 'laneA.plane', { appSessionId: s.id as AppSessionId, ...payload } as EventPayload<'laneA.plane'>);

  // ---- Sessions and their state ----------------------------------------------------------------------------------------

  function machineOf(link: RemoteLink): Map<string, Session> {
    const held = machines.get(link.machine);
    if (held !== undefined && held.link === link) return held.sessions;
    // A new link for the machine (its roster entry was recreated): what the old one carried ends with it.
    if (held !== undefined) {
      for (const off of held.off) off();
      for (const s of [...held.sessions.values()]) for (const w of [...s.watches.values()]) endWatch(s, w, 'closed');
    }
    const sessions = new Map<string, Session>();
    // The link's state and the device's caps are in every watched session's state.
    const linkChanged = () => {
      for (const s of [...sessions.values()]) if (s.watches.size > 0) changed(s);
    };
    machines.set(link.machine, { link, sessions, off: [link.onState(linkChanged), link.onCaps(linkChanged)] });
    return sessions;
  }

  /** A session nobody watches and with nothing out is let go; one with a send or an act still out is held for a reopen. */
  function forget(s: Session): void {
    if (s.watches.size > 0 || s.sends.length > 0 || s.sending || s.acts.size > 0) return;
    const sessions = machines.get(s.machine)?.sessions;
    if (sessions?.get(s.id) === s) sessions.delete(s.id);
  }

  function sessionOf(link: RemoteLink, id: string, create: boolean): Session | null {
    const sessions = machineOf(link);
    let s = sessions.get(id) ?? null;
    if (s === null && create) {
      s = { machine: link.machine, link, id, watches: new Map(), status: null, hydratedAt: 0, deliveries: new Map(), sends: [], sending: false, acts: new Map(), last: '' };
      sessions.set(id, s);
    }
    return s;
  }

  const primary = (s: Session): Watch | null => s.watches.values().next().value ?? null;

  function stateOf(s: Session): LaneAState | null {
    const w = primary(s);
    if (w === null) return null;
    const deliveries = [...s.deliveries.values()].map((d): LaneADelivery => ({ key: d.key, at: d.at, state: d.state, ...(d.uuid !== undefined && { uuid: d.uuid }), ...(d.reason !== undefined && { reason: d.reason }) }));
    return w.fold.state({ appSessionId: s.id, status: s.status, deliveries, link: linkView(s.link), acts: [...s.acts.values()] });
  }

  function changed(s: Session): void {
    const state = stateOf(s);
    const text = JSON.stringify(state);
    if (text === s.last) return;
    s.last = text;
    deps.emit(s.machine, 'laneA.changed', { appSessionId: s.id as AppSessionId, state });
  }

  /** The live state an act needs, or why there is none. */
  function liveFor(s: Session | null, rpc: string | null): { s: Session; state: LaneAState; launch: string } | ControlResult {
    const state = s === null ? null : stateOf(s);
    if (s === null || state === null) return refused('no-bridge', NOT_OPEN);
    const link = state.link!;
    if (link.reason !== null) return refused(link.refusal !== null ? 'refused' : link.clientClass === 'web-cards' ? 'class' : 'offline', link.reason);
    if (state.bridge !== 'live' || state.launch === null) return refused('no-bridge', state.reason ?? NO_BRIDGE);
    const op = rpc === null ? undefined : OP_OF[rpc];
    if (op !== undefined && !state.ops.includes(op)) return refused('unsupported', `not in this session’s sminos${state.sminos === null ? '' : ` (${state.sminos})`}`);
    return { s, state, launch: state.launch };
  }

  /** The act, sealed by the link; a control's (`target`: what it names, if anything) is in the state until its outcome. */
  function act(live: { s: Session; launch: string }, rpc: string, args: Fields, options: { target?: string; requestDigest?: ActRequest['requestDigest'] } = {}): Promise<ActOutcome> {
    const { s, launch } = live;
    const { target, requestDigest } = options;
    const handle = s.link.act({ action: `sminos.${rpc}`, session: s.id, context: { lane: 'A', session: s.id, launch }, args: { session: s.id, ...args }, ...(requestDigest !== undefined && { requestDigest }) });
    if (rpc === 'send') return handle.outcome; // a send's progress is its delivery
    const shown: LaneAAct = { id: handle.opId, control: rpc, ...(target !== undefined && { target }), progress: handle.progress(), at: new Date(now()).toISOString() };
    s.acts.set(shown.id, shown);
    changed(s);
    const off = handle.onProgress((progress) => {
      shown.progress = progress;
      changed(s);
    });
    return handle.outcome.then((outcome) => {
      off();
      s.acts.delete(shown.id);
      changed(s);
      forget(s);
      return outcome;
    });
  }

  async function control(s: Session | null, rpc: string, args: Fields = {}, target?: string): Promise<ControlResult> {
    const live = liveFor(s, rpc);
    if (!('s' in live)) return live;
    return controlOf(await act(live, rpc, args, { target }), live.s.link.name, rpc);
  }

  // ---- Watches -----------------------------------------------------------------------------------------------------------

  function watch(s: Session, client: MainContext['client']): string {
    const w: Watch = { id: randomUUID(), fold: new RemoteFold(s.id), sub: null, token: {}, started: false, paused: false, backoffMs: timing.backoffMs[0], retry: null, offGone: () => {}, requests: new Map(), reads: new Map(), ended: false };
    s.watches.set(w.id, w);
    w.offGone = client.onGone(() => endWatch(s, w, null));
    subscribe(s, w);
    changed(s);
    return w.id;
  }

  function subscribe(s: Session, w: Watch): void {
    const token = {};
    w.token = token;
    const mine = () => w.token === token && !w.ended;
    w.sub = s.link.subscribe(
      { session: { lane: 'A', id: s.id }, view: 'full', cursor: null },
      {
        subbed(mode) {
          if (!mine()) return;
          if (!w.started) return; // the first subscription: its snapshot follows
          if (mode !== 'replay') return reset(s, w);
          // A replay after a drop (only what followed the cursor comes next, maybe nothing): the view went on as it was,
          // so the page hears a resume, never a reset, and asks again what the drop lost (P5 O9 M9 landing fix wave).
          w.paused = false;
          emitPlane(s, { watch: w.id, resumed: true });
        },
        snapshot(_at, value) {
          if (!mine()) return;
          const first = !w.started;
          w.started = true;
          w.backoffMs = timing.backoffMs[0];
          const message = value as PlaneMessage;
          w.fold.message(message);
          emitPlane(s, { watch: w.id, messages: [message] });
          if (w.paused) {
            w.paused = false;
            emitPlane(s, { watch: w.id, resumed: true });
          }
          if (primary(s) === w) changed(s);
          if (first) void hydrate(s);
        },
        event(_at, body) {
          if (!mine()) return;
          if (record(body)?.omitted !== undefined) return reopen(s, w); // a message too large to carry: the view is no longer whole
          const message = body as PlaneMessage;
          w.fold.message(message);
          emitPlane(s, { watch: w.id, messages: [message] });
          answered(w, message);
          if (primary(s) !== w) return;
          changed(s);
          const step = record(message.body);
          if (message.kind === 'step-end' && (step?.agentId ?? null) === null && now() - s.hydratedAt >= timing.hydrateEveryMs) void hydrate(s);
        },
        paused(reason) {
          if (!mine()) return;
          w.paused = true;
          emitPlane(s, { watch: w.id, paused: reason });
        },
        resumed() {
          if (!mine()) return;
          w.paused = false;
          emitPlane(s, { watch: w.id, resumed: true });
        },
        ended(reason) {
          if (!mine()) return;
          w.sub = null;
          if (reason === 'closed') return endWatch(s, w, reason); // the link closed for good
          // The endpoint collapses every sminos end to `unavailable`: a fresh subscription, with backoff.
          if (!w.paused) {
            w.paused = true;
            emitPlane(s, { watch: w.id, paused: reason });
          }
          const delay = w.backoffMs;
          w.backoffMs = Math.min(w.backoffMs * 2, timing.backoffMs[1]);
          w.retry = setTimeout(() => {
            w.retry = null;
            if (!w.ended) subscribe(s, w);
          }, delay);
        },
      },
    );
  }

  /** A discontinuity: what the watch drew no longer follows; its next snapshot starts it again. */
  function reset(s: Session, w: Watch): void {
    emitPlane(s, { watch: w.id, reset: true });
    for (const kind of [...w.requests.keys()]) release(w, kind);
  }

  /** The view opened afresh under a new subscription, whose snapshot is a reset. */
  function reopen(s: Session, w: Watch): void {
    w.sub?.close();
    w.sub = null;
    subscribe(s, w);
  }

  function endWatch(s: Session, w: Watch, reason: string | null): void {
    if (w.ended) return;
    w.ended = true;
    w.token = {};
    w.sub?.close();
    w.sub = null;
    if (w.retry !== null) clearTimeout(w.retry);
    w.offGone();
    for (const kind of [...w.requests.keys()]) release(w, kind);
    for (const resolve of [...w.reads.values()]) resolve({ ok: false, code: 'failed', message: 'the view of the session ended' });
    w.reads.clear();
    if (reason !== null) emitPlane(s, { watch: w.id, ended: reason });
    s.watches.delete(w.id);
    if (s.watches.size === 0) {
      if (s.last !== '' && s.last !== 'null') deps.emit(s.machine, 'laneA.changed', { appSessionId: s.id as AppSessionId, state: null });
      s.last = 'null';
      forget(s);
      return;
    }
    changed(s);
  }

  // ---- Reads -------------------------------------------------------------------------------------------------------------

  /** A message that answers a read or a request of its kind. */
  function answered(w: Watch, m: PlaneMessage): void {
    if (m.kind === 'rows' || m.kind === 'diff' || m.kind === 'output') return release(w, m.kind);
    if (m.kind !== 'read') return;
    const body = record(m.body);
    const resolve = typeof body?.id === 'string' ? w.reads.get(body.id) : undefined;
    if (resolve === undefined) return;
    w.reads.delete(body!.id as string);
    const error = record(body!.error);
    resolve(error === null ? { ok: true, result: body!.result ?? null } : { ok: false, code: readCode(error.code), message: typeof error.message === 'string' ? error.message : String(error.code) });
  }

  function readCode(code: unknown): Exclude<ReadOutput, { ok: true }>['code'] {
    return code === 'no-bridge' || code === 'unsupported' || code === 'timeout' || code === 'busy' ? code : 'failed';
  }

  function release(w: Watch, kind: string): void {
    const slot = w.requests.get(kind);
    if (slot === undefined) return;
    if (slot.timer !== null) clearTimeout(slot.timer);
    slot.timer = null;
    slot.busy = false;
    const next = slot.waiting.shift();
    if (next !== undefined) next();
    else w.requests.delete(kind);
  }

  /** The watch's one outstanding request of `kind`: resolves once it is this caller's turn. */
  function take(w: Watch, kind: string): Promise<void> {
    let slot = w.requests.get(kind);
    if (slot === undefined) w.requests.set(kind, (slot = { busy: false, waiting: [], timer: null }));
    const held = slot;
    const start = () => {
      held.busy = true;
      held.timer = setTimeout(() => release(w, kind), timing.readMs);
    };
    if (!held.busy) {
      start();
      return Promise.resolve();
    }
    return new Promise((resolve) => held.waiting.push(() => (start(), resolve())));
  }

  const callError = (error: { code: string; message?: string }, machine: string): ReadOutput => ({
    ok: false,
    code: error.code === 'timeout' ? 'timeout' : error.code === 'busy' ? 'busy' : 'failed',
    message: error.code === 'offline' ? `${machine} isn’t reachable` : (error.message ?? `refused by ${machine} (${error.code})`),
  });

  async function read(s: Session | null, watchId: string, kind: ReadKind, args?: Fields): Promise<ReadOutput> {
    const w = s?.watches.get(watchId);
    if (s === null || w === undefined) return { ok: false, code: 'no-bridge', message: NOT_OPEN };
    if (kind === 'rows' || kind === 'diff' || kind === 'output') {
      await take(w, kind);
      if (w.ended || w.sub === null) {
        release(w, kind);
        return { ok: false, code: 'failed', message: 'the view of the session is reconnecting' };
      }
      const result = await s.link.call(`sminos.${kind}`, { session: s.id, sub: w.sub.id, ...args });
      if (!result.ok) {
        release(w, kind);
        return callError(result.error, s.link.name);
      }
      return { ok: true, result: result.output };
    }
    if (w.sub === null) return { ok: false, code: 'failed', message: 'the view of the session is reconnecting' };
    const id = `r${++readSeq}`;
    const answer = new Promise<ReadOutput>((resolve) => {
      const timer = setTimeout(() => {
        w.reads.delete(id);
        resolve({ ok: false, code: 'timeout', message: `${s.link.name} didn’t answer in time` });
      }, timing.readMs);
      w.reads.set(id, (output) => (clearTimeout(timer), resolve(output)));
    });
    const asked = await s.link.call('sminos.read', { session: s.id, sub: w.sub.id, id, what: kind, ...(args !== undefined && { args }) });
    if (!asked.ok) {
      w.reads.get(id)?.(callError(asked.error, s.link.name));
      w.reads.delete(id);
    }
    return answer;
  }

  /** The override, the model and the mode the plane doesn't carry, from the bridge's `read status`. */
  async function hydrate(s: Session): Promise<void> {
    const w = primary(s);
    if (w === null) return;
    s.hydratedAt = now();
    const launch = w.fold.launch(); // the process the read asks: its mode is that process's alone
    const answer = await read(s, w.id, 'status');
    if (!answer.ok) return deps.log(`lane A: ${s.link.name}/${s.id}: read status: ${answer.message}`);
    const result = record(answer.result);
    const o = record(result?.override);
    const override = o === null ? null : { model: typeof o.model === 'string' ? o.model : null, effort: typeof o.effort === 'string' ? o.effort : null };
    s.status = { model: typeof result?.model === 'string' ? result.model : null, override: override === null || (override.model === null && override.effort === null) ? null : override, mode: modeOf(result), launch };
    if (s.watches.size > 0) changed(s);
  }

  // ---- Sends -------------------------------------------------------------------------------------------------------------

  function setDelivery(s: Session, key: DeliveryKey, fields: Partial<Delivery>): void {
    const d = s.deliveries.get(keyOf(key));
    if (d === undefined) return;
    Object.assign(d, fields);
    if (fields.state !== undefined && fields.state !== 'queued' && fields.state !== 'submitted') {
      d.settledAt = now();
      setTimeout(() => {
        if (s.deliveries.get(keyOf(key)) !== d) return;
        s.deliveries.delete(keyOf(key));
        if (s.watches.size > 0) changed(s);
      }, timing.deliveryKeptMs);
    }
    if (s.watches.size > 0) changed(s);
  }

  function send(s: Session | null, text: string): Promise<LaneASendOutput> {
    if (text.trimStart().startsWith('/')) return Promise.resolve({ key: null, state: 'refused', reason: 'a slash command goes as a command, not as words', code: 'bad-args' });
    const live = liveFor(s, 'send');
    if (!('s' in live)) {
      const r = live as Extract<ControlResult, { state: 'refused' }>;
      return Promise.resolve({ key: null, state: 'refused', reason: r.message, code: r.code });
    }
    const session = live.s;
    if (session.sends.length >= timing.sendQueueMax) return Promise.resolve({ key: null, state: 'refused', reason: 'too many messages waiting for this session', code: 'busy' });
    const key: DeliveryKey = { writer, seq: ++sendSeq };
    session.deliveries.set(keyOf(key), { key, at: new Date(now()).toISOString(), state: 'queued' });
    return new Promise((resolve) => {
      const entry: Send = { key, text, answer: resolve, timer: null };
      entry.timer = setTimeout(() => {
        entry.timer = null;
        if (entry.answer === null) return;
        entry.answer = null;
        const d = session.deliveries.get(keyOf(key));
        resolve({ key, state: d?.state === 'submitted' ? 'submitted' : 'queued' });
      }, timing.sendAnswerMs);
      session.sends.push(entry);
      changed(session);
      void pump(session);
    });
  }

  /** The session's sends, one at a time: the next act is created only once the one before has its outcome. */
  async function pump(s: Session): Promise<void> {
    if (s.sending) return;
    s.sending = true;
    try {
      for (let head = s.sends[0]; head !== undefined; head = s.sends[0]) {
        const live = liveFor(s.watches.size === 0 ? null : s, 'send');
        let fate: ReturnType<typeof sendFate>;
        if (!('s' in live)) {
          const r = live as Extract<ControlResult, { state: 'refused' }>;
          fate = { state: 'refused', reason: r.message, code: r.code };
        } else {
          setDelivery(s, head.key, { state: 'submitted' });
          fate = sendFate(await act(live, 'send', { text: head.text }), s.link.name);
        }
        const { code, ...delivery } = fate;
        setDelivery(s, head.key, delivery);
        s.sends.shift();
        if (head.timer !== null) clearTimeout(head.timer);
        if (head.answer !== null) {
          const answer = head.answer;
          head.answer = null;
          answer({ key: head.key, ...delivery, ...(code !== undefined && { code }) } as LaneASendOutput);
        }
      }
    } finally {
      s.sending = false;
      forget(s);
    }
  }

  // ---- Answers -----------------------------------------------------------------------------------------------------------

  async function answer(s: Session | null, request: string, given: RequestAnswer): Promise<LaneAAnswerOutput> {
    const live = liveFor(s, null);
    if (!('s' in live)) {
      const r = live as Extract<ControlResult, { state: 'refused' }>;
      return { outcome: 'refused', code: r.code, message: r.message };
    }
    const fold = primary(live.s)!.fold;
    const raised = fold.raised(request);
    if (raised === null) {
      const settled = fold.settledOf(request);
      return { outcome: 'not_pending', settled, message: settled === null ? 'it is no longer pending' : `already answered: ${settled.outcome} by ${settled.by}` };
    }
    if (typeof raised.deadline === 'string' && Date.parse(raised.deadline) - timing.deadlineSlackMs <= now()) {
      return { outcome: 'not_pending', settled: null, terminalOnly: true, message: 'answer this in the terminal: its window here has closed' };
    }
    const read = answerIntent({ raised, answer: given, controls: live.state.controls });
    if (!read.ok) return { outcome: 'refused', code: read.code, message: read.message };
    let digest: { session: string; request: string; tool: string; input_sha256: string };
    try {
      digest = { session: live.s.id, request, tool: raised.tool, input_sha256: await inputSha256(raised.input as JsonValue) };
    } catch {
      return { outcome: 'refused', code: 'bad-args', message: 'the request’s input has no canonical form' };
    }
    const { intent } = read;
    const rpc = intent.kind === 'answers' ? 'answer' : 'decide';
    let args: Fields;
    if (intent.kind === 'answers') args = { answers: intent.answers, digest };
    else if (intent.kind === 'deny') args = { decision: 'deny', ...(intent.message !== undefined && { message: intent.message }), digest };
    else if (intent.kind === 'allow') args = { decision: 'allow', digest };
    else {
      const sha256 = await suggestionSha256(intent.suggestion);
      if (sha256 === null) return { outcome: 'refused', code: 'bad-args', message: 'the suggestion has no canonical form' };
      args = { decision: 'allow', scope: { suggestion: 0, sha256, destination: intent.destination }, digest };
    }
    const outcome = await act(live, rpc, args, { target: request, requestDigest: digest });
    if (outcome.state === 'done') return { outcome: 'delivered' };
    if (outcome.state === 'unknown') return { outcome: 'unknown', why: 'gone' };
    const result = controlOf(outcome, live.s.link.name, rpc) as Extract<ControlResult, { state: 'refused' }>;
    if (result.code === 'not-pending') return { outcome: 'not_pending', settled: fold.settledOf(request), message: result.message };
    return { outcome: 'refused', code: result.code, message: result.message };
  }

  async function model(s: Session | null, change: { model?: string | null; effort?: string | null }): Promise<ControlResult> {
    // Only what changed: sminos's RPC keeps the other from a live read under its own per-session lock.
    const result = await control(s, 'model', { ...(change.model !== undefined && { model: change.model }), ...(change.effort !== undefined && { effort: change.effort }) });
    if (s !== null && s.watches.size > 0 && result.state !== 'refused') void hydrate(s);
    return result;
  }

  // ---- Dispatch ----------------------------------------------------------------------------------------------------------

  async function run(link: RemoteLink, name: LaneACommand, input: Fields, ctx: MainContext): Promise<unknown> {
    if (name === 'laneA.list') return { states: [...machineOf(link).values()].map(stateOf).filter((x): x is LaneAState => x !== null) };
    const id = String(input.appSessionId);
    const s = sessionOf(link, id, name === 'laneA.watch');
    switch (name) {
      case 'laneA.state':
        return s === null ? null : stateOf(s);
      case 'laneA.watch':
        return { watch: watch(s!, ctx.client) };
      case 'laneA.unwatch': {
        const w = s?.watches.get(String(input.watch));
        if (s !== null && w !== undefined) endWatch(s, w, null);
        return undefined;
      }
      case 'laneA.catalog':
        return s === null ? null : (primary(s)?.fold.catalog() ?? null);
      case 'laneA.read':
        return read(s, String(input.watch), input.kind as ReadKind, record(input.args) ?? undefined);
      case 'laneA.send':
        return send(s, String(input.text));
      case 'laneA.interrupt':
        return control(s, 'interrupt');
      case 'laneA.answer':
        return answer(s, String(input.request), input.answer as RequestAnswer);
      case 'laneA.model':
        return model(s, input as { model?: string | null; effort?: string | null });
      case 'laneA.command':
        return control(s, 'command', { name: input.name, ...(input.args !== '' && { args: input.args }) }, String(input.name));
      case 'laneA.btw':
        return control(s, 'btw', { prompt: input.prompt });
      case 'laneA.compact':
        return control(s, 'compact', input.instructions === undefined ? {} : { instructions: input.instructions });
      case 'laneA.stopAgent':
        return control(s, 'stop-agent', { agentId: input.agentId }, String(input.agentId));
      case 'laneA.tell':
        return control(s, 'tell', { agentId: input.agentId, text: input.text }, String(input.agentId));
      case 'laneA.stopTask':
        return refused('unsupported', STOP_TASK_GAP);
      case 'laneA.media':
        return refused('unsupported', MEDIA_GAP);
    }
  }

  return {
    async dispatch(link, name, input, ctx) {
      try {
        const output = await run(link, name, (record(input) ?? {}), ctx);
        return validateCommandOutput(name, output) as CommandResult<CommandName>;
      } catch (error) {
        deps.log(`lane A: ${name} for ${link.name} failed: ${(error as Error).message}`);
        return { ok: false, error: ipcError('internal', (error as Error).message) };
      }
    },
    stop() {
      for (const { sessions, off } of [...machines.values()]) {
        for (const unsubscribe of off) unsubscribe();
        for (const s of [...sessions.values()]) for (const w of [...s.watches.values()]) endWatch(s, w, 'closed');
      }
      machines.clear();
    },
  };
}
