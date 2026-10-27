// Authorization at the endpoint (O10 M5; RL §5.5, §5.6, §5.10, §6.3; Interfaces §G): every `call`, `act`, `query` and
// `sub` a remote device sends is decided here, by one function, before anything runs. The executing sides (M7's ledgers,
// M8's reads and subscriptions) see only what it let through.
//
// A command is decided in this order, the first refusal answering:
//   1. it is in the offer table (`not-offered`), as the kind of request its row is: a call of an act is `act-required`,
//      an act of a call `not-offered`; an action names this org, this machine and the channel's own device (`malformed`);
//   2. it has a grade (`ungraded`), never a routing class (`grade`: no caller holds one); a registry command's input
//      holds to its schema (`malformed`);
//   3. the caller's class: a `web-cards` device reads listings and answers on its member's own sessions, nothing else
//      (`class`);
//   4. the caller's standing at the command's floor: a session rank on the session its target rule reads (`no-target`
//      when it names none, `grade` below it, or on a session this machine can't place; `list`-graded machine reads need
//      none), a machine grade among the member's rights (`grade`). Nothing of a session is read for a caller below its
//      floor, so a refusal says nothing of whether a session exists;
//   5. a by-effect command's rule gives the grade its input takes (`no-rule`), held to the floor, and the standing is
//      checked again at it; a call is a read, so anything graded above `view` must come as an act (`act-required`);
//   6. the machine's policy: a head too old stops every action but a delivered state (`state-too-old`), read-only
//      refuses everything graded above `view` (`read-only`), and a spawn is held to the ceiling, the known checkouts and
//      its allowed fields (`ceiling`, `unknown-checkout`, `spec-field`);
//   7. what the class may say: a web-cards answer only takes or refuses what is pending (`class`);
//   8. presence: a web-cards action's WebAuthn assertion, a native action's step-up where RL §5.6 asks for it
//      (`step-up`).
// A decision reads the host and the sources asynchronously, so it is taken against what it read: when the head, the
// certificates, the policy, the grants or a record it read moved meanwhile, it is taken again, once, against the state
// now; moved again, it is `unavailable`. Presence is checked last, once, on the decision that stood (a WebAuthn counter
// is spent by its check).
// The endpoint's own actions (`endpoint.grant`, `endpoint.state`) carry their authority in their signatures and take no
// grade. A `sub` takes `view` on its session, or ownership for the `cards` view; a `query` is answered only to the member
// who sent the operation, while they still hold `view` on its stored target (M7 brings the binding), and to a web-cards
// device only for what its class may do on a session its member owns.
import type { Action, Certificates, DeviceClass, OrgState, RefusalReason, Right } from 'org-protocol';
import { gradeOf as declaredGrade, type Grade, type GradeSpec } from '@shared/ipc/grades';
import { REGISTRY, type WireRegistry } from '@shared/ipc/registry';
import { BY_EFFECT, NO_RULE, QUESTION_REQUESTS, type EffectReads } from './by-effect';
import { machineOwnerMembers } from './grants';
import { higher, isMachineGrade, isRoutingClass, isSessionRank, owns, rankAtLeast, sessionRank } from './grades';
import { OFFERS, type OfferRow, type Offers } from './offers';
import { spawnRefusal, type Policy } from './policy';
import type { EndpointServices } from './services';
import type { CheckoutSource, RecordSource, SessionRecord, SessionTarget } from './sources';
import { Assertions, deviceOf, stepUpRequired, verifyDeviceStepUp } from './step-up';
import { resolveSubscription, resolveTarget, type Resolved } from './targets';

export type AuthorizeRequest = { kind: 'call' | 'act' | 'query' | 'sub'; name: string; input: unknown; action?: Action };
export type Who = { member: string; device: string; clientClass: DeviceClass };
export type Decision = { ok: true; target?: SessionTarget } | { ok: false; reason: RefusalReason };
/** What an executing side stored for an operation (M7): a query's `input`, its `name` the operation's. */
export type QueryBinding = { member: string; target: SessionTarget | null };

