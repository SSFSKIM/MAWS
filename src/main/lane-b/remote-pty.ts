// Remote terminals (P5 O7 M3, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Acts, then streams", "The pty
// stream", "The terminal's machine"; Interfaces §J, §N): the panel's terminal for a session on another machine is a shell
// of that machine's pty host, driven from this app over the machine's RL2 link. The renderer keeps the local terminal's
// commands and events (`pty.spawn`, `pty.attach`, `pty.write`, `pty.ack`, `pty.data`, `pty.exit`, …); this half of
// remote lane B turns them into acts and a byte stream.
//
// - `pty.spawn`, `pty.attach`, `pty.kill` and `pty.listFor` are acts under the pty host's ledger (executor `pty-host`),
//   built from the command's input; step-up is the link's `if-asked`, so a non-owner with a `shell` grant confirms each.
// - A spawn or an attach that ran opens the pty's stream under its opId. The stream lives across the link's channels: one
//   lost with its channel is opened again on the next from its offsets, under the same act, asking nothing; one refused
//   or closed `unavailable` or `busy` is opened again on a backoff; one the endpoint closed `behind` (this app took too
//   little of its output) is opened again from its last offset once the renderer has taken what it was given; one whose
//   act the machine no longer knows (`unknown`) runs a fresh `pty.attach` (a non-owner confirms again). `removed` (the
//   grant withdrawn), `grade` and anything else end the terminal: the renderer hears `pty.exit` with no status (lost).
// - Output offsets are the pty host's. Every byte past what was already said goes to the renderer as `pty.data` at its
//   offset; a reopen whose ring had moved past that offset says its first bytes past a gap, which the renderer draws as
//   lost output. The renderer's `pty.ack` is the stream's credit refund: the endpoint sends no more than the renderer has
//   not yet taken, plus the stream's credit.
// - `pty.attach` answers as the local host does, `{info, checkpoint, replay, replayFrom, nextOffset}`: the stream opens
//   from this app's own checkpoint of the pty (`pty.checkpoint` is kept here, per pty, for the app's life; the machine
//   refuses a remote one), or from the ring's start on a new app run, and the answer waits for the ring's bytes up to the
//   stream's `nextOffset`. The renderer acknowledges nothing below that, so its credit goes back as it is answered.
// - Input is numbered per pty from zero in an `inputEpoch` minted once per adapter (an app run), so the machine drops a
//   resend and a new app run under the same device keys is never read as one. What the machine has not yet taken (its
//   refunds) is held here and sent again from its first offset on the next stream.
// - Resize is a stream control; one asked while no stream is open goes on the next.
// - A pty's exit closes its stream `exit` after its output: the stream is opened once more from its end to read the exit
//   status from the pty's info, said as `pty.exit`.
// - `pty.hostState` of an RL2 machine is its link's state: `ready` while the link is up, else `starting`, said again as an
//   event at each change of the link's state once asked.
import { randomBytes } from 'node:crypto';
import { ipcError, type IpcErrorCode } from '@shared/ipc/errors';
import type { CommandName, CommandResult, EventName, EventPayload } from '@shared/ipc/schema';
import type { HostState } from '@shared/ipc/schema/common';
import { PtyInfoSchema, PtyOpAttachSchema, type PtyCheckpoint, type PtyExit, type PtyId } from '@shared/ipc/schema/pty';
import type { MachineRef } from '@shared/machine/ref';
import type { ActHandle, ActOutcome, RemoteLink, RemoteStream, StreamOpened } from '../machines/remote/link';
import { refusalError } from '../machines/remote/dispatch';
import { outcomeAsResult, pendingResult } from './remote-outcomes';

export interface RemotePtyTiming {
  /** A terminal's stream refused or closed for now (`unavailable`, `busy`) opens again after these, doubling. */
  streamRetryMs: readonly [number, number];
  /** The most input held for the machine (sent and not yet taken, or waiting for a stream) before a write is refused. */
  inputHeldMax: number;
}
export const REMOTE_PTY_TIMING: RemotePtyTiming = { streamRetryMs: [1000, 30_000], inputHeldMax: 4 * 1024 * 1024 };

