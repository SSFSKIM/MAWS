// A session's `browser.inventory` feed (P5 O17 M9a; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §K;
// O7's Interfaces §R): the agent's tabs on a lane B session as the machine's tab engine holds them, from `mawsd`'s route
// cache (`EndpointServices.browser.watchInventory`, which starts and loads nothing). Admitted as a subscription of the
// session at `view` (authorize.ts' `#sub`; a web-cards device's `class`), and re-checked by the table as any, ending
// `removed` once view goes; no interest (OX5).
//
// Every opening is `subbed {mode: 'snapshot', epoch: 'browser.inventory:<this endpoint's boot>', seq: 0}` and a `snap` of
// the session's BrowserInventory; each later change is `ev {body: BrowserInventory}` at the next `seq`, a complete
// inventory, so the device keeps only the latest. Each carries the route's epoch, which a screencast open names. The
// feed ends `behind` when the device leaves more than its backlog unread, and the device opens it again.
import { randomBytes } from 'node:crypto';
import { BACKLOG_BYTES } from '@shared/host/stream-catchup';
import type { BrowserFeed } from '@shared/browser/screencast';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionSubscription, Subscription } from './subscriptions';

export type InventoryFeedsContext = {
  /** The machine's agent browser, once the endpoint has its services; null before. */
  browser(): Pick<BrowserFeed, 'watchInventory'> | null;
  /** The most a feed's unread stream may hold before it ends `behind`. */
  backlogBytes?: number;
};

export class InventoryFeeds {
  readonly #ctx: InventoryFeedsContext;
  readonly #epoch = `browser.inventory:${randomBytes(9).toString('base64url')}`;
  readonly #open = new Map<Subscription, () => void>();

  constructor(ctx: InventoryFeedsContext) {
    this.#ctx = ctx;
  }

  open(sub: SessionSubscription): void {
    const browser = this.#ctx.browser();
    if (browser === null) return void sub.end('unavailable');
    const at = { epoch: this.#epoch, seq: 0 };
    let seq = 0;
    let snapped = false;
    sub.subbed('snapshot', at);
    // The watch answers the current inventory at once (the snapshot), then each change.
    const unwatch = browser.watchInventory(sub.session.id as AppSessionId, (inventory) => {
      if (sub.ended) return;
      if (!snapped) {
        snapped = true;
        return sub.snap(at, inventory);
      }
      if (sub.backlog > (this.#ctx.backlogBytes ?? BACKLOG_BYTES)) return void sub.end('behind');
      sub.ev({ epoch: this.#epoch, seq: ++seq }, inventory);
    });
    if (sub.ended) return unwatch();
    this.#open.set(sub, unwatch);
  }

  close(sub: Subscription): void {
    const unwatch = this.#open.get(sub);
    this.#open.delete(sub);
    unwatch?.();
  }

  stop(): void {
    for (const unwatch of this.#open.values()) unwatch();
    this.#open.clear();
  }
}
