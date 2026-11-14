// Remote reads (O10 M8; RL3, RL §6.2; Interfaces §G): the gate's `call` executor. What reaches it is authorized: offered
// as a call, graded `list` or `view` (anything higher is an act, `act-required`), held by the caller on its target.
//   - Lane B's engine-host reads (`session.status`, `.events`, `.pendingRequest`, `.pendingItems`, `.queue.list`,
//     `.catalog`, and from P5 O7 M2 a remote pane's: the context, usage, settings, models, rules, MCP and cost reads) go
//     through `dispatch` to the engine host, and its answer is the result. A host error `host_unavailable` or `timeout`
//     is `unavailable`; any other code passes through. P5 O7 M8: `fs.unfollow` goes only to an engine host whose
//     welcome lists `host.followOwners`, which lets go of the caller's own hold alone; an older one, which stops the
//     named follow whoever asks, is not asked (`unavailable`).
//   - Lane A's `sminos.rows`, `.diff`, `.output` and `.read` go down RL10 as DX2's frames on the caller's own upstream
//     subscription (named by the caller's `sub` on that session), as the hub carried a browser's: sminos answers on that
//     subscription, so the answer comes in its stream at its place in the sequence, and the result says it was asked.
//   - `endpoint.listings` answers the signed listing of every session on the machine the member holds `list` or more
//     on: the one the hub holds when it is current, else one signed for the asker alone. A `private` session's listing
//     leaves the machine only so, to its owners and shares (RL §6.2).
//   - `daemon.status` is `mawsd`'s (O2, graded `list`): its status through `dispatch`, less every field the schema marks
//     local-only (`remoteDaemonStatus`: file paths). Any other `machine` row (P5 O7 M2: a lane B session's record, app
//     events and history; O6's `machine.identity`) goes through `dispatch` to the machine's services as an engine-host
//     row goes to the engine host; anything else answers `unavailable`.
//   - P5 O7 M6: an `each-session` row (`attention.list`, `session.search`), admitted at `list` for the machine, answers for
//     every session: its input is held to the registry's schema here (authorization's step 2 skips a row that carries its
//     own grade), the machine's services answer it, and the answer keeps only the sessions the caller holds the
//     registry's grade on (`view`), each placed by its record. The cut is made as the answer goes, in one synchronous
//     step, against the records as they stand then. No placement widens a caller's rights (fix wave 2): a session is kept
//     only when the caller holds the grade on every placement the call saw of it, `session.get`'s answer and each one a
//     `session.changed` gave while the call was out, since neither is known to be the newer (the index publishes its
//     changes on a coalescing tick, so its live read can be ahead of what was heard). A caller below the floor learns
//     nothing of another session. A session the spine can't place answers `unavailable`. `session.search` answers at most
//     SESSION_SEARCH_LIMIT hits, so its input names the sessions the caller views (`sessions`, from `session.list`'s
//     records), applied by the store before its limit; a full page the cut still took hits from says `incomplete`.
//   - P5 O8 M7b: `channel.history` takes the same shape over a project's to-human entries, its cut lane-aware
//     (channel-view.ts): a lane A entry ranked by its engine session's sminos record, a lane B one by its app session's
//     placements; the journal is read until the caller's page is full of entries they view, or it ends. Fix wave: a
//     project that isn't the org's answers no entries (asked, and as it goes); each entry goes under its opaque cursor
//     (channel-cursors.ts), and a `before` is one: one the endpoint didn't seal for the project, or of an entry the
//     caller doesn't view, answers no entries, after the one placement read either takes; the page goes only while all it
//     read still stands and nothing it passed by is viewable (else it is read again, `unavailable` past HISTORY_READS),
//     and a read goes on to the journal's end (or is `unavailable` past its bound), so `more` is exact.
//   - P5 O7 M5a: `library.list` takes the same shape over its rows: each row's own sessions (`LibraryRowSchema.sessions`,
//     the index's view of the artifact's links) are what it names, and a row is kept when the caller holds `view` on its
//     artifact by the `artifact` rule's predicate (artifacts.ts' `holdsArtifact`): on any one of its sessions, at every
//     placement the call saw of that session; a row with no session is the machine owners' alone. A machine owner holds
//     every artifact, so keeps every row. The listing is asked without its `kind`, so the counts per kind a caller is
//     answered are those of the rows it keeps, never of the machine's. The artifact rule's reads (`artifacts.get` and its kin) are answered as
//     their executor answers, their decision having placed the artifact.
//   - P5 O7 M5a2 fix wave 1: what an artifact answer says of sessions the caller doesn't view is withheld as it goes
//     (session-safe.ts): the reads that name sessions (SESSION_NAMING) through `SessionSafe`, `library.list`'s kept rows
//     through the same projection over its own placements; a listing filtered by a session the caller doesn't view
//     lists nothing, as one by a session nobody minted does (an id is never a capability). Fix wave 2: the machine's
//     owners too, whose rows are kept whole but told nothing of a member's private session.
//   - P5 O7 M5c: a page's lease reads go to the machine's services as any `machine` row; an open is kept with its artifact
//     in the channel's table (leases.ts), which holds at most LEASES_KEPT (an open past it `busy`, before the machine
//     hears it), and a close the machine answered drops it. `delivery.receipts`, admitted at `list`, keeps each receipt
//     whose artifact the member holds `view` on by the `artifact` rule's predicate, decided as the answer goes against the
//     placements the channel's cache holds then (a placement dropped meanwhile withholds its rows). `client.windowShown`
//     is the endpoint's own: the device's window report, `connectors.windowShown` under the channel's ref.
//   - P5 O7 M5c round 3: `artifacts.holdAssets` and `artifacts.releaseAssets` are the endpoint's own too: a remote
//     dashboard's snapshot holds, taken on the engine host and kept per channel (asset-holds.ts).
//   - P5 O7 M9: `machine.folders.list` goes to the machine's services as any `machine` row; one with `open: true` that
//     they answered keeps the protected folder it read in as opened by the caller (policy.ts' `MachineSetup`), which the
//     setup policy then lets them register a folder in. `session.trust.check` is asked of the machine as
//     `machine.setupTrust` on the directory the setup policy resolved and checked (`Granted.setup`), never the input.
//   - P5 O7 M5c review 1: an acquisition (`connectors.open`, `artifacts.holdAssets`) is bounded from the call's arrival
//     under the device's call deadline (acquire.ts): past it the call answers `timeout`, and what the machine answers
//     after it is let go of at once (the lease closed, the hold released) under the channel's ref.
//   - P5 O8 M6a: every `machine` request a call makes is read and written as the decision's reader (readers.ts), so
//     `session.get` answers the caller's own reading and `session.reader.update` writes and answers it. A member's
//     update that the machine took tells that member's other devices (`readerMoved`), as the spine's own change tells
//     the owners'. Fix wave F1: a reader's own request (READER_ROUTED) goes to the machine only while the decision that
//     named its reader stands, asked in the step it goes (the machine's owners may have changed since: an ex-owner must
//     never read or write as the owners); one that moved is decided again, once, through the gate, then `unavailable`.
//   - P5 O8 M6b: `record.policy` is the endpoint's own: the policies of the sessions the caller owns (`manage`), or of the
//     one named, read from sminos's member frames (record-policy.ts), decided as the answer goes against the ranks then;
//     `{supported: false}` while the connected sminos doesn't advertise `record`, `unavailable` with none connected.
//   - P5 O8 M4b: `endpoint.grants` is the endpoint's own: the machine's grant ledger read back, the caller's own entry, or
//     every member's for an owner of the machine (an admin, for an org-owned one), made as the answer goes from the head
//     the owners were read under (grants.ts' `grantsAnswer`), `unavailable` once that head moved.
// Every dispatch carries the asking channel's `ClientRef` (P5 O7 M2). A result over the channel's message limit answers
// `too-large`. For a device that listed `rl2.bytes` (P5 O7 M5a), the input came decoded (gate.ts) and the output goes in the
// bytes codec's tagged form (bytes.ts), measured so.
import { randomUUID } from 'node:crypto';
import { MESSAGE_MAX_BYTES, type CallMessage, type Listing, type Signed } from 'org-protocol';
import { ACQUIRE_WITHIN_MS, LATE, within } from './acquire';
import { FOLLOW_OWNERS_CAPABILITY } from '@shared/host/socket-protocol';
import { gradeOf, type SessionRank } from '@shared/ipc/grades';
import { remoteDaemonStatus, type DaemonStatus } from '@shared/ipc/schema/daemon';
import { SESSION_SEARCH_LIMIT, SESSION_SEARCH_SESSIONS_MAX } from '@shared/ipc/schema/session';
import { HISTORY_LIMIT_MAX, type HostEntry } from '@shared/ipc/schema/channel';
import { holdsArtifact, type ArtifactRanks, type CachedPlacement } from './artifacts';
import { holdsToSchema, type SessionRanks } from './authorize';
import type { ChannelCursors } from './channel-cursors';
import { PlacementBook, publish, readViewable, viewable, type EntrySession } from './channel-view';
import { writeBytes } from './bytes';
import type { RemoteChannel } from './channels';
import type { Granted } from './gate';
import { isSessionRank, rankAtLeast, sessionRank } from './grades';
import type { AssetHolds } from './asset-holds';
import type { Leases } from './leases';
import type { SessionReport } from './listings';
import { OFFERS, type Offers } from './offers';
import { READER_ROUTED } from './readers';
import { placeListings, policies, unsupported, type HeldSession } from './record-policy';
import type { MachineSetup } from './policy';
import type { Member, RecordSays } from './rl10/members';
import { dispatchAs, type EndpointServices } from './services';
import type { RecordSource, SessionTarget } from './sources';
import { namedSessions, projectSessions, SESSION_NAMING, type SessionSafe } from './session-safe';
import { namesSession, type SessionSubscription, type Subscription } from './subscriptions';
import { placeRecorded, recordedPlacement, type Placement, type RecordPlacement } from './targets';

