// RL10's socket (O10 M6; Interfaces §D): the local Unix socket the sminos daemon reaches the endpoint on, and
// `rl10.json`, which tells it where. Newline-delimited JSON, one frame per line, at most 1 MiB a line (larger text as
// DX2's `part`s), one ordered stream with no per-frame acknowledgement.
//
// The socket is created at a temporary name, `chmod 0600`, and renamed into place, in a directory
// `assertPrivateDirectory` accepts: `<stateDir>/rl10.sock`, or, when that path is past what a Unix socket's address
// holds, `rl10.sock` in a private directory of this uid's under the system's temporary directory (O2's long-path
// fallback, which `mawsd` will give; `rl10.json` names the path taken). `rl10.json` is `{socket, pid, build, token,
// protocol: 1}`, 0600, written atomically: the token (32 random bytes as 64 hex, new each time it is served) is what a
// connection proves it read the file with. Both exist only while the endpoint serves (`serve` to `close`).
//
// A connection's first line is sminos's `hello` with the token, within `HELLO_MS`: the endpoint writes nothing before
// the token checks out and closes on a wrong one. One connection is served at a time; a new one that checks out
// replaces the last. Every frame after the hello is handed on in order, each awaited before the next line is read, so a
// frame's effects (an upload's signature) are done before the frame behind it is seen.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PartAssembler, toWire, type Part } from 'desk-hub/protocol';
import { assertPrivateDirectory } from '@shared/host/private-path';
import { removeFile, writeAtomic } from '../state/files';

export const RL10_PROTOCOL = { major: 1, minor: 0 } as const;
/** A line, either way, at most this many bytes of UTF-8 (its newline aside); a larger frame goes as parts. */
export const LINE_LIMIT = 1024 * 1024;
/** How long a connection has to send its hello. */
export const HELLO_MS = 10_000;
/** What a connection may hold unread by sminos before it is given up (sminos stopped reading). */
const UNREAD_LIMIT = 64 * 1024 * 1024;
/** The longest path a Unix socket's address holds (macOS's 104 bytes with its terminator; Linux's is 108). */
const SOCKET_PATH_LIMIT = process.platform === 'linux' ? 107 : 103;

export type Frame = { t: string } & Record<string, unknown>;

/** One sminos connection, after its hello checked out. */
export interface Rl10Connection {
  readonly id: number;
  send(frame: object): void;
  close(): void;
  readonly closed: boolean;
}

export type ServerHandlers = {
  /** A hello whose token checked out; the connection is the one served from now on. */
  hello(connection: Rl10Connection, hello: Frame): void | Promise<void>;
  frame(connection: Rl10Connection, frame: Frame): void | Promise<void>;
  closed(connection: Rl10Connection): void;
};

export type Rl10Info = { socket: string; pid: number; build: string; token: string; protocol: 1 };

/** What the socket is bound as before its rename into place: `<path>.<8 characters>`. */
const temporaryOf = (path: string) => `${path}.${randomBytes(6).toString('base64url')}`;
const TEMPORARY_EXTRA = 9;

/**
 * Where the socket goes: `<stateDir>/rl10.sock`, or the long-path fallback (see the header) when that path, or the
 * temporary name it is bound as first, is past the address limit (macOS truncates a longer one silently).
 */
