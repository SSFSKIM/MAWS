// A stand-in for one cua host process connecting to a MAWS session's socket (the socket peer authentication spec of
// 2026-10-09, M2; e2e/browser-cua.spec.ts's scenes 6 and 7): `node cua-connector.mjs <socket> [<report>]` connects, waits
// for MAWS's hello and keeps the connection until MAWS closes it (at most two minutes), writing what it saw to <report>
// (default `cua-connector.json` in its working directory) as `{ pid, hello, closed }`: the hello's params or null, and
// whether the socket has closed. It writes nothing to stdout, so an engine stub may start it with any stdio.
import { Buffer } from 'node:buffer';
import { connect } from 'node:net';
import { renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers';

const [socketPath, reportArg = 'cua-connector.json'] = process.argv.slice(2);
const report = resolve(reportArg);
const state = { pid: process.pid, hello: null, closed: false };
const save = () => {
  writeFileSync(`${report}.tmp`, JSON.stringify(state));
  renameSync(`${report}.tmp`, report);
};

const socket = connect(socketPath);
let pending = Buffer.alloc(0);
socket.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4 && pending.length >= 4 + pending.readUInt32LE(0)) {
    const length = pending.readUInt32LE(0);
    const message = JSON.parse(pending.subarray(4, 4 + length).toString('utf8'));
    pending = pending.subarray(4 + length);
    if (message.method === 'hello' && state.hello === null) {
      state.hello = message.params ?? {};
      save();
    }
  }
});
socket.on('error', () => {});
socket.on('close', () => {
  state.closed = true;
  save();
  process.exit(0);
});
setTimeout(() => socket.destroy(), 120_000);
