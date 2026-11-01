// The endpoint's own actions (O10 M7; RL4, RL §4.7, §5.2, §6.3), run under its own ledger, `<stateDir>/ops.jsonl`
// (the shared op ledger's format, Interfaces §H). Both take effect inside the endpoint's process, so claim and effect
// never cross a process boundary:
//   - `endpoint.grant {grant}`: a signed grant, kept by the ledger's rule (grants.ts), the devices' `caps` refreshed;
//   - `endpoint.state {states, transitions}`: an admin's delivery of a signed state (RL §5.2's direct revocation),
//     `done` only after the new head is on disk (the org view adopts, then answers).
// Their authority is their own signatures (M5 grades them none), so the binding a query checks is the sender's member
// with the machine as its target.
//
// P5 O7 M3: `forward.open {port}`, graded `shell` on the machine (the offer table's row; authorization held its args to a
// port), opens a forward of the machine's loopback port for the sending device (forwards.ts) and answers `{forward,
// port}`, which a `tcp` stream names. The forward is held by the channel the act came on, and by the channel of any
// reseal the ledger answers while the forward is kept, so a device that reconnects within the window keeps it.
import type { Action } from 'org-protocol';
import { OpLedger, type OpAnswer, type OpQueryAnswer } from '@shared/host/op-ledger';
import type { RemoteChannel } from './channels';

/** What an effect answers: the command's own answer, as the engine host's ledger keeps one. */
export type EffectResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message?: string } };

export type EndpointActionsContext = {
  /** The state directory, once started. */
  stateDir(): string;
  /** A grant's intake (grants.ts's `acceptGrant`), and the `caps` it may change. */
  grant(value: unknown): Promise<EffectResult>;
  /** A delivered state adopted (on disk, then applied). */
  deliver(states: unknown, transitions: unknown): Promise<EffectResult>;
  /** A forward of the machine's `port` opened for the device (P5 O7 M3), answering `{forward, port}`. */
  openForward(who: { member: string; device: string }, port: number): Promise<EffectResult>;
  /** The device's forward `forward`, held by `channel` while it is kept (an answered reseal's channel too). */
  holdForward(device: string, forward: string, channel: RemoteChannel): void;
  now(): number;
  log(line: string): void;
};

export const OWN_ACTIONS: ReadonlySet<string> = new Set(['endpoint.grant', 'endpoint.state', 'forward.open']);

export class EndpointActions {
  #ledger: OpLedger | null = null;

  constructor(private readonly ctx: EndpointActionsContext) {}

  /** The ledger read and compacted (the endpoint's start). */
  open(): void {
    this.#ledger = OpLedger.open(this.ctx.stateDir(), 'ops.jsonl', { now: this.ctx.now, log: (line) => this.ctx.log(`endpoint: ${line}`) });
  }

  /** Why its ledger answers nothing until mawsd restarts, or null (the status shows it). */
  get closed(): string | null {
    return this.#ledger?.closed ?? null;
  }

  /**
   * Runs `action` once under the ledger: a known opId answers what the ledger holds and runs nothing. `channel`: the one
   * it came on, which holds the forward a `forward.open` names.
   */
  async run(action: Action, who: { member: string; device: string }, fingerprint: string, channel?: RemoteChannel): Promise<OpAnswer> {
    const ledger = this.#ledger;
    if (ledger === null || !OWN_ACTIONS.has(action.action)) return { state: 'refused', reason: 'unavailable' };
    const begun = ledger.begin(action.opId, action.opCreated, { member: who.member, device: who.device, fingerprint, target: null, name: action.action }, () => null);
    let answer: OpAnswer;
    if (begun.kind === 'answered') answer = begun.answer;
    else {
      const result = await this.#effect(action, who);
      ledger.finish(action.opId, result);
      answer = { state: 'done', result };
    }
    if (action.action === 'forward.open' && channel !== undefined && answer.state === 'done') {
      const forward = forwardOf(answer.result);
      if (forward !== null) this.ctx.holdForward(who.device, forward, channel);
    }
    return answer;
  }

  /**
   * RL4's query of one of its own operations; an absent id is tombstoned before `not-received` is said, unless the asker
   * only reads a binding (a stream's admission, P5 O7 M3), which leaves the ledger as it is.
   */
  query(opId: string, opCreated: string, tombstoneIfAbsent = true): OpQueryAnswer {
    return this.#ledger?.query(opId, opCreated, tombstoneIfAbsent) ?? { state: 'unavailable' };
  }

  async #effect(action: Action, who: { member: string; device: string }): Promise<EffectResult> {
    try {
      if (action.action === 'endpoint.grant') return await this.ctx.grant(action.args.grant);
      if (action.action === 'forward.open') return await this.ctx.openForward(who, action.args.port as number);
      return await this.ctx.deliver(action.args.states, action.args.transitions);
    } catch (error) {
      return { ok: false, error: { code: 'internal', message: (error as Error).message } };
    }
  }
}

/** The forward a kept `forward.open` result names, or null (a failed one). */
export function forwardOf(result: unknown): string | null {
  if (typeof result !== 'object' || result === null || (result as { ok?: unknown }).ok !== true) return null;
  const value = (result as { value?: unknown }).value;
  const forward = typeof value === 'object' && value !== null ? (value as { forward?: unknown }).forward : undefined;
  return typeof forward === 'string' && forward !== '' ? forward : null;
}