export function socketPath(stateDir: string): string {
  const inside = join(stateDir, 'rl10.sock');
  if (Buffer.byteLength(inside) + TEMPORARY_EXTRA <= SOCKET_PATH_LIMIT) return inside;
  const uid = process.getuid?.() ?? 0;
  const dir = join(tmpdir(), `mawsd-rl10-${uid}-${createHash('sha256').update(stateDir).digest('hex').slice(0, 16)}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700 });
  return join(dir, 'rl10.sock');
}

export class Rl10Server {
  readonly #stateDir: () => string;
  readonly #build: string;
  readonly #handlers: ServerHandlers;
  readonly #log: (line: string) => void;
  #server: Server | null = null;
  /** The state directory `rl10.json` was written to. */
  #dir: string | null = null;
  #path: string | null = null;
  #token: Buffer | null = null;
  #current: Connection | null = null;
  #next = 1;

  /** `stateDir` is read as it serves (the module's, once started). */
  constructor(options: { stateDir: () => string; build: string; handlers: ServerHandlers; log(line: string): void }) {
    this.#stateDir = options.stateDir;
    this.#build = options.build;
    this.#handlers = options.handlers;
    this.#log = options.log;
  }

  get serving(): boolean {
    return this.#server !== null;
  }

  /** The connection served now, or null. */
  get current(): Rl10Connection | null {
    return this.#current?.closed === false ? this.#current : null;
  }

  /** Binds the socket and writes `rl10.json`; nothing when it serves already. */
  async serve(): Promise<void> {
    if (this.#server !== null) return;
    const stateDir = this.#stateDir();
    const path = socketPath(stateDir);
    assertPrivateDirectory(join(path, '..'));
    const temporary = temporaryOf(path);
    const server = createServer((socket) => this.#accept(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(temporary, () => {
        server.off('error', reject);
        resolve();
      });
    });
    try {
      fs.chmodSync(temporary, 0o600);
      fs.renameSync(temporary, path);
    } catch (error) {
      server.close();
      fs.rmSync(temporary, { force: true });
      throw error;
    }
    server.on('error', (error) => this.#log(`endpoint: the RL10 socket failed: ${error.message}`));
    const token = randomBytes(32);
    const info: Rl10Info = { socket: path, pid: process.pid, build: this.#build, token: token.toString('hex'), protocol: 1 };
    writeAtomic(stateDir, 'rl10.json', `${JSON.stringify(info)}\n`);
    this.#server = server;
    this.#dir = stateDir;
    this.#path = path;
    this.#token = token;
    this.#log('endpoint: serving RL10 (rl10.json written)');
  }

  /** Closes the connection and the socket, and removes `rl10.json` and the socket. */
  async close(): Promise<void> {
    const server = this.#server;
    if (server === null) return;
    this.#server = null;
    this.#token = null;
    if (this.#dir !== null) removeFile(this.#dir, 'rl10.json');
    if (this.#path !== null) fs.rmSync(this.#path, { force: true });
    this.#path = null;
    this.#current?.close();
    this.#current = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.#log('endpoint: RL10 is no longer served (rl10.json removed)');
  }

  #accept(socket: Socket): void {
    const connection = new Connection(this.#next++, socket, this.#log);
    let hello = true;
    const timer = setTimeout(() => connection.close(), HELLO_MS);
    timer.unref?.();
    connection.read(async (line) => {
      if (hello) {
        hello = false;
        clearTimeout(timer);
        const frame = parse(line);
        if (frame?.t !== 'hello' || !this.#tokenMatches(frame.token)) {
          this.#log('endpoint: an RL10 connection without the token was closed');
          return connection.close();
        }
        const previous = this.#current;
        this.#current = connection;
        previous?.close();
        connection.onClose(() => {
          if (this.#current === connection) this.#current = null;
          this.#handlers.closed(connection);
        });
        return this.#handlers.hello(connection, frame);
      }
      const frame = connection.assemble(line);
      if (frame !== null) await this.#handlers.frame(connection, frame);
    });
  }

  #tokenMatches(token: unknown): boolean {
    if (this.#token === null || typeof token !== 'string' || !/^[0-9a-fA-F]{64}$/.test(token)) return false;
    return timingSafeEqual(Buffer.from(token.toLowerCase(), 'hex'), this.#token);
  }
}

const parse = (line: string): Frame | null => {
  try {
    const value = JSON.parse(line) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as { t?: unknown }).t === 'string' ? (value as Frame) : null;
  } catch {
    return null;
  }
};

class Connection implements Rl10Connection {
  readonly #socket: Socket;
  readonly #log: (line: string) => void;
  readonly #parts = new PartAssembler();
  readonly #closers: Array<() => void> = [];
  #buffer = Buffer.alloc(0);
  #closed = false;

  constructor(
    readonly id: number,
    socket: Socket,
    log: (line: string) => void,
  ) {
    this.#socket = socket;
    this.#log = log;
    socket.on('close', () => this.#end());
    socket.on('error', () => this.#end());
  }

  get closed(): boolean {
    return this.#closed;
  }

  onClose(run: () => void): void {
    this.#closers.push(run);
  }

  /** Reads lines, handing each to `each` in order, the next only once the last is done. */
  read(each: (line: string) => Promise<void> | void): void {
    let queue: Promise<void> = Promise.resolve();
    this.#socket.on('data', (chunk: Buffer) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      for (;;) {
        const end = this.#buffer.indexOf(10);
        if (end < 0) break;
        const line = this.#buffer.subarray(0, end).toString('utf8');
        this.#buffer = this.#buffer.subarray(end + 1);
        if (end > LINE_LIMIT) {
          this.#log('endpoint: an RL10 line past 1 MiB closed its connection');
          return this.close();
        }
        if (line === '') continue;
        queue = queue.then(() => (this.#closed ? undefined : each(line))).catch((error: unknown) => this.#log(`endpoint: an RL10 frame failed: ${(error as Error).message}`));
      }
      if (this.#buffer.length > LINE_LIMIT) {
        this.#log('endpoint: an RL10 line past 1 MiB closed its connection');
        this.close();
      }
    });
  }

  /** A whole frame from a line: the line's own, or the one its `part` completes; null otherwise (said once). */
  assemble(line: string): Frame | null {
    const frame = parse(line);
    if (frame === null) {
      this.#log('endpoint: an RL10 line that is no frame was ignored');
      return null;
    }
    if (frame.t !== 'part') return frame;
    try {
      const whole = this.#parts.add(frame as unknown as Part);
      return whole === undefined ? null : typeof whole === 'object' && whole !== null && typeof (whole as Frame).t === 'string' ? (whole as Frame) : null;
    } catch (error) {
      this.#log(`endpoint: an RL10 frame sent as parts was dropped: ${(error as Error).message}`);
      return null;
    }
  }

  send(frame: object): void {
    if (this.#closed) return;
    if (this.#socket.writableLength > UNREAD_LIMIT) {
      this.#log('endpoint: sminos took no RL10 frames for a long while; its connection is closed');
      return this.close();
    }
    for (const line of toWire(frame, LINE_LIMIT)) this.#socket.write(`${line}\n`);
  }

  close(): void {
    this.#socket.destroy();
    this.#end();
  }

  #end(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const run of this.#closers) run();
  }
}
