// The machine's side of a window: what the sminos daemon's log says happened between --since and --until, and, where
// given, what a Remote Control session's debug log and the sessions' transcripts say. Every time is the machine's wall
// clock in ms since the epoch; on the MacBook that is the browser's clock, on the mini it carries the skew between the
// two Macs, which --skew-ms subtracts (mini − MacBook, from `sntp` on each) and the output keeps.
//
//   node spikes/desk-latency/machine.mjs --since <ISO|ms> --until <ISO|ms> [--log ~/.claude/sminos/daemon.log]
//        [--machine macbook] [--skew-ms 0] [--rc-debug <file>]… [--transcript <session.jsonl>]… [--rpcs <rpcs.json>]
//        > machine.json
//
// daemon.log (sminos.daemon_log: "<ISO ms Z> <line>", UTC, several writers): the per-open line (the subscription's id,
// the machine's time from the subscribe's arrival to its snapshot, the bridge's share, the index build), the hub
// stream's closes and welcomes (paired into recycles), the sender lanes, the deliveries of web messages, and the RPC
// refusals. An RPC's own times are not in daemon.log but in the daemon's ledger (--rpcs, ~/.claude/sminos/daemon/rpcs.json,
// read only when the operator passes it). A raise has no machine line at all: its anchor is the tool call's row in the
// session's transcript (--transcript), as it is for claude.ai/code's sessions, the same method on both sides.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';

const LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) (.*)$/;
const OPEN =
  /^plane: open (?<sub>[A-Za-z0-9_-]+) of (?<sid8>[0-9a-f]{8})(?:\/(?<agent>[A-Za-z0-9_-]+))?: (?<how>.+?) after (?<N>\d+\.\d{2}) s from the subscribe's arrival \((?<bridge>.*?); build: (?<build>.*?), cut (?<cut>on disk|not on disk|null); waits (?<waits>\d+)\)$/;