/** The pty acts §L offers, each under the pty host's ledger. */
export const PTY_ACTS: ReadonlySet<CommandName> = new Set<CommandName>(['pty.spawn', 'pty.attach', 'pty.kill', 'pty.listFor']);
/** What the terminal's renderer sends that rides its stream, or stays here (a checkpoint). */
export const PTY_STREAM_COMMANDS: ReadonlySet<CommandName> = new Set<CommandName>(['pty.write', 'pty.resize', 'pty.ack', 'pty.checkpoint']);
/** Every `pty.*` name this half takes for an RL2 machine. */
export const PTY_NAMES: ReadonlySet<CommandName> = new Set<CommandName>([...PTY_ACTS, ...PTY_STREAM_COMMANDS, 'pty.hostState']);

export interface RemotePtyDeps {
  remote(machine: MachineRef): RemoteLink | null;
  emit<N extends EventName>(machine: MachineRef, name: N, payload: EventPayload<N>): void;
  /** The act's outcome, or `pending` at `deadline` once a copy went out (remote.ts's). */
  bounded(handle: ActHandle, deadline: number): Promise<ActOutcome | 'pending'>;
  /** An act answers the renderer by then. */
  pendingMs: number;
  timing: RemotePtyTiming;
  now(): number;
  log(line: string): void;
}

export interface RemotePty {
  dispatch(link: RemoteLink, name: CommandName, fields: Record<string, unknown>): Promise<CommandResult<CommandName>>;
  /** The roster changed: a pty whose link is no longer the machine's ends. */
  linksChanged(): void;
  stop(): void;
}

type RingOpened = NonNullable<StreamOpened['pty']>;
/** A renderer's attach, waiting for the ring's bytes up to the stream's `nextOffset`. */
type Attach = { from: number; ring: RingOpened | null; chunks: Uint8Array[]; at: number; answer(result: CommandResult<CommandName>): void };
type Pty = {
  machine: MachineRef;
  link: RemoteLink;
  ptyId: string;
  /** The act the stream opens under. */
  op: string;
  stream: RemoteStream | null;
  /** Bumped at each stream, so a closed stream's sink is not heard. */
  serial: number;
  /** The current stream answered `streamOpened`. */
  live: boolean;
  phase: 'streaming' | 'behind' | 'exiting' | 'ended';
  /** The next output offset not yet said to the renderer. */
  next: number;
  /** `next` when the current stream opened: a stream closed `behind` having said nothing opens again on the backoff. */
  openedAt: number;
  /** The output offset up to which the current stream's credit went back. */
  credited: number;
  /** The furthest offset the renderer acknowledged. */
  rendered: number;
  /** This epoch's next input offset; `held` is the input the machine hasn't taken, `[inputNext - heldBytes, inputNext)`. */
  inputNext: number;
  held: Uint8Array[];
  heldBytes: number;
  resize: { cols: number; rows: number } | null;
  attach: Attach | null;
  retries: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  exitSaid: boolean;
};

const failure = (code: IpcErrorCode, message: string, issues?: unknown): CommandResult<CommandName> => ({ ok: false, error: ipcError(code, message, issues) });
const ok = (value: unknown): CommandResult<CommandName> => ({ ok: true, value }) as CommandResult<CommandName>;
const concat = (chunks: Uint8Array[]): Uint8Array => (chunks.length === 1 ? chunks[0] : new Uint8Array(Buffer.concat(chunks)));
/** Whether the current channel's peer lists no `rl2.streams`; while no channel is current the act and its stream wait. */
const lacksStreams = (link: RemoteLink) => link.peerCapabilities()?.includes('rl2.streams') === false;