export type CallsContext = {
  dispatch: EndpointServices['dispatch'];
  /** The caller's subscription by its id, and the upstream it holds (lane A). */
  subscription(channel: RemoteChannel, sub: string): Subscription | null;
  upstreamOf(sub: SessionSubscription): { epoch: string; project: string; session: string; agentId: string | null } | null;
  /** A frame down RL10 to sminos. */
  toSminos(frame: object): void;
  /** The machine's sessions as sminos reports them, each with the id it is listed under (null: not yet). */
  members(): Array<{ member: Member; listingId: string | null; target: SessionTarget }>;
  records: RecordSource;
  machineOwners(): Promise<string[]>;
  recordFor(report: SessionReport): Promise<Signed<Listing> | null>;
  /** U9: what a lane B session's spine record says of its listing (rl10/members.ts' `recordSays`); absent in a suite. */
  recordSays?(listingId: string): RecordSays | null;
  /** P5 O7 M6: the member's ranks on the machine's sessions (`Authorizer.ranks`), for the `each-session` cut. */
  ranks(member: string): Promise<SessionRanks>;
  /** P5 O7 M5a2 fix wave 1: what an artifact answer says of sessions (session-safe.ts). */
  sessionSafe: SessionSafe;
  /** P5 O7 M5c: the leases each channel holds (leases.ts), and the `artifact` rule's placements (`delivery.receipts`' cut). */
  leases: Leases;
  artifacts: ArtifactRanks;
  /** P5 O7 M5c round 3: each channel's snapshot holds (asset-holds.ts). */
  assetHolds: Pick<AssetHolds, 'hold' | 'release'>;
  offers?: Offers;
  /** P5 O7 M5c review 1: the clock an acquisition's bound is read on (the gate's), and the bound (acquire.ts). */
  now(): number;
  acquireWithinMs?: number;
  /** P5 O7 M8: whether the engine host's welcome lists `capability` now (EndpointServices.engineHostLists). */
  engineHostLists(capability: string): boolean;
  /** P5 O7 M9: the folders each member opened (the authorizer's own); absent, none is kept. */
  setup?: Pick<MachineSetup, 'listed'>;
  /** P5 O8 M7b fix wave: `channel.history`'s entries' cursors. */
  cursors: Pick<ChannelCursors, 'seal' | 'open'>;
  /** P5 O8 M6a: a member's own reading of a session changed (their `session.reader.update`), for their other devices. */
  readerMoved?(member: string, appSessionId: string): void;
  /**
   * P5 O8 M6b: what the connected sminos's hello advertised (null: none connected), and where a lane B listing's record is,
   * as the record acts place it (targets.ts' `placeRecord`), for `record.policy`.
   */
  sminos?(): readonly string[] | null;
  placeRecord?(appSessionId: string): Promise<RecordPlacement>;
  /** P5 O8 M4b: `endpoint.grants` for `member`, the step that makes its answer as it goes (grants.ts' `grantsAnswer`). */
  grants?(member: string): Promise<() => Result>;
  log(line: string): void;
};

