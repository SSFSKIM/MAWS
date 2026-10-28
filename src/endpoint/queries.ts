// RL4's query (O10 M7; RL §4.7; Interfaces §B): what became of an action whose acknowledgement a device lost. A query
// names the executor its act went to, so it routes without the endpoint remembering anything, and the executor answers
// from its ledger with the operation's stored binding: member, device, fingerprint, target. The endpoint answers the
// asker only when the asker's member is the stored member and still holds `view` on the stored target (the stored
// member's `spawn` right for a spawn's machine target): M5's `authorize` of kind `query`, over the binding, never the
// asker's own word about the target. Otherwise `refused {reason}`, saying nothing of the operation.
//
// What a state reveals decides whether it needs the binding: `done`, `refused` (the op's own refusal) and `in-progress`
// say an operation under this id exists, so they go only through the check, and one with no binding (an entry from
// before RL10, which can't be checked against the asker) is `refused {reason: 'grade'}`; `not-received`, `expired` and
// `unavailable` say nothing of anyone's operation. sminos's binding names no operation, so a web-cards asker of a lane A
// session's op is refused `grade` too (`sminosBinding`).
//
// `not-received` is said only once the executing side has tombstoned the id, so the original, released late, is refused
// and never runs: the engine host and the endpoint's own ledger look and tombstone under one turn (`host.opQuery
// {tombstoneIfAbsent: true}`); sminos is asked `query`, then `tombstone`, whose claim check is atomic under its
// `op_lock`. A tombstone that fails because the original claimed the id meanwhile answers the claim's state instead,
// after the same check. An `opCreated` past OP_HORIZON is `expired` whether or not a ledger still holds the op. An
// outcome reads as `done`'s does (actions.ts's `outcomeOf`).
import { OP_HORIZON_S, type DeviceClass, type QueriedMessage, type QueryMessage } from 'org-protocol';
import { closedLedgerOf, outcomeOf } from './actions';
import type { AuthorizeRequest, Decision, QueryBinding, Who } from './authorize';
import type { RemoteChannel } from './channels';
import type { EndpointActions } from './endpoint-actions';
import type { QueryAnswer, Rl10 } from './rl10/link';
import type { EndpointServices } from './services';
import type { SessionTarget } from './sources';
import { resolveTarget } from './targets';

export type QueriesContext = {
  authorize(request: AuthorizeRequest, who: Who, now: number): Promise<Decision>;
  own: Pick<EndpointActions, 'query'>;
  rl10: Pick<Rl10, 'query' | 'tombstone'>;
  dispatch: EndpointServices['dispatch'];
  /** As actions.ts's: what the engine host's last ledger answer said of its ledger. */
  engineHostLedger?(closed: string | null): void;
  now(): number;
  log(line: string): void;
};

/** An executor's answer, as read here: its state, the op's outcome, and the binding it stored (absent: none). */
type Answer = { state: string; outcome?: unknown; binding: { member: string; target: SessionTarget | null; name: string } | null | 'unplaceable' };

const REVEALING: ReadonlySet<string> = new Set(['done', 'refused', 'in-progress']);
const SILENT: ReadonlySet<string> = new Set(['not-received', 'expired', 'unavailable']);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

export class Queries {
  constructor(private readonly ctx: QueriesContext) {}

  /** The channel's `query` route. */
  route(channel: RemoteChannel, m: QueryMessage): void {
    this.#answer(channel, m)
      .then((answer) => void channel.send(answer))
      .catch((error: unknown) => {
        this.ctx.log(`endpoint: a query on channel ${channel.key} could not be answered: ${(error as Error).message}`);
        channel.send({ t: 'queried', opId: m.opId, state: 'unavailable' });
      });
  }

