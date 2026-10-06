// E10 M4 Task 4.2, the live reconnect probe (docs/doperpowers/plans/2026-10-06-e10-supervisor.md, M4; §Design 1, 2, 3;
// Acceptance G2's live variant and G3's resume from disk). A Node client speaking the socket layer
// (src/shared/host/socket-protocol.ts: hello, welcome/refuse, then C1's req/res/evt envelope and the client's ready line)
// to a supervisor this script starts itself: the engine-host chunk of `pnpm build` (out/main/index-<hash>.js, the file
// holding the entry's MAWS_USER_DATA refusal) under W/node_modules/electron's binary with ELECTRON_RUN_AS_NODE=1,
// `--detached <scratch userData>/supervisor`, spawned as main's detached transport spawns it (detached, stdio on
// host.log, argv0 maws-supervisor). The hello's token is read from host.token, the build id from host.lock (and checked
// against the SHA-1 of the chunk's bytes, as main computes it), and the wire fingerprint from the supervisor itself: a
// first hello with a placeholder wire is refused `wire`, and the refuse carries the supervisor's (§Design 2).
//
// The session is live: the installed engine (~/.local/bin/claude, which the host resolves itself), a scratch
// CLAUDE_CONFIG_DIR seeded as spikes/protocol-probe/scenarios/pass3/p1-common.mjs seeds it (scratchRun), the gateway
// through ClaudeUsage's relay (GET /api/hello must answer 200 first), Haiku, `maxBudgetUsd` as the spending cap, a
// scratch shell home (ZDOTDIR) for the host's login-shell capture, and the A-15 owner-file delta before and after.
//
//   --run reconnect (Q6): a turn of two Bash sleeps (6 s, then 10 s; about 25 s in all, so the second model call lands
//   while no client is connected). The first connection sends `ready` at once, launches, sends the prompt, and closes
//   (as main's SocketPort.close does: end, then read until the close) once 5 s have passed and the first sleep runs;
//   5 s later a second connection sends `ready` at once. The burst is every line between that ready and the
//   host.supervisorStatus that ends it (supervision.ts registers last); live lines follow. Asserted against the launch's
//   own `session.events {afterSeq: null}` at the end: the first connection's events, the burst's and the live ones
//   concatenate to exactly that list (no duplicate, no gap), the burst is not empty, and it begins at the event right
//   after the last one the first connection received.
//   --run crash (Q7): a turn whose Bash call sleeps 20 s; once the sleep runs, `kill -9` of the supervisor; a fresh
//   supervisor started over the same directory (it breaks the stale lock and sweeps the orphan from live.json; its
//   host.supervisorStatus.orphansKilled is recorded once the sweep has ended); then `session.launch` with `resume` of
//   the same engine session id and the same app session id, and a prompt that only the transcript on disk can answer
//   (the command the interrupted turn ran).
//
// Every supervisor, engine and tool process this script starts is stopped (host.stopAll first, SIGKILL for whatever
// survives), the scratch root is removed, and a final `ps` check is recorded. Evidence: results/q6-reconnect.json,
// results/q7-crash-resume.json.
//   /tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh node spikes/supervisor-probe/reconnect-streaming.mjs --run reconnect|crash
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const W = join(HERE, '..', '..');
const ELECTRON = join(W, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const SOCKET_PROTOCOL = 1; // src/shared/host/socket-protocol.ts
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

// ---------------------------------------------------------------------------------------------------------------------
// Processes

function psRows() {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,stat=,command='], { encoding: 'utf8' }).trim().split('\n').map((l) => {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    return m && { pid: +m[1], ppid: +m[2], pgid: +m[3], stat: m[4], command: m[5] };
  }).filter(Boolean);
}
function descendants(rows, root) {
  const out = [];
  const walk = (pid) => { for (const r of rows) if (r.ppid === pid) { out.push(r); walk(r.pid); } };
  walk(root);
  return out;
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const row = (pid) => { const r = psRows().find((x) => x.pid === pid); return r ? { pid: r.pid, ppid: r.ppid, pgid: r.pgid, stat: r.stat, command: r.command.slice(0, 120) } : null; };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const ownerKeysPython = () => execFileSync('python3', ['-c', "import json,os;d=json.load(open(os.path.expanduser('~/.claude.json')));print(json.dumps(sorted(k for k in d.get('projects',{}) if k.startswith('/tmp') or k.startswith('/private/tmp'))))"], { encoding: 'utf8' }).trim();

// The engine-host chunk of the current build: the out/main file that holds the entry's own refusal string.
function engineHostChunk() {
  const dir = join(W, 'out/main');
  const hits = readdirSync(dir).filter((f) => f.endsWith('.js') && readFileSync(join(dir, f), 'utf8').includes('the engine host needs MAWS_USER_DATA'));
  if (hits.length !== 1) throw new Error(`expected one engine-host chunk under out/main, found ${JSON.stringify(hits)}; run pnpm build`);
  return join(dir, hits[0]);
}
const buildIdOf = (file) => createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 16); // supervisor-files.ts

