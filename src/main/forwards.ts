// The local listeners of forwarded ports (P5 O7 M3, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "Forwarding"; Interfaces §K): a TCP listener on this Mac's loopback at a port the system picks, which the in-app
// browser loads a loopback link of a session on another machine from. Each connection it accepts is handed to the
// forward that owns it (src/main/lane-b/remote-forward.ts), which carries it to the machine as a `tcp` stream. A
// listener lives until `remote.forward.close`, its machine's link closes, or the app quits (remote lane B's `stop`, a
// shutdown step in src/main/app.ts); its close resets every connection it accepted. It binds 127.0.0.1 only.
import { createServer, type Socket } from 'node:net';

export interface LocalListener {
  readonly port: number;
  /** Stops listening and resets every connection it accepted. */
  close(): void;
}

export function listenLoopback(onConnection: (socket: Socket) => void): Promise<LocalListener> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    onConnection(socket);
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
          for (const socket of sockets) socket.resetAndDestroy();
          sockets.clear();
        },
      });
    });
  });
}
