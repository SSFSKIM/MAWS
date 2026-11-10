// P5 O15 M4's rows 10a to 10c (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, M4's table): tools with no
// app, on a production machine. A client of the machine's own `mawsd` (its unit) over machine.sock, as the command line
// is (src/mawsd/machine-client.ts: the token, the hello, one JSON request a line), with no app subscribed to the session.
// It starts one lane B session on the real model (the engine's own route, through the machine's managed settings), named
// so the owner can tell it in a sidebar, and tells it to make an html artifact and screenshot it, and a document and
// export it as a PDF, with its `maws` tools. The model does the work; the script only drives the session: it answers the
// permission asks of the `maws` artifact tools (allowed once) and no other, reads `session.capabilities` before the start
// and after the turn, and ends the session however the run ends. Copied from the O5 acceptance's live mode
// (spikes/u4-render-service/vm/lane-b.mjs), whose link, journal read and checks it keeps.
//
//   node o15-tools.mjs <directory> [--title <name>]   (the session's name: "O15 row 10 dry run" unless given)
//
// The hello lists no capability (never `machine.spine`), and the script sends no `exit now`. What it prints is times, the
// model's id, the turns' counts, the capability record and PASS / FAIL lines; nothing of the model's text, the prompt or
// the tools' answers beyond their type and size. It exits 1 on any FAIL. The profile is $MAWS_USER_DATA, else
// ${XDG_CONFIG_HOME:-~/.config}/MAWS. Every request and every wait is bounded.
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const SOCKET_PROTOCOL = 3; // machine.sock's major (src/shared/host/socket-protocol.ts)
const WIRE_MINOR = 33; // src/shared/ipc/wire.ts at the row's build
const TITLE = 'O15 row 10 dry run';
const TOOLS = ['artifact_screenshot', 'artifact_export'];
const ALLOWED = new Set(['mcp__maws__artifact_create', 'mcp__maws__artifact_screenshot', 'mcp__maws__artifact_export']);
const TURN_MS = 600_000;

const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>O15 row 10</title></head><body style="font-family:sans-serif;background:#f4f1ea"><h1>Rendered with no app</h1><p>한국어 · 日本語 · emoji 🎨</p></body></html>';
const DOCUMENT = '# O15 row 10\n\nThis document was exported to PDF by the render host of a machine with no app open. ^p1';
const PROMPT = [
  'This is an automated acceptance check of the maws tools. Use only the maws tools, and no other tool.',
  `1. Call artifact_create with kind "html", title "O15 row 10 page", handle "o15page" and this content: ${PAGE}`,
  '2. Call artifact_screenshot with id "o15page".',
  `3. Call artifact_create with kind "document", title "O15 row 10 document", handle "o15doc" and this content: ${JSON.stringify(DOCUMENT)}`,
  '4. Call artifact_export with artifact "o15doc" and format "pdf".',
  'Then reply with the single word: done.',
].join('\n');

const now = () => new Date().toISOString();
const say = (line) => console.log(line);