// Haiku 4.5 list prices per token (input, output, 5-minute cache write, cache read), as q1 estimates
const PRICE = { input: 1e-6, output: 5e-6, cacheWrite: 1.25e-6, cacheRead: 0.1e-6 };
function costOf(records) {
  const seen = new Set();
  const usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: 0 };
  for (const r of records) {
    const m = r.message;
    if (r.type !== 'assistant' || !m?.usage || seen.has(m.id)) continue; // one message spans several records
    seen.add(m.id);
    const u = m.usage;
    usage.messages++;
    usage.input += u.input_tokens ?? 0; usage.output += u.output_tokens ?? 0;
    usage.cacheWrite += u.cache_creation_input_tokens ?? 0; usage.cacheRead += u.cache_read_input_tokens ?? 0;
  }
  const usd = usage.input * PRICE.input + usage.output * PRICE.output + usage.cacheWrite * PRICE.cacheWrite + usage.cacheRead * PRICE.cacheRead;
  return { usage, estimatedUsd: Math.round(usd * 1e5) / 1e5 };
}

// ---------------------------------------------------------------------------------------------------------------------
// The supervisor, as main's detached transport spawns it (src/main/hosts/detached-transport.ts)

function startSupervisor(ctx, label) {
  const chunk = engineHostChunk();
  const logFd = openSync(join(ctx.supDir, 'host.log'), 'a', 0o600);
  const child = spawn(ELECTRON, [chunk, '--detached', ctx.supDir], { detached: true, stdio: ['ignore', logFd, logFd], env: ctx.env, cwd: W, argv0: 'maws-supervisor' });
  closeSync(logFd);
  ctx.started.add(child.pid);
  const sup = { label, pid: child.pid, chunk, chunkBuildId: buildIdOf(chunk), spawnedAt: now(), exit: null };
  sup.exited = new Promise((resolve) => child.on('exit', (code, signal) => { sup.exit = { code, signal, ms: now() - ctx.t0 }; resolve(sup.exit); }));
  ctx.supervisors.push(sup);
  return sup;
}

// Until the supervisor's own lock names it and its socket accepts a connection (bounded).
async function supervisorServing(ctx, sup, timeoutMs = 20_000) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (sup.exit) throw new Error(`supervisor ${sup.label} exited before serving: ${JSON.stringify(sup.exit)}`);
    const lock = readJson(join(ctx.supDir, 'host.lock'));
    if (lock?.pid === sup.pid && existsSync(lock.socketPath)) {
      const ok = await new Promise((resolve) => { const s = connect(lock.socketPath); s.once('connect', () => { s.destroy(); resolve(true); }); s.once('error', () => resolve(false)); });
      if (ok) { sup.lock = lock; sup.servingMs = now() - ctx.t0; return lock; }
    }
    await delay(100);
  }
  throw new Error(`supervisor ${sup.label} (pid ${sup.pid}) did not serve within ${timeoutMs} ms`);
}

// ---------------------------------------------------------------------------------------------------------------------
// The client: the socket layer's handshake, then C1's envelope

class Client {
  constructor(ctx, name) {
    this.ctx = ctx;
    this.name = name;
    this.lines = []; // every line after the handshake, with its arrival time and phase
    this.pending = new Map();
    this.waiters = [];
    this.phase = 'before-ready';
    this.closedAt = null;
    this.endSentAt = null;
  }

