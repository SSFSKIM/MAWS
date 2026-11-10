// The wake case's reading (P5 O15 M2b §I, docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md; the second test of
// e2e/remote-latency.spec.ts): from main's log, B's `mawsd.log` and `host.log` (test/support/main-log.ts) and the two
// pipes' records (test/support/loopback-pipe.ts), what one launch's wake showed, and each way it fell short of step 5
// or step 6. Times are the logs' own, against the runner's wall clock at each restore: one Mac, one wall clock.
//
// - `failures` are the lines and counts §I requires under both modes (MAWS_REMOTE_LATENCY_PERF and _CHECK).
// - `wakeMisses` are the bounds, which the measured group alone holds: every `subbed` and the link's `up` at most
//   1,000 ms after the restore, the feed's `connected` and last listings page at most 2,000 ms after the hub's.
// - `conditions` keeps the lines that show which of §F's six conditions a wake missed (a catch-up, a failed attempt, a
//   spent lane, the floor, acts ahead of the subscriptions), so a wake outside them is read as neither pass nor fail.
import { IDLE_RUN } from './daemon-idle';
import { requestTarget, type PipeRequest } from './loopback-pipe';
import { caseLineOf, positionOf, type CaseLine, type LogLine, type Mode } from './main-log';
import { loadVerdict, type Carrier } from './remote-latency';

export const WAKE_CASE = {
  sleptMs: 3_600_000, // the hour asleep §I injects
  turns: 21, // each session's unseen turns: about 6,300 events, past the 6,000 at which the ring first trims
  restoreAfterMs: { min: 1_000, max: 3_000 }, // the wait drawn between the inject and the restore
  linkWithinMs: 1_000, // acceptance 6: every subscription, and the link's up
  feedWithinMs: 2_000, // §G's target, held on loopback
} as const;

/** The feed's socket (`REGISTRY_APP_PATH`, src/main/org/registry-feed.ts) and a machine's relay socket (src/main/machines/remote/link.ts). */
export const REGISTRY_SOCKET = '/api/registry/socket?app=1';
export const relaySocketPath = (ref: string) => `/api/machines/${encodeURIComponent(ref)}/socket`;

export interface Expected {
  /** The subscription as its lines name it (§H's `<what>`). */
  what: string;
  /** The bare app id a session's stream reads; null for a feed. */
  stream: string | null;
}

/** §F's six: each session's stream and checkout feed, then the machine's attention and artifacts feeds. */
export function sixSubscriptions(apps: readonly string[]): Expected[] {
  return [...apps.flatMap((app) => [{ what: `session B:${app}`, stream: app }, { what: `feed checkout B:${app}`, stream: null }]), { what: 'feed attention', stream: null }, { what: 'feed artifacts', stream: null }];
}

type Read = { at: number; text: string; line: CaseLine };
const readAll = (lines: readonly LogLine[]): Read[] =>
  lines.flatMap(({ at, text }) => {
    const line = caseLineOf(text);
    return line === null ? [] : [{ at, text, line }];
  });
const linkText = (ref: string, text: string) => text.replace(`[machines] ${ref}: `, '');
const ofLink = (ref: string) => (r: Read) => 'ref' in r.line && r.line.ref === ref;
const kindOf = <K extends CaseLine['kind']>(reads: readonly Read[], kind: K) => reads.filter((r): r is Read & { line: Extract<CaseLine, { kind: K }> } => r.line.kind === kind);

export interface Held {
  id: string;
  what: string;
  mode: Mode;
  position: string;
  asked: string;
  at: number;
}

/** The link's subscriptions as main's lines from `from` until `to` give them: each `<what>`'s last `subbed` line. */
export function subscriptionsIn(main: readonly LogLine[], ref: string, from: number, to: number = Infinity): Map<string, Held> {
  const held = new Map<string, Held>();
  for (const { at, line } of kindOf(readAll(main).filter(ofLink(ref)), 'subbed')) {
    if (at >= from && at < to) held.set(line.what, { id: line.id, what: line.what, mode: line.mode, position: line.position, asked: line.asked, at });
  }
  return held;
}

