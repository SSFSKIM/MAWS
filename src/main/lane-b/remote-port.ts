// The client port across the channel, the device's half (P5 O7 M5c, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "Consent and the client port"; A15; C7, OX4; `rl2.client-port`): what a machine's services ask this app for, and the
// listener a remote consent's redirect lands on.
//
// - The port's answers. The machine asks a remote asker for two things only. `openExternal {url}` (a route D connector's
//   consent, the engine's MCP sign-in) opens the URL on this Mac as a link of that machine's session opens
//   (`openUrl`: ../open-external.ts, which refuses a loopback URL, since it names the machine's own loopback).
//   `openExternal {path}` answers `{opened: false, reason: 'a path on <machine>'}`; `reveal` has no failure form and
//   answers `noClient`, as does any other kind. Every answer is given at once: nothing is held for the machine.
// - The callback listener. A consent's redirect lands on the browser's loopback, this Mac's, where nothing of the
//   machine's listens. For `connectors.connect`, `reconnect`, `signIn` and (P5 O7 M8) `signInServer` on an RL2 machine a loopback listener is bound on
//   127.0.0.1:0 before the act goes and the act carries its port (`callback: {port}`); each request it receives is relayed
//   as the machine's `connectors.callback {port, method, url}` (`url` the path and query as received) and the machine's
//   `{status, headers?, body}` is written to the browser. A request the machine routes to no flow (a favicon, an old tab)
//   comes back 404 and the listener keeps listening: an answered request never ends it.
// - A listener's life, ended by the first of: the act refused (any outcome but `done`, or a Connect's `{accepted: false}`,
//   `busy` among them); the flow's end on the machine, heard on the `artifacts` feed (`heard`) any time after the act went
//   out: a sign-in's terminal `connectors.signInChanged` naming its operation, a Connect's `connectors.serversChanged`
//   naming its artifact and its row (`ended.sourceHandle`, said once at the owner action's end however it ended: its
//   callback, already connected, an open server, a failure, a cancel); its time (the machine's own bound on the flow, from
//   the act's acceptance, and before that the act's own window; a machine that predates `ended` is ended by its time); the
//   channel that accepted the act ending (`onChannel`: the machine ends a flow whose asker ended, so no callback can reach
//   it under the next channel's ref); the link's close, its leaving the roster, or `stop`. One listener per flow; its port
//   is held until it ends, never rebound meanwhile.
// - Bounds: at most LISTENERS_PER_MACHINE listeners per machine (the machine's own bound on owner actions running at once),
//   RELAYS_PER_LISTENER relays in flight per listener, counted until the machine answers each whether or not its browser
//   stayed (more are answered 503 here), each within the link's call deadline; a URL past the relayed request's 4 KiB is
//   answered 414 here. A listener's end answers every browser still waiting (503), lets go of the relays out (their
//   answers are written nowhere) and closes its connections.
// - Only the headers a callback page needs are written (`content-type`, `cache-control`): 127.0.0.1's cookies are every
//   loopback port's, so a machine's answer sets none of them here; a value Node won't write is the answer unread (502).
//   Every failure of a relay or its write is answered 502 at this boundary, never left to reject.
import { createServer, validateHeaderName, validateHeaderValue, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { NO_CLIENT, type OpenAnswer } from '@shared/client/port';
import { ipcError, type IpcErrorCode } from '@shared/ipc/errors';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import { ConnectorCallbackAnswerSchema } from '@shared/ipc/schema/connectors';
import type { MachineRef } from '@shared/machine/ref';
import { budgetedMs } from '../machines/budgets';
import type { ActHandle, ActOutcome, ClientRequest, RemoteLink } from '../machines/remote/link';

/** The acts whose consent's redirect lands here: each gets a listener, its port in the act's `callback`. */
export const CONSENT_COMMANDS: ReadonlySet<CommandName> = new Set<CommandName>(['connectors.connect', 'connectors.reconnect', 'connectors.signIn', 'connectors.signInServer' /* P5 O7 M8 */]);
/** The sign-ins among them, by the entry's file or (P5 O7 M8) by the server's name: a receipt, a sign-in's time and its end by `opId`. */
const SIGN_INS: ReadonlySet<CommandName> = new Set<CommandName>(['connectors.signIn', 'connectors.signInServer']);
/** Listeners at once per machine: the machine's own bound on owner actions running at once (OWNER_ACTION_LIMIT). */
export const LISTENERS_PER_MACHINE = 16;
/** Relays in flight per listener: a consent's redirect, and what the browser asks beside it. */
export const RELAYS_PER_LISTENER = 4;
/** The relayed request's bounds (`connectors.callback`'s schema). */
export const CALLBACK_URL_MAX = 4_096;
const METHOD_MAX = 16;
const WRITTEN_HEADERS: ReadonlySet<string> = new Set(['content-type', 'cache-control']);
const TERMINAL_SIGN_IN: ReadonlySet<string> = new Set(['done', 'failed', 'cancelled']);
/** The sign-ins' ends heard per machine before their receipt was: a sign-in that fails at once ends before its act answers. */
const SIGN_IN_ENDS_KEPT = 64;

export interface CallbackServer {
  readonly port: number;
  /** Stops listening and ends every connection it holds. */
  close(): void;
}
export type CallbackHandler = (request: IncomingMessage, response: ServerResponse) => void;

/** An HTTP listener on 127.0.0.1 at a port the system picks. */
export function listenCallback(handle: CallbackHandler): Promise<CallbackServer> {
  const sockets = new Set<Socket>();
  const server = createServer(handle);
  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        port,
        close() {
          server.close();
          for (const socket of sockets) socket.destroy();
          sockets.clear();
        },
      });
    });
  });
}

