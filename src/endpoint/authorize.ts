// Authorization at the endpoint (O10 M5; RL §5.5, §5.6, §5.10, §6.3; Interfaces §G): every `call`, `act`, `query` and
// `sub` a remote device sends is decided here, by one function, before anything runs. The executing sides (M7's ledgers,
// M8's reads and subscriptions) see only what it let through.
//
// A command is decided in this order, the first refusal answering:
//   1. it is in the offer table (`not-offered`), as the kind of request its row is: a call of an act is `act-required`,
//      an act of a call `not-offered`; an action names this org, this machine and the channel's own device (`malformed`);
//   2. it has a grade (`ungraded`), never a routing class (`grade`: no caller holds one); a registry command's input
//      holds to its schema (`malformed`); a by-effect command's rule gives the grade its input takes (`no-rule`), held
//      to the command's floor; a call is a read, so anything graded above `view` must come as an act (`act-required`);
//   3. the caller's class: a `web-cards` device reads listings and answers on its member's own sessions, nothing else
//      (`class`);
//   4. the machine's policy: a head too old stops every action but a delivered state (`state-too-old`), and read-only
//      refuses everything graded above `view` (`read-only`);
//   5. the caller's standing: a session rank on the session its target rule reads (`no-target` when it names none,
//      `grade` below it; `list`-graded machine reads need none), a machine grade among the member's rights (`grade`);
//      then a spawn, for a member who may spawn, is held to the ceiling, the known checkouts and its allowed fields
//      (`ceiling`, `unknown-checkout`, `spec-field`);
//   6. what the class may say: a web-cards answer only takes or refuses what is pending (`class`);
//   7. presence: a web-cards action's WebAuthn assertion, a native action's step-up where RL §5.6 asks for it
//      (`step-up`).
// The endpoint's own actions (`endpoint.grant`, `endpoint.state`) carry their authority in their signatures and take no
// grade. A `sub` takes `view` on its session, or ownership for the `cards` view; a `query` is answered only to the member
// who sent the operation, while they still hold `view` on its stored target (M7 brings the binding).
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
const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** One decision's reads, each made at most once. */
class Reads implements EffectReads {
  #owners: Promise<string[]> | null = null;
  readonly #pending = new Map<string, Promise<string | null>>();

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

