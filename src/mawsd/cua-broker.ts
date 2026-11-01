// The cold broker (P5 O17 M1; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §B, §C; acceptance 1 and
// 2): a chunk cua-socket.ts loads at the first peer it admits on a session with no app and no render host serving it,
// never at start, at an app's attachment or at a capability or inventory read. It is no browser: it greets an admitted
// connection with MAWS's hello and answers `tabs.query`, `windows.query` and `debugger.getTargets` with `[]` (a session
// with no live tab engine, never tabs hidden) while the route is `cold` or `starting`; `hostRefused` closes. Any other
// request, an unknown method included, is demand: the connection stops being served, its trigger frame and every byte
// after it are kept, it takes a place in cua-socket.ts's PENDING_BUDGET and the session's start (`ensureBrowser`, one
// per session and epoch, shared by its waiting connections) is asked for the render host's socket. At the answer, for
// the session's current epoch only, the connection is spliced: the render host's hello is read and suppressed (the
// broker already greeted, with the same instance and protocol), the trigger and everything after it are written to it
// once, the render host's bytes after its hello to cua, and the two are piped, ending together. A slow or failed start
// is a named error answered to the trigger, never an invented success. While cold nothing runs on a timer; a promotion's
// deadline is the only one.
//
// Bounds: CUA_COLD_BUDGET admitted connections served cold or promoting; one connection's held bytes (its unconsumed
// input and its unsent answers) at most one cua frame; every cold or promoting connection's together at most
// CUA_COLD_BUFFER_BYTES, the read that takes them past it closing its connection; reading stops while an answer is
// backpressured, until `drain`.
import { connect, type Socket } from 'node:net';
import type { AppSessionId } from '@shared/graph/ids';
import { assertPrivateSocket } from '@shared/host/private-path';
import { encodeFrame, type RpcMessage } from '../main/browser/cua/framing';

export const CUA_BROWSER_START_MS = 4_000; // the first real primitive: render host start, prepare and splice
export const CUA_PROMOTION_MAX_BYTES = 1_048_576; // one connection's buffered input while cold or promoting (one cua frame)
export const CUA_COLD_BUDGET = { session: 8, total: 64 }; // admitted connections served cold
export const CUA_COLD_BUFFER_BYTES = 4_194_304; // every cold or promoting connection's buffered input together
// cua-socket.ts's PENDING_BUDGET ({session: 8, total: 64}) now counts promotions waiting for the render host beside
// peer-root waits: the section's CUA_PROMOTION_BUDGET (D2)

// What MAWS's own backend greets with (src/main/browser/cua/connection.ts's PROTOCOL_VERSION and PROFILE_NAME, restated
// so this chunk does not take in the app's connection module; the test holds them equal). A non-empty profileName makes
// MAWS a cursor peer to cua's host (R6, point 6).
export const BROKER_PROTOCOL_VERSION = 1;
export const BROKER_PROFILE_NAME = 'MAWS';

// §B's route states, per session. browser-route.ts owns the route from M5; the broker reads it, never sets it.
export type BrowserRouteState = 'none' | 'relay' | 'cold' | 'starting' | 'headless';
export interface BrowserRouteReading {
  state: BrowserRouteState;
  epoch: string; // minted by mawsd each time the session's tab engine changes; what an older one binds is refused
}
export interface BrowserDemand { appSessionId: AppSessionId; epoch: string; deadline: number; signal: AbortSignal } // deadline: monotonic ms
export interface BrowserTarget { epoch: string; socketPath: string } // the path computed by mawsd (§D), never an engine's

export interface CuaBrokerLimits {
  startMs: number;
  connectionBytes: number; // one connection's held bytes
  bufferBytes: number; // every cold or promoting connection's together
  cold: { session: number; total: number };
}

export interface CuaBrokerOptions {
  machine: string;
  version: string; // MAWS's, in the hello
  route(appSessionId: AppSessionId): BrowserRouteReading;
  ensureBrowser(demand: BrowserDemand): Promise<BrowserTarget>; // RenderHandle.ensureBrowser (M5): starts or joins the render host, prepares the session
  place(appSessionId: AppSessionId): (() => void) | null; // a place in cua-socket.ts's PENDING_BUDGET, its release; null past it
  log(line: string): void;
  limits?: Partial<CuaBrokerLimits>; // the tests' smaller bounds
}

