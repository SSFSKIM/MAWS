// The CDP bridge (E4c execution document, Design §4; A-19; G3): a browser-level CDP endpoint for one tab, served over a
// loopback WebSocket for playwright-core's `connectOverCDP` and backed by the tab's TabDebugger. Lifted from E0b's
// `spikes/browser-probe/cdp/bridge.mjs` with the document's changes and no others: every command goes out through
// `TabDebugger.send` (never the raw debugger, so the in-flight Input table fills itself, E4a Decision 19), events come
// from `TabDebugger.on('*')` (Decision Log 34 (b)), the page's target id is the attachment's main-frame id (no second
// `Page.getFrameTree`), an upgrade carrying an Origin header is refused (a Node client sends none; a page's would), one
// socket at a time, and a child that waits for a debugger while no socket is open is resumed.
//
// Playwright expects a *browser* target; the debugger is a *page* session. The bridge answers the browser-level methods
// itself, announces the one page as an attached target under a synthetic session id, and forwards everything carrying
// that id (or a child session Chromium announced through auto-attach) to the page. The boundary is enforced, not
// assumed: Electron's debugger client is trusted, so the page session's own Target domain could enumerate and attach to
// every target in the process (MAWS's renderer among them). The bridge therefore (1) forwards only sessions it or the
// debugger announced, (2) allows on them only the Target methods auto-attach needs and no Browser.*, Storage.*,
// SystemInfo.* or Tethering.* method, and (3) accepts upgrades only on a per-bridge random token path, never with an
// Origin, one at a time.
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { WebContents } from 'electron';
import { WebSocketServer, type WebSocket } from 'ws';
import type { CommandParams, TabDebugger } from '../debugger';

const PAGE_SESSION = 'maws-bridge-page-1';
const SESSION_TARGET_ALLOW = new Set(['Target.setAutoAttach', 'Target.detachFromTarget', 'Target.getTargetInfo']);
const REFUSED_SESSION_DOMAINS = new Set(['Browser', 'Storage', 'SystemInfo', 'Tethering']);
const REFUSED_BROWSER_METHODS = new Set([
  'Target.createTarget',
  'Target.closeTarget',
  'Target.createBrowserContext',
  'Target.disposeBrowserContext',
  'Target.attachToBrowserTarget',
  'Target.exposeDevToolsProtocol',
]);
// Answered empty (Playwright sends them at attach; nothing is granted).
const INERT_BROWSER_METHODS = new Set([
  'Browser.setDownloadBehavior',
  'Browser.grantPermissions',
  'Browser.resetPermissions',
  'Browser.setPermission',
  'Browser.cancelDownload',
  'Storage.clearCookies',
  'Storage.setCookies',
  'Storage.getCookies',
]);

export type BridgeDebugger = Pick<TabDebugger, 'attach' | 'detach' | 'attached' | 'mainFrameId' | 'send' | 'on' | 'onDetach'>;
// What the browser-level answers read from the tab's webContents.
export type BridgePage = Pick<WebContents, 'getTitle' | 'getURL' | 'getUserAgent' | 'focus'>;

export interface BridgeStats {
  forwarded: number;
  browserLevel: number;
  events: number;
  errors: number;
  blocked: string[];
  rejectedUpgrades: number;
  unknownBrowserMethods: Set<string>;
}

export interface CdpBridge {
  wsUrl: string; // the token path: handed to the driver alone
  pageSessionId: string;
  stats: BridgeStats;
  readonly connected: boolean; // a socket is open
  // Ends the socket and the server; detaches the debugger only when told to (Decision Log 1 and 34 (a)).
  close(options: { detach: boolean }): Promise<void>;
}

export interface BridgeOptions {
  log?(line: string): void; // an unknown browser-level method (a Playwright upgrade asking something new)
}

interface Message {
  id: number;
  method: string;
  params?: CommandParams;
  sessionId?: string;
}

