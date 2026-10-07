// E4c's local web server for `e2e/browser-tools.spec.ts` (E4c execution document, Design §13): one handler on the fixed
// loopback port BROWSER_TOOLS_PORT, listening on both 127.0.0.1 and [::1] so `localhost` resolves whichever family
// Chromium tries first. The port is fixed because the live recording's tool arguments carry the URL and the replay feeds
// them to the real app (Decision Log 18); a busy port fails the start loudly. `http://127.0.0.1:17391` and
// `http://localhost:17391` are two sites under site isolation, so a page of one framing the other is an OOPIF.
//
// - `/form.html` ("E4c order form"): a heading, textboxes "Name" and "Email", and a Submit button disabled until 1,200 ms
//   after the Email field's last `input` event (Playwright's fill raises `input`, never `change`; the delay keeps a
//   readiness wait running when G2's human click lands), submitting GET to `/done.html`;
// - `/done.html?name=…` ("E4c order received"): "Thanks, <name>. Your reference is MAWS-7731." in `#reference`;
// - `/embed.html`: `http://localhost:17391/frame.html` in an iframe (cross-site); `/frame.html` has "Frame button" and a
//   counter in `#count`;
// - `/slow-button.html`: a button "Slow button" enabled 3 s after load, its clicks counted in `#count` (the cover case);
// - `/dialogs.html`: "Alert" (`alert()`, then `#alert-result` reads "alert returned"), "Confirm" (`confirm()`, its
//   answer in `#confirm-result` as "confirm: true|false"), and a link "Open the pop-up" calling
//   `window.open('/popup.html')` (an adopted tab, Decision Log 60);
// - `/popup.html` ("E4c pop-up"): "Alert from the pop-up" raising an `alert()` (`#alerts` counts the returns); with
//   `?auto=1` it raises one at load as well;
// - `/links.html`: "Download the report" (`/report.csv`, served `Content-Disposition: attachment`: a navigation that
//   becomes a download, A-31) and "Open the background page" (`/background.html`, a plain link a person ⌘-clicks into
//   a background tab, Decision Log 43);
// - `/background.html` ("E4c background page"): a button "Count" counting into `#count`;
// - `/favicon.ico` (a PNG). `hits(path)` counts requests per path.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { BrowserServer } from './browser-server';

export const BROWSER_TOOLS_PORT = 17391;