/** Each of the six the link has not answered, and each subscription it holds besides them. */
export function sixMissing(expected: readonly Expected[], held: ReadonlyMap<string, Held>): string[] {
  const wanted = new Set(expected.map((e) => e.what));
  return [...expected.filter((e) => !held.has(e.what)).map((e) => `no subbed line for ${e.what}`), ...[...held.values()].filter((h) => !wanted.has(h.what)).map((h) => `a subscription besides the six: ${h.what} (${h.id})`)];
}

/** What main's log still lacks after the restore: the carrier's `up` line and a `subbed` line for each of `ids`. */
export function linkPending(main: readonly LogLine[], ref: string, carrier: Carrier, ids: readonly string[], restoredAt: number): string[] {
  const after = readAll(main).filter((r) => r.at >= restoredAt && ofLink(ref)(r));
  const up = kindOf(after, 'up').some((r) => r.line.carrier === carrier);
  const answered = new Set(kindOf(after, 'subbed').map((r) => r.line.id));
  return [...(up ? [] : [`the up over the ${carrier} carrier line`]), ...ids.filter((id) => !answered.has(id)).map((id) => `a subbed line for ${id}`)];
}

export interface WakeInput {
  carrier: Carrier;
  ref: string;
  expected: readonly Expected[];
  /** A's main.log, B's mawsd.log and B's host.log, whole. */
  main: readonly LogLine[];
  endpoint: readonly LogLine[];
  host: readonly LogLine[];
  /** The runner's wall clock at each step: the launch, the stall (step 2), the inject (3), the restore (4), the hub's restore (6). */
  launchedAt: number;
  stalledAt: number;
  injectedAt: number;
  restoredAt: number;
  hubRestoredAt: number;
  requests: { hub: readonly PipeRequest[]; direct: readonly PipeRequest[] };
}

export interface SubscriptionRecord {
  id: string;
  what: string;
  stream: string | null;
  before: { mode: Mode; position: string };
  /** The first `subbed` after the restore; `ms` from the restore. */
  after: { mode: Mode; position: string; asked: string; ms: number } | null;
  /** B's answer to it; `ms` is §F's `J`, from the `sub`'s receipt to the answer. */
  endpoint: { mode: Mode; asked: string; ms: number } | null;
  /** A stream's journal read on B (`rows` read in `ms`), the proof its cursor was evicted. */
  journal: { after: number | null; rows: number; ms: number } | null;
  /** The first delivery after that `subbed`: when its content resumed; `ms` from the restore. */
  first: { delivery: 'event' | 'snapshot'; position: string; ms: number } | null;
}

export interface WakeRecord {
  carrier: Carrier;
  /** From the inject to the restore: the drawn wait. */
  waitMs: number;
  wake: string | null;
  linkWake: string | null;
  feedWake: string | null;
  /** The link's losses during the stall: its own silence check's. */
  lost: string[];
  upMs: number | null;
  lastSubbedMs: number | null;
  subscriptions: SubscriptionRecord[];
  feed: { connectedMs: number | null; lastPageMs: number | null; records: number | null; pages: number | null };
  /** The carrier's upgrades since the stall: the direct pipe's requests, or the hub's for the machine's relay socket. */
  upgrades: number;
  /** The hub's requests for the feed's socket since the stall. */
  feedOpens: number;
  conditions: string[];
  /** Each pipe's connections since the stall, `ms` from the restore; a null first line is a probe. */
  requests: { hub: { ms: number; firstLine: string | null }[]; direct: { ms: number; firstLine: string | null }[] };
}

