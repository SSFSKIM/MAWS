// The local listeners of forwarded ports (P5 O7 M3, "Forwarding"): one on this Mac's loopback at a port the system
// picks, its connections handed on, and its close taking every connection with it.
import { connect, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { listenLoopback } from './forwards';

const dial = (port: number) =>
  new Promise<Socket>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => resolve(socket));
    socket.once('error', reject);
  });

describe('listenLoopback', () => {
  it('listens on 127.0.0.1 at a port of its own and hands each connection on', async () => {
    const accepted: Socket[] = [];
    const listener = await listenLoopback((socket) => void accepted.push(socket));
    try {
      expect(listener.port).toBeGreaterThan(0);
      const client = await dial(listener.port);
      await expect.poll(() => accepted.length).toBe(1);
      expect(accepted[0].localAddress).toBe('127.0.0.1');
      client.destroy();
    } finally {
      listener.close();
    }
  });

  it('closes with its connections reset, and accepts no more', async () => {
    const listener = await listenLoopback(() => {});
    const client = await dial(listener.port);
    const closed = new Promise<boolean>((resolve) => client.once('close', (hadError) => resolve(hadError)));
    client.on('error', () => {});
    listener.close();
    await closed;
    await expect(dial(listener.port)).rejects.toThrow();
  });
});
