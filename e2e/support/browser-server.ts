// E4a's local web server for `e2e/browser.spec.ts` (E4a execution document, Interfaces "e2e"): a `node:http` server on
// loopback at an ephemeral port, so the browser's cases never reach the network. Its pages carry what the cases drive:
//
// - `/a.html` ("Page A"): a `target="_blank"` link to `/b.html`, a button calling `window.open('/c.html')`, the
//   `popupLoop()` function (ten `window.open` calls on a timer, started by the test with no input to the page), links to
//   `file:///etc/hosts`, `mailto:` and `zoommtg:`, a Notification button, a Copy button and `copyLater()` (the same
//   clipboard write from a timer), each writing its outcome into `#clipboard`, a download link to `/file.bin`, the word
//   `needle` three times, a `keydown` recorder into `#keys`, and a two-second `requestAnimationFrame` count in `#frames`;
// - `/b.html` and `/c.html` (each writes whether `window.opener` is set into `#opener`; `/c.html` also has a button
//   opening `/c.html?popup=1` with `window.open` and one calling `window.close()`), `/plain.html` (no title),
//   `/framed.html` (a same-origin frame of `/plain.html`, for the preload's main-frame rule), and `/favicon.ico` (a PNG);
// - `/file.bin` (4 KiB), `/drop` (the socket destroyed: Chromium's ERR_EMPTY_RESPONSE, a generic error), `/slow` (never
//   answers, for Stop).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export interface BrowserServer {
  origin: string; // http://127.0.0.1:<port>
  url(path: string): string;
  hits(path: string): number; // requests the server has seen for a path
  close(): Promise<void>;
}

const page = (title: string, body: string, script = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
  `<body style="margin:0;padding:16px;font:15px system-ui;background:#fdfdfb;color:#1b1b1b">${body}<script>${script}</script></body></html>`;

const A_BODY = `
<h1 id="heading">Page A</h1>
<p><a id="blank" href="/b.html" target="_blank">Open B in a new tab</a></p>
<p><button id="open-c" onclick="window.open('/c.html')">Open C</button></p>
<p>
  <a id="file-link" href="file:///etc/hosts">hosts</a> ·
  <a id="mailto-link" href="mailto:e4a@example.test">mail</a> ·
  <a id="app-link" href="zoommtg://x">app link</a>
</p>
<p><button id="notify" onclick="Notification.requestPermission().then((p) => (document.getElementById('notification').textContent = p))">Notify</button>
  <span id="notification"></span></p>
<p><button id="copy" onclick="copyNow()">Copy</button> <span id="clipboard"></span></p>
<p><a id="download" href="/file.bin" download>Download file.bin</a></p>
<p>Find the needle; a second needle; the third needle.</p>
<p>Keys: <span id="keys"></span></p>
<p>Frames: <span id="frames">0</span></p>`;

const A_SCRIPT = `
function copyNow() {
  navigator.clipboard.writeText('e4a').then(
    () => (document.getElementById('clipboard').textContent = 'copied'),
    (error) => (document.getElementById('clipboard').textContent = 'refused: ' + error.name + ': ' + error.message),
  );
}
window.copyLater = () => setTimeout(copyNow, 50);
window.popupLoop = () => {
  let n = 0;
  const timer = setInterval(() => {
    window.open('/c.html?loop=' + n);
    if (++n === 10) clearInterval(timer);
  }, 100);
};
document.addEventListener('keydown', (event) => {
  const keys = document.getElementById('keys');
  keys.textContent = (keys.textContent ? keys.textContent + ',' : '') + event.key;
});
const start = performance.now();
let frames = 0;
const tick = (now) => {
  frames++;
  document.getElementById('frames').textContent = String(frames);
  if (now - start < 2000) requestAnimationFrame(tick);
};
requestAnimationFrame(tick);`;

const OPENER_SCRIPT = `document.getElementById('opener').textContent = String(window.opener !== null);`;

// A 1×1 PNG, the favicon every page has (Chromium asks for /favicon.ico when a page names none).
const FAVICON = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const HTML: Record<string, string> = {
  '/a.html': page('Page A', A_BODY, A_SCRIPT),
  '/plain.html': '<!doctype html><html><head><meta charset="utf-8"></head><body><p id="plain">A page with no title</p></body></html>',
  '/b.html': page('Page B', '<h1 id="heading">Page B</h1><p>Opener: <span id="opener"></span></p>', OPENER_SCRIPT),
  '/c.html': page(
    'Page C',
    '<h1 id="heading">Page C</h1><p>Opener: <span id="opener"></span></p>' +
      `<p><button id="open-popup" onclick="window.open('/c.html?popup=1')">Open a popup</button> <button id="close" onclick="window.close()">Close this page</button></p>`,
    OPENER_SCRIPT,
  ),
  '/framed.html': page('Framed', '<h1 id="heading">Framed</h1><iframe id="sub" src="/plain.html" title="Plain"></iframe>'),
};

// A loopback port nothing listens on (bound, read, closed), for a refused connection. Not a fixed low port: Chromium
// refuses ports such as 1 itself (ERR_UNSAFE_PORT, a generic error) before connecting.
export async function closedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

export async function startBrowserServer(): Promise<BrowserServer> {
  const hits = new Map<string, number>();
  const sockets = new Set<Socket>();
  const held = new Set<ServerResponse>();
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    hits.set(path, (hits.get(path) ?? 0) + 1);
    const html = HTML[path];
    if (html !== undefined) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return response.end(html);
    }
    if (path === '/favicon.ico') {
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': String(FAVICON.length) });
      return response.end(FAVICON);
    }
    if (path === '/file.bin') {
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '4096' });
      return response.end(Buffer.alloc(4096, 0x61));
    }
    if (path === '/drop') return request.socket.destroy();
    if (path === '/slow') return void held.add(response); // never answered; ended at close
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    url: (path) => `${origin}${path}`,
    hits: (path) => hits.get(path) ?? 0,
    close: async () => {
      for (const response of held) response.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
