// The socket link (P5 O6 M3, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "The socket link"): main's
// connect-only link to another profile's machine on this Mac: that profile's `mawsd` (P5 O3-D M6), reached on its
// `machine.sock` with its `mawsd.token`, where @shared/daemon/files puts them for the profile (`<profile>/mawsd/`, the
// socket in the temporary directory's fallback when the profile's path is too long for it), speaking O1's protocol 3
// and C1's envelope through a SocketPort. The far side's services front answers the link surface (link-surface.ts): its
// `machine`-owned commands from its own table, the hosts' commands forwarded raw, the spine's events; the link follows
// no session stream (O7's link does, D22).
//
// It never starts, replaces, stops or kills the far side, and never sends `exit` (survey §4.2: a client must never stop a
// shared daemon). At the welcome it asks `machine.identity`, then says `ready` and is `up`; the far side's events flow from
// there. Each request carries the asking page's ClientRef id, and that page's end is relayed as `clientGone`
// (src/shared/host/client-refs.ts). A close or a failed connect is `down`, retried every second for the first minute and
// every two seconds after (a failed connect to a local socket costs microseconds, and a returning machine is wanted back
// within 5 s); a request while it is not `up` answers `host_unavailable` at once rather than hang the page's action.
// `machine.sock` serves many clients at once, so a far side's `replaced` refusal (a server of one client) leaves the
// link down for good.
//
// Main-owned schemas cross unversioned (the O6 document's Constraints, "The wire"): the link joins two profiles of one
// build, and says so in its log at connect.
import * as fs from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { join } from 'node:path';
import { daemonHostFiles, daemonPaths } from '@shared/daemon/files';
import { clientGoneRelay, type ClientGoneRelay } from '@shared/host/client-refs';
import { assertPrivateSocket } from '@shared/host/private-path';
import { SocketPort } from '@shared/host/socket-port';
import { PEER_CAPABILITIES, ServerRefuseSchema, ServerWelcomeSchema, SOCKET_PROTOCOL, splitLines, type ClientHello, type ServerWelcome } from '@shared/host/socket-protocol';
import type { ClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import { HostToMainSchema, type HostMessage } from '@shared/ipc/host-protocol';
import type { WireRegistry } from '@shared/ipc/registry';
import type { CommandName, CommandResult, EventName } from '@shared/ipc/schema';
import { readTolerant, tolerantLog } from '@shared/ipc/tolerant';
import { codecOf } from '@shared/ipc/validate';
import { WIRE_MINOR } from '@shared/ipc/wire';
import type { MachineRef } from '@shared/machine/ref';
import { LINK_REGISTRY } from './link-surface';
import type { LinkState, MachineLink } from './manager';

export interface LinkTiming {
  fastRetryMs: number;
  slowRetryMs: number;
  fastWindowMs: number; // how long after going down the fast retry holds
  helloTimeoutMs: number;
  requestTimeoutMs: number;
}
export const LINK_TIMING: LinkTiming = { fastRetryMs: 1_000, slowRetryMs: 2_000, fastWindowMs: 60_000, helloTimeoutMs: 2_000, requestTimeoutMs: 10_000 };

export function retryDelay(downForMs: number, timing: LinkTiming): number {
  return downForMs < timing.fastWindowMs ? timing.fastRetryMs : timing.slowRetryMs;
}

export interface SocketLinkOptions {
  profile: string; // the far profile's directory, whose `mawsd` serves its machine
  build: string; // this app's build, presented in the hello
  log(line: string): void;
  registry?: WireRegistry; // the link surface unless a test passes a fixture
  timing?: Partial<LinkTiming>;
}

interface Pending {
  name: string;
  resolve(result: CommandResult<CommandName>): void;
  timer: ReturnType<typeof setTimeout>;
}

interface Connection {
  port: SocketPort;
  relay: ClientGoneRelay;
  welcome: ServerWelcome;
  pending: Map<string, Pending>;
}

type Answer = { kind: 'welcome'; welcome: ServerWelcome; leftover: Buffer } | { kind: 'failed'; why: string };

export function createSocketLink(options: SocketLinkOptions): MachineLink {
  const { profile, build } = options;
  const log = (line: string) => options.log(`${profile}: ${line}`);
  const registry = options.registry ?? LINK_REGISTRY;
  const codec = codecOf(registry);
  const timing: LinkTiming = { ...LINK_TIMING, ...options.timing };
  const logDropped = tolerantLog(log);
  const stateListeners = new Set<(state: LinkState) => void>();
  const eventListeners = new Set<(name: EventName, payload: unknown) => void>();
  const unknownEvents = new Set<string>();

  let state: LinkState = 'connecting';
  let identity: { ref: MachineRef; name: string } | null = null;
  let connection: Connection | null = null;
  let attemptSocket: Socket | null = null;
  let nextId = 0;
  let downSince = Date.now();
  let retry: ReturnType<typeof setTimeout> | null = null;
  let lastFailure: string | null = null;
  let closed = false;
  let replaced = false;

  const label = () => identity?.ref ?? profile;
  const unavailable = (name: string, why: string): CommandResult<CommandName> => ({ ok: false, error: ipcError('host_unavailable', `${name}: machine ${label()} ${why}`) });

  function setState(next: LinkState): void {
    if (state === next) return;
    state = next;
    if (next === 'down') downSince = Date.now();
    for (const listener of [...stateListeners]) listener(next);
  }

  function schedule(): void {
    if (closed || replaced || retry) return;
    retry = setTimeout(attempt, retryDelay(Date.now() - downSince, timing));
  }

  // A failed attempt: logged once per distinct reason, so a machine that stays away writes one line, not one a second.
  function failed(why: string): void {
    if (why !== lastFailure) log(`no link (${why}); retrying`);
    lastFailure = why;
    setState('down');
    schedule();
  }

  function attempt(): void {
    retry = null;
    if (closed) return;
    const files = daemonHostFiles(daemonPaths(profile), 'machine'); // as a client's transport reaches mawsd's sockets
    const socketPath = files.socket;
    let token: string;
    try {
      assertPrivateSocket(socketPath); // a symlink, another owner or a directory others can enter is never connected to
      token = fs.readFileSync(join(files.dir, files.token), 'utf8').trim();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return failed(code === 'ENOENT' ? 'nothing serves there' : error instanceof Error ? error.message : String(error));
    }
    const socket = createConnection(socketPath);
    attemptSocket = socket;
    socket.on('error', () => {}); // read through the close below
    let done = false;
    let answer: Answer | null = null;
    const splitter = splitLines(
      (line) => {
        answer = parseAnswer(line);
        return 'stop';
      },
      () => (answer = { kind: 'failed', why: 'an answer over the line cap' }),
    );
    const finish = (result: Answer) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('close', onClose);
      attemptSocket = null;
      if (closed) return void socket.destroy();
      if (result.kind === 'failed') {
        socket.destroy();
        return failed(result.why);
      }
      serve(socket, result);
    };
    const onData = (chunk: Buffer) => {
      splitter.push(chunk);
      const read: Answer | null = answer;
      if (read) finish(read.kind === 'welcome' ? { ...read, leftover: splitter.rest() } : read);
    };
    const onClose = () => finish({ kind: 'failed', why: 'closed before answering' });
    const timer = setTimeout(() => finish({ kind: 'failed', why: `no welcome within ${timing.helloTimeoutMs} ms` }), timing.helloTimeoutMs);
    socket.on('data', onData);
    socket.on('close', onClose);
    socket.once('connect', () => {
      const hello: ClientHello = { t: 'hello', protocol: SOCKET_PROTOCOL, token, minor: WIRE_MINOR, build, capabilities: [...PEER_CAPABILITIES.link], appPid: process.pid }; // P5 O3-D: the link's own list
      socket.write(`${JSON.stringify(hello)}\n`);
    });
  }

  function parseAnswer(line: string): Answer {
    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch {
      return { kind: 'failed', why: 'an answer that is not JSON' };
    }
    const welcome = readTolerant(ServerWelcomeSchema, data);
    if (welcome.ok) {
      logDropped('socket welcome', welcome.dropped);
      if (welcome.value.protocol !== SOCKET_PROTOCOL) return { kind: 'failed', why: `a welcome of protocol ${welcome.value.protocol}` };
      return { kind: 'welcome', welcome: welcome.value, leftover: Buffer.alloc(0) };
    }
    const refuse = readTolerant(ServerRefuseSchema, data);
    if (refuse.ok) return { kind: 'failed', why: `refused ${refuse.value.reason} (it speaks protocol ${refuse.value.protocol}, build ${refuse.value.buildId})` };
    return { kind: 'failed', why: 'an answer that is neither welcome nor refuse' };
  }

  function serve(socket: Socket, { welcome, leftover }: Extract<Answer, { kind: 'welcome' }>): void {
    const port = new SocketPort(socket, leftover, { log: (line) => log(`socket: ${line}`) });
    const conn: Connection = { port, welcome, pending: new Map(), relay: clientGoneRelay((message) => void port.postMessage(message)) };
    connection = conn;
    port.on('message', ({ data }) => receive(conn, data));
    port.onClose(() => lost(conn));
    port.start();
    void request(conn, 'machine.identity' as CommandName, undefined, null).then((result) => {
      if (connection !== conn) return;
      if (!result.ok) {
        log(`closed the link: machine.identity answered ${result.error.code}: ${result.error.message}`);
        return port.close();
      }
      const parsed = result.value as { ref: MachineRef; name: string };
      identity = { ref: parsed.ref, name: parsed.name };
      lastFailure = null;
      log(
        `linked to machine ${parsed.ref} (${parsed.name}): build ${welcome.build}, wire ${welcome.protocol}.${welcome.minor}, pid ${welcome.pid}; ` +
          `main-owned commands cross this link unversioned, so it joins two profiles of one build`,
      );
      setState('up'); // the manager's machines.changed goes out before any event of this connection
      port.postMessage({ t: 'ready' } satisfies HostMessage);
    });
  }

  function request(conn: Connection, name: CommandName, input: unknown, client: ClientRef | null): Promise<CommandResult<CommandName>> {
    const id = String(++nextId);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        conn.pending.delete(id);
        resolve({ ok: false, error: ipcError('timeout', `machine ${label()} did not answer ${name} within ${timing.requestTimeoutMs / 1000} s`) });
      }, timing.requestTimeoutMs);
      conn.pending.set(id, { name, resolve, timer });
      const message: HostMessage = client ? { t: 'req', id, name, input, client: client.id } : { t: 'req', id, name, input };
      if (!conn.port.postMessage(message)) {
        clearTimeout(timer);
        conn.pending.delete(id);
        return resolve(unavailable(name, 'closed before the request was sent'));
      }
      if (client) conn.relay.carry(client); // after the request, so a gone client's line follows it
    });
  }

  function receive(conn: Connection, data: unknown): void {
    if (connection !== conn) return;
    const refuse = readTolerant(ServerRefuseSchema, data);
    if (refuse.ok) {
      if (refuse.value.reason === 'replaced') replaced = true;
      return;
    }
    const message = readTolerant(HostToMainSchema, data);
    if (!message.ok) return log('dropped a malformed message');
    logDropped(`envelope ${message.value.t}`, message.dropped);
    if (message.value.t === 'evt') {
      const { name, payload } = message.value;
      if (!codec.isEventName(name)) {
        if (!unknownEvents.has(name)) log(`dropped event ${name}: not on this build's link (logged once per name)`);
        unknownEvents.add(name);
        return;
      }
      const read = codec.readEventPayload(name, payload);
      if (!read.ok) return log(`dropped an invalid ${name}`);
      logDropped(`event ${name}`, read.dropped);
      for (const listener of [...eventListeners]) listener(name as EventName, read.value);
      return;
    }
    const response = message.value;
    const pending = conn.pending.get(response.id);
    if (!pending) return log(`dropped the answer to unknown request ${response.id}`);
    clearTimeout(pending.timer);
    conn.pending.delete(response.id);
    if (!response.ok) return pending.resolve({ ok: false, error: response.error });
    const output = codec.readCommandOutput(pending.name, response.value);
    if (!output.ok) {
      log(`${pending.name} answered an invalid output`);
      return pending.resolve({ ok: false, error: ipcError('internal', output.error.message, output.error.issues) });
    }
    logDropped(`the output of ${pending.name}`, output.dropped);
    pending.resolve({ ok: true, value: output.value } as CommandResult<CommandName>);
  }

  function lost(conn: Connection): void {
    if (connection !== conn) return;
    connection = null;
    conn.relay.close();
    for (const pending of conn.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve(unavailable(pending.name, 'closed before answering'));
    }
    conn.pending.clear();
    if (!closed) log(replaced ? 'another client took this machine; the link stays down' : 'the link closed; retrying');
    setState('down');
    schedule();
  }

  const link: MachineLink = {
    get machine() {
      return identity?.ref ?? null;
    },
    get name() {
      return identity?.name ?? null;
    },
    state: () => state,
    dispatch(name, input, client) {
      if (!codec.isCommandName(name)) return Promise.resolve(unavailable(name, `cannot answer it: ${name} does not cross a machine link`));
      const conn = connection;
      if (state !== 'up' || !conn) return Promise.resolve(unavailable(name, `is ${state}`));
      return request(conn, name, input, client);
    },
    onState(listener) {
      stateListeners.add(listener);
      return () => void stateListeners.delete(listener);
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => void eventListeners.delete(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      if (retry) clearTimeout(retry);
      retry = null;
      attemptSocket?.destroy();
      connection?.port.close();
      setState('down');
    },
  };
  queueMicrotask(attempt); // after the caller has subscribed, so it hears even a first attempt that fails at once
  return link;
}
