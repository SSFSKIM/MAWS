// S7b harness main (adapted from S2's spikes/p3-store/electron/main.ts): forks the host stand-in as a utility process,
// opens hidden replica windows (show:false, backgroundThrottling:false; never on the desktop), hands each a document
// port, drives window A through CDP (webContents.debugger), runs one scenario and writes its JSON to
// $S7_OUT/b-<scenario>[-<tag>].json. Its userData, database and seeds live under /tmp/p3-s7b.
// Scenarios: probe | typing | firstsync | history | memory | deck | ime | kill.
import { mkdirSync, openSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, MessageChannelMain, utilityProcess, type UtilityProcess } from 'electron';
import { keystrokes, type Step } from './hangul';

const scenario = (process.argv.find((a) => a.startsWith('--scenario=')) ?? '').split('=')[1];
const tag = process.env.S7_TAG ? `-${process.env.S7_TAG}` : '';
const base = process.env.S7_BASE ?? `/tmp/p3-s7b/run-${scenario}${tag}-${Date.now()}`;
const outDir = process.env.S7_OUT ?? '/tmp/p3-s7b/out';
const SEED = process.env.S7_SEED ?? '/tmp/p3-s7b/seed-200p.v2';
const DECK = process.env.S7_DECK ?? '/tmp/p3-s7b/deck-100.json';
const build = __dirname;
const HUMAN = { kind: 'human' };
const DOC = 'doc200';
mkdirSync(base, { recursive: true });
mkdirSync(outDir, { recursive: true });
app.setPath('userData', join(base, 'electron-user-data'));
app.commandLine.appendSwitch('enable-precise-memory-info'); // performance.memory is otherwise bucketed and cached
const now = () => performance.timeOrigin + performance.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hostLog = openSync(join(base, 'host-stdio.log'), 'a');
const progressLog = openSync(join(base, 'progress.log'), 'a');
const step = (what: string) => writeFileSync(progressLog, `${new Date().toISOString()} ${what}\n`);
const load = () => loadavg().map((l) => +l.toFixed(2));
const loads: { at: string; load: number[] }[] = [];
const markLoad = (at: string) => {
  const l = { at, load: load() };
  loads.push(l);
  return l.load;
};

// ---- the utility-process host -------------------------------------------------------------------------------------
type HostEvent = { t: string; [k: string]: unknown };
class Host {
  readonly child: UtilityProcess;
  private nextId = 1;
  private readonly waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  readonly started: Promise<void>;
  readonly exit: Promise<number | null>;
  readonly events: HostEvent[] = [];
  exited = false;

  constructor() {
    this.child = utilityProcess.fork(join(build, 'host.cjs'), [], {
      serviceName: 's7b-document-host',
      stdio: 'pipe',
      execArgv: ['--expose-gc'],
      env: { ...process.env, S7_USER_DATA: join(base, 'user-data'), S7_FULLFSYNC: '1' },
    });
    this.child.stdout?.on('data', (d) => writeFileSync(hostLog, d));
    this.child.stderr?.on('data', (d) => writeFileSync(hostLog, d));
    let started: () => void;
    this.started = new Promise((r) => (started = r));
    this.child.on('message', (m: { id: number; ok: boolean; value?: unknown; error?: string; event?: HostEvent }) => {
      if (m.id === 0) return started();
      if (m.id === -1) {
        this.events.push(m.event!);
        return;
      }
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
    step(`host request ${name}`);
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.child.postMessage({ id, name, ...input }, ports);
    });
  }

