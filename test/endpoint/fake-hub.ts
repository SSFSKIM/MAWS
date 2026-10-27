// A stand-in for the hub's RL1 side, for the hub link's own suite (O10 M3): one WebSocket server on loopback that
// refuses the upgrades a test queues (status and body as the hub answers them), welcomes the rest with a rising
// generation, answers `hb` with `hb-ack` unless told not to, and lets the test send any frame or close any connection
// with any code. The verdicts the real hub gives on a cut, a rename or a replacement are proved against desk-hub's own
// hub in hub-link.local.test.ts; this one gives the cases a real hub can't be made to give on demand, quickly.
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

export type Upgrade = { at: number; headers: Record<string, string | string[] | undefined> };
export type Received = { conn: number; frame: { t: string } & Record<string, unknown> } | { conn: number; binary: Buffer };

export class FakeHub {
  readonly upgrades: Upgrade[] = [];
  readonly received: Received[] = [];
  readonly sockets: WebSocket[] = [];
  /** The answers the next upgrades get, in order; an upgrade with none queued is accepted. */
  readonly refusals: Array<{ status: number; body: string }> = [];
  /** Whether `hb` is answered. */
  ack = true;
  /** Whether a hello is welcomed. */
  welcomes = true;
  heartbeatMs = 100;
  /** Fields the welcome carries beside `t` and `generation` (heartbeat_ms unless replaced). */
  welcomeFields: Record<string, unknown> | null = null;
  generation = 0;
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  url = '';

  async start(): Promise<this> {
    this.wss = new WebSocketServer({ noServer: true });
    this.server = createServer((_request, response) => response.writeHead(404).end());
    this.server.on('upgrade', (request, socket: Socket, head) => {
      this.upgrades.push({ at: Date.now(), headers: request.headers });
      const refusal = this.refusals.shift();
      if (refusal !== undefined) {
        socket.end(`HTTP/1.1 ${refusal.status} Refused\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(refusal.body)}\r\nconnection: close\r\n\r\n${refusal.body}`);
        return;
      }
      this.wss!.handleUpgrade(request, socket, head, (ws) => this.accept(ws));
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  /** Queues a refusal of the next upgrade with `status` and `{error}` (or a raw body). */
  refuse(status: number, error: string, raw = false): void {
    this.refusals.push({ status, body: raw ? error : JSON.stringify({ error, message: 'refused by the fake hub' }) });
  }

  private accept(ws: WebSocket): void {
    const conn = this.sockets.length;
    this.sockets.push(ws);
    ws.on('message', (data, isBinary) => {
      if (isBinary) return void this.received.push({ conn, binary: Buffer.from(data as Buffer) });
      const frame = JSON.parse(String(data)) as { t: string } & Record<string, unknown>;
      this.received.push({ conn, frame });
      if (frame.t === 'hello' && !('project' in frame) && this.welcomes) {
        this.generation += 1;
        ws.send(JSON.stringify({ t: 'welcome', generation: this.generation, ...(this.welcomeFields ?? { heartbeat_ms: this.heartbeatMs }) }));
      }
      if (frame.t === 'hb' && this.ack) ws.send(JSON.stringify({ t: 'hb-ack', generation: frame.generation }));
    });
  }

  /** The newest connection. */
  get current(): WebSocket {
    const ws = this.sockets.at(-1);
    if (ws === undefined) throw new Error('no connection yet');
    return ws;
  }

  /** The text frames received, of kind `t` when given. */
  frames(t?: string): Array<{ conn: number; frame: { t: string } & Record<string, unknown> }> {
    return this.received.filter((r): r is Extract<Received, { frame: unknown }> => 'frame' in r && (t === undefined || r.frame.t === t));
  }

  async close(): Promise<void> {
    for (const ws of this.sockets) ws.terminate();
    this.wss?.close();
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => (this.server === null ? resolve() : this.server.close(() => resolve())));
  }
}

/** Polls `check` every 10 ms until it holds, or fails after `ms` naming `what`. */
export async function until(check: () => boolean, what: string, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