/** A link to machine.sock: `request(name, input)` answers the response's value, or throws its error. */
async function reach(dir, { helloMs = 5000 } = {}) {
  const token = readFileSync(join(dir, 'mawsd.token'), 'utf8').trim();
  const socket = createConnection(join(dir, 'machine.sock'));
  const waiting = new Map();
  let buffered = '';
  let welcomed;
  const hello = new Promise((done, reject) => {
    welcomed = { resolve: done, reject };
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
        else welcomed.reject(new Error(`mawsd refused the hello (${String(message.t)} ${String(message.reason ?? '')})`));
        continue;
      }
      if (message.t !== 'res' || typeof message.id !== 'string') continue; // events: not this client's
      waiting.get(message.id)?.resolve(message);
    }
  });
  // No capability: never `machine.spine`, so mawsd takes this for no app.
  socket.on('connect', () => socket.write(`${JSON.stringify({ t: 'hello', protocol: SOCKET_PROTOCOL, token, minor: WIRE_MINOR, build: 'o15-m4-row10', capabilities: [], appPid: process.pid })}\n`));
  const welcome = await hello;
  let next = 0;
  return {
    welcome,
    async request(name, input, ms = 30_000) {
      if (closed) throw closed;
      const id = `o15-${++next}`;
      const answer = await new Promise((done, reject) => {
        const timer = setTimeout(() => (waiting.delete(id), reject(new Error(`mawsd did not answer ${name} within ${ms / 1000} s`))), ms);
        waiting.set(id, { resolve: (m) => (clearTimeout(timer), waiting.delete(id), done(m)), reject: (e) => (clearTimeout(timer), waiting.delete(id), reject(e)) });
        socket.write(`${JSON.stringify({ t: 'req', id, name, input })}\n`);
      });
      // the error's code alone: its message can quote what the request carried
      if (answer.ok !== true) throw new Error(`${name}: ${answer.error?.code ?? 'error'}`);
      return answer.value;
    },
    close: () => socket.destroy(),
  };
}

/** Polls `read` until `done(value)`, every `everyMs`, at most `ms`. */
async function until(read, done, what, ms, everyMs = 1000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read().catch(() => undefined);
    if (value !== undefined && done(value)) return value;
    if (Date.now() > deadline) throw new Error(`${what} not within ${ms / 1000} s`);
    await sleep(everyMs);
  }
}

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

/** What the check reads of the two answers: the screenshot's picture type and size, the export's file. Nothing else. */
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
    screenshot: screenshot === null ? null : { isError: screenshot.isError === true, status: shot?.status ?? null, image: image === null ? null : { mimeType: image.mimeType, bytes: Buffer.from(image.data, 'base64').length } },
    export: exported === null ? null : { isError: exported.isError === true, status: file?.status ?? null, format: file?.format ?? null, underStore: path !== null && path.startsWith(`${store}/`) && /\/exports\//.test(path), pdf: path !== null && existsSync(path) && readFileSync(path).subarray(0, 5).toString('latin1') === '%PDF-' },
  };
}

/** The two tools' entries of a capability record, as printed: `available`, or the reason it is not. */
const capabilityLine = (caps) =>
  TOOLS.map((tool) => {
    const entry = caps?.[tool];
    return `${tool} ${entry === undefined ? 'absent' : entry.available ? 'available' : `not available (${entry.reason ?? 'no reason given'})`}`;
  }).join('; ');

// --- the run -------------------------------------------------------------------------------------------------------

