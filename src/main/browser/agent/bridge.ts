// The CDP bridge (E4c execution document, Design §4; A-19, A-43; G3; Decision Log 57): a browser-level CDP endpoint for
// one tab, handed to playwright-core in process as a `ConnectOverCDPTransport` and backed by the tab's TabDebugger. No
// socket, port or listener exists: Playwright's messages arrive as objects through `send` and the bridge's go back
// through `onmessage`. Lifted from E0b's `spikes/browser-probe/cdp/bridge.mjs` with the document's changes: every command
// goes out through `TabDebugger.send` (never the raw debugger, so the in-flight Input table fills itself, E4a Decision
// 19), events come from `TabDebugger.on('*')` (Decision Log 34 (b)), the page's target id is the attachment's main-frame
// id (no second `Page.getFrameTree`), and a child that waits for a debugger while no transport is open is resumed.
//
// Playwright expects a *browser* target; the debugger is a *page* session. The bridge answers the browser-level methods
// itself, announces the one page as an attached target under a synthetic session id, and forwards everything carrying
// that id (or a child session Chromium announced through auto-attach) to the page. The boundary is enforced, not
// assumed: Electron's debugger client is trusted, so the page session's own Target domain could enumerate and attach to
// every target in the process (MAWS's renderer among them). The bridge therefore (1) forwards only sessions it or the
// debugger announced, and (2) allows on them only the Target methods auto-attach needs and no Browser.*, Storage.*,
// SystemInfo.* or Tethering.* method.
import type { WebContents } from 'electron';
import type { ConnectOverCDPTransport } from 'playwright-core';
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
  unknownBrowserMethods: Set<string>;
}

export interface CdpBridge {
  pageSessionId: string;
  stats: BridgeStats;
  readonly connected: boolean; // a transport is open
  // A transport for `chromium.connectOverCDP(transport)`. One is open at a time: a new one ends the one before.
  connect(): ConnectOverCDPTransport;
  // Ends the open transport (Playwright hears `onclose`); detaches the debugger only when told to (Decision Log 1, 34 (a)).
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
  const knownSessions = new Set([PAGE_SESSION]);
  const stats: BridgeStats = { forwarded: 0, browserLevel: 0, events: 0, errors: 0, blocked: [], unknownBrowserMethods: new Set() };
  let client: ConnectOverCDPTransport | null = null;

  // Every message reaches Playwright on a later turn, in order, as a socket's would: Playwright registers a command's
  // callback only after `send` returns, so an answer delivered inside `send` would be lost.
  const outbox: { to: ConnectOverCDPTransport; message: object }[] = [];
  let flushing = false;
  const flush = () => {
    flushing = false;
    for (const { to, message } of outbox.splice(0)) if (client === to) to.onmessage?.(message);
  };
  const deliverTo = (to: ConnectOverCDPTransport, message: object) => {
    outbox.push({ to, message });
    if (!flushing) {
      flushing = true;
      setImmediate(flush);
    }
  };
  const deliver = (message: object) => {
    if (client) deliverTo(client, message);
  };
  const end = (transport: ConnectOverCDPTransport, reason: string) => {
    if (client !== transport) return;
    client = null;
    setImmediate(() => transport.onclose?.(reason));
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

  async function handle(transport: ConnectOverCDPTransport, { id, method, params = {}, sessionId }: Message): Promise<void> {
    const answer = (body: object) => deliverTo(transport, { id, ...body, ...(sessionId ? { sessionId } : {}) });
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
        setImmediate(() => end(transport, 'Browser.close'));
        return;
      default:
        stats.unknownBrowserMethods.add(method);
        log(`the CDP bridge does not implement the browser-level method ${method}`);
        return fail(-32601, `${method} not implemented by the bridge`);
    }
  }

  let closed = false;
  return {
    pageSessionId: PAGE_SESSION,
    stats,
    get connected() {
      return client !== null;
    },
    connect: () => {
      if (closed) throw new Error('the CDP bridge is closed');
      if (client) end(client, 'replaced by a new connection');
      const transport: ConnectOverCDPTransport = {
        send: (message) => {
          if (client === transport) void handle(transport, message as Message);
        },
        close: () => end(transport, 'closed by the client'),
      };
      client = transport;
      return transport;
    },
    close: async ({ detach }) => {
      closed = true;
      for (const stop of unsubscribe) stop();
      if (client) end(client, 'the CDP bridge closed');
      if (detach) dbg.detach();
    },
  };
}
