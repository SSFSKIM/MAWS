// S2 harness main: forks the host stand-in as a utility process (or spawns / connects to it detached), opens hidden
// replica windows, hands each a document port, runs one scenario and writes its JSON to $S2_OUT_DIR/<scenario>.json.
// Never shows a window; its userData, sockets and database live under $S2_BASE (/tmp).
// Scenarios: sync | latency | kill | fuzz | detached-start | detached-connect.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, MessageChannelMain, utilityProcess, type UtilityProcess } from 'electron';
import type { Actor } from '../s2/src/host/storage';
import { MainDocRelay } from '../s2/src/socket/doc-channels';
import { encodeDocFrame, splitRecords } from '../s2/src/socket/framing';

const scenario = (process.argv.find((a) => a.startsWith('--scenario=')) ?? '').split('=')[1];
const base = process.env.S2_BASE ?? `/tmp/p3-s2/run-${scenario}`;
const outDir = process.env.S2_OUT_DIR ?? '/tmp/p3-s2/out';
const build = __dirname;
// The Yjs generation this bundle was built for (build.mjs, S2_YJS): it picks the seeds and suffixes the outputs.
const GEN = process.env.S2_YJS === '14' ? '-v14' : '';
const SEED_1MB = `/tmp/p3-s2/seed-1mb${GEN}.v2`;
const SEED_5MB = `/tmp/p3-s2/seed-5mb${GEN}.v2`;
const HUMAN: Actor = { kind: 'human' };
mkdirSync(base, { recursive: true });
mkdirSync(outDir, { recursive: true });
app.setPath('userData', join(base, 'electron-user-data'));
const now = () => performance.timeOrigin + performance.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hostLog = openSync(join(base, 'host-stdio.log'), 'a');

// ---- the utility-process host -------------------------------------------------------------------------------------
class Host {
  readonly child: UtilityProcess;
  private nextId = 1;
  private readonly waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  readonly started: Promise<void>;
  exited = false;
  readonly exit: Promise<number | null>;

  constructor(env: Record<string, string> = {}) {
    this.child = utilityProcess.fork(join(build, 'host.cjs'), [], {
      serviceName: 's2-document-host',
      stdio: 'pipe',
      env: { ...process.env, S2_USER_DATA: join(base, 'user-data'), ...env },
    });
    this.child.stdout?.on('data', (d) => writeFileSync(hostLog, d));
    this.child.stderr?.on('data', (d) => writeFileSync(hostLog, d));
    let started: () => void;
    this.started = new Promise((r) => (started = r));
    this.child.on('message', (m: { id: number; ok: boolean; value?: unknown; error?: string }) => {
      if (m.id === 0) return started();
      const w = this.waiting.get(m.id);
      this.waiting.delete(m.id);
      if (m.ok) w?.resolve(m.value);
      else w?.reject(new Error(m.error));
    });
    this.exit = new Promise((r) => this.child.once('exit', (code) => {
      this.exited = true;
      r(code);
    }));
  }

  request<T = any>(name: string, input: Record<string, unknown> = {}, ports: Electron.MessagePortMain[] = []): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.child.postMessage({ id, name, ...input }, ports);
    });
  }

  // one MessageChannelMain per open document: one end to the host, one to the renderer
  open(win: Replica, docId: string, actor: Actor = HUMAN): Promise<any> {
    const { port1, port2 } = new MessageChannelMain();
    const tMain = now();
    const reply = this.request('open', { docId, actor }, [port1]);
    win.win.webContents.postMessage('doc-port', { docId, tMain }, [port2]);
    return reply;
  }
}

// ---- a hidden replica window ---------------------------------------------------------------------------------------
class Replica {
  readonly win: BrowserWindow;
  private nextId = 1;
  private readonly waiting = new Map<number, (v: any) => void>();
  readonly ready: Promise<void>;
  synced: ((m: any) => void) | null = null;
  readonly logs: string[] = [];

