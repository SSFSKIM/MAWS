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
//   node o15-tools.mjs --list-trusted                 the project paths the engine's config (.claude.json) records as
//                                                     trusted, and nothing else of that file: where to run
//
// The run trusts nothing itself: <directory> must already be trusted on this machine (session.start's `needs_trust` is a
// FAIL naming the trust key and the config file). The session's id is printed, so a session the run could not end can
// be stopped by hand; an INT or TERM ends it the same bounded way before the script exits.
//
// The hello lists no capability (never `machine.spine`), and the script sends no `exit now`. What it prints is times, the
// model's id, the turns' counts, the capability record and PASS / FAIL lines; nothing of the model's text, the prompt or
// the tools' answers beyond their type and size. It exits 1 on any FAIL. The profile is $MAWS_USER_DATA, else
// ${XDG_CONFIG_HOME:-~/.config}/MAWS. Every request and every wait is bounded.
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
const tilde = (path) => (typeof path === 'string' && path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : String(path));
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
      // the error's code alone: its message can quote what the request carried. The engine host's word for a session it
      // holds no row of (src/engine-host/ipc.ts `unknownSession`) is kept as `unknownSession`, the one error that says
      // no process runs.
      if (answer.ok !== true) {
        const error = new Error(`${name}: ${answer.error?.code ?? 'error'}`);
        error.code = answer.error?.code ?? null;
        error.unknownSession = answer.error?.code === 'internal' && typeof input?.appSessionId === 'string' && answer.error?.message === `unknown session ${input.appSessionId}`;
        throw error;
      }
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
  const picture = image === null ? null : pngOf(image);
  const shot = textOf(screenshot);
  const file = textOf(exported);
  const path = typeof file?.path === 'string' ? file.path : null;
  const store = join(profile, 'artifacts');
  return {
    screenshot: screenshot === null ? null : { isError: screenshot.isError === true, status: shot?.status ?? null, image: image === null ? null : { mimeType: image.mimeType, ...picture } },
    export: exported === null ? null : { isError: exported.isError === true, status: file?.status ?? null, format: file?.format ?? null, underStore: path !== null && path.startsWith(`${store}/`) && /\/exports\//.test(path), ...pdfOf(path) },
  };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MIN_PNG_BYTES = 100;
const MIN_PDF_BYTES = 500;

/** The picture decoded: its size, and whether it is a PNG (the signature, then an IHDR naming a width and a height). */
function pngOf(image) {
  const bytes = typeof image.data === 'string' ? Buffer.from(image.data, 'base64') : Buffer.alloc(0);
  const ihdr = bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE) && bytes.subarray(12, 16).toString('latin1') === 'IHDR';
  const width = ihdr ? bytes.readUInt32BE(16) : 0;
  const height = ihdr ? bytes.readUInt32BE(20) : 0;
  return { bytes: bytes.length, width, height, png: ihdr && width > 0 && height > 0 && bytes.length >= MIN_PNG_BYTES };
}

/** The exported file read: its size, and whether it is a PDF (the header, an end-of-file marker, a size past a stub's). */
function pdfOf(path) {
  if (path === null || !existsSync(path)) return { bytes: 0, pdf: false };
  const bytes = readFileSync(path);
  const tail = bytes.subarray(Math.max(0, bytes.length - 1024)).toString('latin1');
  return { bytes: bytes.length, pdf: bytes.subarray(0, 5).toString('latin1') === '%PDF-' && tail.includes('%%EOF') && bytes.length >= MIN_PDF_BYTES };
}

/** The two tools' entries of a capability record, as printed: `available`, or the reason it is not. */
const capabilityLine = (caps) =>
  TOOLS.map((tool) => {
    const entry = caps?.[tool];
    return `${tool} ${entry === undefined ? 'absent' : entry.available ? 'available' : `not available (${entry.reason ?? 'no reason given'})`}`;
  }).join('; ');

// --- the run -------------------------------------------------------------------------------------------------------

/**
 * Ends session `app` however the run ends (its end, a signal, a start that failed or never answered), bounded, and says
 * whether its end is shown. `start` is the `session.start` request's promise (null when none was sent): a pending one is
 * awaited first, at most `startMs`. Then `session.stop`, and the session is watched for `settleMs` and stopped again
 * whenever it shows a live process, since the daemon's setup runs past start's answer (src/services/sessions/service.ts)
 * and may launch after a first stop. Ended is only what says so: a stop answered `exited`, a status of an exited
 * process, or the engine host's `unknown session` (no row, so no process). Any other error (host_unavailable, a
 * timeout, a failed link) leaves the end unread. And the end is unconfirmed while setup may still launch: the start
 * still pending when its wait expired, or answered `starting` with no live process ever seen (`seenLive`, the run's own
 * sight of it ready, or the watch's).
 */