/** How many reads a `channel.history` answer may take, what one read moving before it went, before it answers `unavailable`. */
export const HISTORY_READS = 3;

type Fields = Record<string, unknown>;
type Result = { ok: true; output: unknown } | { ok: false; code: string; message?: string };
/**
 * P5 O7 M8: a forwarded failure's message reaches the device as the local IPC carries it (a missing file's `not found:
 * <path>` and the files service's refusal answer one code, `internal`, told apart by the message), at most this many
 * characters of it.
 */
export const FAILURE_MESSAGE_MAX = 512;
/** `message` within FAILURE_MESSAGE_MAX UTF-16 units, never cut between a surrogate pair's halves. */
export function failureMessage(message: string): string {
  if (message.length <= FAILURE_MESSAGE_MAX) return message;
  const end = /[\uD800-\uDBFF]/.test(message[FAILURE_MESSAGE_MAX - 1]) ? FAILURE_MESSAGE_MAX - 1 : FAILURE_MESSAGE_MAX;
  return message.slice(0, end);
}
const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown, max = 256): v is string => typeof v === 'string' && v !== '' && v.length <= max;
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;

/**
 * Lane A's reads: each one's fields beside `session` and `sub`, and their checks (DX2's frames), held to the limits
 * sminos's plane holds them to (`sminos_plane.py`: TASK_ID, OUTPUT_TAIL_MAX, READ_ID_MAX, READ_WHAT, READ_ARGS_MAX). A
 * frame past them sminos passes by unanswered, so it is refused here, `malformed`, rather than said to be asked.
 */
const TASK_ID = /^[A-Za-z0-9_-]{1,64}$/;
const READ_WHAT = /^[a-z-]{1,32}$/;
const LANE_A: Record<string, { fields: Record<string, (v: unknown) => boolean>; optional?: Record<string, (v: unknown) => boolean>; agent: boolean }> = {
  'sminos.rows': { fields: { before: (v) => isText(v), limit: (v) => isInt(v, 1, 1000) }, agent: true },
  'sminos.diff': { fields: {}, agent: false },
  'sminos.output': { fields: { taskId: (v) => typeof v === 'string' && TASK_ID.test(v), tail: (v) => isInt(v, 1, 524_288) }, agent: true },
  'sminos.read': { fields: { id: (v) => isText(v, 64), what: (v) => typeof v === 'string' && READ_WHAT.test(v) }, optional: { args: (v) => isObject(v) && pythonJsonLength(v) <= 4096 }, agent: true },
};

/**
 * The length of `json.dumps(value)` in Python, as sminos measures a read's args (`len(json.dumps(args))`): `", "` and
 * `": "` between items, every character outside space..tilde escaped (`\u007f` and non-ASCII as `\uXXXX`, an astral
 * one as two), and a float as Python's repr writes it (`1e-07`, `1e-05`, where JavaScript writes `1e-7`, `0.00001`).
 */
function pythonJsonLength(value: unknown): number {
  if (typeof value === 'string') return pythonStringLength(value);
  if (typeof value === 'number') return pythonNumber(value).length;
  if (value === null || typeof value !== 'object') return (JSON.stringify(value) ?? 'null').length;
  const items = Array.isArray(value) ? value.map((v) => pythonJsonLength(v)) : Object.entries(value).map(([k, v]) => pythonStringLength(k) + 2 + pythonJsonLength(v));
  return 2 + items.reduce((a, b) => a + b, 0) + Math.max(0, items.length - 1) * 2;
}

function pythonStringLength(text: string): number {
  let n = 2;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x22 || c === 0x5c || c === 0x08 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d) n += 2;
    else n += c >= 0x20 && c <= 0x7e ? 1 : 6;
  }
  return n;
}

/** A JSON number as Python reads and writes it back: an integer as is; a float in repr's form. */
function pythonNumber(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const [mantissa, exponent] = v.toExponential().split('e');
  const e = Number(exponent);
  return e < -4 || e >= 16 ? `${mantissa}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}` : String(v);
}

/** A reader's own request whose decision moved before it went (fix wave F1): the call is decided again. */
class DecisionMoved extends Error {}

const sessionOf = (v: unknown): string | null => (isObject(v) && isText(v.appSessionId, 512) ? v.appSessionId : null);

/**
 * P5 O7 M6: each `each-session` row's answer, by the sessions it names: `attention.list`'s items, `session.search`'s
 * hits, each by its `appSessionId`; `keep` answers it with only what `kept` holds (a part naming no session is dropped).
 * `narrow`: the input naming the sessions the caller views, for a read that answers at most a limit of them, so the
 * limit is spent on those (milestone fix: `session.search`'s 50 hits); the cut stays the authorization.
 * P5 O7 M5a: `ask`, the input the machine is asked for; `keep` is told whether the caller owns the machine (the `artifact`
 * rule's short cut, which holds every row for them), and what they asked.
 * The UX wave (U9): `grade`, the rank the cut holds the caller to when it is not the command's own declared grade (the
 * archived sessions' read, `session.list`, admitted and declared at `list`, keeps only the archived records they hold
 * `manage` on).
 */
type EachSession = {
  grade?: SessionRank;
  sessions(output: unknown, input: unknown): string[];
  keep(output: unknown, kept: (id: string | null) => boolean, ownsMachine: boolean, input: unknown): unknown;
  narrow?(input: Fields, sessions: string[]): Fields;
  ask?(input: unknown): unknown;
};
const rowsOf = (output: unknown): Fields[] => (isObject(output) && Array.isArray(output.rows) ? output.rows.filter(isObject) : []);
const rowSessions = (row: Fields): string[] => (Array.isArray(row.sessions) ? row.sessions.map(sessionOf).filter((id) => id !== null) : []);
/**
 * A caller's library listing, asked without its `kind` (`ask`): the counts are the kept rows', and the rows the kind's.
 */
