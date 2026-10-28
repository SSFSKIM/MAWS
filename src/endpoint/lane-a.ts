// Lane A's copies to sminos and its results back (O10 M7; RL4; Interfaces §B, §D). sminos keeps the op's ledger, and
// with it the one authority on whose an op is: its binding (the member and the operation's fingerprint, sminos's
// identity for a copy), which it answers `query` with for an op it holds or has in flight. The endpoint keeps nothing
// that outlives it, so before a copy goes down it asks sminos, unless a copy of the same sender is already held here:
//   - bound to this sender: the copy goes down;
//   - bound to another, or held with no binding (a DX2-era op, which no RL10 sender can be checked against):
//     `op-conflict`, here, and nothing goes down or is recorded;
//   - held by none (`not-received`, `expired`): the copy goes down; sminos binds it, or refuses it under its own nonce;
//   - no answer (`unavailable`, ANSWER_MS): `unavailable`.
// The copies of one opId are taken one at a time, so two first copies can't both pass one lookup.
//
// A result goes by its nonce: to the copy that went down under it, and with it every held copy of the same op by the
// same sender (sminos answers under the latest copy's nonce, but an earlier copy's may already be on its way), to each
// one's channel while open; then they are let go, so a copy after the result is asked about afresh. A copy whose result
// never comes is held KEPT_S (as long as sminos keeps the op), its nonce taken (`replayed`, whoever sends it: the
// freshness window is each device's). A closed channel frees nothing. At most LANE_A_MAX copies are held (`busy`).
import { KEPT_S, type Action, type RefusalReason } from 'org-protocol';
import type { RemoteChannel } from './channels';
import type { QueryAnswer, Rl10, RpcResult } from './rl10/link';

/** At most this many lane A copies are held; past it a first copy is refused `busy` until older ones age out. */
export const LANE_A_MAX = 100_000;

export type LaneAContext = {
  rl10: Pick<Rl10, 'draw' | 'rpc' | 'query'>;
  hold(reason: string): () => void;
  now(): number;
};

type Sender = { member: string; fingerprint: string };
/** A copy handed down: its op, its sender, its channel (and that channel's close listener), the hold while awaited. */
type Copy = Sender & { opId: string; channel: RemoteChannel; until: number; off(): void; release: (() => void) | null };

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';
const same = (a: Sender, b: Sender) => a.member === b.member && a.fingerprint === b.fingerprint;

/** What sminos's answer for an op says of a copy from `sender`: it may go down, or why not. */
export function admission(answer: QueryAnswer, sender: Sender): 'go' | 'op-conflict' | 'unavailable' {
  if (answer.state === 'unavailable') return 'unavailable';
  if (isText(answer.member) && isText(answer.fingerprint)) return same({ member: answer.member, fingerprint: answer.fingerprint }, sender) ? 'go' : 'op-conflict';
  return answer.state === 'not-received' || answer.state === 'expired' ? 'go' : 'op-conflict';
}

export class LaneA {
  /** Held copies by nonce, oldest first. */
  readonly #copies = new Map<string, Copy>();
  /** Each opId's turn: the copies of one op are taken one at a time. */
  readonly #turns = new Map<string, Promise<unknown>>();

  constructor(private readonly ctx: LaneAContext) {}

  /** A copy handed down (null), or why not. */
  hand(channel: RemoteChannel, action: Action, who: { member: string; device: string }, fingerprint: string): Promise<RefusalReason | null> {
    return this.#turn(action.opId, () => this.#hand(channel, action, who, fingerprint));
  }

  /** sminos's result: `done` to the open channels of the copies it answers. */
  result(result: RpcResult): void {
    const copy = this.#copies.get(result.nonce);
    if (copy === undefined || copy.opId !== result.opId) return;
    const told = new Set<RemoteChannel>();
    for (const [nonce, held] of this.#copies) {
      if (held.opId !== copy.opId || !same(held, copy)) continue;
      this.#letGo(nonce, held);
      if (held.channel.closed || told.has(held.channel)) continue;
      told.add(held.channel);
      held.channel.send({ t: 'done', opId: copy.opId, outcome: result.outcome });
    }
  }

  stop(): void {
    for (const [nonce, copy] of this.#copies) this.#letGo(nonce, copy);
  }

  async #hand(channel: RemoteChannel, action: Action, who: { member: string; device: string }, fingerprint: string): Promise<RefusalReason | null> {
    const now = this.ctx.now();
    this.#expire(now);
    if (this.#copies.has(action.nonce)) return 'replayed';
    const drawn = this.ctx.rl10.draw(action, who, fingerprint);
    if (!drawn.ok) return drawn.reason;
    const sender = { member: who.member, fingerprint };
    if (![...this.#copies.values()].some((held) => held.opId === action.opId && same(held, sender))) {
      if (this.#copies.size >= LANE_A_MAX) return 'busy';
      const admitted = admission(await this.ctx.rl10.query(action.opId, action.opCreated), sender);
      if (admitted !== 'go') return admitted;
      if (this.#copies.has(action.nonce)) return 'replayed';
    }
    if (channel.closed) return 'unavailable';
    // Sent through `rpc`, which checks the launch again: it may have moved while sminos was asked.
    const sent = this.ctx.rl10.rpc(action, who, fingerprint);
    if (!sent.ok) return sent.reason;
    const copy: Copy = { ...sender, opId: action.opId, channel, until: now + KEPT_S * 1000, off: () => {}, release: this.ctx.hold('op') };
    copy.off = channel.onClose(() => {
      copy.release?.();
      copy.release = null;
    });
    this.#copies.set(action.nonce, copy);
    return null;
  }

  #letGo(nonce: string, copy: Copy): void {
    copy.off();
    copy.release?.();
    copy.release = null;
    this.#copies.delete(nonce);
  }

  /** Copies past KEPT_S let go: sminos keeps none of their ops longer, so none is answered after. */
  #expire(now: number): void {
    for (const [nonce, copy] of this.#copies) {
      if (copy.until > now) break;
      this.#letGo(nonce, copy);
    }
  }

  #turn<T>(opId: string, run: () => Promise<T>): Promise<T> {
    const next = (this.#turns.get(opId) ?? Promise.resolve()).then(run, run);
    const settled = next.then(
      () => {},
      () => {},
    );
    this.#turns.set(opId, settled);
    void settled.then(() => {
      if (this.#turns.get(opId) === settled) this.#turns.delete(opId);
    });
    return next;
  }
}