export function createRemotePty(deps: RemotePtyDeps): RemotePty {
  /** This app run's input epoch: 16 random bytes, base64url. */
  const epoch = randomBytes(16).toString('base64url');
  const ptys = new Map<string, Pty>();
  /** The renderer's checkpoints, per pty, for the app's life. */
  const checkpoints = new Map<string, PtyCheckpoint>();
  const watched = new Map<RemoteLink, () => void>();
  const revisions = new Map<MachineRef, number>();
  let stopped = false;
  const keyOf = (machine: MachineRef, ptyId: string) => `${machine}\n${ptyId}`;
  const log = (pty: Pty, line: string) => deps.log(`lane B: terminal ${pty.ptyId} on ${pty.link.name}: ${line}`);

  // ---- The pty host's state ------------------------------------------------------------------------------------------

  const hostState = (link: RemoteLink): HostState => ({ state: link.state() === 'up' ? 'ready' : 'starting', pid: null, restarts: 0, revision: revisions.get(link.machine) ?? 1 });

  function watch(link: RemoteLink): void {
    if (watched.has(link)) return;
    let last = hostState(link).state;
    watched.set(
      link,
      link.onState(() => {
        const state = hostState(link).state;
        if (state === last || stopped) return;
        last = state;
        revisions.set(link.machine, (revisions.get(link.machine) ?? 1) + 1);
        deps.emit(link.machine, 'pty.hostState', hostState(link));
      }),
    );
  }

  // ---- A pty's stream ------------------------------------------------------------------------------------------------

  /** The pty's entry for a spawn or an attach that ran under `op`: made, or taken up again (its epoch's offsets kept). */
  function bind(link: RemoteLink, ptyId: string, op: string): Pty {
    const key = keyOf(link.machine, ptyId);
    let pty = ptys.get(key);
    if (pty === undefined) {
      pty = { machine: link.machine, link, ptyId, op, stream: null, serial: 0, live: false, phase: 'streaming', next: 0, openedAt: 0, credited: 0, rendered: 0, inputNext: 0, held: [], heldBytes: 0, resize: null, attach: null, retries: 0, retryTimer: null, exitSaid: false };
      ptys.set(key, pty);
    }
    Object.assign(pty, { link, op, phase: 'streaming', exitSaid: false, retries: 0 });
    return pty;
  }

  function open(pty: Pty, from: number): void {
    if (pty.retryTimer !== null) clearTimeout(pty.retryTimer);
    pty.retryTimer = null;
    pty.stream?.close();
    const serial = ++pty.serial;
    pty.live = false;
    pty.openedAt = pty.next;
    const mine = () => serial === pty.serial;
    pty.stream = pty.link.openStream(
      { kind: 'pty', op: pty.op, pty: { ptyId: pty.ptyId, from, inputEpoch: epoch, inputFrom: pty.inputNext - pty.heldBytes } },
      {
        opened: (opened) => mine() && onOpened(pty, opened),
        data: (offset, bytes) => mine() && onData(pty, offset, bytes),
        credit: (bytes) => mine() && taken(pty, bytes),
        closed: (reason) => mine() && onClosed(pty, reason),
      },
    );
  }

  /** Opened again: from the attach's start while one waits for its ring, else from what was said. */
  const reopen = (pty: Pty) => open(pty, pty.attach?.from ?? pty.next);

  function onOpened(pty: Pty, opened: StreamOpened): void {
    pty.live = true;
    pty.retries = 0;
    const ring = opened.pty ?? null;
    pty.credited = ring?.ringStart ?? pty.next;
    if (pty.phase === 'exiting') {
      // the exit's status, read from the pty's info at its end
      sayExit(pty, (ring?.info as { exit?: PtyExit | null } | undefined)?.exit ?? null);
      return end(pty, null);
    }
    if (pty.attach !== null && ring !== null) Object.assign(pty.attach, { ring, chunks: [], at: ring.ringStart });
    if (pty.heldBytes > 0) pty.stream!.send(concat(pty.held));
    if (pty.resize !== null) pty.stream!.control({ resize: pty.resize });
    pty.resize = null;
    finishAttach(pty);
  }

  function onData(pty: Pty, offset: number, bytes: Uint8Array): void {
    const ring = pty.attach?.ring ?? null;
    if (ring !== null && offset === pty.attach!.at && offset < ring.nextOffset) {
      const take = bytes.subarray(0, Math.min(bytes.byteLength, ring.nextOffset - offset));
      pty.attach!.chunks.push(take);
      pty.attach!.at += take.byteLength;
    }
    say(pty, offset, bytes, ring?.nextOffset);
    finishAttach(pty);
  }

  /** The bytes past what was said, as `pty.data` at their offsets, cut at an attach's `nextOffset` (the renderer drops a chunk that starts below it). */
  function say(pty: Pty, offset: number, bytes: Uint8Array, boundary: number | undefined): void {
    const end = offset + bytes.byteLength;
    if (end <= pty.next) return;
    const start = Math.max(offset, pty.next);
    const cuts = boundary !== undefined && start < boundary && boundary < end ? [start, boundary, end] : [start, end];
    for (let i = 0; i + 1 < cuts.length; i++) deps.emit(pty.machine, 'pty.data', { ptyId: pty.ptyId as PtyId, offset: cuts[i], data: bytes.slice(cuts[i] - offset, cuts[i + 1] - offset) });
    pty.next = end;
  }

  function finishAttach(pty: Pty): void {
    const attach = pty.attach;
    if (attach === null || attach.ring === null || attach.at < attach.ring.nextOffset) return;
    pty.attach = null;
    const { info, ringStart, nextOffset } = attach.ring;
    const parsed = PtyInfoSchema.safeParse(info);
    if (!parsed.success) return attach.answer(failure('internal', `pty.attach: ${pty.link.name} described the terminal in a form this app can’t read`));
    attach.answer(ok({ info: parsed.data, checkpoint: checkpoints.get(keyOf(pty.machine, pty.ptyId)) ?? null, replay: concat(attach.chunks.length > 0 ? attach.chunks : [new Uint8Array(0)]), replayFrom: ringStart, nextOffset }));
    // The renderer acknowledges nothing the attach gave it: its credit goes back now.
    pty.rendered = Math.max(pty.rendered, nextOffset);
    refund(pty, nextOffset);
  }

  /** The credit of the current stream's output up to `offset` goes back. */
  function refund(pty: Pty, offset: number): void {
    const to = Math.min(offset, pty.next);
    if (!pty.live || to <= pty.credited) return;
    pty.stream!.credit(to - pty.credited);
    pty.credited = to;
  }

  /** The machine took `bytes` of the held input (written, or dropped as a resend). */
  function taken(pty: Pty, bytes: number): void {
    let left = Math.min(bytes, pty.heldBytes);
    pty.heldBytes -= left;
    while (left > 0) {
      const head = pty.held[0];
      if (head.byteLength <= left) {
        pty.held.shift();
        left -= head.byteLength;
      } else {
        pty.held[0] = head.subarray(left);
        left = 0;
      }
    }
  }

  function onClosed(pty: Pty, reason: string): void {
    pty.stream = null;
    pty.live = false;
    if (pty.phase === 'ended') return;
    const usable = !stopped && deps.remote(pty.machine) === pty.link && pty.link.refusal() === null;
    switch (reason) {
      case 'carrier':
        return usable ? reopen(pty) : end(pty, reason);
      case 'behind':
        if (pty.attach !== null) return reopen(pty);
        if (pty.next === pty.openedAt) return later(pty); // it said nothing: no tighter loop than the backoff
        log(pty, 'behind: opened again from its last offset once the renderer has taken what it was given');
        pty.phase = 'behind';
        return caughtUp(pty);
      case 'exit':
        if (pty.phase === 'exiting') return end(pty, null);
        pty.phase = 'exiting';
        return usable ? reopen(pty) : end(pty, null);
      case 'unknown':
        return pty.phase === 'exiting' || !usable ? end(pty, reason) : void renew(pty);
      case 'unavailable':
      case 'busy':
      case 'closed':
        return usable ? later(pty) : end(pty, reason);
      default:
        return end(pty, reason);
    }
  }

  function later(pty: Pty): void {
    const [first, most] = deps.timing.streamRetryMs;
    const delay = Math.min(first * 2 ** pty.retries, most);
    pty.retries += 1;
    pty.retryTimer = setTimeout(() => {
      pty.retryTimer = null;
      if (pty.phase !== 'ended') reopen(pty);
    }, delay);
  }

  function caughtUp(pty: Pty): void {
    if (pty.phase !== 'behind' || pty.rendered < pty.next) return;
    pty.phase = 'streaming';
    reopen(pty);
  }

  /** The machine forgot the act the stream opened under: a fresh attach (a non-owner confirms it), and the stream under it. */
  async function renew(pty: Pty): Promise<void> {
    log(pty, 'its act is no longer known to the machine: attaching again');
    const deadline = deps.now() + deps.pendingMs;
    const handle = pty.link.act({ action: 'pty.attach', args: { ptyId: pty.ptyId }, executor: 'pty-host', sendBy: deadline });
    const outcome = await deps.bounded(handle, deadline);
    if (pty.phase === 'ended' || pty.stream !== null) return;
    if (outcome === 'pending' || outcome.state !== 'done') return end(pty, 'unknown');
    pty.op = handle.opId;
    reopen(pty);
  }

  function sayExit(pty: Pty, exit: PtyExit | null): void {
    if (pty.exitSaid || stopped) return;
    pty.exitSaid = true;
    deps.emit(pty.machine, 'pty.exit', { ptyId: pty.ptyId as PtyId, exitCode: exit?.exitCode ?? null, signal: exit?.signal ?? null });
  }

  /** No more streams: the renderer hears the exit (with no status, lost, unless one was read), the held input is dropped. */
  function end(pty: Pty, reason: string | null): void {
    if (pty.phase === 'ended') return;
    pty.phase = 'ended';
    if (pty.retryTimer !== null) clearTimeout(pty.retryTimer);
    pty.retryTimer = null;
    pty.serial += 1;
    pty.stream?.close();
    pty.stream = null;
    pty.live = false;
    pty.held = [];
    pty.heldBytes = 0;
    if (reason !== null) log(pty, `ended (${reason})`);
    sayExit(pty, null);
    const attach = pty.attach;
    pty.attach = null;
    attach?.answer(reason === 'removed' || reason === 'grade' ? refusalError('pty.attach', pty.link.name, { code: reason }) : failure('host_unavailable', `pty.attach: the terminal on ${pty.link.name} can’t be reached (${reason ?? 'exit'})`));
  }

  // ---- Commands ------------------------------------------------------------------------------------------------------

  /** An act of the pty host's ledger, to its outcome or the pending bound. */
  async function act(link: RemoteLink, name: CommandName, args: Record<string, unknown>): Promise<{ handle: ActHandle; outcome: ActOutcome } | CommandResult<CommandName>> {
    const deadline = deps.now() + deps.pendingMs;
    const handle = link.act({ action: name, args, executor: 'pty-host', sendBy: deadline });
    const outcome = await deps.bounded(handle, deadline);
    if (outcome === 'pending') return pendingResult(name, link.name);
    return { handle, outcome };
  }

  async function spawn(link: RemoteLink, fields: Record<string, unknown>): Promise<CommandResult<CommandName>> {
    if (lacksStreams(link)) return refusalError('pty.spawn', link.name, { code: 'not-offered' });
    const ran = await act(link, 'pty.spawn', fields);
    if ('ok' in ran) return ran;
    const result = outcomeAsResult('pty.spawn', link.name, ran.outcome);
    if (result.ok) open(bind(link, (result.value as { ptyId: string }).ptyId, ran.handle.opId), 0);
    return result;
  }

  async function attach(link: RemoteLink, ptyId: string): Promise<CommandResult<CommandName>> {
    if (lacksStreams(link)) return refusalError('pty.attach', link.name, { code: 'not-offered' });
    const ran = await act(link, 'pty.attach', { ptyId });
    if ('ok' in ran) return ran;
    if (ran.outcome.state !== 'done') return outcomeAsResult('pty.attach', link.name, ran.outcome);
    if (!PtyOpAttachSchema.safeParse(ran.outcome.result).success) return failure('internal', `pty.attach: ${link.name} answered in a form this app can’t read`);
    const pty = bind(link, ptyId, ran.handle.opId);
    pty.attach?.answer(failure('internal', 'pty.attach: another attach of this terminal took its place'));
    const from = checkpoints.get(keyOf(link.machine, ptyId))?.offset ?? 0;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (pty.attach !== waiting) return;
        pty.attach = null;
        resolve(failure('timeout', `pty.attach: ${link.name} didn’t send the terminal’s output in time`));
      }, deps.pendingMs);
      const waiting: Attach = { from, ring: null, chunks: [], at: from, answer: (result) => (clearTimeout(timer), resolve(result)) };
      pty.attach = waiting;
      open(pty, from);
    });
  }

  function attached(link: RemoteLink, fields: Record<string, unknown>): Pty | null {
    const pty = ptys.get(keyOf(link.machine, String(fields.ptyId)));
    return pty === undefined || pty.phase === 'ended' ? null : pty;
  }
  const notAttached = (name: string, link: RemoteLink) => failure('host_unavailable', `${name}: the terminal on ${link.name} isn’t attached in this app`);

  async function run(link: RemoteLink, name: CommandName, fields: Record<string, unknown>): Promise<CommandResult<CommandName>> {
    watch(link);
    switch (name) {
      case 'pty.hostState':
        return ok(hostState(link));
      case 'pty.spawn':
        return spawn(link, fields);
      case 'pty.attach':
        return attach(link, String(fields.ptyId));
      case 'pty.kill':
      case 'pty.listFor': {
        const ran = await act(link, name, fields);
        return 'ok' in ran ? ran : outcomeAsResult(name, link.name, ran.outcome);
      }
      case 'pty.checkpoint':
        checkpoints.set(keyOf(link.machine, String(fields.ptyId)), { offset: fields.offset as number, state: fields.state as string });
        return ok(undefined);
      case 'pty.write': {
        const pty = attached(link, fields);
        if (pty === null) return notAttached(name, link);
        const bytes = new Uint8Array(Buffer.from(String(fields.data), 'utf8'));
        if (bytes.byteLength === 0) return ok(undefined);
        if (pty.heldBytes + bytes.byteLength > deps.timing.inputHeldMax) return failure('host_unavailable', `pty.write: too much input is waiting for ${link.name}`);
        pty.held.push(bytes);
        pty.heldBytes += bytes.byteLength;
        pty.inputNext += bytes.byteLength;
        if (pty.live) pty.stream!.send(bytes);
        return ok(undefined);
      }
      case 'pty.resize': {
        const pty = attached(link, fields);
        if (pty === null) return notAttached(name, link);
        const size = { cols: fields.cols as number, rows: fields.rows as number };
        if (pty.live) pty.stream!.control({ resize: size });
        else pty.resize = size;
        return ok(undefined);
      }
      case 'pty.ack': {
        const pty = attached(link, fields);
        if (pty === null) return ok(undefined); // an ack of a terminal gone is nothing to give back
        pty.rendered = Math.max(pty.rendered, fields.offset as number);
        refund(pty, pty.rendered);
        caughtUp(pty);
        return ok(undefined);
      }
      default:
        return failure('internal', `${name}: not a terminal command`);
    }
  }

  return {
    dispatch: (link, name, fields) => run(link, name, fields),
    linksChanged() {
      for (const pty of ptys.values()) if (deps.remote(pty.machine) !== pty.link) end(pty, 'closed');
      for (const [link, off] of [...watched]) {
        if (deps.remote(link.machine) === link) continue;
        off();
        watched.delete(link);
      }
    },
    stop() {
      stopped = true;
      for (const pty of ptys.values()) end(pty, null);
      for (const off of watched.values()) off();
      watched.clear();
    },
  };
}