  // Resolves with the server's first line (welcome or refuse); `wire` null sends the placeholder.
  open(socketPath, hello) {
    return new Promise((resolve, reject) => {
      const socket = connect(socketPath);
      this.socket = socket;
      let buffer = Buffer.alloc(0);
      let first = null;
      socket.on('error', (e) => { if (!first) reject(e); else this.ctx.note(`${this.name} socket error: ${e.message}`); });
      socket.on('close', () => { this.closedAt = now(); this.closeResolve?.(); for (const p of this.pending.values()) p.reject(new Error(`${this.name} closed`)); this.pending.clear(); });
      socket.on('connect', () => socket.write(JSON.stringify({ t: 'hello', protocol: SOCKET_PROTOCOL, appPid: process.pid, ...hello }) + '\n'));
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        let i;
        while ((i = buffer.indexOf(0x0a)) >= 0) {
          const line = buffer.subarray(0, i).toString('utf8');
          buffer = buffer.subarray(i + 1);
          if (!line) continue;
          const data = JSON.parse(line);
          if (!first) { first = data; resolve(data); continue; }
          this.receive(data);
        }
      });
    });
  }

  receive(data) {
    const at = now();
    if (data.t === 'res') {
      const p = this.pending.get(data.id);
      if (p) { this.pending.delete(data.id); data.ok ? p.resolve(data.value) : p.reject(Object.assign(new Error(`${p.name}: ${data.error?.code} ${data.error?.message}`), { ipc: data.error })); }
      return;
    }
    if (data.t !== 'evt') return this.ctx.note(`${this.name} unexpected line ${JSON.stringify(data).slice(0, 200)}`);
    // the burst ends with the host.supervisorStatus the onConnect hooks publish last (supervision.ts registers after the engine ipc)
    const phase = this.phase;
    const entry = { at, ms: at - this.ctx.t0, name: data.name, payload: data.payload, phase, afterEnd: this.endSentAt !== null };
    this.lines.push(entry);
    if (phase === 'burst' && data.name === 'host.supervisorStatus') this.phase = 'live';
    for (const w of [...this.waiters]) if (w.test(entry)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(entry); }
  }

  request(name, input) {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, name });
      this.socket.write(JSON.stringify({ t: 'req', id, name, input }) + '\n');
    });
  }

  ready() {
    this.phase = 'burst';
    this.readyAt = now();
    this.socket.write(JSON.stringify({ t: 'ready' }) + '\n');
  }

  // A matching event already received after `since`, or the next one (bounded).
  waitFor(test, timeoutMs, label, since = 0) {
    const hit = this.lines.find((e) => e.at >= since && test(e));
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const w = { test, resolve: (e) => { clearTimeout(timer); resolve(e); } };
      const timer = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(w), 1); reject(new Error(`${this.name}: timed out after ${timeoutMs} ms waiting for ${label}`)); }, timeoutMs);
      this.waiters.push(w);
    });
  }

  // As main's SocketPort.close: end, then the peer finishes the close; every byte that arrives until then is read.
  close() {
    if (this.closedAt) return Promise.resolve();
    this.endSentAt = now();
    const closed = new Promise((resolve) => { this.closeResolve = resolve; });
    this.socket.end();
    const timer = setTimeout(() => this.socket.destroy(), 1_000);
    return closed.then(() => clearTimeout(timer));
  }

  batches(appSessionId, phase) {
    return this.lines.filter((e) => e.name === 'session.eventBatch' && e.payload.appSessionId === appSessionId && (phase === undefined || e.phase === phase));
  }
  ids(appSessionId, phase) {
    return this.batches(appSessionId, phase).flatMap((e) => e.payload.events.map((ev) => ev.id));
  }
}

async function handshake(ctx, sup, name) {
  const lock = readJson(join(ctx.supDir, 'host.lock'));
  const token = readFileSync(join(ctx.supDir, 'host.token'), 'utf8').trim();
  if (!ctx.wire) {
    // the supervisor's wire fingerprint, from its refuse of a placeholder (the connection is then dropped, no exit sent)
    const probe = new Client(ctx, `${name}-wire`);
    const answer = await probe.open(lock.socketPath, { token, buildId: lock.buildId, wire: 'probe-placeholder' });
    probe.socket.destroy();
    if (answer.t !== 'refuse' || answer.reason !== 'wire') throw new Error('the wire discovery was not refused wire: ' + JSON.stringify(answer));
    ctx.wire = answer.wire;
    ctx.note(`wire ${answer.wire} read from the supervisor's refuse`);
  }
  const client = new Client(ctx, name);
  const welcome = await client.open(lock.socketPath, { token, buildId: lock.buildId, wire: ctx.wire });
  if (welcome.t !== 'welcome') throw new Error(`${name}: not welcomed: ${JSON.stringify(welcome)}`);
  client.welcome = welcome;
  client.connectedMs = now() - ctx.t0;
  if (welcome.pid !== sup.pid) throw new Error(`${name}: welcomed by pid ${welcome.pid}, expected ${sup.pid}`);
  return client;
}

// ---------------------------------------------------------------------------------------------------------------------
// The session

function launchSpec(ctx, appSessionId, resume) {
  return {
    appSessionId, cwd: ctx.run.cwd, additionalDirectories: [], model: 'haiku', effort: null, permissionMode: 'default', gateway: 'gateway',
    subagentModel: null, resume, sessionId: null, trust: { accepted: true, directory: ctx.run.cwd }, mcpConfig: null, extraSettings: null,
    maxBudgetUsd: 0.15, replay: null, inheritGrantsFrom: null,
  };
}

const statusOf = (client, appSessionId) => client.lines.filter((e) => e.name === 'session.status' && e.payload.appSessionId === appSessionId).at(-1)?.payload.status ?? null;

