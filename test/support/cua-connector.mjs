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
import { Buffer } from 'node:buffer';
import { connect } from 'node:net';
import { renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers';

const RETRY_MS = 500;
const LIFE_MS = 120_000;
const [socketPath, reportArg = 'cua-connector.json'] = process.argv.slice(2);
const retrying = process.env.MAWS_CUA_CONNECTOR_RETRY === '1';
const leasing = retrying && process.env.MAWS_CUA_CONNECTOR_LEASE === '1';
const report = resolve(reportArg);
const state = { pid: process.pid, hello: null, closed: false, ...(retrying && { socket: socketPath, refused: 0, hellos: 0, closes: 0, connected: false }), ...(leasing && { leases: 0 }) };
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

let current = null;
function attempt() {
  const socket = connect(socketPath);
  current = socket;
  let connected = false;
  let pending = Buffer.alloc(0);
  socket.on('connect', () => {
    connected = true;
    if (!retrying) return;
    state.connected = true;
    save();
  });
  socket.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4 && pending.length >= 4 + pending.readUInt32LE(0)) {
      const length = pending.readUInt32LE(0);
      const message = JSON.parse(pending.subarray(4, 4 + length).toString('utf8'));
      pending = pending.subarray(4 + length);
      if (leasing && message.method === undefined && message.id === 1 && typeof message.result?.id === 'number') {
        socket.write(frame({ jsonrpc: '2.0', id: 2, method: 'debugger.attach', params: { tabId: message.result.id } }));
        continue;
      }
      if (leasing && message.method === undefined && message.id === 2 && message.error === undefined) {
        state.leases += 1;
        save();
        continue;
      }
      if (message.method !== 'hello' || (!retrying && state.hello !== null)) continue;
      if (retrying) state.hellos += 1;
      state.hello = message.params ?? {};
      save();
      if (leasing) socket.write(frame({ jsonrpc: '2.0', id: 1, method: 'tabs.create', params: { url: 'about:blank', group: { key: 's', title: 'cua' } } }));
    }
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    if (!retrying) {
      state.closed = true;
      save();
      process.exit(0);
    }
    if (connected) state.closes += 1;
    else state.refused += 1;
    state.connected = false;
    save();
    setTimeout(attempt, RETRY_MS);
  });
}

attempt();
if (retrying) save();
setTimeout(() => {
  if (!retrying) return void current?.destroy();
  state.closed = true;
  save();
  process.exit(0);
}, LIFE_MS);