  open(win: Replica, docId: string): Promise<any> {
    const { port1, port2 } = new MessageChannelMain();
    const tMain = now();
    const reply = this.request('open', { docId, actor: HUMAN }, [port1]);
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
  synced: (() => void) | null = null;
  readonly logs: string[] = [];
  private attached = false;

  constructor(readonly role: string, page: 'editor' | 'deck' = 'editor') {
    this.win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      paintWhenInitiallyHidden: true,
      webPreferences: { preload: join(build, 'preload.cjs'), sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    let ready: () => void;
    this.ready = new Promise((r) => (ready = r));
    // compare by id: reading `webContents` of a destroyed window throws, and a throwing listener stops every later one
    const wcId = this.win.webContents.id;
    const onReport = (event: Electron.IpcMainEvent, m: any) => {
      if (event.sender.id !== wcId) return;
      if (m.t === 'ready') ready();
      else if (m.t === 'synced') this.synced?.();
      else if (m.t === 'log') this.logs.push(m.line);
      else if (m.t === 'res') {
        const w = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        w?.(m.ok ? m.value : { error: m.error });
      }
    };
    ipcMain.on('s2-report', onReport);
    this.win.once('closed', () => ipcMain.off('s2-report', onReport));
    void this.win.loadFile(join(build, `${page}.html`), { query: { role } });
  }

  cmd<T = any>(name: string, input: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.win.webContents.send('s2-cmd', { id, name, input });
    });
  }

  nextSynced(): Promise<void> {
    return new Promise((r) => (this.synced = () => {
      this.synced = null;
      r();
    }));
  }

  async cdp(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const dbg = this.win.webContents.debugger;
    if (!this.attached) {
      dbg.attach('1.3');
      this.attached = true;
      await dbg.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    }
    return dbg.sendCommand(method, params);
  }

  async ev<T = any>(js: string): Promise<T> {
    const r = await this.cdp('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result.value;
  }

  // one plain keystroke through the browser's input pipeline
  async key(ch: string): Promise<void> {
    const code = ch === ' ' ? 'Space' : `Key${ch.toUpperCase()}`;
    const vk = ch === ' ' ? 32 : ch.toUpperCase().charCodeAt(0);
    await this.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: vk });
    await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: vk });
  }

  pid(): number {
    return this.win.webContents.getOSProcessId();
  }
}

// ---- helpers -------------------------------------------------------------------------------------------------------
const stats = (xs: number[]) => {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10;
  return { n: s.length, p50: at(0.5), p95: at(0.95), max: Math.round(s[s.length - 1] * 10) / 10 };
};
const metrics = (host: Host | null, replicas: Replica[] = []) => {
  const m = app.getAppMetrics();
  const byPid = new Map(m.map((p) => [p.pid, p]));
  const mb = (kb?: number) => (kb === undefined ? null : +(kb / 1024).toFixed(1));
  return {
    host: host && byPid.get(host.child.pid!) ? { workingSetMB: mb(byPid.get(host.child.pid!)!.memory.workingSetSize), privateMB: mb(byPid.get(host.child.pid!)!.memory.privateBytes) } : null,
    renderers: Object.fromEntries(replicas.filter((r) => !r.win.isDestroyed()).map((r) => [r.role, { workingSetMB: mb(byPid.get(r.pid())?.memory.workingSetSize), privateMB: mb(byPid.get(r.pid())?.memory.privateBytes) }])),
    browser: m.filter((p) => p.type === 'Browser').map((p) => ({ workingSetMB: mb(p.memory.workingSetSize) })),
    gpu: m.filter((p) => p.type === 'GPU').map((p) => ({ workingSetMB: mb(p.memory.workingSetSize) })),
  };
};
const write = (name: string, data: unknown) => {
  const file = join(outDir, `b-${name}${tag}.json`);
  writeFileSync(file, `${JSON.stringify({ electron: process.versions.electron, loads, ...(data as object) }, null, 2)}\n`);
  return file;
};

async function startHost(): Promise<Host> {
  const host = new Host();
  await host.started;
  await host.request('import', { docId: DOC, file: SEED });
  return host;
}

async function openEditor(host: Host, r: Replica): Promise<any> {
  step(`${r.role}: waiting for ready`);
  await r.ready;
  const synced = r.nextSynced();
  step(`${r.role}: open`);
  const reply = await host.open(r, DOC);
  step(`${r.role}: opened, waiting for synced`);
  await synced;
  step(`${r.role}: synced, mounting`);
  const mounted = await r.cmd('mount');
  step(`${r.role}: mounted`);
  if (mounted?.error) throw new Error(`${r.role}: ${mounted.error}`);
  return { ...mounted, hostLoadMs: reply.loadMs, attachMs: reply.attachMs };
}

