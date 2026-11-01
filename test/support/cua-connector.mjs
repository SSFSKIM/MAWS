// A stand-in for one cua host process connecting to a MAWS session's socket (the socket peer authentication spec of
// 2026-10-09, M2; e2e/browser-cua.spec.ts's scenes 6 and 7): `node cua-connector.mjs <socket> [<report>]` connects, waits
// for MAWS's hello and keeps the connection until MAWS closes it (at most two minutes), writing what it saw to <report>
// (default `cua-connector.json` in its working directory) as `{ pid, hello, closed }`: the hello's params or null, and
// whether the socket has closed. It writes nothing to stdout, so an engine stub may start it with any stdio.
//
// P5 O5 M5 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, acceptance 3): with MAWS_CUA_CONNECTOR_RETRY=1 it does
// what cua's host does with an unreachable or lost backend (cua's src/chrome/client-mode.mjs, CLIENT_RETRY_MS): it tries
// again, here every RETRY_MS, for its two minutes; the report then also counts `refused` connects (nothing listened),
// `hellos` heard and `closes` of a connection that had connected, says whether it is `connected` now, and names the
// `socket` it was given (the CUA_BROWSER_BACKENDS of the engine's settings, through the stub). With
// MAWS_CUA_CONNECTOR_LEASE=1 as well it takes a lease after each hello, as an agent's first browser call does (a tab
// created and its debugger attached, e2e/browser-cua.spec.ts's fake host's first steps), and counts the `leases` it got.
//
// P5 O17 M8 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M8): three more switches, all set by the engine's
// wrapper (a launch passes the engine no `MAWS_*` key of its own, so the wrapper names them):
// - MAWS_CUA_CONNECTOR_RETRY_MS: the retry's interval (cua's CLIENT_RETRY_MS is 5 s; RETRY_MS by default);
// - MAWS_CUA_CONNECTOR_LIFE_MS: how long it lives (two minutes by default; a measured scene keeps it connected through
//   its window);
// - MAWS_CUA_CONNECTOR_CONTROL=1: the scene drives it, as an agent drives cua, over a control socket beside its report
//   (`<report without .json>.sock`, newline-delimited JSON). `{id, call: {method, params}}` sends one request on the
//   current connection and answers `{id, ok, result | error, ms}`; `{id, sequence: {url}}` runs cua's creation sequence
//   (`windows.query`, `windows.create`, `tabs.create` of the url, `debugger.attach`, `Page.captureScreenshot` through
//   `debugger.sendCommand`) and answers `{id, ok, result: {tabId, windowId, screenshotBytes, steps}, ms}`, each step with
//   its own time; `{id, probe: {path}}` dials another socket from this process, as an engine-side peer would, and
//   answers `{hello, closed}` once it heard a hello or the socket closed (3 s at most); `{id, state: true}` answers the
//   report. A request while no hello has been heard on the current
//   connection answers `not connected`; one in flight when the connection is lost answers `lost`. With it the report
//   also counts `events`, cua's `debugger.event` notifications by CDP method, so a scene can tell which frames reached
//   cua's host.
import { Buffer } from 'node:buffer';
import { connect, createServer } from 'node:net';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';

const RETRY_MS = 500;
const LIFE_MS = 120_000;
const [socketPath, reportArg = 'cua-connector.json'] = process.argv.slice(2);
const retrying = process.env.MAWS_CUA_CONNECTOR_RETRY === '1';
const leasing = retrying && process.env.MAWS_CUA_CONNECTOR_LEASE === '1';
const controlled = process.env.MAWS_CUA_CONNECTOR_CONTROL === '1';
const positive = (text, fallback) => (Number.isSafeInteger(Number(text)) && Number(text) > 0 ? Number(text) : fallback);
const retryMs = positive(process.env.MAWS_CUA_CONNECTOR_RETRY_MS, RETRY_MS);
const lifeMs = positive(process.env.MAWS_CUA_CONNECTOR_LIFE_MS, LIFE_MS);
const report = resolve(reportArg);
const controlPath = `${report.replace(/\.json$/, '')}.sock`;
const state = {
  pid: process.pid,
  hello: null,
  closed: false,
  ...(retrying && { socket: socketPath, refused: 0, hellos: 0, closes: 0, connected: false }),
  ...(leasing && { leases: 0 }),
  ...(controlled && { control: controlPath, events: {} }),
};
const frame = (message) => {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const out = Buffer.alloc(4 + body.length);
  out.writeUInt32LE(body.length, 0);
  body.copy(out, 4);
  return out;
};
const save = () => {
  writeFileSync(`${report}.tmp`, JSON.stringify(state));
  renameSync(`${report}.tmp`, report);
};

// The current connection's requests: ids from 1000 (the lease's are 1 and 2), each answered once
let current = null;
let greeted = false; // a hello heard on the current connection
let nextId = 1000;
const pending = new Map();
function request(method, params = {}) {
  if (!current || !greeted) return Promise.reject(new Error('not connected'));
  const id = nextId++;
  return new Promise((answered, failed) => {
    pending.set(id, { answered, failed });
    current.write(frame({ jsonrpc: '2.0', id, method, params }));
  });
}
function lost() {
  for (const { failed } of pending.values()) failed(new Error('lost'));
  pending.clear();
}

