// U3's driver (O5 M7): the second process. Plain Node, as `mawsd` is, it serves the text page on the machine's
// loopback (the localhost an agent's tab has to reach), spawns the render host (build/host.cjs under Electron, the
// command line after `--`) in a process group of its own, then plays both of the host's peers: cua's host on the
// session's cua socket (primitives through the in-app browser's server) and a remote app's view on the screencast socket
// (frames recorded with their sizes and arrival times, clicks sent back). Everything it reads goes to <out>/driver.json.
//
//   node driver.mjs --out <dir> --mode hidden|hidden-unthrottled|offscreen -- <electron> [flags] build/host.cjs [--accessory]
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectCua } from './lib/cua-client.mjs';
import { channelDecoder, encodeControl } from './lib/wire.mjs';
import { frameStats, roundTrips } from './lib/stats.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const split = argv.indexOf('--');
const own = split >= 0 ? argv.slice(0, split) : argv;
const hostCommand = split >= 0 ? argv.slice(split + 1) : [];
const opt = (name, fallback) => (own.includes(name) ? own[own.indexOf(name) + 1] : fallback);
const out = opt('--out', join(here, 'results', 'run'));
const mode = opt('--mode', 'hidden');
const repo = opt('--repo', join(here, '../..'));
const appSessionId = '7c1e5a2e-3b4f-4c6d-9e8f-0a1b2c3d4e5f';
const CLICK_X = 1140; // the page's fixed #target, 240×160 at (1020, 60)
const CLICK_Y = 140;
if (hostCommand.length === 0) throw new Error('no host command after --');
mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { mode, platform: process.platform, startedAt: new Date().toISOString(), phases: {}, errors: [] };
const save = () => writeFileSync(join(out, 'driver.json'), JSON.stringify(report, null, 2));
const log = (line) => console.error(`[u3 ${new Date().toISOString().slice(11, 19)}] ${line}`);
async function phase(name, fn) {
  const started = Date.now();
  log(`phase ${name}`);
  try {
    report.phases[name] = { ...(await fn()), ms: Date.now() - started };
  } catch (error) {
    report.phases[name] = { failed: error.message, ms: Date.now() - started };
    report.errors.push({ phase: name, message: error.message });
    log(`phase ${name} failed: ${error.message}`);
  }
  save();
}

// The page, on the loopback.
const page = readFileSync(join(here, 'page.html'));
const http = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(page);
});
await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
const pageUrl = `http://127.0.0.1:${http.address().port}/`;

// Short paths for the sockets (sockaddr_un holds 104 bytes on macOS): the host's userData and the screencast socket live
// under /tmp/u3-<random>/, removed at the end; everything kept goes under <out>.
const scratch = mkdtempSync('/tmp/u3-');
const screencastSocket = join(scratch, 'sc.sock');

const [command, ...commandArgs] = hostCommand;
const hostArgs = [...commandArgs, '--out', join(out, 'host'), '--user-data', join(scratch, 'ud'), '--session', appSessionId, '--page-url', pageUrl, '--screencast-socket', screencastSocket, '--trust-pid', String(process.pid), '--repo', repo, '--tab-window', mode];
log(`spawning ${command} ${hostArgs.join(' ')}`);
const spawnedAt = Date.now();
const child = spawn(command, hostArgs, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_ENABLE_LOGGING: undefined } });
let stderr = '';
child.stderr.on('data', (chunk) => (stderr += chunk));
const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
const killGroup = (signal) => {
  try {
    process.kill(-child.pid, signal);
  } catch {}
};
const ready = await Promise.race([
  new Promise((resolve) => {
    let buffered = '';
    child.stdout.on('data', (chunk) => {
      buffered += chunk;
      const line = buffered.split('\n').find((l) => l.startsWith('READY '));
      if (line) resolve(JSON.parse(line.slice(6)));
    });
  }),
  exited.then((exit) => ({ exitedEarly: exit })),
  sleep(90_000).then(() => ({ timedOut: true })),
]);
report.ready = { ...ready, msFromSpawn: Date.now() - spawnedAt };
save();