export type AuthorizeContext = {
  ref(): string | null;
  /** The head now, its certificates, and whether it is too old for actions (M2's backstop); null while none is held. */
  org(): { head: OrgState; certificates: Certificates; tooOld: boolean } | null;
  /** The member's machine grades: all three for an owner, else what a grant in force gives (grants.ts). */
  rights(member: string): Promise<readonly Right[]>;
  policy(): Policy;
  /** The machine's `defaultMode`, which the ceiling `settings` reads. */
  settingsMode(): string;
  records: RecordSource;
  checkouts: CheckoutSource;
  dispatch: EndpointServices['dispatch'];
  /** The origin the web-cards code is served from (the hub's), and the counters kept per credential. */
  webauthn: { origin(): string | null; counter(credentialId: string): number; setCounter(credentialId: string, counter: number): void };
  /** What else a decision rests on that can change under it (the grant ledger), compared by identity. */
  stamp?(): unknown;
  /** The suites' seams: another offer table, grade declaration or registry (a fixture namespace). */
  offers?: Offers;
  gradeOf?(name: string): GradeSpec | undefined;
  registry?: WireRegistry;
};

/** What a web-cards device may ask for at all (RL §5.10); its sessions and answers are checked further below. */
const WEB_CARDS: ReadonlySet<string> = new Set(['endpoint.listings', 'session.answer', 'sminos.answer', 'sminos.decide']);

class Refused extends Error {
  constructor(readonly reason: RefusalReason) {
    super(reason);
  }
}

const refuse = (reason: RefusalReason): Decision => ({ ok: false, reason });
/** A decision that stands but for presence, checked once it is known to have been taken against the state now. */
type Standing = { decision: Decision; presence?: () => Promise<Decision> };
const decided = (decision: Decision): Standing => ({ decision });
/** The part of a record a decision rests on. */
const standingOf = (record: SessionRecord | null) => (record === null ? null : JSON.stringify([record.owners, record.access ?? 'listed', record.shares ?? []]));
const QUERYABLE_BY_WEB_CARDS: ReadonlySet<string> = new Set(['session.answer', 'sminos.answer', 'sminos.decide']);
const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** One decision's reads, each made at most once, and the records it read. */
class Reads implements EffectReads {
  #owners: Promise<string[]> | null = null;
  readonly #pending = new Map<string, Promise<string | null>>();
  readonly #records = new Map<string, { target: SessionTarget; standing: string | null }>();

  constructor(
    private readonly ctx: AuthorizeContext,
    private readonly org: { head: OrgState; certificates: Certificates },
    private readonly ref: string,
    private readonly now: Date,
  ) {}