export interface BrowserToolsServer extends BrowserServer {
  frameOrigin: string; // http://localhost:17391, a second site
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const page = (title: string, body: string, script = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
  `<body style="margin:0;padding:16px;font:15px system-ui;background:#fdfdfb;color:#1b1b1b">${body}<script>${script}</script></body></html>`;

const counter = (id: string) => `const n = document.getElementById('${id}'); n.textContent = String(Number(n.textContent) + 1);`;

const FORM = page(
  'E4c order form',
  `<main>
<h1>Order form</h1>
<form action="/done.html" method="get">
<p><label>Name <input name="name" autocomplete="off"></label></p>
<p><label>Email <input name="email" type="email" autocomplete="off"></label></p>
<p><button id="submit" type="submit" disabled>Submit</button></p>
</form>
</main>`,
  `const email = document.querySelector('input[name="email"]');
const submit = document.getElementById('submit');
let timer = null;
email.addEventListener('input', () => {
  submit.disabled = true;
  clearTimeout(timer);
  timer = setTimeout(() => (submit.disabled = false), 1200);
});`,
);

const done = (name: string) =>
  page('E4c order received', `<main><h1>Order received</h1><p id="reference">Thanks, ${escapeHtml(name)}. Your reference is MAWS-7731.</p></main>`);

const HTML: Record<string, string> = {
  '/form.html': FORM,
  '/embed.html': page(
    'E4c embed',
    `<main><h1>Embedded frame</h1><iframe title="Second site" src="http://localhost:${BROWSER_TOOLS_PORT}/frame.html" style="width:360px;height:140px;border:1px solid #ccc"></iframe></main>`,
  ),
  '/frame.html': page('E4c frame', `<button id="frame-button" onclick="${escapeHtml(counter('count'))}">Frame button</button> <span id="count">0</span>`),
  '/slow-button.html': page(
    'E4c slow button',
    `<main><h1>Slow button</h1><p><button id="slow" disabled onclick="${escapeHtml(counter('count'))}">Slow button</button> <span id="count">0</span></p></main>`,
    `setTimeout(() => (document.getElementById('slow').disabled = false), 3000);`,
  ),
  '/dialogs.html': page(
    'E4c dialogs',
    `<main><h1>Dialogs</h1>
<p><button id="alert" onclick="alert('Hello from E4c'); document.getElementById('alert-result').textContent = 'alert returned'">Alert</button> <span id="alert-result"></span></p>
<p><button id="confirm" onclick="document.getElementById('confirm-result').textContent = 'confirm: ' + confirm('Proceed with E4c?')">Confirm</button> <span id="confirm-result"></span></p>
<p><a id="open-popup" href="/popup.html" onclick="window.open('/popup.html'); return false">Open the pop-up</a></p>
</main>`,
  ),
  '/links.html': page(
    'E4c links',
    `<main><h1>Links</h1>
<p><a id="download" href="/report.csv">Download the report</a></p>
<p><a id="background" href="/background.html">Open the background page</a></p>
</main>`,
  ),
  '/background.html': page(
    'E4c background page',
    `<main><h1>Background page</h1><p><button id="count-button" onclick="${escapeHtml(counter('count'))}">Count</button> <span id="count">0</span></p></main>`,
  ),
};

const popup = (auto: boolean) =>
  page(
    'E4c pop-up',
    `<main><h1>Pop-up</h1><p><button id="popup-alert" onclick="popupAlert()">Alert from the pop-up</button> <span id="alerts">0</span></p></main>`,
    `function popupAlert() { alert('Hello from the pop-up'); ${counter('alerts')} }${auto ? '\npopupAlert();' : ''}`,
  );

const REPORT = 'item,count\nwidgets,3\n';

// A 1×1 PNG, the favicon every page has (Chromium asks for /favicon.ico when a page names none).
const FAVICON = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export async function startBrowserToolsServer(): Promise<BrowserToolsServer> {
  const hits = new Map<string, number>();
  const sockets = new Set<Socket>();
  const handler = (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    hits.set(path, (hits.get(path) ?? 0) + 1);
    const html = path === '/done.html' ? done(url.searchParams.get('name') ?? '') : path === '/popup.html' ? popup(url.searchParams.get('auto') === '1') : HTML[path];
    if (html !== undefined) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return response.end(html);
    }
    if (path === '/report.csv') {
      response.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="report.csv"', 'content-length': String(REPORT.length) });
      return response.end(REPORT);
    }
    if (path === '/favicon.ico') {
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': String(FAVICON.length) });
      return response.end(FAVICON);
    }
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  };
  const servers = ['127.0.0.1', '::1'].map(() => createServer(handler));
  for (const server of servers)
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
  const close = async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all(servers.filter((server) => server.listening).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  };
  try {
    await Promise.all(
      servers.map(
        (server, k) =>
          new Promise<void>((resolve, reject) => {
            server.once('error', (error) => reject(new Error(`the E4c e2e server could not listen on ${k === 0 ? '127.0.0.1' : '[::1]'}:${BROWSER_TOOLS_PORT}: ${error.message}`)));
            server.listen(BROWSER_TOOLS_PORT, k === 0 ? '127.0.0.1' : '::1', resolve);
          }),
      ),
    );
  } catch (error) {
    await close();
    throw error;
  }
  const origin = `http://127.0.0.1:${BROWSER_TOOLS_PORT}`;
  return {
    origin,
    frameOrigin: `http://localhost:${BROWSER_TOOLS_PORT}`,
    url: (path) => `${origin}${path}`,
    hits: (path) => hits.get(path) ?? 0,
    close,
  };
}
