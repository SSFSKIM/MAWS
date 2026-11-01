// Forwarded ports (P5 O7 M3, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Forwarding"; Interfaces §K, §N,
// §O's `forward.open`; P5 Decision Log 108's A6): a port of a machine's own loopback, reached from this Mac's, so the
// in-app browser loads a loopback link of a session there (a dev server) through the machine's RL2 link.
//
// - `remote.forward.open {machine, port}` binds a listener on 127.0.0.1 at a port the system picks (src/main/forwards.ts),
//   runs the act `forward.open {port}` (the endpoint's own executor, graded `shell`: a non-owner confirms it), and answers
//   `{localPort}`. Open is idempotent per machine and port: a listener kept answers its port again, with no act.
// - Each connection the listener accepts is one `tcp` stream naming the act's forward, its bytes both ways under credit:
//   the local socket is read only while the endpoint's credit lasts (paused past a high mark of bytes waiting for it), and
//   what the machine sends is refunded as the socket writes it.
// - The endpoint keeps a forward per device for two minutes past its channel's loss, so a connection after a drop names
//   the same forward on the next channel with no new act. Past that the endpoint answers `unknown`: one fresh
//   `forward.open` (one more confirmation for a non-owner), shared by every connection that met it, and each re-dials.
// - A connection the machine's port refuses (`unreachable`), or one lost with its channel, is reset: the browser shows its
//   connection error, or retries. One waiting for its stream is bounded: at most FORWARD_WAITING_MAX per forward, each
//   reset past `forwardWaitMs` (the machine offline). One the machine's side ended is closed once what it holds is
//   written, by `forwardDrainMs` at the latest, so a peer that never ends its side doesn't hold it half-open. `removed` (the grant withdrawn), `grade` and `not-offered` end the forward: its listener
//   closes with its connections.
// - A listener lives until `remote.forward.close`, its machine's link leaves the roster or ends (`RemoteLink.ended`),
//   or the app quits (`stop`). The
//   act's forward is kept past a close, so opening the same port again asks nothing while the endpoint still knows it.
import type { Socket } from 'node:net';
import { ipcError, type IpcErrorCode } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import type { LocalListener } from '../forwards';
import { refusalError } from '../machines/remote/dispatch';
import type { ActHandle, ActOutcome, RemoteLink, RemoteStream } from '../machines/remote/link';
import { outcomeAsResult, pendingResult } from './remote-outcomes';

/** Bytes of a local connection waiting for the endpoint's credit past which the socket is paused, and below which it reads again. */
const PAUSE_AT = 256 * 1024;
const RESUME_AT = 64 * 1024;
/** Connections of one forward waiting for their stream to open (the endpoint's `MAX_STREAMS` per channel): one past it is reset. */
export const FORWARD_WAITING_MAX = 32;

export interface RemoteForwardsTiming {
  /** A connection whose stream hasn't opened by then (the machine offline, its act unanswered) is reset. */
  forwardWaitMs: number;
  /** A connection the machine's side ended is destroyed once what it holds is written, or by then at the latest. */
  forwardDrainMs: number;
}
export const REMOTE_FORWARDS_TIMING: RemoteForwardsTiming = { forwardWaitMs: 15_000, forwardDrainMs: 10_000 };

export interface RemoteForwardsDeps {
  remote(machine: MachineRef): RemoteLink | null;
  /** src/main/forwards.ts's `listenLoopback`. */
  listen(onConnection: (socket: Socket) => void): Promise<LocalListener>;
  /** The act's outcome, or `pending` at `deadline` once a copy went out (remote.ts's). */
  bounded(handle: ActHandle, deadline: number): Promise<ActOutcome | 'pending'>;
  pendingMs: number;
  timing: RemoteForwardsTiming;
  now(): number;
  log(line: string): void;
}

type Target = CommandInput<'remote.forward.open'>;
export interface RemoteForwards {
  open(target: Target): Promise<CommandResult<'remote.forward.open'>>;
  close(target: Target): void;
  /** The roster changed: the forwards of a machine whose link is no longer the one they were made on close. */
  linksChanged(): void;
  stop(): void;
}

/** The act's forward: what a `tcp` stream names. */
type Grant = { op: string; forward: string };
type Forward = {
  machine: MachineRef;
  port: number;
  link: RemoteLink;
  listener: LocalListener | null;
  opening: Promise<CommandResult<CommandName>> | null;
  grant: Grant | null;
  granting: Promise<Grant | CommandResult<CommandName>> | null;
  streams: Set<RemoteStream>;
  /** Bumped at each close, so what an earlier open was doing is let go. */
  generation: number;
  /** Connections accepted whose stream hasn't opened yet. */
  waiting: number;
};
/** A connection on its way to an open stream: settled once it opens or ends; `abort` lets go of a stream waiting to open. */
type Admission = { settle(): void; settled(): boolean; abort: (() => void) | null };