// the human types into the middle of the document (section 80 of 160), the agents keep away from sections 78-82
const SECTION = Number(process.env.S7_SECTION ?? 80);
const HUMAN_BLOCK = `s${SECTION}p2`;
const AVOID = [-2, -1, 0, 1, 2].map((d) => `s${SECTION + d}`).filter((p) => !/^s-/.test(p));
// S7_AGENT_WRITER=touched|document: every agent batch goes through S4's patch writer (writer/patch-writer.ts)
const AGENT_WRITER = process.env.S7_AGENT_WRITER;
const AGENTS = (extra: Record<string, unknown> = {}) => (AGENT_WRITER && !('writer' in extra) ? AGENTS_({ ...extra, writer: AGENT_WRITER }) : AGENTS_(extra));
const AGENTS_ = (extra: Record<string, unknown> = {}) => [
  { sessionId: 'a1', intervalMs: [800, 1600], avoidPrefixes: AVOID, ...extra },
  { sessionId: 'a2', intervalMs: [800, 1600], avoidPrefixes: AVOID, ...extra },
];

async function typeKeys(r: Replica, count: number, [minMs, maxMs]: [number, number]): Promise<void> {
  const letters = 'the quick brown fox jumps over the lazy dog ';
  for (let i = 0; i < count; i++) {
    await r.key(letters[i % letters.length]);
    await sleep(minMs + Math.random() * (maxMs - minMs));
  }
}

// keystroke clocks of A as seen in B: the first B observation at or past the keystroke's clock
function visibleInB(report: { clocks: { t: number; clock: number | null }[] }, seen: { clock: number; at: number; raf?: number }[]) {
  const vis: number[] = [];
  const paint: number[] = [];
  for (const k of report.clocks) {
    if (k.clock === null) continue;
    const hit = seen.find((s) => s.clock >= k.clock!);
    if (!hit) continue;
    vis.push(hit.at - k.t);
    if (hit.raf) paint.push(hit.raf - k.t);
  }
  return { inputToAppliedInBMs: stats(vis), inputToFrameInBMs: stats(paint) };
}

// ---- scenarios -----------------------------------------------------------------------------------------------------
async function scenarioProbe() {
  const host = await startHost();
  const A = new Replica('A');
  const mounted = await openEditor(host, A);
  const caret = await A.cmd('caret', { blockId: HUMAN_BLOCK });
  const visibility = await A.ev('({ vis: document.visibilityState, hidden: document.hidden, focus: document.hasFocus() })');
  const rafRate = await A.ev('new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else r(n) }; requestAnimationFrame(f) })');
  await A.cmd('measure.start');
  await typeKeys(A, 30, [60, 120]);
  const typed = await A.cmd('measure.stop');
  const text = await A.cmd('blockText', { id: HUMAN_BLOCK });
  write('probe', { mounted, caret, visibility, rafPerSecond: rafRate, typed: { ...typed, clocks: undefined }, text, metrics: metrics(host, [A]), hostStats: await host.request('stats', { docId: DOC }) });
  host.child.kill();
}

