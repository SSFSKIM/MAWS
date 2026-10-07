// E10 M0 Q4 (docs/doperpowers/plans/2026-10-06-e10-supervisor.md, M0): the Unix socket path limit on this Mac.
// `net.createServer().listen(path)` at 100, 103, 104, 105 and 110 bytes; for each, whether the bind succeeds, which
// file name the kernel actually created (a silent truncation would leave a shorter name), and whether a client can
// connect to the full path and exchange a line. Run under the plain Node on PATH and again under the repository's
// Electron binary as Node (ELECTRON_RUN_AS_NODE=1, the supervisor's runtime, §Design 1), since libuv's behaviour on an
// over-long path differs across versions.
//   node spikes/supervisor-probe/q4-socket-path.mjs
import net from 'node:net';
import { mkdirSync, writeFileSync, mkdtempSync, readdirSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LENGTHS = [100, 103, 104, 105, 110];

async function probe(dir, length) {
  const head = join(dir, 's');
  const pad = length - Buffer.byteLength(head, 'utf8') - '.sock'.length;
  const path = head + 'x'.repeat(pad) + '.sock';
  const bytes = Buffer.byteLength(path, 'utf8');
  const out = { bytes, bind: null, created: null, connect: null };
  const server = net.createServer((socket) => socket.end('pong\n'));
  out.bind = await new Promise((resolve) => {
    server.once('error', (error) => resolve({ ok: false, code: error.code, message: error.message }));
    try {
      server.listen(path, () => resolve({ ok: true }));
    } catch (error) {
      resolve({ ok: false, threw: true, code: error.code, message: error.message });
    }
  });
  const names = readdirSync(dir);
  out.created = { fullPathExists: existsSync(path), entries: names.map((n) => ({ nameBytes: Buffer.byteLength(join(dir, n), 'utf8'), equalsRequested: join(dir, n) === path })) };
  if (out.bind.ok) {
    out.connect = await new Promise((resolve) => {
      const client = net.createConnection(path);
      let data = '';
      client.setEncoding('utf8');
      client.on('data', (chunk) => (data += chunk));
      client.on('end', () => resolve({ ok: data === 'pong\n', data: data.trim() }));
      client.on('error', (error) => resolve({ ok: false, code: error.code, message: error.message }));
    });
    await new Promise((resolve) => server.close(resolve));
  } else {
    // a failed bind still tries the client side, to see whether the path is refused before any lookup
    out.connect = await new Promise((resolve) => {
      const client = net.createConnection(path);
      client.on('connect', () => { client.destroy(); resolve({ ok: true }); });
      client.on('error', (error) => resolve({ ok: false, code: error.code, message: error.message }));
    });
  }
  for (const n of readdirSync(dir)) rmSync(join(dir, n), { force: true });
  return out;
}

async function runHere() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'maws-q4-')));
  const results = [];
  try {
    for (const length of LENGTHS) results.push(await probe(dir, length));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { runtime: process.versions.electron ? `electron ${process.versions.electron} as node ${process.version}` : `node ${process.version}`, execPath: process.execPath, dirBytes: Buffer.byteLength(dir, 'utf8'), results, dirRemoved: !existsSync(dir) };
}

if (process.argv[2] === '--child') {
  process.stdout.write(JSON.stringify(await runHere()) + '\n');
} else {
  const here = await runHere();
  const repo = fileURLToPath(new URL('../..', import.meta.url));
  const electron = join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  const viaElectron = JSON.parse(execFileSync(electron, [fileURLToPath(import.meta.url), '--child'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' }));
  const result = JSON.stringify({ question: 'Q4', runs: [here, viaElectron] }, null, 1);
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./results/q4.json', import.meta.url), result + '\n');
  console.log(result);
}