async function launchReady(ctx, client, spec) {
  const since = now();
  const result = await client.request('session.launch', { spec });
  if (result.status !== 'launching') throw new Error('session.launch did not launch: ' + JSON.stringify(result));
  const ready = await client.waitFor((e) => e.name === 'session.status' && e.payload.appSessionId === spec.appSessionId && e.payload.status.process === 'ready', 60_000, 'process ready', since);
  ctx.started.add(ready.payload.status.pid);
  return { result, status: ready.payload.status };
}

// A permission request (none expected: M0 found 2.1.291 asks nothing for sleep and echo) is allowed once, so the turn ends.
function allowPermissions(ctx, client, appSessionId) {
  const answered = new Set();
  const check = () => {
    for (const e of client.lines) {
      if (e.name !== 'session.brokerItems' || e.payload.appSessionId !== appSessionId) continue;
      for (const item of e.payload.items) {
        const id = item.request?.requestId;
        if (!id || answered.has(id) || item.state !== 'pending') continue;
        answered.add(id);
        if (item.kind !== 'permission') { ctx.note(`a pending ${item.kind} item ${id} the probe does not answer: ${item.summary}`); continue; }
        ctx.note(`allowing permission request ${id}: ${item.summary}`);
        client.request('session.answer', { appSessionId, requestId: id, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }).then((r) => ctx.note(`answer ${id}: ${JSON.stringify(r)}`), (err) => ctx.note(`answer ${id} failed: ${err.message}`));
      }
    }
  };
  const timer = setInterval(check, 250);
  return () => clearInterval(timer);
}

async function turnEnded(client, appSessionId, since, timeoutMs) {
  await client.waitFor((e) => e.name === 'session.eventBatch' && e.payload.appSessionId === appSessionId && e.payload.events.some((ev) => ev.kind === 'turn.ended'), timeoutMs, 'turn.ended', since);
  return client.waitFor((e) => e.name === 'session.status' && e.payload.appSessionId === appSessionId && e.payload.status.turn === null && e.payload.status.process === 'ready', 15_000, 'status idle', since);
}

// The tool's process under the engine whose command matches (bounded).
async function toolProcess(ctx, enginePid, pattern, timeoutMs) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const tree = descendants(psRows(), enginePid);
    for (const r of tree) ctx.started.add(r.pid);
    const hit = tree.find((r) => pattern.test(r.command));
    if (hit) return { pid: hit.pid, ppid: hit.ppid, pgid: hit.pgid, command: hit.command.slice(0, 120), ms: now() - ctx.t0 };
    await delay(150);
  }
  throw new Error(`no tool process matching ${pattern} under engine ${enginePid} within ${timeoutMs} ms`);
}

const eventSummary = (ev) => ({ id: ev.id.split(':').slice(-2).join(':'), kind: ev.kind, seq: ev.seq });

// ---------------------------------------------------------------------------------------------------------------------
// Q6: disconnect and reconnect mid-turn

