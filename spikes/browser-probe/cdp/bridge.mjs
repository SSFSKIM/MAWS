// A browser-level CDP endpoint for exactly one webContents, served over WebSocket and backed by webContents.debugger.
// Playwright's connectOverCDP expects a *browser* target (Browser.getVersion, Target.setAutoAttach, Target.getTargetInfo,
// Browser.setDownloadBehavior, Target.activateTarget); the webContents debugger is a *page* session. The bridge
// answers the browser-level methods itself, announces the one page as an attached target under a synthetic session id,
// and forwards everything carrying that session id to webContents.debugger.sendCommand. Child sessions (OOPIFs,
// workers) that the page's own Target.setAutoAttach produces pass through with their real session ids.
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

export async function startDebuggerBridge(webContents, { host = '127.0.0.1', port = 0, log = () => {} } = {}) {
  const dbg = webContents.debugger;
  const PAGE_SESSION = 'maws-bridge-page-1';
  const sockets = new Set();
  const stats = { forwarded: 0, browserLevel: 0, events: 0, errors: 0, unknownBrowserMethods: new Set() };
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
    // Electron reports the root session as '' (or undefined); map it to our synthetic id.
    if (verbose) log(`bridge < event ${method} ${sessionId ?? ""} ${JSON.stringify(params).slice(0, 200)}`);
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

  async function handle(ws, msg) {
    const { id, method, params = {}, sessionId } = msg;
    const reply = (result) => ws.send(JSON.stringify({ id, result, ...(sessionId ? { sessionId } : {}) }));
    const fail = (code, message) => { stats.errors++; ws.send(JSON.stringify({ id, error: { code, message }, ...(sessionId ? { sessionId } : {}) })); };

    if (sessionId) {
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
        return fail(-32601, `${method} is not available through the MAWS debugger bridge (one view, owned by the app)`);
      default:
        stats.unknownBrowserMethods.add(method);
        log(`bridge: unknown browser-level method ${method}`);
        return fail(-32601, `${method} not implemented by the bridge`);
    }
  }

  const http = createServer((req, res) => {
    if (req.url?.startsWith('/json/version')) {
      const address = http.address();
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ Browser: `Chrome/${process.versions.chrome}`, 'Protocol-Version': '1.3', 'User-Agent': webContents.getUserAgent(), 'V8-Version': process.versions.v8, webSocketDebuggerUrl: `ws://${host}:${address.port}/devtools/browser/maws-bridge` }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  const wss = new WebSocketServer({ server: http });
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
    wsUrl: `ws://${host}:${address.port}/devtools/browser/maws-bridge`,
    stats,
    close: async () => {
      for (const s of sockets) s.terminate();
      wss.close();
      await new Promise((res) => http.close(res));
      if (dbg.isAttached()) dbg.detach();
    },
  };
}