async function run(link, profile, directory, title, verdicts) {
  mkdirSync(directory, { recursive: true });
  const { appSessionId: app } = await link.request('session.create', { projectId: null, location: { kind: 'directory', path: directory } });
  const stop = async () => {
    const stopped = await link.request('session.stop', { appSessionId: app, reason: 'stop' }, 60_000).catch((error) => ({ failed: error.message }));
    say(`${now()} session ended: ${stopped.failed ?? `exited ${String(stopped.exited)}`}`);
  };
  try {
    const before = await link.request('session.capabilities', { appSessionId: app });
    say(`${now()} capabilities before the start: ${JSON.stringify(before)}`);
    // 10c: each tool offered, or refused with its reason, before any call
    const told = (caps) => TOOLS.every((tool) => caps?.[tool] !== undefined && (caps[tool].available === true || typeof caps[tool].reason === 'string'));
    verdicts.push([told(before), `capabilities before the start: ${capabilityLine(before)}`]);

    const started = Date.now();
    say(`${now()} start`);
    // the model through the machine's managed settings, so the engine's own route: `direct`
    const outcome = await link.request('session.start', { appSessionId: app, message: { content: PROMPT, display: title }, options: { gateway: 'direct', trust: 'accepted' } }, 120_000);
    if (outcome?.status !== 'starting') throw new Error(`session.start answered ${String(outcome?.status)}`);
    const renamed = await until(() => link.request('session.rename', { appSessionId: app, title }), (r) => r?.record !== undefined, `the session named "${title}"`, 60_000, 2000);
    say(`${now()} named "${title}" (${renamed.via})`);

    const answered = new Set();
    const turns = [];
    let afterSeq = null;
    let model = null;
    const deadline = Date.now() + TURN_MS;
    for (;;) {
      const page = await link.request('session.events', { appSessionId: app, afterSeq, limit: 500 }).catch(() => null);
      for (const event of page?.events ?? []) {
        if (typeof event?.seq === 'number') afterSeq = event.seq;
        const body = event?.payload ?? event;
        if (event?.kind === 'turn.ended' && body.isEchoReceipt !== true) turns.push(body.numTurns);
        if (event?.kind !== 'permission.requested' || typeof body.requestId !== 'string' || answered.has(body.requestId)) continue;
        answered.add(body.requestId);
        // the maws artifact tools alone are answered; any other ask fails the run, unanswered, and the session is ended
        if (!ALLOWED.has(body.toolName)) throw new Error(`the session asked for ${String(body.toolName)}, which this run does not answer`);
        await link.request('session.answer', { appSessionId: app, requestId: body.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } });
        say(`${now()} allowed ${body.toolName} once`);
      }
      const status = await link.request('session.status', { appSessionId: app }).catch(() => null);
      model = status?.model ?? model;
      if (status?.turn === null && status?.process === 'ready' && turns.length > 0) break;
      if (Date.now() > deadline) throw new Error(`the turn did not end within ${TURN_MS / 1000} s`);
      await sleep(2000);
    }
    say(`${now()} turn ended after ${((Date.now() - started) / 1000).toFixed(1)} s; turn.ended x${turns.length}, numTurns ${turns.join(', ')}`);
    say(`model: requested ${String(model?.requested ?? null)}, resolved ${String(model?.resolved ?? null)}`);
    verdicts.push([typeof model?.resolved === 'string' && model.resolved !== '', `the model resolved: ${String(model?.resolved ?? null)}`]);

    const after = await link.request('session.capabilities', { appSessionId: app });
    say(`${now()} capabilities after the turn: ${JSON.stringify(after)}`);
    verdicts.push([told(after), `capabilities after the turn: ${capabilityLine(after)}`]);

    const result = checked(profile, mawsCalls(journalOf(profile, app)));
    const shot = result.screenshot;
    const file = result.export;
    verdicts.push([shot?.status === 'captured' && shot.image?.mimeType === 'image/png', `artifact_screenshot: ${shot === null ? 'never called' : `${String(shot.status)}, ${shot.image === null ? 'no image' : `${shot.image.mimeType}, ${shot.image.bytes} bytes`}`}`]);
    verdicts.push([file?.status === 'exported' && file.underStore && file.pdf, `artifact_export: ${file === null ? 'never called' : `${String(file.status)}, ${String(file.format)}, ${file.pdf ? 'a PDF' : 'not a PDF'} ${file.underStore ? 'under' : 'outside'} the profile's artifact store`}`]);
  } finally {
    await stop();
  }
}

async function main(argv) {
  const [directory] = argv;
  const at = argv.indexOf('--title');
  const title = at > 0 ? argv[at + 1] : TITLE;
  if (!directory || directory.startsWith('--') || !title) throw new Error('o15-tools.mjs <directory> [--title <name>]');
  const profile = process.env.MAWS_USER_DATA || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'MAWS');
  const link = await reach(join(profile, 'mawsd'));
  const verdicts = [];
  try {
    await link.request('daemon.status', undefined); // wakes the parked engine host
    await run(link, profile, resolve(directory), title, verdicts);
  } catch (error) {
    verdicts.push([false, error instanceof Error ? error.message : String(error)]);
  } finally {
    link.close();
  }
  for (const [ok, line] of verdicts) say(`${ok ? 'PASS' : 'FAIL'} ${line}`);
  if (verdicts.some(([ok]) => !ok)) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.log(`FAIL o15-tools: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