const behind = (a: { seq: number; idx: number | null }, b: { seq: number; idx: number | null }) => a.seq < b.seq || (a.seq === b.seq && (a.idx ?? -1) < (b.idx ?? -1));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What one launch's wake showed, and each way it fell short of §I's steps 5 and 6. */
export function readWake(input: WakeInput): { record: WakeRecord; failures: string[] } {
  const { carrier, ref, launchedAt, stalledAt, injectedAt, restoredAt, hubRestoredAt } = input;
  const failures: string[] = [];
  const fail = (why: string) => void failures.push(`${carrier}: ${why}`);
  const main = readAll(input.main);
  const link = main.filter(ofLink(ref));
  const endpoint = kindOf(readAll(input.endpoint), 'endpoint-subbed');
  const journal = kindOf(readAll(input.host), 'journal');
  const since = (from: number) => (r: { at: number }) => r.at >= from;
  const ms = (at: number, from: number = restoredAt) => at - from;

  // step 1: the six, from the launch to the stall
  const before = subscriptionsIn(input.main, ref, launchedAt, stalledAt);
  for (const missing of sixMissing(input.expected, before)) fail(`before the stall, ${missing}`);

  // step 3: the wake, seen by the source and by the link
  const wake = kindOf(main, 'wake').find((r) => r.at >= injectedAt && r.line.sleptMs === WAKE_CASE.sleptMs);
  if (wake === undefined) fail(`no [wake] slept ${WAKE_CASE.sleptMs} ms line after the inject`);
  const linkWake = kindOf(link, 'link-wake').find((r) => r.at >= injectedAt && r.line.sleptMs === WAKE_CASE.sleptMs);
  if (linkWake === undefined) fail(`no link line wake after ${WAKE_CASE.sleptMs} ms: dropped … after the inject`);
  const feedWake = kindOf(main, 'feed-wake').find((r) => r.at >= injectedAt);

  // step 5: the link's up and every subscription answered after the restore
  const ups = kindOf(link, 'up');
  if (ups.some((r) => r.at >= stalledAt && r.at < restoredAt)) fail('the link came up during the stall');
  const up = ups.find(since(restoredAt));
  if (up === undefined) fail(`no up over the ${carrier} carrier line after the restore`);
  else if (up.line.carrier !== carrier) fail(`the link came up over the ${up.line.carrier} carrier after the restore, not the ${carrier}`);
  if (carrier === 'relay' && ups.some((r) => r.at >= stalledAt && r.line.carrier === 'direct')) fail('an up over the direct carrier line since the stall: a direct dial reached B through the held pipe');

  const subbed = kindOf(link, 'subbed');
  const firsts = kindOf(link, 'first');
  const subscriptions: SubscriptionRecord[] = [];
  for (const expected of input.expected) {
    const held = before.get(expected.what);
    if (held === undefined) continue; // named above
    const { id, what } = held;
    const name = `subscription ${id} (${what})`;
    if (subbed.some((r) => r.line.id === id && r.at >= stalledAt && r.at < restoredAt)) fail(`${name} was answered during the stall`);
    const answer = subbed.find((r) => r.line.id === id && r.at >= restoredAt);
    const answered = endpoint.find((r) => r.line.id === id && r.at >= restoredAt);
    const read = expected.stream === null ? undefined : journal.find((r) => r.line.app === expected.stream && r.at >= restoredAt);
    const first = firsts.find((r) => r.line.id === id && r.at >= restoredAt);
    subscriptions.push({
      id,
      what,
      stream: expected.stream,
      before: { mode: held.mode, position: held.position },
      after: answer === undefined ? null : { mode: answer.line.mode, position: answer.line.position, asked: answer.line.asked, ms: ms(answer.at) },
      endpoint: answered === undefined ? null : { mode: answered.line.mode, asked: answered.line.asked, ms: answered.line.ms },
      journal: read === undefined ? null : { after: read.line.after, rows: read.line.rows, ms: read.line.ms },
      first: first === undefined ? null : { delivery: first.line.delivery, position: first.line.position, ms: ms(first.at) },
    });
    if (answer === undefined) {
      fail(`${name} has no subbed line after the restore`);
      continue;
    }
    if (expected.stream !== null) {
      // a stream resumes from the cursor it held: a replay, asked from a position of the launch it stood in, at or past it
      if (answer.line.mode !== 'replay') fail(`${name} answered ${answer.line.mode}, not replay`);
      const asked = positionOf(answer.line.asked);
      const stood = positionOf(held.position);
      if (asked === null) fail(`${name} asked from ${answer.line.asked}, not from the cursor it held`);
      else if (stood !== null && asked.epoch !== stood.epoch) fail(`${name} asked from ${answer.line.asked}, a cursor of another launch than ${held.position}`);
      else if (stood !== null && behind(asked, stood)) fail(`${name} asked from ${answer.line.asked}, before ${held.position}, where it stood`);
      if (read === undefined) fail(`B's host.log has no session.events ${expected.stream} … from the journal line after the restore: the stream's cursor is not shown evicted`);
    }
    if (answered === undefined) fail(`B's mawsd.log has no sub ${id} line (${what}) after the restore`);
    else {
      if (answered.line.mode !== answer.line.mode) fail(`B answered subscription ${id} ${answered.line.mode} where A read ${answer.line.mode}`);
      if (answered.line.asked !== answer.line.asked) fail(`B was asked for subscription ${id} from ${answered.line.asked}, where A asked from ${answer.line.asked}`);
    }
  }
  for (const r of kindOf(link, 'repeated').filter(since(launchedAt))) fail(`main.log says subscription ${r.line.id}: dropped a repeated event at ${r.line.position}`);

  // the counts since the stall: probes, the connections that sent nothing, are not counted
  const hub = input.requests.hub.filter(since(stalledAt));
  const direct = input.requests.direct.filter(since(stalledAt));
  const toHub = (path: string) => hub.filter((r) => requestTarget(r.firstLine) === path);
  const relaySockets = toHub(relaySocketPath(ref));
  let upgrades: number;
  if (carrier === 'direct') {
    const sent = direct.filter((r) => r.firstLine !== null);
    upgrades = sent.length;
    if (upgrades !== 1) fail(`the direct pipe saw ${plural(upgrades, 'upgrade request')} since the stall, not one${upgrades === 0 ? '' : `: ${sent.map((r) => r.firstLine).join(' | ')}`}`);
    const whileStalled = hub.filter((r) => r.at < hubRestoredAt).length;
    if (whileStalled > 0) fail(`the hub's pipe, stalled, saw ${whileStalled} connection(s) since the stall`);
    if (relaySockets.length > 0) fail(`the hub's pipe saw ${plural(relaySockets.length, 'request')} for ${relaySocketPath(ref)} since the stall, on the direct carrier's launch`);
  } else {
    upgrades = relaySockets.length;
    if (upgrades !== 1) fail(`the hub's pipe saw ${plural(upgrades, 'request')} for ${relaySocketPath(ref)} since the stall, not one`);
  }
  const feedOpens = toHub(REGISTRY_SOCKET).length;
  if (feedOpens !== 1) fail(`the hub's pipe saw ${plural(feedOpens, 'request')} for ${REGISTRY_SOCKET} since the stall, not one`);

  // step 6: the feed, from the hub's restore
  const connected = kindOf(main, 'feed-connected').find(since(stalledAt));
  const lastPage = kindOf(main, 'feed-last-page').find(since(stalledAt));
  for (const [line, words] of [[connected, '[org-feed] connected'], [lastPage, '[org-feed] listings: last page']] as const) {
    if (line === undefined) fail(`no ${words} line after the hub's restore`);
    else if (line.at < hubRestoredAt) fail(`${words} came ${hubRestoredAt - line.at} ms before the hub's restore`);
  }

  const answeredMs = subscriptions.flatMap((s) => (s.after === null ? [] : [s.after.ms]));
  const conditions = link
    .filter((r) => r.at >= stalledAt && ['catch-up', 'attempt-failed', 'lane-spent', 'floor', 'acts-ahead'].includes(r.line.kind))
    .map((r) => `${ms(r.at) >= 0 ? '+' : ''}${ms(r.at)} ms ${linkText(ref, r.text)}`);
  const record: WakeRecord = {
    carrier,
    waitMs: restoredAt - injectedAt,
    wake: wake?.text ?? null,
    linkWake: linkWake === undefined ? null : linkText(ref, linkWake.text),
    feedWake: feedWake?.text ?? null,
    lost: kindOf(link, 'lost')
      .filter((r) => r.at >= stalledAt && r.at < restoredAt)
      .map((r) => linkText(ref, r.text)),
    upMs: up === undefined ? null : ms(up.at),
    lastSubbedMs: answeredMs.length === 0 ? null : Math.max(...answeredMs),
    subscriptions,
    feed: { connectedMs: connected === undefined ? null : ms(connected.at, hubRestoredAt), lastPageMs: lastPage === undefined ? null : ms(lastPage.at, hubRestoredAt), records: lastPage?.line.records ?? null, pages: lastPage?.line.pages ?? null },
    upgrades,
    feedOpens,
    conditions,
    requests: { hub: hub.map((r) => ({ ms: ms(r.at), firstLine: r.firstLine })), direct: direct.map((r) => ({ ms: ms(r.at), firstLine: r.firstLine })) },
  };
  return { record, failures };
}