  constructor(readonly role: string) {
    this.win = new BrowserWindow({
      show: false,
      webPreferences: { preload: join(build, 'preload.cjs'), sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    let ready: () => void;
    this.ready = new Promise((r) => (ready = r));
    ipcMain.on('s2-report', (event, m) => {
      if (event.sender !== this.win.webContents) return;
      if (m.t === 'ready') ready();
      else if (m.t === 'synced') this.synced?.(m);
      else if (m.t === 'log') this.logs.push(m.line);
      else if (m.t === 'res') {
        const w = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        w?.(m.ok ? m.value : { error: m.error });
      }
    });
    void this.win.loadFile(join(build, 'index.html'), { query: { role } });
  }

  cmd<T = any>(name: string, input: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.win.webContents.send('s2-cmd', { id, name, input });
    });
  }

  nextSynced(): Promise<any> {
    return new Promise((r) => (this.synced = (m) => {
      this.synced = null;
      r(m);
    }));
  }
}

// ---- measurement helpers -------------------------------------------------------------------------------------------
const stats = (xs: number[]) => {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10;
  return { n: s.length, p50: at(0.5), p95: at(0.95), max: Math.round(s[s.length - 1] * 10) / 10 };
};
type Typed = { clientId: number; keys: { t0: number; clock: number; tAck: number | null }[]; state: unknown };
function latency(typed: Typed, seen: [number, number][]) {
  const ack = typed.keys.flatMap((k) => (k.tAck === null ? [] : [k.tAck - k.t0]));
  const visible = typed.keys.flatMap((k) => {
    const hit = seen.find(([clock]) => clock >= k.clock);
    return hit ? [hit[1] - k.t0] : [];
  });
  return { keystrokes: typed.keys.length, ackMs: stats(ack), visibleInBMs: stats(visible), unacked: typed.keys.filter((k) => k.tAck === null).length };
}
const metrics = (host: Host | null) => {
  const m = app.getAppMetrics();
  const pick = (type: string) => m.filter((p) => p.type === type).map((p) => ({ pid: p.pid, workingSetKB: p.memory.workingSetSize, privateKB: p.memory.privateBytes }));
  return { utility: pick('Utility').filter((p) => !host || p.pid === host.child.pid), renderers: pick('Tab'), browser: pick('Browser') };
};
const write = (name: string, data: unknown) => writeFileSync(join(outDir, `${name}${GEN}.json`), `${JSON.stringify(data, null, 2)}\n`);

// ---- scenarios -----------------------------------------------------------------------------------------------------
async function scenarioSync() {
  const out: Record<string, unknown> = { scenario: 'sync', electron: process.versions.electron, trials: [] as unknown[] };
  const A = new Replica('A');
  const B = new Replica('B');
  await Promise.all([A.ready, B.ready]);
  for (const [label, seed] of [['1mb', SEED_1MB], ['5mb', SEED_5MB]] as const) {
    for (let trial = 0; trial < 3; trial++) {
      const host = new Host();
      await host.started;
      const docId = `seed-${label}`;
      await host.request('import', { docId, file: seed });
      await Promise.all([A.cmd('reset'), B.cmd('reset')]);
      const syncedA = A.nextSynced();
      const openA = await host.open(A, docId);
      const a = await syncedA;
      const syncedB = B.nextSynced();
      await host.open(B, docId);
      const b = await syncedB;
      const hostStats = await host.request('stats', { docId });
      const [dA, dB, live] = await Promise.all([A.cmd('digest'), B.cmd('digest'), host.request('live', { docId })]);
      (out.trials as unknown[]).push({
        label,
        trial,
        coldOpenToSyncedMs: Math.round(a.tSynced - a.tMain),
        coldHostLoadMs: Math.round(openA.loadMs),
        coldPortToSyncedMs: Math.round(a.tSynced - a.tPort),
        warmOpenToSyncedMs: Math.round(b.tSynced - b.tMain),
        stateV2: hostStats.stateV2,
        converged: dA.digest.fnv === live.digest.fnv && dB.digest.fnv === live.digest.fnv,
        hostHeapUsedMB: Math.round(hostStats.mem.heapUsed / 1e6),
        hostRssMB: Math.round(hostStats.mem.rss / 1e6),
        store: hostStats.store,
        metrics: metrics(host),
        rendererHeap: await A.cmd('memory'),
      });
      host.child.kill();
      await host.exit;
    }
  }
  write('sync', out);
}

async function scenarioLatency() {
  const fullfsync = process.env.S2_FULLFSYNC === '1';
  const host = new Host({ S2_FULLFSYNC: fullfsync ? '1' : '0' });
  await host.started;
  const docId = 'lat-1mb';
  await host.request('import', { docId, file: SEED_1MB });
  const A = new Replica('A');
  const B = new Replica('B');
  await Promise.all([A.ready, B.ready]);
  const sa = A.nextSynced();
  await host.open(A, docId);
  await sa;
  const sb = B.nextSynced();
  await host.open(B, docId);
  await sb;
  const clientA = (await A.cmd('digest')).clientId;
  const runs: Record<string, unknown> = {};
  for (const [label, input] of [
    ['human 60-180 ms', { count: 300, minMs: 60, maxMs: 180 }],
    ['fast 10 ms', { count: 300, minMs: 10, maxMs: 10 }],
    ['flood (one task)', { count: 300, flood: true }],
  ] as const) {
    await B.cmd('watch', { client: clientA });
    const typed = await A.cmd<Typed>('type', { ...input, marker: label.split(' ')[0] });
    await sleep(300);
    const seen = await B.cmd<[number, number][]>('watched');
    runs[label] = latency(typed, seen);
  }
  const hostStats = await host.request('stats', { docId });
  const [dA, dB, live, reload] = await Promise.all([A.cmd('digest'), B.cmd('digest'), host.request('live', { docId }), host.request('reload', { docId })]);
  write(fullfsync ? 'latency-fullfsync' : 'latency', {
    scenario: 'latency',
    fullfsync,
    doc: { stateV2: hostStats.stateV2 },
    runs,
    converged: dA.digest.fnv === live.digest.fnv && dB.digest.fnv === live.digest.fnv && reload.digest.fnv === live.digest.fnv,
    hostCommits: hostStats.commits,
    hostRows: hostStats.rows,
    hostMem: { heapUsedMB: Math.round(hostStats.mem.heapUsed / 1e6), rssMB: Math.round(hostStats.mem.rss / 1e6) },
    store: hostStats.store,
    provenanceBytes: hostStats.provenanceBytes,
    metrics: metrics(host),
    compaction: await (async () => {
      // fold the whole log into one version; authorship of a typed character is still answered from provenance
      const whoBefore = await host.request('who', { docId, marker: 'human:', offset: 8 });
      const compacted = await host.request('compact', { docId });
      const whoAfter = await host.request('who', { docId, marker: 'human:', offset: 8 });
      const provenanceBytesAfterCompaction = (await host.request('stats', { docId })).provenanceBytes;
      const thinned = await host.request('thin', { docId, bucketMs: 60_000 });
      const whoAfterThin = await host.request('who', { docId, marker: 'human:', offset: 8 });
      const reloadAfter = await host.request('reload', { docId });
      return { compacted, whoBefore, whoAfter, provenanceBytesAfterCompaction, thinned, whoAfterThin, reloadEqualsLive: reloadAfter.digest.fnv === (await host.request('live', { docId })).digest.fnv, reloadMs: reloadAfter.ms };
    })(),
  });
  host.child.kill();
}

async function scenarioKill() {
  const docId = 'kill-1mb';
  let host = new Host();
  await host.started;
  await host.request('import', { docId, file: SEED_1MB });
  const A = new Replica('A');
  const B = new Replica('B');
  await Promise.all([A.ready, B.ready]);
  for (const r of [A, B]) {
    const s = r.nextSynced();
    await host.open(r, docId);
    await s;
  }
  const t0 = now();
  // both type for 7 s: A every 20-30 ms, B every 35-45 ms; the host is killed at 2.5 s and restarted 1.5 s later
  const typingA = A.cmd<Typed>('type', { count: 100000, minMs: 20, maxMs: 30, untilMs: 7000, marker: 'KA', ackWaitMs: 20000 });
  const typingB = B.cmd<Typed>('type', { count: 100000, minMs: 35, maxMs: 45, untilMs: 7000, marker: 'KB', ackWaitMs: 20000 });
  await sleep(2500);
  // the flood variant: 300 keystrokes in one renderer task right before the kill, so some are in flight at it
  const flood = process.env.S2_KILL_FLOOD === '1' ? A.cmd<Typed>('type', { count: 300, flood: true, marker: 'FLOOD', ackWaitMs: 20000 }) : null;
  if (flood) await sleep(Number(process.env.S2_KILL_FLOOD_DELAY ?? 6));
  const killedPid = host.child.pid!;
  const tKill = now();
  process.kill(killedPid, 'SIGKILL');
  const exitCode = await host.exit;
  const tExit = now();
  await sleep(1500);
  host = new Host();
  await host.started;
  const tRestarted = now();
  // the store alone, before any replica reconnects: what was durable at the kill
  const durableAtKill = await host.request('reload', { docId });
  const reopened = await Promise.all([A, B].map(async (r) => {
    const s = r.nextSynced();
    const reply = await host.open(r, docId);
    const synced = await s;
    return { loadMs: reply.loadMs, syncedMs: Math.round(synced.tSynced - synced.tMain) };
  }));
  const tReconnected = now();
  const [typedA, typedB] = await Promise.all([typingA, typingB]);
  await sleep(500);
  const [dA, dB, live, reload] = await Promise.all([A.cmd('digest'), B.cmd('digest'), host.request('live', { docId }), host.request('reload', { docId })]);
  const svAtKill = new Map<number, number>(durableAtKill.sv);
  const svFinal = new Map<number, number>(reload.sv);
  const account = (typed: Typed) => {
    const atKill = svAtKill.get(typed.clientId) ?? 0;
    const final = svFinal.get(typed.clientId) ?? 0;
    const keys = typed.keys;
    const ackedBeforeKill = keys.filter((k) => k.tAck !== null && k.tAck < tKill);
    return {
      clientId: typed.clientId,
      keystrokes: keys.length,
      ackedBeforeKill: ackedBeforeKill.length,
      ackedBeforeKillLost: ackedBeforeKill.filter((k) => k.clock > atKill).length,
      typedBeforeKillUnacked: keys.filter((k) => k.t0 < tKill && (k.tAck === null || k.tAck >= tKill)).length,
      unackedButDurableAtKill: keys.filter((k) => k.t0 < tKill && (k.tAck === null || k.tAck >= tKill) && k.clock <= atKill).length,
      typedWhileDown: keys.filter((k) => k.t0 >= tKill && k.t0 < tReconnected).length,
      inStoreAtEnd: keys.filter((k) => k.clock <= final).length,
      lostAtEnd: keys.filter((k) => k.clock > final).length,
      neverAcked: keys.filter((k) => k.tAck === null).length,
    };
  };
  const typedFlood = flood ? await flood : null;
  write(process.env.S2_KILL_FLOOD === '1' ? `kill-flood${process.env.S2_FULLFSYNC === '1' ? '-fullfsync' : ''}` : 'kill', {
    scenario: 'kill',
    fullfsync: process.env.S2_FULLFSYNC === '1',
    flood: typedFlood ? account(typedFlood) : null,
    timeline: { killAtMs: Math.round(tKill - t0), exitSeenMs: Math.round(tExit - t0), restartedMs: Math.round(tRestarted - t0), reconnectedMs: Math.round(tReconnected - t0), exitCode },
    reopened,
    A: account(typedA),
    B: account(typedB),
    converged: { AeqB: dA.digest.fnv === dB.digest.fnv, AeqHost: dA.digest.fnv === live.digest.fnv, storeEqHost: reload.digest.fnv === live.digest.fnv, svEqual: JSON.stringify(dA.sv.sort()) === JSON.stringify(reload.sv.sort()) },
    rendererPhases: { A: dA.phases.map((p: any) => ({ ...p, t: Math.round(p.t - t0) })), B: dB.phases.map((p: any) => ({ ...p, t: Math.round(p.t - t0) })) },
    hostAfter: await host.request('stats', { docId }).then((s: any) => ({ rows: s.rows, rejected: s.service.rejected, log: s.log })),
  });
  host.child.kill();
}

async function scenarioFuzz() {
  const host = new Host();
  await host.started;
  const docId = 'fuzz';
  const A = new Replica('A');
  const B = new Replica('B');
  await Promise.all([A.ready, B.ready]);
  for (const r of [A, B]) {
    const s = r.nextSynced();
    await host.open(r, docId);
    await s;
  }
  await A.cmd('type', { count: 20, minMs: 5, maxMs: 5, marker: 'before' });
  // 120 ports from the renderer that send malformed bytes (random, oversized lengths, strings, ArrayBuffers, objects)
  for (let i = 0; i < 120; i++) {
    const { port1, port2 } = new MessageChannelMain();
    void host.request('open', { docId, actor: HUMAN }, [port1]);
    A.win.webContents.postMessage('doc-port', { docId, fuzz: i }, [port2]);
  }
  await sleep(1500);
  await B.cmd('type', { count: 20, minMs: 5, maxMs: 5, marker: 'after' });
  await sleep(300);
  const [dA, dB, live, reload, s] = await Promise.all([A.cmd('digest'), B.cmd('digest'), host.request('live', { docId }), host.request('reload', { docId }), host.request('stats', { docId })]);
  write('fuzz', {
    scenario: 'fuzz',
    hostAlive: !host.exited,
    rejected: s.service.rejected,
    reasons: [...new Set((s.service.rejectedReasons as { reason: string }[]).map((r) => r.reason.replace(/\d+/g, 'N')))],
    converged: dA.digest.fnv === live.digest.fnv && dB.digest.fnv === live.digest.fnv && reload.digest.fnv === live.digest.fnv,
    replicasStillLive: [dA.state.phase, dB.state.phase],
  });
  host.child.kill();
}

// Phase 1 of "main absent": main spawns the host detached (the Electron binary as Node, its own session, a Unix
// socket), as E10's detached-transport does, and quits; the host's agent replica keeps editing with no main.
async function scenarioDetachedStart() {
  const dir = join(base, 'sup');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const logFd = openSync(join(dir, 'stdio.log'), 'a');
  const child = spawn(process.execPath, [join(build, 'host.cjs'), '--detached', dir, '--seed', `ddoc=${SEED_1MB}`, '--agent', process.env.S2_AGENT ?? 'ddoc:sess-detached:40:150'], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', S2_USER_DATA: join(base, 'user-data') },
  });
  child.unref();
  const deadline = Date.now() + 10000;
  while (!existsSync(join(dir, 'h.sock')) && Date.now() < deadline) await sleep(50);
  write('detached-start', { scenario: 'detached-start', hostPid: child.pid, socket: existsSync(join(dir, 'h.sock')), mainExitAt: Date.now() });
}

