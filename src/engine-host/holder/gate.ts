// O16 M5: the gate, OX10's server (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M5 and Interfaces §E; D13, D14,
// D27, D29, D37). The engine host serves `<profile>/supervisor/gate.sock`, where sminos's observer bridge inside a lane B
// process connects: newline-delimited JSON, many clients, no token (the uid boundary: the socket reveals no session data
// and takes no control). A server of its own over `node:net` with @shared/host/private-listen's checks, since
// @shared/host/socket-server speaks the token-authenticated host protocol in both its modes.
//
// An observer's first line is `hello {protocol: 1, session, pid, childPid}`. It is keyed by `session`, the engine
// session id, against each row's lineage (durable-crons.ts keeps it; a replay row has no pid and the mod reads none of
// its own), its `pid` a cross-check when both are known; a hello no row matches is closed with nothing written, so a
// `claude` a tool starts under the engine, which inherits MAWS_HOLDER_SOCKET, gets nothing. A matched observer is
// welcomed and its `childPid` registered as infrastructure for the descendant veto; a later hello for the same session
// (its reconnect, whenever its connection closed) replaces the older connection.
//
// Health (D29): an observer is healthy while its last hello or heartbeat is under OBSERVER_SILENCE_MS old; once seen on
// the process, a silence past that or a closed connection makes it unhealthy until a fresh hello; a row whose process
// never had one is absent (owner Q1). The row is told each change (its listener's `health`) and the first hello of the
// process (`seen`, which the session keeps in its state file as `observerSeenLaunch`, D37).
//
// The reap (reap.ts) drives the fence through its row's channel (`arm`, `disarm`) and answers the observer's `armed` and
// `turn` through its listener; a turn on a row with no listener is answered `proceed`. Each row's channel lives from
// the launch's reservation to its exit (`close`).
import { chmodSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { clearSocketPath, makePrivateDirectory } from '@shared/host/private-listen';
import { splitLines } from '@shared/host/socket-protocol';
import { socketPathFor, SOCKET_PATH_MAX_BYTES } from '../supervisor-files';

export const GATE_PROTOCOL = 1;
export const GATE_SOCKET = 'gate.sock';
export const OBSERVER_SILENCE_MS = 15_000; // the bridge beats every 5 s
export const HELLO_WINDOW_MS = 5_000; // a connection that has not said hello by then is closed
export const GATE_LINE_CAP = 64 * 1024; // the protocol's frames are a few hundred bytes
export const STOP_REASON = 'The holder ended this session; reopening it continues the conversation.'; // O12 M4's text, streamed as the refused turn's one chunk

export type ObserverState = 'absent' | 'healthy' | 'unhealthy';
export type TurnAnswer = 'proceed' | 'stop';

// What the reap hears from its row's observer.
export interface GateListener {
  armed(fence: number): void;
  turn(fence: number, origin: string, delivery: string | null): TurnAnswer; // answered at once
  health(state: ObserverState): void;
}

// A row as the gate matches hellos against it.
export interface GateRow {
  lineage(): ReadonlySet<string>; // every engine session id the process has carried
  pid(): number | null; // the engine's pid, null on a replay
  seen?(): void; // the first hello of this process
}

export interface GateChannel {
  readonly observer: ObserverState;
  readonly childPid: number | null; // the bridge child the observer's hello named
  arm(fence: number, leaseMs: number): void;
  disarm(fence: number): void;
  listen(listener: GateListener): void;
  close(): void; // the row's process exited: its observer is closed and no hello matches it again
}

// The gate's socket: in the supervisor directory, or beside the engine host's own socket in its tmpdir fallback when
// that path would pass the socket limit (supervisor-files.ts socketPathFor).
export function gateSocketPath(supervisorDir: string, userData: string, tmp: string = tmpdir()): string {
  const inDir = join(supervisorDir, GATE_SOCKET);
  if (Buffer.byteLength(inDir, 'utf8') <= SOCKET_PATH_MAX_BYTES) return inDir;
  return join(dirname(socketPathFor(supervisorDir, userData, tmp)), GATE_SOCKET);
}

interface Connection { socket: Socket; row: Row | null }

class Row implements GateChannel {
  conn: Connection | null = null;
  seenOnce = false;
  healthy = false;
  closed = false;
  child: number | null = null;
  listener: GateListener | null = null;
  private silence: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly match: GateRow, private readonly silenceMs: number, private readonly dropped: (row: Row) => void) {}

  get observer(): ObserverState {
    return !this.seenOnce ? 'absent' : this.healthy ? 'healthy' : 'unhealthy';
  }

  get childPid(): number | null {
    return this.child;
  }

  arm(fence: number, leaseMs: number): void {
    this.write({ t: 'arm', fence, leaseMs });
  }

  disarm(fence: number): void {
    this.write({ t: 'disarm', fence });
  }

  listen(listener: GateListener): void {
    this.listener = listener;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.dropped(this);
    this.stopSilence();
    this.conn?.socket.destroy();
    this.conn = null;
  }

  write(frame: Record<string, unknown>): void {
    if (this.conn && !this.conn.socket.destroyed) this.conn.socket.write(`${JSON.stringify(frame)}\n`);
  }

  // A hello for this row: the connection becomes its observer's, heard now.
  hello(conn: Connection, childPid: number | null): void {
    const previous = this.conn;
    this.conn = conn;
    conn.row = this;
    if (previous && previous !== conn) {
      previous.row = null;
      previous.socket.destroy();
    }
    this.child = childPid;
    const first = !this.seenOnce;
    this.seenOnce = true;
    this.write({ t: 'welcome', protocol: GATE_PROTOCOL });
    if (first) this.match.seen?.();
    this.heard(true);
  }

  // A heartbeat (or the hello): healthy for another silence window. Heard while unhealthy only by a fresh hello.
  heard(hello: boolean): void {
    if (!this.healthy && !hello) return;
    this.stopSilence();
    this.silence = setTimeout(() => this.unhealthy(), this.silenceMs);
    (this.silence as { unref?: () => void }).unref?.();
    if (!this.healthy) {
      this.healthy = true;
      this.listener?.health('healthy');
    }
  }

  // Silence past the window, or the observer's connection gone.
  unhealthy(): void {
    this.stopSilence();
    if (!this.healthy || this.closed) return;
    this.healthy = false;
    this.listener?.health('unhealthy');
  }

  private stopSilence(): void {
    if (this.silence !== null) clearTimeout(this.silence);
    this.silence = null;
  }
}