/** The session a library listing is filtered by (`filter.appSessionId`), if any. */
const filteredBy = (input: unknown): string | null => (isObject(input) && isObject(input.filter) && isText(input.filter.appSessionId, 512) ? input.filter.appSessionId : null);

function keptByKind(output: Fields, input: unknown): Fields {
  const rows = rowsOf(output);
  const kind = isObject(input) && isObject(input.filter) ? input.filter.kind : undefined;
  const counts = Object.fromEntries(Object.keys(isObject(output.counts) ? output.counts : {}).map((k) => [k, rows.filter((row) => row.kind === k).length]));
  return { ...output, rows: kind === undefined ? rows : rows.filter((row) => row.kind === kind), counts };
}

/** The archived records of a `session.list` answer, each naming its app session. */
const archivedOf = (output: unknown): Array<Fields & { appId: string }> =>
  isObject(output) && Array.isArray(output.sessions) ? output.sessions.filter((record): record is Fields & { appId: string } => isObject(record) && isText(record.appId, 512) && record.archived === true) : [];

const EACH_SESSION: Record<string, EachSession> = {
  // The UX wave (U9, UC-7.4): the archived sessions' read behind Unarchive, each record kept for a caller who may manage
  // it, as its owners alone may unarchive it; the machine answers it under the caller's reader, so each kept record
  // carries their own reading. The read exists for Unarchive alone, so only archived records are kept: an unarchived one
  // never leaves the machine through it, and a machine's unarchived records (a remote spawn's carries its signed action)
  // never push the archived ones past the channel's ceiling (the whole-branch review's fix).
  'session.list': {
    grade: 'manage',
    sessions: (output) => archivedOf(output).map((record) => record.appId),
    keep: (output, kept) => (isObject(output) ? { ...output, sessions: archivedOf(output).filter((record) => kept(record.appId)) } : output),
  },
  'attention.list': {
    sessions: (output) => (Array.isArray(output) ? output.map(sessionOf).filter((id) => id !== null) : []),
    keep: (output, kept) => (Array.isArray(output) ? output.filter((item) => kept(sessionOf(item))) : []),
  },
  'session.search': {
    sessions: (output) => (isObject(output) && Array.isArray(output.hits) ? output.hits.map(sessionOf).filter((id) => id !== null) : []),
    // A full page the cut took hits from may have left matches of the caller's own unsearched: said `incomplete`.
    keep: (output, kept) => {
      if (!isObject(output)) return output;
      const hits = Array.isArray(output.hits) ? output.hits : [];
      const shown = hits.filter((hit) => kept(sessionOf(hit)));
      return { ...output, hits: shown, incomplete: output.incomplete === true || (hits.length >= SESSION_SEARCH_LIMIT && shown.length < hits.length) };
    },
    narrow: (input, sessions) => ({ ...input, sessions }),
  },
  // P5 O7 M5a: the library's rows, each kept by the `artifact` rule over its own sessions.
  'library.list': {
    // A row's own sessions (its cut), every other it names (its creator, its last editor), each placed for the
    // projection, and the session the listing is filtered by.
    sessions: (output, input) => [...namedSessions('library.list', output), ...(filteredBy(input) === null ? [] : [filteredBy(input)!])],
    keep: (output, kept, ownsMachine, input) => {
      if (!isObject(output)) return output;
      // A listing by a session the caller doesn't view lists nothing, as one by a session nobody minted, whoever asks:
      // an id is no way to learn what a hidden session touched.
      const by = filteredBy(input);
      const listed = by === null || kept(by) ? rowsOf(output) : [];
      // A machine owner holds every artifact, so keeps every row; what any row says of a session the caller doesn't
      // view is withheld, theirs too (session-safe.ts).
      const rows = listed.filter((row) => holdsArtifact({ sessions: rowSessions(row), orphan: rowSessions(row).length === 0 }, ownsMachine, (id) => kept(id)));
      const projected = projectSessions('library.list', { ...output, rows }, (id) => kept(id));
      return isObject(projected) ? keptByKind(projected, input) : projected;
    },
    ask: (input) => {
      if (!isObject(input) || !isObject(input.filter) || input.filter.kind === undefined) return input;
      const filter: Fields = { ...input.filter };
      delete filter.kind;
      return { ...input, filter };
    },
  },
};

export class Calls {
  /** Each `each-session` call in flight: every placement its sessions' records gave since its reads began. */
  readonly #heard = new Set<Map<string, Placement[]>>();
  /** P5 O8 M7b fix wave: each `channel.history` call in flight, its placements read by read (channel-view.ts). */
  readonly #books = new Set<PlacementBook>();

  constructor(private readonly ctx: CallsContext) {}

