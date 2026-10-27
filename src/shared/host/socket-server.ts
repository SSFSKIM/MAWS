// The server side of the socket layer (E10 execution document, §Design 2): the supervisor accepts connections on its
// Unix socket, runs the handshake on each, and serves at most one client through the host runtime. A client is a
// connection whose hello was answered with `welcome`; nothing else counts as connected.
//
// The server checks a hello in this order and stops at the first failure: (1) the token, wrong or missing → `refuse
// token` and the connection is closed, nothing further read; (2) the protocol, which is the wire's major (P5 O1 M6,
// OX1): a hello of this supervisor's major is welcomed whatever its minor, one of protocol 2 goes on to (3), and any
// other is refused `protocol`; (3) protocol 2 only (the protocol-2 window), the wire fingerprint → `refuse wire`. After
// either refusal the connection stays open for one `exit` and nothing else, within the hello's deadline again (E11: a
// refused connection that sends no exit in time is closed); (4) replacement: a connected client receives `refuse
// replaced` and is closed; (5) `welcome`, in the hello's own protocol, and the connection's later lines are C1's envelope
// through a SocketPort (plus `exit`). A malformed line, an oversized one, an unknown `t` or a schema failure closes the
// connection with a log line. P5 O1 M6: the hello and every later line are read tolerantly (tolerant.ts), since the
// client may be another minor: a key this build does not know is dropped and logged once.
//
// P3-A M5 (socket protocol 2): a welcomed client also opens and closes document channels (`documents.open`,
// `documents.close`) and sends their frames; each client has its own channel table (doc-channels.ts), whose ends reach
// the runtime's document handler as a utility host's ports do, and which ends with the client (its close, or its
// replacement).
import { timingSafeEqual } from 'node:crypto';
import type { Server, Socket } from 'node:net';
import { HostClientGoneSchema, HostReadySchema, HostRequestSchema } from '../ipc/host-protocol';
import { readTolerant, tolerantLog } from '../ipc/tolerant';
import type { WirePeer } from '../ipc/wire';
import { HostDocChannels } from './doc-channels';
import type { HostPort, HostRuntime } from './runtime';
import { SocketPort } from './socket-port';
import {
  ClientExitSchema,
  ClientHelloSchema,
  ClientHelloV2Schema,
  DocumentsCloseSchema,
  DocumentsOpenSchema,
  HelloPreambleSchema,
  LINE_CAP,
  SOCKET_PROTOCOL_V2,
  splitLines,
  type RefuseReason,
  type ServerRefuse,
  type ServerWelcome,
  type ServerWelcomeV2,
} from './socket-protocol';

export const HELLO_TIMEOUT_MS = 2_000;

// What the supervisor says about itself in `welcome` and `refuse`. P5 O1 M6: `protocol` is its wire major, `minor` and
// `capabilities` its place within it; `wire`, the fingerprint, is read only through the protocol-2 window and in `refuse`.
export interface SupervisorIdentity {
  protocol: number;
  minor: number;
  buildId: string;
  capabilities: readonly string[];
  wire: string;
  pid: number;
  startedAt: string;
}

export interface SocketServerOptions {
  runtime: HostRuntime;
  identity(): SupervisorIdentity;
  counts(): { liveSessions: number; rows: number };
  token(): string;
  onExit(when: 'now' | 'idle'): void; // an `exit` line on a connection whose token checked out
  onClient?(connected: boolean): void; // a client was welcomed, or the client left (not called for a replaced one)
  log(line: string): void;
  helloTimeoutMs?: number;
  lineCap?: number;
  docHighWater?: number; // P3-A M5: the document channels' reset mark (DOC_HIGH_WATER unless a test lowers it)
}

export interface SocketClients {
  connected(): boolean; // a welcomed client holds the connection
  peer(): WirePeer | null; // P5 O1 M6: what the connected client's hello said of it (a protocol-2 one: major 2, minor 0, no capabilities)
  closeClient(): void;
}

interface Client {
  socket: Socket;
  port: SocketPort;
  documents: HostDocChannels; // P3-A M5
  peer: WirePeer; // P5 O1 M6
}