async function scenarioTyping() {
  const host = await startHost();
  const A = new Replica('A');
  const B = new Replica('B');
  const mountA = await openEditor(host, A);
  const mountB = await openEditor(host, B);
  await A.cmd('caret', { blockId: HUMAN_BLOCK });
  const clientA = (await A.cmd('digest')).clientId;
  const count = Number(process.env.S7_KEYS ?? 300);
  const pace: [number, number] = [60, 180];
  const runs: Record<string, unknown> = {};
  // S7_RUNS: quiet (no agent), agents (doc.ts batches), writer-document / writer-touched (S4's patch writer, whole-doc
  // or touched-block validation); default quiet,agents
  for (const label of (process.env.S7_RUNS ?? 'quiet,agents').split(',')) {
    const eventsBefore = host.events.length;
    if (label !== 'quiet') {
      const writer = label.startsWith('writer-') ? label.slice('writer-'.length) : undefined;
      await host.request('agents.start', { docId: DOC, agents: AGENTS(writer ? { writer } : {}) });
      await sleep(1500);
    }
    await B.cmd('watch', { client: clientA });
    await host.request('loop.reset');
    await A.cmd('measure.start');
    await B.cmd('measure.start');
    const l0 = markLoad(`typing ${label} start`);
    await typeKeys(A, count, pace);
    const rep = await A.cmd('measure.stop');
    const repB = await B.cmd('measure.stop');
    const l1 = markLoad(`typing ${label} end`);
    const seen = await B.cmd('watched');
    const hostLoop = await host.request('loop.read');
    const agents = label !== 'quiet' ? await host.request('agents.stop', { docId: DOC }) : null;
    const writerErrors = host.events.slice(eventsBefore).filter((e) => e.t === 'writer-error').map((e) => e.message);
    runs[label] = { load: [l0, l1], hostLoopDelayMs: hostLoop, A: { ...rep, clocks: undefined }, B: { ...visibleInB(rep, seen), remoteFrames: repB.remoteFrames, longTasks: repB.longTasks }, agents, writerErrors: writerErrors.slice(0, 5), writerErrorCount: writerErrors.length };
  }
  await sleep(500);
  const [dA, dB, live, reload] = await Promise.all([A.cmd('digest'), B.cmd('digest'), host.request('live', { docId: DOC }), host.request('reload', { docId: DOC })]);
  const file = write('typing', {
    doc: 'seed-200p (160 sections)',
    pace,
    mount: { A: mountA, B: mountB },
    runs,
    converged: dA.digest === live.digest && dB.digest === live.digest && reload.digest === live.digest,
    pageErrors: [...dA.errors, ...dB.errors],
    metrics: metrics(host, [A, B]),
    hostStats: await host.request('stats', { docId: DOC }),
  });
  console.log(`wrote ${file}`);
  host.child.kill();
}

async function scenarioFirstSync() {
  const trials: unknown[] = [];
  let host = await startHost();
  // let the store hold a realistic log: agents write for a while, then everything is closed
  await host.request('agents.start', { docId: DOC, agents: AGENTS({ intervalMs: [300, 600] }) });
  await sleep(Number(process.env.S7_LOG_MS ?? 15000));
  const agentStats = await host.request('agents.stop', { docId: DOC });
  await host.request('agents.close', { docId: DOC });
  const storeAfterAgents = await host.request('stats', { docId: DOC });
  const encodings = await host.request('encodings', { docId: DOC });
  const replicas: Replica[] = [];
  for (let trial = 0; trial < 3; trial++) {
    host.child.kill();
    await host.exit;
    host = new Host();
    await host.started;
    markLoad(`firstsync trial ${trial}`);
    const C = new Replica(`C${trial}`);
    replicas.push(C);
    await C.ready;
    await host.request('loop.reset');
    const cold = await openEditor(host, C);
    cold.hostLoopDelayMs = await host.request('loop.read');
    const D = new Replica(`D${trial}`);
    replicas.push(D);
    await D.ready;
    await host.request('loop.reset');
    const warm = await openEditor(host, D);
    warm.hostLoopDelayMs = await host.request('loop.read');
    trials.push({ trial, load: load(), cold, warm, metrics: metrics(host, [C, D]) });
    C.win.destroy();
    D.win.destroy();
  }
  // item 8: V1 (the wire) against V2 in a renderer
  const E = new Replica('E');
  await E.ready;
  const rendererEncodings = await E.cmd('encodings', { v1: encodings.v1, v2: encodings.v2 });
  const pick = (k: string) => trials.map((t: any) => Math.round(t.cold[k] ?? 0));
  const pickW = (k: string) => trials.map((t: any) => Math.round(t.warm[k] ?? 0));
  write('firstsync', {
    storeAfterAgents: { rows: storeAfterAgents.rows, store: storeAfterAgents.store, agentStats },
    summary: {
      coldOpenToSyncedMs: pick('openToSyncedMs'), coldOpenToPaintMs: pick('openToPaintMs'), coldHostLoadMs: pick('hostLoadMs'), coldStep2ApplyMs: pick('step2ApplyMs'), coldBindMs: pick('bindMs'),
      warmOpenToSyncedMs: pickW('openToSyncedMs'), warmOpenToPaintMs: pickW('openToPaintMs'), warmStep2ApplyMs: pickW('step2ApplyMs'), warmBindMs: pickW('bindMs'),
    },
    trials,
    encodings: { host: { v1Bytes: encodings.v1Bytes, v2Bytes: encodings.v2Bytes, v1EncodeMs: encodings.v1EncodeMs, v2EncodeMs: encodings.v2EncodeMs }, renderer: rendererEncodings },
  });
  host.child.kill();
}

