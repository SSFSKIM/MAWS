// The network half: the page's WebSocket frames, its SSE messages and its HTTP requests, each with when Chrome saw it,
// so a load can say which hop a delay sits in (the page's own work, the network, the far side). Through a CDP session
// when the browser grants one: its Network events carry Chrome's monotonic clock, which the wallTime of any request
// ties to the wall clock, so a frame lands on the same clock as the page's marks (performance.timeOrigin + a mark). Else
// through Playwright's page events, stamped when the script heard of them: later by the hop between the browser and the
// script, which over the extension's relay is neither small nor steady (`mode` says which).
//
// Payloads are not kept: `classify(direction, url, text)` (the target's) turns each into a few labels — a frame type,
// the ids a load joins on — or null to drop it.
export async function startNet(page, classify, options = {}) {
  const max = options.max ?? 20000;
  const events = [];
  const sockets = new Map();
  const requests = new Map();
  let offset = null; // wall ms − monotonic ms
  let dropped = 0;
  let mode = 'none';
  let cdp = null;
  const push = (event) => {
    if (events.length >= max) {
      dropped++;
      return;
    }
    events.push(event);
  };
  // `rid`: an HTTP request's id, the same on its `req` and its `done`, so a load can tell its own request's end.
  const lines = (direction, url, text, at, clock, rid) => {
    let labels = null;
    try {
      labels = classify(direction, url, String(text ?? ''));
    } catch (error) {
      labels = [{ error: String(error) }];
    }
    if (!labels) return;
    for (const label of Array.isArray(labels) ? labels : [labels]) push({ dir: direction, url: shortUrl(url), [clock]: at, ...(rid !== undefined && { rid }), ...label });
  };
  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    mode = 'cdp';
    const anchor = (e) => {
      if (typeof e.wallTime === 'number' && typeof e.timestamp === 'number') offset = e.wallTime * 1000 - e.timestamp * 1000;
    };
    cdp.on('Network.requestWillBeSent', (e) => {
      anchor(e);
      requests.set(e.requestId, { url: e.request.url, method: e.request.method, sent: e.timestamp * 1000 });
      lines('req', e.request.url, `${e.request.method} ${e.request.postData ?? ''}`, e.timestamp * 1000, 'mono', e.requestId);
    });
    cdp.on('Network.responseReceived', (e) => {
      const r = requests.get(e.requestId);
      if (r) r.response = e.timestamp * 1000;
    });
    cdp.on('Network.loadingFinished', (e) => {
      const r = requests.get(e.requestId);
      if (!r) return;
      r.finished = e.timestamp * 1000;
      lines('done', r.url, `${r.method}`, e.timestamp * 1000, 'mono', e.requestId);
    });
    cdp.on('Network.webSocketWillSendHandshakeRequest', anchor);
    // A socket's url by its id from its creation, which carries no time; it is open at its handshake's response.
    cdp.on('Network.webSocketCreated', (e) => sockets.set(e.requestId, e.url));
    cdp.on('Network.webSocketHandshakeResponseReceived', (e) => push({ dir: 'ws-open', url: shortUrl(sockets.get(e.requestId) ?? ''), mono: e.timestamp * 1000, socket: e.requestId }));
    cdp.on('Network.webSocketClosed', (e) => push({ dir: 'ws-close', url: shortUrl(sockets.get(e.requestId) ?? ''), mono: e.timestamp * 1000, socket: e.requestId }));
    cdp.on('Network.webSocketFrameReceived', (e) => lines('in', sockets.get(e.requestId) ?? '', e.response?.payloadData, e.timestamp * 1000, 'mono'));
    cdp.on('Network.webSocketFrameSent', (e) => lines('out', sockets.get(e.requestId) ?? '', e.response?.payloadData, e.timestamp * 1000, 'mono'));
    cdp.on('Network.eventSourceMessageReceived', (e) => lines('sse', requests.get(e.requestId)?.url ?? '', e.data, e.timestamp * 1000, 'mono'));
    cdp.on('Network.dataReceived', (e) => {
      const r = requests.get(e.requestId);
      if (r && options.streams?.test(r.url)) push({ dir: 'data', url: shortUrl(r.url), mono: e.timestamp * 1000, bytes: e.dataLength });
    });
  } catch (error) {
    mode = 'playwright';
    cdp = null;
    page.on('websocket', (ws) => {
      const url = ws.url();
      push({ dir: 'ws-open', url: shortUrl(url), wall: Date.now() });
      ws.on('framereceived', (f) => lines('in', url, f.payload, Date.now(), 'wall'));
      ws.on('framesent', (f) => lines('out', url, f.payload, Date.now(), 'wall'));
      ws.on('close', () => push({ dir: 'ws-close', url: shortUrl(url), wall: Date.now() }));
    });
    // Each request object named once, so its `req` and its `done` carry the same `rid` as over CDP.
    const named = new WeakMap();
    let requestsSeen = 0;
    const rid = (r) => {
      if (!named.has(r)) named.set(r, `pw${++requestsSeen}`);
      return named.get(r);
    };
    page.on('request', (r) => lines('req', r.url(), `${r.method()} ${r.postData() ?? ''}`, Date.now(), 'wall', rid(r)));
    page.on('requestfinished', (r) => lines('done', r.url(), r.method(), Date.now(), 'wall', rid(r)));
  }
  // An anchor for the monotonic clock: any request with its wallTime. The page's own traffic usually gives one; this makes
  // sure of it with a fetch of the origin's icon, which no load reads.
  await page.evaluate(() => fetch('/favicon.ico', { cache: 'no-store' }).catch(() => null)).catch(() => null);
  const wallOf = (e) => (e.wall !== undefined ? e.wall : e.mono === null || offset === null ? null : e.mono + offset);
  return {
    get mode() {
      return mode;
    },
    /** Every event since `sinceWall` (ms since the epoch) on the wall clock, oldest first. */
    since(sinceWall, untilWall = Infinity) {
      return events.map((e) => ({ ...e, at: wallOf(e) })).filter((e) => e.at !== null && e.at >= sinceWall && e.at <= untilWall);
    },
    /** The first event after `sinceWall` that `match` admits. */
    first(sinceWall, match, untilWall = Infinity) {
      for (const e of events) {
        const at = wallOf(e);
        if (at !== null && at >= sinceWall && at <= untilWall && match(e)) return { ...e, at };
      }
      return null;
    },
    summary() {
      const kinds = {};
      for (const e of events) {
        const key = `${e.dir} ${e.url}${e.type ? ` ${e.type}` : ''}`;
        kinds[key] = (kinds[key] ?? 0) + 1;
      }
      return { mode, anchored: offset !== null, events: events.length, dropped, kinds };
    },
    async stop() {
      await cdp?.detach().catch(() => null);
    },
  };
}

/** A URL without its query and fragment, the path's long ids folded (`…/sessions/:id/…`), so frames group by endpoint. */
export function shortUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, '/:id').replace(/\/[0-9a-f-]{36}(?=\/|$)/g, '/:id');
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return String(url).slice(0, 120);
  }
}