async function finish(code) {
  killGroup('SIGTERM');
  const exit = await Promise.race([exited, sleep(10_000).then(() => (killGroup('SIGKILL'), { killed: true }))]);
  report.hostExit = exit;
  report.hostStderrTail = stderr.split('\n').filter((l) => l.trim() && !/angle_platform_impl|egl_util|gl_display|ERR: Display|gl_ozone_egl|dbus/.test(l)).slice(-15);
  try {
    report.host = JSON.parse(readFileSync(join(out, 'host', 'result.json'), 'utf8'));
  } catch {
    report.host = null;
  }
  writeFileSync(join(out, 'host-stderr.txt'), stderr);
  report.finishedAt = new Date().toISOString();
  save();
  http.close();
  rmSync(scratch, { recursive: true, force: true });
  process.exit(code);
}
if (!ready.cuaSocket) {
  report.errors.push({ phase: 'ready', message: `the host never said READY: ${JSON.stringify(ready)}` });
  await finish(1);
}

// ---- the viewer: the screencast channel ------------------------------------------------------------------------------
const frames = []; // {at, bytes, seq, source, cdpTimestamp, hostAt}
let nextRequest = 0;
const pending = new Map();
let autoAck = true;
const viewer = connect(screencastSocket);
await new Promise((resolve, reject) => (viewer.once('connect', resolve), viewer.once('error', reject)));
const decode = channelDecoder();
viewer.on('data', (chunk) => {
  for (const message of decode(chunk)) {
    if (message.kind === 'frame') {
      const at = Date.now();
      frames.push({ at, bytes: message.data.length, seq: message.meta.seq, source: message.meta.source, cdpTimestamp: message.meta.cdpTimestamp ?? null, hostAt: message.meta.hostAt, width: message.meta.width ?? message.meta.deviceWidth ?? null });
      if (autoAck && message.meta.source === 'cdp') viewer.write(encodeControl({ id: 0, op: 'ack', ackId: message.meta.ackId }));
    } else if (message.body.re !== undefined) {
      const call = pending.get(message.body.re);
      pending.delete(message.body.re);
      if (message.body.ok) call?.resolve(message.body.value);
      else call?.reject(new Error(message.body.error));
    }
  }
});
const ask = (op, params = {}, timeoutMs = 20_000) =>
  new Promise((resolve, reject) => {
    const id = ++nextRequest;
    const t = setTimeout(() => (pending.delete(id), reject(new Error(`${op}: no answer within ${timeoutMs} ms`))), timeoutMs);
    pending.set(id, { resolve: (v) => (clearTimeout(t), resolve(v)), reject: (e) => (clearTimeout(t), reject(e)) });
    viewer.write(encodeControl({ id, op, ...params }));
  });
const evalPage = (expression) => ask('page', { expression });
const framesSince = (t) => frames.filter((f) => f.at >= t);
const cast = { format: 'jpeg', quality: 60, everyNthFrame: 1, maxWidth: 1280, maxHeight: 800 };

// One window of a page mode: warm up, then read the frames over the window and the page's own tick count over it.
async function window_(pageMode, warmupMs, windowMs) {
  await evalPage(`setMode(${JSON.stringify(pageMode)})`);
  await sleep(warmupMs);
  const ticks0 = await evalPage('window.__ticks');
  const from = Date.now();
  await sleep(windowMs);
  const to = Date.now();
  const ticks1 = await evalPage('window.__ticks');
  const stats = frameStats(frames, { from, to });
  const inWindow = frames.filter((f) => f.at >= from && f.at <= to);
  const hostToViewer = inWindow.map((f) => f.at - f.hostAt).sort((a, b) => a - b);
  return { ...stats, pageTicksPerSecond: Math.round(((ticks1 - ticks0) / ((to - from) / 1000)) * 10) / 10, hostToViewerMedianMs: hostToViewer[Math.floor(hostToViewer.length / 2)] ?? null, frameWidths: [...new Set(inWindow.map((f) => f.width))] };
}