async function runReconnect(ctx) {
  const r = ctx.result;
  const s1 = startSupervisor(ctx, 'S1');
  const lock = await supervisorServing(ctx, s1);
  r.supervisor = { pid: s1.pid, lock, chunk: s1.chunk.slice(W.length + 1), chunkBuildId: s1.chunkBuildId, buildIdMatchesLock: lock.buildId === s1.chunkBuildId, ps: row(s1.pid) };

  const c1 = await handshake(ctx, s1, 'C1');
  c1.ready(); // nothing to pull: no row exists yet
  r.c1 = { welcome: c1.welcome, binaryInfo: await c1.request('engine.binaryInfo', undefined) };
  const appSessionId = randomUUID();
  const launched = await launchReady(ctx, c1, launchSpec(ctx, appSessionId, null));
  const enginePid = launched.status.pid;
  const launchId = launched.status.launchId;
  r.launch = { appSessionId, launchId, enginePid, engineSessionId: launched.status.engineSessionId, readyMs: now() - ctx.t0 };
  const stopAllowing = allowPermissions(ctx, c1, appSessionId);

  const prompt = 'Use the Bash tool twice, one call after the other and never in parallel. First run exactly: sleep 6 && echo q6-one\nWhen it has finished, run exactly: sleep 10 && echo q6-two\nThen reply with the single word: finished';
  const sentAt = now();
  r.send = { ms: sentAt - ctx.t0, answer: await c1.request('session.send', { appSessionId, content: prompt }) };

  // disconnect once 5 s have passed and the first sleep runs (the turn is mid-flight)
  const firstSleep = await toolProcess(ctx, enginePid, /(^|\/)sleep 6\b/, 60_000);
  const disconnectAt = Math.max(sentAt + 5_000, now());
  await delay(disconnectAt - now());
  const statusAtDisconnect = statusOf(c1, appSessionId);
  stopAllowing();
  await c1.close();
  r.disconnect = { ms: c1.endSentAt - ctx.t0, sinceSendMs: c1.endSentAt - sentAt, closedMs: c1.closedAt - ctx.t0, firstSleep, turnOpen: statusAtDisconnect?.turn !== null, eventsAfterEnd: c1.ids(appSessionId).length - c1.batches(appSessionId).filter((e) => !e.afterEnd).flatMap((e) => e.payload.events).length };

  // reconnect 5 s later, ready at once
  await delay(c1.endSentAt + 5_000 - now());
  const engineDuringAbsence = row(enginePid);
  const c2 = await handshake(ctx, s1, 'C2');
  c2.ready();
  const stopAllowing2 = allowPermissions(ctx, c2, appSessionId);
  await c2.waitFor((e) => e.phase === 'burst' && e.name === 'host.supervisorStatus', 5_000, 'the end of the burst');
  r.reconnect = { ms: c2.readyAt - ctx.t0, sinceSendMs: c2.readyAt - sentAt, absenceMs: c2.readyAt - c1.endSentAt, welcome: c2.welcome, engineDuringAbsence, burstLines: c2.lines.filter((e) => e.phase === 'burst').map((e) => e.name) };

  const ended = await turnEnded(c2, appSessionId, 0, 120_000);
  r.turnEndedMs = ended.ms;
  stopAllowing2();
  await delay(1_000); // let the last batch timers (16 ms) and status flushes settle
  const snapshot = await c2.request('session.events', { appSessionId, afterSeq: null, limit: null });
  await delay(300);

  // the assertions
  const A = c1.ids(appSessionId);
  const B = c2.ids(appSessionId, 'burst');
  const C = c2.ids(appSessionId, 'live');
  const F = snapshot.events.map((e) => e.id);
  const joined = [...A, ...B, ...C];
  const dup = joined.filter((id, i) => joined.indexOf(id) !== i);
  const firstMismatch = (() => { for (let i = 0; i < Math.max(F.length, joined.length); i++) if (F[i] !== joined[i]) return { index: i, expected: F[i] ?? null, got: joined[i] ?? null }; return null; })();
  const byId = new Map(snapshot.events.map((e) => [e.id, e]));
  const at = (id) => (id && byId.has(id) ? eventSummary(byId.get(id)) : id ?? null);
  const otherLaunch = joined.filter((id) => !id.startsWith(`${appSessionId}:${launchId}:`));
  const burstBatches = c2.batches(appSessionId, 'burst');
  r.q6 = {
    counts: { firstConnection: A.length, burst: B.length, live: C.length, snapshot: F.length, snapshotComplete: snapshot.complete, snapshotLastSeq: snapshot.lastSeq },
    firstConnectionLast: at(A.at(-1)),
    burstFirst: at(B[0]),
    burstLast: at(B.at(-1)),
    liveFirst: at(C[0]),
    expectedBurstFirst: at(F[A.length]),
    burstBatchSizes: burstBatches.map((e) => e.payload.events.length),
    burstKinds: burstBatches.flatMap((e) => e.payload.events.map((ev) => ev.kind)),
    duplicates: dup,
    otherLaunchIds: otherLaunch,
    firstMismatch,
    checks: {
      burstNotEmpty: B.length > 0,
      burstBeginsRightAfterFirstConnection: B.length > 0 && B[0] === F[A.length],
      noDuplicate: dup.length === 0,
      concatenationEqualsSnapshot: firstMismatch === null,
      firstConnectionIsPrefix: A.every((id, i) => F[i] === id),
    },
  };
  r.q6.pass = Object.values(r.q6.checks).every(Boolean);
  r.timeline = snapshot.events.map((e) => ({ ...eventSummary(e) }));
  r.arrivals = [...c1.lines.map((e) => ({ conn: 'C1', ms: e.ms, name: e.name, phase: e.phase, afterEnd: e.afterEnd, events: e.name === 'session.eventBatch' ? e.payload.events.map((ev) => `${ev.id.split(':').slice(-2).join(':')} ${ev.kind}`) : undefined })),
    ...c2.lines.map((e) => ({ conn: 'C2', ms: e.ms, name: e.name, phase: e.phase, events: e.name === 'session.eventBatch' ? e.payload.events.map((ev) => `${ev.id.split(':').slice(-2).join(':')} ${ev.kind}`) : undefined }))];
  r.engineSessionId = launched.status.engineSessionId;
  ctx.transcripts.push(launched.status.engineSessionId);
  await stopEverything(ctx, c2, s1);
}

// ---------------------------------------------------------------------------------------------------------------------
// Q7: kill -9 of the supervisor mid-turn, a fresh one, and a resume from the disk transcript

