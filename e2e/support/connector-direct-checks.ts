// P3-HD M4b: the pure checks route D's integrated scenes (e2e/connectors-direct.spec.ts, e2e/connectors-oauth.spec.ts) rest on, free of Playwright
// so test/support/connector-direct-checks.test.ts runs them under vitest. docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md,
// acceptance 1-6 and Decision Log 23, 25 and 28:
// - `custodyProblems`: the launch's mock keychain and canonical scratch profile, checked before any owner action (the
//   product's own guard, src/main/connectors/oauth-root.ts, stands before every real safeStorage call);
// - `addedListeners` / `loopbackPort`: the callback listener a Connect binds, exactly 127.0.0.1;
// - `readSealedText` / `plaintextHits`: a sealed OAuth record's format and that no known value is readable in it;
// - `journalTurns`: launches, and that no model turn ran, from a session's journal rows;
// - `journalFrameShapes` / `blankResumeStartupRejection`: the frames of a journal as safe shapes, and the one inbound
//   error result (no turn, cost or usage) the transition scene lets the old session's refused resume have (Decision Log 42);
// - `isBlankResume`: the one failed acquire (a transcript-less resume) the transition scene documents and goes around;
// - `scrubDiagnostic` / `boundedAcquire` / `boundedMetaRows`: a failed launch's evidence, an acquire's answer and a
//   journal's meta rows reduced to allowlisted, scrubbed, size-bounded fields (never args, environment or raw frames);
// - `isRetainedScratch`: which scratch files a scene scans for secrets (never the host token, the raw open log, a
//   fixture's secrets inventory or a sealed record, which is scanned apart);
// - `bearerCrossings`: a bearer presented to a server that did not issue it;
// - `pageVariant` / `oncePageHtml`: H's page re-pointed at another server, and a page that calls once per click;
// - `heldFate`: whether one held call was answered late by its instance, or its instance was torn down first;
// - `attachIfClean`: a screenshot captured and attached only after the live documents scanned clean;
// - `scanScratchTree`: every retainable scratch file read whole in bounded chunks, every unreadable one a failure;
// - `shellQuoted` (P3-HD panel correction): a value as one literal /bin/sh word, for a generated launcher script.
import { closeSync, lstatSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { JournalReader } from '../../src/engine-host/journal';

export interface CustodyFacts {
  mockKeychain: boolean; // main's `use-mock-keychain` switch
  userData: string | null; // main's userData, canonical; null when it would not resolve
  scratch: string | null; // the profile the harness named main (MAWS_USER_DATA), canonical
  expected: string | null; // the scene's own profile, canonical
  tmp: string | null; // the OS temporary directory, canonical
}
export type CustodyProblem = 'mockKeychain' | 'userData' | 'profile' | 'scratch' | 'notTemporary';

export function custodyProblems(facts: CustodyFacts): CustodyProblem[] {
  const problems: CustodyProblem[] = [];
  const { userData, scratch, expected, tmp } = facts;
  if (!facts.mockKeychain) problems.push('mockKeychain');
  if (userData === null) problems.push('userData');
  if (userData === null || expected === null || userData !== expected) problems.push('profile');
  if (scratch === null || expected === null || scratch !== expected) problems.push('scratch');
  const under = tmp === null ? null : tmp.endsWith('/') ? tmp : `${tmp}/`;
  if (userData === null || under === null || !userData.startsWith(under)) problems.push('notTemporary');
  return problems;
}

// What `after` lists that `before` did not, each once, in order.
export function addedListeners(before: readonly string[], after: readonly string[]): string[] {
  const known = new Set(before);
  return [...new Set(after)].filter((address) => !known.has(address));
}

// The port of an exact `127.0.0.1:<port>` listener address (lsof's spelling), else null.
export function loopbackPort(address: string): number | null {
  const match = /^127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(address);
  if (!match) return null;
  const port = Number(match[1]);
  return port <= 65_535 ? port : null;
}

export const SEALED_FORMAT = 'maws-connector-oauth/1'; // src/main/connectors/oauth-store.ts FORMAT

// A sealed record's text: its format line, then one canonical base64 line of ciphertext, then nothing.
export function readSealedText(text: string): { ok: true; ciphertext: Buffer } | { ok: false; why: 'format' | 'body' } {
  const lines = text.split('\n');
  if (lines[0] !== SEALED_FORMAT) return { ok: false, why: 'format' };
  const body = lines[1] ?? '';
  if (lines.length !== 3 || lines[2] !== '' || body === '' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return { ok: false, why: 'body' };
  const ciphertext = Buffer.from(body, 'base64');
  if (ciphertext.toString('base64') !== body) return { ok: false, why: 'body' };
  return { ok: true, ciphertext };
}

// The indexes of the non-empty `needles` readable in `bytes`, as UTF-8 or as Latin-1: never the values themselves.
export function plaintextHits(bytes: Buffer, needles: readonly string[]): number[] {
  const utf8 = bytes.toString('utf8');
  const latin1 = bytes.toString('latin1');
  return needles.flatMap((needle, index) => (needle !== '' && (utf8.includes(needle) || latin1.includes(needle)) ? [index] : []));
}

export interface JournalTurns {
  spawns: number;
  exits: number;
  userFrames: number; // user messages written to the engine
  modelFrames: number; // assistant, result and stream frames read from it: any one is a model turn
  needsAuth: number; // frames from the engine reporting a server as needs-auth
}
const MODEL_FRAMES = new Set(['assistant', 'result', 'stream_event']);
const typeOf = (frame: unknown) => (frame !== null && typeof frame === 'object' ? (frame as { type?: unknown }).type : undefined);

export function journalTurns(rows: readonly { direction: string; frame: unknown }[]): JournalTurns {
  const turns: JournalTurns = { spawns: 0, exits: 0, userFrames: 0, modelFrames: 0, needsAuth: 0 };
  for (const { direction, frame } of rows) {
    if (direction === 'meta') {
      const event = frame !== null && typeof frame === 'object' ? (frame as { event?: unknown }).event : undefined;
      if (event === 'spawn') turns.spawns += 1;
      if (event === 'exit') turns.exits += 1;
    } else if (direction === 'out') {
      if (typeOf(frame) === 'user') turns.userFrames += 1;
    } else if (direction === 'in') {
      if (MODEL_FRAMES.has(typeOf(frame) as string)) turns.modelFrames += 1;
      if (JSON.stringify(frame).includes('"needs-auth"')) turns.needsAuth += 1;
    }
  }
  return turns;
}

// A diagnostic string safe to print: the scene's paths and the owner's home named by role, any other user's home
// anonymized, token-like runs removed, and at most `max` characters.
export function scrubDiagnostic(text: string, roots: readonly string[], max: number): string {
  let out = text;
  for (const root of [...roots].filter((path) => path.length > 3).sort((a, b) => b.length - a.length)) out = out.split(root).join('<scratch>');
  const home = homedir();
  if (home.length > 3) out = out.split(home).join('<home>');
  out = out.replace(/\/Users\/[^/\s]+/g, '/Users/<user>').replace(/[A-Za-z0-9_-]{40,}/g, '<redacted>');
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

const text = (value: unknown, roots: readonly string[], max: number): string | undefined => (typeof value === 'string' ? scrubDiagnostic(value, roots, max) : undefined);

// What a `session.acquire` answer shows of itself: its status, flags, scrubbed message and the three resource states.
// Any other key is named, never copied.
export function boundedAcquire(outcome: unknown, roots: readonly string[]): Record<string, unknown> {
  if (outcome === null || typeof outcome !== 'object') return { notAnObject: outcome === null ? 'null' : typeof outcome };
  const answer = outcome as Record<string, unknown>;
  const known = new Set(['status', 'appSessionId', 'launched', 'joined', 'message', 'resources']);
  const bounded: Record<string, unknown> = {};
  const status = text(answer.status, roots, 40);
  if (status !== undefined) bounded.status = status;
  const id = text(answer.appSessionId, roots, 80);
  if (id !== undefined) bounded.appSessionId = id;
  for (const flag of ['launched', 'joined'] as const) if (typeof answer[flag] === 'boolean') bounded[flag] = answer[flag];
  const message = text(answer.message, roots, 1000);
  if (message !== undefined) bounded.message = message;
  if (answer.resources !== null && typeof answer.resources === 'object') {
    const resources = answer.resources as Record<string, unknown>;
    const worktree = resources.worktree !== null && typeof resources.worktree === 'object' ? (resources.worktree as Record<string, unknown>) : null;
    bounded.resources = { worktree: worktree === null ? null : { state: text(worktree.state, roots, 40) ?? null }, record: text(resources.record, roots, 40) ?? null, transcript: text(resources.transcript, roots, 40) ?? null };
  }
  const other = Object.keys(answer).filter((key) => !known.has(key)).slice(0, 12).map((key) => scrubDiagnostic(key, roots, 40));
  if (other.length > 0) bounded.otherKeys = other;
  return bounded;
}

const META_ROWS_MAX = 64;
const META_STRINGS = { event: 80, phase: 40, reason: 200, trigger: 40, message: 1000 } as const;
const META_SCALARS = ['code', 'signal', 'attempt', 'maxAttempts', 'pid'] as const;

// A journal's meta rows (spawn, init_failed, reconnect, exit …) as allowlisted scalar fields: the first 64 in order, the
// rest counted. A spawn's argument list is its length alone; no environment, frame or other row direction is read.
export function boundedMetaRows(rows: readonly { direction: string; frame: unknown }[], roots: readonly string[]): { rows: Record<string, unknown>[]; omitted: number } {
  const meta = rows.filter((row) => row.direction === 'meta' && row.frame !== null && typeof row.frame === 'object');
  const bounded = meta.slice(0, META_ROWS_MAX).map(({ frame }) => {
    const source = frame as Record<string, unknown>;
    const row: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      const value = source[key];
      if (key in META_STRINGS) {
        const scrubbed = text(value, roots, META_STRINGS[key as keyof typeof META_STRINGS]);
        if (scrubbed !== undefined) row[key] = scrubbed;
      } else if ((META_SCALARS as readonly string[]).includes(key)) {
        if (value === null || typeof value === 'number' || typeof value === 'boolean') row[key] = value;
        else if (typeof value === 'string') row[key] = scrubDiagnostic(value, roots, 80);
      } else if (key === 'args' && Array.isArray(value)) row.argCount = value.length;
    }
    return row;
  });
  return { rows: bounded, omitted: Math.max(0, meta.length - META_ROWS_MAX) };
}

// P3-HD Decision Log 40: the engine's refusal of `--resume` for a session that never wrote a transcript (the owner's
// no-message Start wrote none), the existing sessions debt the scene documents rather than repairs.
export const BLANK_RESUME_REFUSAL = 'No conversation found with session ID';

// Whether a `session.acquire` answer is that documented failure, positively: the failed answer's own message and its
// resources (the session has no transcript) and the launch's init_failed journal row (bounded meta rows) all say it.
// Anything else, a ready answer included, is not.
export function isBlankResume(acquire: unknown, metaRows: readonly Record<string, unknown>[]): boolean {
  if (acquire === null || typeof acquire !== 'object') return false;
  const { status, message, resources } = acquire as { status?: unknown; message?: unknown; resources?: unknown };
  const transcript = resources !== null && typeof resources === 'object' ? (resources as { transcript?: unknown }).transcript : undefined;
  if (status !== 'failed' || transcript !== 'none' || typeof message !== 'string' || !message.includes(BLANK_RESUME_REFUSAL)) return false;
  return metaRows.some((row) => row.event === 'init_failed' && typeof row.message === 'string' && row.message.includes(BLANK_RESUME_REFUSAL));
}

// P3-HD Decision Log 42. The fields of a frame reduced to a shape: numbers, booleans and null as they are, a string as
// '<string>', an array as '<array:n>', an object as its first 16 keys' shapes to depth 3; an absent field as '<absent>'.
// Nothing a frame carries as text, arguments, environment or credentials survives.
function shapeOf(value: unknown, depth = 0): unknown {
  if (value === undefined) return '<absent>';
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return '<string>';
  if (Array.isArray(value)) return `<array:${value.length}>`;
  if (typeof value !== 'object') return `<${typeof value}>`;
  if (depth >= 3) return '<object>';
  return Object.fromEntries(Object.entries(value).slice(0, 16).map(([key, inner]) => [key.slice(0, 40), shapeOf(inner, depth + 1)]));
}

// The `usage` of the refused resume's result as run 39077555852 observed it (Decision Log 43): nothing else is admitted.
// Four API token counters, required and exactly 0; optional nested counters, each key known and exactly 0; the
// descriptive root strings `service_tier`, `inference_geo` and `speed`; an empty `iterations` list; a null
// `fallback_credit`. A null counter, an unknown key (root or nested), a string where a number belongs, a nonempty list or
// a positive number anywhere fails.
const USAGE_CORE = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'] as const;
const USAGE_NESTED: Record<string, readonly string[]> = {
  output_tokens_details: ['thinking_tokens'],
  server_tool_use: ['web_search_requests', 'web_fetch_requests'],
  cache_creation: ['ephemeral_1h_input_tokens', 'ephemeral_5m_input_tokens'],
};
const USAGE_STRINGS = ['service_tier', 'inference_geo', 'speed'] as const;
const isPlainObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function observedZeroUsage(usage: unknown): boolean {
  if (!isPlainObject(usage)) return false;
  for (const key of Object.keys(usage)) {
    const value = usage[key];
    if ((USAGE_CORE as readonly string[]).includes(key)) {
      if (value !== 0) return false;
    } else if (key in USAGE_NESTED) {
      if (!isPlainObject(value) || Object.keys(value).some((inner) => !USAGE_NESTED[key]!.includes(inner) || value[inner] !== 0)) return false;
    } else if ((USAGE_STRINGS as readonly string[]).includes(key)) {
      if (typeof value !== 'string') return false;
    } else if (key === 'iterations') {
      if (!Array.isArray(value) || value.length !== 0) return false;
    } else if (key === 'fallback_credit') {
      if (value !== null) return false;
    } else return false;
  }
  return USAGE_CORE.every((counter) => usage[counter] === 0);
}

const NO_CONVERSATION = /no\s+conversation\s+found/i; // the engine’s refusal text, as it is written

export interface ResultProjection {
  spawn: number; // the launch (1-based, by spawn rows before it) the frame arrived in; 0 before any
  direction: string;
  subtype: string | null;
  isError: unknown;
  numTurns: unknown;
  totalCostUsd: unknown;
  usage: unknown;
  modelUsage: unknown;
  errorMatch: boolean; // whether the engine's text names a missing conversation (the text itself is never kept)
  keys: string[];
}
export interface FrameShapes {
  counts: Record<string, number>; // `direction:type` for each typed frame row: at most 24 buckets, the first seen
  otherFrames: number; // typed frames beyond those buckets
  results: ResultProjection[]; // the first 8 results
  resultsTotal: number;
}
const SHAPE_BUCKETS_MAX = 24;
const SHAPE_RESULTS_MAX = 8;
interface ProjectedRow {
  spawn: number;
  direction: string;
  frame: Record<string, unknown>;
}

const projectRows = (rows: readonly { direction: string; frame: unknown }[]): ProjectedRow[] => {
  let spawn = 0;
  const projected: ProjectedRow[] = [];
  for (const { direction, frame } of rows) {
    if (frame === null || typeof frame !== 'object' || Array.isArray(frame)) continue;
    const record = frame as Record<string, unknown>;
    if (direction === 'meta' && record.event === 'spawn') spawn += 1;
    projected.push({ spawn, direction, frame: record });
  }
  return projected;
};

const errorMatches = (frame: Record<string, unknown>): boolean =>
  [frame.result, frame.error, ...(Array.isArray(frame.errors) ? frame.errors : [])].some((text) => typeof text === 'string' && NO_CONVERSATION.test(text));

// What a journal's frames show of themselves, in safe fields only, in the journal's own order (read it with
// readJournalRows), bounded: a sample of the results and a capped set of type buckets, each with its total.
export function journalFrameShapes(rows: readonly { direction: string; frame: unknown }[]): FrameShapes {
  const counts: Record<string, number> = {};
  const results: ResultProjection[] = [];
  let otherFrames = 0;
  let resultsTotal = 0;
  for (const { spawn, direction, frame } of projectRows(rows)) {
    if (direction === 'meta' || typeof frame.type !== 'string') continue;
    const key = `${direction}:${frame.type.slice(0, 40)}`;
    if (key in counts) counts[key] = counts[key]! + 1;
    else if (Object.keys(counts).length < SHAPE_BUCKETS_MAX) counts[key] = 1;
    else otherFrames += 1;
    if (frame.type !== 'result') continue;
    resultsTotal += 1;
    if (results.length >= SHAPE_RESULTS_MAX) continue;
    results.push({
      spawn,
      direction,
      subtype: typeof frame.subtype === 'string' ? frame.subtype.slice(0, 60) : null,
      isError: shapeOf(frame.is_error),
      numTurns: shapeOf(frame.num_turns),
      totalCostUsd: shapeOf(frame.total_cost_usd),
      usage: shapeOf(frame.usage),
      modelUsage: shapeOf(frame.modelUsage),
      errorMatch: errorMatches(frame),
      keys: Object.keys(frame).slice(0, 24).map((name) => name.slice(0, 40)),
    });
  }
  return { counts, otherFrames, results, resultsTotal };
}

// The assistant, stream and user frames of a journal, either direction: none is allowed in any session of the
// transition scene (a result alone may be, by blankResumeStartupRejection, in one).
export function forbiddenFrames(rows: readonly { direction: string; frame: unknown }[]): { assistant: number; streamEvent: number; user: number } {
  const counts = { assistant: 0, streamEvent: 0, user: 0 };
  for (const { direction, frame } of projectRows(rows)) {
    if (direction === 'meta') continue;
    if (frame.type === 'assistant') counts.assistant += 1;
    else if (frame.type === 'stream_event') counts.streamEvent += 1;
    else if (frame.type === 'user') counts.user += 1;
  }
  return counts;
}

// A session directory's journal files in the host's own launch order (JournalReader: launches by their first row's time,
// a launch's rotations numerically), and their complete rows in that order. Scratch only.
export const journalFilesOf = (dir: string): string[] => JournalReader.forSession(dir);
export function readJournalRows(dir: string): { direction: string; frame: unknown }[] {
  return journalFilesOf(dir).flatMap((file) => readFileSync(file, 'utf8').split('\n').slice(0, -1).filter(Boolean).map((line) => JSON.parse(line) as { direction: string; frame: unknown }));
}

// The one inbound frame an engine's refused resume may leave without being a model turn (Decision Logs 42 and 43):
// exactly one `result` in the journal, inbound, in the second launch, an error whose result/error text is the engine's
// missing-conversation refusal, with explicit zero turns and cost, the observed all-zero `usage` (observedZeroUsage),
// an empty `modelUsage`, the same launch's init_failed row, and no assistant, stream or user frame anywhere. `failures`
// names each unmet condition by a closed word.
export function blankResumeStartupRejection(rows: readonly { direction: string; frame: unknown }[]): { ok: boolean; failures: string[]; result: ResultProjection | null } {
  const failures: string[] = [];
  const projected = projectRows(rows);
  const results = projected.filter(({ frame }) => frame.type === 'result');
  const forbidden = forbiddenFrames(rows);
  if (forbidden.assistant + forbidden.streamEvent > 0) failures.push('modelFrames');
  if (forbidden.user > 0) failures.push('userFrames');
  if (!projected.some(({ spawn, direction, frame }) => spawn === 2 && direction === 'meta' && frame.event === 'init_failed')) failures.push('initFailed');
  if (results.length !== 1) failures.push('results');
  else {
    const { spawn, direction, frame } = results[0]!;
    const usage = frame.usage;
    if (spawn !== 2) failures.push('spawn');
    if (direction !== 'in') failures.push('direction');
    if (frame.is_error !== true) failures.push('isError');
    if (!errorMatches(frame)) failures.push('errorMatch');
    if (frame.num_turns !== 0) failures.push('numTurns');
    if (frame.total_cost_usd !== 0) failures.push('totalCostUsd');
    if (!observedZeroUsage(usage)) failures.push('usage');
    if (!isPlainObject(frame.modelUsage) || Object.keys(frame.modelUsage).length !== 0) failures.push('modelUsage'); // present and empty: no model ran
  }
  return { ok: failures.length === 0, failures, result: journalFrameShapes(rows).results[0] ?? null };
}

// A scratch path (relative to the scene's root, `/`-separated) a scene may read and scan as retainable.
export function isRetainedScratch(relative: string): boolean {
  if (relative === 'ud/supervisor/host.token' || relative === 'open.log') return false;
  if (/^oauth-[^/]+-secrets\.jsonl$/.test(relative)) return false;
  if (/^ud\/connectors\/oauth\/[^/]+\.sealed$/.test(relative)) return false;
  return true;
}

export interface ServerTokens {
  name: string;
  issued: readonly string[]; // hashes of the access tokens this server minted
  presented: readonly string[]; // hashes of the Bearer values its MCP requests presented
}

// Every presented bearer a server did not issue: where, and which server issued it (null: none of them).
export function bearerCrossings(servers: readonly ServerTokens[]): { at: string; issuedBy: string | null }[] {
  return servers.flatMap((server) =>
    server.presented.filter((hash) => !server.issued.includes(hash)).map((hash) => ({ at: server.name, issuedBy: servers.find((other) => other.issued.includes(hash))?.name ?? null })),
  );
}

const replaceOnce = (text: string, from: string, to: string): string => {
  const parts = text.split(from);
  if (parts.length !== 2) throw new Error(`pageVariant: \`${from}\` is not in the page exactly once`);
  return parts.join(to);
};

// H's page (support/connector-scene.ts PAGE_HTML) under another title and for another server, its tool and watch the same.
export function pageVariant(html: string, to: { server: string; title: string }, from: { server: string; title: string } = { server: 'fixture', title: 'Signups, live' }): string {
  let page = replaceOnce(html, `<title>${from.title}</title>`, `<title>${to.title}</title>`);
  page = replaceOnce(page, `<h1>${from.title}</h1>`, `<h1>${to.title}</h1>`);
  return replaceOnce(page, `server: ${JSON.stringify(from.server)}`, `server: ${JSON.stringify(to.server)}`);
}

const scriptString = (value: string) => JSON.stringify(value).replaceAll('</', '<\\/');

// A page that declares one tool and calls it once per click of `#call` (no watch), writing each outcome as H's page
// does: `#last` the latest (`ok n=<k> via=<route>` or `<state>:<reason>`), `#updates` how many arrived.
export function oncePageHtml(options: { server: string; tool: string; title: string }): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${options.title}</title></head>
<body>
<h1>${options.title}</h1>
<p id="declared">declaring</p>
<button id="call" type="button">Read once</button>
<p id="last">none</p>
<p id="updates">0</p>
<script>
const tool = { server: ${scriptString(options.server)}, tool: ${scriptString(options.tool)} };
let updates = 0;
const show = (o) => {
  updates += 1;
  document.getElementById('updates').textContent = String(updates);
  const n = o.ok && o.result && o.result.structuredContent ? o.result.structuredContent.n : null;
  document.getElementById('last').textContent = o.ok ? 'ok n=' + n + ' via=' + o.via.route : o.state + ':' + o.reason;
};
(async () => {
  const declared = await mawsConnectors.declare([tool]);
  document.getElementById('declared').textContent = declared.ok ? 'declared' : declared.state + ':' + declared.reason;
})();
document.getElementById('call').addEventListener('click', async () => show(await mawsConnectors.call({ ...tool, args: { series: 'signups' } })));
</script>
</body></html>
`;
}

// What became of one held tools/call (its instance's pid, its JSON-RPC id) once its hold was lifted: `released` when that
// instance logged releasing that call (support/connector-mcp-server.mjs `--hold`, just before it writes the answer),
// `teardown` when the instance is gone without having done so, `pending` while it lives and has not: a release that
// never comes from a live instance is never taken for either.
export function heldFate(entries: readonly { pid: number; event?: unknown; rpcId?: unknown }[], held: { pid: number; rpcId: unknown }, alive: boolean): 'released' | 'teardown' | 'pending' {
  if (entries.some((entry) => entry.event === 'released' && entry.pid === held.pid && entry.rpcId === held.rpcId)) return 'released';
  return alive ? 'pending' : 'teardown';
}

// A screenshot taken and attached only after every live document was read and none carries a secret. A failed read,
// no documents or an empty one certifies nothing; a finding is reported by kind and count, never by value.
export async function attachIfClean(deps: {
  read(): Promise<readonly string[]>;
  scan(texts: readonly string[]): Partial<Record<string, number>>;
  capture(): Promise<Buffer>;
  attach(body: Buffer): Promise<void>;
}): Promise<{ documents: number }> {
  const texts = await deps.read();
  if (texts.length === 0 || texts.some((text) => text.length === 0)) throw new Error('attachIfClean: a live document read empty, so the screenshot cannot be certified');
  const found = Object.entries(deps.scan(texts)).filter(([, count]) => (count ?? 0) > 0);
  if (found.length > 0) throw new Error(`attachIfClean: the live documents carry fixture secrets (${found.map(([kind, count]) => `${kind}: ${count}`).join(', ')}); no screenshot taken`);
  await deps.attach(await deps.capture());
  return { documents: texts.length };
}

export interface ScratchFs {
  readdir(dir: string): string[];
  lstat(path: string): { kind: 'dir' | 'file' | 'other' };
  read(path: string, position: number, length: number): Buffer; // up to `length` bytes at `position`; empty at the end
}
export const nodeScratchFs: ScratchFs = {
  readdir: (dir) => readdirSync(dir),
  lstat(path) {
    const info = lstatSync(path);
    return { kind: info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other' };
  },
  read(path, position, length) {
    const fd = openSync(path, 'r');
    try {
      const buffer = Buffer.alloc(length);
      return buffer.subarray(0, readSync(fd, buffer, 0, length, position));
    } finally {
      closeSync(fd);
    }
  },
};

export interface ScratchScan {
  files: number; // read whole
  bytes: number;
  gone: string[]; // removed between listing and reading (ENOENT): not read, not a failure
  failures: { path: string; code: string }[]; // anything else that kept a retainable path from being read: a coverage gap
  dirty: string[]; // read, and not clean
}

// Every regular file under `root` that `include` admits (relative, `/`-separated), read as Latin-1 in chunks of at most
// `chunkBytes`, each checked with the previous `overlapBytes` before it so a value across a boundary is still seen.
// Symlinks and other non-regular entries are not followed. Paths and error codes only, never contents.
export function scanScratchTree(
  root: string,
  clean: (text: string) => boolean,
  options: { fs?: ScratchFs; chunkBytes?: number; overlapBytes?: number; include?: (relative: string) => boolean } = {},
): ScratchScan {
  const fs = options.fs ?? nodeScratchFs;
  const chunkBytes = options.chunkBytes ?? 8 * 1024 * 1024;
  const overlapBytes = options.overlapBytes ?? 64 * 1024;
  const include = options.include ?? isRetainedScratch;
  const scan: ScratchScan = { files: 0, bytes: 0, gone: [], failures: [], dirty: [] };
  const missed = (relative: string, error: unknown, isRoot = false) => {
    const code = (error as NodeJS.ErrnoException | undefined)?.code ?? 'error';
    if (code === 'ENOENT' && !isRoot) scan.gone.push(relative);
    else scan.failures.push({ path: relative, code });
  };
  const readWhole = (path: string, relative: string) => {
    let carry = Buffer.alloc(0);
    let bytes = 0;
    let dirty = false;
    for (let position = 0; ; ) {
      const chunk = fs.read(path, position, chunkBytes);
      if (chunk.length === 0) break;
      position += chunk.length;
      bytes += chunk.length;
      const window = Buffer.concat([carry, chunk]);
      if (!dirty && !clean(window.toString('latin1'))) dirty = true;
      carry = window.subarray(Math.max(0, window.length - overlapBytes));
    }
    scan.files += 1;
    scan.bytes += bytes;
    if (dirty) scan.dirty.push(relative);
  };
  const walk = (dir: string, relative: string) => {
    let names: string[];
    try {
      names = fs.readdir(dir);
    } catch (error) {
      missed(relative === '' ? '.' : relative, error, relative === '');
      return;
    }
    for (const name of names.sort()) {
      const path = join(dir, name);
      const rel = relative === '' ? name : `${relative}/${name}`;
      try {
        const { kind } = fs.lstat(path);
        if (kind === 'dir') walk(path, rel);
        else if (kind === 'file' && include(rel)) readWhole(path, rel);
      } catch (error) {
        missed(rel, error);
      }
    }
  };
  walk(root, '');
  return scan;
}

// P3-HD panel correction: single quotes suppress every expansion and substitution; an embedded quote is `'\''`.
export const shellQuoted = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