const OPEN_OLD = /^plane: open (?<sub>\S+) of (?<sid8>[0-9a-f]{8})(?:\/(?<agent>\S+))?: (?<how>.+?) after (?<N>\d+\.\d\d) s(?: \(the bridge's snapshot at (?<A>\d+\.\d\d) s\))?$/;
const BRIDGE = /bridge: snapshot arrived (\d+\.\d\d) s, taken (\d+\.\d\d) s/;
const BUILD = /^(\w+) (\d+) ms (\d+) rows$/;
const CONNECTED = /^uplink: connected to (\S+) as (\S+) \(stream (\d+|None)\)$/;
const CLOSES = [
  [/^uplink: the stream closed: (.*)$/, 'closed'],
  [/^uplink: a POST was not delivered \((.*)\): reconnecting, to redo the handshake$/, 'post-not-delivered'],
  [/^uplink: (.*): the stream is closed$/, 'stopping'],
  [/^uplink: (?!a POST was not delivered)(.*): reconnecting$/, 'reconnecting'],
];
const STARTED = /^uplink: started \(pid (\d+)\)/;
const LANE_DIAL = /^uplink: (log|session) lane dialled the hub \(connection #(\d+)\)$/;
const LANE_CLOSE = /^uplink: (log|session) lane closed connection #(\d+) after (\d+) POSTs \((.*)\)$/;
const SLOW_POST = /^uplink: a (log|session) lane POST took (\d+\.\d) s$/;
const DELIVERED = /^uplink: delivered (\d+) in (.+) to (.+)$/;
const RPC_LINE = /^rpc: (\w+) (\S+?),? (refused|failed|claimed before a stop, reconciled:) ?([a-z-]*):? ?(.*)$/;

const ms = (iso) => Date.parse(iso);

/** The daemon.log lines between `since` and `until` (ms), parsed. */
export function parseDaemonLog(text, since, until) {
  const out = { opens: [], connected: [], closes: [], uplinkStarts: [], lanes: { dialled: 0, closed: 0, posts: 0, reasons: {} }, slowPosts: [], delivered: [], rpc: [] };
  for (const raw of text.split('\n')) {
    const m = LINE.exec(raw);
    if (!m) continue;
    const at = ms(m[1]);
    if (at < since || at > until) continue;
    const line = m[2];
    let g;
    if ((g = OPEN.exec(line)?.groups ?? OPEN_OLD.exec(line)?.groups)) {
      const N = Number(g.N) * 1000;
      const bridge = g.bridge ? BRIDGE.exec(g.bridge) : null;
      const build = g.build ? BUILD.exec(g.build) : null;
      out.opens.push({
        at,
        sub: g.sub,
        sid8: g.sid8,
        agent: g.agent ?? null,
        outcome: g.how,
        ms: N,
        arrival: at - N,
        bridgeArrivedMs: bridge ? Number(bridge[1]) * 1000 : g.A ? Number(g.A) * 1000 : null,
        takenMs: bridge ? Number(bridge[2]) * 1000 : null,
        build: build ? { how: build[1], cpuMs: Number(build[2]), rows: Number(build[3]) } : null,
        cut: g.cut ?? null,
        waits: g.waits !== undefined ? Number(g.waits) : null,
      });
      continue;
    }
    if ((g = CONNECTED.exec(line))) {
      out.connected.push({ at, hub: g[1], machine: g[2], generation: g[3] === 'None' ? null : Number(g[3]) });
      continue;
    }
    const close = CLOSES.map(([re, kind]) => [re.exec(line), kind]).find(([r]) => r);
    if (close) {
      out.closes.push({ at, kind: close[1], reason: close[0][1] });
      continue;
    }
    if ((g = STARTED.exec(line))) {
      out.uplinkStarts.push({ at, pid: Number(g[1]) });
      continue;
    }
    if ((g = LANE_DIAL.exec(line))) {
      out.lanes.dialled++;
      continue;
    }
    if ((g = LANE_CLOSE.exec(line))) {
      out.lanes.closed++;
      out.lanes.posts += Number(g[3]);
      const reason = g[4].startsWith('failed') ? 'failed' : g[4];
      out.lanes.reasons[reason] = (out.lanes.reasons[reason] ?? 0) + 1;
      continue;
    }
    if ((g = SLOW_POST.exec(line))) {
      out.slowPosts.push({ at, lane: g[1], ms: Number(g[2]) * 1000 });
      continue;
    }
    if ((g = DELIVERED.exec(line))) {
      out.delivered.push({ at, count: Number(g[1]), project: g[2], to: g[3] });
      continue;
    }
    if ((g = RPC_LINE.exec(line))) out.rpc.push({ at, rpc: g[1], nonce: g[2], what: g[3], code: g[4] || null, message: g[5].slice(0, 200) });
  }
  out.recycles = recycles(out);
  return out;
}

/**
 * Each loss of the hub stream paired with the welcome that ended it: the first close after a welcome, until the next
 * welcome, unless the uplink process itself was restarted between (a restart, not a recycle).
 */
export function recycles({ connected, closes, uplinkStarts }) {
  const out = [];
  for (const close of closes) {
    if (out.some((r) => close.at >= r.down && (r.up === null || close.at <= r.up))) continue; // a further close in the same gap
    const up = connected.find((c) => c.at >= close.at) ?? null;
    const restarted = uplinkStarts.some((s) => s.at >= close.at && (up === null || s.at <= up.at));
    out.push({ down: close.at, up: up?.at ?? null, ms: up ? up.at - close.at : null, cause: close.kind, reason: close.reason.slice(0, 160), restarted });
  }
  return out;
}

/** A Remote Control session's debug log (`claude remote-control --debug-file`, or a session run with --debug-file):
 * "<ISO ms Z> [LEVEL] msg" lines, the bridge's own ones kept with the ids they carry. */
export function parseRcDebug(text, since, until) {
  const out = [];
  for (const raw of text.split('\n')) {
    const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) \[(\w+)\] (.*)$/.exec(raw);
    if (!m) continue;
    const at = ms(m[1]);
    if (at < since || at > until) continue;
    const msg = m[3];
    let g;
    if ((g = /\[bridge:repl\] Ingress message type=(\S+)(?: uuid=(\S+))?/.exec(msg))) out.push({ at, kind: 'ingress', type: g[1], uuid: g[2] ?? null });
    else if ((g = /\[bridge:repl\] Injecting inbound user message: .* uuid=(\S+)/.exec(msg))) out.push({ at, kind: 'inject', uuid: g[1] });
    else if ((g = /\[bridge:repl\] Inbound control_request subtype=(\S+)/.exec(msg))) out.push({ at, kind: 'control_request', subtype: g[1] });
    else if ((g = /\[bridge:repl\] Sent control_response for (\S+) request_id=(\S+) result=(\S+)/.exec(msg))) out.push({ at, kind: 'control_response', subtype: g[1], request_id: g[2], result: g[3] });
    else if ((g = /\[bridge:api\] GET .*\/work\/poll -> 200 workId=(\S+) type=(\S+) sessionId=(\S+)/.exec(msg))) out.push({ at, kind: 'work', work: g[1], type: g[2], session: g[3] });
    else if ((g = /\[bridge:session\] CCR v2: registered worker sessionId=(\S+) epoch=(\S+)/.exec(msg))) out.push({ at, kind: 'registered', session: g[1], epoch: g[2] });
    else if ((g = /SSE connected in (\d+)ms/.exec(msg))) out.push({ at, kind: 'sse-connected', ms: Number(g[1]) });
    else if ((g = /SSE reconnected after (\d+) attempt\(s\), ([\d.]+)s downtime/.exec(msg))) out.push({ at, kind: 'sse-reconnected', attempts: Number(g[1]), downMs: Number(g[2]) * 1000 });
    else if ((g = /\[bridge:ws\] sessionId=(\S+) <<< (.*)$/.exec(msg))) {
      let type = null;
      try {
        const f = JSON.parse(g[2]);
        type = f.type === 'stream_event' ? `stream_event:${f.event?.type ?? '?'}` : f.type;
      } catch {
        type = 'unparsed';
      }
      out.push({ at, kind: 'child', session: g[1], type });
    }
  }
  return out;
}

/** A session's transcript rows in the window, compactly: when each was written, its kind, the tool calls it makes, and
 * the harness's tokens it carries (lat<rep><4 chars>), so a repetition finds its rows. */
export function parseTranscript(text, since, until) {
  const out = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    let row;
    try {
      row = JSON.parse(raw);
    } catch {
      continue;
    }
    const at = Date.parse(row.timestamp ?? '');
    if (!Number.isFinite(at) || at < since || at > until) continue;
    const content = row.message?.content;
    const blocks = Array.isArray(content) ? content : [];
    const text = typeof content === 'string' ? content : blocks.map((b) => (b.type === 'text' ? b.text : b.type === 'tool_use' ? JSON.stringify(b.input ?? {}) : '')).join('\n');
    const tokens = [...new Set(text.match(/lat\d+[a-z0-9]{4}/g) ?? [])];
    out.push({
      at,
      uuid: row.uuid ?? null,
      type: row.type ?? null,
      session: row.sessionId ?? null,
      toolUses: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name })),
      toolResults: blocks.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id),
      tokens,
    });
  }
  return out;
}