export function serveSocketClients(server: Server, options: SocketServerOptions): SocketClients {
  const { runtime, log } = options;
  const lineCap = options.lineCap ?? LINE_CAP;
  let current: Client | null = null;
  const logDropped = tolerantLog(log); // P5 O1 M6

  server.on('connection', (socket) => accept(socket));

  function accept(socket: Socket): void {
    let phase: 'hello' | 'refused' | 'done' = 'hello';
    let welcome: (() => void) | null = null;
    const deadlineMs = options.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
    // the hello's deadline, then (E11) a refused connection's for its one exit
    const closeAfter = (what: string) => setTimeout(() => {
      log(`closed a ${what} within ${deadlineMs} ms`);
      phase = 'done';
      socket.destroy();
    }, deadlineMs);
    let deadline = closeAfter('connection that sent no valid hello');
    socket.on('close', () => clearTimeout(deadline));
    socket.on('error', (error) => {
      if (phase !== 'done') log(`a connection failed during its handshake: ${error.message}`);
    });

    const drop = (reason: string): 'stop' => {
      log(`closed a connection: ${reason}`);
      phase = 'done';
      socket.off('data', onData);
      socket.destroy();
      return 'stop';
    };
    const splitter = splitLines(
      (line) => onLine(line),
      () => drop(`a handshake line over ${lineCap} bytes`),
      lineCap,
    );
    function onData(chunk: Buffer): void {
      splitter.push(chunk);
      if (welcome) {
        const serve = welcome;
        welcome = null;
        serve(); // after push returned, so `rest()` holds every byte read past the hello
      }
    }
    socket.on('data', onData);

    function onLine(line: string): void | 'stop' {
      if (phase === 'done') return 'stop';
      let data: unknown;
      try {
        data = JSON.parse(line);
      } catch {
        return drop('a handshake line that is not JSON');
      }
      if (phase === 'refused') {
        const exit = readTolerant(ClientExitSchema, data);
        if (!exit.ok) return drop('a refused connection sent something other than exit');
        logDropped('socket exit', exit.dropped);
        clearTimeout(deadline);
        phase = 'done';
        socket.off('data', onData);
        log(`exit ${exit.value.when} asked by a refused connection`);
        options.onExit(exit.value.when);
        return 'stop';
      }
      return onHello(data);
    }

    function refuse(reason: RefuseReason, to: Socket = socket): void {
      const { protocol, buildId, wire } = options.identity();
      const line: ServerRefuse = { t: 'refuse', reason, protocol, buildId, wire, liveSessions: options.counts().liveSessions };
      if (to.writable) to.write(`${JSON.stringify(line)}\n`);
    }

    function onHello(data: unknown): void | 'stop' {
      const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
      if (record?.t !== 'hello') return drop('its first line is not a hello');
      // (1) the token, before anything else is believed or read
      if (!tokenMatches(record.token, options.token())) {
        log('refused a hello with a wrong or missing token');
        refuse('token');
        phase = 'done';
        socket.off('data', onData);
        socket.end();
        return 'stop';
      }
      clearTimeout(deadline);
      const preamble = HelloPreambleSchema.safeParse(data);
      if (!preamble.success) return drop('a hello without a protocol number');
      const identity = options.identity();
      const refused = (reason: 'protocol' | 'wire', why: string) => {
        log(why);
        refuse(reason);
        phase = 'refused';
        deadline = closeAfter('refused connection that sent no exit');
      };
      // (2) the protocol: this supervisor's major at any minor (P5 O1 M6), or protocol 2 through its window
      const { protocol } = preamble.data;
      if (protocol === identity.protocol) {
        const hello = readTolerant(ClientHelloSchema, data);
        if (!hello.ok) return drop('a malformed hello');
        logDropped('socket hello', hello.dropped);
        const { minor, build, capabilities, appPid } = hello.value;
        return welcomed({ major: protocol, minor, build, capabilities }, appPid, (counts) => ({
          t: 'welcome',
          protocol: identity.protocol,
          minor: identity.minor,
          build: identity.buildId,
          capabilities: [...identity.capabilities],
          pid: identity.pid,
          startedAt: identity.startedAt,
          ...counts,
        }));
      }
      if (protocol !== SOCKET_PROTOCOL_V2) return refused('protocol', `refused protocol ${protocol} (this supervisor speaks ${identity.protocol}, and ${SOCKET_PROTOCOL_V2} through its window)`);
      const hello = readTolerant(ClientHelloV2Schema, data);
      if (!hello.ok) return drop('a malformed protocol-2 hello');
      logDropped('socket v2.hello', hello.dropped);
      // (3) protocol 2's wire fingerprint
      const { buildId, wire, appPid } = hello.value;
      if (wire !== identity.wire) return refused('wire', `refused wire ${wire} from appPid ${appPid} (this supervisor's is ${identity.wire})`);
      return welcomed({ major: SOCKET_PROTOCOL_V2, minor: 0, build: buildId, capabilities: [] }, appPid, (counts) => ({
        t: 'welcome',
        protocol: SOCKET_PROTOCOL_V2,
        buildId: identity.buildId,
        wire: identity.wire,
        pid: identity.pid,
        startedAt: identity.startedAt,
        ...counts,
      }));
    }

    // (4) replacement, then (5) the welcome `line` builds; the port is built once the splitter has kept the bytes past
    // the hello
    function welcomed(peer: WirePeer, appPid: number, line: (counts: { liveSessions: number; rows: number }) => ServerWelcome | ServerWelcomeV2): 'stop' {
      phase = 'done';
      socket.off('data', onData);
      welcome = () => {
        if (current) {
          const replaced = current;
          current = null;
          log('replaced the connected client');
          refuse('replaced', replaced.socket);
          replaced.port.close();
        }
        const { liveSessions, rows } = options.counts();
        socket.write(`${JSON.stringify(line({ liveSessions, rows }))}\n`);
        const port = new SocketPort(socket, splitter.rest(), { lineCap, log });
        const documents = new HostDocChannels(port, (message, end) => runtime.docPort(message, end), { highWater: options.docHighWater, log }); // P3-A M5
        const client: Client = { socket, port, documents, peer };
        current = client;
        port.onDoc((channel, frame) => {
          if (current === client) documents.deliver(channel, frame); // P3-A M5: a replaced client's frames are dropped
        });
        port.onClose(() => {
          documents.endAll(); // P3-A M5: a replaced client's channels end too
          if (current !== client) return;
          current = null;
          runtime.detach();
          log('client disconnected');
          options.onClient?.(false);
        });
        runtime.serve(envelopeOnly(port, client));
        log(`client connected: appPid ${appPid} build ${peer.build} wire ${peer.major}.${peer.minor} capabilities [${peer.capabilities.join(', ')}]`);
        options.onClient?.(true);
      };
      return 'stop';
    }
  }

  // The runtime sees requests, ready lines and (P5 O1 M5) clientGone lines only; `exit` and (P3-A M5) the document
  // channels' lines are this layer's, and anything else closes the client. P5 O1 M6: each is recognized tolerantly; the
  // runtime reads (and logs) what it is passed itself.
  function envelopeOnly(port: SocketPort, client: Client): HostPort {
    return {
      postMessage: (message: unknown) => port.postMessage(message),
      start: () => port.start(),
      on: (_event: 'message', listener: (event: { data: unknown }) => void) =>
        port.on('message', (event) => {
          if (current !== client) return;
          const exit = readTolerant(ClientExitSchema, event.data);
          if (exit.ok) {
            logDropped('socket exit', exit.dropped);
            log(`exit ${exit.value.when} asked by the client`);
            options.onExit(exit.value.when);
            return;
          }
          if (readTolerant(HostRequestSchema, event.data).ok || readTolerant(HostReadySchema, event.data).ok || readTolerant(HostClientGoneSchema, event.data).ok) {
            listener(event);
            return;
          }
          // P3-A M5 start
          const open = readTolerant(DocumentsOpenSchema, event.data);
          if (open.ok) {
            logDropped('socket documents.open', open.dropped);
            return client.documents.open(open.value);
          }
          const close = readTolerant(DocumentsCloseSchema, event.data);
          if (close.ok) {
            logDropped('socket documents.close', close.dropped);
            return client.documents.close(close.value.channel);
          }
          // P3-A M5 end
          log('closed the client: a line that is neither a request, ready, clientGone, exit nor a document channel’s');
          port.close();
        }),
    };
  }

  return {
    connected: () => current !== null,
    peer: () => current?.peer ?? null, // P5 O1 M6
    closeClient() {
      current?.port.close();
    },
  };
}

function tokenMatches(offered: unknown, expected: string): boolean {
  if (typeof offered !== 'string') return false;
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