export class Gate {
  private server: Server | null = null;
  private readonly rows = new Set<Row>();
  private readonly connections = new Set<Connection>();
  private readonly silenceMs: number;
  private readonly helloWindowMs: number;

  constructor(private readonly opts: { log(line: string): void; silenceMs?: number; helloWindowMs?: number }) {
    this.silenceMs = opts.silenceMs ?? OBSERVER_SILENCE_MS;
    this.helloWindowMs = opts.helloWindowMs ?? HELLO_WINDOW_MS;
  }

  // A row's channel, from its reservation until its exit closes it.
  channel(match: GateRow): GateChannel {
    const row = new Row(match, this.silenceMs, (gone) => this.rows.delete(gone));
    this.rows.add(row);
    return row;
  }

  // Listens at `path` (0600, its directory made 0700 when missing and checked as every host's is); throws when the
  // path cannot be taken.
  async listen(path: string): Promise<void> {
    makePrivateDirectory(dirname(path));
    clearSocketPath(path);
    const server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(path, () => {
        server.off('error', reject);
        resolve();
      });
    });
    chmodSync(path, 0o600);
    server.on('error', (error) => this.opts.log(`the gate's server failed: ${error.message}`));
    this.server = server;
  }

  // Stops listening (the socket file goes with the server) and closes every observer.
  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const conn of this.connections) conn.socket.destroy();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private accept(socket: Socket): void {
    const conn: Connection = { socket, row: null };
    this.connections.add(conn);
    const window = setTimeout(() => {
      if (conn.row === null) socket.destroy();
    }, this.helloWindowMs);
    (window as { unref?: () => void }).unref?.();
    const splitter = splitLines((line) => this.frame(conn, line), () => socket.destroy(), GATE_LINE_CAP);
    socket.on('data', (chunk: Buffer) => splitter.push(chunk));
    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(window);
      this.connections.delete(conn);
      if (conn.row && conn.row.conn === conn) {
        conn.row.conn = null;
        conn.row.unhealthy();
      }
    });
  }

  private frame(conn: Connection, line: string): void {
    let frame: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      frame = parsed as Record<string, unknown>;
    } catch {
      conn.socket.destroy();
      return;
    }
    const row = conn.row;
    if (row === null) return this.hello(conn, frame);
    if (row.conn !== conn) return; // replaced
    switch (frame.t) {
      case 'hello':
        return this.hello(conn, frame);
      case 'hb':
        return row.heard(false);
      case 'armed':
        if (typeof frame.fence === 'number') row.listener?.armed(frame.fence);
        return;
      case 'turn': {
        if (typeof frame.fence !== 'number') return;
        const origin = typeof frame.origin === 'string' ? frame.origin : 'unknown';
        const delivery = typeof frame.delivery === 'string' ? frame.delivery : null;
        const answer = row.listener?.turn(frame.fence, origin, delivery) ?? 'proceed';
        row.write(answer === 'stop' ? { t: 'stop', fence: frame.fence, reason: STOP_REASON } : { t: 'proceed', fence: frame.fence });
        return;
      }
      default:
        return; // a frame of a later protocol minor
    }
  }

  // The first line, or a reconnect's on the same connection: matched to a row or closed with nothing written.
  private hello(conn: Connection, frame: Record<string, unknown>): void {
    const session = frame.session;
    const pid = typeof frame.pid === 'number' ? frame.pid : null;
    if (frame.t !== 'hello' || frame.protocol !== GATE_PROTOCOL || typeof session !== 'string') {
      conn.socket.destroy();
      return;
    }
    const row = [...this.rows].find((r) => {
      if (r.closed || !r.match.lineage().has(session)) return false;
      const rowPid = r.match.pid();
      return pid === null || rowPid === null || pid === rowPid;
    });
    if (!row) {
      this.opts.log(`gate: a hello for engine session ${session}${pid === null ? '' : ` (pid ${pid})`} matches no row; closed`);
      conn.socket.destroy();
      return;
    }
    row.hello(conn, typeof frame.childPid === 'number' ? frame.childPid : null);
  }
}
