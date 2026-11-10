// Every order of a session's listing events from the hub and from its machine's channel, up to a bound, through main's
// real rows (src/main/org/rows.ts; P5 O8 M6b, "Channel listings into the rows", and the plan's Decision Log entry "M6b is
// built as four tasks", item 2). The rows keep two memberships per key, written from two sources over unreliable links,
// so their interleavings are checked together rather than found one review at a time (M6a's retrospective).
//
// The scene is a session going public -> private on one machine (`k`), beside a public session of the same machine
// (`k2`) that every source keeps listing. Its records, all of which verify:
//   - L10: `k`'s public listing, in the hub's snapshot;
//   - gone 11: the endpoint's withdrawal of it at the hub, which is "delayed" whenever it lands after L12;
//   - L12: `k`'s private listing, which only the channel (`endpoint.listings`) carries, with its audience and policyRev;
//   - gone 13: a later withdrawal at a higher revision than anything the channel said;
//   - P5: `k2`'s listing, in the hub's snapshot and in every channel answer.
// The alphabet:
//   `hubRows`   a feed (re)opens and its snapshot's first page carries L10 and P5;
//   `hubDone`   the snapshot's completion (the last page, empty): of a gathering in progress, else of a fresh snapshot
//               that lacks both (a reconnect whose hub holds neither);
//   `gone11`    the hub's live frame withdrawing L10;
//   `chanAnswer` the machine's channel answers with L12 and P5;
//   `chanOmit`  the channel answers with P5 alone (k is no longer the member's to list);
//   `gone13`    the hub's live frame of the higher-revision withdrawal;
//   `linkDrop`  the hub feed and the machine's RL2 link drop together while a channel call is in flight (the rows are
//               asked to read again if none is), which fails `offline`; the link comes back, and the rows ask again.
// A channel event answers the call the rows have out (asking the rows to read again when none is), as `endpoint.listings`
// answers the call the rows made.
//
// The invariants, after every event:
//   (i)  a key is drawn exactly while its newest accepted revision is live and either source holds it at that revision:
//        the hub's current set (its snapshot's pages, and live frames since the feed opened, a completion dropping what
//        neither brought) or the machine's last channel answer, a failed call changing neither; and the row drawn is
//        that revision's (with L12's audience and policyRev);
//   (ii) never a blink across the public -> private move: once `k` is drawn at L12, only `chanOmit` or `gone13` takes
//        it away (a hub snapshot that lacks it, the hub's older withdrawal and a dropped link never do).
// (i) is judged against a model that states the spec's rule directly (newest revision by maximum; each source's set as
// that source last said it), not the rows' marks.
//
// The bound: every order of the seven events, each once (5,040 orders; every shorter order of distinct events is the
// prefix of one, and each prefix is checked), and every sequence of five events with repeats (16,807: reconnects,
// repeated answers and drops).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Listing, Signed } from '../../apps/org-protocol/src/index.ts';
import type { MachineRef } from '@shared/machine/ref';
import { createRemoteRows, NO_ROW_KEYS, listingKey, type RemoteRows } from '../../src/main/org/rows';
import { fakeFeed, fakeLinks, memoryFiles, World } from './rows-world';

const EVENTS = ['hubRows', 'hubDone', 'gone11', 'chanAnswer', 'chanOmit', 'gone13', 'linkDrop'] as const;
type Event = (typeof EVENTS)[number];

let w: World;
let M: MachineRef;
let L10: Signed<Listing>;
let G11: Signed<Listing>;
let L12: Signed<Listing>;
let G13: Signed<Listing>;
let P5: Signed<Listing>;
let K: string;
let K2: string;

beforeAll(async () => {
  w = await World.make();
  M = w.m1.ref as MachineRef;
  L10 = await w.list(w.m1, 'k', 10, { lane: 'B' });
  G11 = await w.gone(w.m1, 'k', 11);
  L12 = await w.list(w.m1, 'k', 12, { lane: 'B', audience: [w.A, w.B].sort(), policyRev: 3 });
  G13 = await w.gone(w.m1, 'k', 13);
  P5 = await w.list(w.m1, 'k2', 5);
  K = listingKey(L10.body);
  K2 = listingKey(P5.body);
});

/** The spec's rule, stated directly: the newest revision any source showed, and each source's set as it last said it. */
class Model {
  readonly newest = new Map<string, { revision: number; gone: boolean }>();
  readonly hub = new Map<string, number | null>();
  readonly channel = new Map<string, number | null>();
  gathering = false;
  seen = new Set<string>();
  live = new Set<string>();

  #show(key: string, revision: number, gone: boolean): void {
    const newest = this.newest.get(key);
    if (newest === undefined || revision > newest.revision) this.newest.set(key, { revision, gone });
  }

  #open(): void {
    this.gathering = true;
    this.seen = new Set();
    this.live = new Set();
  }

  apply(event: Event): void {
    switch (event) {
      case 'hubRows':
        this.#open();
        for (const [key, revision] of [[K, 10], [K2, 5]] as const) {
          this.seen.add(key);
          if (!this.live.has(key)) this.hub.set(key, revision);
          this.#show(key, revision, false);
        }
        return;
      case 'hubDone':
        if (!this.gathering) this.#open();
        for (const key of [K, K2]) if (!this.seen.has(key) && !this.live.has(key)) this.hub.set(key, null);
        this.gathering = false;
        return;
      case 'gone11':
      case 'gone13':
        this.live.add(K);
        this.hub.set(K, null);
        this.#show(K, event === 'gone11' ? 11 : 13, true);
        return;
      case 'chanAnswer':
        this.channel.set(K, 12);
        this.#show(K, 12, false);
        this.channel.set(K2, 5);
        this.#show(K2, 5, false);
        return;
      case 'chanOmit':
        this.channel.set(K, null);
        this.channel.set(K2, 5);
        this.#show(K2, 5, false);
        return;
      case 'linkDrop':
        this.gathering = false;
        return;
    }
  }

  /** The revision drawn for `key`, or null. */
  drawn(key: string): number | null {
    const newest = this.newest.get(key);
    if (newest === undefined || newest.gone) return null;
    return this.hub.get(key) === newest.revision || this.channel.get(key) === newest.revision ? newest.revision : null;
  }
}

