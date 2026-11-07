// The channel's routes behind authorization (O10 M5): each `call`, `act` and `sub` a device sends is decided by
// `authorize` before its executor sees it, and a refusal answers in the request's own message (`result`, `ack`, `ended`)
// with the reason. What is authorized goes to the executors M7 (actions, through their ledgers) and M8 (reads and
// subscriptions) set; until they do, it is answered `unavailable`: authorized, with nothing here to run it. `query` stays
// M7's: its authorization needs the binding the executing side stored (`authorize`'s `query` kind).
//
// P5 O7 M4: a call's own `session` (RL2's `call.session`) goes to authorization with it, for the `checkout` rule. A `sub`
// reaches the gate as a session's (its stream, or its `checkout` feed) or, from M6, as one of the machine's feeds.
//
// P5 O7 M5a: for a device that listed `rl2.bytes`, a call's `input` and an act's `args` are read decoded from the bytes
// codec's tagged form (bytes.ts): authorization decides, and validates, the decoded copy, and a call's executor is handed
// it; an act's executor gets the action as it was sealed, its `args` tagged, which the ledger decodes for itself. An
// `artifact`-rule decision names its artifact (`Granted.artifact`), which an act's claim records.
import type { ActMessage, CallMessage, SubMessage } from 'org-protocol';
import type { Reader } from '@shared/ipc/client';
import type { ArtifactTarget, AuthorizeRequest, Decision, SetupTarget, Who } from './authorize';
import { readBytes } from './bytes';
import type { ChannelRoutes, RemoteChannel } from './channels';
import type { SessionTarget } from './sources';

/**
 * An authorized request's decision: the session it is about, where it names one, or the artifact (P5 O7 M5a), or (P5 O7
 * M9) a setup row's checked directory, which its executor acts on; (P5 O8 M6a) a call's or an act's reader, whose reading
 * its `machine` requests read and write (readers.ts); `stands`,
 * whether it stands still (authorize.ts' `Decision`); `askedAt`, when the gate was asked (P5 O7 M5c review 1: the call's
 * arrival, from which an acquisition is bounded, acquire.ts); (P5 O8 M6a) `again`, a call decided once more through the
 * gate, for an executor that finds its decision moved before the machine heard it (absent on the call decided again).
 */
export type Granted = { target?: SessionTarget; artifact?: ArtifactTarget; setup?: SetupTarget; reader?: Reader; stands?: () => boolean; askedAt?: number; again?: () => void };

export type Executors = {
  call(channel: RemoteChannel, message: CallMessage, decision: Granted): void;
  act(channel: RemoteChannel, message: ActMessage, decision: Granted): void;
  sub(channel: RemoteChannel, message: SubMessage, decision: Granted): void;
  /** A refused `sub`, answered by its executor (M8 registers a subscription before it is decided); else `ended` here. */
  subRefused?(channel: RemoteChannel, message: SubMessage, reason: string): void;
  /** P5 O7 M5c review 1: a refused `act`, answered by its executor (which settles what it noted at its receipt); else here. */
  actRefused?(channel: RemoteChannel, message: ActMessage, reason: string): void;
};

const UNAVAILABLE: Executors = {
  call: (channel, m) => void channel.send({ t: 'result', id: m.id, ok: false, error: { code: 'unavailable' } }),
  act: (channel, m) => void channel.send({ t: 'ack', opId: m.action.opId, state: 'refused', reason: 'unavailable' }),
  sub: (channel, m) => void channel.send({ t: 'ended', sub: m.sub, reason: 'unavailable' }),
};

export type GateContext = {
  authorize(request: AuthorizeRequest, who: Who, now: number): Promise<Decision>;
  now(): number;
  log(line: string): void;
};

export class Gate {
  #executors: Executors = UNAVAILABLE;

  constructor(private readonly ctx: GateContext) {}

  /** Sets the executors M7 and M8 build; one left out keeps answering `unavailable`. */
  setExecutors(executors: Partial<Executors>): void {
    this.#executors = { ...this.#executors, ...executors };
  }

  /** The routes the channel table runs; `sub` behind the subscription table, which hands on a session's. */
  routes(): Pick<ChannelRoutes, 'call' | 'act'> & { sub(channel: RemoteChannel, m: SubMessage): void } {
    return {
      call: (channel, sent) => {
        const m: CallMessage = { ...sent, input: readBytes(channel, sent.input) };
        const request: AuthorizeRequest = { kind: 'call', name: m.name, input: m.input, ...(m.session === undefined ? {} : { session: m.session }) };
        const decide = (again: boolean) =>
          this.#decide(channel, request, {
            granted: (decision) => this.#executors.call(channel, m, again ? { ...decision, again: () => decide(false) } : decision),
            refused: (reason) => void channel.send({ t: 'result', id: m.id, ok: false, error: { code: reason } }),
          });
        decide(true);
      },
      act: (channel, m) =>
        this.#decide(channel, { kind: 'act', name: m.action.action, input: readBytes(channel, m.action.args), action: m.action }, {
          granted: (decision) => this.#executors.act(channel, m, decision),
          refused: (reason) => (this.#executors.actRefused === undefined ? void channel.send({ t: 'ack', opId: m.action.opId, state: 'refused', reason }) : this.#executors.actRefused(channel, m, reason)),
        }),
      sub: (channel, m) =>
        this.#decide(channel, { kind: 'sub', name: 'sub', input: m }, {
          granted: (decision) => this.#executors.sub(channel, m, decision),
          refused: (reason) => (this.#executors.subRefused === undefined ? void channel.send({ t: 'ended', sub: m.sub, reason }) : this.#executors.subRefused(channel, m, reason)),
        }),
    };
  }

  #decide(channel: RemoteChannel, request: AuthorizeRequest, answer: { granted(decision: Granted): void; refused(reason: string): void }): void {
    const who: Who = { member: channel.member, device: channel.device, clientClass: channel.clientClass, client: channel.client };
    const askedAt = this.ctx.now();
    this.ctx
      .authorize(request, who, askedAt)
      .then((decision) => {
        if (channel.closed) return;
        if (decision.ok) answer.granted({ ...(decision.target === undefined ? {} : { target: decision.target }), ...(decision.artifact === undefined ? {} : { artifact: decision.artifact }), ...(decision.setup === undefined ? {} : { setup: decision.setup }), ...(decision.reader === undefined ? {} : { reader: decision.reader }), ...(decision.stands === undefined ? {} : { stands: decision.stands }), askedAt });
        else answer.refused(decision.reason);
      })
      .catch((error: unknown) => {
        this.ctx.log(`endpoint: a \`${request.kind}\` on channel ${channel.key} could not be decided or handed on: ${(error as Error).message}`);
        if (!channel.closed) answer.refused('unavailable');
      });
  }
}