/** The daemon's RPC ledger (nonce → claim and outcome times, epoch seconds), the entries in the window. */
export function parseRpcs(text, since, until) {
  const ledger = JSON.parse(text);
  const entries = ledger.rpcs ?? ledger;
  const out = [];
  for (const [nonce, e] of Object.entries(entries)) {
    const at = typeof e?.at === 'number' ? e.at * 1000 : null;
    if (at === null || at < since || at > until) continue;
    const t = (v) => (typeof v === 'number' ? v * 1000 : null);
    out.push({ nonce, rpc: e.rpc ?? null, session: e.session ?? null, created: typeof e.created === 'number' ? e.created * 1000 : Date.parse(e.created ?? '') || null, claimed: at, launched: t(e.launched_at), done: t(e.done_at), outcome: e.outcome?.state ?? null });
  }
  return out;
}

const time = (v) => (/^\d+$/.test(v) ? Number(v) : Date.parse(v));

// Run as a command (not imported by the tests): argv[1] through any symlink (/tmp is one on macOS).
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      since: { type: 'string' },
      until: { type: 'string' },
      log: { type: 'string', default: `${homedir()}/.claude/sminos/daemon.log` },
      machine: { type: 'string', default: 'macbook' },
      'skew-ms': { type: 'string', default: '0' },
      'rc-debug': { type: 'string', multiple: true },
      transcript: { type: 'string', multiple: true },
      rpcs: { type: 'string' },
      margin: { type: 'string', default: '60000' },
    },
  });
  if (!values.since || !values.until) throw new Error('--since and --until are required (ISO or ms since the epoch)');
  const skew = Number(values['skew-ms']);
  const margin = Number(values.margin);
  // The window on the machine's own clock: the browser's, shifted by the skew, with a margin for what began before.
  const since = time(values.since) + skew - margin;
  const until = time(values.until) + skew + margin;
  const unskew = (value) => (value && typeof value === 'object' ? (Array.isArray(value) ? value.map(unskew) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, ['at', 'arrival', 'down', 'up', 'claimed', 'launched', 'done'].includes(k) && typeof v === 'number' ? v - skew : unskew(v)]))) : value);
  const out = {
    machine: values.machine,
    skewMs: skew,
    window: { since: new Date(since).toISOString(), until: new Date(until).toISOString() },
    daemon: unskew(parseDaemonLog(readFileSync(values.log, 'utf8'), since, until)),
    rc: (values['rc-debug'] ?? []).flatMap((f) => unskew(parseRcDebug(readFileSync(f, 'utf8'), since, until))),
    transcripts: Object.fromEntries((values.transcript ?? []).map((f) => [f, unskew(parseTranscript(readFileSync(f, 'utf8'), since, until))])),
    rpcs: values.rpcs ? unskew(parseRpcs(readFileSync(values.rpcs, 'utf8'), since, until)) : null,
  };
  process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
}
