// E10 M0 Q1 (docs/doperpowers/plans/2026-10-06-e10-supervisor.md, M0, §Design 1 "The orphan ledger and sweep"): what
// the installed engine does when the process that holds its pipes dies mid-turn. Q5 reads the same run.
//
// A wrapper Node process (this file, role `--wrapper`) stands in for the engine host: it spawns the installed engine as
// src/engine-host/transport.ts does (`detached: true`, stdio piped both ways) with MAWS's launch line
// (src/engine-host/launch.ts ENGINE_FLAGS, `--settings {"dialogExpiry":"never"}`, buildEnvironment's constants, the
// relay), on Haiku with the probe guards `--max-budget-usd 0.30` and `--debug-file`, under a scratch CLAUDE_CONFIG_DIR
// seeded as pass3/p1-common.mjs seeds it; it sends MAWS's initialize, then a turn whose Bash call sleeps 20 s, allowing
// the tool if asked (2.1.291 runs `sleep` and `echo` without asking). While `sleep 20` runs, the outer process snapshots the engine's registry row
// (`<config>/sessions/<pid>.json`) and its PPID, SIGKILLs the wrapper, and samples every 100 ms for up to
// `--watch-ms` (default 90 s): is the engine alive, who is its parent, is its registry row still there, is the tool's
// `sleep` still running. A survivor past the window is recorded as lingering, then killed (SIGTERM, 5 s, SIGKILL, every
// descendant). The transcript's tail and the debug log's shutdown lines are recorded; the cost is estimated from the
// transcript's usage at Haiku 4.5 list prices. Relay gate first; the A-15 owner-file delta before and after.
//
// The default variant `parent-killed` is the real case; the engine's exit status then goes to launchd and cannot be
// read. `--variant idle-pipes-closed` reads it without a model call: no prompt is sent, and after the initialize the
// wrapper stays alive and closes the engine's stdin and its read end of stdout (the pipe events a dead host causes,
// the parent alive), so the wrapper sees the code of the engine's end-of-input exit, the path the parent-killed run
// takes once its turn ends.
//   node spikes/supervisor-probe/q1-engine-parent-death.mjs [--variant parent-killed|idle-pipes-closed] [--watch-ms N]
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

// ---------------------------------------------------------------------------------------------------------------------
// The wrapper: the engine host's stand-in