export interface CuaBrokerInspection {
  cold: number; // admitted, served cold
  promoting: number; // waiting for the start, or reading the render host's hello
  spliced: number; // piped to the render host
  buffered: number; // the held bytes of every cold or promoting connection
}

export interface CuaBroker {
  // a peer cua-socket.ts admitted, nothing of it read yet, under the epoch it was checked in: a route already past it closes it
  admit(appSessionId: AppSessionId, socket: Socket, epoch: string): void;
  routeChanged(appSessionId: AppSessionId): void; // the session's route moved: what an older epoch holds ends, its start is aborted
  end(appSessionId: AppSessionId): void; // every connection of the session ends, its start is aborted
  inspect(): CuaBrokerInspection;
  close(): void;
}

const HEADER_BYTES = 4;
const INVENTORY = new Set(['tabs.query', 'windows.query', 'debugger.getTargets']);
const EMPTY: Buffer = Buffer.alloc(0);

type Phase = 'cold' | 'promoting' | 'splicing' | 'spliced';

interface Connection {
  appSessionId: AppSessionId;
  epoch: string; // the route's epoch at admission: the connection is that epoch's
  socket: Socket;
  phase: Phase;
  input: Buffer; // cold: a frame not yet complete; promoting: the trigger and every byte after it
  triggerId: number | string | null;
  start: Start | null;
  free: (() => void) | null; // its place in the pending budget
  timer: NodeJS.Timeout | null; // its promotion's deadline
  target: Socket | null; // the render host's socket for the session, from the splice on
  onData(chunk: Buffer): void;
}

interface Start {
  epoch: string;
  controller: AbortController;
  waiters: Set<Connection>;
  timer: NodeJS.Timeout;
}

type Frame = { message: Record<string, unknown>; end: number } | { error: string } | null;

