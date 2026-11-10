// P5 O15 M2b §K (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): M4's 7e probe and the only way an
// evidence line leaves a machine. Node's own modules and nothing else, so it can be copied to a machine and run with
// `node` alone.
//
//   node wake-probe.mjs watch --target <name>=<host>:<port> [--target …] [--https <url>] --out <dir>
//   node wake-probe.mjs read <dir> --after <time> [--at <time> …]
//   node wake-probe.mjs extract <log file> [--since <time>]
//
// A <time> is an ISO-8601 time, as a log line carries it, or the wall clock's milliseconds.
//
// `watch` is the app's own probe (src/main/net/reach.ts), on purpose: for each target a bare TCP connect starts every
// 100 ms, each given 3 s, overlapping, and one that connects is closed at once. Each try is one JSON line in
// `<dir>/<name>.jsonl`, written when it ends: `n`, `started` and `ended` on the wall clock in ms, `ms` (its duration on
// the monotonic clock), `ok`, and `code` when it failed (`TIMEOUT` for the 3 s). `started` and `ended` are the wall
// clock's because main.log's times are, and nothing here assumes the monotonic clock advances through a sleep; only a
// try's own duration is read from it, and no try that counts spans the sleep. With `--https`, one GET of the URL every
// 2 s, each given 3 s, to `<dir>/https.jsonl` with its status or its error's code: Decision Log 6 (k)'s cross-check, a
// request that succeeds while the probes to the same host fail. It runs until it is interrupted.
//
// `read` counts only the tries that started at or after `--after`, the time of main.log's `[wake]` line: one that
// started before it, one that spans the sleep among them, counts for nothing. For each target, of the counted tries
// that succeeded, the one that started first: its `started` is `reachable`, so the try's own duration counts against
// the bound and not for it. For each `--at` (a log line's time), the time from that try's start and from its end; and
// the median `ms` of the counted successes in the 30 s from `reachable` (`h` for the hub, `d` for a direct port, `m`
// when run on a machine with `--after` the moment its watch began). Each try that began before `--after` and ended
// after it is listed; those that ended before it are counted in one line.
//
// `extract` prints the lines of a main.log, mawsd.log or host.log whose text after the time matches one of EVIDENCE,
// and nothing else; a line with no time of its own (a stack's line, stray output) is never printed. The patterns are
// §K's, in the forms the processes write them: mawsd writes its endpoint's lines under `[endpoint] `
// (src/mawsd/daemon.ts), and the engine host's stream lines reach host.log through its ipc's `[engine-host] ` and the
// `warn: ` its routed console adds (src/engine-host/ipc.ts, src/shared/host/socket-host.ts). Each prefix is optional,
// so §K's bare form matches too. What `.*` stands for in them is a carrier, a reason word, an error's words or a
// subscription's `<what>`: none is a session's text.
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect } from 'node:net';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import { URL } from 'node:url';

const TRY_EVERY_MS = 100;
const TRY_MS = 3_000;
const GET_EVERY_MS = 2_000;
const MEDIAN_SPAN_MS = 30_000;
const HTTPS_FILE = 'https';

// Building blocks: <n> digits; <id>, <ref>, <key>, <host>, <position>, <cursor> a run with no space.
const N = String.raw`\d+`;
const S = String.raw`\S+`;
const ENDPOINT = String.raw`(?:\[endpoint\] )?`;
const ENGINE_HOST = String.raw`(?:warn: \[engine-host\] )?`;
const MACHINES = String.raw`\[machines\] ${S}: `;
const WHICH = String.raw`(?:direct|relay|today's)`;
const MODE = String.raw`(?:replay|snapshot|missing)`;
// A project's first 8 characters, in the alphabet of a project id (isProjectId in apps/org-protocol/src/shapes.ts),
// which §K calls `<8 hex>`.
const PROJECT = String.raw`\[org-channel\] [A-Za-z0-9._-]{1,8}: `;

