// A `machine.sock` stand-in for the render host's tests (P5 O5 M3; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md,
// M3 "Touches"): a scratch profile's daemon directory (0700) with its token, served by the real socket machinery
// (socket-server's `many`, `badToken: 'close'`), each welcomed client answered by the test's handlers. As `mawsd`'s front
// does, it admits no command name absent from the registry and reads each input against its schema before a handler
// sees it; it posts an event only to a client that said ready, and only an event the registry names, valid.
import { mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { daemonPaths, DAEMON_FILES, type DaemonPaths } from '@shared/daemon/files';
import { writeToken } from '@shared/host/socket-host';
import type { HostPort } from '@shared/host/runtime';
import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import { serveSocketClients, type ServedRuntime } from '@shared/host/socket-server';
import { ipcError } from '@shared/ipc/errors';
import { HostReadySchema, HostRequestSchema } from '@shared/ipc/host-protocol';
import { REGISTRY } from '@shared/ipc/registry';
import { readTolerant } from '@shared/ipc/tolerant';
import { codecOf } from '@shared/ipc/validate';
import { WIRE_MINOR } from '@shared/ipc/wire';

const codec = codecOf(REGISTRY);

export type FrontHandler = (input: unknown, client: FakeFrontClient) => unknown;

export interface FakeFrontClient {
  readonly capabilities: readonly string[];
  readonly appPid: number;
  readonly asked: { name: string; input: unknown }[]; // every request, in order, the refused ones too
  ready(): Promise<void>; // resolves when it says ready
  send(name: string, payload: unknown): void; // an event to this client alone, checked as the front checks its own
  ended(): Promise<void>; // resolves when its connection is gone
}

export interface FakeFront {
  profile: string;
  paths: DaemonPaths;
  token: string;
  client(): Promise<FakeFrontClient>; // the next client to be welcomed, or the first already welcomed and not yet taken
  clients(): number; // welcomed and still connected
  drop(): void; // ends every client's connection, as mawsd's exit does
  close(): Promise<void>;
}

export async function startFakeFront(profile: string, handlers: Record<string, FrontHandler>): Promise<FakeFront> {
  const paths = daemonPaths(profile);
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  if (paths.socketDir !== paths.dir) mkdirSync(paths.socketDir, { recursive: true, mode: 0o700 });
  const token = writeToken(join(paths.dir, DAEMON_FILES.token));
  const welcomed: FakeFrontClient[] = [];
  const waiting: ((client: FakeFrontClient) => void)[] = [];
  let connected = 0;

  const welcome = (client: FakeFrontClient) => {
    const next = waiting.shift();
    if (next) next(client);
    else welcomed.push(client);
  };

  function runtimeFor(facts: { appPid: number; capabilities: readonly string[] }): ServedRuntime {
    let port: HostPort | null = null;
    let isReady = false;
    let onReady!: () => void;
    let onEnded!: () => void;
    const ready = new Promise<void>((resolve) => (onReady = resolve));
    const ended = new Promise<void>((resolve) => (onEnded = resolve));
    const client: FakeFrontClient = {
      capabilities: facts.capabilities,
      appPid: facts.appPid,
      asked: [],
      ready: () => ready,
      ended: () => ended,
      send(name, payload) {
        if (!(REGISTRY.machineEvents as readonly string[]).includes(name)) throw new Error(`the front emits no ${name}: it is not in MACHINE_EVENTS`);
        const checked = codec.validateEventPayload(name as never, payload);
        if (!checked.ok) throw new Error(`an invalid ${name}: ${JSON.stringify(checked.issues)}`);
        if (!isReady) throw new Error(`the client has not said ready; ${name} would not be posted`);
        port?.postMessage({ t: 'evt', name, payload: checked.value });
      },
    };
    const answer = async (name: string, rawInput: unknown) => {
      if (!codec.isCommandName(name)) return { ok: false as const, error: ipcError('unknown_command', `unknown command: ${name}`) };
      const input = codec.readCommandInput(name, rawInput);
      if (!input.ok) return input;
      const handler = handlers[name];
      if (!handler) return { ok: false as const, error: ipcError('internal', `the fake front answers no ${name}`) };
      try {
        return { ok: true as const, value: await handler(input.value, client) };
      } catch (error) {
        return { ok: false as const, error: ipcError('internal', error instanceof Error ? error.message : String(error)) };
      }
    };
    return {
      serve(served) {
        port = served;
        connected += 1;
        served.on('message', ({ data }) => {
          if (readTolerant(HostReadySchema, data).ok) {
            isReady = true;
            return onReady();
          }
          const request = readTolerant(HostRequestSchema, data);
          if (!request.ok) return;
          const { id, name, input } = request.value;
          client.asked.push({ name, input });
          void answer(name, input).then((result) => served.postMessage({ t: 'res', id, ...result }));
        });
        served.start();
        welcome(client);
      },
      detach() {
        if (port === null) return;
        port = null;
        connected -= 1;
        onEnded();
      },
      docPort: (_message, end) => end.close(),
    };
  }

  const server: Server = createServer();
  const served = serveSocketClients(server, {
    many: { runtimeFor },
    badToken: 'close',
    identity: () => ({ protocol: SOCKET_PROTOCOL, minor: WIRE_MINOR, buildId: 'fake-front', capabilities: [], wire: 'fake-front', pid: process.pid, startedAt: new Date().toISOString() }),
    counts: () => ({ liveSessions: 0, rows: 0 }),
    token: () => token,
    onExit: () => {},
    log: () => {},
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(paths.sockets.machine, () => resolve());
  });
  return {
    profile,
    paths,
    token,
    client: () => {
      const taken = welcomed.shift();
      return taken ? Promise.resolve(taken) : new Promise((resolve) => waiting.push(resolve));
    },
    clients: () => connected,
    drop: () => served.closeClient(),
    close: () => {
      served.closeClient();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
