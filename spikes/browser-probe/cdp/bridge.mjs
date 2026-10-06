// A browser-level CDP endpoint for exactly one webContents, served over WebSocket and backed by webContents.debugger.
// Playwright's connectOverCDP expects a *browser* target (Browser.getVersion, Target.setAutoAttach, Target.getTargetInfo,
// Browser.setDownloadBehavior, Target.activateTarget); the webContents debugger is a *page* session. The bridge
// answers the browser-level methods itself, announces the one page as an attached target under a synthetic session id,
// and forwards everything carrying that session id to webContents.debugger.sendCommand. Child sessions (OOPIFs,
// workers) that the page's own Target.setAutoAttach produces pass through with their real session ids.
//
// The boundary is enforced, not assumed: Electron's debugger client is a trusted CDP client, so the page session's own
// Target domain can enumerate and attach to every target in the process (verified in main.mjs cdpBridgeScenario). The
// bridge therefore (1) forwards only session ids it announced itself or that the debugger announced through an
// auto-attach event, (2) allows on those sessions only the Target methods auto-attach needs (setAutoAttach,
// detachFromTarget, getTargetInfo without a targetId) and no Browser.* or Storage.* method, and (3) accepts WebSocket
// upgrades only on a per-bridge random token path. Origin is not checked (a product bridge would also pin it).
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';

const SESSION_TARGET_ALLOW = new Set(['Target.setAutoAttach', 'Target.detachFromTarget', 'Target.getTargetInfo']);