async function scenarioHistory() {
  const host = await startHost();
  const A = new Replica('A');
  await openEditor(host, A);
  await A.cmd('caret', { blockId: HUMAN_BLOCK });
  // an auto version early in the session, then a stretch of human typing and agent edits
  await host.request('agents.start', { docId: DOC, agents: AGENTS() });
  await typeKeys(A, 60, [60, 120]);
  const version = await host.request('version', { docId: DOC });
  await typeKeys(A, 150, [60, 120]);
  await sleep(Number(process.env.S7_HISTORY_MS ?? 20000));
  const agentStats = await host.request('agents.stop', { docId: DOC });
  const runs: unknown[] = [];
  for (let i = 0; i < 3; i++) {
    const l = markLoad(`history ${i}`);
    await host.request('loop.reset');
    const t0 = now();
    const payload = await host.request('history', { docId: DOC, versionSeq: version.seq });
    const hostLoop = await host.request('loop.read');
    const t1 = now();
    const enter = await A.cmd('history.enter', { prevState: payload.prevState, nextState: payload.nextState, attributions: payload.attributions });
    if (enter?.error) throw new Error(enter.error);
    await sleep(300);
    const leave = await A.cmd('history.leave');
    runs.push({ load: l, hostLoopDelayMs: hostLoop, fetchMs: Math.round(t1 - t0), host: payload.timings, bytes: payload.bytes, enter, leave, totalEnterMs: Math.round(t1 - t0 + enter.toPostPaintMs) });
    await sleep(500);
  }
  const memory = { renderer: await A.cmd('memory'), metrics: metrics(host, [A]) };
  const [dA, live] = await Promise.all([A.cmd('digest'), host.request('live', { docId: DOC })]);
  write('history', { version, agentStats, runs, memory, liveUnchanged: dA.digest === live.digest, pageErrors: dA.errors });
  host.child.kill();
}

async function scenarioMemory() {
  const host = new Host();
  await host.started;
  const stages: Record<string, unknown> = {};
  const snap = async (label: string, replicas: Replica[]) => {
    await sleep(1500);
    const s = await host.request('stats', { docId: DOC, gc: true });
    const renderer: Record<string, unknown> = {};
    for (const r of replicas) if (!r.win.isDestroyed()) renderer[r.role] = await r.cmd('memory');
    stages[label] = { load: markLoad(label), host: s.mem, hostLoaded: s.loaded, collectedByGC: s.collected, metrics: metrics(host, replicas), rendererHeap: renderer };
  };
  await snap('host idle, no doc', []);
  await host.request('import', { docId: DOC, file: SEED });
  await host.request('load', { docId: DOC });
  await snap('host, doc loaded, no replica', []);
  const A = new Replica('A');
  const B = new Replica('B');
  await openEditor(host, A);
  await openEditor(host, B);
  await snap('A and B open', [A, B]);
  await host.request('agents.start', { docId: DOC, agents: AGENTS() });
  await A.cmd('caret', { blockId: HUMAN_BLOCK });
  await typeKeys(A, 200, [60, 120]);
  await sleep(Number(process.env.S7_MEM_MS ?? 30000));
  await snap('A and B open, two agents live, after typing', [A, B]);
  await host.request('agents.stop', { docId: DOC });
  B.win.destroy();
  await snap('B closed', [A]);
  A.win.destroy();
  await snap('A closed too (agents still attached)', []);
  await host.request('agents.close', { docId: DOC, destroyAwareness: process.env.S7_DESTROY_AWARENESS === '1' });
  await snap('agents closed (no connection; S2 service keeps the doc)', []);
  const unload = await host.request('unload', { docId: DOC });
  await snap('doc unloaded by hand', []);
  write('memory', { stages, unload });
  host.child.kill();
}

