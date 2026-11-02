// Remote reads (O10 M8; RL3, RL §6.2; Interfaces §G): the gate's `call` executor. What reaches it is authorized: offered
// as a call, graded `list` or `view` (anything higher is an act, `act-required`), held by the caller on its target.
//   - Lane B's engine-host reads (`session.status`, `.events`, `.pendingRequest`, `.pendingItems`, `.queue.list`,
//     `.catalog`, and from P5 O7 M2 a remote pane's: the context, usage, settings, models, rules, MCP and cost reads) go
//     through `dispatch` to the engine host, and its answer is the result. A host error `host_unavailable` or `timeout`
//     is `unavailable`; any other code passes through.
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
//   - P5 O7 M5a: `library.list` takes the same shape over its rows: each row's own sessions (`LibraryRowSchema.sessions`,
//     the index's view of the artifact's links) are what it names, and a row is kept when the caller holds `view` on its
//     artifact by the `artifact` rule's predicate (artifacts.ts' `holdsArtifact`): on any one of its sessions, at every
//     placement the call saw of that session; a row with no session is the machine owners' alone. A machine owner holds
//     every artifact, so their listing goes whole, with no placement read (the common case), checked again as it goes. A
//     caller who isn't one is asked for the listing without its `kind`, so the counts per kind it is answered are those of
//     the rows it keeps, never of the machine's. The artifact rule's reads (`artifacts.get` and its kin) are answered raw:
//     their decision placed the artifact.
// Every dispatch carries the asking channel's `ClientRef` (P5 O7 M2). A result over the channel's message limit answers
// `too-large`. For a device that listed `rl2.bytes` (P5 O7 M5a), the input came decoded (gate.ts) and the output goes in the
// bytes codec's tagged form (bytes.ts), measured so.
import { MESSAGE_MAX_BYTES, type CallMessage, type Listing, type Signed } from 'org-protocol';
import { gradeOf } from '@shared/ipc/grades';
import { remoteDaemonStatus, type DaemonStatus } from '@shared/ipc/schema/daemon';
import { SESSION_SEARCH_LIMIT, SESSION_SEARCH_SESSIONS_MAX } from '@shared/ipc/schema/session';
import { holdsArtifact } from './artifacts';
import { holdsToSchema, type SessionRanks } from './authorize';
import { writeBytes } from './bytes';
import type { RemoteChannel } from './channels';
import { isSessionRank, rankAtLeast, sessionRank } from './grades';
import type { SessionReport } from './listings';
import { OFFERS, type Offers } from './offers';
import type { Member } from './rl10/members';
import { dispatchAs, type EndpointServices } from './services';
import type { RecordSource, SessionTarget } from './sources';
import { namesSession, type SessionSubscription, type Subscription } from './subscriptions';
import { placeRecorded, recordedPlacement, type Placement } from './targets';

export type CallsContext = {
  dispatch: EndpointServices['dispatch'];
  /** The caller's subscription by its id, and the upstream it holds (lane A). */
  subscription(channel: RemoteChannel, sub: string): Subscription | null;
  upstreamOf(sub: SessionSubscription): { epoch: string; project: string; session: string } | null;
  /** A frame down RL10 to sminos. */
  toSminos(frame: object): void;
  /** The machine's sessions as sminos reports them, each with the id it is listed under (null: not yet). */
  members(): Array<{ member: Member; listingId: string | null; target: SessionTarget }>;
  records: RecordSource;
  machineOwners(): Promise<string[]>;
  recordFor(report: SessionReport): Promise<Signed<Listing> | null>;
  /** P5 O7 M6: the member's ranks on the machine's sessions (`Authorizer.ranks`), for the `each-session` cut. */
  ranks(member: string): Promise<SessionRanks>;
  offers?: Offers;
  log(line: string): void;
};

type Fields = Record<string, unknown>;
type Result = { ok: true; output: unknown } | { ok: false; code: string };
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

const sessionOf = (v: unknown): string | null => (isObject(v) && isText(v.appSessionId, 512) ? v.appSessionId : null);

