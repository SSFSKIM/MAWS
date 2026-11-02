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
//
// P5 O2 M3 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md; RL §5.11): `badToken: 'close'` ends a connection whose
// token is wrong or missing with nothing written (the sockets `mawsd` and the pty host create; the engine host keeps
// E10's `refuse token`). `many` serves every welcomed client at once, each through its own runtime from `runtimeFor`,
// with no replacement (`mawsd`'s machine.sock). `onClientEnd` reports a welcomed client's FIN apart from its close, for a
// server made with `allowHalfOpen`, whose side then stays writable until it closes the client.
//
// P5 O2 M4: the capability gate. A client whose hello listed `socket.ptyFrames` gets `pty.data` as pty frames (its port
// is made with `ptyFrames`); any other, a protocol-2 one included, gets the JSON line. The welcome lists what the
// identity says: the serving host's own list (P5 O3-D: PEER_CAPABILITIES in socket-protocol.ts, never the wire's union).
//
// P5 O2 M5 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, "The handshake reflects the upstream"): a relay (`mawsd`'s
// engine-host.sock and pty-host.sock) welcomes with its upstream's facts, not its own. With `admitHello`, a hello that passed
// (1) to (3) waits for its answer, every byte the client sends meanwhile kept for the port: `welcome` (the identity and
// counts to welcome with; then (4) and (5)), `refuse` (the upstream's refusal line, written as it is, after which the
// connection is a refused one: one exit honoured, within the hello's deadline), or `close` (nothing written). `onExit`
// says whether its exit came from a refused connection.
//
// P5 O3-D M5 (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §L): `admitHello` is told the hello's
// `appPid` too, and may refuse on its own account (`own`: `mawsd`'s refusal of an app that runs a spine of its own)
// rather than reflect the upstream's line; the one exit that connection may send says which (`onExit`'s `from.own`).
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
  PTY_FRAMES_CAPABILITY,
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

// P5 O2 M5: what a relay answers a hello with (above)
export type Admission =
  | { kind: 'welcome'; identity: SupervisorIdentity; counts: { liveSessions: number; rows: number } }
  | { kind: 'refuse'; line: ServerRefuse; own?: boolean } // P5 O3-D M5: `own`, the admitting side's refusal, not a reflected one
  | { kind: 'close'; why: string };

// The part of a runtime the socket layer drives (P5 O2 M5: a relay serves its own, which forwards raw).
export type ServedRuntime = Pick<HostRuntime, 'serve' | 'detach' | 'docPort'>;

export interface SocketServerOptions {
  runtime?: ServedRuntime; // the one client's; with `many`, none
  many?: { runtimeFor(client: { appPid: number; capabilities: readonly string[] }): ServedRuntime }; // P5 O2 M3: a runtime per welcomed client, none replaced; P5 O3-D M2: given the hello's appPid and capabilities
  badToken?: 'refuse' | 'close'; // P5 O2 M3: 'refuse' (E10's line) unless said otherwise
  onClientEnd?(): void; // P5 O2 M3: a welcomed client's FIN (above)
  identity(): SupervisorIdentity;
  counts(): { liveSessions: number; rows: number };
  token(): string;
  // an `exit` line on a connection whose token checked out (P5 O2 M5: `from` says which kind; P5 O3-D M5: `own`, after an
  // admission's own refusal; P5 O16 M3b: `capabilities`, what the connection's hello listed, read loosely from a hello it
  // refused, so the engine host tells a client that adopts through its successor apart, D11)
  onExit(when: 'now' | 'idle', from?: { refused: boolean; own?: boolean; capabilities?: readonly string[] }): void;
  onClient?(connected: boolean, peer?: WirePeer, appPid?: number): void; // a client was welcomed (P5 O3-D M3: with what its hello said of it; M4: and its appPid), or a client left (not called for a replaced one)
  admitHello?(peer: WirePeer, appPid: number): Promise<Admission>; // P5 O2 M5: a relay's reflected handshake (above); P5 O3-D M5: with the hello's appPid
  log(line: string): void;
  helloTimeoutMs?: number;
  lineCap?: number;
  docHighWater?: number; // P3-A M5: the document channels' reset mark (DOC_HIGH_WATER unless a test lowers it)
}