// Phase 2: a new main connects, relays a renderer's port over the socket, and the renderer catches up.
async function scenarioDetachedConnect() {
  const dir = join(base, 'sup');
  const token = readFileSync(join(dir, 'token'), 'utf8');
  const socket: Socket = createConnection(join(dir, 'h.sock'));
  await new Promise<void>((r, j) => {
    socket.once('connect', () => r());
    socket.once('error', j);
  });
  const tConnected = Date.now();
  let welcomed: (v: unknown) => void;
  const welcome = new Promise((r) => (welcomed = r));
  let nextId = 1;
  const waiting = new Map<number, (v: any) => void>();
  const request = <T = any>(name: string, input: Record<string, unknown> = {}): Promise<T> => {
    const id = nextId++;
    socket.write(`${JSON.stringify({ t: 'req', id, name, input })}\n`);
    return new Promise((r) => waiting.set(id, r));
  };
  const relay = new MainDocRelay(
    (channel, frame) => socket.write(encodeDocFrame(channel, frame)),
    (name, input) => socket.write(`${JSON.stringify({ t: 'req', id: nextId++, name, input })}\n`),
  );
  const splitter = splitRecords({
    line: (text) => {
      const m = JSON.parse(text);
      if (m.t === 'welcome') welcomed(m);
      else if (m.t === 'res') {
        waiting.get(m.id)?.(m.ok ? m.value : { error: m.error });
        waiting.delete(m.id);
      } else if (m.t === 'evt' && m.name === 'documents.closed') relay.closed(m.input.channel);
    },
    doc: (channel, frame) => relay.deliver(channel, frame),
    overflow: () => socket.destroy(),
  });
  socket.on('data', (c) => splitter.push(c));
  socket.write(`${JSON.stringify({ t: 'hello', protocol: 2, token })}\n`);
  await welcome;
  const docId = 'ddoc';
  const actorsBefore = await request('actors', { docId });
  const A = new Replica('A');
  await A.ready;
  const { port1, port2 } = new MessageChannelMain();
  const synced = A.nextSynced();
  const tMain = now();
  relay.open(docId, HUMAN, port1);
  A.win.webContents.postMessage('doc-port', { docId, tMain }, [port2]);
  const s = await synced;
  const caughtUp = { openToSyncedMs: Math.round(s.tSynced - s.tMain) };
  const whoAgentEarly = await request('who', { docId, marker: 'DETACHED-0', offset: 2 });
  const lengthAtSync = (await A.cmd('digest')).digest.length;
  await sleep(4000); // the agent may still be writing: its later sentences arrive live
  const B = new Replica('B'); // a second replica over the same socket
  await B.ready;
  const { port1: q1, port2: q2 } = new MessageChannelMain();
  const syncedB = B.nextSynced();
  relay.open(docId, HUMAN, q1);
  B.win.webContents.postMessage('doc-port', { docId, tMain: now() }, [q2]);
  await syncedB;
  const clientA = (await A.cmd('digest')).clientId;
  await B.cmd('watch', { client: clientA });
  const typed = await A.cmd<Typed>('type', { count: 150, minMs: 40, maxMs: 120, marker: 'MAINBACK' });
  await sleep(300);
  const seen = await B.cmd<[number, number][]>('watched');
  const [dA, dB, live, reload] = await Promise.all([A.cmd('digest'), B.cmd('digest'), request('live', { docId }), request('reload', { docId })]);
  const startOut = JSON.parse(readFileSync(join(outDir, `detached-start${GEN}.json`), 'utf8'));
  write('detached-connect', {
    scenario: 'detached-connect',
    mainAbsent: { exitedAt: startOut.mainExitAt, connectedAt: tConnected, absentMs: tConnected - startOut.mainExitAt },
    actorsAtConnect: actorsBefore,
    agentRowsWrittenWhileMainAbsent: (actorsBefore as { actor: string; rows: number; firstAt: number; lastAt: number }[]).filter((r) => r.actor === 'session:sess-detached').map((r) => ({ rows: r.rows, firstAt: r.firstAt, lastAt: r.lastAt, firstAfterMainExit: r.firstAt > startOut.mainExitAt, lastBeforeConnect: r.lastAt < tConnected })),
    caughtUp,
    whoWroteDETACHED0: whoAgentEarly,
    whoWroteMAINBACK: await request('who', { docId, marker: 'MAINBACK', offset: 10 }),
    actorsAtEnd: await request('actors', { docId }),
    provenanceAtEnd: await request('provenanceActors', { docId }),
    latencyOverSocket: latency(typed, seen),
    converged: dA.digest.fnv === live.digest.fnv && dB.digest.fnv === live.digest.fnv && reload.digest.fnv === live.digest.fnv,
    rendererDocLength: { atSync: lengthAtSync, atEnd: dA.digest.length },
    agentRowsAfterConnect: (await request<{ actor: string; lastAt: number }[]>('actors', { docId })).filter((r) => r.actor === 'session:sess-detached' && r.lastAt > tConnected).length > 0,
  });
  await request('exit');
  socket.destroy();
}

// ---- entry ---------------------------------------------------------------------------------------------------------
app.dock?.hide();
app.on('window-all-closed', () => {}); // hidden windows only; the scenario decides when to quit
app.whenReady().then(async () => {
  const run = { sync: scenarioSync, latency: scenarioLatency, kill: scenarioKill, fuzz: scenarioFuzz, 'detached-start': scenarioDetachedStart, 'detached-connect': scenarioDetachedConnect }[scenario];
  if (!run) throw new Error(`unknown scenario ${scenario}`);
  const watchdog = setTimeout(() => {
    console.error('watchdog: scenario took too long');
    app.exit(2);
  }, 600_000);
  try {
    await run();
    clearTimeout(watchdog);
    app.exit(0);
  } catch (error) {
    console.error(error);
    write(`${scenario}-error`, { error: String((error as Error)?.stack ?? error) });
    app.exit(1);
  }
});