  async #answer(channel: RemoteChannel, m: QueryMessage): Promise<QueriedMessage> {
    const { opId, opCreated } = m;
    const queried = (fields: Omit<QueriedMessage, 't' | 'opId'>): QueriedMessage => ({ t: 'queried', opId, ...fields });
    if (this.ctx.now() - Date.parse(opCreated) > OP_HORIZON_S * 1000) return queried({ state: 'expired' });
    const who: Who = { member: channel.member, device: channel.device, clientClass: channel.clientClass };
    const answer = m.executor === 'engine-host' ? await this.#engineHost(opId, opCreated) : m.executor === 'endpoint' ? this.#own(opId, opCreated) : await this.#sminos(opId, opCreated, who.clientClass);
    if (SILENT.has(answer.state)) return queried({ state: answer.state as QueriedMessage['state'] });
    if (!REVEALING.has(answer.state)) return queried({ state: 'unavailable' });
    if (answer.binding === 'unplaceable') return queried({ state: 'unavailable' });
    if (answer.binding === null) return queried({ state: 'refused', reason: 'grade' });
    const input: QueryBinding = { member: answer.binding.member, target: answer.binding.target };
    const decision = await this.ctx.authorize({ kind: 'query', name: answer.binding.name, input }, who, this.ctx.now());
    if (!decision.ok) return queried({ state: 'refused', reason: decision.reason });
    return queried({ state: answer.state as QueriedMessage['state'], ...(answer.outcome === undefined ? {} : { outcome: answer.outcome }) });
  }

  /** The engine host's ledger (lane B), looked up and tombstoned in one turn. Its target is an appSessionId. */
  async #engineHost(opId: string, opCreated: string): Promise<Answer> {
    const response = await this.ctx.dispatch('engine-host', 'host.opQuery', { opId, opCreated, tombstoneIfAbsent: true });
    if (response.ok) this.ctx.engineHostLedger?.(closedLedgerOf(response.value));
    if (!response.ok || !isObject(response.value) || !isText(response.value.state)) return { state: 'unavailable', binding: null };
    const value = response.value;
    if (!REVEALING.has(value.state as string)) return { state: value.state as string, binding: null };
    if (!isText(value.member) || !isText(value.name)) return { state: value.state as string, binding: null };
    // The stored target is the lane B session's stable id; its record is read through the engine session it has now.
    let target: SessionTarget | null = null;
    if (value.target !== null && value.target !== undefined) {
      const resolved = isText(value.target) ? await resolveTarget('appSessionId', { appSessionId: value.target }, undefined, this.ctx.dispatch) : null;
      if (resolved?.kind === 'refused' && resolved.reason === 'unavailable') return { state: value.state as string, binding: 'unplaceable' };
      if (resolved?.kind !== 'session') return { state: value.state as string, binding: null };
      target = resolved.target;
    }
    return { state: value.state as string, ...(value.state === 'done' ? { outcome: outcomeOf(value.outcome) } : {}), binding: { member: value.member, target, name: value.name } };
  }

  /** The endpoint's own ledger: its actions' target is the machine. */
  #own(opId: string, opCreated: string): Answer {
    const answer = this.ctx.own.query(opId, opCreated);
    if (answer.state !== 'done' && answer.state !== 'in-progress') return { state: answer.state, binding: null };
    return { state: answer.state, ...(answer.state === 'done' ? { outcome: outcomeOf(answer.outcome) } : {}), binding: { member: answer.member, target: null, name: answer.name } };
  }

  /** sminos's ledger (lane A) over RL10: `query`, then `tombstone` for an op it holds nothing of. */
  async #sminos(opId: string, opCreated: string, clientClass: DeviceClass): Promise<Answer> {
    let answer: QueryAnswer = await this.ctx.rl10.query(opId, opCreated);
    if (answer.state === 'not-received') {
      const stone = await this.ctx.rl10.tombstone(opId, opCreated);
      if (stone.ok === true) return { state: 'not-received', binding: null };
      // The original claimed the id meanwhile (or the ledger can't be written): the claim's state, read whole again,
      // since a failed tombstone carries no outcome.
      answer = stone.state === 'done' || stone.state === 'refused' ? await this.ctx.rl10.query(opId, opCreated) : stone;
    }
    return { state: answer.state, ...(answer.outcome === undefined ? {} : { outcome: answer.outcome }), binding: sminosBinding(answer, clientClass) };
  }
}

/**
 * sminos's binding: `member`, and its `target`, `{kind: 'machine'}` for a spawn, else `{kind: 'session', session}`.
 * sminos names no RPC with it, so the name a query is authorized under is `sminos.spawn` for the machine, and for a
 * session one that grades it at `view`. A web-cards asker is told nothing of a session's op (`grade`, as for no
 * binding): M5 lets that class hear only of an answer or a decision, which the binding can't show this op was, and its
 * device id proves nothing, since the org may have replaced another class's device with web-cards keys under the same
 * id. Carrying the RPC's name in the binding is O12's contract to change.
 */
function sminosBinding(answer: QueryAnswer, clientClass: DeviceClass): Answer['binding'] {
  const { member, target } = answer;
  if (!isText(member) || !isObject(target)) return null;
  if (target.kind === 'machine') return { member, target: null, name: 'sminos.spawn' };
  if (target.kind !== 'session' || !isText(target.session) || clientClass === 'web-cards') return null;
  return { member, target: { lane: 'A', session: target.session }, name: 'sminos.steer' };
}