  pendingKind(appSessionId: string, requestId: string): Promise<string | null> {
    const key = `${appSessionId}\n${requestId}`;
    let read = this.#pending.get(key);
    if (read === undefined) {
      read = this.ctx.dispatch('engine-host', 'session.pendingRequest', { appSessionId, requestId }).then((response) => {
        // An engine host that can't say what is pending can't let an answer be graded.
        if (!response.ok) throw new Refused('unavailable');
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

  /** The decision on one request from `who`, at `now` (epoch ms). */
  async authorize(request: AuthorizeRequest, who: Who, now: number): Promise<Decision> {
    const org = this.ctx.org();
    const ref = this.ctx.ref();
    if (org === null || ref === null) return refuse('unavailable');
    const reads = new Reads(this.ctx, org, ref, new Date(now));
    try {
      if (request.kind === 'query') return await this.#query(request, who, reads);
      if (request.kind === 'sub') return await this.#sub(request.input, who, reads);
      return await this.#command(request, who, org, ref, reads);
    } catch (error) {
      if (error instanceof Refused) return refuse(error.reason);
      throw error;
    }
  }

  get #offers(): Offers {
    return this.ctx.offers ?? OFFERS;
  }

  #gradeOf(name: string, row: OfferRow): GradeSpec | null | undefined {
    return row.grade === undefined ? (this.ctx.gradeOf ?? declaredGrade)(name) : row.grade;
  }

  async #command(request: AuthorizeRequest, who: Who, org: { head: OrgState; tooOld: boolean }, ref: string, reads: Reads): Promise<Decision> {
    const { kind, name, action } = request;
    // 1. Offered, as this kind of request, and an action about this machine from this device.
    const row = Object.hasOwn(this.#offers.commands, name) ? this.#offers.commands[name] : undefined;
    if (row === undefined) return refuse('not-offered');
    if (kind === 'act' && row.kind !== 'act') return refuse('not-offered');
    if (kind === 'call' && row.kind === 'act') return refuse('act-required');
    if (kind === 'act' && (action === undefined || action.action !== name || action.org !== org.head.org || action.machine !== ref || action.device !== who.device)) return refuse('malformed');
    const input = kind === 'act' ? action!.args : request.input;

    // 2. Its grade, as its input's effect takes it.
    const spec = this.#gradeOf(name, row);
    if (spec === undefined) return refuse('ungraded');
    if (typeof spec === 'string' && isRoutingClass(spec)) return refuse('grade');
    if (row.grade === undefined && !this.#validInput(name, input)) return refuse('malformed');
    const grade = await this.#effectiveGrade(name, spec, input, reads);
    if (typeof grade === 'object' && grade !== null) return grade;
    if (grade !== null && isRoutingClass(grade)) return refuse('grade');
    if (kind === 'call' && grade !== 'list' && grade !== 'view') return refuse('act-required');

    // 3. The class.
    const webCards = who.clientClass === 'web-cards';
    if (webCards && !WEB_CARDS.has(name)) return refuse('class');

    // 4. The machine's policy, on the effect.
    if (kind === 'act' && org.tooOld && name !== 'endpoint.state') return refuse('state-too-old');
    const policy = this.ctx.policy();
    if (grade !== null && grade !== 'list' && grade !== 'view' && policy.read_only) return refuse('read-only');

    // 5. The caller's standing on the target or the machine.
    const resolved = await resolveTarget(row.target, input, action, this.ctx.dispatch);
    if (resolved.kind === 'refused') return refuse(resolved.reason);
    if (resolved.kind === 'unknown') return refuse('grade');
    const target = resolved.kind === 'session' ? resolved.target : undefined;
    const record = target === undefined ? null : this.ctx.records.record(target);
    if (grade !== null && isSessionRank(grade)) {
      if (target === undefined && grade !== 'list') return refuse('no-target');
      if (target !== undefined && !rankAtLeast(sessionRank(record, who.member, await reads.owners()), grade)) return refuse('grade');
    } else if (grade !== null && isMachineGrade(grade) && !(await this.ctx.rights(who.member)).includes(grade)) {
      return refuse('grade');
    }
    // A spawn's args, read only for a member who may spawn: the known checkouts are no one else's to probe.
    if (name === 'sminos.spawn') {
      const refusal = spawnRefusal(input as Readonly<Record<string, unknown>>, policy, () => this.ctx.settingsMode(), this.ctx.checkouts);
      if (refusal !== null) return refuse(refusal);
    }

    // 6. A web-cards answer on its member's own session, taking or refusing only what is pending.
    if (webCards && name !== 'endpoint.listings') {
      if (!owns(record, who.member, await reads.owners())) return refuse('class');
      if (!(await this.#asPending(name, input as Readonly<Record<string, unknown>>, reads))) return refuse('class');
    }

    // 7. Presence.
    if (kind === 'act') {
      const device = deviceOf(org.head, who.member, who.device);
      if (device === undefined) return refuse('removed');
      if (webCards) {
        if (device.passkey === undefined || !(await this.#assertions.check(action!, device.passkey))) return refuse('step-up');
      } else if (stepUpRequired({ name, grade, ownsSession: owns(record, who.member, await reads.owners()), ownsMachine: (await reads.owners()).includes(who.member) })) {
        if (!(await verifyDeviceStepUp(action!, device, org.head))) return refuse('step-up');
      }
    }
    return target === undefined ? { ok: true } : { ok: true, target };
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
    const record: SessionRecord | null = this.ctx.records.record(resolved.target);
    const owners = await reads.owners();
    const allowed = cards ? owns(record, who.member, owners) : rankAtLeast(sessionRank(record, who.member, owners), 'view');
    if (!allowed) return refuse(webCards ? 'class' : 'grade');
    return { ok: true, target: resolved.target };
  }

  /** A query, against the binding its executing side stored: the same member, still holding `view` (or the right) on it. */
  async #query(request: AuthorizeRequest, who: Who, reads: Reads): Promise<Decision> {
    const binding = request.input as QueryBinding;
    if (binding.member !== who.member) return refuse('grade');
    if (binding.target !== null) {
      const rank = sessionRank(this.ctx.records.record(binding.target), who.member, await reads.owners());
      return rankAtLeast(rank, 'view') ? { ok: true, target: binding.target } : refuse('grade');
    }
    // The machine's own target: a spawn's (or another machine-graded operation's) right, still held.
    const row = Object.hasOwn(this.#offers.commands, request.name) ? this.#offers.commands[request.name] : undefined;
    const spec = row === undefined ? undefined : this.#gradeOf(request.name, row);
    if (typeof spec === 'string' && isMachineGrade(spec) && !(await this.ctx.rights(who.member)).includes(spec)) return refuse('grade');
    return { ok: true };
  }
}
