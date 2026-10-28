// The channel's routes behind authorization (O10 M5): each `call`, `act` and `sub` a device sends is decided by
// `authorize` before its executor sees it, and a refusal answers in the request's own message (`result`, `ack`, `ended`)
// with the reason. What is authorized goes to the executors M7 (actions, through their ledgers) and M8 (reads and
// subscriptions) set; until they do, it is answered `unavailable`: authorized, with nothing here to run it. `query` stays
// M7's: its authorization needs the binding the executing side stored (`authorize`'s `query` kind).
import type { ActMessage, CallMessage, SubMessage } from 'org-protocol';
import type { AuthorizeRequest, Decision, Who } from './authorize';
import type { ChannelRoutes, RemoteChannel } from './channels';
import type { SessionTarget } from './sources';

/** An authorized request's decision: the session it is about, where it names one. */
export type Granted = { target?: SessionTarget };

export type Executors = {
  call(channel: RemoteChannel, message: CallMessage, decision: Granted): void;
  act(channel: RemoteChannel, message: ActMessage, decision: Granted): void;
  sub(channel: RemoteChannel, message: SubMessage, decision: Granted): void;
  /** A refused `sub`, answered by its executor (M8 registers a subscription before it is decided); else `ended` here. */
  subRefused?(channel: RemoteChannel, message: SubMessage, reason: string): void;
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

  /** The routes the channel table runs. */
  routes(): Pick<ChannelRoutes, 'call' | 'act' | 'sub'> {
    return {
      call: (channel, m) =>
        this.#decide(channel, { kind: 'call', name: m.name, input: m.input }, {
          granted: (decision) => this.#executors.call(channel, m, decision),
          refused: (reason) => void channel.send({ t: 'result', id: m.id, ok: false, error: { code: reason } }),
        }),
      act: (channel, m) =>
        this.#decide(channel, { kind: 'act', name: m.action.action, input: m.action.args, action: m.action }, {
          granted: (decision) => this.#executors.act(channel, m, decision),
          refused: (reason) => void channel.send({ t: 'ack', opId: m.action.opId, state: 'refused', reason }),
        }),
      sub: (channel, m) =>
        this.#decide(channel, { kind: 'sub', name: 'sub', input: m }, {
          granted: (decision) => this.#executors.sub(channel, m, decision),
          refused: (reason) => (this.#executors.subRefused === undefined ? void channel.send({ t: 'ended', sub: m.sub, reason }) : this.#executors.subRefused(channel, m, reason)),
        }),
    };
  }

  #decide(channel: RemoteChannel, request: AuthorizeRequest, answer: { granted(decision: Granted): void; refused(reason: string): void }): void {
    const who: Who = { member: channel.member, device: channel.device, clientClass: channel.clientClass };
    this.ctx
      .authorize(request, who, this.ctx.now())
      .then((decision) => {
        if (channel.closed) return;
        if (decision.ok) answer.granted(decision.target === undefined ? {} : { target: decision.target });
        else answer.refused(decision.reason);
      })
      .catch((error: unknown) => {
        this.ctx.log(`endpoint: a \`${request.kind}\` on channel ${channel.key} could not be decided or handed on: ${(error as Error).message}`);
        if (!channel.closed) answer.refused('unavailable');
      });
  }
}
