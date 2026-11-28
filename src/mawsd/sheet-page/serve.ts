// The page server, as `mawsd` runs it (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §J; T1 to
// T6): the decision to serve, the two HTTP servers, the state, the timer. On the daemon's run path; it imports Node
// builtins and its siblings' constants and types, asks for `node:http` only once it has decided to serve, and all that
// answers a request (handler.ts: the routes, the pairing, the bundle's table, the WebSocket) is one chunk loaded at the
// first request or pairing command.
//
// Who serves (T2): the default daemon, while SHEET_PAGE_DEFAULT_ON, and any `mawsd` under MAWS_SHEET_PAGE=1;
// MAWS_SHEET_PAGE=0 turns it off in any. The daemon's own environment decides first, and only a daemon that is going to
// serve reads the login shell's (for the port, and a MAWS_SHEET_PAGE=0 exported there), so one that serves no page
// starts no shell and loads nothing for it. A build with no bundle serves nothing (T5).
//
// Where (T3, T4): `127.0.0.1` and `::1`, each named, the same port on both, each `exclusive`, the second `ipv6Only`; on
// neither unless it holds both (the name resolves to both, so a process on the other address would answer under the
// page's origin), but on `127.0.0.1` alone where the machine has no IPv6 loopback. A taken port is not served and is
// tried again every `portRetryMs`; it never moves to another, since the port is part of the page's origin.
//
// How (T1, §J): Node's HTTP server owns each listener, so that its own deadlines run (it checks them only for a server
// that listens, and only at each `connectionsCheckingInterval`, which is why that is a second here). Every answer
// carries the standing headers, Node's own among them: `requireHostHeader` is off so a request with no Host reaches
// the Host check, and `clientError`, `checkContinue` and `checkExpectation` are answered by headers.ts's refusal. The
// parser collects one header more than HEADERS_MAX, so the checks only ever read a complete list. At most
// CONNECTIONS_MAX connections across both servers; one past it is destroyed at once. Node's deadlines end when a request
// is complete, so a response a client stops reading would hold its slot for good: a connection with bytes queued that
// its peer has taken none of for `stallMs` (no write completed, the queue never empty) is ended, which releases it.
//
// The registration (T18, §O): while listening, the page's file under the sminos home is written at once and then at
// each tick of the page server's timer, which needs nothing loaded; the home is `sminosHome` over the daemon's
// environment and, unless that names SMINOS_HOME, the one capture of the login shell's, the rule C3's reader reads by.
// A stop removes the file if it still names this process.
//
// Never in the way (T6): `start()` returns at once and nothing in it can stop or delay the daemon; each failure is a
// state and a log line. `stop()` ends the listeners and every connection within half a second.
import { existsSync } from 'node:fs';
import type * as Http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import type { DaemonSheetPage } from '@shared/ipc/schema/daemon';
import { sminosHome } from '../../services/lane-a/discovery';
import type { SpineState } from '../spine-seam';
import type { SheetPageChunk, SheetPageHandler } from './handler';
import { HEADERS_MAX, pageOrigin, refusal, refusalBytes, refusalHeaders, SHEET_HOST, SHEET_PORT, type Refusal } from './headers';
import type { BrowserList, SheetPairAnswer } from './pairing';
import { registrationName, removeRegistration, writeRegistration } from './registration';
import type { SheetAccess } from './sheets';
import { SHEET_PAGE_TIMING, type SheetPageTiming } from './timing';

export { SHEET_HOST, SHEET_PORT, SHEET_PAGE_TIMING, type SheetPageTiming };
export const SHEET_PAGE_DEFAULT_ON = false; // true from M5, on the owner's answer (T2)
export const CONNECTIONS_MAX = 128;
export const STOP_MS = 500;
const PORT_ZERO_TRIES = 3; // with port 0, a pair tried again when the second address's port is taken
const HEADER_BYTES_MAX = 16 * 1024;

export type SheetPageState = 'off' | 'no-bundle' | 'port-taken' | 'listening' | 'stopped';

