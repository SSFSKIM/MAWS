// P5 O5 M6, acceptance 10 on a VM (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, acceptance 1; M6's "The
// acceptance run"): a lane B session of the machine's own `mawsd` (its unit, no app ever attached), driven over
// machine.sock as the command line is (src/mawsd/machine-client.ts: the token, the hello, one JSON request a line), whose
// `artifact_screenshot` of an `html` artifact and `artifact_export` of a `document` as `pdf` are rendered by the
// machine's render host. Written from O10's acceptance-2 lane B (apps/desk-hub/deploy/vm/lane-b.mjs), whose link it
// copies.
//
//   node lane-b.mjs scripted <directory> [both|screenshot|export]
//                                          the scripted engine: E2's recorded `maws` session
//                                          (spikes/protocol-probe/fixtures/pass3/p1-maws-artifacts.jsonl) replayed by
//                                          the engine host (C3's replay transport; the unit's mawsd needs
//                                          MAWS_ENGINE_REPLAY=1 and a working directory holding
//                                          test/fixtures/engine/replay-handshake.jsonl, the checkout), its five `maws`
//                                          calls made a page's create, its screenshot, a document's create, its PDF
//                                          export and a list, its permission asks left out (nobody is there to answer)
//   node lane-b.mjs live <directory>       the real `claude`, as the owner's user with the machine's managed settings (the
//                                          model through the owner's relay): one turn asked to make the same two calls;
//                                          the session's permission asks for the `maws` artifact tools allowed, any other
//                                          denied; nothing of the model's text is printed
//
// Each prints one JSON line: the session's ids, the engine's version, the two tool answers as the check reads them
// (`status`, the picture's type and size, the export's path) and whether the export's file is a PDF under the profile's
// store. The profile is $MAWS_USER_DATA, else ~/.config/MAWS. Every request and every wait is bounded.
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const SOCKET_PROTOCOL = 3; // machine.sock's major (src/shared/host/socket-protocol.ts)
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const RECORDING = join(REPO, 'spikes', 'protocol-probe', 'fixtures', 'pass3', 'p1-maws-artifacts.jsonl');

const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>O5 acceptance</title></head><body style="font-family:sans-serif;background:#f4f1ea"><h1>Rendered with no app</h1><p>한국어 · 日本語 · emoji 🎨</p></body></html>';
const DOCUMENT = '# O5 acceptance\n\nThis document was exported to PDF by the render host of a machine with no app open. ^p1';
// The calls the scripted engine makes, in the order of the recording's five `maws` tool uses
const CREATE_PAGE = { name: 'artifact_create', input: { kind: 'html', title: 'O5 acceptance page', handle: 'o5page', content: PAGE } };
const SCREENSHOT = { name: 'artifact_screenshot', input: { id: 'o5page' } };
const CREATE_DOCUMENT = { name: 'artifact_create', input: { kind: 'document', title: 'O5 acceptance document', handle: 'o5doc', content: DOCUMENT } };
const EXPORT = { name: 'artifact_export', input: { artifact: 'o5doc', format: 'pdf' } };
const LIST = { name: 'artifact_list', input: {} };
// One session making both calls, or one per call (so `mawsd status` can be read between them, the first render host
// ended after its quiet period): five calls each, the recording's count, a list filling the rest
const CALLS = {
  both: [CREATE_PAGE, SCREENSHOT, CREATE_DOCUMENT, EXPORT, LIST],
  screenshot: [CREATE_PAGE, SCREENSHOT, LIST, LIST, LIST],
  export: [CREATE_DOCUMENT, LIST, LIST, EXPORT, LIST],
};