export interface SocketClients {
  connected(): boolean; // a welcomed client holds the connection (with `many`, any)
  peer(): WirePeer | null; // P5 O1 M6: what the connected client's hello said of it (a protocol-2 one: major 2, minor 0, no capabilities); with `many`, the latest's
  count(): number; // P5 O2 M3: the welcomed clients
  closeClient(): void; // with `many`, every client
}

interface Client {
  socket: Socket;
  port: SocketPort;
  runtime: ServedRuntime; // P5 O2 M3: the one runtime, or this client's own
  documents: HostDocChannels; // P3-A M5
  peer: WirePeer; // P5 O1 M6
}

export function serveSocketClients(server: Server, options: SocketServerOptions): SocketClients {
  const { log, many } = options;
  if (!many && !options.runtime) throw new Error('serveSocketClients needs a runtime, or `many`');
  const lineCap = options.lineCap ?? LINE_CAP;
  const clients = new Set<Client>(); // P5 O2 M3: the welcomed ones; at most one without `many`
  const logDropped = tolerantLog(log); // P5 O1 M6

  server.on('connection', (socket) => accept(socket));

  function accept(socket: Socket): void {
    let phase: 'hello' | 'refused' | 'done' = 'hello';
    let refusedOwn = false; // P5 O3-D M5: the admission refused it on its own account
    let helloCapabilities: readonly string[] = []; // P5 O16 M3b: what the hello listed, for its one exit when refused
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
        options.onExit(exit.value.when, { refused: true, own: refusedOwn, capabilities: helloCapabilities });
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
        phase = 'done';
        socket.off('data', onData);
        // P5 O2 M3: nothing at all is written to a peer that has not authenticated
        if (options.badToken === 'close') {
          log('closed a hello with a wrong or missing token, writing nothing');
          socket.destroy();
          return 'stop';
        }
        log('refused a hello with a wrong or missing token');
        refuse('token');
        socket.end();
        return 'stop';
      }
      clearTimeout(deadline);
      const preamble = HelloPreambleSchema.safeParse(data);
      if (!preamble.success) return drop('a hello without a protocol number');
      // P5 O16 M3b: read loosely, whatever the major (the preamble is a loose object): only its string names
      if (Array.isArray(record.capabilities)) helloCapabilities = record.capabilities.filter((name): name is string => typeof name === 'string');
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
        return welcomed({ major: protocol, minor, build, capabilities }, appPid, (counts, facts = identity) => ({
          t: 'welcome',
          protocol: facts.protocol,
          minor: facts.minor,
          build: facts.buildId,
          capabilities: [...facts.capabilities],
          pid: facts.pid,
          startedAt: facts.startedAt,
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
      return welcomed({ major: SOCKET_PROTOCOL_V2, minor: 0, build: buildId, capabilities: [] }, appPid, (counts, facts = identity) => ({
        t: 'welcome',
        protocol: SOCKET_PROTOCOL_V2,
        buildId: facts.buildId,
        wire: facts.wire,
        pid: facts.pid,
        startedAt: facts.startedAt,
        ...counts,
      }));
    }

    // (4) replacement, then (5) the welcome `line` builds; the port is built once the splitter has kept the bytes past
    // the hello
    // P5 O2 M5: with `admitHello`, the welcome waits for its answer; the splitter, stopped, keeps every byte read meanwhile
    function welcomed(peer: WirePeer, appPid: number, line: (counts: { liveSessions: number; rows: number }, identity?: SupervisorIdentity) => ServerWelcome | ServerWelcomeV2): 'stop' {
      phase = 'done';
      if (!options.admitHello) {
        socket.off('data', onData);
        welcome = () => serve(peer, appPid, line(options.counts()));
        return 'stop';
      }
      const admit = options.admitHello;
      welcome = () =>
        void admit(peer, appPid).then(
          (admission) => admitted(admission, peer, appPid, line),
          (error: unknown) => admitted({ kind: 'close', why: `its admission failed: ${error instanceof Error ? error.message : String(error)}` }, peer, appPid, line),
        );
      return 'stop';
    }

    function admitted(admission: Admission, peer: WirePeer, appPid: number, line: (counts: { liveSessions: number; rows: number }, identity?: SupervisorIdentity) => ServerWelcome | ServerWelcomeV2): void {
      socket.off('data', onData);
      if (socket.destroyed) return;
      // the peer left while its admission was pending: on a half-open server its FIN ends the socket without destroying
      // it, and a port built now would never hear that end
      if (socket.readableEnded) {
        log('closed a connection whose peer left before its admission answered');
        socket.destroy();
        return;
      }
      if (admission.kind === 'close') {
        log(`closed a connection: ${admission.why}`);
        socket.destroy();
        return;
      }
      if (admission.kind === 'refuse') {
        refusedOwn = admission.own === true;
        log(refusedOwn ? `refused a hello with its own refusal (${admission.line.reason})` : `refused a hello with the upstream's refusal (${admission.line.reason})`);
        socket.write(`${JSON.stringify(admission.line)}\n`);
        // a refused connection: one exit, read from what arrived meanwhile and after, within the hello's deadline
        phase = 'refused';
        deadline = closeAfter('refused connection that sent no exit');
        const refusedLines = splitLines((next) => onLine(next), () => drop(`a line over ${lineCap} bytes`), lineCap);
        const onRefusedData = (chunk: Buffer) => refusedLines.push(chunk);
        socket.on('data', onRefusedData);
        refusedLines.push(splitter.rest());
        return;
      }
      serve(peer, appPid, line(admission.counts, admission.identity));
    }

    function serve(peer: WirePeer, appPid: number, written: ServerWelcome | ServerWelcomeV2): void {
      if (!many) {
        for (const replaced of clients) {
          clients.delete(replaced);
          log('replaced the connected client');
          refuse('replaced', replaced.socket);
          replaced.port.close();
        }
      }
      socket.write(`${JSON.stringify(written)}\n`);
      const port = new SocketPort(socket, splitter.rest(), { lineCap, log, ptyFrames: peer.capabilities.includes(PTY_FRAMES_CAPABILITY) }); // P5 O2 M4
      const runtime = many ? many.runtimeFor({ appPid, capabilities: peer.capabilities }) : options.runtime!; // P5 O2 M3; P5 O3-D M2: the hello's facts
      const documents = new HostDocChannels(port, (message, end) => runtime.docPort(message, end), { highWater: options.docHighWater, log }); // P3-A M5
      const client: Client = { socket, port, runtime, documents, peer };
      clients.add(client);
      port.onDoc((channel, frame) => {
        if (clients.has(client)) documents.deliver(channel, frame); // P3-A M5: a replaced client's frames are dropped
      });
      port.onEnd(() => {
        if (clients.has(client)) options.onClientEnd?.(); // P5 O2 M3
      });
      port.onClose(() => {
        documents.endAll(); // P3-A M5: a replaced client's channels end too
        if (!clients.delete(client)) return;
        runtime.detach();
        log('client disconnected');
        options.onClient?.(false);
      });
      runtime.serve(envelopeOnly(port, client), { capabilities: peer.capabilities }); // P5 O3-D M3: the app's presence reads them
      log(`client connected: appPid ${appPid} build ${peer.build} wire ${peer.major}.${peer.minor} capabilities [${peer.capabilities.join(', ')}]`);
      options.onClient?.(true, peer, appPid);
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
          if (!clients.has(client)) return;
          const exit = readTolerant(ClientExitSchema, event.data);
          if (exit.ok) {
            logDropped('socket exit', exit.dropped);
            log(`exit ${exit.value.when} asked by the client`);
            options.onExit(exit.value.when, { refused: false, capabilities: client.peer.capabilities });
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
    connected: () => clients.size > 0,
    peer: () => [...clients].at(-1)?.peer ?? null, // P5 O1 M6
    count: () => clients.size, // P5 O2 M3
    closeClient() {
      for (const client of clients) client.port.close();
    },
  };
}

function tokenMatches(offered: unknown, expected: string): boolean {
  if (typeof offered !== 'string') return false;
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