async function clickRun(count, gapMs) {
  await evalPage('setMode("static")');
  await sleep(1500); // the stream settles: a static page sends no frames
  const before = await evalPage('window.__clicks.length');
  const clicks = [];
  const dispatch = [];
  for (let i = 0; i < count; i += 1) {
    const at = Date.now();
    clicks.push({ id: i, at });
    const done = await ask('click', { x: CLICK_X, y: CLICK_Y });
    dispatch.push(done.doneAt - at);
    await sleep(Math.max(0, gapMs - (Date.now() - at)));
  }
  await sleep(500);
  const after = await evalPage('window.__clicks.slice(-1)[0] ?? null');
  const landed = (await evalPage('window.__clicks.length')) - before;
  const rt = roundTrips(clicks, frames);
  return { ...rt, landed, lastClickTrusted: after?.trusted ?? null, dispatchMedianMs: dispatch.sort((a, b) => a - b)[Math.floor(dispatch.length / 2)] };
}

// ---- cua: the primitive server ---------------------------------------------------------------------------------------
let cua = null;
let cuaTabId = null;
const cuaSend = (method, params = {}, timeoutMs = 15_000, tabId = cuaTabId) => cua.request('debugger.sendCommand', { debuggee: { tabId }, method, params, timeoutMs }, timeoutMs + 2000);
const timed = async (fn) => {
  const t = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t };
};
// The vendor's plain screenshot: a screencast started, its first frame, acked, stopped (filter.ts's note).
async function vendorScreenshot(tabId) {
  const t = Date.now();
  const frame = cua.next('debugger.event', (p) => p.method === 'Page.screencastFrame' && p.debuggee?.tabId === tabId, 5000);
  await cuaSend('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1280, maxHeight: 800 }, 15_000, tabId);
  const got = await frame;
  await cuaSend('Page.screencastFrameAck', { sessionId: got.params.params.sessionId }, 15_000, tabId);
  await cuaSend('Page.stopScreencast', {}, 15_000, tabId);
  return { ms: got.at - t, bytes: Math.round((got.params.params.data.length * 3) / 4) };
}

await phase('cua primitives', async () => {
  cua = await connectCua(ready.cuaSocket);
  const tabs = await cua.request('tabs.query');
  cuaTabId = tabs[0]?.id;
  const attach = await timed(() => cua.request('debugger.attach', { tabId: cuaTabId }));
  const title = await timed(() => cuaSend('Runtime.evaluate', { expression: 'document.title', returnByValue: true }));
  const shot = await timed(() => cuaSend('Page.captureScreenshot', { format: 'png' }));
  const vendor = await vendorScreenshot(cuaTabId);
  const click = await timed(async () => {
    await cuaSend('Input.dispatchMouseEvent', { type: 'mousePressed', x: CLICK_X, y: CLICK_Y, button: 'left', buttons: 1, clickCount: 1 });
    await cuaSend('Input.dispatchMouseEvent', { type: 'mouseReleased', x: CLICK_X, y: CLICK_Y, button: 'left', buttons: 0, clickCount: 1 });
  });
  const clicked = await cuaSend('Runtime.evaluate', { expression: 'window.__clicks.length', returnByValue: true });
  // a tab the agent opens: the store makes its view, the host places it in a hidden window of its own
  const created = await timed(() => cua.request('tabs.create', { url: `${pageUrl}?second` }));
  const loaded = await cua.next('tabs.updated', (p) => p.tabId === created.value.id && p.status === 'complete', 15_000).then(() => true, (e) => e.message);
  await cua.request('debugger.attach', { tabId: created.value.id });
  const secondShot = await timed(() => cuaSend('Page.captureScreenshot', { format: 'png' }, 15_000, created.value.id));
  await cua.request('debugger.detach', { tabId: created.value.id });
  await cua.request('tabs.remove', { tabId: created.value.id });
  const windows = await cua.request('windows.query');
  return {
    helloMs: cua.helloMs,
    hello: cua.hello,
    tabs: tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, status: t.status })),
    attachMs: attach.ms,
    titleMs: title.ms,
    title: title.value?.result?.value,
    captureScreenshotMs: shot.ms,
    captureScreenshotBytes: Math.round(((shot.value?.data?.length ?? 0) * 3) / 4),
    vendorScreenshot: vendor,
    cuaClickMs: click.ms,
    cuaClickLanded: clicked?.result?.value,
    createdTab: { ms: created.ms, loaded, captureScreenshotMs: secondShot.ms, bytes: Math.round(((secondShot.value?.data?.length ?? 0) * 3) / 4) },
    windows,
  };
});