  /**
   * A machine event (`onEvent`): a session's record moved, which every `each-session` call in flight places it by; or,
   * for a `channel.history` call, was removed (placing the session nowhere).
   */
  event(owner: string, message: { name: string; payload: unknown }): void {
    if (owner !== 'machine' || !isObject(message.payload)) return;
    if (message.name === 'session.removed' && isText(message.payload.appSessionId, 512)) {
      for (const book of this.#books) book.heard(message.payload.appSessionId, null);
      return;
    }
    if (message.name !== 'session.changed' || (this.#heard.size === 0 && this.#books.size === 0)) return;
    const record = message.payload.record;
    if (!isObject(record) || !isText(record.appId, 512)) return;
    const placement = recordedPlacement(record.appId, record);
    for (const heard of this.#heard) heard.set(record.appId, [...(heard.get(record.appId) ?? []), placement]);
    for (const book of this.#books) book.heard(record.appId, placement);
  }

  /** An authorized call, answered by its executor; `decision.askedAt`, its arrival, bounds an acquisition (acquire.ts). */
  execute(channel: RemoteChannel, m: CallMessage, decision: Granted = {}): void {
    const offers = this.ctx.offers ?? OFFERS;
    const row = Object.hasOwn(offers.commands, m.name) ? offers.commands[m.name] : undefined;
    const answer = (result: Result) => {
      if (channel.closed) return;
      if (!result.ok) return void channel.send({ t: 'result', id: m.id, ok: false, error: { code: result.code, ...(result.message === undefined ? {} : { message: result.message }) } });
      const output = writeBytes(channel, result.output);
      if (Buffer.byteLength(JSON.stringify(output ?? null)) > MESSAGE_MAX_BYTES - 1024) return void channel.send({ t: 'result', id: m.id, ok: false, error: { code: 'too-large' } });
      channel.send({ t: 'result', id: m.id, ok: true, output });
    };
    const asReader = dispatchAs(this.ctx.dispatch, channel.client, decision.reader);
    const dispatch: EndpointServices['dispatch'] = (owner, name, input) => (owner === 'machine' && READER_ROUTED.has(name) && decision.stands?.() === false ? Promise.reject(new DecisionMoved()) : asReader(owner, name, input));
    // an acquisition's bound, from the call's arrival (acquire.ts), read by the two rows that acquire
    const by = () => (decision.askedAt ?? this.ctx.now()) + (this.ctx.acquireWithinMs ?? ACQUIRE_WITHIN_MS);
    // What runs answers a result, or (an `each-session` row) the step that makes it, taken as the answer goes.
    let run: Promise<Result | (() => Result)>;
    if (row?.target === 'each-session' && m.name === 'channel.history') run = this.#channelHistory(dispatch, channel.member, m);
    else if (row?.target === 'each-session') run = this.#eachSession(dispatch, channel.member, m);
    else if (m.name === 'connectors.open' && row?.executor === 'machine') run = this.#open(dispatch, channel, m, by());
    else if (m.name === 'connectors.close' && row?.executor === 'machine') run = this.#close(dispatch, channel, m);
    else if (m.name === 'delivery.receipts' && row?.executor === 'machine') run = this.#receipts(dispatch, channel, m);
    else if (m.name === 'client.windowShown' && row?.executor === 'endpoint') run = this.#windowShown(dispatch, m);
    else if (m.name === 'artifacts.holdAssets' && row?.executor === 'endpoint') run = this.ctx.assetHolds.hold(channel, m.input, by());
    else if (m.name === 'artifacts.releaseAssets' && row?.executor === 'endpoint') run = this.ctx.assetHolds.release(channel, m.input);
    else if ((row?.executor === 'engine-host' || row?.executor === 'machine') && row.target === 'artifact' && SESSION_NAMING.has(m.name)) run = this.#sessionSafe(dispatch, row.executor, channel.member, m);
    else if (m.name === 'fs.unfollow' && row?.executor === 'engine-host' && !this.ctx.engineHostLists(FOLLOW_OWNERS_CAPABILITY)) run = Promise.resolve(this.#unownedUnfollow());
    else if (m.name === 'machine.folders.list' && row?.executor === 'machine') run = this.#folders(dispatch, channel.member, m);
    else if (m.name === 'session.trust.check' && row?.executor === 'machine') run = this.#setupTrust(dispatch, m, decision);
    else if (m.name === 'session.projects.resolve' && row?.executor === 'machine') run = this.#resolve(dispatch, m, decision);
    else if (m.name === 'session.reader.update' && row?.executor === 'machine') run = this.#readerUpdate(dispatch, channel.member, m, decision);
    else if (row?.executor === 'engine-host' || (row?.executor === 'machine' && m.name !== 'daemon.status')) run = this.#forward(dispatch, row.executor, m);
    else if (row?.executor === 'sminos' && Object.hasOwn(LANE_A, m.name)) run = Promise.resolve(this.#laneA(channel, m));
    else if (row?.executor === 'machine') run = this.#daemonStatus(dispatch);
    else if (m.name === 'record.policy' && row?.executor === 'endpoint') run = this.#recordPolicy(channel.member, m.input);
    else if (m.name === 'endpoint.grants' && row?.executor === 'endpoint') run = this.ctx.grants?.(channel.member) ?? Promise.resolve({ ok: false, code: 'unavailable' });
    else if (m.name === 'endpoint.listings') run = this.#listings(channel.member).then((listings) => ({ ok: true as const, output: { listings } }));
    else run = Promise.resolve({ ok: false, code: 'unavailable' });
    run.then((result) => answer(typeof result === 'function' ? result() : result), (error: unknown) => {
      if (error instanceof DecisionMoved) return channel.closed ? undefined : decision.again === undefined ? answer({ ok: false, code: 'unavailable' }) : decision.again();
      this.ctx.log(`endpoint: a \`${m.name.slice(0, 64)}\` call failed: ${(error as Error).message}`);
      answer({ ok: false, code: 'unavailable' });
    });
  }

  /** P5 O7 M8: a remote unfollow an engine host without follow ownership would apply to every client's follow. */
  #unownedUnfollow(): Result {
    this.ctx.log(`endpoint: the engine host does not list \`${FOLLOW_OWNERS_CAPABILITY}\`: a remote \`fs.unfollow\` answered unavailable, since it would stop another client's follow`);
    return { ok: false, code: 'unavailable' };
  }

  /** P5 O8 M6a: a reader's update, which a member's other devices hear of once the machine took it (an owner's, the spine says). */
  async #readerUpdate(dispatch: EndpointServices['dispatch'], member: string, m: CallMessage, decision: Granted): Promise<Result> {
    const result = await this.#forward(dispatch, 'machine', m);
    const appSessionId = result.ok ? sessionOf(result.output) : null;
    if (appSessionId !== null && decision.reader !== undefined && decision.reader !== 'owner') this.ctx.readerMoved?.(member, appSessionId);
    return result;
  }

  /** P5 O7 M9: the folder list, an answered open kept as the caller's. */
  async #folders(dispatch: EndpointServices['dispatch'], member: string, m: CallMessage): Promise<Result> {
    const result = await this.#forward(dispatch, 'machine', m);
    if (result.ok) await this.ctx.setup?.listed(member, m.input);
    return result;
  }

  /** P5 O7 M9: a remote trust read, on the directory the setup policy checked (`machine.setupTrust`, guarded again there). */
  #setupTrust(dispatch: EndpointServices['dispatch'], m: CallMessage, decision: Granted): Promise<Result> {
    if (decision.setup === undefined) return Promise.resolve({ ok: false, code: 'unavailable' });
    return this.#forward(dispatch, 'machine', { ...m, name: 'machine.setupTrust', input: { directory: decision.setup.directory, opened: decision.setup.opened } });
  }

  /**
   * The project registry: the rule's answer for a directory, on the directory the setup policy resolved and checked, read
   * there through the asking member's opens (M9's review 1, F1).
   */
  #resolve(dispatch: EndpointServices['dispatch'], m: CallMessage, decision: Granted): Promise<Result> {
    if (decision.setup === undefined) return Promise.resolve({ ok: false, code: 'unavailable' });
    return this.#forward(dispatch, 'machine', { ...m, input: { directory: decision.setup.directory, opened: decision.setup.opened } });
  }

  /** A read its executor answers raw: the engine host's, or the machine's services', a failure with its message (M8). */
  async #forward(dispatch: EndpointServices['dispatch'], owner: 'engine-host' | 'machine', m: CallMessage): Promise<Result> {
    const response = await dispatch(owner, m.name, m.input === null ? undefined : m.input);
    if (response.ok) return { ok: true, output: response.value ?? null };
    const code = response.error.code === 'host_unavailable' || response.error.code === 'timeout' ? 'unavailable' : response.error.code;
    const message = response.error.message;
    return { ok: false, code, ...(typeof message === 'string' && message !== '' ? { message: failureMessage(message) } : {}) };
  }

  /**
   * P5 O7 M5c: a page's lease, opened for this channel's ref and kept with its artifact (leases.ts); `busy` past the bound.
   * Review 1: answered `timeout` past `by`, a lease the machine opens after it closed at once (`openedLate`).
   */
  async #open(dispatch: EndpointServices['dispatch'], channel: RemoteChannel, m: CallMessage, by: number): Promise<Result> {
    if (!this.ctx.leases.reserve(channel)) return { ok: false, code: 'busy' };
    const leaseOf = (result: Result | null) => (result?.ok === true && isObject(result.output) && isText(result.output.leaseId, 128) ? result.output.leaseId : null);
    let answer: Result | typeof LATE;
    try {
      answer = await within(by, () => this.ctx.now(), () => this.#forward(dispatch, 'machine', m), (late) => this.ctx.leases.openedLate(channel, leaseOf(late)));
    } catch (error) {
      this.ctx.leases.unopened(channel);
      throw error;
    }
    if (answer === LATE) return { ok: false, code: 'timeout' };
    const leaseId = leaseOf(answer);
    const artifactId = isObject(m.input) ? m.input.artifactId : undefined;
    if (leaseId !== null && isText(artifactId, 128)) this.ctx.leases.opened(channel, artifactId, leaseId);
    else this.ctx.leases.unopened(channel);
    return answer;
  }

  /** P5 O7 M5c: a lease the device closed, its mapping dropped once the machine answered the close. */
  async #close(dispatch: EndpointServices['dispatch'], channel: RemoteChannel, m: CallMessage): Promise<Result> {
    const result = await this.#forward(dispatch, 'machine', m);
    const leaseId = isObject(m.input) ? m.input.leaseId : undefined;
    if (result.ok && isText(leaseId, 128)) this.ctx.leases.closed(channel.client, leaseId);
    return result;
  }

