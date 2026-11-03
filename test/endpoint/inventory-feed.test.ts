// The `browser.inventory` feed's backlog bound (P5 O17 M9a; O17's Interfaces §K): the feed ends `behind`, and lets go of
// its watch, the moment what it queued past the device's credit crosses the bound — the inventory that crosses it the
// last one or not, the opening snapshot included.
import { describe, expect, it } from 'vitest';
import type { BrowserInventory } from '@shared/browser/screencast';
import { InventoryFeeds } from '../../src/endpoint/inventory-feed';
import type { SessionSubscription } from '../../src/endpoint/subscriptions';

const inventory = (tabs: number): BrowserInventory => ({ epoch: 'e1', state: 'ready', tabs: Array.from({ length: tabs }, (_, i) => ({ tabId: `b_${String(i).padStart(12, '0')}`, url: 'https://example.com/', title: 'x'.repeat(40) })) }) as unknown as BrowserInventory;

/** A subscription the device gives no credit: everything it is handed stays queued. */
function subscription() {
  const sent: Array<[string, ...unknown[]]> = [];
  let backlog = 0;
  let ended: string | null = null;
  const queue = (value: unknown) => void (backlog += JSON.stringify(value).length);
  const sub = {
    session: { id: 'app-1' },
    get ended() {
      return ended !== null;
    },
    get backlog() {
      return backlog;
    },
    subbed: (mode: string) => void sent.push(['subbed', mode]),
    snap: (_at: unknown, value: unknown) => {
      if (ended !== null) return;
      queue(value);
      sent.push(['snap']);
    },
    ev: (_at: unknown, body: unknown) => {
      queue(body);
      sent.push(['ev']);
    },
    end: (reason: string) => {
      ended ??= reason;
      sent.push(['end', reason]);
    },
  };
  return { sub: sub as unknown as SessionSubscription, sent, ended: () => ended };
}

/** A tab engine whose watch answers at once with `first`, then each `change(...)`. */
function browser(first: BrowserInventory) {
  const watchers = new Set<(inventory: BrowserInventory) => void>();
  return {
    watchers,
    change: (next: BrowserInventory) => [...watchers].forEach((watcher) => watcher(next)),
    feed: {
      watchInventory(_app: string, watcher: (inventory: BrowserInventory) => void) {
        watchers.add(watcher);
        watcher(first);
        return () => void watchers.delete(watcher);
      },
    },
  };
}

describe('the `browser.inventory` feed past its backlog', () => {
  it('ends `behind` and unwatches at the change that crosses the bound, when no change comes after it', () => {
    const engine = browser(inventory(1));
    const feeds = new InventoryFeeds({ browser: () => engine.feed, backlogBytes: JSON.stringify(inventory(1)).length + 100 });
    const { sub, sent, ended } = subscription();
    feeds.open(sub);
    expect(ended()).toBeNull();
    engine.change(inventory(3)); // the last change: past the bound once queued
    expect(ended()).toBe('behind');
    expect(sent.at(-1)).toEqual(['end', 'behind']);
    expect(engine.watchers.size).toBe(0);
  });

  it('ends `behind` at its opening snapshot when that alone is past the bound', () => {
    const engine = browser(inventory(5));
    const feeds = new InventoryFeeds({ browser: () => engine.feed, backlogBytes: 100 });
    const { sub, sent, ended } = subscription();
    feeds.open(sub);
    expect(ended()).toBe('behind');
    expect(sent).toEqual([['subbed', 'snapshot'], ['snap'], ['end', 'behind']]);
    expect(engine.watchers.size).toBe(0);
  });

  it('stays open under the bound, each change queued', () => {
    const engine = browser(inventory(1));
    const feeds = new InventoryFeeds({ browser: () => engine.feed, backlogBytes: 10_000 });
    const { sub, sent, ended } = subscription();
    feeds.open(sub);
    engine.change(inventory(2));
    engine.change(inventory(2));
    expect(ended()).toBeNull();
    expect(sent).toEqual([['subbed', 'snapshot'], ['snap'], ['ev'], ['ev']]);
    expect(engine.watchers.size).toBe(1);
  });
});