export interface RemotePortTiming {
  /** A Connect's listener from the act's acceptance: the owner action's own deadline on the machine and a round trip. */
  consentConnectMs: number;
  /** A sign-in's: the engine's config and callback waits on the machine and a round trip. */
  consentSignInMs: number;
  /** Before the act's acceptance: its own window (the step-up sheet and Touch ID, then the send). */
  consentActMs: number;
}

export interface RemotePortDeps {
  remote(machine: MachineRef): RemoteLink | null;
  onRemote(listener: (machines: readonly MachineRef[]) => void): () => void;
  /** A URL a machine's services asked this device to open (../open-external.ts's `openForMachine`). */
  openUrl(url: string, machine: MachineRef): OpenAnswer;
  /** listenCallback by default. */
  listen?(handle: CallbackHandler): Promise<CallbackServer>;
  timing: RemotePortTiming;
  log(line: string): void;
}

/** Sends the act with the fields given (the callback's port added), telling the caller its handle as soon as it is made. */
export type ConsentAct = (fields: Record<string, unknown>, onHandle: (handle: ActHandle) => void) => Promise<CommandResult<CommandName>>;

export interface RemotePort {
  /** A consent's act on `link`'s machine, with a listener for its redirect from before the act goes. */
  consent(link: RemoteLink, name: CommandName, fields: Record<string, unknown>, act: ConsentAct): Promise<CommandResult<CommandName>>;
  /** An event of the machine's `artifacts` feed (./remote-artifact-feed.ts): a flow's end among them. */
  heard(machine: MachineRef, name: string, payload: unknown): void;
  /** The listeners alive (tests). */
  listening(): Array<{ machine: MachineRef; name: CommandName; port: number }>;
  stop(): void;
}

type Listener = {
  readonly machine: MachineRef;
  readonly link: RemoteLink;
  readonly name: CommandName;
  readonly artifactId: string | null;
  /** A Connect's row (its `sourceHandle`), which its action's end names. */
  readonly sourceHandle: string | null;
  /** A copy of the act went out: an end heard from now on is this flow's. */
  sent: boolean;
  server: CallbackServer | null;
  port: number;
  /** The act was accepted (its ack, or its outcome): the flow runs on the machine. */
  accepted: boolean;
  /** The channel that accepted it (its peer list, which is that channel's own). */
  channel: readonly string[] | null;
  /** A sign-in's operation, from its receipt. */
  opId: string | null;
  /** Relays whose call to the machine is out, whether or not their browser stayed. */
  calls: number;
  /** The browsers waiting on a relay. */
  readonly relays: Set<ServerResponse>;
  readonly timers: Set<ReturnType<typeof setTimeout>>;
  readonly offs: Array<() => void>;
  ended: boolean;
};

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code: IpcErrorCode, message: string, issues?: unknown): CommandResult<CommandName> => ({ ok: false, error: ipcError(code, message, issues) });
const TEXT = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };

/** The words for a path the machine asked this device to open or reveal. */
export const pathOn = (machine: string) => `a path on ${machine}`;

export function createRemotePort(deps: RemotePortDeps): RemotePort {
  const listen = deps.listen ?? listenCallback;
  const listeners = new Set<Listener>();
  const asking = new Map<MachineRef, { link: RemoteLink; off(): void }>();
  const signInEnds = new Map<MachineRef, string[]>();
  let stopped = false;

  // ---- The port's answers --------------------------------------------------------------------------------------------

  function answerOf(link: RemoteLink, { kind, request }: ClientRequest): unknown {
    if (kind !== 'openExternal' || !isObject(request)) return NO_CLIENT; // `reveal` has no failure form; any other kind
    if (typeof request.url === 'string') {
      try {
        return deps.openUrl(request.url, link.machine);
      } catch (error) {
        deps.log(`lane B: a URL ${link.name} asked this Mac to open didn't open: ${(error as Error).message}`);
        return NO_CLIENT;
      }
    }
    if (typeof request.path === 'string') return { opened: false, reason: pathOn(link.name) };
    return NO_CLIENT;
  }

  /** The link's client-port requests answered, once per link the roster holds. */
  function answering(link: RemoteLink): void {
    if (stopped || asking.get(link.machine)?.link === link) return;
    asking.get(link.machine)?.off();
    asking.set(link.machine, { link, off: link.onClient((request, answer) => answer(answerOf(link, request))) });
  }

  const offRemote = deps.onRemote((machines) => {
    for (const [machine, entry] of [...asking]) {
      if (machines.includes(machine) && deps.remote(machine) === entry.link) continue;
      entry.off();
      asking.delete(machine);
    }
    for (const machine of machines) {
      const link = deps.remote(machine);
      if (link !== null) answering(link);
    }
    for (const listener of [...listeners]) checkLink(listener);
  });

  // ---- Listeners ------------------------------------------------------------------------------------------------------

  function end(listener: Listener, why: string): void {
    if (listener.ended) return;
    listener.ended = true;
    listeners.delete(listener);
    for (const timer of listener.timers) clearTimeout(timer);
    listener.timers.clear();
    for (const off of listener.offs.splice(0)) off();
    for (const response of [...listener.relays]) reply(response, 503, 'This MAWS sign-in is no longer waiting here.');
    listener.relays.clear();
    listener.server?.close();
    if (listener.server !== null) deps.log(`lane B: the ${listener.name} listener on port ${listener.port} for ${listener.link.name} ended: ${why}`);
  }

  function after(listener: Listener, ms: number, why: string): void {
    const timer = setTimeout(() => {
      listener.timers.delete(timer);
      end(listener, why);
    }, ms);
    listener.timers.add(timer);
  }

  /** The link the listener's act went on still reaches its machine, and the channel that accepted the act is current. */
  function checkLink(listener: Listener): void {
    const link = deps.remote(listener.machine);
    if (link !== listener.link || link.ended() !== null) return end(listener, 'the link closed');
    if (listener.accepted && link.peerCapabilities() !== listener.channel) end(listener, 'the channel that took the act ended');
  }

  function accepted(listener: Listener): void {
    if (listener.ended || listener.accepted) return;
    listener.accepted = true;
    listener.channel = listener.link.peerCapabilities();
    if (listener.channel === null) return end(listener, 'the channel that took the act ended');
    after(listener, SIGN_INS.has(listener.name) ? deps.timing.consentSignInMs : deps.timing.consentConnectMs, 'its time passed');
  }

  function settled(listener: Listener, outcome: ActOutcome): void {
    if (listener.ended) return;
    if (outcome.state !== 'done') return end(listener, `the act ended ${outcome.state}${'reason' in outcome ? ` ${outcome.reason}` : ''}`);
    const result = outcome.result;
    if (SIGN_INS.has(listener.name)) {
      const opId = isObject(result) && typeof result.opId === 'string' ? result.opId : null;
      if (opId === null) return end(listener, 'the sign-in gave no receipt');
      listener.opId = opId;
      if (signInEnds.get(listener.machine)?.includes(opId) === true) return end(listener, 'the sign-in ended');
    } else if (!isObject(result) || result.accepted !== true) {
      return end(listener, `the machine refused it${isObject(result) && typeof result.why === 'string' ? ` (${result.why})` : ''}`);
    }
    accepted(listener);
  }

  function watch(listener: Listener, handle: ActHandle): void {
    if (listener.ended) return;
    const moved = (progress: string) => {
      if (progress !== 'waiting') listener.sent = true;
      if (progress === 'accepted') accepted(listener);
    };
    listener.offs.push(handle.onProgress(moved));
    moved(handle.progress());
    void handle.outcome.then((outcome) => settled(listener, outcome));
  }

  function reply(response: ServerResponse, status: number, body: string, headers: Record<string, string> = TEXT): void {
    if (response.headersSent || response.writableEnded || response.destroyed) return;
    try {
      response.writeHead(status, { ...headers, 'content-length': String(Buffer.byteLength(body)), connection: 'close' });
      response.end(body);
    } catch (error) {
      deps.log(`lane B: a sign-in page could not be written: ${(error as Error).message}`);
      response.destroy();
    }
  }

  /** The headers a callback page is written with, or null when one is a header Node won't write. */
  function writable(headers: Record<string, string> | undefined): Record<string, string> | null {
    const written: Record<string, string> = {};
    for (const [header, value] of Object.entries(headers ?? {})) {
      if (!WRITTEN_HEADERS.has(header.toLowerCase())) continue;
      try {
        validateHeaderName(header);
        validateHeaderValue(header, value);
      } catch {
        return null;
      }
      written[header] = value;
    }
    return written;
  }

  /** One request the listener received, relayed to the flow on the machine; its answer written to the browser. */
  async function relay(listener: Listener, request: IncomingMessage, response: ServerResponse): Promise<void> {
    request.resume(); // a body is never relayed
    const method = request.method ?? 'GET';
    const url = request.url ?? '/';
    if (listener.ended || listener.server === null) return reply(response, 503, 'This MAWS sign-in is no longer waiting here.');
    if (url.length > CALLBACK_URL_MAX) return reply(response, 414, 'Not a MAWS sign-in address.');
    if (method.length > METHOD_MAX) return reply(response, 405, 'Not a MAWS sign-in request.');
    if (listener.calls >= RELAYS_PER_LISTENER) return reply(response, 503, 'MAWS is busy with this sign-in; try again.');
    listener.calls += 1;
    listener.relays.add(response);
    response.once('close', () => listener.relays.delete(response));
    const { link } = listener;
    let answered: Awaited<ReturnType<RemoteLink['call']>>;
    try {
      const timeoutMs = budgetedMs(link.budgets, 'connectors.callback');
      answered = await link.call('connectors.callback', { port: listener.port, method, url }, timeoutMs === undefined ? undefined : { timeoutMs });
    } finally {
      listener.calls -= 1;
      listener.relays.delete(response);
    }
    if (listener.ended) return; // its end answered the browser
    if (!answered.ok) return reply(response, 502, `MAWS could not reach ${link.name} for this sign-in.`);
    const read = ConnectorCallbackAnswerSchema.safeParse(answered.output);
    const headers = read.success ? writable(read.data.headers) : null;
    if (!read.success || read.data.status < 200 || headers === null) return reply(response, 502, `${link.name} answered this sign-in in a way MAWS can’t read.`);
    reply(response, read.data.status, read.data.body, headers);
  }

  /** A relay's every failure answered 502 here. */
  function relayed(listener: Listener, request: IncomingMessage, response: ServerResponse): void {
    relay(listener, request, response).catch((error: unknown) => {
      deps.log(`lane B: a request to the ${listener.name} listener on port ${listener.port} failed: ${(error as Error).message}`);
      reply(response, 502, 'MAWS could not answer this sign-in.');
    });
  }

  return {
    async consent(link, name, fields, act) {
      if (stopped) return failure('host_unavailable', `${name}: this app is quitting`);
      answering(link); // its consent page is asked of this device through the port
      const live = [...listeners].filter((listener) => listener.machine === link.machine).length;
      if (live >= LISTENERS_PER_MACHINE) return failure('internal', `${name}: too many sign-ins are waiting for ${link.name}`, { refusal: 'busy' });
      const listener: Listener = {
        machine: link.machine,
        link,
        name,
        artifactId: typeof fields.artifactId === 'string' ? fields.artifactId : null,
        sourceHandle: typeof fields.sourceHandle === 'string' ? fields.sourceHandle : null,
        sent: false,
        server: null,
        port: 0,
        accepted: false,
        channel: null,
        opId: null,
        calls: 0,
        relays: new Set(),
        timers: new Set(),
        offs: [],
        ended: false,
      };
      listeners.add(listener); // counted while it binds, so the bound holds across binds at once
      let server: CallbackServer;
      try {
        server = await listen((request, response) => relayed(listener, request, response));
      } catch (error) {
        end(listener, 'it could not bind');
        return failure('internal', `${name}: this Mac could not listen for the sign-in’s answer: ${(error as Error).message}`);
      }
      // the bind awaited: the link may have left, or the app begun quitting, meanwhile
      if (listener.ended) {
        server.close();
        return failure('host_unavailable', `${name}: the link to ${link.name} closed`);
      }
      listener.server = server;
      listener.port = server.port;
      listener.offs.push(
        link.onState(() => checkLink(listener)),
        link.onCaps(() => checkLink(listener)),
        link.onChannel((event) => event === 'lost' && listener.accepted && end(listener, 'the channel that took the act ended')),
      );
      after(listener, deps.timing.consentActMs + Math.max(deps.timing.consentConnectMs, deps.timing.consentSignInMs), 'its time passed');
      checkLink(listener);
      if (listener.ended) return failure('host_unavailable', `${name}: the link to ${link.name} closed`);
      deps.log(`lane B: ${name} on ${link.name}: listening on port ${listener.port} for its consent’s answer`);
      try {
        return await act({ ...fields, callback: { port: listener.port } }, (handle) => watch(listener, handle));
      } catch (error) {
        end(listener, 'its act failed');
        throw error;
      }
    },
    heard(machine, name, payload) {
      if (!isObject(payload)) return;
      if (name === 'connectors.signInChanged' && typeof payload.opId === 'string' && typeof payload.state === 'string' && TERMINAL_SIGN_IN.has(payload.state)) {
        const ends = signInEnds.get(machine) ?? [];
        ends.push(payload.opId);
        if (ends.length > SIGN_IN_ENDS_KEPT) ends.shift();
        signInEnds.set(machine, ends);
        for (const listener of [...listeners]) if (listener.machine === machine && listener.opId === payload.opId) end(listener, 'the sign-in ended');
        return;
      }
      // a Connect's own action's end, named by its row: any time after the act went out, its ack heard or not
      const ended = isObject(payload.ended) && typeof payload.ended.sourceHandle === 'string' ? payload.ended.sourceHandle : null;
      if (name === 'connectors.serversChanged' && typeof payload.artifactId === 'string' && ended !== null) {
        for (const listener of [...listeners]) {
          if (listener.machine === machine && !SIGN_INS.has(listener.name) && listener.sent && listener.artifactId === payload.artifactId && listener.sourceHandle === ended) end(listener, 'the flow ended');
        }
      }
    },
    listening: () => [...listeners].filter((listener) => listener.server !== null).map((listener) => ({ machine: listener.machine, name: listener.name, port: listener.port })),
    stop() {
      stopped = true;
      offRemote();
      for (const entry of asking.values()) entry.off();
      asking.clear();
      for (const listener of [...listeners]) end(listener, 'the app is quitting');
      signInEnds.clear();
    },
  };
}