export async function endSession(link, app, start, { startMs = 30_000, settleMs = 30_000, everyMs = 2000, stopMs = 60_000, seenLive = false } = {}) {
  const PENDING = Symbol('pending');
  const answered = start === null ? null : await Promise.race([Promise.resolve(start).then((v) => ({ v }), () => ({ failed: true })), sleep(startMs).then(() => PENDING)]);
  const said = [];
  let unread = false;
  let live = seenLive;
  const errorOf = (error) => (error instanceof Error ? error.message : String(error));
  const stop = async () => {
    try {
      const r = await link.request('session.stop', { appSessionId: app, reason: 'stop' }, stopMs);
      said.push(`stop: exited ${String(r?.exited)}`);
    } catch (error) {
      if (error?.unknownSession !== true) unread = true;
      said.push(`stop: ${error?.unknownSession === true ? 'unknown session' : `unread (${errorOf(error)})`}`);
    }
  };
  /** `live`, `ended`, or `unread`. */
  const state = async () => {
    try {
      const s = await link.request('session.status', { appSessionId: app }, 10_000);
      if (s?.process === 'exited') return 'ended';
      live = true;
      return 'live';
    } catch (error) {
      if (error?.unknownSession === true) return 'ended';
      said.push(`status: unread (${errorOf(error)})`);
      return 'unread';
    }
  };
  await stop();
  let last = await state();
  const deadline = Date.now() + settleMs;
  while (last !== 'unread' && Date.now() < deadline) {
    if (last === 'live') await stop();
    await sleep(everyMs);
    last = await state();
  }
  if (last === 'live') {
    await stop();
    last = await state();
  }
  const detail = `${said.join('; ')}; last read ${last}`;
  if (unread || last !== 'ended') return { ok: false, why: 'not shown ended', detail };
  if (answered === PENDING) return { ok: false, why: 'end unconfirmed: start still pending', detail };
  if (answered?.v?.status === 'starting' && !live) return { ok: false, why: 'end unconfirmed: the start answered starting and no launch was seen', detail };
  return { ok: true, why: 'ended', detail };
}

async function run(link, profile, directory, title, verdicts, onSession) {
  if (!existsSync(directory)) throw new Error(`no directory ${tilde(directory)}: run in a directory already trusted on this machine (--list-trusted)`);
  const { appSessionId: app } = await link.request('session.create', { projectId: null, location: { kind: 'directory', path: directory } });
  say(`${now()} session ${app} created`);
  // The session's end, from here on, once however many ask (the run's end, a signal): a start sent is awaited first,
  // and a run that never saw the session ready watches it longer, for a launch its setup makes late.
  let starting = null;
  let launched = false;
  let ending = null;
  const stop = () =>
    (ending ??= endSession(link, app, starting, { settleMs: launched ? 4000 : 30_000, seenLive: launched }).then(({ ok, why, detail }) => {
      say(`${now()} session ${app} end: ${detail}`);
      verdicts.push([ok, ok ? `the session ${app} ended` : `${why}, stop it by hand ${app} (${detail})`]);
    }));
  onSession(stop);
  try {
    const before = await link.request('session.capabilities', { appSessionId: app });
    say(`${now()} capabilities before the start: ${JSON.stringify(before)}`);
    // 10c: each tool offered, or refused with its reason, before any call
    const told = (caps) => TOOLS.every((tool) => caps?.[tool] !== undefined && (caps[tool].available === true || typeof caps[tool].reason === 'string'));
    verdicts.push([told(before), `capabilities before the start: ${capabilityLine(before)}`]);

    const started = Date.now();
    say(`${now()} start`);
    // the model through the machine's managed settings, so the engine's own route: `direct`
    // No trust decision is sent: the run trusts nothing, so the directory must be trusted already.
    starting = link.request('session.start', { appSessionId: app, message: { content: PROMPT, display: title }, options: { gateway: 'direct' } }, 120_000);
    const outcome = await starting;
    if (outcome?.status === 'needs_trust') throw new Error(`not trusted: run in a directory already trusted on this machine (its trust key ${tilde(outcome.trust?.trustKey)} in ${tilde(outcome.trust?.configPath)}; --list-trusted)`);
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
      if (status?.process === 'ready') launched = true;
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
    verdicts.push([shot !== null && !shot.isError && shot.status === 'captured' && shot.image?.mimeType === 'image/png' && shot.image.png, `artifact_screenshot: ${shot === null ? 'never called' : `${shot.isError ? 'an error result, ' : ''}${String(shot.status)}, ${shot.image === null ? 'no image' : `${shot.image.mimeType}, ${shot.image.bytes} bytes, ${shot.image.png ? `a PNG ${shot.image.width}x${shot.image.height}` : 'not a PNG with a size'}`}`}`]);
    verdicts.push([file !== null && !file.isError && file.status === 'exported' && file.underStore && file.pdf, `artifact_export: ${file === null ? 'never called' : `${file.isError ? 'an error result, ' : ''}${String(file.status)}, ${String(file.format)}, ${file.bytes} bytes, ${file.pdf ? 'a PDF' : 'not a whole PDF'} ${file.underStore ? 'under' : 'outside'} the profile's artifact store`}`]);
  } finally {
    await stop();
  }
}

/**
 * The global config file the engine reads, as src/shared/engine/config-dir.ts's `configFilePath` selects it (a script on
 * the machine cannot import the TS; test/deploy/o15-tools.test.ts holds the two to one answer): the legacy
 * `<CLAUDE_CONFIG_DIR or ~/.claude>/.config.json` when it exists, else `<CLAUDE_CONFIG_DIR or ~>/.claude<suffix>.json`,
 * the suffix `-custom-oauth` under CLAUDE_CODE_CUSTOM_OAUTH_URL.
 */
export function configFilePath(env, exists = existsSync) {
  const home = env.HOME || homedir();
  const legacy = join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), '.config.json');
  if (exists(legacy)) return legacy;
  return join(env.CLAUDE_CONFIG_DIR || home, `.claude${env.CLAUDE_CODE_CUSTOM_OAUTH_URL ? '-custom-oauth' : ''}.json`);
}