const EVIDENCE = [
  String.raw`\[wake\] slept ${N} ms \((?:resume|clock)\)`,
  String.raw`\[reach\] window open for 60 s \((?:wake|network)\)`,
  String.raw`\[reach\] ${S}:${N}: reachable after ${N} probes, ${N} ms`,
  String.raw`\[reach\] ${S}:${N}: window closed after ${N} probes, none connected \(.*\)`,
  String.raw`${MACHINES}wake after ${N} ms: dropped .*`,
  String.raw`${MACHINES}probe \w+: .*`,
  String.raw`${MACHINES}attempt \(${WHICH}\): catch-up, dial ${N}`,
  String.raw`${MACHINES}attempt failed \(${WHICH}\): .*`,
  String.raw`${MACHINES}lane (?:direct|relay): spent \(.*\)`,
  String.raw`${MACHINES}floor after ${N} ms: today's attempts from here \(.*\)`,
  String.raw`${MACHINES}lanes again: ${S}:${N} answered, ${N} ms after the floor`,
  String.raw`${MACHINES}wrote ${N} act message\(s\), ${N} bytes, ahead of the subscriptions`,
  String.raw`${MACHINES}up over the (?:direct|relay) carrier.*`,
  String.raw`${MACHINES}the .* channel was lost \(.*\); reconnecting`,
  String.raw`${MACHINES}subscription ${S} .*: subbed ${MODE} at ${S}, asked from ${S}`,
  String.raw`${MACHINES}subscription ${S} .*: first (?:event|snapshot) after subbed, at ${S}`,
  String.raw`${MACHINES}subscription ${S}: dropped a repeated event at ${S}`,
  String.raw`\[org-feed\] wake after ${N} ms: .*`,
  String.raw`\[org-feed\] no pong within ${N} ms: dropped the socket`,
  String.raw`\[org-feed\] probe: .*`,
  String.raw`\[org-feed\] connected to ${S}`,
  String.raw`\[org-feed\] listings: last page, ${N} records in ${N} pages`,
  String.raw`${PROJECT}wake after ${N} ms: .*`,
  String.raw`${PROJECT}no pong within ${N} ms: dropped the socket`,
  String.raw`${PROJECT}welcomed, resuming after ${N}`,
  String.raw`${PROJECT}caught up at ${N}`,
  String.raw`${ENDPOINT}endpoint: channel ${S} sub ${S} .*: subbed ${MODE} at ${S}, asked from ${S}, after ${N} ms`,
  String.raw`${ENDPOINT}endpoint: the hub connection .*; connecting again in ${N} ms`,
  String.raw`${ENGINE_HOST}ring evicted ${S} launch ${S}: events through seq ${N} are the journal's now`,
  String.raw`${ENGINE_HOST}session\.events ${S} after (?:${N}|start): from the journal, ${N} rows read in ${N} ms(?:, from the checkpoint at seq ${N})?`,
  String.raw`${ENGINE_HOST}checkpoint ${S} launch ${S} at seq ${N}: ${N} bytes; ${N} held, ${N} bytes`,
].map((source) => new RegExp(`^${source}$`));

const TIMED_LINE = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z) (.*)$/;

class Usage extends Error {}

function main(argv) {
  const [command, ...rest] = argv;
  try {
    if (command === 'watch') return watch(rest);
    if (command === 'read') return read(rest);
    if (command === 'extract') return extract(rest);
    throw new Usage(`unknown command ${command === undefined ? '(none)' : command}`);
  } catch (error) {
    if (!(error instanceof Usage)) throw error;
    process.stderr.write(`wake-probe: ${error.message}\nusage: wake-probe.mjs watch --target <name>=<host>:<port> [--target …] [--https <url>] --out <dir>\n       wake-probe.mjs read <dir> --after <time> [--at <time> …]\n       wake-probe.mjs extract <log file> [--since <time>]\n`);
    process.exitCode = 2;
  }
}

/** The positional arguments and each `--flag value`, repeated flags gathered in order. */
function parse(args, flags) {
  const positional = [];
  const values = Object.fromEntries(flags.map((flag) => [flag, []]));
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const flag = arg.slice(2);
    if (!(flag in values)) throw new Usage(`unknown option ${arg}`);
    if (i + 1 >= args.length) throw new Usage(`${arg} needs a value`);
    values[flag].push(args[++i]);
  }
  return { positional, values };
}