async function wrapper(configPath) {
  const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
  const tell = (ev) => process.stdout.write(JSON.stringify({ at: now(), ...ev }) + '\n');
  const child = spawn(cfg.bin, cfg.args, { cwd: cfg.cwd, env: cfg.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] }); // transport.ts
  tell({ ev: 'spawned', engine: child.pid, wrapper: process.pid });
  child.stdin.on('error', (e) => tell({ ev: 'stdin_error', message: e.message }));
  child.stderr.on('data', (b) => appendFileSync(cfg.stderrPath, b));
  child.on('exit', (code, signal) => tell({ ev: 'engine_exit', code, signal }));
  const send = (frame) => child.stdin.write(JSON.stringify(frame) + '\n');
  const pending = new Map();
  const request = (subtype, payload) => new Promise((resolve) => { const id = randomUUID(); pending.set(id, resolve); send({ type: 'control_request', request_id: id, request: { subtype, ...payload } }); });
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (s) => {
    buffer += s;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      appendFileSync(cfg.framesPath, JSON.stringify({ at: now(), line }) + '\n');
      let f;
      try { f = JSON.parse(line); } catch { continue; }
      if (f.type === 'control_response') pending.get(f.response.request_id)?.(f.response);
      else if (f.type === 'control_request') {
        const r = f.request;
        let response;
        if (r.subtype === 'can_use_tool') { response = { behavior: 'allow', updatedInput: r.input }; tell({ ev: 'allowed', tool: r.tool_name, input: r.input }); }
        else if (r.subtype === 'request_user_dialog') response = { behavior: 'completed', result: 'continue' };
        else if (r.subtype === 'elicitation') response = { action: 'decline' };
        if (response) send({ type: 'control_response', response: { subtype: 'success', request_id: f.request_id, response } });
        else { send({ type: 'control_response', response: { subtype: 'error', request_id: f.request_id, error: 'probe: unhandled' } }); tell({ ev: 'unhandled_control', subtype: r.subtype }); }
      } else if (f.type !== 'stream_event') tell({ ev: 'frame', type: f.type, subtype: f.subtype ?? null });
    }
  });
  const init = await request('initialize', cfg.init);
  tell({ ev: 'initialized', subtype: init.subtype });
  if (cfg.prompt !== null) {
    send({ type: 'user', uuid: randomUUID(), message: { role: 'user', content: cfg.prompt }, parent_tool_use_id: null, origin: { kind: 'human' } });
    tell({ ev: 'prompt_sent' });
  }
  process.on('SIGUSR2', () => { // the idle-pipes-closed variant: both ends this side holds go away, the parent stays
    child.stdin.destroy();
    child.stdout.destroy();
    tell({ ev: 'pipes_closed' });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The outer run

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
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const pickRegistry = (r) => r && { pid: r.pid, sessionId: r.sessionId, entrypoint: r.entrypoint, kind: r.kind, cwdIsScratch: typeof r.cwd === 'string' && /^\/(private\/)?tmp\/maws-e0a-e10-q1-/.test(r.cwd), keys: Object.keys(r).sort() };
const ownerKeysPython = () => execFileSync('python3', ['-c', "import json,os;d=json.load(open(os.path.expanduser('~/.claude.json')));print(json.dumps(sorted(k for k in d.get('projects',{}) if k.startswith('/tmp') or k.startswith('/private/tmp'))))"], { encoding: 'utf8' }).trim();

// Haiku 4.5 list prices per token (input, output, 5-minute cache write, cache read)
const PRICE = { input: 1e-6, output: 5e-6, cacheWrite: 1.25e-6, cacheRead: 0.1e-6 };
function costOf(records) {
  const seen = new Set();
  let usd = 0;
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
  usd = usage.input * PRICE.input + usage.output * PRICE.output + usage.cacheWrite * PRICE.cacheWrite + usage.cacheRead * PRICE.cacheRead;
  return { usage, estimatedUsd: Math.round(usd * 1e5) / 1e5 };
}

async function outer() {
  const args = process.argv.slice(2);
  const variant = args.includes('--variant') ? args[args.indexOf('--variant') + 1] : 'parent-killed';
  const watchMs = args.includes('--watch-ms') ? Number(args[args.indexOf('--watch-ms') + 1]) : 90_000;
  if (!['parent-killed', 'idle-pipes-closed'].includes(variant)) throw new Error('unknown variant ' + variant);
  const common = await import('../protocol-probe/scenarios/pass3/p1-common.mjs');
  const { assertScratch, RELAY_ENV } = await import('../protocol-probe/scenarios/pass3/c10-common.mjs');
  const { BIN, ENGINE_VERSION, scratchRun, removeRun, relayReady, ownerTmpKeys, initPayload, transcriptPath } = common;

  await relayReady();
  const ownerBefore = ownerTmpKeys();
  const ownerBeforePython = ownerKeysPython();
  const run = scratchRun('e10-q1');
  const sessionId = randomUUID();
  const engineArgs = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio',
    '--include-partial-messages', '--forward-subagent-text', '--replay-user-messages', '--include-hook-events', '--setting-sources', 'user,project,local', // launch.ts ENGINE_FLAGS
    '--model', 'haiku', '--permission-mode', 'default', '--session-id', sessionId, '--max-budget-usd', '0.30',
    '--settings', JSON.stringify({ dialogExpiry: 'never' }), '--debug-file', run.debugFile,
  ];
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG'].includes(k) || k.startsWith('LC_')));
  const env = {
    ...base, CLAUDE_CONFIG_DIR: run.home, ...RELAY_ENV, ENABLE_TOOL_SEARCH: 'true', // launch.ts buildEnvironment, gateway
    CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', CLAUDE_CODE_FORK_SUBAGENT: 'true', CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: '1', CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1',
    CLAUDE_CODE_QUESTION_PREVIEW_FORMAT: 'html', TERM: 'dumb', DISABLE_AUTOUPDATER: '1',
  };
  assertScratch(env);
  const cfg = {
    bin: BIN, args: engineArgs, env, cwd: run.cwd, init: initPayload(run.cwd),
    prompt: variant === 'idle-pipes-closed' ? null : 'Run exactly this shell command with the Bash tool, nothing else: sleep 20 && echo q1-done\nThen reply with the single word: finished',
    framesPath: join(run.root, 'frames.jsonl'), stderrPath: join(run.root, 'stderr.txt'),
  };
  const configPath = join(run.root, 'config.json');
  writeFileSync(configPath, JSON.stringify(cfg));
  const started = new Set();
  const result = { question: 'Q1', variant, engine: { bin: BIN, version: ENGINE_VERSION }, model: 'haiku', watchMs, events: [], samples: [] };
  const t0 = now();
  const log = (ev) => result.events.push({ ms: ev.at ? ev.at - t0 : now() - t0, ...ev, at: undefined });

  const w = spawn(process.execPath, [self, '--wrapper', configPath], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
  started.add(w.pid);
  let enginePid = null;
  let engineExitSeenByWrapper = null;
  w.stdout.setEncoding('utf8');
  let wbuf = '';
  w.stdout.on('data', (s) => {
    wbuf += s;
    let i;
    while ((i = wbuf.indexOf('\n')) >= 0) {
      const ev = JSON.parse(wbuf.slice(0, i));
      wbuf = wbuf.slice(i + 1);
      log(ev);
      if (ev.ev === 'spawned') { enginePid = ev.engine; started.add(ev.engine); }
      if (ev.ev === 'engine_exit') engineExitSeenByWrapper = ev;
    }
  });
  const wrapperExited = new Promise((r) => w.on('exit', (code, signal) => r({ code, signal, ms: now() - t0 })));

  const cleanupAll = () => { for (const pid of started) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch {} };
  process.on('exit', cleanupAll);
  const registryPath = () => join(run.home, 'sessions', `${enginePid}.json`);

  try {
    // until the tool's `sleep 20` runs under the engine (a bounded wait inside the probe)
    let sleeper = null;
    for (let waited = 0; variant === 'parent-killed' && waited < 60_000 && !sleeper; waited += 200) {
      await delay(200);
      if (enginePid) sleeper = descendants(psRows(), enginePid).find((r) => /(^|\/)sleep 20\b/.test(r.command)) ?? null;
      if (engineExitSeenByWrapper) throw new Error('the engine exited before the tool ran: ' + JSON.stringify(engineExitSeenByWrapper));
    }
    if (variant === 'parent-killed') {
      if (!sleeper) throw new Error('the Bash tool never started sleep 20');
      await delay(1_000); // the tool has been running a second; the turn is mid-flight
    } else {
      for (let waited = 0; waited < 30_000 && !result.events.some((e) => e.ev === 'initialized'); waited += 200) await delay(200);
      await delay(1_500); // idle after the initialize
    }
    const rows = psRows();
    const tree = descendants(rows, enginePid);
    for (const r of tree) started.add(r.pid);
    result.beforeKill = {
      engine: rows.find((r) => r.pid === enginePid) && (({ pid, ppid, pgid, stat }) => ({ pid, ppid, pgid, stat }))(rows.find((r) => r.pid === enginePid)),
      wrapperPid: w.pid,
      descendants: tree.map(({ pid, ppid, pgid, stat, command }) => ({ pid, ppid, pgid, stat, command: command.slice(0, 80) })),
      registry: pickRegistry(readJson(registryPath())),
    };
    const tKill = now();
    result.killAtMs = tKill - t0;
    if (variant === 'parent-killed') process.kill(w.pid, 'SIGKILL');
    else process.kill(w.pid, 'SIGUSR2'); // idle-pipes-closed
    // sample every 100 ms
    let engineGoneAt = null, registryGoneAt = null, sleeperGoneAt = null, firstOrphanSample = null;
    while (now() - tKill < watchMs) {
      await delay(100);
      const ms = now() - tKill;
      const all = psRows();
      const e = all.find((r) => r.pid === enginePid);
      const regExists = existsSync(registryPath());
      const sleeperAlive = sleeper !== null && alive(sleeper.pid);
      if (e && e.ppid === 1 && !firstOrphanSample) firstOrphanSample = { ms, ppid: e.ppid, pgid: e.pgid, stat: e.stat, registry: pickRegistry(readJson(registryPath())) };
      if (!e && engineGoneAt === null) engineGoneAt = ms;
      if (!regExists && registryGoneAt === null) registryGoneAt = ms;
      if (!sleeperAlive && sleeperGoneAt === null) sleeperGoneAt = ms;
      if (result.samples.length < 20 || ms % 1000 < 100 || !e) result.samples.push({ ms, engineAlive: !!e, ppid: e?.ppid ?? null, registry: regExists, sleeper: sleeperAlive });
      for (const r of descendants(all, enginePid)) started.add(r.pid);
      if (!e && !sleeperAlive) break;
    }
    result.afterKill = { engineGoneMs: engineGoneAt, registryGoneMs: registryGoneAt, sleeperGoneMs: sleeperGoneAt, firstOrphanSample, wrapperExit: await Promise.race([wrapperExited, delay(5_000).then(() => 'still running')]), engineExitSeenByWrapper };
    const lingering = [...started].filter(alive).map((pid) => psRows().find((r) => r.pid === pid)).filter(Boolean).map(({ pid, ppid, pgid, command }) => ({ pid, ppid, pgid, command: command.slice(0, 80) }));
    result.lingeringAfterWindow = lingering;
    if (lingering.length) {
      for (const r of lingering) if (r.pid !== process.pid) try { process.kill(r.pid, 'SIGTERM'); } catch {}
      await delay(5_000);
      cleanupAll();
    }
  } finally {
    if (variant === 'idle-pipes-closed' && alive(w.pid)) {
      await delay(500);
      try { process.kill(w.pid, 'SIGKILL'); } catch {}
    }
    cleanupAll();
    await delay(300);
    // the transcript and the debug log
    const tp = transcriptPath(run, sessionId);
    if (existsSync(tp)) {
      const raw = readFileSync(tp, 'utf8');
      const lines = raw.split('\n');
      const complete = lines.filter(Boolean);
      let parsed = 0, badLine = null;
      const recs = [];
      for (const l of complete) { try { recs.push(JSON.parse(l)); parsed++; } catch { badLine = l.slice(0, 120); } }
      const toolUses = recs.filter((r) => r.type === 'assistant').flatMap((r) => (r.message?.content ?? []).filter((b) => b.type === 'tool_use').map((b) => b.id));
      const toolResults = recs.filter((r) => r.type === 'user').flatMap((r) => (Array.isArray(r.message?.content) ? r.message.content : []).filter((b) => b.type === 'tool_result').map((b) => ({ id: b.tool_use_id, is_error: b.is_error ?? false, text: JSON.stringify(b.content).slice(0, 160) })));
      result.transcript = {
        lines: complete.length, parsed, endsWithNewline: raw.endsWith('\n'), badLine,
        tail: recs.slice(-4).map((r) => ({ type: r.type, subtype: r.subtype ?? null, content: JSON.stringify(r.message?.content ?? r.content ?? null).slice(0, 160) })),
        toolUses, toolResults, toolUseAnswered: toolUses.every((id) => toolResults.some((t) => t.id === id)),
        cost: costOf(recs),
      };
    } else result.transcript = null;
    const frames = existsSync(cfg.framesPath) ? readFileSync(cfg.framesPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const lastFrame = frames.at(-1);
    result.framesSeen = { count: frames.length, lastAtMsFromKill: lastFrame ? lastFrame.at - (t0 + (result.killAtMs ?? 0)) : null, results: frames.map((f) => { try { return JSON.parse(f.line); } catch { return null; } }).filter((f) => f?.type === 'result').map((f) => ({ subtype: f.subtype, total_cost_usd: f.total_cost_usd })) };
    const debug = existsSync(run.debugFile) ? readFileSync(run.debugFile, 'utf8').split(run.root).join('<scratch>').split('\n') : [];
    result.debugTail = debug.filter(Boolean).slice(-25).map((l) => l.slice(0, 220));
    result.debugShutdownLines = debug.filter((l) => /shutdown|stdin|EPIPE|orphan|exit|SIGPIPE|end of input|closed/i.test(l)).slice(-25).map((l) => l.slice(0, 220));
    result.stderr = existsSync(cfg.stderrPath) ? readFileSync(cfg.stderrPath, 'utf8').split(run.root).join('<scratch>').slice(-1500) : '';
    // A-15
    const ownerAfter = ownerTmpKeys();
    const ownerAfterPython = ownerKeysPython();
    result.ownerFileDelta = { before: ownerBefore, after: ownerAfter, same: JSON.stringify(ownerBefore) === JSON.stringify(ownerAfter), pythonBefore: ownerBeforePython, pythonAfter: ownerAfterPython };
    // every process stopped; the scratch root removed
    result.cleanup = { started: [...started], stillAlive: [...started].filter(alive), psMatchesScratch: psRows().filter((r) => r.command.includes(run.root) || r.command.includes(sessionId)).map((r) => r.pid) };
    removeRun(run);
    result.cleanup.scratchRemoved = !existsSync(run.root);
    const out = new URL(`./results/q1-${variant}.json`, import.meta.url);
    mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
    writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
    console.log(JSON.stringify({ variant, killAtMs: result.killAtMs, afterKill: result.afterKill, lingering: result.lingeringAfterWindow, cost: result.transcript?.cost, owner: result.ownerFileDelta?.same, cleanup: result.cleanup }, null, 1));
  }
}

if (process.argv[2] === '--wrapper') await wrapper(process.argv[3]);
else await outer();
