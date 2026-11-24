// The second origin (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §Q; T24): a static server on
// another port of loopback, reached under the page's own host name (`sameName`, a development server an agent started
// on another port of the name) and under `localhost` (`otherName`), serving one page whose script tries what a stranger
// in the same browser can and writes what it saw into its own document. That account is never the evidence of a
// refusal: a `no-cors` request reads the same to its page whether it was refused or obeyed, so the rig's specs judge
// each try by the status the browser saw on the wire and by what mawsd holds after it.
//
// Plain JavaScript, so it also runs as a command, for a live check by hand (M5):
//
//   node apps/sheet-page/e2e/second-origin.mjs http://sheet.localhost:47591
//
// prints the two addresses of the stranger's page aimed at that page, to be opened in the paired browser.
import { createServer } from 'node:http';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// `127.0.0.1` and `::1`, the same port on both, as the page server binds (T3); `::1` only where the machine has it.
// `make` makes one server; answers the servers and the port.
export async function listenLoopback(make, port) {
  const listen = (server, host, at) =>
    new Promise((done, failed) => {
      server.once('error', failed);
      server.listen({ host, port: at, exclusive: true, ipv6Only: host === '::1' }, () => done());
    });
  const v4 = make();
  await listen(v4, '127.0.0.1', port);
  const got = v4.address().port;
  const v6 = make();
  try {
    await listen(v6, '::1', got);
    return { servers: [v4, v6], port: got };
  } catch (error) {
    if (error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT') return { servers: [v4], port: got };
    await closeAll([v4]);
    throw error;
  }
}

export const closeAll = (servers) =>
  Promise.all(
    servers.map(
      (server) =>
        new Promise((done) => {
          server.close(() => done());
          server.closeAllConnections();
        }),
    ),
  ).then(() => undefined);

// The stranger's script. Parameters in its own address: `target`, the page's origin; `code`, a live pairing code where
// one is had; `session`, a session whose data it then tries for (M4): a read with no credential and one with a
// credential it made up, a Send's lines and an image's bytes. Each try is one `<li data-try>`; `data-done` on the body
// once all have run.
const STRANGER_SCRIPT = String.raw`
const params = new URLSearchParams(location.search);
const target = params.get('target');
const code = params.get('code') || 'AAAA-AAAA';
const list = document.getElementById('tries');
const said = (name, text) => {
  const line = document.createElement('li');
  line.dataset.try = name;
  line.textContent = name + ': ' + text;
  list.append(line);
};
// A no-cors answer the browser let through reads the same whether mawsd refused or obeyed; one it blocked fails here
const opaque = (promise) => promise.then((r) => 'answered, unreadable here (' + r.type + ')', (e) => 'refused: ' + e.message);
(async () => {
  said('pair', await opaque(fetch(target + '/api/pair', { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ code }) })));
  said('unpair', await opaque(fetch(target + '/api/unpair', { method: 'POST', mode: 'no-cors' })));
  said('read', await fetch(target + '/', { mode: 'cors' }).then(() => 'read the shell', (e) => 'refused: ' + e.message));
  said('live', await new Promise((done) => {
    const socket = new WebSocket(target.replace(/^http/, 'ws') + '/live');
    socket.onopen = () => { done('opened'); socket.close(); };
    socket.onclose = (event) => done('refused (closed ' + event.code + ' before it opened)');
  }));
  const keys = Object.keys(localStorage).filter((key) => key.startsWith('maws.sheet.'));
  said('storage', keys.length === 0 ? 'refused: nothing of the page is stored here' : 'read ' + keys.join(', '));
  const frame = document.createElement('iframe');
  frame.id = 'framed';
  frame.src = target + '/';
  await new Promise((done) => { frame.onload = done; document.body.append(frame); setTimeout(done, 3000); });
  said('frame', 'framed; whether it shows the page is the browser\'s to say');
  const session = params.get('session');
  if (session) {
    const sheet = target + '/api/sheets/' + encodeURIComponent(session);
    said('read', await opaque(fetch(sheet, { mode: 'no-cors' })));
    said('read with a made-up credential', await fetch(sheet, { headers: { Authorization: 'Bearer ' + 'A'.repeat(43) } }).then(() => 'read it', (e) => 'refused: ' + e.message));
    const line = { v: 1, key: 'page-strangerstrangerstranger00', kind: 'dismiss', id: 'q1', by: 'page' };
    said('put', await opaque(fetch(sheet + '/put', { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ lines: [line] }) })));
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    said('upload', await opaque(fetch(sheet + '/uploads', { method: 'POST', mode: 'no-cors', body: new Blob([png], { type: 'image/png' }) })));
  }
  document.body.dataset.done = '1';
})();
`;

const escaped = (text) => text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);

const strangerPage = (target, code) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>A stranger</title><link rel="icon" href="data:,"></head>
<body><h1>A page of another origin</h1>
<p>Each line below is what this page's own script saw. A refusal is judged on the wire and in what mawsd holds, never here.</p>
<ul id="tries"></ul>
<p><a id="to-fragment" href="${escaped(`${target}/#x`)}">The page, with a fragment</a> · <a id="to-query" href="${escaped(`${target}/?code=${encodeURIComponent(code || 'AAAA-AAAA')}`)}">The page, with a code in its query</a></p>
<script src="/stranger.js"></script></body></html>`;

// Answers { port, sameName, otherName, pageFor(origin, target, code?, session?), close() }
export async function secondOrigin() {
  const make = () =>
    createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://stranger');
      if (url.pathname === '/stranger.js') return void res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }).end(STRANGER_SCRIPT);
      if (url.pathname === '/') return void res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(strangerPage(url.searchParams.get('target') ?? '', url.searchParams.get('code') ?? ''));
      res.writeHead(404).end();
    });
  const { servers, port } = await listenLoopback(make, 0);
  return {
    port,
    sameName: `http://sheet.localhost:${port}`,
    otherName: `http://localhost:${port}`,
    pageFor: (origin, target, code, session) => `${origin}/?target=${encodeURIComponent(target)}${code ? `&code=${encodeURIComponent(code)}` : ''}${session ? `&session=${encodeURIComponent(session)}` : ''}`,
    close: () => closeAll(servers),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2];
  if (!target || !/^http:\/\/[^/]+$/.test(target)) {
    process.stderr.write('usage: node second-origin.mjs <the page’s address, http://sheet.localhost:<port>>\n');
    process.exit(2);
  }
  const served = await secondOrigin();
  process.stdout.write(`${served.pageFor(served.sameName, target)}\n${served.pageFor(served.otherName, target)}\nOpen either in the paired browser; stop with Ctrl-C.\n`);
}