// The cua lease on the first tab stays held through the screencast phases, as an agent working while a person watches.
const cuaCountsBefore = cua ? JSON.parse(JSON.stringify(cua.counts)) : {};

await phase('screencast static', async () => {
  const t = Date.now();
  await ask('start', { source: 'cdp', ...cast });
  await evalPage('setMode("static")');
  await sleep(4000);
  const got = framesSince(t);
  return { frames: got.length, firstFrameMs: got[0] ? got[0].at - t : null, bytes: got.reduce((s, f) => s + f.bytes, 0), firstFrameBytes: got[0]?.bytes ?? null, widths: [...new Set(got.map((f) => f.width))] };
});
await phase('click to paint (cdp)', () => clickRun(20, 500));
await phase('text page ticking at 10 Hz (cdp)', () => window_('tick', 1000, 10_000));
await phase('text page scrolling (cdp)', () => window_('scroll', 1000, 8000));
await phase('memory while streaming', async () => ({ reading: await ask('memory', { label: 'one tab, screencast streaming' }) }));

// The viewer's screencast and the agent's share the tab's one CDP attachment: does the agent's plain screenshot (a
// screencast start, one frame, a stop) end the viewer's stream, and how much of the viewer's stream reached cua's host?
await phase('collision with the agent screenshot', async () => {
  await evalPage('setMode("tick")');
  await sleep(1500);
  const before = frameStats(frames, { from: Date.now() - 1000, to: Date.now() });
  const shot = cua ? await vendorScreenshot(cuaTabId).catch((e) => ({ failed: e.message })) : { failed: 'no cua connection' };
  const t = Date.now();
  await sleep(3000);
  const after = frameStats(frames, { from: t, to: Date.now() });
  // a restart of the viewer's own screencast after the agent's stop
  const restarted = Date.now();
  await ask('start', { source: 'cdp', ...cast });
  await sleep(2000);
  const afterRestart = frameStats(frames, { from: restarted + 300, to: Date.now() });
  const leak = {};
  for (const [key, value] of Object.entries(cua?.counts ?? {})) {
    const was = cuaCountsBefore[key] ?? { n: 0, bytes: 0 };
    if (value.n !== was.n) leak[key] = { n: value.n - was.n, bytes: value.bytes - was.bytes };
  }
  return { viewerFpsBefore: before.fps, agentScreenshot: shot, viewerFpsAfterAgentStop: after.fps, viewerFpsAfterRestart: afterRestart.fps, cuaNotificationsDuringScreencast: leak };
});

await phase('screencast stopped, idle', async () => {
  await ask('stop');
  await evalPage('setMode("static")');
  await sleep(10_000);
  return { reading: await ask('memory', { label: 'one tab, idle 10 s after the screencast' }) };
});

// The other frame source: Electron's frame subscription, needing no CDP session (no collision with the agent).
await phase('subscription: text page ticking at 10 Hz', async () => {
  await ask('start', { source: 'subscription', quality: 60, maxWidth: 1280, maxHeight: 800 });
  return window_('tick', 1000, 8000);
});
await phase('subscription: click to paint', () => clickRun(10, 500));

await phase('cua release', async () => {
  await ask('stop');
  if (cua && cuaTabId !== null) await cua.request('debugger.detach', { tabId: cuaTabId });
  return { inspect: await ask('inspect') };
});

await ask('exit').catch(() => {});
await Promise.race([exited, sleep(5000)]);
await finish(report.errors.length === 0 ? 0 : 2);