  /** The machine's owners as members. */
  owners(): Promise<string[]> {
    return (this.#owners ??= machineOwnerMembers(this.org.head, this.org.certificates, this.ref, this.now));
  }

  record(target: SessionTarget): SessionRecord | null {
    const record = this.ctx.records.record(target);
    this.#records.set(`${target.lane}\n${target.session}`, { target, standing: standingOf(record) });
    return record;
  }

  /** Whether a record read here now stands otherwise. */
  recordsMoved(): boolean {
    for (const { target, standing } of this.#records.values()) if (standingOf(this.ctx.records.record(target)) !== standing) return true;
    return false;
  }

  pendingKind(appSessionId: string, requestId: string): Promise<string | null> {
    const key = `${appSessionId}\n${requestId}`;
    let read = this.#pending.get(key);
    if (read === undefined) {
      read = this.ctx.dispatch('engine-host', 'session.pendingRequest', { appSessionId, requestId }).then((response) => {
        // An engine host that can't answer now can't let an answer be graded; one that holds nothing for it, nobody.
        if (!response.ok) throw new Refused(response.error.code === 'host_unavailable' || response.error.code === 'timeout' ? 'unavailable' : 'grade');
        const event = isObject(response.value) ? response.value.event : null;
        return isObject(event) && typeof event.kind === 'string' ? event.kind : null;
      });
      this.#pending.set(key, read);
    }
    return read;
  }
}

export class Authorizer {
  readonly #assertions: Assertions;

  constructor(private readonly ctx: AuthorizeContext) {
    this.#assertions = new Assertions(ctx.webauthn, () => ctx.webauthn.origin());
  }

  /**
   * The decision on one request from `who`, at `now` (epoch ms), taken against the state it read: again, once, when that
   * moved under its reads, and `unavailable` when it moved again.
   */
  async authorize(request: AuthorizeRequest, who: Who, now: number): Promise<Decision> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const org = this.ctx.org();
      const ref = this.ctx.ref();
      if (org === null || ref === null) return refuse('unavailable');
      const before = this.#stamp();
      const reads = new Reads(this.ctx, org, ref, new Date(now));
      const moved = () => reads.recordsMoved() || !sameStamp(before, this.#stamp());
      let standing: Standing;
      try {
        if (request.kind === 'query') standing = decided(await this.#query(request, who, reads));
        else if (request.kind === 'sub') standing = decided(await this.#sub(request.input, who, reads));
        else standing = await this.#command(request, who, org, ref, reads);
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        standing = decided(refuse(error.reason));
      }
      if (moved()) continue;
      if (standing.presence === undefined) return standing.decision;
      const decision = await standing.presence();
      return moved() ? refuse('unavailable') : decision;
    }
    return refuse('unavailable');
  }

  /** What a decision rests on beyond the records it reads: the head, the certificates, the policy and the grant ledger. */
  #stamp(): readonly unknown[] {
    const org = this.ctx.org();
    const policy = this.ctx.policy();
    return [org?.head, org?.certificates, org?.tooOld, policy.read_only, policy.ceiling, this.ctx.stamp?.()];
  }

  get #offers(): Offers {
    return this.ctx.offers ?? OFFERS;
  }

  #gradeOf(name: string, row: OfferRow): GradeSpec | null | undefined {
    return row.grade === undefined ? (this.ctx.gradeOf ?? declaredGrade)(name) : row.grade;
  }

