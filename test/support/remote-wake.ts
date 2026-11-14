// The wake case's reading (P5 O15 M2b §I, docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md; the second test of
// e2e/remote-latency.spec.ts): from main's log, B's `mawsd.log` and `host.log` (test/support/main-log.ts) and the two
// pipes' records (test/support/loopback-pipe.ts), what one launch's wake showed, and each way it fell short of step 5
// or step 6. Times are the logs' own, against the runner's wall clock at each restore: one Mac, one wall clock.
//
// - `failures` are the lines and counts §I requires under both modes (MAWS_REMOTE_LATENCY_PERF and _CHECK), and
//   (Decision Log 39) no whole-launch read of a session on B between the restore and that session's `subbed`.
// - `wakeMisses` are the bounds, which the measured group alone holds: every `subbed` and the link's `up` at most
//   1,000 ms after the restore, the feed's `connected` and last listings page at most 2,000 ms after the hub's.
// - `conditions` keeps the lines from the inject on that show which of §F's six conditions a wake missed (a catch-up, a
//   failed attempt or a spent lane of the lane adopted, more than 4 KiB ahead of the subscriptions), so a miss outside
//   them is read as neither pass nor fail (Decision Log 33 (d)); the floor and today's attempts are context.
// - `historyReadsBeside` is the third test's reading (UX wave U9 M5, A5, #565): no history read of any session asked by
//   A between the restore and its `subbed` of the live session's stream, and no whole-launch read on B before B's own,
//   where a cold or idle tab's read would contend; and the reads still in flight, so the case can wait them out.
// - `wakeVerdict` voids the run on the 1-minute load read at the instants that bracket each carrier's timed windows
//   (Decision Log 33 (c)), labels a miss outside §F's conditions, and otherwise gives the verdict.
// - `bLines` and `streams` are context, never conditions (Decision Log 37): B's own lines from the stall on (its idle
//   collections, the endpoint's `sub` answers, the journal reads), and each stream's `J` beside its journal read.
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

/**
 * §L's interval: a resume read takes at most this many rows before its cursor, plus the page's (`CHECKPOINT_ROWS`,
 * src/engine-host/session-stream.ts, whose value remote-wake.test.ts pins: the e2e project does not take in the stream's
 * module graph).
 */
export const CHECKPOINT_ROWS = 10_000;
/** The events a resume's page asks for (`PAGE_EVENTS`, src/shared/host/stream-catchup.ts, pinned likewise by the test). */
export const RESUME_PAGE_EVENTS = 500;

/**
 * B's endpoint's silence before a ping, drawn anew each period (`PING_MS`, src/endpoint/channels.ts), and how long it keeps
 * a closed channel's interest (`RESUME_MS`, src/endpoint/interest.ts): pinned here as CHECKPOINT_ROWS is, and held to the
 * source by remote-wake.test.ts (the e2e project does not take in the endpoint's module graph).
 */
export const PING_MS: readonly [number, number] = [5_000, 7_000];
export const RESUME_MS = 120_000;
/**
 * The latest B's endpoint closes the stalled channel after the stall: it writes no line at that close, so the time is
 * counted. A channel is closed at its third silent ping period in a row, and the period running at the stall may have
 * heard A just before it, so the close comes at most four periods of PING_MS's longest after the stall.
 */
export const CHANNEL_CLOSED_WITHIN_MS = 4 * PING_MS[1];
export const PAST_RESUME_MARGIN_MS = 10_000;
/**
 * The inject's earliest time after the stall (Decision Log 37): B's channel closed, its resume window over and a margin,
 * so B meets the wake past its resume window, the state an hour asleep leaves it in.
 */