function attempt() {
  const socket = connect(socketPath);
  current = socket;
  greeted = false;
  let connected = false;
  let buffered = Buffer.alloc(0);
  socket.on('connect', () => {
    connected = true;
    if (!retrying) return;
    state.connected = true;
    save();
  });
  socket.on('data', (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4 && buffered.length >= 4 + buffered.readUInt32LE(0)) {
      const length = buffered.readUInt32LE(0);
      const message = JSON.parse(buffered.subarray(4, 4 + length).toString('utf8'));
      buffered = buffered.subarray(4 + length);
      if (message.method === undefined && pending.has(message.id)) {
        const { answered, failed } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error !== undefined) failed(new Error(typeof message.error?.message === 'string' ? message.error.message : JSON.stringify(message.error)));
        else answered(message.result);
        continue;
      }
      if (leasing && message.method === undefined && message.id === 1 && typeof message.result?.id === 'number') {
        socket.write(frame({ jsonrpc: '2.0', id: 2, method: 'debugger.attach', params: { tabId: message.result.id } }));
        continue;
      }
      if (leasing && message.method === undefined && message.id === 2 && message.error === undefined) {
        state.leases += 1;
        save();
        continue;
      }
      if (controlled && message.method === 'debugger.event' && typeof message.params?.method === 'string') {
        state.events[message.params.method] = (state.events[message.params.method] ?? 0) + 1;
        continue; // counted; saved with the next answer or change of state
      }
      if (message.method !== 'hello' || (!retrying && state.hello !== null)) continue;
      greeted = true;
      if (retrying) state.hellos += 1;
      state.hello = message.params ?? {};
      save();
      if (leasing) socket.write(frame({ jsonrpc: '2.0', id: 1, method: 'tabs.create', params: { url: 'about:blank', group: { key: 's', title: 'cua' } } }));
    }
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    if (current === socket) {
      greeted = false;
      lost();
    }
    if (!retrying) {
      state.closed = true;
      save();
      process.exit(0);
    }
    if (connected) state.closes += 1;
    else state.refused += 1;
    state.connected = false;
    save();
    setTimeout(attempt, retryMs);
  });
}

// cua's creation sequence (its host's path to a new tab, as cua #251's contract pins it): the window first, then the
// tab, then the tab's debugger and a screenshot through it
async function sequence({ url }) {
  const steps = [];
  const step = async (method, params) => {
    const started = performance.now();
    const name = method === 'debugger.sendCommand' ? params.method : method;
    try {
      const result = await request(method, params);
      steps.push({ method: name, ms: Math.round(performance.now() - started) });
      return result;
    } catch (error) {
      steps.push({ method: name, ms: Math.round(performance.now() - started), error: error.message });
      throw Object.assign(error, { steps });
    }
  };
  await step('windows.query', {});
  const window = await step('windows.create', { url: 'about:blank', focused: false });
  const tab = await step('tabs.create', { url, group: { key: 's', title: 'cua' } });
  const tabId = tab.id;
  await step('debugger.attach', { tabId });
  const shot = await step('debugger.sendCommand', { debuggee: { tabId }, method: 'Page.captureScreenshot', params: { format: 'png' }, timeoutMs: 10_000 });
  return { tabId, windowId: window?.id ?? null, screenshotBytes: Buffer.from(String(shot?.data ?? ''), 'base64').length, steps };
}

// Another socket dialled from this process: what came first, a hello or the close
function probe({ path }) {
  return new Promise((done) => {
    const socket = connect(path);
    let buffered = Buffer.alloc(0);
    const settle = (outcome) => {
      clearTimeout(timer);
      socket.destroy();
      done(outcome);
    };
    const timer = setTimeout(() => settle({ hello: null, closed: false }), 3_000);
    socket.on('error', () => {});
    socket.on('close', () => settle({ hello: null, closed: true }));
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 4 || buffered.length < 4 + buffered.readUInt32LE(0)) return;
      const message = JSON.parse(buffered.subarray(4, 4 + buffered.readUInt32LE(0)).toString('utf8'));
      settle({ hello: message.method === 'hello' ? (message.params ?? {}) : null, closed: false });
    });
  });
}

function serveControl() {
  rmSync(controlPath, { force: true }); // a connector before this one of the session left its socket behind
  const server = createServer((client) => {
    let text = '';
    const answer = (line) => client.write(`${JSON.stringify(line)}\n`);
    client.on('error', () => {});
    client.on('data', (chunk) => {
      text += String(chunk);
      for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n')) {
        const line = text.slice(0, at).trim();
        text = text.slice(at + 1);
        if (!line) continue;
        const asked = JSON.parse(line);
        const started = performance.now();
        const done = (outcome) => answer({ id: asked.id, ms: Math.round(performance.now() - started), ...outcome });
        if (asked.state) {
          done({ ok: true, result: state });
          continue;
        }
        const run = asked.sequence ? sequence(asked.sequence) : asked.probe ? probe(asked.probe) : request(asked.call.method, asked.call.params ?? {});
        run.then(
          (result) => (save(), done({ ok: true, result })),
          (error) => (save(), done({ ok: false, error: error.message, ...(error.steps && { steps: error.steps }) })),
        );
      }
    });
  });
  server.listen(controlPath);
}

if (controlled) serveControl();
attempt();
if (retrying) save();
setTimeout(() => {
  if (!retrying) return void current?.destroy();
  state.closed = true;
  save();
  process.exit(0);
}, lifeMs);