  async #command(request: AuthorizeRequest, who: Who, org: { head: OrgState; tooOld: boolean }, ref: string, reads: Reads): Promise<Standing> {
    const { kind, name, action } = request;
    const no = (reason: RefusalReason) => decided(refuse(reason));
    // 1. Offered, as this kind of request, and an action about this machine from this device.
    const row = Object.hasOwn(this.#offers.commands, name) ? this.#offers.commands[name] : undefined;
    if (row === undefined) return no('not-offered');
    if (kind === 'act' && row.kind !== 'act') return no('not-offered');
    if (kind === 'call' && row.kind === 'act') return no('act-required');
    if (kind === 'act' && (action === undefined || action.action !== name || action.org !== org.head.org || action.machine !== ref || action.device !== who.device)) return no('malformed');
    const input = kind === 'act' ? action!.args : request.input;

    // 2. A grade, and an input its command takes.
    const spec = this.#gradeOf(name, row);
    if (spec === undefined) return no('ungraded');
    const floor = spec === null || typeof spec === 'string' ? spec : spec.floor;
    if (floor !== null && isRoutingClass(floor)) return no('grade');
    if (row.grade === undefined && !this.#validInput(name, input)) return no('malformed');

    // 3. The class.
    const webCards = who.clientClass === 'web-cards';
    if (webCards && !WEB_CARDS.has(name)) return no('class');

    // 4. The caller's standing at the floor, before anything of the session is read.
    const resolved = await resolveTarget(row.target, input, action, this.ctx.dispatch);
    if (resolved.kind === 'refused') return no(resolved.reason);
    if (resolved.kind === 'unknown') return no('grade');
    const target = resolved.kind === 'session' ? resolved.target : undefined;
    const record = target === undefined ? null : reads.record(target);
    const atFloor = await this.#stands(floor, target, record, who, reads);
    if (atFloor !== null) return no(atFloor);

    // 5. The grade its input's effect takes, and the standing at it.
    const grade = await this.#effectiveGrade(name, spec, input, reads);
    if (typeof grade === 'object' && grade !== null) return decided(grade);
    if (grade !== null && isRoutingClass(grade)) return no('grade');
    if (kind === 'call' && grade !== 'list' && grade !== 'view') return no('act-required');
    if (grade !== floor) {
      const atGrade = await this.#stands(grade, target, record, who, reads);
      if (atGrade !== null) return no(atGrade);
    }

    // 6. The machine's policy, on the effect. A spawn's args are read only for a member who may spawn: the known
    // checkouts are no one else's to probe.
    if (kind === 'act' && org.tooOld && name !== 'endpoint.state') return no('state-too-old');
    const policy = this.ctx.policy();
    if (grade !== null && grade !== 'list' && grade !== 'view' && policy.read_only) return no('read-only');
    if (name === 'sminos.spawn') {
      const refusal = spawnRefusal(input as Readonly<Record<string, unknown>>, policy, () => this.ctx.settingsMode(), this.ctx.checkouts);
      if (refusal !== null) return no(refusal);
    }

    // 7. A web-cards answer on its member's own session, taking or refusing only what is pending.
    const owners = await reads.owners();
    if (webCards && name !== 'endpoint.listings') {
      if (!owns(record, who.member, owners)) return no('class');
      if (!(await this.#asPending(name, input as Readonly<Record<string, unknown>>, reads))) return no('class');
    }

    // 8. Presence, once the decision is known to stand.
    const granted: Decision = target === undefined ? { ok: true } : { ok: true, target };
    if (kind !== 'act') return decided(granted);
    const device = deviceOf(org.head, who.member, who.device);
    if (device === undefined) return no('removed');
    if (webCards) {
      const passkey = device.passkey;
      if (passkey === undefined) return no('step-up');
      return { decision: granted, presence: async () => ((await this.#assertions.check(action!, passkey)) ? granted : refuse('step-up')) };
    }
    if (!stepUpRequired({ name, grade, ownsSession: owns(record, who.member, owners), ownsMachine: owners.includes(who.member) })) return decided(granted);
    return { decision: granted, presence: async () => ((await verifyDeviceStepUp(action!, device, org.head)) ? granted : refuse('step-up')) };
  }

  /** Whether the member holds `grade` on the target (a session rank) or the machine (a right); null when they do. */
  async #stands(grade: Grade | null, target: SessionTarget | undefined, record: SessionRecord | null, who: Who, reads: Reads): Promise<RefusalReason | null> {
    if (grade === null) return null;
    if (isSessionRank(grade)) {
      if (target === undefined) return grade === 'list' ? null : 'no-target';
      return rankAtLeast(sessionRank(record, who.member, await reads.owners()), grade) ? null : 'grade';
    }
    if (isMachineGrade(grade)) return (await this.ctx.rights(who.member)).includes(grade) ? null : 'grade';
    return 'grade';
  }

  /** The input holds to its registry command's schema; JSON's `null` stands for no input. */
  #validInput(name: string, input: unknown): boolean {
    const commands: WireRegistry['commands'] = (this.ctx.registry ?? REGISTRY).commands;
    const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
    if (command === undefined) return false;
    return command.input.safeParse(input).success || (input === null && command.input.safeParse(undefined).success);
  }

  /** The grade the input's effect takes (null: the action's signatures are its authority), or a refusal. */
  async #effectiveGrade(name: string, spec: GradeSpec | null, input: unknown, reads: Reads): Promise<Grade | null | Decision> {
    if (spec === null || typeof spec === 'string') return spec;
    const rule = Object.hasOwn(BY_EFFECT, name) ? BY_EFFECT[name] : NO_RULE;
    if (rule === NO_RULE) return refuse('no-rule');
    if (!isObject(input)) return refuse('malformed');
    const grade = await rule(input, reads);
    if (grade === NO_RULE) return refuse('no-rule');
    return isSessionRank(grade) && isSessionRank(spec.floor) ? higher(grade, spec.floor) : grade;
  }

  /**
   * A web-cards answer that only takes or refuses what is pending (RL §5.10): a question's answer, or a permission
   * allowed once or denied, with no changed input, no lasting rule and no words of its own; lane A's `decide` likewise.
   */
  async #asPending(name: string, input: Readonly<Record<string, unknown>>, reads: Reads): Promise<boolean> {
    if (name === 'sminos.answer') return true;
    if (name === 'sminos.decide') return input.scope === undefined && input.message === undefined;
    const answer = input.answer as Readonly<Record<string, unknown>>;
    const pending = await reads.pendingKind(input.appSessionId as string, input.requestId as string);
    if (answer.kind === 'question') return pending === null || QUESTION_REQUESTS.has(pending);
    if (answer.kind !== 'permission' || (pending !== null && pending !== 'permission.requested')) return false;
    if (answer.updatedInput !== undefined || answer.message !== undefined) return false;
    return answer.decision === 'deny' || (answer.decision === 'allow' && answer.scope === 'once');
  }

  /** A subscription: `view` on its session (`full`), or ownership (`cards`); a web-cards device the cards of its own. */
  async #sub(input: unknown, who: Who, reads: Reads): Promise<Decision> {
    const message = input as { session: { lane: 'A' | 'B'; id: string }; view?: 'full' | 'cards' };
    if (!this.#offers.subscriptions.includes(message.session.lane)) return refuse('not-offered');
    const cards = message.view === 'cards';
    const webCards = who.clientClass === 'web-cards';
    if (webCards && !cards) return refuse('class');
    const resolved: Resolved = await resolveSubscription(message.session, this.ctx.dispatch);
    if (resolved.kind === 'refused') return refuse(resolved.reason);
    if (resolved.kind !== 'session') return refuse('grade');
    const record = reads.record(resolved.target);
    const owners = await reads.owners();
    const allowed = cards ? owns(record, who.member, owners) : rankAtLeast(sessionRank(record, who.member, owners), 'view');
    if (!allowed) return refuse(webCards ? 'class' : 'grade');
    return { ok: true, target: resolved.target };
  }

  /** A query, against the binding its executing side stored: the same member, still holding `view` (or the right) on it. */
  async #query(request: AuthorizeRequest, who: Who, reads: Reads): Promise<Decision> {
    const binding = request.input as QueryBinding;
    if (binding.member !== who.member) return refuse('grade');
    const record = binding.target === null ? null : reads.record(binding.target);
    // A web-cards device hears only what its class may do: an answer or approval on a session its member owns.
    if (who.clientClass === 'web-cards' && !(QUERYABLE_BY_WEB_CARDS.has(request.name) && owns(record, who.member, await reads.owners()))) return refuse('class');
    if (binding.target !== null) {
      const rank = sessionRank(record, who.member, await reads.owners());
      return rankAtLeast(rank, 'view') ? { ok: true, target: binding.target } : refuse('grade');
    }
    // The machine's own target: a spawn's (or another machine-graded operation's) right, still held.
    const row = Object.hasOwn(this.#offers.commands, request.name) ? this.#offers.commands[request.name] : undefined;
    const spec = row === undefined ? undefined : this.#gradeOf(request.name, row);
    if (typeof spec === 'string' && isMachineGrade(spec) && !(await this.ctx.rights(who.member)).includes(spec)) return refuse('grade');
    return { ok: true };
  }
}

function sameStamp(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
