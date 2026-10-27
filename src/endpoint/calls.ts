// Remote reads (O10 M8; RL3, RL §6.2; Interfaces §G): the gate's `call` executor. What reaches it is authorized: offered
// as a call, graded `list` or `view` (anything higher is an act, `act-required`), held by the caller on its target.
//   - Lane B's reads (`session.status`, `.events`, `.pendingRequest`, `.pendingItems`, `.queue.list`, `.catalog`) go
//     through `dispatch` to the engine host, and its answer is the result.
//   - Lane A's `sminos.rows`, `.diff`, `.output` and `.read` go down RL10 as DX2's frames on the caller's own upstream
//     subscription (named by the caller's `sub` on that session), as the hub carried a browser's: sminos answers on that
//     subscription, so the answer comes in its stream at its place in the sequence, and the result says it was asked.
//   - `endpoint.listings` answers the signed listing of every session on the machine the member holds `list` or more
//     on: the one the hub holds when it is current, else one signed for the asker alone. A `private` session's listing
//     leaves the machine only so, to its owners and shares (RL §6.2).
//   - `daemon.status` and `machine.identity` are `mawsd`'s (O2, O6), refused `ungraded` before they reach here until
//     their owners grade them; anything else answers `unavailable`.
// A result over the channel's message limit answers `too-large`.
import { MESSAGE_MAX_BYTES, type CallMessage, type Listing, type Signed } from 'org-protocol';
import type { RemoteChannel } from './channels';
import { rankAtLeast, sessionRank } from './grades';
import type { SessionReport } from './listings';
import { OFFERS, type Offers } from './offers';
import type { Member } from './rl10/members';
import type { EndpointServices } from './services';
import type { RecordSource, SessionTarget } from './sources';
import type { Subscription } from './subscriptions';

export type CallsContext = {
  dispatch: EndpointServices['dispatch'];
  /** The caller's subscription by its id, and the upstream it holds (lane A). */
  subscription(channel: RemoteChannel, sub: string): Subscription | null;
  upstreamOf(sub: Subscription): { epoch: string; project: string; session: string } | null;
  /** A frame down RL10 to sminos. */
  toSminos(frame: object): void;
  /** The machine's sessions as sminos reports them, each with the id it is listed under (null: not yet). */
  members(): Array<{ member: Member; listingId: string | null; target: SessionTarget }>;
  records: RecordSource;
  machineOwners(): Promise<string[]>;
  recordFor(report: SessionReport): Promise<Signed<Listing> | null>;
  offers?: Offers;
  log(line: string): void;
};

type Fields = Record<string, unknown>;
const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown, max = 256): v is string => typeof v === 'string' && v !== '' && v.length <= max;
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;

/** Lane A's reads: each one's fields beside `session` and `sub`, and their checks (DX2's frames). */
const LANE_A: Record<string, { fields: Record<string, (v: unknown) => boolean>; optional?: Record<string, (v: unknown) => boolean>; agent: boolean }> = {
  'sminos.rows': { fields: { before: (v) => isText(v), limit: (v) => isInt(v, 1, 1000) }, agent: true },
  'sminos.diff': { fields: {}, agent: false },
  'sminos.output': { fields: { taskId: (v) => isText(v), tail: (v) => isInt(v, 0, 16 * 1024 * 1024) }, agent: true },
  'sminos.read': { fields: { id: (v) => isText(v, 128), what: (v) => isText(v, 64) }, optional: { args: isObject }, agent: true },
};

export class Calls {
  constructor(private readonly ctx: CallsContext) {}

  /** An authorized call, answered by its executor. */
  execute(channel: RemoteChannel, m: CallMessage): void {
    const offers = this.ctx.offers ?? OFFERS;
    const row = Object.hasOwn(offers.commands, m.name) ? offers.commands[m.name] : undefined;
    const answer = (result: { ok: true; output: unknown } | { ok: false; code: string }) => {
      if (channel.closed) return;
      if (result.ok && Buffer.byteLength(JSON.stringify(result.output ?? null)) > MESSAGE_MAX_BYTES - 1024) return void channel.send({ t: 'result', id: m.id, ok: false, error: { code: 'too-large' } });
      channel.send(result.ok ? { t: 'result', id: m.id, ok: true, output: result.output } : { t: 'result', id: m.id, ok: false, error: { code: result.code } });
    };
    let run: Promise<{ ok: true; output: unknown } | { ok: false; code: string }>;
    if (row?.executor === 'engine-host') run = this.#host(m);
    else if (row?.executor === 'sminos' && Object.hasOwn(LANE_A, m.name)) run = Promise.resolve(this.#laneA(channel, m));
    else if (m.name === 'endpoint.listings') run = this.#listings(channel.member).then((listings) => ({ ok: true as const, output: { listings } }));
    else run = Promise.resolve({ ok: false, code: 'unavailable' });
    run.then(answer, (error: unknown) => {
      this.ctx.log(`endpoint: a \`${m.name.slice(0, 64)}\` call failed: ${(error as Error).message}`);
      answer({ ok: false, code: 'unavailable' });
    });
  }

  async #host(m: CallMessage): Promise<{ ok: true; output: unknown } | { ok: false; code: string }> {
    const response = await this.ctx.dispatch('engine-host', m.name, m.input === null ? undefined : m.input);
    if (response.ok) return { ok: true, output: response.value ?? null };
    const code = response.error.code === 'host_unavailable' || response.error.code === 'timeout' ? 'unavailable' : response.error.code;
    return { ok: false, code };
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
    const up = sub === null || sub.ended ? null : this.ctx.upstreamOf(sub);
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