async function runCrash(ctx) {
  const r = ctx.result;
  const s1 = startSupervisor(ctx, 'S1');
  const lock1 = await supervisorServing(ctx, s1);
  r.supervisor1 = { pid: s1.pid, lock: lock1, chunkBuildId: s1.chunkBuildId, ps: row(s1.pid) };
  const c1 = await handshake(ctx, s1, 'C1');
  c1.ready();
  const appSessionId = randomUUID();
  const launched = await launchReady(ctx, c1, launchSpec(ctx, appSessionId, null));
  const enginePid = launched.status.pid;
  const engineSessionId = launched.status.engineSessionId;
  ctx.transcripts.push(engineSessionId);
  r.launch1 = { appSessionId, launchId: launched.status.launchId, enginePid, engineSessionId };
  const stopAllowing = allowPermissions(ctx, c1, appSessionId);
  const sentAt = now();
  r.send1 = { ms: sentAt - ctx.t0, answer: await c1.request('session.send', { appSessionId, content: 'Run exactly this shell command with the Bash tool, nothing else: sleep 20 && echo q7-done\nThen reply with the single word: finished' }) };
  const sleeper = await toolProcess(ctx, enginePid, /(^|\/)sleep 20\b/, 60_000);
  await delay(1_000); // the tool has run a second; the turn is mid-flight
  stopAllowing();
  const tp = join(ctx.run.home, 'projects', ctx.slug(ctx.run.cwd), `${engineSessionId}.jsonl`);
  r.beforeKill = {
    sinceSendMs: now() - sentAt, engine: row(enginePid), sleeper, liveLedger: readJson(join(ctx.supDir, 'live.json')),
    status: (({ process, turn, launchId, keepAlive }) => ({ process, turnOpen: turn !== null, launchId, keepAlive }))(statusOf(c1, appSessionId)),
    transcriptLines: existsSync(tp) ? readFileSync(tp, 'utf8').split('\n').filter(Boolean).length : null,
    registryRow: readJson(join(ctx.run.home, 'sessions', `${enginePid}.json`)) !== null,
  };

  // kill -9 of the supervisor
  const killAt = now();
  process.kill(s1.pid, 'SIGKILL');
  await s1.exited;
  r.kill = { ms: killAt - ctx.t0, supervisorExit: s1.exit, client1ClosedMs: c1.closedAt ? c1.closedAt - killAt : null };
  await delay(500);
  r.afterKill = {
    engine: row(enginePid), sleeper: row(sleeper.pid), staleLock: readJson(join(ctx.supDir, 'host.lock')), socketFileLeft: existsSync(lock1.socketPath),
    liveLedger: readJson(join(ctx.supDir, 'live.json')), registryRow: readJson(join(ctx.run.home, 'sessions', `${enginePid}.json`)) !== null,
  };

  // a fresh supervisor over the same directory
  const s2 = startSupervisor(ctx, 'S2');
  const lock2 = await supervisorServing(ctx, s2);
  r.supervisor2 = { pid: s2.pid, lock: lock2, chunkBuildId: s2.chunkBuildId, startedSinceKillMs: s2.servingMs - (killAt - ctx.t0), ps: row(s2.pid) };
  const c2 = await handshake(ctx, s2, 'C2');
  c2.ready();
  await c2.waitFor((e) => e.phase === 'burst' && e.name === 'host.supervisorStatus', 5_000, 'the end of the burst');
  // the sweep ends in the background (SIGTERM, up to 5 s, SIGKILL); its count arrives as a status change
  let status = await c2.request('host.supervisorStatus', undefined);
  if (status.orphansKilled === 0) {
    const swept = await c2.waitFor((e) => e.name === 'host.supervisorStatus' && e.payload.orphansKilled > 0, 15_000, 'orphansKilled').catch((e) => (ctx.note(e.message), null));
    status = swept ? swept.payload : await c2.request('host.supervisorStatus', undefined);
  }
  await delay(300);
  r.afterSweep = {
    orphansKilled: status.orphansKilled, supervisorStatus: status, engine: row(enginePid), engineAlive: alive(enginePid), sleeper: row(sleeper.pid),
    registryRow: readJson(join(ctx.run.home, 'sessions', `${enginePid}.json`)) !== null, liveLedger: readJson(join(ctx.supDir, 'live.json')),
    hostLogSweepLines: readFileSync(join(ctx.supDir, 'host.log'), 'utf8').split('\n').filter((l) => /orphan|sweep|stale|lock/i.test(l)).map((l) => l.split(ctx.run.root).join('<scratch>').slice(0, 240)),
  };
  r.afterSweep.engineSessions = (await c2.request('engine.sessions', undefined)).map((s) => s.appSessionId);
  const disk = await c2.request('session.events', { appSessionId, afterSeq: null, limit: null }).catch((e) => ({ error: e.message }));
  r.afterSweep.diskEvents = disk.error ? disk : { count: disk.events.length, lastSeq: disk.lastSeq, complete: disk.complete, seqsAllNull: disk.events.every((e) => e.seq === null), kinds: [...new Set(disk.events.map((e) => e.kind))] };
  const queue = await c2.request('session.queue.list', { appSessionId }).catch((e) => ({ error: e.message }));
  r.afterSweep.savedQueue = queue;

  // the resume of the same engine session, from the transcript on disk
  const transcriptBefore = existsSync(tp) ? readFileSync(tp, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  r.transcriptAtResume = { lines: transcriptBefore.length, tail: transcriptBefore.slice(-4).map((x) => ({ type: x.type, subtype: x.subtype ?? null, content: JSON.stringify(x.message?.content ?? x.content ?? null).slice(0, 160) })) };
  const stopAllowing2 = allowPermissions(ctx, c2, appSessionId);
  const resumed = await launchReady(ctx, c2, launchSpec(ctx, appSessionId, { sessionId: engineSessionId, fork: false }));
  r.resume = { result: resumed.result.status, launchId: resumed.status.launchId, enginePid: resumed.status.pid, engineSessionId: resumed.status.engineSessionId, sameEngineSession: resumed.status.engineSessionId === engineSessionId, readyMs: now() - ctx.t0 };
  const since = now();
  r.send2 = await c2.request('session.send', { appSessionId, content: 'Earlier in this conversation you ran one shell command with the Bash tool. Reply with exactly that command and nothing else.' });
  await turnEnded(c2, appSessionId, since, 90_000);
  stopAllowing2();
  await delay(500);
  const after = readFileSync(tp, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const lastText = after.filter((x) => x.type === 'assistant').flatMap((x) => (x.message?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text)).at(-1) ?? null;
  r.resume.reply = lastText;
  r.resume.transcriptLinesAfter = after.length;
  const resumedSnapshot = await c2.request('session.events', { appSessionId, afterSeq: null, limit: null });
  r.resume.eventsThisLaunch = { count: resumedSnapshot.events.length, kinds: [...new Set(resumedSnapshot.events.map((e) => e.kind))] };
  r.q7 = {
    checks: {
      supervisorKilledMidTurn: r.beforeKill.status.turnOpen && s1.exit?.signal === 'SIGKILL',
      freshSupervisorStarted: s2.pid !== s1.pid && lock2.pid === s2.pid,
      orphanSwept: status.orphansKilled >= 1 && !alive(enginePid),
      resumeLaunched: resumed.result.status === 'launching' && resumed.status.process === 'ready',
      sameEngineSession: r.resume.sameEngineSession,
      replyFromDiskTranscript: typeof lastText === 'string' && /sleep 20/.test(lastText),
    },
  };
  r.q7.pass = Object.values(r.q7.checks).every(Boolean);
  await stopEverything(ctx, c2, s2);
}

// host.stopAll (the sessions and the supervisor), then whatever is left is killed.
async function stopEverything(ctx, client, sup) {
  const r = ctx.result;
  r.stop = r.stop ?? [];
  try {
    const answer = await client.request('host.stopAll', { graceMs: 3_000 });
    const exit = await Promise.race([sup.exited, delay(15_000).then(() => null)]);
    r.stop.push({ supervisor: sup.label, answer, exit, lockLeft: existsSync(join(ctx.supDir, 'host.lock')), socketLeft: existsSync(sup.lock.socketPath) });
  } catch (e) {
    r.stop.push({ supervisor: sup.label, error: e.message });
  }
}

// ---------------------------------------------------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const which = args.includes('--run') ? args[args.indexOf('--run') + 1] : null;
  if (!['reconnect', 'crash'].includes(which)) throw new Error('usage: reconnect-streaming.mjs --run reconnect|crash');
  const common = await import('../protocol-probe/scenarios/pass3/p1-common.mjs');
  const { assertScratch, slug } = await import('../protocol-probe/scenarios/pass3/c10-common.mjs');
  const { BIN, ENGINE_VERSION, scratchRun, removeRun, relayReady, ownerTmpKeys } = common;

  await relayReady();
  const ownerBefore = ownerTmpKeys();
  const ownerBeforePython = ownerKeysPython();
  const run = scratchRun(`e10-${which === 'reconnect' ? 'q6' : 'q7'}`);
  const userData = join(run.root, 'userData');
  const supDir = join(userData, 'supervisor');
  mkdirSync(supDir, { recursive: true, mode: 0o700 }); // main creates it before opening host.log for the spawn
  const shellHome = join(run.root, 'shell-home'); // the host's login-shell capture reads no owner zsh file (test/support/shell-home.ts)
  mkdirSync(shellHome);
  for (const name of ['.zprofile', '.bash_profile']) writeFileSync(join(shellHome, name), 'export SCRATCH_SHELL_PROFILE=' + name + '\n');
  // built from nothing: this shell's Claude session variables never reach the supervisor or its engines
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG'].includes(k) || k.startsWith('LC_')));
  const env = { ...base, SHELL: '/bin/zsh', ZDOTDIR: shellHome, HISTFILE: join(shellHome, '.sh_history'), CLAUDE_CONFIG_DIR: run.home, MAWS_USER_DATA: userData, ELECTRON_RUN_AS_NODE: '1' };
  assertScratch(env);

  const t0 = now();
  const result = { question: which === 'reconnect' ? 'Q6' : 'Q7', run: which, date: new Date().toISOString(), engine: { bin: BIN, version: ENGINE_VERSION }, model: 'haiku', electron: ELECTRON.slice(W.length + 1), notes: [] };
  const ctx = { run, userData, supDir, env, t0, result, started: new Set(), supervisors: [], transcripts: [], wire: null, slug, note: (line) => result.notes.push({ ms: now() - t0, line }) };
  const killAll = () => { for (const pid of ctx.started) if (pid && alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch {} };
  process.on('exit', killAll);
  let failure = null;
  try {
    if (which === 'reconnect') await runReconnect(ctx);
    else await runCrash(ctx);
  } catch (e) {
    failure = e;
    result.error = e.stack ?? e.message;
  } finally {
    // whatever outlived host.stopAll (or every process, after a failure): SIGTERM, 3 s, SIGKILL
    const rows = psRows();
    for (const sup of ctx.supervisors) for (const d of descendants(rows, sup.pid)) ctx.started.add(d.pid);
    const survivors = [...ctx.started].filter((pid) => pid && alive(pid));
    result.survivorsAfterStop = survivors.map(row).filter(Boolean);
    if (survivors.length) {
      for (const pid of survivors) try { process.kill(pid, 'SIGTERM'); } catch {}
      await delay(3_000);
      killAll();
      await delay(300);
    }
    result.wire = ctx.wire;
    result.supervisors = ctx.supervisors.map(({ label, pid, chunkBuildId, servingMs, exit }) => ({ label, pid, chunkBuildId, servingMs, exit }));
    result.hostLog = existsSync(join(supDir, 'host.log')) ? readFileSync(join(supDir, 'host.log'), 'utf8').split(run.root).join('<scratch>').split('\n').filter(Boolean).slice(-80).map((l) => l.slice(0, 260)) : null;
    // the cost, from the transcripts' usage (the conversation is one file per engine session)
    const recs = ctx.transcripts.flatMap((id) => { const p = join(run.home, 'projects', slug(run.cwd), `${id}.jsonl`); return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; });
    result.cost = costOf(recs);
    // A-15
    const ownerAfter = ownerTmpKeys();
    const ownerAfterPython = ownerKeysPython();
    result.ownerFileDelta = { before: ownerBefore.length, after: ownerAfter.length, added: ownerAfter.filter((k) => !ownerBefore.includes(k)), removed: ownerBefore.filter((k) => !ownerAfter.includes(k)), same: JSON.stringify(ownerBefore) === JSON.stringify(ownerAfter), pythonSame: ownerBeforePython === ownerAfterPython };
    // every process stopped; the scratch root removed; the final ps check
    const ids = ctx.transcripts.filter(Boolean);
    const leftovers = psRows().filter((r) => r.pid !== process.pid && (r.command.includes(run.root) || /maws-supervisor/.test(r.command) && r.command.includes(supDir) || ids.some((id) => r.command.includes(id))));
    result.cleanup = { started: [...ctx.started], stillAlive: [...ctx.started].filter((pid) => pid && alive(pid)), psMatches: leftovers.map((r) => ({ pid: r.pid, command: r.command.slice(0, 120) })) };
    removeRun(run);
    result.cleanup.scratchRemoved = !existsSync(run.root);
    result.elapsedMs = now() - t0;
    const name = which === 'reconnect' ? 'q6-reconnect' : 'q7-crash-resume';
    mkdirSync(join(HERE, 'results'), { recursive: true });
    writeFileSync(join(HERE, 'results', `${name}.json`), JSON.stringify(result, null, 1) + '\n');
    const verdict = which === 'reconnect' ? result.q6 && { pass: result.q6.pass, checks: result.q6.checks, counts: result.q6.counts } : result.q7 && { pass: result.q7.pass, checks: result.q7.checks, orphansKilled: result.afterSweep?.orphansKilled, reply: result.resume?.reply };
    console.log(JSON.stringify({ run: which, error: failure?.message ?? null, verdict, cost: result.cost, owner: result.ownerFileDelta.same, cleanup: result.cleanup }, null, 1));
  }
  if (failure) process.exitCode = 1;
}

await main();