/** The bounds the measured group holds (§I step 5's 1,000 ms, step 6's 2,000 ms), each time over its bound one line. */
export function wakeMisses(record: WakeRecord): string[] {
  const misses: string[] = [];
  const over = (value: number | null, bound: number) => value !== null && value > bound;
  if (over(record.upMs, WAKE_CASE.linkWithinMs)) misses.push(`${record.carrier}: the link up ${record.upMs} ms after the restore, over ${WAKE_CASE.linkWithinMs} ms`);
  for (const s of record.subscriptions) {
    if (over(s.after?.ms ?? null, WAKE_CASE.linkWithinMs)) misses.push(`${record.carrier}: subscription ${s.id} (${s.what}) answered ${s.after!.ms} ms after the restore, over ${WAKE_CASE.linkWithinMs} ms`);
  }
  if (over(record.feed.connectedMs, WAKE_CASE.feedWithinMs)) misses.push(`${record.carrier}: the feed connected ${record.feed.connectedMs} ms after the hub's restore, over ${WAKE_CASE.feedWithinMs} ms`);
  if (over(record.feed.lastPageMs, WAKE_CASE.feedWithinMs)) misses.push(`${record.carrier}: the feed's last listings page ${record.feed.lastPageMs} ms after the hub's restore, over ${WAKE_CASE.feedWithinMs} ms`);
  return misses;
}