async function scenarioIme() {
  const host = await startHost();
  const A = new Replica('A');
  const B = new Replica('B');
  await openEditor(host, A);
  await openEditor(host, B);
  const TYPED = ' 안녕하세요 한글 입력 테스트입니다';
  const target = HUMAN_BLOCK;
  const variants: { name: string; target: string | null; hold: boolean; merge?: boolean }[] = [
    { name: 'agents elsewhere', target: null, hold: false },
    { name: 'agents also edit the same block', target, hold: false },
    { name: 'agents also edit the same block, remote frames held while composing', target, hold: true },
    { name: 'agents also edit the same block, held, flushed as one merged update', target, hold: true, merge: true },
  ];
  const results: unknown[] = [];
  const reps = Number(process.env.S7_IME_REPS ?? 3);
  await host.request('agents.start', { docId: DOC, agents: AGENTS({ intervalMs: [150, 400] }) });
  for (const v of variants) {
    for (let rep = 0; rep < reps; rep++) {
      await host.request('agents.retarget', { docId: DOC, target: v.target });
      await A.cmd('hold', { on: v.hold, merge: v.merge === true });
      await A.cmd('caret', { blockId: target });
      const before = (await A.cmd('blockText', { id: target })).editor as string;
      await host.request('loop.reset');
      await A.cmd('measure.start');
      const l = markLoad(`ime ${v.name} ${rep}`);
      const steps = keystrokes(TYPED);
      for (const s of steps) await imeStep(A, s, steps);
      await sleep(400);
      await host.request('agents.retarget', { docId: DOC, target: null });
      const rep_ = await A.cmd('measure.stop');
      rep_.hostLoopDelayMs = await host.request('loop.read');
      await sleep(800);
      const after = (await A.cmd('blockText', { id: target })).editor as string;
      const inB = (await B.cmd('blockText', { id: target })).editor as string;
      const hangul = (s: string) => [...s].filter((c) => /[ㄱ-ㆎ가-힣]/.test(c)).join('');
      const expectHangul = hangul(TYPED);
      const ok = after.includes(TYPED) && hangul(after) === hangul(before) + expectHangul;
      results.push({ variant: v.name, rep, load: l, ok, typedExactly: after.includes(TYPED), hangulInBlock: hangul(after), expected: hangul(before) + expectHangul, sameInB: after === inB, ...summarizeIme(rep_) });
      console.log(`${ok ? 'PASS' : 'FAIL'} ime [${v.name}] rep ${rep}: ${JSON.stringify(hangul(after).slice(-24))}`);
      await A.cmd('hold', { on: false });
    }
  }
  const agents = await host.request('agents.stop', { docId: DOC });
  const [dA, dB, live] = await Promise.all([A.cmd('digest'), B.cmd('digest'), host.request('live', { docId: DOC })]);
  write('ime', { typed: TYPED, results, agents, converged: dA.digest === live.digest && dB.digest === live.digest, pageErrors: [...dA.errors, ...dB.errors] });
  host.child.kill();
}

function summarizeIme(r: any) {
  return { keystrokes: r.keystrokes, inputEventToFrameMs: r.inputEventToFrameMs, inputEventToPostPaintMs: r.inputEventToPostPaintMs, inputToFrameMs: r.inputToFrameMs, inputToPostPaintMs: r.inputToPostPaintMs, inputToTxMs: r.inputToTxMs, inputToAckMs: r.inputToAckMs, hostLoopDelayMs: r.hostLoopDelayMs, longTasks: r.longTasks, eventTiming: r.eventTiming, remoteFrames: r.remoteFrames, holds: r.holds };
}

// S4's 2-set step model (hangul.ts) driven through CDP as S4's main.ts drives it
async function imeStep(r: Replica, s: Step, steps: Step[]) {
  switch (s.kind) {
    case 'key':
      await r.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229, key: s.key, code: s.code });
      break;
    case 'compose':
      await r.cdp('Input.imeSetComposition', { text: s.text, selectionStart: s.text.length, selectionEnd: s.text.length });
      break;
    case 'commit':
      await r.cdp('Input.insertText', { text: s.text });
      break;
    case 'plain':
      await r.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ', unmodifiedText: ' ' });
      await r.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      break;
    case 'backspace':
      await r.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229, key: 'Backspace', code: 'Backspace' });
      break;
  }
  if (s.kind === 'compose') {
    const i = steps.indexOf(s);
    const prevKey = [...steps.slice(0, i)].reverse().find((x) => x.kind === 'key') as Extract<Step, { kind: 'key' }> | undefined;
    if (prevKey) await r.cdp('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: prevKey.keyCode, key: prevKey.key, code: prevKey.code });
  }
  // the capture's pace: about 70-90 ms between jamo (after the jamo's composition step, never between its keydown and it)
  if (s.kind === 'compose' || s.kind === 'plain') await sleep(60 + Math.random() * 30);
}

