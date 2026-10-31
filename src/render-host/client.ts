// The render host's link to `mawsd` (P5 O5 M3; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, M3 "Touches",
// Interfaces §A, §E): one persistent `machine.sock` connection for the render host's whole life. The checks are the
// command line's (src/mawsd/machine-client.ts's `reachMachine`: the daemon directory before the token is read, the
// socket before the connect, RL §5.11), and so is the handshake but for what this client says of itself: its hello lists
// `render.client`, so `mawsd` may post it `render.request` (M4's front). Then C1's envelope over the socket port as any
// client's: requests by id, answered in any order, and `evt` frames, which reach `onEvent` once the root has said
// `ready` (the front posts to a ready client alone). Unlike the command line's link, it is never one per command and it
// tells its end once (`closed`), which ends the render host.
//
// `hostCall` adapts `invoke` to the render library's `call`: a `HostResponse` into the `CommandResult` main's host
// dispatch answers, so `composeRender` gets the same type from both roots. A request still waiting when the connection
// ends, and one asked after, is answered `host_unavailable` rather than rejected, as main's dispatch answers a host that
// is gone.
import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { DAEMON_FILES, type DaemonPaths } from '@shared/daemon/files';
import { assertPrivateDirectory, assertPrivateSocket, PrivatePathError } from '@shared/host/private-path';
import { SocketPort } from '@shared/host/socket-port';
import { PEER_CAPABILITIES, SOCKET_PROTOCOL, ServerWelcomeSchema, splitLines, type ServerWelcome } from '@shared/host/socket-protocol';
import { ipcError } from '@shared/ipc/errors';
import { HostEventSchema, HostResponseSchema, type HostResponse } from '@shared/ipc/host-protocol';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { readTolerant } from '@shared/ipc/tolerant';
import { WIRE_MINOR } from '@shared/ipc/wire';

export const HELLO_TIMEOUT_MS = 3_000;

export interface RenderClient {
  welcome: ServerWelcome;
  invoke(name: string, input: unknown): Promise<HostResponse>; // never rejects
  ready(): void; // the root can take work: the front may post it events from now on
  closed: Promise<string>; // resolves once, with why, when the connection ends
  close(): void;
}

export type Connected = { ok: true; client: RenderClient } | { ok: false; why: string };

export interface RenderClientOptions {
  build: string; // this build's id, as main's hellos name it
  onEvent(name: string, payload: unknown): void;
  helloTimeoutMs?: number;
}

export async function connectRenderClient(paths: DaemonPaths, options: RenderClientOptions): Promise<Connected> {
  let token: string;
  try {
    assertPrivateDirectory(paths.dir);
    token = readFileSync(join(paths.dir, DAEMON_FILES.token), 'utf8').trim();
    assertPrivateSocket(paths.sockets.machine);
  } catch (error) {
    if (error instanceof PrivatePathError) return { ok: false, why: `refused: ${error.message}` };
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return { ok: false, why: missing ? `no mawsd has served this profile, or it has exited (${(error as NodeJS.ErrnoException).path ?? paths.dir} is missing)` : String(error) };
  }
  const helloMs = options.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
  return new Promise<Connected>((resolve) => {
    const socket = createConnection(paths.sockets.machine);
    let settled = false;
    const settle = (connected: Connected) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (!connected.ok) socket.destroy();
      resolve(connected);
    };
    const refused = (why: string) => settle({ ok: false, why: `${paths.sockets.machine}: ${why}` });
    const deadline = setTimeout(() => refused(`no answer to the hello within ${helloMs / 1000} s`), helloMs);
    socket.on('error', (error: NodeJS.ErrnoException) => refused(error.code === 'ECONNREFUSED' || error.code === 'ENOENT' ? 'its socket is left from a mawsd that has exited' : error.message));
    socket.on('close', () => refused('mawsd closed the connection without a welcome (its token may have changed)'));
    let first: unknown = null;
    const splitter = splitLines(
      (line) => {
        try {
          first = JSON.parse(line);
        } catch {
          first = {};
        }
        return 'stop';
      },
      () => refused('a handshake line past the cap'),
    );
    const onData = (chunk: Buffer) => {
      splitter.push(chunk);
      if (first === null) return;
      socket.off('data', onData);
      const welcome = readTolerant(ServerWelcomeSchema, first);
      if (!welcome.ok) {
        const line = first as { t?: unknown; reason?: unknown };
        return refused(line.t === 'refuse' ? `mawsd refused the hello (${String(line.reason)})` : 'mawsd answered the hello with something other than a welcome');
      }
      socket.removeAllListeners('close');
      socket.removeAllListeners('error');
      settle({ ok: true, client: linked(new SocketPort(socket, splitter.rest(), { log: () => {} }), welcome.value, options.onEvent) });
    };
    socket.on('data', onData);
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ t: 'hello', protocol: SOCKET_PROTOCOL, token, minor: WIRE_MINOR, build: options.build, capabilities: [...PEER_CAPABILITIES.renderClient], appPid: process.pid })}\n`);
    });
  });
}

function linked(port: SocketPort, welcome: ServerWelcome, onEvent: RenderClientOptions['onEvent']): RenderClient {
  const waiting = new Map<string, (response: HostResponse) => void>();
  const gone = (id: string, why: string): HostResponse => ({ t: 'res', id, ok: false, error: ipcError('host_unavailable', why) });
  let ended: string | null = null;
  let tell!: (why: string) => void;
  const closed = new Promise<string>((resolve) => (tell = resolve));
  const end = (why: string) => {
    if (ended !== null) return;
    ended = why;
    for (const [id, answer] of waiting) answer(gone(id, why));
    waiting.clear();
    tell(why);
  };
  port.on('message', ({ data }) => {
    const response = readTolerant(HostResponseSchema, data);
    if (response.ok) {
      const answer = waiting.get(response.value.id);
      waiting.delete(response.value.id);
      return answer?.(response.value);
    }
    const event = readTolerant(HostEventSchema, data);
    if (event.ok) onEvent(event.value.name, event.value.payload);
  });
  port.onClose(() => end('mawsd closed the connection'));
  port.start();
  let next = 0;
  return {
    welcome,
    invoke(name, input) {
      const id = `render-${++next}`;
      if (ended !== null) return Promise.resolve(gone(id, ended));
      return new Promise<HostResponse>((resolve) => {
        waiting.set(id, resolve);
        if (port.postMessage({ t: 'req', id, name, input }) === false) end('mawsd stopped reading the connection');
      });
    },
    ready: () => void port.postMessage({ t: 'ready' }),
    closed,
    close() {
      end('the render host closed the connection');
      port.close();
    },
  };
}

// The render library's `call` over the client: a HostResponse into a CommandResult (the value unread, as main's host
// dispatch passes a host's answer on)
export function hostCall(invoke: RenderClient['invoke']): <N extends CommandName>(name: N, input: CommandInput<N>) => Promise<CommandResult<N>> {
  return async <N extends CommandName>(name: N, input: CommandInput<N>) => {
    const response = await invoke(name, input);
    return (response.ok ? { ok: true, value: response.value } : { ok: false, error: response.error }) as CommandResult<N>;
  };
}
