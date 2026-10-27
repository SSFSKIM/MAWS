// The local-latency bench's engine (P5 O1, M1; e2e/local-latency.spec.ts): a real child process MAWS's engine host
// launches as a live session's engine through MAWS_E2E_ENGINE_BIN, by way of the wrapper test/support/latency-engine.ts
// writes, which names this Node, the samples file and MAWS_LATENCY_STUB_VERSION. It is a process, not the replay
// transport, so the bench crosses the engine's pipe, the stretch O16's session host will sit on.
//
//   latency-engine-stub.mjs <samples.jsonl> [engine arguments…]
//
// `--version` answers the pinned version. Otherwise it reads stream-json on stdin and answers each `control_request`
// from CONTROLS, the engine's recorded answer for that subtype with the host's own request_id. CONTROLS holds what
// `Session` sends from launch to ready for the bench's launch (src/engine-host/session.ts: initialize; then
// set_max_thinking_tokens; the gateway check's get_status; ready's get_context_usage; no auto-mode fallback, grant
// reapply or surface attach for a `default`-mode direct launch with no resume, whose initialize answer advertises no
// surface), what it sends after each human turn (get_status, get_context_usage), and the other reads
// spikes/protocol-probe/fixtures/reads.jsonl recorded. A subtype it does not hold is one stderr line and exit 70, so a
// missing answer is a launch failure, not a hang. `end_session` ends the process, as the engine's answer to it is its
// exit; so does stdin's end.
//
// Each `user` message is one successful text turn, TURN's rows of queue-and-interrupt.jsonl with its recorded deltas
// replaced: 300 `content_block_delta` text deltas, one every 10 ms, the k-th carrying `⟦t<turn>:<k>⟧ `, and the
// completed `assistant` frame's text (and the result's) the concatenation of those 300, since the renderer replaces the
// streamed buffer with the completed block. The recorded user uuid becomes the host's, the recorded session id the
// launch's `--session-id`, the recorded cwd the process's, and every other recorded identity (frame uuids, the message
// id, the request id) a fresh one per turn, as the replay transport maps ids (src/engine-host/replay-transport.ts). Just
// before each delta is written it reads `performance.timeOrigin + performance.now()`, and appends `{turn, k, writtenAt}`
// to the samples file once the delta is on its way.
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';

const MARKERS_PER_TURN = 300;
const PACE_MS = 10;
const marker = (turn, k) => `⟦t${turn}:${k}⟧ `;

const [samplesPath, ...args] = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  if (!process.env.MAWS_LATENCY_STUB_VERSION) {
    process.stderr.write('latency engine stub: no MAWS_LATENCY_STUB_VERSION\n');
    process.exit(64);
  }
  process.stdout.write(`${process.env.MAWS_LATENCY_STUB_VERSION} (Claude Code)\n`);
  process.exit(0);
}
if (!samplesPath) {
  process.stderr.write('latency engine stub: no samples file\n');
  process.exit(64);
}

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../spikes/protocol-probe/fixtures');
const journals = new Map();
const rowsOf = (fixture) => {
  if (!journals.has(fixture)) journals.set(fixture, readFileSync(join(FIXTURES, fixture), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)));
  return journals.get(fixture);
};
const rowAt = (fixture, seq) => {
  const row = rowsOf(fixture).find((r) => r.seq === seq);
  if (!row) throw new Error(`${fixture} has no seq ${seq}`);
  return row;
};

// Each subtype's answer: the fixture and the seq of the recorded request, whose success response is played.
const CONTROLS = {
  initialize: ['init.jsonl', 50], // no `capabilities`, so no surface attach; current_permission_mode default
  set_max_thinking_tokens: ['p4/p4-tool-summaries-thinking-edits.jsonl', 100], // Session always sends it after initialize
  get_status: ['pass2/auto-unrouted.jsonl', 56], // a direct launch's: no Anthropic base URL row, so the check reads `direct`
  get_context_usage: ['reads.jsonl', 56],
  get_usage: ['reads.jsonl', 52],
  get_settings: ['reads.jsonl', 59],
  list_permission_rules: ['reads.jsonl', 62],
  get_hooks_listing: ['reads.jsonl', 65],
  get_memory_dialog: ['reads.jsonl', 68],
  get_skills_dialog: ['reads.jsonl', 71],
  get_sandbox_dialog: ['reads.jsonl', 74],
  get_workspace_diff: ['reads.jsonl', 80],
  export_conversation: ['reads.jsonl', 83],
};
const answers = new Map(Object.entries(CONTROLS).map(([subtype, [fixture, seq]]) => {
  const request = rowAt(fixture, seq).frame;
  if (request.type !== 'control_request' || request.request.subtype !== subtype) throw new Error(`${fixture} seq ${seq} is not a ${subtype} request`);
  const response = rowsOf(fixture).find((r) => r.direction === 'in' && r.frame.type === 'control_response' && r.frame.response.request_id === request.request_id);
  if (!response || response.frame.response.subtype !== 'success') throw new Error(`${fixture} records no success answer to seq ${seq}`);
  return [subtype, response.frame.response];
}));

