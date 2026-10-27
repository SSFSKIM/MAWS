// An action's freshness and replay at the endpoint (O10 M7; RL4; RL §4.7): checked before authorization, so a stale or
// replayed action is refused before anything is read for it (a web-cards assertion's counter spent, a session's
// record read). The shape is the channel's (`readMessage` holds every `act` to `isAction`, closing a channel on one out
// of shape); here the times and the nonce, in order:
//   - `created` within FRESH_MS (60 s) of the machine's clock either way (`stale`);
//   - `opCreated` no later than `created` + FRESH_MS (`malformed`): an operation is never first sealed after this sealing;
//   - `opCreated` within OP_HORIZON_S of the clock (`expired`): an older one may have left every ledger;
//   - the nonce unseen from this device in the last NONCE_WINDOW_MS (`replayed`).
// The endpoint keeps no ledger for others' actions (RL §4.7), only this window, in memory: a restart loses it safely,
// since nothing it would refuse is fresh after 60 s. The window holds at most NONCE_WINDOW_MAX nonces; past that every
// action is refused `busy` until older ones age out, so a flood can't grow it without bound.
import { actionTimes, FRESH_MS, type Action, type RefusalReason } from 'org-protocol';

export const NONCE_WINDOW_MS = 120_000;
export const NONCE_WINDOW_MAX = 100_000;

export class Freshness {
  /** `device\nnonce` → when it was seen, oldest first (a Map keeps insertion order). */
  readonly #seen = new Map<string, number>();

  /** The refusal for `action` from `device` at `now` (epoch ms), or null; a nonce that passes is remembered. */
  check(action: Action, device: string, now: number): RefusalReason | null {
    const times = actionTimes(action, now);
    if (!times.ok && times.reason === 'stale') return 'stale';
    if (Date.parse(action.opCreated) > Date.parse(action.created) + FRESH_MS) return 'malformed';
    if (!times.ok) return times.reason;
    for (const [key, at] of this.#seen) {
      if (now - at <= NONCE_WINDOW_MS) break;
      this.#seen.delete(key);
    }
    const key = `${device}\n${action.nonce}`;
    if (this.#seen.has(key)) return 'replayed';
    if (this.#seen.size >= NONCE_WINDOW_MAX) return 'busy';
    this.#seen.set(key, now);
    return null;
  }
}