/** The project paths the engine's global config records as trusted: path strings alone, nothing else of the file. Read
 * under this shell's environment: mawsd's engine reads it under the unit's, which a needs_trust answer names. */
function listTrusted() {
  const config = configFilePath(process.env);
  let projects;
  try {
    projects = JSON.parse(readFileSync(config, 'utf8'))?.projects;
  } catch {
    say(`FAIL unread: ${tilde(config)}`);
    process.exitCode = 1;
    return;
  }
  say(`trusted project paths in ${tilde(config)}:`);
  const trusted = Object.entries(projects && typeof projects === 'object' ? projects : {}).filter(([, v]) => v?.hasTrustDialogAccepted === true);
  for (const [path] of trusted) say(path);
  if (trusted.length === 0) say('(none)');
}

async function main(argv) {
  if (argv[0] === '--list-trusted') return listTrusted();
  const [directory] = argv;
  const at = argv.indexOf('--title');
  const title = at > 0 ? argv[at + 1] : TITLE;
  if (!directory || directory.startsWith('--') || !title) throw new Error('o15-tools.mjs <directory> [--title <name>]');
  const profile = process.env.MAWS_USER_DATA || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'MAWS');
  const link = await reach(join(profile, 'mawsd'));
  const verdicts = [];
  const report = () => {
    for (const [ok, line] of verdicts) say(`${ok ? 'PASS' : 'FAIL'} ${line}`);
  };
  // An INT or TERM: the same bounded end of the session (a pending start's 30 s, a stop's 60 s, the watch's 30 s), then
  // a non-zero exit; before session.create answered there is no session to end.
  let stop = null;
  const interrupted = async (signal) => {
    say(`${now()} ${signal}: ending the session`);
    const bound = sleep(150_000).then(() => verdicts.push([false, 'the session’s end did not settle within 150 s: stop it by hand']));
    await Promise.race([stop?.() ?? Promise.resolve(), bound]);
    verdicts.push([false, `interrupted by ${signal}`]);
    link.close();
    report();
    process.exit(1);
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void interrupted(signal));
  try {
    await link.request('daemon.status', undefined); // wakes the parked engine host
    await run(link, profile, resolve(directory), title, verdicts, (end) => (stop = end));
  } catch (error) {
    verdicts.push([false, error instanceof Error ? error.message : String(error)]);
  } finally {
    link.close();
  }
  report();
  if (verdicts.some(([ok]) => !ok)) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.log(`FAIL o15-tools: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