async function scenarioKill() {
  let host = await startHost();
  const A = new Replica('A');
  const B = new Replica('B');
  await openEditor(host, A);
  await openEditor(host, B);
  await A.cmd('caret', { blockId: HUMAN_BLOCK });
  await host.request('agents.start', { docId: DOC, agents: AGENTS() });
  await A.cmd('measure.start');
  const t0 = now();
  // A types for 12 s; the host is killed at 5 s and re-forked 1 s later; all ports reopened by main at once
  const typing = (async () => {
    const letters = 'restart under load ';
    let i = 0;
    while (now() - t0 < 12000) {
      await A.key(letters[i++ % letters.length]);
      await sleep(60 + Math.random() * 60);
    }
  })();
  await sleep(5000);
  const ackedAgentsBeforeKill = host.events.filter((e) => e.t === 'agent-acked').map((e) => ({ ...e }));
  const pid = host.child.pid!;
  markLoad('kill');
  const tKill = now();
  process.kill(pid, 'SIGKILL');
  await host.exit;
  const tExit = now();
  await sleep(1000);
  const tFork = now();
  host = new Host();
  await host.started;
  const tStarted = now();
  await host.request('loop.reset');
  const durableAtKill = await host.request('reload', { docId: DOC });
  const tReloaded = now();
  // reopen: the renderers keep their editors; main hands each a new port; the agents come back as new replicas
  const reopen = async (r: Replica) => {
    const s = r.nextSynced();
    const reply = await host.open(r, DOC);
    await s;
    return { at: now(), loadMs: reply.loadMs };
  };
  const [rA, rB, agentsBack] = await Promise.all([
    reopen(A),
    reopen(B),
    (async () => {
      await host.request('agents.start', { docId: DOC, agents: AGENTS() });
      return now();
    })(),
  ]);
  const tAllLive = Math.max(rA.at, rB.at, agentsBack);
  const hostLoopAfterRestart = await host.request('loop.read');
  await typing;
  const keysReport = await A.cmd('measure.stop', { ackWaitMs: 20000 });
  const agentsAfter = await host.request('agents.stop', { docId: DOC });
  await sleep(800);
  const [dA, dB, live, reload] = await Promise.all([A.cmd('digest'), B.cmd('digest'), host.request('live', { docId: DOC }), host.request('reload', { docId: DOC })]);
  const svAtKill = new Map<number, number>(durableAtKill.sv);
  const svFinal = new Map<number, number>(reload.sv);
  const clientA = dA.clientId;
  // A's keystrokes: acked before the kill must be durable at the kill; all must be in the store at the end
  const keys = keysReport.clocks as { t: number; clock: number | null; ack: number | null }[];
  const ackedBeforeKill = keys.filter((k) => k.ack !== null && k.ack < tKill);
  const agentAcked = ackedAgentsBeforeKill.map((e) => ({ sessionId: e.sessionId, clientId: e.clientId as number, clock: e.clock as number, at: e.at as number }));
  write('kill', {
    hostLoopDelayAfterRestartMs: hostLoopAfterRestart,
    timeline: { killAtMs: Math.round(tKill - t0), exitSeenMs: Math.round(tExit - tKill), forkToStartedMs: Math.round(tStarted - tFork), storeReloadMs: Math.round(durableAtKill.ms), reopenAtMs: Math.round(tReloaded - t0), killToAllLiveMs: Math.round(tAllLive - tKill), forkToAllLiveMs: Math.round(tAllLive - tFork), A: rA, B: rB },
    A: {
      clientId: clientA,
      keystrokes: keys.length,
      typedBeforeKill: keys.filter((k) => k.t < tKill).length,
      ackedBeforeKill: ackedBeforeKill.length,
      ackedBeforeKillLost: ackedBeforeKill.filter((k) => k.clock === null || k.clock > (svAtKill.get(clientA) ?? 0)).length,
      typedWhileDown: keys.filter((k) => k.t >= tKill && k.t < tAllLive).length,
      durableAtKill: keys.filter((k) => k.t < tKill && k.clock !== null && k.clock <= (svAtKill.get(clientA) ?? 0)).length,
      inStoreAtEnd: keys.filter((k) => k.clock !== null && k.clock <= (svFinal.get(clientA) ?? 0)).length,
      lostAtEnd: keys.filter((k) => k.clock !== null && k.clock > (svFinal.get(clientA) ?? 0)).length,
      ackMs: keysReport.inputToAckMs,
      frameMs: keysReport.inputToFrameMs,
      unsavedAtEnd: dA.state.unsaved,
    },
    agents: {
      ackedBatchesBeforeKill: agentAcked.length,
      ackedBeforeKillLost: agentAcked.filter((a) => a.clock > (svAtKill.get(a.clientId) ?? 0)).length,
      after: agentsAfter,
    },
    converged: { AeqHost: dA.digest === live.digest, BeqHost: dB.digest === live.digest, storeEqHost: reload.digest === live.digest },
    rejected: (await host.request('stats', { docId: DOC })).service,
    pageErrors: [...dA.errors, ...dB.errors],
  });
  host.child.kill();
}

