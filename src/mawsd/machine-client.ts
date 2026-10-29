// The command line's link to `machine.sock` (P5 O2 M6; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M6 "The
// commands"): one connection per command, never a start. The directory is checked before the token is read and the
// socket before the connect (RL §5.11: a symlink, another owner or a wider mode is refused, and the daemon counts as
// unreachable); then the hello with the token, the welcome, and C1's envelope over the socket port. machine.sock serves
// many clients at once, so the CLI never displaces the app's link.
import { readFileSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { join } from 'node:path';
import { DAEMON_FILES, type DaemonPaths } from '@shared/daemon/files';
import { assertPrivateDirectory, assertPrivateSocket, PrivatePathError } from '@shared/host/private-path';
import { SocketPort } from '@shared/host/socket-port';
import { SOCKET_PROTOCOL, splitLines, type ServerWelcome } from '@shared/host/socket-protocol';
import type { HostResponse } from '@shared/ipc/host-protocol';
import { WIRE_MINOR } from '@shared/ipc/wire';

export const HELLO_TIMEOUT_MS = 3_000;
export const REQUEST_TIMEOUT_MS = 10_000; // a request's default deadline; `enroll --wait` and `endpoint attest-history` take their own

export interface MachineLink {
  welcome: ServerWelcome;
  request(name: string, input: unknown, timeoutMs?: number): Promise<HostResponse>;
  close(): void;
}

// `down`: nothing answers (no token or socket, a stale socket, a closed or silent hello); `refused`: a path failed its
// private-path check, so the daemon counts as unreachable (down) and the reason is worth saying; `incompatible`: a daemon
// answered with a refusal (another protocol).
export type Reached = { ok: true; link: MachineLink } | { ok: false; state: 'down' | 'refused' | 'incompatible'; why: string };

export async function reachMachine(paths: DaemonPaths, options: { build: string; helloTimeoutMs?: number }): Promise<Reached> {
  const down = (why: string): Reached => ({ ok: false, state: 'down', why });
  let token: string;
  try {
    assertPrivateDirectory(paths.dir);
    token = readFileSync(join(paths.dir, DAEMON_FILES.token), 'utf8').trim();
    assertPrivateSocket(paths.sockets.machine);
  } catch (error) {
    if (error instanceof PrivatePathError) return { ok: false, state: 'refused', why: error.message };
    return down((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no daemon has served this profile, or it has exited' : String(error));
  }
  return new Promise<Reached>((resolve) => {
    const socket = createConnection(paths.sockets.machine);
    let settled = false;
    const settle = (reached: Reached) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (!reached.ok) socket.destroy();
      resolve(reached);
    };
    const deadline = setTimeout(() => settle(down(`no answer to the hello within ${(options.helloTimeoutMs ?? HELLO_TIMEOUT_MS) / 1000} s`)), options.helloTimeoutMs ?? HELLO_TIMEOUT_MS);
    socket.on('error', (error: NodeJS.ErrnoException) => settle(down(error.code === 'ECONNREFUSED' || error.code === 'ENOENT' ? 'its socket is left from a daemon that has exited' : error.message)));
    socket.on('close', () => settle(down('the daemon closed the connection without answering (its token may have changed)')));
    let first: Record<string, unknown> | null = null;
    const splitter = splitLines(
      (line) => {
        try {
          first = JSON.parse(line) as Record<string, unknown>;
        } catch {
          first = {};
        }
        return 'stop';
      },
      () => settle(down('a handshake line past the cap')),
    );
    const onData = (chunk: Buffer) => {
      splitter.push(chunk);
      if (!first) return;
      socket.off('data', onData);
      if (first.t !== 'welcome') {
        const refusal = first.t === 'refuse' ? `refused the hello (${String(first.reason)}; it speaks protocol ${String(first.protocol)}, this command ${SOCKET_PROTOCOL})` : 'answered the hello with something other than a welcome';
        return settle({ ok: false, state: 'incompatible', why: `mawsd ${refusal}` });
      }
      socket.removeAllListeners('close');
      settle({ ok: true, link: link(socket, splitter.rest(), first as unknown as ServerWelcome) });
    };
    socket.on('data', onData);
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ t: 'hello', protocol: SOCKET_PROTOCOL, token, minor: WIRE_MINOR, build: options.build, capabilities: [], appPid: process.pid })}\n`);
    });
  });
}

function link(socket: Socket, rest: Buffer, welcome: ServerWelcome): MachineLink {
  const port = new SocketPort(socket, rest, { log: () => {} });
  const waiting = new Map<string, { done: (response: HostResponse) => void; fail: (error: Error) => void }>();
  let closed = false;
  port.on('message', ({ data }) => {
    const message = data as { t?: unknown; id?: unknown };
    if (message.t !== 'res' || typeof message.id !== 'string') return;
    waiting.get(message.id)?.done(data as HostResponse);
  });
  port.onClose(() => {
    closed = true;
    for (const { fail } of waiting.values()) fail(new Error('mawsd closed the connection before it answered'));
  });
  port.start();
  let next = 0;
  return {
    welcome,
    request(name, input, timeoutMs = REQUEST_TIMEOUT_MS) {
      if (closed) return Promise.reject(new Error('mawsd closed the connection'));
      const id = `cli-${++next}`;
      return new Promise<HostResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(new Error(`mawsd did not answer ${name} within ${Math.round(timeoutMs / 1000)} s`));
        }, timeoutMs);
        const finish = () => {
          clearTimeout(timer);
          waiting.delete(id);
        };
        waiting.set(id, {
          done: (response) => (finish(), resolve(response)),
          fail: (error) => (finish(), reject(error)),
        });
        port.postMessage({ t: 'req', id, name, input });
      });
    },
    close() {
      closed = true;
      socket.destroy();
    },
  };
}