/**
 * P5 O7 M6: each `each-session` row's answer, by the sessions it names: `attention.list`'s items, `session.search`'s
 * hits, each by its `appSessionId`; `keep` answers it with only what `kept` holds (a part naming no session is dropped).
 * `narrow`: the input naming the sessions the caller views, for a read that answers at most a limit of them, so the
 * limit is spent on those (milestone fix: `session.search`'s 50 hits); the cut stays the authorization.
 * P5 O7 M5a: `owned`, a read whose every part a machine owner holds (the `artifact` rule's short cut): their answer goes
 * whole, unplaced; `ask`, the input asked for a caller who isn't one; `keep` is told whether the caller owns the machine,
 * and what they asked.
 */
type EachSession = {
  sessions(output: unknown): string[];
  keep(output: unknown, kept: (id: string | null) => boolean, ownsMachine: boolean, input: unknown): unknown;
  narrow?(input: Fields, sessions: string[]): Fields;
  owned?: true;
  ask?(input: unknown): unknown;
};
const rowsOf = (output: unknown): Fields[] => (isObject(output) && Array.isArray(output.rows) ? output.rows.filter(isObject) : []);
const rowSessions = (row: Fields): string[] => (Array.isArray(row.sessions) ? row.sessions.map(sessionOf).filter((id) => id !== null) : []);
const EACH_SESSION: Record<string, EachSession> = {
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
    sessions: (output) => rowsOf(output).flatMap(rowSessions),
    keep: (output, kept, ownsMachine, input) => {
      if (!isObject(output)) return output;
      const rows = rowsOf(output).filter((row) => holdsArtifact({ sessions: rowSessions(row), orphan: rowSessions(row).length === 0 }, ownsMachine, (id) => kept(id)));
      if (ownsMachine) return { ...output, rows };
      // Asked without its `kind` (`ask`): the counts are the kept rows', and the rows the kind's.
      const kind = isObject(input) && isObject(input.filter) ? input.filter.kind : undefined;
      const counts = Object.fromEntries(Object.keys(isObject(output.counts) ? output.counts : {}).map((k) => [k, rows.filter((row) => row.kind === k).length]));
      return { ...output, rows: kind === undefined ? rows : rows.filter((row) => row.kind === kind), counts };
    },
    owned: true,
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

  constructor(private readonly ctx: CallsContext) {}

  /** A machine event (`onEvent`): a session's record moved, which every `each-session` call in flight places it by. */
  event(owner: string, message: { name: string; payload: unknown }): void {
    if (owner !== 'machine' || message.name !== 'session.changed' || this.#heard.size === 0) return;
    const record = isObject(message.payload) ? message.payload.record : undefined;
    if (!isObject(record) || !isText(record.appId, 512)) return;
    const placement = recordedPlacement(record.appId, record);
    for (const heard of this.#heard) heard.set(record.appId, [...(heard.get(record.appId) ?? []), placement]);
  }

  /** An authorized call, answered by its executor. */
  execute(channel: RemoteChannel, m: CallMessage): void {
    const offers = this.ctx.offers ?? OFFERS;
    const row = Object.hasOwn(offers.commands, m.name) ? offers.commands[m.name] : undefined;
    const answer = (result: { ok: true; output: unknown } | { ok: false; code: string }) => {
      if (channel.closed) return;
      if (!result.ok) return void channel.send({ t: 'result', id: m.id, ok: false, error: { code: result.code } });
      const output = writeBytes(channel, result.output);
      if (Buffer.byteLength(JSON.stringify(output ?? null)) > MESSAGE_MAX_BYTES - 1024) return void channel.send({ t: 'result', id: m.id, ok: false, error: { code: 'too-large' } });
      channel.send({ t: 'result', id: m.id, ok: true, output });
    };
    const dispatch = dispatchAs(this.ctx.dispatch, channel.client);
    // What runs answers a result, or (an `each-session` row) the step that makes it, taken as the answer goes.
    let run: Promise<Result | (() => Result)>;
    if (row?.target === 'each-session') run = this.#eachSession(dispatch, channel.member, m);
    else if (row?.executor === 'engine-host' || (row?.executor === 'machine' && m.name !== 'daemon.status')) run = this.#forward(dispatch, row.executor, m);
    else if (row?.executor === 'sminos' && Object.hasOwn(LANE_A, m.name)) run = Promise.resolve(this.#laneA(channel, m));
    else if (row?.executor === 'machine') run = this.#daemonStatus(dispatch);
    else if (m.name === 'endpoint.listings') run = this.#listings(channel.member).then((listings) => ({ ok: true as const, output: { listings } }));
    else run = Promise.resolve({ ok: false, code: 'unavailable' });
    run.then((result) => answer(typeof result === 'function' ? result() : result), (error: unknown) => {
      this.ctx.log(`endpoint: a \`${m.name.slice(0, 64)}\` call failed: ${(error as Error).message}`);
      answer({ ok: false, code: 'unavailable' });
    });
  }

  /** A read its executor answers raw: the engine host's, or the machine's services'. */
  async #forward(dispatch: EndpointServices['dispatch'], owner: 'engine-host' | 'machine', m: CallMessage): Promise<{ ok: true; output: unknown } | { ok: false; code: string }> {
    const response = await dispatch(owner, m.name, m.input === null ? undefined : m.input);
    if (response.ok) return { ok: true, output: response.value ?? null };
    const code = response.error.code === 'host_unavailable' || response.error.code === 'timeout' ? 'unavailable' : response.error.code;
    return { ok: false, code };
  }

  /**
   * P5 O7 M6: an `each-session` read, answered by the machine's services and cut to the sessions `member` holds the
   * registry's grade on. Every read is made first (the answer, each session's placement by its record, the member's
   * ranks); what it resolves to is the cut, which `execute` takes in the same synchronous step as it sends the answer.
   */
  async #eachSession(dispatch: EndpointServices['dispatch'], member: string, m: CallMessage): Promise<Result | (() => Result)> {
    const filter = Object.hasOwn(EACH_SESSION, m.name) ? EACH_SESSION[m.name] : undefined;
    const grade = gradeOf(m.name);
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
      // P5 O7 M5a: a machine owner holds every part of an `owned` read: their answer goes whole, no placement read, if
      // they still own the machine as it goes.
      if (filter.owned === true && ranks.ownsMachine()) {
        const response = await dispatch('machine', m.name, input).catch((error: unknown) => ({ ok: false as const, error: { code: 'internal', message: (error as Error).message } }));
        if (!response.ok) return done(unavailable(response.error.code));
        const output = response.value ?? null;
        return () => {
          this.#heard.delete(heard);
          return ranks.ownsMachine() ? { ok: true, output: filter.keep(output, () => true, true, asked) } : { ok: false, code: 'unavailable' };
        };
      }
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
    const sessions = [...new Set(filter.sessions(output))];
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
      return { ok: true, output: filter.keep(output, (id) => id !== null && seen(id).every((placement) => ranks.holds(placement, grade)), false, asked) };
    };
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
    const rest: Fields = { ...input };
    delete rest.session;
    delete rest.sub;
    this.ctx.toSminos({ t: m.name.slice('sminos.'.length), project: up.project, session: up.session, ...(spec.agent ? { agentId: null } : {}), sub: up.epoch, ...rest });
    return { ok: true, output: { requested: true } };
  }

  /** The signed listings of every session `member` holds `list` or more on. */
  async #listings(member: string): Promise<Signed<Listing>[]> {
    const owners = await this.ctx.machineOwners();
    const out: Signed<Listing>[] = [];
    for (const { member: m, listingId, target } of this.ctx.members()) {
      if (listingId === null || !rankAtLeast(sessionRank(this.ctx.records.record(target), member, owners), 'list')) continue;
      const record = await this.ctx.recordFor({ session: listingId, project: m.project, lane: m.lane, state: m.state, title: m.title ?? '', owners: m.owners, ...(m.access === undefined ? {} : { access: m.access }) });
      if (record !== null) out.push(record);
    }
    return out;
  }
}