async function scenarioDeck() {
  let host = new Host();
  await host.started;
  const DECK_ID = 'deck100';
  const imported = await host.request('deck.import', { docId: DECK_ID, file: DECK });
  // trial 0 is cold (a fresh host loads the deck from SQLite), trials 1 and 2 warm
  host.child.kill();
  await host.exit;
  host = new Host();
  await host.started;
  const replicas: Replica[] = [];
  const trials: unknown[] = [];
  for (let trial = 0; trial < 3; trial++) {
    const D = new Replica(`deck${trial}`, 'deck');
    replicas.push(D);
    await D.ready;
    const l = markLoad(`deck open ${trial}`);
    const synced = D.nextSynced();
    const reply = await host.open(D, DECK_ID);
    await synced;
    const mounted = await D.cmd('mount');
    if (mounted?.error) throw new Error(mounted.error);
    trials.push({ trial, cold: trial === 0, load: l, hostLoadMs: reply.loadMs, ...mounted });
    if (trial < 2) D.win.destroy();
  }
  const D = replicas[2];
  // a drag of an element on the current slide while an agent republishes slides, driven through CDP mouse events
  await host.request('deck.agent.start', { docId: DECK_ID, file: DECK, intervalMs: 700 });
  const target = await D.cmd('dragTarget');
  if (target?.error) throw new Error(target.error);
  await host.request('loop.reset');
  await D.cmd('measure.start');
  const l = markLoad('deck drag');
  await D.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 200; i++) {
    await D.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x + i, y: target.y + (i % 40), button: 'left', buttons: 1 });
    await sleep(16);
  }
  await D.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x + 200, y: target.y, button: 'left', clickCount: 1 });
  const drag = await D.cmd('measure.stop');
  drag.hostLoopDelayMs = await host.request('loop.read');
  const agent = await host.request('deck.agent.stop', { docId: DECK_ID });
  const memory = { renderer: await D.cmd('memory'), metrics: metrics(host, [D]), host: (await host.request('stats', { docId: DECK_ID, gc: true })).mem };
  const [dD, live] = await Promise.all([D.cmd('digest'), host.request('live', { docId: DECK_ID })]);
  write('deck', { imported, trials, drag: { load: l, ...drag }, agent, memory, converged: dD.digest === live.digest, pageErrors: dD.errors });
  host.child.kill();
}

// ---- entry ---------------------------------------------------------------------------------------------------------
app.dock?.hide();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const run = { probe: scenarioProbe, typing: scenarioTyping, firstsync: scenarioFirstSync, history: scenarioHistory, memory: scenarioMemory, ime: scenarioIme, kill: scenarioKill, deck: scenarioDeck }[scenario];
  if (!run) throw new Error(`unknown scenario ${scenario}`);
  markLoad('start');
  const watchdog = setTimeout(() => {
    console.error('watchdog: scenario took too long');
    app.exit(2);
  }, 900_000);
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
