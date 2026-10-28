// The endpoint's own actions (O10 M7; RL4, RL §4.7, §5.2, §6.3), run under its own ledger, `<stateDir>/ops.jsonl`
// (the shared op ledger's format, Interfaces §H). Both take effect inside the endpoint's process, so claim and effect
// never cross a process boundary:
//   - `endpoint.grant {grant}`: a signed grant, kept by the ledger's rule (grants.ts), the devices' `caps` refreshed;
//   - `endpoint.state {states, transitions}`: an admin's delivery of a signed state (RL §5.2's direct revocation),
//     `done` only after the new head is on disk (the org view adopts, then answers).
// Their authority is their own signatures (M5 grades them none), so the binding a query checks is the sender's member
// with the machine as its target.
import type { Action } from 'org-protocol';
import { OpLedger, type OpAnswer, type OpQueryAnswer } from '@shared/host/op-ledger';

/** What an effect answers: the command's own answer, as the engine host's ledger keeps one. */
export type EffectResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message?: string } };

export type EndpointActionsContext = {
  /** The state directory, once started. */
  stateDir(): string;
  /** A grant's intake (grants.ts's `acceptGrant`), and the `caps` it may change. */
  grant(value: unknown): Promise<EffectResult>;
  /** A delivered state adopted (on disk, then applied). */
  deliver(states: unknown, transitions: unknown): Promise<EffectResult>;
  now(): number;
  log(line: string): void;
};

export const OWN_ACTIONS: ReadonlySet<string> = new Set(['endpoint.grant', 'endpoint.state']);

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

  /** Runs `action` once under the ledger: a known opId answers what the ledger holds and runs nothing. */
  async run(action: Action, who: { member: string; device: string }, fingerprint: string): Promise<OpAnswer> {
    const ledger = this.#ledger;
    if (ledger === null || !OWN_ACTIONS.has(action.action)) return { state: 'refused', reason: 'unavailable' };
    const begun = ledger.begin(action.opId, action.opCreated, { member: who.member, device: who.device, fingerprint, target: null, name: action.action }, () => null);
    if (begun.kind === 'answered') return begun.answer;
    let result: EffectResult;
    try {
      result = action.action === 'endpoint.grant' ? await this.ctx.grant(action.args.grant) : await this.ctx.deliver(action.args.states, action.args.transitions);
    } catch (error) {
      result = { ok: false, error: { code: 'internal', message: (error as Error).message } };
    }
    ledger.finish(action.opId, result);
    return { state: 'done', result };
  }

  /** RL4's query of one of its own operations; an absent id is tombstoned before `not-received` is said. */
  query(opId: string, opCreated: string): OpQueryAnswer {
    return this.#ledger?.query(opId, opCreated, true) ?? { state: 'unavailable' };
  }
}