// The complete frame at `offset`, its message and where it ends; null while it is incomplete
function frameAt(input: Buffer, offset: number, maxBytes: number): Frame {
  if (input.length - offset < HEADER_BYTES) return null;
  const length = input.readUInt32LE(offset);
  if (length > maxBytes) return { error: `a frame of ${length} bytes` };
  const end = offset + HEADER_BYTES + length;
  if (input.length < end) return null;
  try {
    const message: unknown = JSON.parse(input.subarray(offset + HEADER_BYTES, end).toString('utf8'));
    if (typeof message !== 'object' || message === null || Array.isArray(message)) return { error: 'a frame that is no JSON-RPC message' };
    return { message: message as Record<string, unknown>, end };
  } catch {
    return { error: 'a frame that is not JSON' };
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createCuaBroker(options: CuaBrokerOptions): CuaBroker {
  const { machine, log } = options;
  const limits: CuaBrokerLimits = {
    startMs: CUA_BROWSER_START_MS,
    connectionBytes: CUA_PROMOTION_MAX_BYTES + HEADER_BYTES, // one maximal frame with its length
    bufferBytes: CUA_COLD_BUFFER_BYTES,
    cold: CUA_COLD_BUDGET,
    ...options.limits,
  };
  const frameBytes = Math.min(CUA_PROMOTION_MAX_BYTES, limits.connectionBytes);
  const connections = new Map<AppSessionId, Set<Connection>>();
  const starts = new Map<AppSessionId, Start>();
  let budgetNoted = false; // the line on a refusal past the cold budget, once per burst
  let placeNoted = false; // the line on a trigger past the pending budget, once per burst

  const all = () => [...connections.values()].flatMap((set) => [...set]);
  const unspliced = (set: Iterable<Connection>) => [...set].filter((connection) => connection.phase !== 'spliced');
  const held = (connection: Connection) => connection.input.length + connection.socket.writableLength;
  const buffered = () => unspliced(all()).reduce((sum, connection) => sum + held(connection), 0);
  const instanceOf = (appSessionId: AppSessionId) => `maws:${appSessionId}`;

  const send = (connection: Connection, message: RpcMessage) => void connection.socket.write(encodeFrame({ jsonrpc: '2.0', ...message }));
  const drop = (connection: Connection, why: string) => {
    log(`cua socket of ${connection.appSessionId}: closed a cold connection: ${why}`);
    connection.socket.destroy();
  };

  // Its place, its deadline and its share in the start given back; the start itself goes on for the others
  const settleWait = (connection: Connection) => {
    if (connection.timer) clearTimeout(connection.timer);
    connection.timer = null;
    connection.start?.waiters.delete(connection);
    connection.start = null;
    connection.free?.();
    connection.free = null;
  };

  // A promotion that cannot complete: the trigger answered with the reason, then the connection closed
  const fail = (connection: Connection, reason: string) => {
    if (connection.socket.destroyed || connection.socket.writableEnded) return;
    settleWait(connection);
    connection.target?.destroy();
    connection.socket.off('data', connection.onData); // nothing more is read into it
    if (connection.triggerId !== null) send(connection, { id: connection.triggerId, error: { code: 1, message: reason } });
    connection.socket.end();
    if (connection.socket.writableNeedDrain) connection.socket.destroy();
    else connection.socket.once('finish', () => connection.socket.destroy());
    remove(connection);
  };

  const remove = (connection: Connection) => {
    const set = connections.get(connection.appSessionId);
    set?.delete(connection);
    if (set?.size === 0) connections.delete(connection.appSessionId);
  };

  const closed = (connection: Connection) => {
    settleWait(connection);
    connection.target?.destroy();
    remove(connection);
  };

  // The bounds after each read: this connection's held bytes, then every cold or promoting connection's together
  const withinBounds = (connection: Connection): boolean => {
    if (held(connection) > limits.connectionBytes) return void drop(connection, `${held(connection)} bytes held, past ${limits.connectionBytes}`), false;
    const total = buffered();
    if (total > limits.bufferBytes) return void drop(connection, `the cold connections hold ${total} bytes, past ${limits.bufferBytes}`), false;
    return true;
  };

  const abort = (appSessionId: AppSessionId, start: Start) => {
    clearTimeout(start.timer);
    start.controller.abort();
    if (starts.get(appSessionId) === start) starts.delete(appSessionId);
  };

  const begin = (appSessionId: AppSessionId, epoch: string): Start => {
    const controller = new AbortController();
    const start: Start = {
      epoch,
      controller,
      waiters: new Set(),
      timer: setTimeout(() => {
        abort(appSessionId, start);
        for (const waiter of [...start.waiters]) fail(waiter, `the browser on ${machine} did not start within ${limits.startMs} ms`);
      }, limits.startMs),
    };
    starts.set(appSessionId, start);
    let answer: Promise<BrowserTarget>;
    try {
      answer = options.ensureBrowser({ appSessionId, epoch, deadline: performance.now() + limits.startMs, signal: controller.signal });
    } catch (error) {
      answer = Promise.reject(error);
    }
    answer.then(
      (target) => {
        clearTimeout(start.timer);
        if (starts.get(appSessionId) === start) starts.delete(appSessionId);
        // §B's linearization point: a splice only for the session's current epoch while its route is still starting
        // (or already headless, when the route's own answer to the start came first)
        const route = options.route(appSessionId);
        const current = target.epoch === start.epoch && route.epoch === start.epoch && (route.state === 'starting' || route.state === 'headless');
        for (const waiter of [...start.waiters]) {
          if (!current) {
            log(`cua socket of ${appSessionId}: the browser answered for epoch ${target.epoch}, the connection waited under ${start.epoch} and the route is ${route.state} at ${route.epoch}: closed, never spliced`);
            waiter.socket.destroy();
          } else splice(waiter, target);
        }
      },
      (error: unknown) => {
        clearTimeout(start.timer);
        if (starts.get(appSessionId) === start) starts.delete(appSessionId);
        for (const waiter of [...start.waiters]) fail(waiter, messageOf(error));
      },
    );
    return start;
  };

  // The trigger: the connection stops being served, keeps the trigger and every byte after it, takes a place and joins
  // the session's start for its epoch
  const demand = (connection: Connection, message: Record<string, unknown>, offset: number) => {
    connection.phase = 'promoting';
    connection.input = Buffer.from(connection.input.subarray(offset));
    connection.triggerId = message.id as number | string;
    const free = options.place(connection.appSessionId);
    if (free === null) {
      if (!placeNoted) log(`cua socket of ${connection.appSessionId}: refused triggers past the pending budget`);
      placeNoted = true;
      return fail(connection, `too many connections waiting for the browser on ${machine}`);
    }
    placeNoted = false;
    connection.free = free;
    const params = typeof message.params === 'object' && message.params !== null ? (message.params as Record<string, unknown>) : {};
    const own = typeof params.timeoutMs === 'number' && Number.isFinite(params.timeoutMs) && params.timeoutMs > 0 ? params.timeoutMs : Number.POSITIVE_INFINITY;
    const ms = Math.min(limits.startMs, own);
    connection.timer = setTimeout(() => fail(connection, `the browser on ${machine} did not start within ${ms} ms`), ms);
    const existing = starts.get(connection.appSessionId);
    if (existing && existing.epoch !== connection.epoch) abort(connection.appSessionId, existing);
    const start = existing && existing.epoch === connection.epoch ? existing : begin(connection.appSessionId, connection.epoch);
    connection.start = start;
    start.waiters.add(connection);
  };

  // A complete message from a cold connection
  const answer = (connection: Connection, message: Record<string, unknown>, offset: number) => {
    const { method, id } = message;
    if (typeof method !== 'string') return; // MAWS sends no requests, so no answer is expected: nothing to do
    if (id === undefined || id === null) {
      if (method === 'hostRefused') {
        const code = (message.params as { code?: unknown } | undefined)?.code;
        log(`cua's host refused MAWS on ${connection.appSessionId}'s socket: ${String(code)}`);
        connection.socket.destroy();
      }
      return; // any other notification is not for a broker
    }
    if (typeof id !== 'number' && typeof id !== 'string') return drop(connection, 'a request with an invalid id');
    const route = options.route(connection.appSessionId);
    if (route.epoch !== connection.epoch) return drop(connection, `its epoch ${connection.epoch} is no longer the route's ${route.epoch}`);
    if (INVENTORY.has(method) && (route.state === 'cold' || route.state === 'starting')) return send(connection, { id, result: [] });
    if (route.state === 'cold' || route.state === 'starting' || route.state === 'headless') return demand(connection, message, offset);
    drop(connection, `the route is ${route.state}`);
  };

  const serve = (connection: Connection) => {
    let offset = 0;
    while (connection.phase === 'cold' && !connection.socket.destroyed) {
      const frame = frameAt(connection.input, offset, frameBytes);
      if (frame === null) break;
      if ('error' in frame) return drop(connection, frame.error);
      const at = offset;
      offset = frame.end;
      answer(connection, frame.message, at);
    }
    if (connection.phase === 'cold' && offset > 0) connection.input = connection.input.length > offset ? Buffer.from(connection.input.subarray(offset)) : EMPTY;
  };

  const splice = (connection: Connection, target: BrowserTarget) => {
    if (connection.socket.destroyed) return;
    connection.phase = 'splicing';
    try {
      assertPrivateSocket(target.socketPath);
    } catch (error) {
      return fail(connection, `the browser on ${machine} is refused: ${messageOf(error)}`);
    }
    const engine = connect(target.socketPath);
    connection.target = engine;
    let heard = EMPTY;
    const close = (why: string) => {
      log(`cua socket of ${connection.appSessionId}: the browser's ${why}: closed, never forwarded`);
      engine.destroy();
      connection.socket.destroy();
    };
    const onHello = (chunk: Buffer) => {
      heard = heard.length > 0 ? Buffer.concat([heard, chunk]) : chunk;
      const frame = frameAt(heard, 0, frameBytes);
      if (frame === null) return;
      if ('error' in frame) return close(`hello is ${frame.error}`);
      const params = (frame.message.params ?? {}) as Record<string, unknown>;
      if (frame.message.method !== 'hello' || params.extensionInstanceId !== instanceOf(connection.appSessionId) || params.protocolVersion !== BROKER_PROTOCOL_VERSION) {
        return close(`hello is not this session's (${String(frame.message.method)} ${String(params.extensionInstanceId)} protocol ${String(params.protocolVersion)})`);
      }
      // the splice, in §C's order: both sides held, the trigger and its trailing bytes to the render host once, its own
      // bytes after the hello to cua, then piped both ways
      engine.pause();
      engine.off('data', onHello);
      connection.socket.pause();
      connection.socket.off('data', connection.onData);
      settleWait(connection);
      connection.phase = 'spliced';
      engine.write(connection.input);
      connection.input = EMPTY;
      const rest = heard.subarray(frame.end);
      if (rest.length > 0) connection.socket.write(rest);
      connection.socket.pipe(engine);
      engine.pipe(connection.socket);
    };
    engine.on('data', onHello);
    let error: string | null = null;
    engine.on('error', (cause: NodeJS.ErrnoException) => void (error ??= cause.code ?? cause.message));
    engine.on('close', () => {
      if (connection.phase === 'splicing') fail(connection, `the browser on ${machine} could not be reached${error ? ` (${error})` : ''}`);
      else connection.socket.destroy();
    });
  };

  const end = (appSessionId: AppSessionId) => {
    const start = starts.get(appSessionId);
    if (start) abort(appSessionId, start);
    for (const connection of [...(connections.get(appSessionId) ?? [])]) connection.socket.destroy();
  };

  return {
    admit(appSessionId, socket, epoch) {
      socket.on('error', () => {});
      const route = options.route(appSessionId);
      if (route.epoch !== epoch || (route.state !== 'cold' && route.state !== 'starting' && route.state !== 'headless')) return void socket.destroy();
      const set = connections.get(appSessionId) ?? new Set<Connection>();
      const inSession = unspliced(set).length;
      if (inSession >= limits.cold.session || unspliced(all()).length >= limits.cold.total) {
        if (!budgetNoted) log(`cua socket of ${appSessionId}: refused connections past the ${inSession >= limits.cold.session ? `session's ${limits.cold.session}` : `daemon's ${limits.cold.total}`} of the cold budget`);
        budgetNoted = true;
        return void socket.destroy();
      }
      budgetNoted = false;
      const connection: Connection = {
        appSessionId,
        epoch: route.epoch,
        socket,
        phase: 'cold',
        input: EMPTY,
        triggerId: null,
        start: null,
        free: null,
        timer: null,
        target: null,
        onData: (chunk) => {
          connection.input = connection.input.length > 0 ? Buffer.concat([connection.input, chunk]) : chunk;
          if (connection.phase === 'cold') serve(connection);
          if (socket.destroyed || connection.phase === 'spliced' || !withinBounds(connection)) return;
          if (socket.writableNeedDrain && !socket.isPaused()) {
            socket.pause(); // an answer is backpressured: nothing more is read until it drains
            socket.once('drain', () => connection.phase !== 'spliced' && socket.resume());
          }
        },
      };
      set.add(connection);
      connections.set(appSessionId, set);
      socket.on('data', connection.onData);
      socket.on('close', () => closed(connection));
      send(connection, { method: 'hello', params: { extensionId: 'maws', extensionInstanceId: instanceOf(appSessionId), version: options.version, protocolVersion: BROKER_PROTOCOL_VERSION, profileName: BROKER_PROFILE_NAME } });
      socket.resume();
    },
    routeChanged(appSessionId) {
      const { epoch } = options.route(appSessionId);
      const start = starts.get(appSessionId);
      if (start && start.epoch !== epoch) abort(appSessionId, start);
      for (const connection of [...(connections.get(appSessionId) ?? [])]) if (connection.epoch !== epoch) connection.socket.destroy();
    },
    end,
    inspect() {
      const every = all();
      return {
        cold: every.filter((connection) => connection.phase === 'cold').length,
        promoting: every.filter((connection) => connection.phase === 'promoting' || connection.phase === 'splicing').length,
        spliced: every.filter((connection) => connection.phase === 'spliced').length,
        buffered: buffered(),
      };
    },
    close() {
      for (const appSessionId of [...new Set([...connections.keys(), ...starts.keys()])]) end(appSessionId);
    },
  };
}