export async function startCdpBridge(dbg: BridgeDebugger, page: BridgePage, { log = () => {} }: BridgeOptions = {}): Promise<CdpBridge> {
  // Events reach `on` listeners only once an attach has wired the debugger, so the bridge attaches before it subscribes.
  await dbg.attach();
  // In CDP a page target's id is its main frame's id, and Playwright relies on the equality (a synthetic id orphans the
  // main frame: page.url() stays '' and evaluate waits for a context forever). Chromium keeps it across process swaps.
  const targetId = dbg.mainFrameId!;
  const token = randomBytes(16).toString('hex');
  const wsPath = `/devtools/browser/${token}`;
  const knownSessions = new Set([PAGE_SESSION]);
  const stats: BridgeStats = { forwarded: 0, browserLevel: 0, events: 0, errors: 0, blocked: [], rejectedUpgrades: 0, unknownBrowserMethods: new Set() };
  let client: WebSocket | null = null;

  const deliver = (message: object) => {
    if (client && client.readyState === client.OPEN) client.send(JSON.stringify(message));
  };

  const unsubscribe = [
    dbg.on('*', (params, sessionId, method) => {
      stats.events++;
      const announced = params as { sessionId?: string; waitingForDebugger?: boolean } | undefined;
      if (method === 'Target.attachedToTarget' && announced?.sessionId) {
        knownSessions.add(announced.sessionId);
        // Playwright's attach leaves `waitForDebuggerOnStart` set on the page session: with no client to resume it, a new
        // cross-site frame or worker would stay paused for the person (E4-0 (4)).
        if (announced.waitingForDebugger && client === null) dbg.send('Runtime.runIfWaitingForDebugger', undefined, announced.sessionId).catch(() => {});
      }
      if (method === 'Target.detachedFromTarget' && announced?.sessionId) knownSessions.delete(announced.sessionId);
      deliver({ method, params, sessionId: sessionId || PAGE_SESSION });
    }),
    dbg.onDetach((reason) => deliver({ method: 'Target.detachedFromTarget', params: { sessionId: PAGE_SESSION, targetId, reason } })),
  ];

  const targetInfo = () => ({
    targetId,
    type: 'page',
    title: page.getTitle(),
    url: page.getURL(),
    attached: true,
    canAccessOpener: false,
    browserContextId: 'maws-bridge-context',
  });
  const announcePage = () => deliver({ method: 'Target.attachedToTarget', params: { sessionId: PAGE_SESSION, targetInfo: targetInfo(), waitingForDebugger: false } });

  const sessionCommandAllowed = (method: string, params: CommandParams) => {
    const domain = method.split('.')[0];
    if (REFUSED_SESSION_DOMAINS.has(domain)) return false;
    if (domain !== 'Target') return true;
    if (!SESSION_TARGET_ALLOW.has(method)) return false;
    return !(method === 'Target.getTargetInfo' && params.targetId && params.targetId !== targetId);
  };

  async function handle(ws: WebSocket, { id, method, params = {}, sessionId }: Message): Promise<void> {
    const answer = (body: object) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ id, ...body, ...(sessionId ? { sessionId } : {}) }));
    };
    const reply = (result: unknown) => answer({ result: result ?? {} });
    const fail = (code: number, message: string) => {
      stats.errors++;
      answer({ error: { code, message } });
    };
    const refuse = (blocked: string) => {
      stats.blocked.push(blocked);
      fail(-32601, `${method} is not available through the MAWS debugger bridge (one view, owned by the app)`);
    };

    if (sessionId) {
      if (!knownSessions.has(sessionId)) {
        stats.blocked.push(`${method} on unknown session`);
        return fail(-32001, `unknown session ${sessionId}: the MAWS bridge forwards only sessions it announced`);
      }
      if (!sessionCommandAllowed(method, params)) return refuse(method);
      // `send` would attach again: after a crash or a detach the bridge is dead and must not revive the attachment.
      if (!dbg.attached) return fail(-32000, 'the page is no longer attached');
      stats.forwarded++;
      try {
        reply(await dbg.send(method, params, sessionId === PAGE_SESSION ? undefined : sessionId));
      } catch (error) {
        fail(-32000, error instanceof Error ? error.message : String(error));
      }
      return;
    }

    stats.browserLevel++;
    if (INERT_BROWSER_METHODS.has(method)) return reply({ cookies: [] });
    if (REFUSED_BROWSER_METHODS.has(method)) return refuse(method);
    switch (method) {
      case 'Browser.getVersion':
        return reply({ protocolVersion: '1.3', product: `Chrome/${process.versions.chrome}`, revision: '@0', userAgent: page.getUserAgent(), jsVersion: process.versions.v8 });
      case 'Target.setAutoAttach':
        reply({});
        if (params.autoAttach) announcePage();
        return;
      case 'Target.setDiscoverTargets':
        reply({});
        if (params.discover) deliver({ method: 'Target.targetCreated', params: { targetInfo: targetInfo() } });
        return;
      case 'Target.getTargets':
        return reply({ targetInfos: [targetInfo()] });
      case 'Target.getTargetInfo':
        return reply({ targetInfo: targetInfo() });
      case 'Target.attachToTarget':
        if (params.targetId && params.targetId !== targetId) return fail(-32602, `no target ${String(params.targetId)} behind this bridge`);
        reply({ sessionId: PAGE_SESSION });
        announcePage();
        return;
      case 'Target.activateTarget':
        page.focus();
        return reply({});
      case 'Target.detachFromTarget':
        return reply({});
      case 'Browser.close':
        reply({});
        ws.close();
        return;
      default:
        stats.unknownBrowserMethods.add(method);
        log(`the CDP bridge does not implement the browser-level method ${method}`);
        return fail(-32601, `${method} not implemented by the bridge`);
    }
  }

  // No /json/version: it would publish the token. The driver gets the URL from the bridge's owner.
  const http = createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  const wss = new WebSocketServer({ noServer: true });
  const refuseUpgrade = (socket: Duplex, status: string) => {
    stats.rejectedUpgrades++;
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  http.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (request.url !== wsPath) return refuseUpgrade(socket, '404 Not Found');
    if (request.headers.origin !== undefined) return refuseUpgrade(socket, '403 Forbidden');
    if (client !== null) return refuseUpgrade(socket, '409 Conflict');
    wss.handleUpgrade(request, socket, head, (ws) => {
      client = ws;
      ws.on('message', (data: Buffer) => {
        let message: Message;
        try {
          message = JSON.parse(data.toString()) as Message;
        } catch {
          return;
        }
        void handle(ws, message);
      });
      ws.on('close', () => {
        if (client === ws) client = null;
      });
    });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address() as { port: number };

  return {
    wsUrl: `ws://127.0.0.1:${port}${wsPath}`,
    pageSessionId: PAGE_SESSION,
    stats,
    get connected() {
      return client !== null;
    },
    close: async ({ detach }) => {
      for (const stop of unsubscribe) stop();
      client?.terminate();
      client = null;
      wss.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      if (detach) dbg.detach();
    },
  };
}