export interface SheetPageOptions {
  kind: 'unit' | 'private';
  profileDir: string;
  dir: string; // <profile>/mawsd
  defaultProfile: boolean; // profileDir is defaultProfileDir(...), both made real
  env: NodeJS.ProcessEnv;
  shell(): Promise<Record<string, string>>; // one capture, made at the first need and kept
  bundleDir: string; // beside the build: join(dirname(<the entry's real path>), '..', 'sheet-page')
  sheets: SheetAccess; // §N: C3's service through the spine (sheets.ts)
  discovery(): Promise<void>; // T29: the daemon's discovery wake, as for a session.list that is not the app's
  onEvent(listener: (owner: 'engine-host' | 'pty-host' | 'machine', message: { name: string; payload: unknown }) => void): () => void; // DaemonServices.onEvent
  hold(reason: string, standing?: boolean): () => void; // DaemonServices.hold (T15)
  log(line: string): void;
  // test seams
  load?(): Promise<SheetPageChunk>;
  now?(): number;
  listen?(server: Http.Server, host: string, port: number): Promise<void>; // a bind that fails as told
  write?(file: string, text: string): void; // the browsers' file's replace, failing as told
  timing?: Partial<SheetPageTiming>;
}

export interface SheetPage {
  start(): void; // returns at once; T6
  status(): DaemonSheetPage; // daemon.status.sheetPage
  pair(): Promise<SheetPairAnswer>; // §K
  browsers(): Promise<BrowserList>;
  unpair(id: string | null): Promise<{ removed: number; saved: boolean; why?: string; unread?: true }>;
  spineState(state: SpineState): void; // T15: a spine that cannot be had is said on the live connections
  stop(): Promise<void>; // listeners closed, connections ended, the registration removed if ours; at most STOP_MS
}

export const loadSheetPageChunk = (): Promise<SheetPageChunk> => import('./handler');

export const listenExclusive = (server: Http.Server, host: string, port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const failed = (error: Error) => reject(error);
    server.once('error', failed);
    server.listen({ host, port, exclusive: true, ipv6Only: host === '::1' }, () => {
      server.off('error', failed);
      resolve();
    });
  });

const codeOf = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const NO_IPV6 = new Set(['EADDRNOTAVAIL', 'EAFNOSUPPORT']);

// A port named by the environment: 0 (the system picks) or 1024 to 65535; anything else names no port
function portOf(value: string | undefined, where: string, log: (line: string) => void): number | null {
  if (value === undefined || value === '') return null;
  const port = /^\d{1,5}$/.test(value) ? Number(value) : NaN;
  if (port === 0 || (port >= 1024 && port <= 65535)) return port;
  log(`MAWS_SHEET_PORT in the ${where} names no port: ignored`);
  return null;
}