// One text turn of queue-and-interrupt.jsonl (seq 199 is its prompt): queued, started, init, status, the user echo,
// message_start, the text block (its recorded delta at 227 replaced; the thinking block at 207-225 left out, so the text
// block's index 1 becomes 0), the assistant frame, the block's stop, message_delta, message_stop, the result and the
// prompt's completed lifecycle.
const TURN_FIXTURE = 'queue-and-interrupt.jsonl';
const TURN = { prompt: 199, before: [201, 202, 203, 204, 205, 206, 226], delta: 227, after: [228, 229, 230, 231, 232, 234] };
const recordedPrompt = rowAt(TURN_FIXTURE, TURN.prompt).frame;
const clone = (value) => JSON.parse(JSON.stringify(value));
const turnRows = (seqs) => seqs.map((seq) => clone(rowAt(TURN_FIXTURE, seq).frame));
const recordedSession = rowAt(TURN_FIXTURE, TURN.before[0]).frame.session_id;

// The launch's session id: the pinned `--session-id`, else a resume's.
const argOf = (flag) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
};
const sessionId = argOf('--session-id') ?? argOf('--resume') ?? recordedSession;

function rewrite(value, ids) {
  if (typeof value === 'string') return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((entry) => rewrite(entry, ids));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewrite(entry, ids)]));
  return value;
}

const write = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`);
const now = () => performance.timeOrigin + performance.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

let turns = 0;
async function playTurn(user) {
  const turn = ++turns;
  const before = turnRows(TURN.before);
  const after = turnRows(TURN.after);
  const deltaTemplate = clone(rowAt(TURN_FIXTURE, TURN.delta).frame);
  // The recorded identities of this turn, each mapped to the host's or a fresh one.
  const ids = new Map([[recordedPrompt.uuid, user.uuid], [recordedSession, sessionId]]);
  for (const frame of [...before, ...after, deltaTemplate]) {
    if (typeof frame.uuid === 'string' && frame.uuid !== recordedPrompt.uuid) ids.set(frame.uuid, randomUUID());
    if (typeof frame.request_id === 'string') ids.set(frame.request_id, `req_bench${randomUUID().replaceAll('-', '')}`);
    const message = frame.message ?? frame.event?.message;
    if (typeof message?.id === 'string') ids.set(message.id, `msg_bench${randomUUID().replaceAll('-', '')}`);
  }
  const text = Array.from({ length: MARKERS_PER_TURN }, (_, k) => marker(turn, k + 1)).join('');
  const stamp = new Date().toISOString();
  const finish = (frame) => {
    const out = rewrite(frame, ids);
    if (typeof out.timestamp === 'string') out.timestamp = stamp;
    if (out.type === 'system' && out.subtype === 'init') out.cwd = process.cwd();
    if (out.type === 'user') out.message = user.message; // the echo of what the host wrote
    if (out.type === 'stream_event' && typeof out.event.index === 'number') out.event.index = 0;
    if (out.type === 'assistant') out.message.content = [{ type: 'text', text }];
    if (out.type === 'result') out.result = text;
    return out;
  };
  for (const frame of before) write(finish(frame));
  const start = performance.now();
  for (let k = 1; k <= MARKERS_PER_TURN; k += 1) {
    await sleep(start + (k - 1) * PACE_MS - performance.now());
    const delta = finish({ ...deltaTemplate, uuid: randomUUID(), event: { ...deltaTemplate.event, delta: { type: 'text_delta', text: marker(turn, k) } } });
    const writtenAt = now();
    write(delta);
    appendFileSync(samplesPath, `${JSON.stringify({ turn, k, writtenAt })}\n`);
  }
  for (const frame of after) write(finish(frame));
}

// Turns play one after another, in the order their prompts arrived.
let playing = Promise.resolve();
function onFrame(frame) {
  if (frame.type === 'control_request') {
    const subtype = frame.request?.subtype;
    if (subtype === 'end_session') process.exit(0);
    const answer = answers.get(subtype);
    if (!answer) {
      process.stderr.write(`latency engine stub: no recorded answer for control_request ${subtype}\n`);
      process.exit(70);
    }
    write({ type: 'control_response', response: { ...answer, request_id: frame.request_id } });
    return;
  }
  if (frame.type === 'user') playing = playing.then(() => playTurn(frame));
  // anything else the host writes (an answer, a cancel) needs nothing from this engine
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
    const line = buffer.slice(0, at).trim();
    buffer = buffer.slice(at + 1);
    if (line) onFrame(JSON.parse(line));
  }
});
process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