const failure = (code: IpcErrorCode, message: string): CommandResult<CommandName> => ({ ok: false, error: ipcError(code, message) });
const NAME: CommandName = 'remote.forward.open';

export function createRemoteForwards(deps: RemoteForwardsDeps): RemoteForwards {
  const forwards = new Map<string, Forward>();
  /** Each link forwards were made on, watched for its end (`RemoteLink.ended`): its forwards close and are forgotten. */
  const watched = new Map<RemoteLink, () => void>();
  const keyOf = (machine: MachineRef, port: number) => `${machine}\n${port}`;

  /** The forward's act, kept; or a fresh one (`after`: the grant a connection met `unknown` under, replaced). */
  function granted(fwd: Forward, after?: Grant): Promise<Grant | CommandResult<CommandName>> {
    if (fwd.grant !== null && fwd.grant !== after) return Promise.resolve(fwd.grant);
    fwd.granting ??= (async () => {
      const deadline = deps.now() + deps.pendingMs;
      const handle = fwd.link.act({ action: 'forward.open', args: { port: fwd.port }, executor: 'endpoint', sendBy: deadline });
      const outcome = await deps.bounded(handle, deadline);
      if (outcome === 'pending') return pendingResult(NAME, fwd.link.name);
      if (outcome.state !== 'done') return outcomeAsResult(NAME, fwd.link.name, outcome);
      const forward = (outcome.result as { forward?: unknown } | null)?.forward;
      if (typeof forward !== 'string') return failure('internal', `${NAME}: ${fwd.link.name} answered no forward`);
      fwd.grant = { op: handle.opId, forward };
      return fwd.grant;
    })().finally(() => (fwd.granting = null));
    return fwd.granting;
  }

  function closeForward(fwd: Forward, forgetGrant: boolean): void {
    fwd.generation += 1;
    fwd.listener?.close();
    fwd.listener = null;
    for (const stream of fwd.streams) stream.close();
    fwd.streams.clear();
    if (forgetGrant) fwd.grant = null;
  }

  /** A link that ended (closed for good, or the machine removed this device) takes its forwards with it. */
  function watch(link: RemoteLink): void {
    if (watched.has(link)) return;
    watched.set(
      link,
      link.onState(() => {
        if (link.ended() === null) return;
        deps.log(`lane B: the link to ${link.name} ended (${link.ended()}): its forwarded ports close`);
        for (const [key, fwd] of [...forwards]) {
          if (fwd.link !== link) continue;
          closeForward(fwd, true);
          forwards.delete(key);
        }
        unwatch(link);
      }),
    );
  }
  function unwatch(link: RemoteLink): void {
    watched.get(link)?.();
    watched.delete(link);
  }

  async function connection(fwd: Forward, socket: Socket): Promise<void> {
    socket.pause();
    socket.on('error', () => {}); // a reset from either side is the connection's end, heard as `close`
    if (fwd.waiting >= FORWARD_WAITING_MAX) {
      deps.log(`lane B: the forward of port ${fwd.port} on ${fwd.link.name} has ${FORWARD_WAITING_MAX} connections waiting already: one more is reset`);
      return void socket.resetAndDestroy();
    }
    // Bounded while it waits: the machine offline, or the act unanswered, resets it past forwardWaitMs.
    fwd.waiting += 1;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      admission.settle();
      admission.abort?.();
      socket.resetAndDestroy();
    }, deps.timing.forwardWaitMs);
    const admission: Admission = {
      settle: () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fwd.waiting -= 1;
      },
      settled: () => settled,
      abort: null,
    };
    socket.once('close', admission.settle);
    const generation = fwd.generation;
    const grant = await granted(fwd);
    if ('ok' in grant || fwd.generation !== generation || socket.destroyed || settled) return void socket.resetAndDestroy();
    dial(fwd, socket, grant, false, admission);
  }

  /** The connection is over on the machine's side: what it holds is written, then it closes, by forwardDrainMs at the latest. */
  function drain(socket: Socket): void {
    const timer = setTimeout(() => socket.destroy(), deps.timing.forwardDrainMs);
    socket.once('close', () => clearTimeout(timer));
    socket.end(() => socket.destroy()); // a peer that never ends its side would hold it half-open
  }

  /** One connection as a `tcp` stream naming the forward. */
  function dial(fwd: Forward, socket: Socket, grant: Grant, renewed: boolean, admission: Admission): void {
    const generation = fwd.generation;
    let done = false;
    let opened = false;
    const onData = (chunk: Buffer) => {
      stream.send(chunk);
      if (stream.queued() >= PAUSE_AT) socket.pause();
    };
    const onClose = () => {
      if (done) return;
      finish();
      stream.close();
    };
    const finish = () => {
      done = true;
      fwd.streams.delete(stream);
      socket.off('data', onData);
      socket.off('close', onClose);
    };
    const stream = fwd.link.openStream(
      { kind: 'tcp', op: grant.op, tcp: { forward: grant.forward } },
      {
        opened: () => {
          opened = true;
          admission.settle();
          socket.on('data', onData);
          socket.resume();
        },
        data: (_offset, bytes) => void socket.write(bytes, () => stream.credit(bytes.byteLength)),
        credit: () => {
          if (opened && !done && socket.isPaused() && stream.queued() < RESUME_AT) socket.resume();
        },
        closed: (reason) => {
          finish();
          if (reason === 'closed') return void drain(socket);
          if (reason === 'unknown' && !renewed && fwd.generation === generation && !admission.settled()) return void redial(fwd, socket, grant, admission);
          socket.resetAndDestroy();
          if (reason === 'removed' || reason === 'grade' || reason === 'not-offered') {
            deps.log(`lane B: the forward of port ${fwd.port} on ${fwd.link.name} ended (${reason})`);
            closeForward(fwd, true);
          }
        },
      },
    );
    fwd.streams.add(stream);
    socket.once('close', onClose);
    admission.abort = () => {
      if (done) return;
      finish();
      stream.close();
    };
  }

  /** The endpoint forgot the forward (past its window): a fresh act, and the connection again under it. */
  async function redial(fwd: Forward, socket: Socket, stale: Grant, admission: Admission): Promise<void> {
    deps.log(`lane B: the forward of port ${fwd.port} on ${fwd.link.name} was forgotten by the machine: opening it again`);
    const generation = fwd.generation;
    const grant = await granted(fwd, stale);
    if ('ok' in grant && fwd.generation === generation && fwd.grant === stale) {
      // the fresh act didn't make a forward (no `shell` now, or it was withdrawn before the forward was made): it is over
      deps.log(`lane B: the forward of port ${fwd.port} on ${fwd.link.name} could not be opened again`);
      closeForward(fwd, true);
    }
    if ('ok' in grant || fwd.generation !== generation || socket.destroyed || admission.settled()) return void socket.resetAndDestroy();
    dial(fwd, socket, grant, true, admission);
  }

  async function open(target: Target): Promise<CommandResult<CommandName>> {
    const { port } = target;
    const machine = target.machine as MachineRef; // the schema's ref, validated at the boundary
    const link = deps.remote(machine);
    if (link === null || link.ended() !== null) return failure('host_unavailable', `${NAME}: machine ${machine} is not connected`);
    if (link.peerCapabilities()?.includes('rl2.streams') === false) return refusalError(NAME, link.name, { code: 'not-offered' });
    const key = keyOf(machine, port);
    let held = forwards.get(key);
    if (held !== undefined && held.link !== link) {
      closeForward(held, true);
      held = undefined;
    }
    const mine: Forward = held ?? { machine, port, link, listener: null, opening: null, grant: null, granting: null, streams: new Set(), generation: 0, waiting: 0 };
    forwards.set(key, mine);
    watch(link);
    if (mine.listener !== null) return { ok: true, value: { localPort: mine.listener.port } } as CommandResult<CommandName>;
    mine.opening ??= (async (): Promise<CommandResult<CommandName>> => {
      const generation = mine.generation;
      const listener = await deps.listen((socket) => void connection(mine, socket));
      if (mine.generation !== generation) {
        listener.close();
        return failure('host_unavailable', `${NAME}: the forward of port ${port} on ${link.name} was closed while it opened`);
      }
      mine.listener = listener;
      const grant = await granted(mine);
      if (mine.generation !== generation) return failure('host_unavailable', `${NAME}: the forward of port ${port} on ${link.name} was closed while it opened`);
      if ('ok' in grant) {
        closeForward(mine, false);
        return grant;
      }
      return { ok: true, value: { localPort: listener.port } } as CommandResult<CommandName>;
    })().finally(() => (mine.opening = null));
    return mine.opening;
  }

  return {
    open: (target) => open(target) as Promise<CommandResult<'remote.forward.open'>>,
    close({ machine, port }) {
      const fwd = forwards.get(keyOf(machine as MachineRef, port));
      if (fwd !== undefined) closeForward(fwd, false);
    },
    linksChanged() {
      for (const [key, fwd] of [...forwards]) {
        if (deps.remote(fwd.machine) === fwd.link) continue;
        closeForward(fwd, true);
        forwards.delete(key);
      }
      for (const link of [...watched.keys()]) if (deps.remote(link.machine) !== link) unwatch(link);
    },
    stop() {
      for (const fwd of forwards.values()) closeForward(fwd, true);
      forwards.clear();
      for (const link of [...watched.keys()]) unwatch(link);
    },
  };
}