export function createSheetPage(options: SheetPageOptions): SheetPage {
  const { log } = options;
  const timing: SheetPageTiming = { ...SHEET_PAGE_TIMING, ...options.timing };
  const listen = options.listen ?? listenExclusive;
  let state: SheetPageState = 'off';
  let detail: string | null = null;
  let port = SHEET_PORT;
  let http: typeof Http | null = null;
  let servers: Http.Server[] = []; // the committed pair
  const made = new Set<Http.Server>(); // every server made, a provisional one included, until it is closed: stop() owns them all
  let committed = false; // the bind decision is made and both addresses (or 127.0.0.1 alone) serve; before it none does
  const sockets = new Set<Socket>();
  let handler: SheetPageHandler | null = null;
  let loading: Promise<SheetPageHandler> | null = null;
  let spine: SpineState = 'cold';
  let retryTimer: NodeJS.Timeout | null = null;
  let tickTimer: NodeJS.Timeout | null = null;
  let stallTimer: NodeJS.Timeout | null = null;
  const progressAt = new Map<Socket, number>(); // when each connection's queue last emptied or a write of it completed
  const now = options.now ?? Date.now;
  let captured: Promise<Record<string, string>> | null = null;
  const shell = () => (captured ??= options.shell()); // one capture, at the first need: the port, the switch, the home
  const name = registrationName(options.defaultProfile, options.profileDir);
  let home: string | null | undefined; // the sminos home: undefined until it is looked for, null when there is none to write in
  let registered = false; // the last tick wrote the registration
  let written: string | null = null; // the last tick's outcome, logged when it changes
  let started = false;
  let stopping: Promise<void> | null = null;

  const become = (next: SheetPageState, why: string) => {
    if (state === next && detail === why) return;
    state = next;
    detail = why;
    log(`${next}: ${why}`);
  };

  // --- the decision (T2, T4) ----------------------------------------------------------------------------------------
  async function decide(): Promise<string | null> {
    const own = options.env.MAWS_SHEET_PAGE;
    if (own === '0') return 'turned off by MAWS_SHEET_PAGE=0';
    if (own !== '1' && !(options.defaultProfile && SHEET_PAGE_DEFAULT_ON)) return options.defaultProfile ? 'served only under MAWS_SHEET_PAGE=1 for now' : `a ${options.kind} mawsd of another profile serves it only under MAWS_SHEET_PAGE=1`;
    const fromEnv = portOf(options.env.MAWS_SHEET_PORT, 'environment', log);
    const login = own === '1' && fromEnv !== null ? {} : await shell();
    if (own !== '1' && login.MAWS_SHEET_PAGE === '0') return 'turned off by MAWS_SHEET_PAGE=0 in the login shell';
    port = fromEnv ?? portOf(login.MAWS_SHEET_PORT, 'login shell', log) ?? SHEET_PORT;
    return null;
  }

  async function begin(): Promise<void> {
    const off = await decide();
    if (stopping) return;
    if (off !== null) return become('off', off);
    if (!existsSync(join(options.bundleDir, 'index.html'))) return become('no-bundle', 'this build holds no sheet page');
    // asked for here and not imported at the top, so a daemon that serves no page never loads it; a builtin through
    // process.getBuiltinModule (Node 22.3 on; mawsd's floor is 24), since the guarded-entry rule admits no deferred
    // import() but a chunk beside the entry
    http = process.getBuiltinModule('node:http');
    await bind();
  }

  // --- the two servers (T1, T3) ---------------------------------------------------------------------------------------
  function makeServer(): Http.Server {
    const server = http!.createServer({ headersTimeout: timing.headersMs, requestTimeout: timing.requestMs, keepAliveTimeout: timing.keepAliveMs, connectionsCheckingInterval: timing.checkMs, maxHeaderSize: HEADER_BYTES_MAX, requireHostHeader: false });
    server.maxHeadersCount = HEADERS_MAX + 1;
    made.add(server);
    server.on('connection', (socket: Socket) => {
      // nothing is served on a provisional listener (T3: both addresses or neither) or past the bound
      if (stopping || !committed || sockets.size >= CONNECTIONS_MAX) return void socket.destroy();
      sockets.add(socket);
      progressAt.set(socket, Date.now());
      socket.on('drain', () => void progressAt.set(socket, Date.now())); // a write the peer's reading let complete
      socket.once('close', () => {
        sockets.delete(socket);
        progressAt.delete(socket);
      });
    });
    server.on('request', (req: Http.IncomingMessage, res: Http.ServerResponse) => void serve(req, res));
    server.on('upgrade', (req: Http.IncomingMessage, socket: Duplex, head: Buffer) => void upgrade(req, socket, head));
    server.on('checkContinue', (_req: Http.IncomingMessage, res: Http.ServerResponse) => answer(res, refusal(417)));
    server.on('checkExpectation', (_req: Http.IncomingMessage, res: Http.ServerResponse) => answer(res, refusal(417)));
    server.on('clientError', (error: Error, socket: Duplex) => {
      const code = codeOf(error);
      // Node's own guard: nothing is written once a response's headers went out on this connection
      const inFlight = (socket as Duplex & { _httpMessage?: { headersSent?: boolean } })._httpMessage?.headersSent === true;
      if (code === 'ECONNRESET' || !socket.writable || inFlight) return void socket.destroy();
      const status = code === 'HPE_HEADER_OVERFLOW' ? 431 : code === 'ERR_HTTP_REQUEST_TIMEOUT' ? 408 : 400;
      socket.end(refusalBytes(port, refusal(status)), () => socket.destroy());
    });
    server.on('error', (error: Error) => log(`a listener failed: ${messageOf(error)}`)); // an accept failure is not fatal
    return server;
  }

  // A server not listening yet stays owned, so a stop that came while its bind was out closes it once the bind returns
  const close = (server: Http.Server): Promise<void> =>
    new Promise((resolve) => {
      if (!server.listening) return resolve();
      made.delete(server);
      server.close(() => resolve());
      server.closeAllConnections();
    });

  // One try at the pair: 'bound', 'again' (port 0's second address taken) or a sentence why not
  async function bindPair(): Promise<'bound' | 'again' | string> {
    const v4 = makeServer();
    try {
      await listen(v4, '127.0.0.1', port);
    } catch (error) {
      made.delete(v4);
      return codeOf(error) === 'EADDRINUSE' ? `port ${port} is in use` : `port ${port} could not be bound (${codeOf(error) ?? messageOf(error)})`;
    }
    const got = (v4.address() as AddressInfo).port;
    const v6 = makeServer();
    try {
      await listen(v6, '::1', got);
    } catch (error) {
      made.delete(v6);
      if (NO_IPV6.has(codeOf(error) ?? '')) {
        servers = [v4];
        port = got;
        log('this machine has no IPv6 loopback: served on 127.0.0.1 alone');
        return 'bound';
      }
      await close(v4);
      if (codeOf(error) === 'EADDRINUSE') return port === 0 ? 'again' : `port ${port} is in use on ::1`;
      return `port ${got} could not be bound on ::1 (${codeOf(error) ?? messageOf(error)})`;
    }
    servers = [v4, v6];
    port = got;
    return 'bound';
  }

  async function bind(): Promise<void> {
    retryTimer = null;
    let outcome: 'bound' | 'again' | string = 'again';
    for (let tries = 0; outcome === 'again' && tries < PORT_ZERO_TRIES; tries++) outcome = await bindPair();
    if (stopping) return void (await Promise.all([...made].map(close)));
    if (outcome === 'bound') {
      committed = true;
      watchStalls();
      become('listening', `served on ${servers.length === 2 ? '127.0.0.1 and ::1' : '127.0.0.1'}, port ${port}`);
      return register();
    }
    become('port-taken', outcome === 'again' ? 'no port was free on both loopback addresses' : outcome);
    retryTimer = setTimeout(() => void bind().catch((error: unknown) => become('port-taken', `the bind failed: ${messageOf(error)}`)), timing.portRetryMs);
    retryTimer.unref();
  }

  // A connection whose queued bytes its peer has not taken for stallMs is ended: an empty queue, or a 'drain', is
  // progress. A response is written in slices (handler.ts), so a peer that reads, however slowly, drains between them.
  function watchStalls(): void {
    if (stallTimer !== null) return;
    stallTimer = setInterval(() => {
      const at = Date.now();
      for (const socket of sockets) {
        if (socket.writableLength === 0) progressAt.set(socket, at);
        else if (at - (progressAt.get(socket) ?? at) >= timing.stallMs) {
          log(`a response made no write progress for ${timing.stallMs / 1000} s: its connection is ended`);
          socket.destroy();
        }
      }
    }, timing.checkMs);
    stallTimer.unref();
  }

  // --- the timer and the registration (T10, T18) ------------------------------------------------------------------------
  // One timer, started at the first of the listeners being up and the chunk's load: the heartbeat while listening, and a
  // replace of the browsers' file still owed
  function ticking(): void {
    if (tickTimer !== null || stopping) return;
    tickTimer = setInterval(() => {
      heartbeat();
      handler?.tick();
    }, timing.heartbeatMs);
    tickTimer.unref();
  }

  async function register(): Promise<void> {
    if (home === undefined) {
      try {
        home = sminosHome(options.env, options.env.SMINOS_HOME ? null : await shell()); // the reader's rule
      } catch (error) {
        home = null;
        log(`the registration: no sminos home to write in (${messageOf(error)})`);
      }
    }
    if (stopping) return;
    heartbeat(); // the first tick after the listeners are up
    ticking();
  }

  function heartbeat(): void {
    if (state !== 'listening' || !home) return void (registered = false);
    let outcome: string;
    try {
      outcome = writeRegistration(home, { v: 1, name, pid: process.pid, url: pageOrigin(port), reach: 'local', heartbeatAt: new Date(now()).toISOString() });
    } catch (error) {
      outcome = `could not be written (${codeOf(error) ?? messageOf(error)})`;
    }
    registered = outcome === 'written';
    if (outcome === written) return;
    written = outcome;
    log(`the registration: ${outcome === 'written' ? `written as ${name}, every ${timing.heartbeatMs / 1000} s` : outcome === 'no-home' ? 'the sminos home does not exist, so nothing is written; looked for at each tick' : outcome === 'refused' ? 'refused: the home’s sheet/ or sheet/surfaces/ is a link or not a directory' : outcome}`);
  }

  // --- the chunk ----------------------------------------------------------------------------------------------------
  function ensure(): Promise<SheetPageHandler> {
    if (handler) return Promise.resolve(handler);
    loading ??= (options.load ?? loadSheetPageChunk)()
      .then((chunk) =>
        chunk.createSheetPageHandler({
          port: () => port, // read when it answers: a handler loaded for a command before the bind knows no port yet
          bundleDir: options.bundleDir,
          file: join(options.dir, 'sheet-page.json'),
          sheets: options.sheets,
          discovery: options.discovery,
          onEvent: options.onEvent,
          hold: options.hold,
          spine,
          log,
          now,
          ...(options.write && { write: options.write }),
          timing,
        }),
      )
      .then(
        (loaded) => {
          handler = loaded;
          log('its handler loaded at its first use');
          if (stopping) loaded.close();
          else ticking(); // a replace of the browsers' file still owed is tried again at each tick (T10)
          return loaded;
        },
        (error: unknown) => {
          loading = null; // the next request loads again
          log(`its handler could not load: ${messageOf(error)}`);
          throw error;
        },
      );
    return loading;
  }

  const answer = (res: Http.ServerResponse, refused: Refusal) => void res.writeHead(refused.status, refusalHeaders(port, refused)).end(refused.body);

  async function serve(req: Http.IncomingMessage, res: Http.ServerResponse): Promise<void> {
    let served: SheetPageHandler;
    try {
      served = await ensure();
    } catch {
      return answer(res, refusal(503));
    }
    if (req.destroyed) return; // it left while the handler loaded: nothing to answer
    served.request(req, res);
  }

  async function upgrade(req: Http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    socket.on('error', () => {});
    let served: SheetPageHandler;
    try {
      served = await ensure();
    } catch {
      return void socket.end(refusalBytes(port, refusal(503)), () => socket.destroy());
    }
    served.upgrade(req, socket, head);
  }

  // `browsers` and `unpair` read and change the browsers' file in every state but `stopped` (a browser can be unpaired
  // while the page is off or its port taken); `pair` alone needs `listening` (T8). Either loads the chunk for its command,
  // and the state is read again once it loaded: a stop that came meanwhile closed the handler, which then acts on nothing.
  const stopped = () => stopping !== null;
  const notServed = (): SheetPairAnswer => ({ ok: false, why: `this mawsd does not serve the sheet page now: ${detail ?? 'it has not started'}` });

  return {
    start() {
      if (started) return;
      started = true;
      void begin().catch((error: unknown) => become('off', `it could not start: ${messageOf(error)}`));
    },

    status: () => ({
      state,
      detail,
      url: state === 'listening' ? pageOrigin(port) : null,
      browsers: handler ? handler.count() : null, // memory alone: a status reads no file
      connections: handler ? handler.connections() : null,
      registered: state === 'listening' && registered,
    }),

    async pair() {
      if (state !== 'listening') return notServed();
      let served: SheetPageHandler;
      try {
        served = await ensure();
      } catch (error) {
        return { ok: false, why: `the sheet page could not load: ${messageOf(error)}` };
      }
      if (state !== 'listening') return notServed();
      const { code, expiresAt } = served.pair();
      return { ok: true, code, expiresAt, url: pageOrigin(port) };
    },

    async browsers() {
      const served = stopped() ? null : await ensure();
      return served === null || stopped() ? { browsers: [] } : served.browsers();
    },

    async unpair(id) {
      const served = stopped() ? null : await ensure();
      return served === null || stopped() ? { removed: 0, saved: false, why: 'stopping' } : served.unpair(id);
    },

    spineState(next) {
      spine = next;
      handler?.spineState(next);
    },

    stop() {
      stopping ??= (async () => {
        const wasListening = state === 'listening';
        if (state === 'listening' || state === 'port-taken') become('stopped', 'mawsd is stopping');
        if (retryTimer) clearTimeout(retryTimer);
        if (tickTimer) clearInterval(tickTimer);
        if (stallTimer) clearInterval(stallTimer);
        const bound = new Promise((resolve) => setTimeout(resolve, STOP_MS).unref()); // STOP_MS covers the removal too
        // first, so no session is offered a page that is going; only a file that still names this process. Best effort:
        // a home that changed under mawsd is logged, and the stop goes on (T6)
        if (wasListening && home) {
          try {
            removeRegistration(home, name, process.pid);
          } catch (error) {
            log(`the registration: not removed at the stop (${codeOf(error) ?? messageOf(error)})`);
          }
        }
        registered = false;
        handler?.close(); // the live connections told 1001
        await Promise.race([Promise.all([...made].map(close)), bound]);
        for (const socket of sockets) socket.destroy(); // what is left: an upgraded socket, which its server no longer holds
      })();
      return stopping;
    },
  };
}
