// S2 (a) route 3, the real one: Electron launched with --remote-debugging-pipe, the parent holding fds 3 (in) and 4
// (out) and speaking NUL-framed JSON. Playwright's connectOverCDP only accepts a URL, so this route needs a transport
// adapter (a WebSocket server bridging the pipe) before Playwright can use it; here the raw protocol is exercised to
// establish that Electron honours the switch and what the browser target exposes.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const now = () => performance.now();
const round = (n) => Math.round(n * 10) / 10;

const t0 = now();
const child = spawn(require('electron'), ['--remote-debugging-pipe', root, '--scenario=cdp-pipe'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] });
const out = { route: 'remote-debugging-pipe (raw, fds 3/4)', messages: [] };
let buffer = '';
let nextId = 1;
const pending = new Map();
child.stdio[4].on('data', (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf('\0')) >= 0) {
    const text = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    const msg = JSON.parse(text);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else if (msg.method) out.messages.push({ method: msg.method, sessionId: msg.sessionId ?? null, type: msg.params?.targetInfo?.type, url: msg.params?.targetInfo?.url });
  }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, resolve);
  child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0', (err) => { if (err) reject(err); });
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`${method} timed out`)); } }, 10000);
});
const stderr = [];
child.stderr.on('data', (d) => stderr.push(d.toString()));
child.stdout.on('data', () => {});
child.stdio[3].on('error', (e) => { out.pipeWriteError = e.message; });
child.on('exit', (code, signal) => { out.childExit = { code, signal }; });

try {
  await new Promise((r) => setTimeout(r, 2500)); // let the app create its window and load the page
  const t1 = now();
  const version = await send('Browser.getVersion');
  out.firstRoundTripMs = round(now() - t1);
  out.version = version.result;
  const targets = await send('Target.getTargets');
  out.targets = targets.result.targetInfos.map((t) => ({ type: t.type, url: t.url.slice(0, 80), title: t.title }));
  const page = targets.result.targetInfos.find((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1:17333/'));
  const attached = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const sessionId = attached.result.sessionId;
  const t2 = now();
  const evaluated = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }, sessionId);
  out.pageEvaluate = { ms: round(now() - t2), value: evaluated.result?.result?.value ?? evaluated };
  const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  out.screenshotBytes = shot.result?.data ? Buffer.from(shot.result.data, 'base64').length : shot;
  out.sinceLaunchMs = round(now() - t0);
  out.stderrHasDevToolsListening = stderr.join('').includes('DevTools listening');
  out.playwrightCanUseDirectly = 'no: chromium.connectOverCDP takes a ws:// or http:// endpoint; a pipe needs a WebSocket adapter in the launcher (not written here)';
} catch (e) {
  out.error = e.message;
} finally {
  out.childExitedEarly = child.exitCode;
  out.stderrTail = stderr.join('').split('\n').filter(Boolean).slice(-6).map((l) => l.slice(0, 200));
  mkdirSync(join(root, 'out'), { recursive: true });
  writeFileSync(join(root, 'out', 'cdp-pipe-raw.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  if (child.exitCode === null) {
    const exited = new Promise((r) => child.once('exit', r));
    await send('Browser.close').catch(() => {});
    await Promise.race([exited, new Promise((r) => setTimeout(r, 1500))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}