/** A link to machine.sock: `request(name, input)` answers the response's value, or throws its error. */
async function reach(dir, { helloMs = 5000 } = {}) {
  const token = readFileSync(join(dir, 'mawsd.token'), 'utf8').trim();
  const socket = createConnection(join(dir, 'machine.sock'));
  const waiting = new Map();
  let buffered = '';
  let welcomed;
  const hello = new Promise((resolve, reject) => {
    welcomed = { resolve, reject };
    setTimeout(() => reject(new Error(`no answer to the hello within ${helloMs / 1000} s`)), helloMs).unref();
  });
  let closed = null;
  const fail = (error) => {
    closed ??= error;
    welcomed.reject(closed);
    for (const { reject } of waiting.values()) reject(closed);
  };
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('mawsd closed the connection')));
  let first = true;
  socket.on('data', (chunk) => {
    buffered += Buffer.from(chunk).toString('utf8');
    for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
      const line = buffered.slice(0, at);
      buffered = buffered.slice(at + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (first) {
        first = false;
        if (message.t === 'welcome') welcomed.resolve(message);
        else welcomed.reject(new Error(`mawsd refused the hello: ${line.slice(0, 200)}`));
        continue;
      }
      if (message.t !== 'res' || typeof message.id !== 'string') continue; // events: not this client's
      waiting.get(message.id)?.resolve(message);
    }
  });
  socket.on('connect', () => socket.write(`${JSON.stringify({ t: 'hello', protocol: SOCKET_PROTOCOL, token, minor: 0, build: 'o5-m6-lane-b', capabilities: [], appPid: process.pid })}\n`));
  const welcome = await hello;
  let next = 0;
  return {
    welcome,
    async request(name, input, ms = 30_000) {
      if (closed) throw closed;
      const id = `o5-${++next}`;
      const answer = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => (waiting.delete(id), reject(new Error(`mawsd did not answer ${name} within ${ms / 1000} s`))), ms);
        waiting.set(id, { resolve: (m) => (clearTimeout(timer), waiting.delete(id), resolve(m)), reject: (e) => (clearTimeout(timer), waiting.delete(id), reject(e)) });
        socket.write(`${JSON.stringify({ t: 'req', id, name, input })}\n`);
      });
      if (answer.ok !== true) throw new Error(`${name}: ${answer.error?.code ?? 'error'}: ${String(answer.error?.message ?? '').slice(0, 300)}`);
      return answer.value;
    },
    close: () => socket.destroy(),
  };
}

/** Polls `read` until `done(value)`, every `everyMs`, at most `ms`; the last value read in the error. */
async function until(read, done, what, ms, everyMs = 1000) {
  const deadline = Date.now() + ms;
  let last;
  for (;;) {
    try {
      last = await read();
      if (done(last)) return last;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() > deadline) throw new Error(`${what} not within ${ms / 1000} s (last: ${JSON.stringify(last)?.slice(0, 400)})`);
    await sleep(everyMs);
  }
}

// --- the scripted engine's fixture ------------------------------------------------------------------------------------

/**
 * The recording with its k-th `maws` tool use made CALLS[k] wherever it is carried (the stream's block start and input
 * deltas, the assistant's tool use, the engine's `tools/call`), as e2e/support/document-replay.ts derives its replays,
 * and its permission asks (the engine's `can_use_tool` requests and the host's answers) left out: the replay plays the
 * engine's frames as given and holds only at what the host writes, matched by kind, so with no ask nothing waits for a
 * person. The engine's recorded tool results and the model's words stay the recording's and are never read.
 */
export function scriptedFixture(recording, calls) {
  const rows = readFileSync(recording, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const order = [];
  const callOf = (toolUseId) => (typeof toolUseId === 'string' && order.includes(toolUseId) ? calls[order.indexOf(toolUseId)] : undefined);
  const open = new Map();
  const asks = new Set(); // the can_use_tool request ids, whose answers go too
  const out = [];
  for (const row of rows) {
    const frame = structuredClone(row.frame);
    const event = frame.event;
    if (frame.type === 'stream_event' && event) {
      const block = event.content_block;
      if (event.type === 'content_block_start' && block?.name?.startsWith('mcp__maws__') && block.id) {
        if (!order.includes(block.id)) order.push(block.id);
        const call = callOf(block.id);
        if (call) (block.name = `mcp__maws__${call.name}`), open.set(event.index, { call, deltas: 0 });
      } else if (event.type === 'content_block_stop') open.delete(event.index);
      else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
        const entry = open.get(event.index);
        if (entry) event.delta.partial_json = entry.deltas++ === 0 ? JSON.stringify(entry.call.input) : '';
      }
    }
    if (frame.type === 'assistant') {
      for (const part of frame.message?.content ?? []) {
        if (part.type !== 'tool_use' || !part.name?.startsWith('mcp__maws__')) continue;
        if (part.id && !order.includes(part.id)) order.push(part.id);
        const call = callOf(part.id);
        if (call) Object.assign(part, { name: `mcp__maws__${call.name}`, input: call.input });
      }
    }
    if (frame.type === 'control_request' && frame.request?.subtype === 'can_use_tool') {
      asks.add(frame.request_id);
      continue;
    }
    if (frame.type === 'control_response' && asks.has(frame.response?.request_id)) continue;
    if (frame.type === 'control_request' && frame.request?.subtype === 'mcp_message' && frame.request.message?.method === 'tools/call') {
      const params = frame.request.message.params;
      const call = callOf(params?._meta?.['claudecode/toolUseId']);
      if (call) Object.assign(params, { name: call.name, arguments: call.input });
    }
    out.push({ ...row, frame });
  }
  if (order.length !== calls.length) throw new Error(`${recording} has ${order.length} maws tool uses; ${calls.length} calls were given`);
  return out;
}