/** The job log's line for one carrier. */
export function wakeSummary(record: WakeRecord): string {
  const f = (value: number | null) => (value === null ? 'none' : `${value} ms`);
  return `[remote-wake] ${record.carrier}: up ${f(record.upMs)} and last subbed ${f(record.lastSubbedMs)} after the restore; feed connected ${f(record.feed.connectedMs)} and last listings page ${f(record.feed.lastPageMs)} after the hub's restore; ${plural(record.upgrades, 'upgrade')}, ${plural(record.feedOpens, 'feed open')}`;
}

/** Each marker `text` shows other than exactly once, with its count. */
export function markersNotOnce(text: string, markers: readonly string[]): { marker: string; count: number }[] {
  return markers.map((marker) => ({ marker, count: text.split(marker).length - 1 })).filter((m) => m.count !== 1);
}

/** The file's load rule (Rule B, as the first test words it): the run is void, or not. */
export function loadVoid(loads: readonly number[], terminal: number | null): string[] {
  const load = loadVerdict(loads, terminal);
  if (!load.void) return [];
  const f = (value: number) => Number(value.toFixed(1));
  return [`the machine's load: peak ${f(load.peak)} at or over ${IDLE_RUN.maxLoad}, ${IDLE_RUN.everyS} s pair ${load.pair === null ? 'not rebuilt (under three samples)' : `${f(load.pair)} at or over ${IDLE_RUN.pairLoad}`} (Rule B)`];
}
