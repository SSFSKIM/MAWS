// A stand-in for claude.ai/code's page, for a dry run of the harness's claude.ai loads: a page built to the guesses in
// lib/rc-selectors.mjs, answering in the browser alone (no network, no model). It proves the loads' steps run, never
// a number, and never that the guesses fit the real page: the first live pass calibrates those (README.md).
//
//   node spikes/desk-latency/standin/rc-mock.mjs [--port 0]     prints {"url": …}, serves until interrupted
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { port: { type: 'string', default: '0' } } });

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>RC mock</title><style>
body{font-family:sans-serif;display:grid;grid-template-columns:220px 1fr;height:100vh;margin:0}
nav{border-right:1px solid #ccc;padding:8px} main{display:flex;flex-direction:column;min-height:0}
.overflow-y-auto{overflow-y:auto;flex:1;padding:8px} [data-testid]{margin:4px 0;padding:4px;border:1px solid #eee}
div[contenteditable]{border:1px solid #888;min-height:40px;padding:4px;margin:8px}
</style></head><body>
<nav><a href="/code/session_mockA">Session A</a><br><a href="/code/session_mockB">Session B</a></nav>
<main><div class="overflow-y-auto" id="list"></div><div id="cards"></div><div id="controls"></div><div contenteditable="true" id="box"></div></main>
<script>
const list = document.getElementById('list'), cards = document.getElementById('cards'), controls = document.getElementById('controls'), box = document.getElementById('box');
let older = 3, running = false;
const add = (who, text, top) => { const el = document.createElement('div'); el.dataset.testid = who + '-message'; el.textContent = text; top ? list.prepend(el) : list.append(el); list.scrollTop = top ? list.scrollTop : list.scrollHeight; return el; };
// A single-page app, as claude.ai is: a session link routes in place, its history fetched (here, a moment later).
const open = () => {
  const session = location.pathname.split('/').pop();
  list.innerHTML = ''; cards.innerHTML = ''; older = 3;
  if (session.startsWith('session_')) setTimeout(() => { for (let i = 0; i < 30; i++) add(i % 2 ? 'assistant' : 'user', session + ' history ' + i); list.scrollTop = list.scrollHeight; }, 120);
};
document.querySelector('nav').addEventListener('click', (e) => { const a = e.target.closest('a'); if (!a) return; e.preventDefault(); history.pushState(null, '', a.getAttribute('href')); open(); });
open();
list.addEventListener('scroll', () => { if (list.scrollTop < 50 && older > 0) { older--; setTimeout(() => { for (let i = 0; i < 10; i++) add('user', 'older ' + older + '.' + i, true); }, 150); } });
const token = (t) => (t.match(/lat\\d+[a-z0-9]{4}/) || ['?'])[0];
const reply = (text, ms = 150) => setTimeout(() => { const el = add('assistant', ''); let i = 0; const tick = setInterval(() => { el.textContent = text.slice(0, ++i * 4); if (i * 4 >= text.length) clearInterval(tick); }, 30); }, ms);
const button = (label, onClick, where = cards, aria) => { const b = document.createElement('button'); b.textContent = label; if (aria) b.setAttribute('aria-label', aria); b.onclick = onClick; where.append(b); return b; };
const stopTurn = () => { running = false; controls.innerHTML = ''; };
box.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const text = box.textContent; box.textContent = '';
  const tk = token(text);
  const echo = add('user', text);
  if (running) { setTimeout(() => (echo.textContent += ' · Sent'), 300); return; }
  if (/AskUserQuestion/.test(text)) {
    setTimeout(() => { let chosen = null; for (const o of ['red', 'blue']) button(o, () => (chosen = o)); button('Submit', () => setTimeout(() => { cards.innerHTML = ''; reply(tk + '-' + chosen); }, 80)); }, 200);
    return;
  }
  if (/touch/.test(text)) {
    setTimeout(() => { button('Allow once', () => setTimeout(() => { cards.innerHTML = ''; reply(tk + '-done'); }, 80)); button('Deny', () => setTimeout(() => (cards.innerHTML = ''), 80)); }, 200);
    return;
  }
  if (/sleep/.test(text)) {
    running = true;
    button('Stop', () => setTimeout(stopTurn, 100), controls, 'Stop');
    setTimeout(() => { if (running) { stopTurn(); reply(tk + '-slept'); } }, 6000);
    return;
  }
  reply(tk);
});
</script></body></html>`;

const server = createServer((req, res) => {
  if (req.url.startsWith('/favicon')) return res.writeHead(204).end();
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
});
server.listen(Number(values.port), '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}` })));