  /**
   * P5 O7 M5c (A14): the latest receipts, each kept for a member who holds `view` on its artifact, by the `artifact` rule's
   * predicate over the channel's placements (the machine's owners every one). Every read is made first; the cut is the
   * step the answer goes in, against the ranks and placements as they stand then: a placement dropped since withholds its
   * receipts, and ranks that moved answer `unavailable`.
   */
  async #receipts(dispatch: EndpointServices['dispatch'], channel: RemoteChannel, m: CallMessage): Promise<Result | (() => Result)> {
    if (!holdsToSchema(m.name, m.input)) return { ok: false, code: 'malformed' };
    const result = await this.#forward(dispatch, 'machine', m);
    if (!result.ok) return result;
    const receipts = isObject(result.output) && Array.isArray(result.output.receipts) ? result.output.receipts : [];
    const ranks = await this.ctx.ranks(channel.member);
    const placed = new Map<string, CachedPlacement>();
    if (!ranks.ownsMachine()) {
      const ids = [...new Set(receipts.map((receipt) => (isObject(receipt) ? receipt.artifactId : undefined)).filter((id): id is string => isText(id, 128)))];
      const placing = { dispatch, log: (line: string) => this.ctx.log(line) };
      for (const [id, placement] of await Promise.all(ids.map(async (id) => [id, await this.ctx.artifacts.of(channel.client, id, placing)] as const))) placed.set(id, placement);
    }
    return () => {
      if (!ranks.current()) return { ok: false, code: 'unavailable' };
      const owner = ranks.ownsMachine();
      const viewable = (receipt: unknown): boolean => {
        if (owner) return true;
        const placement = isObject(receipt) && isText(receipt.artifactId, 128) ? placed.get(receipt.artifactId) : undefined;
        if (placement === undefined || !placement.current() || placement.resolved.kind !== 'artifact') return false;
        return holdsArtifact(placement.resolved, false, (session) => ranks.holds(session, 'view'));
      };
      return { ok: true, output: { ...(result.output as Fields), receipts: receipts.filter(viewable) } };
    };
  }

  /** P5 O7 M5c: the device's report of whether a page holding a lease here is shown, as the machine's own client's report. */
  async #windowShown(dispatch: EndpointServices['dispatch'], m: CallMessage): Promise<Result> {
    const shown = isObject(m.input) && typeof m.input.shown === 'boolean' ? m.input.shown : null;
    if (shown === null) return { ok: false, code: 'malformed' };
    const response = await dispatch('machine', 'connectors.windowShown', { shown });
    if (!response.ok) return { ok: false, code: response.error.code === 'host_unavailable' || response.error.code === 'timeout' ? 'unavailable' : response.error.code };
    return { ok: true, output: { ok: true } };
  }

  /**
   * P5 O7 M5a2 fix wave 1: an artifact read whose answer names sessions, forwarded raw and projected as it goes to what the
   * caller may be told of them (session-safe.ts).
   */
  async #sessionSafe(dispatch: EndpointServices['dispatch'], owner: 'engine-host' | 'machine', member: string, m: CallMessage): Promise<Result | (() => Result)> {
    const result = await this.#forward(dispatch, owner, m);
    // A failure goes with its code alone: its message is the store's words, which no projection reads (it could name a
    // session the caller doesn't view).
    return result.ok ? this.ctx.sessionSafe.prepare(member, m.name, result.output, dispatch) : { ok: false, code: result.code };
  }

  /**
   * P5 O7 M6: an `each-session` read, answered by the machine's services and cut to the sessions `member` holds the
   * registry's grade on. Every read is made first (the answer, each session's placement by its record, the member's
   * ranks); what it resolves to is the cut, which `execute` takes in the same synchronous step as it sends the answer.
   */
  async #eachSession(dispatch: EndpointServices['dispatch'], member: string, m: CallMessage): Promise<Result | (() => Result)> {
    const filter = Object.hasOwn(EACH_SESSION, m.name) ? EACH_SESSION[m.name] : undefined;
    const grade = filter?.grade ?? gradeOf(m.name);
    if (filter === undefined || typeof grade !== 'string' || !isSessionRank(grade)) return { ok: false, code: 'unavailable' };
    if (!holdsToSchema(m.name, m.input)) return { ok: false, code: 'malformed' };
    const unavailable = (code: string) => ({ ok: false as const, code: code === 'host_unavailable' || code === 'timeout' ? 'unavailable' : code });
    // Every placement the call sees of a session is one the caller must hold the grade on: the narrowing read's
    // (`session.list`), `session.get`'s, and each record heard from here on. None may widen the caller's rights.
    const heard = new Map<string, Placement[]>();
    this.#heard.add(heard);
    const done = (result: Result): Result => (this.#heard.delete(heard), result);
    let ranks: SessionRanks;
    const asked = m.input === null ? undefined : m.input;
    let input: unknown = asked;
    let listed = new Map<string, Placement>();
    try {
      ranks = await this.ctx.ranks(member);
      if (filter.ask !== undefined) input = filter.ask(input);
      if (filter.narrow !== undefined && isObject(input)) {
        const read = await this.#listed(dispatch);
        if (read === null) return done({ ok: false, code: 'unavailable' });
        listed = read;
        const viewed = [...read].filter(([, placement]) => ranks.holds(placement, grade)).map(([id]) => id);
        if (viewed.length <= SESSION_SEARCH_SESSIONS_MAX) input = filter.narrow(input, viewed);
      }
    } catch (error) {
      this.ctx.log(`endpoint: a \`${m.name}\` call could not be narrowed: ${(error as Error).message}`);
      return done({ ok: false, code: 'unavailable' });
    }
    const response = await dispatch('machine', m.name, input).catch((error: unknown) => ({ ok: false as const, error: { code: 'internal', message: (error as Error).message } }));
    if (!response.ok) return done(unavailable(response.error.code));
    const output = response.value ?? null;
    const sessions = [...new Set(filter.sessions(output, asked))];
    let placed: Map<string, Placement>;
    try {
      placed = new Map(await Promise.all(sessions.map(async (id): Promise<[string, Placement]> => [id, await placeRecorded(id, dispatch)])));
    } catch (error) {
      this.ctx.log(`endpoint: a \`${m.name}\` answer could not be cut: ${(error as Error).message}`);
      return done({ ok: false, code: 'unavailable' });
    }
    return () => {
      this.#heard.delete(heard);
      if (!ranks.current()) return { ok: false, code: 'unavailable' };
      const seen = (id: string): Placement[] => [...(listed.has(id) ? [listed.get(id)!] : []), placed.get(id) ?? null, ...(heard.get(id) ?? [])];
      return { ok: true, output: filter.keep(output, (id) => id !== null && seen(id).every((placement) => ranks.holds(placement, grade)), ranks.ownsMachine(), asked) };
    };
  }

  /**
   * P5 O8 M7b: a project's to-human entries (`channel.history`, the `each-session` shape, its cut lane-aware:
   * channel-view.ts), answered for the sessions `member` holds `view` on: the journal read until the page is filled with
   * such entries or it ends, each lane B session ranked at every placement the read saw of it, a lane A one by sminos's
   * record. Any project's (channel-view.ts' reach). Fix wave: `before` is a cursor the endpoint sealed, of an entry the
   * member views, else no entries (one placement read taken either way: the same answer in the same time); the page
   * goes, in the step its answer goes in, only while the ranks are current and all the read kept still stands, else it
   * is read again.
   */
  async #channelHistory(dispatch: EndpointServices['dispatch'], member: string, m: CallMessage): Promise<Result | (() => Result)> {
    if (!holdsToSchema(m.name, m.input) || !isObject(m.input)) return { ok: false, code: 'malformed' };
    const input = m.input as { project: string; before?: string; limit?: number };
    const limit = input.limit ?? HISTORY_LIMIT_MAX;
    const none: Result = { ok: true, output: { entries: [], more: false } };
    const book = new PlacementBook();
    this.#books.add(book);
    const done = (result: Result): Result => (this.#books.delete(book), result);
    const seal = (entry: HostEntry): HostEntry => ({ ...entry, id: this.ctx.cursors.seal(entry) });
    try {
      for (let attempt = 0; attempt < HISTORY_READS; attempt++) {
        const ranks = await this.ctx.ranks(member);
        const after = book.mark();
        const views = (entry: EntrySession) => viewable(entry, ranks, book, after);
        let before: string | undefined;
        if (input.before !== undefined) {
          const at = this.ctx.cursors.open(input.before, input.project);
          await book.ensure(at?.lane === 'B' ? at.session : randomUUID(), after, dispatch);
          if (at === null || !views(at.lane === 'A' ? { lane: 'A', engineSessionId: at.session, appSessionId: null } : { lane: 'B', appSessionId: at.session, engineSessionId: null })) return done(none);
          before = at.id;
        }
        const place = (ids: string[]) => Promise.all(ids.map((id) => book.ensure(id, after, dispatch))).then(() => {});
        const read = await readViewable(dispatch, { project: input.project, ...(before === undefined ? {} : { before }), limit }, views, place);
        if (!ranks.current() || publish(read, limit, views, seal) === null) continue;
        return () => {
          this.#books.delete(book);
          const page = ranks.current() ? publish(read, limit, views, seal) : null;
          return page === null ? { ok: false, code: 'unavailable' } : { ok: true, output: page };
        };
      }
      this.ctx.log(`endpoint: a \`channel.history\` read of ${input.project.slice(0, 64)} moved under each of its ${HISTORY_READS} reads`);
      return done({ ok: false, code: 'unavailable' });
    } catch (error) {
      this.ctx.log(`endpoint: a \`channel.history\` call could not be answered: ${(error as Error).message}`);
      return done({ ok: false, code: 'unavailable' });
    }
  }

  /**
   * The machine's sessions (`session.list`, the archived left out as search leaves them), each placed by its record:
   * the ones the caller holds the grade on are which rows a narrowed read searches, and every placement is one more the
   * cut holds the caller to (milestone re-check). Null when the spine can't answer.
   */
  async #listed(dispatch: EndpointServices['dispatch']): Promise<Map<string, Placement> | null> {
    const listed = await dispatch('machine', 'session.list', {});
    if (!listed.ok || !isObject(listed.value) || !Array.isArray(listed.value.sessions)) return null;
    const placements = new Map<string, Placement>();
    for (const record of listed.value.sessions as unknown[]) {
      const id = isObject(record) ? record.appId : undefined;
      if (isText(id, 512)) placements.set(id, recordedPlacement(id, record));
    }
    return placements;
  }

  /** `mawsd`'s status as a remote caller sees it: no file paths (P5 O2). */
  async #daemonStatus(dispatch: EndpointServices['dispatch']): Promise<{ ok: true; output: unknown } | { ok: false; code: string }> {
    const response = await dispatch('machine', 'daemon.status', undefined);
    return response.ok ? { ok: true, output: remoteDaemonStatus(response.value as DaemonStatus) } : { ok: false, code: 'unavailable' };
  }

  /** A lane A read down RL10 on the caller's own upstream subscription of that session. */
  #laneA(channel: RemoteChannel, m: CallMessage): { ok: true; output: unknown } | { ok: false; code: string } {
    const spec = LANE_A[m.name];
    const input = m.input;
    if (!isObject(input) || !isText(input.session, 512) || !isText(input.sub, 128)) return { ok: false, code: 'malformed' };
    const known = new Set(['session', 'sub', ...Object.keys(spec.fields), ...Object.keys(spec.optional ?? {})]);
    if (Object.keys(input).some((k) => !known.has(k))) return { ok: false, code: 'malformed' };
    for (const [name, check] of Object.entries(spec.fields)) if (!check(input[name])) return { ok: false, code: 'malformed' };
    for (const [name, check] of Object.entries(spec.optional ?? {})) if (input[name] !== undefined && !check(input[name])) return { ok: false, code: 'malformed' };
    const sub = this.ctx.subscription(channel, input.sub);
    const up = sub === null || sub.ended || !namesSession(sub) ? null : this.ctx.upstreamOf(sub);
    if (up === null) return { ok: false, code: 'unavailable' };
    if (up.session !== input.session) return { ok: false, code: 'malformed' };
    // 2026-11-06 (`rl2.agent-scope`): a read follows its subscription's scope; a diff is the session's, asked on the main
    // transcript's (sminos passes one on an agent's by unanswered)
    if (!spec.agent && up.agentId !== null) return { ok: false, code: 'malformed' };
    const rest: Fields = { ...input };
    delete rest.session;
    delete rest.sub;
    this.ctx.toSminos({ t: m.name.slice('sminos.'.length), project: up.project, session: up.session, ...(spec.agent ? { agentId: up.agentId } : {}), sub: up.epoch, ...rest });
    return { ok: true, output: { requested: true } };
  }

  /** P5 O8 M6b: `record.policy`, for the sessions `member` owns, cut as the answer goes (record-policy.ts). */
  async #recordPolicy(member: string, input: unknown): Promise<Result | (() => Result)> {
    const before = unsupported(this.ctx.sminos?.() ?? null);
    if (before !== null) return before;
    const named = isObject(input) && typeof input.session === 'string' ? input.session : undefined;
    const records = await placeListings(this.ctx.members(), (app) => this.ctx.placeRecord?.(app) ?? Promise.resolve({ kind: 'unknown' }), named);
    const ranks = await this.ctx.ranks(member);
    return () => {
      const now = unsupported(this.ctx.sminos?.() ?? null);
      if (now !== null) return now;
      if (!ranks.current()) return { ok: false, code: 'unavailable' };
      const held: readonly HeldSession[] = this.ctx.members();
      // split by lane so each arm is one of `holds`' placements (a lane A one, a lane B one), which the union is not
      const owns = (target: SessionTarget) => ranks.holds(target.lane === 'A' ? { target } : { target }, 'manage');
      return { ok: true, output: { supported: true, policies: policies(held, records, owns, named) } };
    };
  }

  /** The signed listings of every session `member` holds `list` or more on. */
  async #listings(member: string): Promise<Signed<Listing>[]> {
    const owners = await this.ctx.machineOwners();
    const out: Signed<Listing>[] = [];
    for (const { member: m, listingId, target } of this.ctx.members()) {
      if (listingId === null || !rankAtLeast(sessionRank(this.ctx.records.record(target), member, owners), 'list')) continue;
      // U9: a lane B session's listing follows its record, as the one the hub keeps: none while archived, its title
      const says = m.lane === 'B' ? (this.ctx.recordSays?.(listingId) ?? null) : null;
      if (says?.archived === true) continue;
      const record = await this.ctx.recordFor({
        session: listingId,
        project: m.project,
        lane: m.lane,
        state: m.state,
        title: says?.title ?? m.title ?? '',
        owners: m.owners,
        ...(m.access === undefined ? {} : { access: m.access }),
        ...(m.shares === undefined ? {} : { shares: m.shares.map((share) => share.member) }),
        ...(m.policyRev === undefined ? {} : { policyRev: m.policyRev }),
      });
      if (record !== null) out.push(record);
    }
    return out;
  }
}