/** Lets every answer reach the rows' queue, then waits for the queue. */
async function flush(rows: RemoteRows): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    await rows.settled();
  }
}

/** One order through fresh rows; the first broken invariant, or null. */
async function run(order: readonly Event[]): Promise<string | null> {
  const feed = fakeFeed();
  const links = fakeLinks('up');
  const rows = createRemoteRows({
    session: w.session,
    feed: feed.feed,
    roster: () => [M],
    onRoster: () => () => {},
    keys: NO_ROW_KEYS,
    link: (ref) => links.link(ref),
    files: memoryFiles(),
    emit: () => {},
    now: () => w.clock,
    timing: { ROWS_COALESCE_MS: 3_600_000, ROWS_CACHE_WRITE_MS: 3_600_000, ROWS_CHANNEL_MS: 3_600_000 },
    log: () => {},
  });
  const refresh = (rows as Partial<Pick<RemoteRows, 'refreshChannel'>>).refreshChannel?.bind(rows);
  const model = new Model();
  let gathering = false;
  let privateDrawn = false;
  try {
    await rows.loaded;
    await flush(rows);
    const answer = async (listings: Signed<Listing>[]) => {
      if (links.calls(M).length === 0) {
        refresh?.(M);
        await flush(rows);
      }
      links.answer(M, listings);
    };
    for (let i = 0; i < order.length; i++) {
      const event = order[i];
      switch (event) {
        case 'hubRows':
          feed.open();
          feed.page([L10, P5], false);
          gathering = true;
          break;
        case 'hubDone':
          if (!gathering) feed.open();
          feed.page([], true);
          gathering = false;
          break;
        case 'gone11':
          feed.push(G11);
          break;
        case 'gone13':
          feed.push(G13);
          break;
        case 'chanAnswer':
          await answer([L12, P5]);
          break;
        case 'chanOmit':
          await answer([P5]);
          break;
        case 'linkDrop':
          // with a channel call in flight, always: the drop is what fails it
          if (links.calls(M).length === 0) {
            refresh?.(M);
            await flush(rows);
          }
          feed.close();
          gathering = false;
          links.setState(M, 'down');
          links.fail(M);
          await flush(rows);
          links.setState(M, 'up');
          break;
      }
      model.apply(event);
      await flush(rows);
      const at = `after ${order.slice(0, i + 1).join(' ')}`;
      const drawn = new Map(rows.rows().rows.map((row) => [`${row.machine}/${row.session}`, row]));
      for (const key of [K, K2]) {
        const want = model.drawn(key);
        const got = drawn.get(key)?.revision ?? null;
        if (want !== got) return `${at}: ${key === K ? 'k' : 'k2'} drawn at ${got ?? 'nothing'}, the rule says ${want ?? 'nothing'}`;
      }
      const k = drawn.get(K);
      if (k?.revision === 12 && (k.policyRev !== 3 || JSON.stringify(k.audience) !== JSON.stringify([w.A, w.B].sort()))) return `${at}: k's private row lacks its audience or policyRev`;
      if (privateDrawn && k === undefined && event !== 'chanOmit' && event !== 'gone13') return `${at}: k blinked out after its private listing was drawn`;
      if (k?.revision === 12) privateDrawn = true;
      if (k === undefined) privateDrawn = false;
    }
    return null;
  } finally {
    await rows.close();
  }
}

function permutations(items: readonly Event[]): Event[][] {
  if (items.length === 0) return [[]];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

function sequences(length: number): Event[][] {
  if (length === 0) return [[]];
  return sequences(length - 1).flatMap((prefix) => EVENTS.map((event) => [...prefix, event]));
}

async function failures(orders: readonly Event[][]): Promise<string[]> {
  const failed: string[] = [];
  for (const order of orders) {
    const failure = await run(order);
    if (failure !== null) failed.push(failure);
  }
  return failed;
}

/** How many orders failed, and the distinct failures, shortest first (many orders share a failing prefix). */
function report(failed: readonly string[], total: number): string {
  if (failed.length === 0) return '';
  const distinct = [...new Set(failed)].sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  return `${failed.length} of ${total} orders failed, ${distinct.length} distinct; the shortest:\n${distinct.slice(0, 12).join('\n')}`;
}

afterAll(() => {
  w.session.set(null);
});

describe("the rows' two memberships, over every order", () => {
  it('hold the rule in every order of the seven events', { timeout: 300_000 }, async () => {
    const orders = permutations(EVENTS);
    expect(orders).toHaveLength(5040);
    const failed = await failures(orders);
    expect(report(failed, orders.length)).toBe('');
  });

  it('hold the rule in every sequence of five events, repeats included', { timeout: 300_000 }, async () => {
    const orders = sequences(5);
    expect(orders).toHaveLength(16_807);
    const failed = await failures(orders);
    expect(report(failed, orders.length)).toBe('');
  });
});