function timeOf(text, flag) {
  const ms = /^\d+$/.test(text) ? Number(text) : Date.parse(text);
  if (Number.isNaN(ms)) throw new Usage(`${flag} ${text} is not a time`);
  return ms;
}

const iso = (ms) => new Date(ms).toISOString();
const tries = (n) => `${n} ${n === 1 ? 'try' : 'tries'}`;

// --- watch ------------------------------------------------------------------------------------------------------------

function watch(args) {
  const { positional, values } = parse(args, ['target', 'https', 'out']);
  if (positional.length > 0) throw new Usage(`watch takes no ${positional[0]}`);
  if (values.out.length !== 1) throw new Usage('watch needs one --out <dir>');
  if (values.target.length === 0) throw new Usage('watch needs at least one --target <name>=<host>:<port>');
  if (values.https.length > 1) throw new Usage('watch takes at most one --https <url>');
  const targets = values.target.map(targetOf);
  const names = new Set(targets.map((t) => t.name));
  if (names.size !== targets.length) throw new Usage('two targets share a name');
  const https = values.https.length === 1 ? urlOf(values.https[0]) : null;
  const dir = values.out[0];
  mkdirSync(dir, { recursive: true });

  const sockets = new Set();
  const timers = [];
  for (const target of targets) {
    const file = join(dir, `${target.name}.jsonl`);
    let n = 0;
    const start = () => probe(target, ++n, file, sockets);
    start();
    timers.push(setInterval(start, TRY_EVERY_MS));
  }
  if (https !== null) {
    const file = join(dir, `${HTTPS_FILE}.jsonl`);
    let n = 0;
    const start = () => get(https, ++n, file, sockets);
    start();
    timers.push(setInterval(start, GET_EVERY_MS));
  }
  process.stdout.write(`watch: started ${iso(Date.now())}, ${targets.map((t) => t.name).join(', ')} every ${TRY_EVERY_MS} ms${https === null ? '' : `, ${https.href} every ${GET_EVERY_MS} ms`} into ${dir}\n`);

  const stop = () => {
    for (const timer of timers) clearInterval(timer);
    for (const socket of sockets) socket.destroy();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

function targetOf(spec) {
  const match = /^([A-Za-z0-9._-]+)=(.+):(\d+)$/.exec(spec);
  if (match === null) throw new Usage(`--target ${spec} is not <name>=<host>:<port>`);
  const [, name, rawHost, port] = match;
  if (name === HTTPS_FILE) throw new Usage(`--target ${spec}: the name https is the GET cross-check's file`);
  const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost; // an IPv6 address, bare for node:net
  return { name, host, port: Number(port) };
}

function urlOf(text) {
  try {
    const url = new URL(text);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url;
  } catch {
    // reported below
  }
  throw new Usage(`--https ${text} is not an http(s) URL`);
}

/** One try: a bare TCP connect, closed at once when it connects, given TRY_MS; its line written when it ends. */
function probe(target, n, file, sockets) {
  const started = Date.now();
  const from = performance.now();
  const socket = connect({ host: target.host, port: target.port });
  sockets.add(socket);
  let done = false;
  const end = (code) => {
    if (done) return;
    done = true;
    clearTimeout(deadline);
    sockets.delete(socket);
    socket.destroy();
    record(file, { n, started, ended: Date.now(), ms: elapsed(from), ok: code === null, ...(code === null ? {} : { code }) });
  };
  const deadline = setTimeout(() => end('TIMEOUT'), TRY_MS);
  socket.once('connect', () => end(null));
  socket.once('error', (error) => end(error.code ?? error.message));
}

/** One GET of the cross-check, given TRY_MS; its status, or its error's code, written when its headers come. */
function get(url, n, file, sockets) {
  const started = Date.now();
  const from = performance.now();
  let done = false;
  const end = (outcome) => {
    if (done) return;
    done = true;
    clearTimeout(deadline);
    request.destroy();
    record(file, { n, started, ended: Date.now(), ms: elapsed(from), ...outcome });
  };
  const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { method: 'GET' }, (response) => {
    response.resume();
    end({ status: response.statusCode });
  });
  request.on('socket', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  const deadline = setTimeout(() => end({ error: 'TIMEOUT' }), TRY_MS);
  request.once('error', (error) => end({ error: error.code ?? error.message }));
  request.end();
}

const elapsed = (from) => Math.round((performance.now() - from) * 10) / 10;

function record(file, entry) {
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

// --- read -------------------------------------------------------------------------------------------------------------

function read(args) {
  const { positional, values } = parse(args, ['after', 'at']);
  if (positional.length !== 1) throw new Usage('read needs one <dir>');
  if (values.after.length !== 1) throw new Usage('read needs one --after <time>, the time of main.log’s [wake] line');
  const dir = positional[0];
  const after = timeOf(values.after[0], '--after');
  const ats = values.at.map((text) => timeOf(text, '--at'));
  const names = readdirSync(dir)
    .filter((file) => file.endsWith('.jsonl') && file !== `${HTTPS_FILE}.jsonl`)
    .map((file) => file.slice(0, -'.jsonl'.length))
    .sort();
  if (names.length === 0) throw new Usage(`${dir} holds no target's tries`);
  const out = [];
  for (const name of names) out.push(...readTarget(name, triesOf(join(dir, `${name}.jsonl`)), after, ats));
  process.stdout.write(`${out.join('\n')}\n`);
}

/** A target's tries in the order they started; a line that does not parse (a write cut by an interrupt) is passed over. */
function triesOf(file) {
  const all = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line === '') continue;
    try {
      const entry = JSON.parse(line);
      if (typeof entry.started === 'number' && typeof entry.ended === 'number' && typeof entry.ok === 'boolean') all.push(entry);
    } catch {
      // passed over
    }
  }
  return all.sort((a, b) => a.started - b.started);
}

function readTarget(name, all, after, ats) {
  const counted = all.filter((t) => t.started >= after);
  const before = all.filter((t) => t.started < after);
  const spanning = before.filter((t) => t.ended >= after);
  const lines = [`${name}: ${tries(counted.length)} counted from ${iso(after)}, ${before.length} excluded`];
  if (before.length > spanning.length) lines.push(`${name}: excluded: ${tries(before.length - spanning.length)} that ended before --after`);
  for (const t of spanning) lines.push(`${name}: excluded: try ${t.n}, started ${iso(t.started)}, ended ${iso(t.ended)}: began before --after`);
  const first = counted.find((t) => t.ok);
  if (first === undefined) {
    const last = counted.at(-1);
    lines.push(`${name}: no counted try succeeded${last === undefined ? '' : ` (the last: ${last.code ?? 'no code'})`}`);
    return lines;
  }
  lines.push(`${name}: reachable ${iso(first.started)}: try ${first.n} started then, ended ${iso(first.ended)}, took ${first.ms} ms`);
  for (const at of ats) lines.push(`${name}: --at ${iso(at)}: ${at - first.started} ms from the try’s start, ${at - first.ended} ms from its end`);
  const span = counted.filter((t) => t.ok && t.started <= first.started + MEDIAN_SPAN_MS).map((t) => t.ms);
  lines.push(`${name}: median ${median(span).toFixed(1)} ms over ${span.length} successful ${span.length === 1 ? 'try' : 'tries'} in the 30 s from reachable`);
  return lines;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// --- extract ----------------------------------------------------------------------------------------------------------

function extract(args) {
  const { positional, values } = parse(args, ['since']);
  if (positional.length !== 1) throw new Usage('extract needs one <log file>');
  if (values.since.length > 1) throw new Usage('extract takes at most one --since <time>');
  const since = values.since.length === 1 ? timeOf(values.since[0], '--since') : null;
  const out = [];
  for (const line of readFileSync(positional[0], 'utf8').split('\n')) {
    const match = TIMED_LINE.exec(line);
    if (match === null) continue;
    if (since !== null && Date.parse(match[1]) < since) continue;
    if (EVIDENCE.some((pattern) => pattern.test(match[2]))) out.push(line);
  }
  if (out.length > 0) process.stdout.write(`${out.join('\n')}\n`);
}

main(process.argv.slice(2));