export const INJECT_AFTER_STALL_MS = CHANNEL_CLOSED_WITHIN_MS + RESUME_MS + PAST_RESUME_MARGIN_MS;

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
  /**
   * Each stream's cursor at the stall, by its bare app id: B's last event of the launch, which A's renderer was shown to
   * have received, established before the stall from B's side (the spec's `heldCursor`). A resume asks from exactly it.
   */
  held: Readonly<Record<string, string>>;
  /**
   * Each stream's resume page as B's journal holds it, by its bare app id: the rows from its cursor's row (`after`) through
   * the row the page reads ahead and carries to the next, read by the case on B, apart from the read it bounds. Absent:
   * not established.
   */
  pageRows: Readonly<Record<string, number>>;
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
  /** A stream's cursor at the stall (`WakeInput.held`); null for a feed, which resubscribes with none. */
  held: string | null;
  /** The first `subbed` after the restore; `ms` from the restore. */
  after: { mode: Mode; position: string; asked: string; ms: number } | null;
  /** B's answer to it; `ms` is §F's `J`, from the `sub`'s receipt to the answer. */
  endpoint: { mode: Mode; asked: string; ms: number } | null;
  /**
   * A stream's journal read on B (`rows` read in `ms`), the proof its cursor was evicted; `checkpoint`, the seq of the
   * checkpoint it read from (null: from the first row); `bound`, its most rows, CHECKPOINT_ROWS plus the page's rows on B
   * (`WakeInput.pageRows`; §L), null when those were not established.
   */
  journal: { after: number | null; rows: number; ms: number; checkpoint: number | null; bound: number | null } | null;
  /** The first delivery after that `subbed`: when its content resumed; `ms` from the restore. */
  first: { delivery: 'event' | 'snapshot'; position: string; ms: number } | null;
}

/** A stream's `J` (B's `sub` answer's ms), its own journal read's ms, and `J` less that read; null where a line is missing. */
export interface StreamTiming {
  app: string;
  id: string;
  jMs: number | null;
  journalMs: number | null;
  remainderMs: number | null;
}

/**
 * One of B's own lines, `ms` from the restore: an idle collection (mawsd's, or the engine host's `[supervisor]` one), an
 * endpoint's `sub` answer, or a `session.events … from the journal` read. Context, never a condition.
 */
export interface BLine {
  ms: number;
  log: 'mawsd' | 'host';
  kind: 'idle-collected' | 'sub' | 'journal';
  text: string;
}
const B_LINES: readonly { kind: BLine['kind']; pattern: RegExp }[] = [
  { kind: 'idle-collected', pattern: /^(?:\[supervisor\] )?idle: collected in \d+ ms/ },
  { kind: 'sub', pattern: /^(?:\[endpoint\] )?endpoint: channel \S+ sub \S+ / },
  { kind: 'journal', pattern: /^(?:warn: )?(?:\[engine-host\] )?session\.events \S+ after \S+: from the journal/ },
];

export interface WakeRecord {
  carrier: Carrier;
  /** From the inject to the restore: the drawn wait. */
  waitMs: number;
  /** From the stall to the restore: B's writing, the wait past B's resume window, the settle and the drawn wait. */
  stallMs: number;
  wake: string | null;
  linkWake: string | null;
  feedWake: string | null;
  /** The link's losses during the stall: its own silence check's. */
  lost: string[];
  upMs: number | null;
  lastSubbedMs: number | null;
  subscriptions: SubscriptionRecord[];
  /** Each stream's `J` beside its journal read (Decision Log 37): context, no condition. */
  streams: StreamTiming[];
  feed: { connectedMs: number | null; lastPageMs: number | null; records: number | null; pages: number | null };
  /** The carrier's upgrades since the stall: the direct pipe's requests, or the hub's for the machine's relay socket. */
  upgrades: number;
  /** The hub's requests for the feed's socket since the stall. */
  feedOpens: number;
  /**
   * §F's conditions, from the inject on, `ms` from the restore: a catch-up (condition 1), a failed attempt of the lane
   * adopted (4), that lane spent (4 and 5), more than 4 KiB written ahead of the subscriptions (6).
   */
  conditions: string[];
  /** The other lane's failed attempts and spent line from the inject on: §F's fourth condition is the adopted lane's. */
  otherLane: string[];
  /**
   * The rest of those lines from the inject on, context and no condition: the floor (§F lets a path return after it
   * with the claim intact), today's failed attempts, which are no lane's, and acts ahead of the subscriptions within 4 KiB.
   */
  windowContext: string[];
  /** The same lines from the stall to the inject (today's attempts against the refused pipes): context, no condition. */
  beforeInject: string[];
  /** Each pipe's connections since the stall, `ms` from the restore; a null first line is a probe. */
  requests: { hub: { ms: number; firstLine: string | null }[]; direct: { ms: number; firstLine: string | null }[] };
  /** B's own lines from the stall to the final read, both logs in time order (Decision Log 37): context, no condition. */
  bLines: BLine[];
}