const firstPrompt = (rows) => rows.find((r) => r.direction === 'out' && r.frame.type === 'user')?.frame.message?.content;

// --- the journal: the engine host's record of each launch -------------------------------------------------------------

function journalOf(profile, app) {
  const dir = join(profile, 'engine-host', 'journal', app);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .flatMap((name) => readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)));
}

/** The `maws` tools/call requests the engine made and the host's answers, in order. */
function mawsCalls(rows) {
  const answers = new Map();
  for (const row of rows) {
    const f = row.frame;
    if (row.direction === 'out' && f.type === 'control_response') answers.set(f.response?.request_id, f.response?.response?.mcp_response?.result ?? null);
  }
  return rows.flatMap((row) => {
    const f = row.frame;
    if (row.direction !== 'in' || f.type !== 'control_request' || f.request?.subtype !== 'mcp_message' || f.request.message?.method !== 'tools/call') return [];
    return [{ name: f.request.message.params?.name, result: answers.get(f.request_id) ?? null }];
  });
}

/** What the check reads of the two answers: the screenshot's picture, the export's file. Nothing else of either. */
function checked(profile, calls) {
  const screenshot = calls.find((c) => c.name === 'artifact_screenshot')?.result ?? null;
  const exported = calls.find((c) => c.name === 'artifact_export')?.result ?? null;
  const textOf = (result) => {
    const text = result?.content?.find((b) => b.type === 'text')?.text;
    try {
      return JSON.parse(text.slice(text.indexOf('{')));
    } catch {
      return null;
    }
  };
  const image = screenshot?.content?.find((b) => b.type === 'image') ?? null;
  const shot = textOf(screenshot);
  const file = textOf(exported);
  const path = typeof file?.path === 'string' ? file.path : null;
  const store = join(profile, 'artifacts');
  return {
    screenshot: screenshot === null ? null : { isError: screenshot.isError === true, status: shot?.status ?? null, width: shot?.width ?? null, height: shot?.height ?? null, image: image === null ? null : { mimeType: image.mimeType, bytes: Buffer.from(image.data, 'base64').length } },
    export: exported === null ? null : { isError: exported.isError === true, status: file?.status ?? null, format: file?.format ?? null, path, underStore: path !== null && path.startsWith(`${store}/`) && /\/exports\//.test(path), pdf: path !== null && existsSync(path) && readFileSync(path).subarray(0, 5).toString('latin1') === '%PDF-' },
  };
}

const shotPassed = (result) => result.screenshot?.status === 'captured' && result.screenshot.image?.mimeType === 'image/png';
const exportPassed = (result) => result.export?.status === 'exported' && result.export.underStore && result.export.pdf;
const passed = (result, part) => (part === 'export' || shotPassed(result)) && (part === 'screenshot' || exportPassed(result));

// --- the two runs ---------------------------------------------------------------------------------------------------

async function scripted(link, profile, directory, part) {
  mkdirSync(directory, { recursive: true });
  const calls = CALLS[part];
  if (calls === undefined) throw new Error(`no part ${part}: both, screenshot or export`);
  const rows = scriptedFixture(RECORDING, calls);
  const fixture = join(directory, `o5-render-replay-${part}.jsonl`);
  writeFileSync(fixture, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const { appSessionId: app } = await link.request('session.create', { projectId: null, location: { kind: 'directory', path: directory } });
  const spec = {
    appSessionId: app, cwd: directory, additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
    resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay: fixture, inheritGrantsFrom: null,
  }; // src/shared/composer/launch-defaults.ts's, with the replay
  const launched = await link.request('session.launch', { spec }, 60_000);
  if (launched?.status !== 'launching') throw new Error(`session.launch answered ${JSON.stringify(launched).slice(0, 400)}`);
  await until(() => link.request('session.status', { appSessionId: app }), (s) => s?.process === 'ready', `the replayed session ${app} ready`, 60_000);
  await link.request('session.send', { appSessionId: app, content: firstPrompt(rows) }, 30_000);
  const status = await until(
    () => link.request('session.status', { appSessionId: app }),
    (s) => s?.turn === null && mawsCalls(journalOf(profile, app)).filter((c) => c.result !== null).length >= calls.length,
    `the replayed session ${app}'s five maws calls answered`,
    240_000,
  );
  return { app, launch: status.launchId ?? null, engineSession: status.engineSessionId ?? null, engine: 'scripted (C3 replay of pass3/p1-maws-artifacts, engine 2.1.291 as recorded)', calls: mawsCalls(journalOf(profile, app)).map((c) => c.name) };
}

const LIVE_PROMPT = [
  'This is an automated acceptance check of the maws tools. Use only the maws tools, and no other tool.',
  `1. Call artifact_create with kind "html", title "O5 live page", handle "o5live" and this content: ${PAGE}`,
  '2. Call artifact_screenshot with id "o5live".',
  `3. Call artifact_create with kind "document", title "O5 live document", handle "o5livedoc" and this content: ${JSON.stringify(DOCUMENT)}`,
  '4. Call artifact_export with artifact "o5livedoc" and format "pdf".',
  'Then reply with the single word: done.',
].join('\n');
const ALLOWED = new Set(['mcp__maws__artifact_create', 'mcp__maws__artifact_screenshot', 'mcp__maws__artifact_export']);

async function live(link, profile, directory) {
  mkdirSync(directory, { recursive: true });
  const { appSessionId: app } = await link.request('session.create', { projectId: null, location: { kind: 'directory', path: directory } });
  // the model through the machine's managed settings (the owner's relay), so the engine's own route: `direct`
  const outcome = await link.request('session.start', { appSessionId: app, message: { content: LIVE_PROMPT, display: 'O5 acceptance, live' }, options: { gateway: 'direct', trust: 'accepted' } }, 120_000);
  if (outcome?.status !== 'starting') throw new Error(`session.start answered ${JSON.stringify(outcome).slice(0, 400)}`);
  const answered = new Set();
  const decisions = [];
  let afterSeq = null;
  const deadline = Date.now() + 600_000;
  for (;;) {
    // the permission asks, answered as they come: the artifact tools allowed once, anything else denied
    const page = await link.request('session.events', { appSessionId: app, afterSeq, limit: 500 }).catch(() => null);
    for (const event of page?.events ?? []) {
      if (typeof event?.seq === 'number') afterSeq = event.seq;
      if (event?.kind !== 'permission.requested') continue;
      const ask = event.payload ?? event;
      if (typeof ask.requestId !== 'string' || answered.has(ask.requestId)) continue;
      answered.add(ask.requestId);
      const allow = ALLOWED.has(ask.toolName);
      decisions.push(`${ask.toolName}: ${allow ? 'allowed' : 'denied'}`);
      await link.request('session.answer', { appSessionId: app, requestId: ask.requestId, answer: allow ? { kind: 'permission', decision: 'allow', scope: 'once' } : { kind: 'permission', decision: 'deny' } });
    }
    const status = await link.request('session.status', { appSessionId: app }).catch(() => null);
    const calls = mawsCalls(journalOf(profile, app));
    const done = calls.some((c) => c.name === 'artifact_export' && c.result !== null) && calls.some((c) => c.name === 'artifact_screenshot' && c.result !== null);
    if (status?.turn === null && status?.process === 'ready' && (done || answered.size > 0 || calls.length > 0)) {
      return { app, launch: status.launchId ?? null, engineSession: status.engineSessionId ?? null, engine: engineVersionOf(journalOf(profile, app)), calls: calls.map((c) => c.name), decisions };
    }
    if (Date.now() > deadline) throw new Error(`the live session ${app} did not finish its turn within 600 s (calls: ${calls.map((c) => c.name).join(', ')})`);
    await sleep(2000);
  }
}

// The engine's version as the launch recorded it (the journal's spawn or provenance row)
function engineVersionOf(rows) {
  for (const row of rows) if (row.direction === 'meta' && typeof row.frame?.engineVersion === 'string') return row.frame.engineVersion;
  for (const row of rows) if (row.direction === 'in' && row.frame?.type === 'system' && row.frame.subtype === 'init' && typeof row.frame.claude_code_version === 'string') return row.frame.claude_code_version;
  return null;
}

async function main([verb, directory, part = 'both']) {
  if ((verb !== 'scripted' && verb !== 'live') || !directory) throw new Error('lane-b.mjs scripted <directory> [both|screenshot|export] | live <directory>');
  const profile = process.env.MAWS_USER_DATA || join(homedir(), '.config', 'MAWS');
  const link = await reach(join(profile, 'mawsd'));
  try {
    const before = (await link.request('daemon.status', undefined)).render ?? null; // also wakes the parked engine host
    const run = verb === 'scripted' ? await scripted(link, profile, resolve(directory), part) : await live(link, profile, resolve(directory));
    const result = checked(profile, mawsCalls(journalOf(profile, run.app)));
    const after = (await link.request('daemon.status', undefined)).render ?? null;
    const ok = passed(result, verb === 'live' ? 'both' : part);
    console.log(JSON.stringify({ verb, part: verb === 'live' ? 'both' : part, ...run, renderBefore: before, renderAfter: after, ...result, passed: ok }));
    if (!ok) process.exitCode = 1;
  } finally {
    link.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.log(`lane-b: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
