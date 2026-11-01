// A machine.sock client for the services front's tests (P5 O3-E M2's, shared since P5 O4 M2): the hello with the
// front's token, the welcome, `ready`, then C1's envelope over the socket port. Each request names the page it is for;
// `gone` tells the front that page ended, `leave` ends the connection.
import { createConnection } from 'node:net';
import { expect, vi } from 'vitest';
import { SocketPort } from '@shared/host/socket-port';
import { SOCKET_PROTOCOL, splitLines } from '@shared/host/socket-protocol';
import { WIRE_MINOR } from '@shared/ipc/wire';

export type Evt = { t: 'evt'; name: string; payload: Record<string, unknown> };

export async function connectFront(path: string, token: string, appPid: number, cleanups: Array<() => void>) {
  const socket = createConnection(path);
  cleanups.push(() => socket.destroy());
  const rest = await new Promise<Buffer>((resolve, reject) => {
    const splitter = splitLines(
      (line) => {
        if ((JSON.parse(line) as { t: string }).t !== 'welcome') reject(new Error(`no welcome: ${line}`));
        return 'stop';
      },
      () => reject(new Error('a handshake line past the cap')),
    );
    const onData = (chunk: Buffer) => {
      splitter.push(chunk);
      socket.off('data', onData);
      resolve(splitter.rest());
    };
    socket.on('data', onData);
    socket.on('connect', () => socket.write(`${JSON.stringify({ t: 'hello', protocol: SOCKET_PROTOCOL, token, minor: WIRE_MINOR, build: 'test', capabilities: [], appPid })}\n`));
  });
  const port = new SocketPort(socket, rest, { log: () => {} });
  const events: Evt[] = [];
  const answers = new Map<string, Record<string, unknown>>();
  port.on('message', ({ data }) => {
    const message = data as { t?: string; id?: string };
    if (message.t === 'evt') events.push(data as Evt);
    else if (message.t === 'res') answers.set(message.id!, data as Record<string, unknown>);
  });
  port.start();
  port.postMessage({ t: 'ready' });
  let next = 0;
  const send = (name: string, input: unknown, page: string) => {
    const id = `r${++next}`;
    port.postMessage({ t: 'req', id, name, input, client: page });
    return id;
  };
  return {
    events,
    of: (name: string) => events.filter((event) => event.name === name),
    send,
    async request(name: string, input: unknown, page: string): Promise<Record<string, unknown>> {
      const id = send(name, input, page);
      await vi.waitFor(() => expect(answers.has(id)).toBe(true), { timeout: 10_000 });
      return answers.get(id)!;
    },
    gone: (page: string) => port.postMessage({ t: 'clientGone', client: page }),
    leave: () => socket.destroy(),
  };
}
