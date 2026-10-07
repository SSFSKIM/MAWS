// The server side of the socket layer (E10 execution document, §Design 2): the supervisor accepts connections on its
// Unix socket, runs the handshake on each, and serves at most one client through the host runtime. A client is a
// connection whose hello was answered with `welcome`; nothing else counts as connected.
//
// The server checks a hello in this order and stops at the first failure: (1) the token, wrong or missing → `refuse
// token` and the connection is closed, nothing further read; (2) the protocol → `refuse protocol`; (3) the wire
// fingerprint → `refuse wire`, after either of which the connection stays open for one `exit` and nothing else;
// (4) replacement: a connected client receives `refuse replaced` and is closed; (5) `welcome`, and the connection's
// later lines are C1's envelope through a SocketPort (plus `exit`). A malformed line, an oversized one, an unknown `t`
// or a schema failure closes the connection with a log line.
import { timingSafeEqual } from 'node:crypto';
import type { Server, Socket } from 'node:net';
import { HostReadySchema, HostRequestSchema } from '../ipc/host-protocol';
import type { HostPort, HostRuntime } from './runtime';
import { SocketPort } from './socket-port';
import {
  ClientExitSchema,
  ClientHelloSchema,
  HelloPreambleSchema,
  LINE_CAP,
  splitLines,
  type RefuseReason,
  type ServerRefuse,
  type ServerWelcome,
} from './socket-protocol';

export const HELLO_TIMEOUT_MS = 2_000;

// What the supervisor says about itself in `welcome` and `refuse`.
export interface SupervisorIdentity {
  protocol: number;
  buildId: string;
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
}

export interface SocketClients {
  connected(): boolean; // a welcomed client holds the connection
  closeClient(): void;
}

interface Client {
  socket: Socket;
  port: SocketPort;
}

export function serveSocketClients(server: Server, options: SocketServerOptions): SocketClients {
  const { runtime, log } = options;
  const lineCap = options.lineCap ?? LINE_CAP;
  let current: Client | null = null;

  server.on('connection', (socket) => accept(socket));

  function accept(socket: Socket): void {
    let phase: 'hello' | 'refused' | 'done' = 'hello';
    let welcome: (() => void) | null = null;
    const helloTimer = setTimeout(() => {
      log(`closed a connection that sent no valid hello within ${options.helloTimeoutMs ?? HELLO_TIMEOUT_MS} ms`);
      socket.destroy();
    }, options.helloTimeoutMs ?? HELLO_TIMEOUT_MS);
    socket.on('close', () => clearTimeout(helloTimer));
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
        const exit = ClientExitSchema.safeParse(data);
        if (!exit.success) return drop('a refused connection sent something other than exit');
        phase = 'done';
        socket.off('data', onData);
        log(`exit ${exit.data.when} asked by a refused connection`);
        options.onExit(exit.data.when);
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
      clearTimeout(helloTimer);
      const preamble = HelloPreambleSchema.safeParse(data);
      if (!preamble.success) return drop('a hello without a protocol number');
      const identity = options.identity();
      // (2) the protocol
      if (preamble.data.protocol !== identity.protocol) {
        log(`refused protocol ${preamble.data.protocol} (this supervisor speaks ${identity.protocol})`);
        refuse('protocol');
        phase = 'refused';
        return;
      }
      const hello = ClientHelloSchema.safeParse(data);
      if (!hello.success) return drop('a malformed hello');
      // (3) the wire fingerprint
      if (hello.data.wire !== identity.wire) {
        log(`refused wire ${hello.data.wire} from appPid ${hello.data.appPid} (this supervisor's is ${identity.wire})`);
        refuse('wire');
        phase = 'refused';
        return;
      }
      // (4) replacement, then (5) welcome; the port is built once the splitter has kept the bytes past this line
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
        const line: ServerWelcome = { t: 'welcome', ...identity, liveSessions, rows };
        socket.write(`${JSON.stringify(line)}\n`);
        const port = new SocketPort(socket, splitter.rest(), { lineCap, log });
        const client: Client = { socket, port };
        current = client;
        port.onClose(() => {
          if (current !== client) return;
          current = null;
          runtime.detach();
          log('client disconnected');
          options.onClient?.(false);
        });
        runtime.serve(envelopeOnly(port, client));
        log(`client connected: appPid ${hello.data.appPid} build ${hello.data.buildId}`);
        options.onClient?.(true);
      };
      return 'stop';
    }
  }

  // The runtime sees requests and ready lines only; `exit` is this layer's, and anything else closes the client.
  function envelopeOnly(port: SocketPort, client: Client): HostPort {
    return {
      postMessage: (message: unknown) => port.postMessage(message),
      start: () => port.start(),
      on: (_event: 'message', listener: (event: { data: unknown }) => void) =>
        port.on('message', (event) => {
          if (current !== client) return;
          const exit = ClientExitSchema.safeParse(event.data);
          if (exit.success) {
            log(`exit ${exit.data.when} asked by the client`);
            options.onExit(exit.data.when);
            return;
          }
          if (HostRequestSchema.safeParse(event.data).success || HostReadySchema.safeParse(event.data).success) {
            listener(event);
            return;
          }
          log('closed the client: a line that is neither a request, ready nor exit');
          port.close();
        }),
    };
  }

  return {
    connected: () => current !== null,
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