const CONDITION_KINDS: readonly CaseLine['kind'][] = ['catch-up', 'attempt-failed', 'lane-spent', 'floor', 'acts-ahead'];
/** §F's sixth condition: at most 4 KiB written on the new channel ahead of the `sub`s. */
const ACTS_AHEAD_BYTES = 4_096;
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
  const streams: StreamTiming[] = [];
  for (const expected of input.expected) {
    const stood = before.get(expected.what);
    if (stood === undefined) continue; // named above
    const { id, what } = stood;
    const name = `subscription ${id} (${what})`;
    const { stream } = expected;
    const held = stream === null ? null : (input.held[stream] ?? null);
    const heldAt = held === null ? null : positionOf(held);
    if (subbed.some((r) => r.line.id === id && r.at >= stalledAt && r.at < restoredAt)) fail(`${name} was answered during the stall`);
    const answer = subbed.find((r) => r.line.id === id && r.at >= restoredAt);
    const answered = endpoint.find((r) => r.line.id === id && r.at >= restoredAt);
    // B's read for the resume starts at the row before the cursor (`afterSeq: seq - 1`, src/shared/host/stream-catchup.ts)
    const reads = stream === null ? [] : journal.filter((r) => r.line.app === stream && r.at >= restoredAt);
    const read = heldAt === null ? reads[0] : reads.find((r) => r.line.after === heldAt.seq - 1);
    // a stream's content resumes with an event after its replay; a feed's with its snapshot, recorded only
    const first = answer === undefined ? undefined : firsts.find((r) => r.line.id === id && r.at >= answer.at && (stream === null || r.line.delivery === 'event'));
    // §L's bound on the read's rows: at most CHECKPOINT_ROWS before the cursor plus the page's. The journal is read row by
    // row with no gap (seq after seq), so a read counts the rows from the checkpoint's next row (or the first) through the
    // row it reads ahead; the page's part, the rows from the cursor's row through that look-ahead, is what B's journal
    // holds there (`pageRows`), never the count under test. A read without a checkpoint's suffix past the first boundary
    // (today's scan, or a failed checkpoint read's fallback, which counts both attempts) is over the bound by its own count.
    const page = stream === null ? undefined : input.pageRows[stream];
    const bound = page === undefined ? null : CHECKPOINT_ROWS + page;
    subscriptions.push({
      id,
      what,
      stream,
      before: { mode: stood.mode, position: stood.position },
      held,
      after: answer === undefined ? null : { mode: answer.line.mode, position: answer.line.position, asked: answer.line.asked, ms: ms(answer.at) },
      endpoint: answered === undefined ? null : { mode: answered.line.mode, asked: answered.line.asked, ms: answered.line.ms },
      journal: read === undefined ? null : { after: read.line.after, rows: read.line.rows, ms: read.line.ms, checkpoint: read.line.checkpoint, bound },
      first: first === undefined ? null : { delivery: first.line.delivery, position: first.line.position, ms: ms(first.at) },
    });
    if (stream !== null) {
      const jMs = answered?.line.ms ?? null;
      const journalMs = read?.line.ms ?? null;
      streams.push({ app: stream, id, jMs, journalMs, remainderMs: jMs === null || journalMs === null ? null : jMs - journalMs });
    }
    if (answer === undefined) {
      fail(`${name} has no subbed line after the restore`);
      continue;
    }
    if (stream !== null) {
      // a stream resumes from the cursor it held: a replay asked from exactly it, read on B from that cursor's row, and
      // its content going on after it
      if (answer.line.mode !== 'replay') fail(`${name} answered ${answer.line.mode}, not replay`);
      if (held === null) fail(`${name} has no cursor established before the stall`);
      else if (answer.line.asked !== held) fail(`${name} asked from ${answer.line.asked}, not from ${held}, the cursor it held`);
      if (reads.length === 0) fail(`B's host.log has no session.events ${stream} … from the journal line after the restore: the stream's cursor is not shown evicted`);
      else if (read === undefined && heldAt !== null) fail(`B's host.log read session.events ${stream} from the journal after ${reads.map((r) => r.line.after ?? 'start').join(', ')}, not after ${heldAt.seq - 1}, the row before the cursor it held`);
      if (read !== undefined && bound === null) fail(`B's read of session.events ${stream} after ${read.line.after ?? 'start'} took ${read.line.rows} rows, and the page's rows on B past the cursor were not established: no bound to hold them to`);
      else if (read !== undefined && bound !== null && read.line.rows > bound) {
        const from = read.line.checkpoint === null ? 'read from the first row' : `read from the checkpoint at seq ${read.line.checkpoint}`;
        fail(`B's read of session.events ${stream} after ${read.line.after} took ${read.line.rows} rows, over its bound of ${bound}: ${CHECKPOINT_ROWS} rows (CHECKPOINT_ROWS) plus the page's ${page}, the rows B's journal holds from the cursor through the page's look-ahead row, ${from}`);
      }
      // Decision Log 39 (b): no pane reads its session's whole launch (`after start`) on B between the restore and that
      // session's `subbed`, where the read contends with the stream's opening; B writes the line at the read's end
      const subbedAt = answered?.at ?? answer.at;
      for (const r of reads.filter((r) => r.line.after === null && r.at - r.line.ms < subbedAt)) {
        fail(`${name}: B read its session's whole launch (session.events ${stream} after start, ${r.line.rows} rows in ${r.line.ms} ms, from +${ms(r.at - r.line.ms)} ms to +${ms(r.at)} ms) before B's subbed at +${ms(subbedAt)} ms`);
      }
      const firstAt = first === undefined ? null : positionOf(first.line.position);
      if (first === undefined) fail(`${name} has no first event after subbed line after its subbed`);
      else if (heldAt !== null && firstAt !== null && !behind(heldAt, firstAt)) fail(`${name}'s first event after subbed is at ${first.line.position}, not after ${held}, the cursor it held`);
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
  // §F's lines, from the inject, where its window opens; the lane adopted is the one the link came up over after the
  // restore (the case's carrier when it came up over none). A catch-up is a condition whatever its lane; a lane's failed
  // attempt or spent line is one for the lane adopted and the other lane's otherwise; acts ahead are one past 4 KiB.
  // The floor, today's failed attempts and acts within 4 KiB are context
  const adopted = up?.line.carrier ?? carrier;
  const classOf = ({ line }: Read): 'condition' | 'otherLane' | 'windowContext' => {
    if (line.kind === 'catch-up') return 'condition';
    if (line.kind === 'acts-ahead') return line.bytes > ACTS_AHEAD_BYTES ? 'condition' : 'windowContext';
    const lane = line.kind === 'attempt-failed' ? line.which : line.kind === 'lane-spent' ? line.lane : null;
    if (lane === 'direct' || lane === 'relay') return lane === adopted ? 'condition' : 'otherLane';
    return 'windowContext'; // the floor, today's attempt
  };
  const timed = (r: Read) => `${ms(r.at) >= 0 ? '+' : ''}${ms(r.at)} ms ${linkText(ref, r.text)}`;
  const conditionLines = link.filter((r) => CONDITION_KINDS.includes(r.line.kind));
  const windowed = conditionLines.filter(since(injectedAt));
  const ofClass = (name: ReturnType<typeof classOf>) => windowed.filter((r) => classOf(r) === name).map(timed);
  const bLines = [...input.endpoint.map((l) => ({ l, log: 'mawsd' as const })), ...input.host.map((l) => ({ l, log: 'host' as const }))]
    .filter(({ l }) => l.at >= stalledAt)
    .sort((x, y) => x.l.at - y.l.at)
    .flatMap(({ l, log }): BLine[] => {
      const kind = B_LINES.find(({ pattern }) => pattern.test(l.text))?.kind;
      return kind === undefined ? [] : [{ ms: ms(l.at), log, kind, text: l.text }];
    });
  const record: WakeRecord = {
    carrier,
    waitMs: restoredAt - injectedAt,
    stallMs: restoredAt - stalledAt,
    wake: wake?.text ?? null,
    linkWake: linkWake === undefined ? null : linkText(ref, linkWake.text),
    feedWake: feedWake?.text ?? null,
    lost: kindOf(link, 'lost')
      .filter((r) => r.at >= stalledAt && r.at < restoredAt)
      .map((r) => linkText(ref, r.text)),
    upMs: up === undefined ? null : ms(up.at),
    lastSubbedMs: answeredMs.length === 0 ? null : Math.max(...answeredMs),
    subscriptions,
    streams,
    feed: { connectedMs: connected === undefined ? null : ms(connected.at, hubRestoredAt), lastPageMs: lastPage === undefined ? null : ms(lastPage.at, hubRestoredAt), records: lastPage?.line.records ?? null, pages: lastPage?.line.pages ?? null },
    upgrades,
    feedOpens,
    conditions: ofClass('condition'),
    otherLane: ofClass('otherLane'),
    windowContext: ofClass('windowContext'),
    beforeInject: conditionLines.filter((r) => r.at >= stalledAt && r.at < injectedAt).map(timed),
    requests: { hub: hub.map((r) => ({ ms: ms(r.at), firstLine: r.firstLine })), direct: direct.map((r) => ({ ms: ms(r.at), firstLine: r.firstLine })) },
    bLines,
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

/** The plain miss's `expect` message: the bounds, and each stream's `J` beside the miss, as context and no label. */
export function boundMissMessage(records: readonly WakeRecord[]): string {
  const js = records.map((r) => `${r.carrier} ${r.streams.map((s) => `${s.app} ${s.jMs === null ? 'none' : `${s.jMs} ms`}`).join(', ')}`);
  return `every subscription within ${WAKE_CASE.linkWithinMs / 1_000} s of the restore and the feed within ${WAKE_CASE.feedWithinMs / 1_000} s of the hub’s, per carrier; each stream's J: ${js.join('; ')}`;
}

export interface BesideInput {
  carrier: Carrier;
  ref: string;
  /** The bare app id of the live session: its stream resumes at the restore. */
  live: string;
  /** Every session whose pane the case opened (the live one among them): each first read shows before the stall. */
  sessions: readonly string[];
  /** A's main.log, B's mawsd.log and host.log, whole. */
  main: readonly LogLine[];
  endpoint: readonly LogLine[];
  host: readonly LogLine[];
  launchedAt: number;
  stalledAt: number;
  restoredAt: number;
}

// A's history reads of B's sessions, by their timing lines (src/main/lane-b/remote-timing.ts): the start, said before
// the first page goes out, and the end
const HISTORY_ASKED = /^(?:\[lane-b\] )?lane B: timing history B\/(\S+): asked$/;
const HISTORY_READ = /^(?:\[lane-b\] )?lane B: timing history B\/(\S+): (?:whole|paged|budgeted window|budgeted launch), \d+ pages, \d+ bytes, \d+ ms$/;

/** A's history reads of B's sessions in main.log from `from` until `to`: each start and end, by bare app id. */
function historyLines(main: readonly LogLine[], from: number, to: number): { asks: { app: string; at: number }[]; ends: { app: string; at: number }[] } {
  const asks: { app: string; at: number }[] = [];
  const ends: { app: string; at: number }[] = [];
  for (const { at, text } of main) {
    if (at < from || at >= to) continue;
    const start = HISTORY_ASKED.exec(text);
    if (start !== null) asks.push({ app: start[1]!, at });
    const end = HISTORY_READ.exec(text);
    if (end !== null) ends.push({ app: end[1]!, at });
  }
  return { asks, ends };
}

/** Of `apps`, those main.log shows no history read of from `from` until `to`: a start line with its end after it. */
export function historySeen(main: readonly LogLine[], apps: readonly string[], from: number, to: number): string[] {
  const { asks, ends } = historyLines(main, from, to);
  return apps.filter((app) => !asks.some((ask) => ask.app === app && ends.some((end) => end.app === app && end.at >= ask.at)));
}

/**
 * The case's verdict on its bounded wait for the reading: the reading's failures when the wait completed (nothing in
 * flight, its observation period over); otherwise why it did not, since the last read that answered may be an early
 * one that every later read failed to repeat.
 */
export function besideOutcome(bounded: { done: boolean; last: { failures: string[]; inFlight: string[] } | null; error: string | null }, withinMs: number): string[] {
  const { done, last, error } = bounded;
  if (done && last !== null) return [...last.failures, ...last.inFlight.map((r) => `still in flight: ${r}`)];
  const why = error ?? (last === null ? 'no answer' : last.inFlight.length > 0 ? `still in flight: ${last.inFlight.join(', ')}` : 'its observation period did not end');
  return [`the reading did not complete within ${withinMs} ms: ${why}`];
}

/**
 * A5's reading. It stands on each opened session's first read before the stall: without those start lines (a timing
 * log not reached, a changed format) it would see no read at all. `failures`: each history read A asked of B (its start line, whatever B answers it from: its ring, its
 * journal or disk) between the restore and A's `subbed` of the live session's stream; and each whole-launch read on B
 * (`session.events <app> after start`) between the restore and B's own `subbed` of it, which B writes at the read's end,
 * so one that began before that subbed and ended after the restore counts. `inFlight`: each read asked since the restore
 * with no end line yet. The tab beside the live one reads at main's settled word, which follows A's subbed.
 */
export function historyReadsBeside(input: BesideInput): { failures: string[]; inFlight: string[] } {
  const { carrier, ref, live, restoredAt } = input;
  const what = `session B:${live}`;
  const ms = (at: number) => at - restoredAt;
  const failures: string[] = [];
  const heard = kindOf(readAll(input.main).filter(ofLink(ref)), 'subbed').find((r) => r.line.what === what && r.at >= restoredAt);
  const answered = kindOf(readAll(input.endpoint), 'endpoint-subbed').find((r) => r.line.what === what && r.at >= restoredAt);
  if (heard === undefined) failures.push(`${carrier}: main.log has no subscription … ${what}: subbed line after the restore`);
  if (answered === undefined) failures.push(`${carrier}: B's mawsd.log has no sub … ${what}: subbed line after the restore`);
  for (const app of historySeen(input.main, input.sessions, input.launchedAt, input.stalledAt)) {
    failures.push(`${carrier}: main.log has no history read of session ${app} between the launch and the stall (an asked line and its end): the check would see no read`);
  }
  const { asks, ends } = historyLines(input.main, restoredAt, Infinity);
  if (heard !== undefined) {
    for (const ask of asks.filter((a) => a.at < heard.at)) failures.push(`${carrier}: A asked B for session ${ask.app}'s history at +${ms(ask.at)} ms, before it heard B's subbed of the live session ${live} at +${ms(heard.at)} ms`);
  }
  if (answered !== undefined) {
    for (const r of kindOf(readAll(input.host), 'journal').filter((r) => r.line.after === null && r.at >= restoredAt && r.at - r.line.ms < answered.at)) {
      failures.push(`${carrier}: B read session ${r.line.app}'s whole launch (session.events ${r.line.app} after start, ${r.line.rows} rows in ${r.line.ms} ms, from +${ms(r.at - r.line.ms)} ms to +${ms(r.at)} ms) before B's subbed of the live session ${live} at +${ms(answered.at)} ms`);
    }
  }
  // each start paired with the first end of its session after it
  const unpaired = [...ends];
  const inFlight = asks.flatMap((ask) => {
    const end = unpaired.findIndex((e) => e.app === ask.app && e.at >= ask.at);
    if (end >= 0) {
      unpaired.splice(end, 1);
      return [];
    }
    return [`${ask.app} (asked at +${ms(ask.at)} ms)`];
  });
  return { failures, inFlight };
}

/** Whether main's log has the feed's `[org-feed] listings: last page` line at or after `from` (the hub's restore). */
export function lastPageIn(main: readonly LogLine[], from: number): boolean {
  return kindOf(readAll(main), 'feed-last-page').some((r) => r.at >= from);
}

/** The 1-minute load at or over which a read voids the run (Decision Log 33 (c), in the artifacts case's form). */
export const VOID_LOAD = 5;

/**
 * Where a carrier's 1-minute load is read, so that no timed window lies outside a pair of reads: at the inject, after the
 * last `subbed` (the link's window), at the hub's restore where it comes later (the direct launch's), after the feed's
 * last page is in (the feed's window), and after the final reading, where the evidence the verdict takes is fixed (a
 * line that came after a bounded wait gave up is still inside a pair of reads).
 */
export type LoadInstant = 'inject' | 'last subbed' | "hub's restore" | 'last page' | 'final';
export interface LoadRead {
  at: LoadInstant;
  load: number;
}
const INSTANT: Record<LoadInstant, string> = { inject: 'at the inject', 'last subbed': 'after the last subbed', "hub's restore": "at the hub's restore", 'last page': "after the feed's last page", final: 'after the final reading' };

export interface WakeVerdict {
  /** A window's read at VOID_LOAD or more: no verdict on the bounds either way. */
  void: boolean;
  /** A bound missed on a carrier whose `conditions` are not empty: outside §F's conditions, neither a breach nor a pass. */
  outside: boolean;
  /** True: every line and count there and every bound held; false: a line or count missing, or a bound missed inside the conditions; null: void, or only outside them. */
  pass: boolean | null;
  voidReasons: string[];
  /** The misses of carriers whose `conditions` are empty: a bound missed. */
  boundMisses: string[];
  /** The misses of carriers whose `conditions` are not empty, and those conditions, each with its carrier. */
  outsideMisses: string[];
  outsideConditions: string[];
}

/** The run's verdict from each carrier's record, each carrier's load reads, and the lines and counts it lacks. */
export function wakeVerdict(records: readonly WakeRecord[], loads: Partial<Record<Carrier, readonly LoadRead[]>>, failures: readonly string[]): WakeVerdict {
  const voidReasons = (Object.entries(loads) as [Carrier, readonly LoadRead[]][]).flatMap(([carrier, reads]) => {
    const over = reads.filter((r) => r.load >= VOID_LOAD);
    if (over.length === 0) return [];
    const all = reads.map((r) => `${r.load.toFixed(2)} ${INSTANT[r.at]}`).join(', ');
    return [`${carrier}: the 1-minute load read ${VOID_LOAD} or more ${over.map((r) => INSTANT[r.at]).join(' and ')} (${all})`];
  });
  const boundMisses: string[] = [];
  const outsideMisses: string[] = [];
  const outsideConditions: string[] = [];
  for (const record of records) {
    const misses = wakeMisses(record);
    if (misses.length === 0) continue;
    if (record.conditions.length === 0) boundMisses.push(...misses);
    else {
      outsideMisses.push(...misses);
      outsideConditions.push(...record.conditions.map((line) => `${record.carrier}: ${line}`));
    }
  }
  const isVoid = voidReasons.length > 0;
  const outside = outsideMisses.length > 0;
  const pass = isVoid ? null : failures.length > 0 || boundMisses.length > 0 ? false : outside ? null : true;
  return { void: isVoid, outside, pass, voidReasons, boundMisses, outsideMisses, outsideConditions };
}

/** The job log's line for one carrier. */
export function wakeSummary(record: WakeRecord): string {
  const f = (value: number | null) => (value === null ? 'none' : `${value} ms`);
  return `[remote-wake] ${record.carrier}: up ${f(record.upMs)} and last subbed ${f(record.lastSubbedMs)} after the restore; feed connected ${f(record.feed.connectedMs)} and last listings page ${f(record.feed.lastPageMs)} after the hub's restore; ${plural(record.upgrades, 'upgrade')}, ${plural(record.feedOpens, 'feed open')}`;
}

/**
 * The job log's line for one carrier's timing (Decision Log 37): the stall, the wait past B's resume window, the settle,
 * B's idle collections between the stall and the restore on each of its logs, and each stream's J/journal/remainder.
 */
export function wakeTimingSummary(record: WakeRecord, waits: { resumeWaitMs: number; settleMs: number }): string {
  const idle = (log: BLine['log']) => record.bLines.filter((l) => l.log === log && l.kind === 'idle-collected' && l.ms < 0).length;
  const f = (value: number | null) => (value === null ? 'none' : String(value));
  const streams = record.streams.map((s) => `${s.app} ${f(s.jMs)}/${f(s.journalMs)}/${f(s.remainderMs)}${s.remainderMs === null ? '' : ' ms'}`).join(', ');
  return `[remote-wake] ${record.carrier}: stalled ${record.stallMs} ms: waited ${waits.resumeWaitMs} ms until ${INJECT_AFTER_STALL_MS} ms after the stall, settled in ${waits.settleMs} ms, restored ${record.waitMs} ms after the inject; idle collections before the restore: ${idle('mawsd')} on mawsd, ${idle('host')} on the engine host; each stream's J/journal/remainder: ${streams}`;
}

/**
 * An event's place as the lines write a cursor, `<launch>:<seq>:<idx>`, from its id `<appSessionId>:<launchId>:<seq>:<i>`
 * (`eventPosition` in src/shared/host/stream-catchup.ts, which places every event a lane B stream sends by it); null for
 * an id of another session or of no launch.
 */
export function placeOfEvent(app: string, id: string): string | null {
  if (!id.startsWith(`${app}:`)) return null;
  const match = /^(.+):(\d+):(\d+)$/.exec(id.slice(app.length + 1));
  return match === null ? null : `${match[1]!}:${Number(match[2])}:${Number(match[3])}`;
}

/** The job log's line for a carrier whose launch left no record: every final read of its evidence failed. */
export function unavailableSummary(carrier: Carrier, why: string): string {
  return `[remote-wake] ${carrier}: evidence unavailable: main.log, B's logs or the pipes could not be read (${why})`;
}

/** Each marker `text` shows other than exactly once, with its count. */
export function markersNotOnce(text: string, markers: readonly string[]): { marker: string; count: number }[] {
  return markers.map((marker) => ({ marker, count: text.split(marker).length - 1 })).filter((m) => m.count !== 1);
}

/**
 * The file's load rule (Rule B, as the first test words it) over the wake case's 30 s samples and its end: printed as
 * context, it voids nothing of this case (Decision Log 33 (c)); `wakeVerdict` holds the case's own void rule.
 */
export function ruleBContext(loads: readonly number[], terminal: number | null): string[] {
  const load = loadVerdict(loads, terminal);
  if (!load.void) return [];
  const f = (value: number) => Number(value.toFixed(1));
  return [`the machine's load: peak ${f(load.peak)} at or over ${IDLE_RUN.maxLoad}, ${IDLE_RUN.everyS} s pair ${load.pair === null ? 'not rebuilt (under three samples)' : `${f(load.pair)} at or over ${IDLE_RUN.pairLoad}`} (Rule B)`];
}