export async function startDebuggerBridge(webContents, { host = '127.0.0.1', port = 0, log = () => {} } = {}) {
  const dbg = webContents.debugger;
  const PAGE_SESSION = 'maws-bridge-page-1';
  const token = randomBytes(16).toString('hex');
  const wsPath = `/devtools/browser/${token}`;
  const sockets = new Set();
  const knownSessions = new Set([PAGE_SESSION]);
  const stats = { forwarded: 0, browserLevel: 0, events: 0, errors: 0, blocked: [], rejectedUpgrades: 0, unknownBrowserMethods: new Set() };
  const verbose = process.env.PROBE_BRIDGE_LOG === '1';

  if (!dbg.isAttached()) dbg.attach('1.3');
  // In CDP a page target's id *is* its main frame's id, and Playwright relies on the equality (FrameSession keys its
  // sessions by target id and tests `frameId !== targetId`). A synthetic id leaves the main frame orphaned: page.url()
  // stays '' and evaluate waits forever for an execution context. So the bridge takes the real main frame id.
  const { frameTree } = await dbg.sendCommand('Page.getFrameTree');
  const targetId = frameTree.frame.id;

  const broadcast = (msg) => {
    const text = JSON.stringify(msg);
    for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(text);
  };

  dbg.on('message', (_event, method, params, sessionId) => {
    stats.events++;
    if (method === 'Target.attachedToTarget' && params?.sessionId) knownSessions.add(params.sessionId);
    if (method === 'Target.detachedFromTarget' && params?.sessionId) knownSessions.delete(params.sessionId);
    // Electron reports the root session as '' (or undefined); map it to our synthetic id.
    if (verbose) log(`bridge < event ${method} ${sessionId ?? ''} ${JSON.stringify(params).slice(0, 200)}`);
    broadcast({ method, params, sessionId: sessionId ? sessionId : PAGE_SESSION });
  });
  dbg.on('detach', (_event, reason) => {
    broadcast({ method: 'Target.detachedFromTarget', params: { sessionId: PAGE_SESSION, targetId, reason } });
  });

  const targetInfo = () => ({
    targetId,
    type: 'page',
    title: webContents.getTitle(),
    url: webContents.getURL(),
    attached: true,
    canAccessOpener: false,
    browserContextId: 'maws-bridge-context',
  });

  function sessionCommandAllowed(method, params) {
    const domain = method.split('.')[0];
    if (domain === 'Browser' || domain === 'Storage' || domain === 'SystemInfo' || domain === 'Tethering') return false;
    if (domain === 'Target') {
      if (!SESSION_TARGET_ALLOW.has(method)) return false;
      if (method === 'Target.getTargetInfo' && params.targetId && params.targetId !== targetId) return false;
    }
    return true;
  }

  async function handle(ws, msg) {
    const { id, method, params = {}, sessionId } = msg;
    const reply = (result) => ws.send(JSON.stringify({ id, result, ...(sessionId ? { sessionId } : {}) }));
    const fail = (code, message) => { stats.errors++; ws.send(JSON.stringify({ id, error: { code, message }, ...(sessionId ? { sessionId } : {}) })); };

    if (sessionId) {
      if (!knownSessions.has(sessionId)) {
        stats.blocked.push(`${method} on unknown session`);
        return fail(-32001, `unknown session ${sessionId}: the MAWS bridge forwards only sessions it announced`);
      }
      if (!sessionCommandAllowed(method, params)) {
        stats.blocked.push(method);
        return fail(-32601, `${method} is not available through the MAWS debugger bridge (one view, owned by the app)`);
      }
      stats.forwarded++;
      const electronSession = sessionId === PAGE_SESSION ? undefined : sessionId;
      try {
        const result = await dbg.sendCommand(method, params, electronSession);
        if (verbose) log(`bridge > ${method} ${sessionId === PAGE_SESSION ? '' : sessionId} ok ${JSON.stringify(result ?? {}).slice(0, 1200)}`);
        reply(result ?? {});
      } catch (e) {
        if (verbose) log(`bridge > ${method} ${sessionId === PAGE_SESSION ? '' : sessionId} ERROR ${e?.message ?? e}`);
        fail(-32000, e?.message ?? String(e));
      }
      return;
    }

    stats.browserLevel++;
    if (verbose) log(`bridge > browser-level ${method} ${JSON.stringify(params).slice(0, 120)}`);
    switch (method) {
      case 'Browser.getVersion':
        return reply({ protocolVersion: '1.3', product: `Chrome/${process.versions.chrome}`, revision: '@0', userAgent: webContents.getUserAgent(), jsVersion: process.versions.v8 });
      case 'Target.setAutoAttach':
        reply({});
        if (params.autoAttach) broadcast({ method: 'Target.attachedToTarget', params: { sessionId: PAGE_SESSION, targetInfo: targetInfo(), waitingForDebugger: false } });
        return;
      case 'Target.setDiscoverTargets':
        reply({});
        if (params.discover) broadcast({ method: 'Target.targetCreated', params: { targetInfo: targetInfo() } });
        return;
      case 'Target.getTargets':
        return reply({ targetInfos: [targetInfo()] });
      case 'Target.getTargetInfo':
        return reply({ targetInfo: targetInfo() });
      case 'Target.attachToTarget':
        if (params.targetId && params.targetId !== targetId) return fail(-32602, `no target ${params.targetId} behind this bridge`);
        reply({ sessionId: PAGE_SESSION });
        broadcast({ method: 'Target.attachedToTarget', params: { sessionId: PAGE_SESSION, targetInfo: targetInfo(), waitingForDebugger: false } });
        return;
      case 'Target.activateTarget':
        webContents.focus();
        return reply({});
      case 'Target.detachFromTarget':
        return reply({});
      case 'Browser.setDownloadBehavior':
      case 'Browser.grantPermissions':
      case 'Browser.resetPermissions':
      case 'Browser.setPermission':
      case 'Browser.cancelDownload':
      case 'Storage.clearCookies':
      case 'Storage.setCookies':
      case 'Storage.getCookies':
        return reply({ cookies: [] });
      case 'Browser.close':
        reply({});
        for (const s of sockets) s.close();
        return;
      case 'Target.createTarget':
      case 'Target.closeTarget':
      case 'Target.createBrowserContext':
      case 'Target.disposeBrowserContext':
      case 'Target.attachToBrowserTarget':
      case 'Target.exposeDevToolsProtocol':
        return fail(-32601, `${method} is not available through the MAWS debugger bridge (one view, owned by the app)`);
      default:
        stats.unknownBrowserMethods.add(method);
        log(`bridge: unknown browser-level method ${method}`);
        return fail(-32601, `${method} not implemented by the bridge`);
    }
  }

  // No /json/version: it would publish the token. Clients get the ws URL from the bridge's owner.
  const http = createServer((_req, res) => { res.statusCode = 404; res.end(); });
  const wss = new WebSocketServer({ noServer: true });
  http.on('upgrade', (req, socket, head) => {
    if (req.url !== wsPath) {
      stats.rejectedUpgrades++;
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws) => {
    sockets.add(ws);
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      handle(ws, msg);
    });
    ws.on('close', () => sockets.delete(ws));
  });
  await new Promise((res) => http.listen(port, host, res));
  const address = http.address();
  return {
    httpUrl: `http://${host}:${address.port}`,
    wsUrl: `ws://${host}:${address.port}${wsPath}`,
    pageSessionId: PAGE_SESSION,
    stats,
    close: async () => {
      for (const s of sockets) s.terminate();
      wss.close();
      await new Promise((res) => http.close(res));
      if (dbg.isAttached()) dbg.detach();
    },
  };
}
