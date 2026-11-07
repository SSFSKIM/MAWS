// The channel's cut as a member reads it (P5 O8 M7b fix wave), against a journal and a spine stood in for: the
// placements a reader saw of each lane B session (only ever narrowing within a read, a removed record placing nobody),
// the scan that keeps only what the member views and stops on a byte bound, and the page published only while all it
// read still stands, its `more` exact.
import { describe, expect, it } from 'vitest';
import type { HostEntry } from '@shared/ipc/schema/channel';
import type { SessionRanks } from '../../src/endpoint/authorize';
import { CHANNEL_PAGE_BYTES, HEARD_MAX, PlacementBook, publish, publishFiltered, readViewable, SCAN_ENTRIES, viewable, type EntrySession } from '../../src/endpoint/channel-view';
import type { EndpointServices } from '../../src/endpoint/services';
import type { Placement } from '../../src/endpoint/targets';

type Dispatch = EndpointServices['dispatch'];
const PROJECT = 'proj-1';

/** A lane B entry of `app` (journal id `id`), its text `bytes` long. */
const laneB = (id: number, app: string, bytes = 8): HostEntry => ({
  id: String(id),
  project: PROJECT,
  appSessionId: app as never,
  engineSessionId: null,
  lane: 'B',
  kind: 'message',
  text: 'x'.repeat(bytes),
  at: new Date(Date.UTC(2026, 10, 6) + id * 1000).toISOString(),
  src: `${PROJECT}/lane-b/${app}/${id}`,
});
const laneA = (id: number, session: string): HostEntry => ({ ...laneB(id, 'x'), appSessionId: null, engineSessionId: session as never, lane: 'A', src: `${PROJECT}/${session}/${id}` });

/** A journal (newest first, 200 an answer and 1 MiB of them, as the spine's) and the spine's records (app → engine). */
function spine(entries: HostEntry[], records: Record<string, string | null> = {}) {
  const calls: Array<{ name: string; input: unknown }> = [];
  const held: Array<() => void> = [];
  let holding = false;
  let served = 0;
  const newest = [...entries].sort((a, b) => Number(b.id) - Number(a.id));
  const dispatch: Dispatch = async (_owner, name, input) => {
    calls.push({ name, input });
    if (holding && name === 'session.get') await new Promise<void>((go) => held.push(go));
    if (name === 'session.get') {
      const app = (input as { appSessionId: string }).appSessionId;
      const engine = records[app];
      return { ok: true, value: engine == null ? null : { appSessionId: app, engineSessionId: engine } } as never;
    }
    const { before, limit } = input as { before?: string; limit: number };
    const from = before === undefined ? 0 : newest.findIndex((e) => e.id === before) + 1;
    const page: HostEntry[] = [];
    let bytes = 0;
    for (const entry of newest.slice(from, from + limit)) {
      bytes += Buffer.byteLength(JSON.stringify(entry));
      if (page.length > 0 && bytes > CHANNEL_PAGE_BYTES) break;
      page.push(entry);
    }
    served += Buffer.byteLength(JSON.stringify(page));
    return { ok: true, value: { entries: page, more: from + page.length < newest.length } } as never;
  };
  return {
    dispatch,
    calls,
    served: () => served,
    records,
    reads: (name: string) => calls.filter((c) => c.name === name).length,
    hold: () => void (holding = true),
    release: () => {
      holding = false;
      for (const go of held.splice(0)) go();
    },
  };
}

/** A member's ranks: the engine sessions (lane B) and lane A sessions they view. */
function ranks(views: Set<string>): SessionRanks {
  return {
    holds: (placement) => placement !== null && views.has(placement.target.session),
    ownsMachine: () => false,
    holdsRight: () => false,
    current: () => true,
  };
}
const placed = (app: string, engine: string): Placement => ({ target: { lane: 'B', session: engine, appSessionId: app } });

describe('the placements a reader saw', () => {
  it('holds every placement seen since a read began, narrowing only, a removed record placing nobody', async () => {
    const s = spine([], { 'app-1': 'eng-1' });
    const book = new PlacementBook();
    const after = book.mark();
    expect(book.seen('app-1', after)).toBeUndefined();
    await book.ensure('app-1', after, s.dispatch);
    expect(book.seen('app-1', after)).toEqual([placed('app-1', 'eng-1')]);
    book.heard('app-1', placed('app-1', 'eng-2'));
    book.heard('app-1', null); // its record removed
    expect(book.seen('app-1', after)).toEqual([placed('app-1', 'eng-1'), placed('app-1', 'eng-2'), null]);
    const member = ranks(new Set(['eng-1', 'eng-2']));
    expect(viewable(laneB(1, 'app-1'), member, book, after)).toBe(false);

    // A read begun later is what a later reader goes by: the record as it stands then.
    const later = book.mark();
    expect(book.seen('app-1', later)).toBeUndefined();
    expect(viewable(laneB(1, 'app-1'), member, book, later)).toBe(false);
    await book.ensure('app-1', later, s.dispatch);
    expect(viewable(laneB(1, 'app-1'), member, book, later)).toBe(true);
    expect(s.reads('session.get')).toBe(2);
  });

  it('holds a reader to a placement heard after its mark and before its first read of the session', async () => {
    const s = spine([], { 'app-1': 'eng-1' });
    const book = new PlacementBook();
    const after = book.mark();
    book.heard('app-1', null); // the record placed no engine session for a moment
    book.heard('app-1', placed('app-1', 'eng-1'));
    await book.ensure('app-1', after, s.dispatch);
    expect(book.seen('app-1', after)).toEqual([placed('app-1', 'eng-1'), null, placed('app-1', 'eng-1')]);
    expect(viewable(laneB(1, 'app-1'), ranks(new Set(['eng-1'])), book, after)).toBe(false);
    // heard before the mark: older than what the reader goes by
    const later = book.mark();
    await book.ensure('app-1', later, s.dispatch);
    expect(viewable(laneB(1, 'app-1'), ranks(new Set(['eng-1'])), book, later)).toBe(true);
  });

  it('keeps each placement heard once, at its latest hearing, and past HEARD_MAX of them places the session nowhere', async () => {
    const s = spine([], { 'app-1': 'eng-1' });
    const book = new PlacementBook();
    const after = book.mark();
    await book.ensure('app-1', after, s.dispatch);
    for (let i = 0; i < 10_000; i++) book.heard('app-1', placed('app-1', 'eng-1'));
    expect(book.seen('app-1', after)).toHaveLength(2);
    const later = book.mark();
    book.heard('app-1', placed('app-1', 'eng-1')); // heard again after a later mark: that reader holds it too
    await book.ensure('app-1', later, s.dispatch);
    expect(book.seen('app-1', later)).toEqual([placed('app-1', 'eng-1'), placed('app-1', 'eng-1')]);
    for (let i = 0; i <= HEARD_MAX; i++) book.heard('app-1', placed('app-1', `eng-x${i}`));
    expect(book.seen('app-1', after)!.length).toBeLessThanOrEqual(HEARD_MAX + 2);
    expect(book.seen('app-1', after)).toContain(null);
    expect(viewable(laneB(1, 'app-1'), ranks(new Set(['eng-1', ...Array.from({ length: HEARD_MAX + 1 }, (_, i) => `eng-x${i}`)])), book, after)).toBe(false);
  });

  it('reuses a read begun after the reader’s mark, and while one is out, every later reader waits on one more', async () => {
    const s = spine([], { 'app-1': 'eng-1' });
    const book = new PlacementBook();
    s.hold();
    const first = book.ensure('app-1', book.mark(), s.dispatch);
    const again = [1, 2, 3].map(() => book.ensure('app-1', book.mark(), s.dispatch));
    await Promise.resolve();
    expect(s.reads('session.get')).toBe(1);
    s.release();
    await first;
    s.release();
    await Promise.all(again);
    expect(s.reads('session.get')).toBe(2);
  });

  it('keeps only the reads what is held still needs', async () => {
    const s = spine([], { 'app-1': 'eng-1', 'app-2': 'eng-2' });
    const book = new PlacementBook();
    const old = book.mark();
    await Promise.all([book.ensure('app-1', old, s.dispatch), book.ensure('app-2', old, s.dispatch)]);
    const now = book.mark();
    await book.ensure('app-1', now, s.dispatch);
    book.prune([['app-1', now]]);
    expect(book.size).toBe(1);
    expect(book.seen('app-1', now)).toEqual([placed('app-1', 'eng-1')]);
    expect(book.seen('app-1', old)).toEqual([placed('app-1', 'eng-1')]); // the older read is gone: only the newer one is left
    expect(book.seen('app-2', old)).toBeUndefined();
    book.prune([]);
    expect(book.size).toBe(0);
  });
});

describe('a member’s read of the journal', () => {
  const read = (s: ReturnType<typeof spine>, member: SessionRanks, ask: { before?: string; limit: number }) => {
    const book = new PlacementBook();
    const after = book.mark();
    const views = (entry: EntrySession) => viewable(entry, member, book, after);
    return readViewable(s.dispatch, { project: PROJECT, ...ask }, views, (ids) => Promise.all(ids.map((id) => book.ensure(id, after, s.dispatch))).then(() => {})).then((r) => ({ ...r, views }));
  };

  it('keeps only the entries the member views, one past the page, and pages on past others’', async () => {
    const entries = [laneB(1, 'app-1'), laneA(2, 'la-2'), ...Array.from({ length: 450 }, (_, i) => laneB(10 + i, 'app-2')), laneB(500, 'app-1')];
    const s = spine(entries, { 'app-1': 'eng-1', 'app-2': 'eng-2' });
    const r = await read(s, ranks(new Set(['eng-1', 'la-2'])), { limit: 2 });
    expect(r.kept.map((e) => e.id)).toEqual(['500', '2', '1']);
    expect(r.skipped).toEqual([{ lane: 'B', appSessionId: 'app-2', engineSessionId: null }]);
    expect(s.reads('channel.history')).toBe(3);
    expect(s.reads('session.get')).toBe(2); // one read a session
  });

  it('reads on to the journal’s end past any bytes of others’ entries, holding none of them, and so finds the one viewable past them', async () => {
    const entries = [laneB(1, 'app-mine'), ...Array.from({ length: 300 }, (_, i) => laneB(i + 2, `app-${i % 7}`, 64 * 1024))]; // ~19 MiB hidden
    const s = spine(entries, { 'app-mine': 'eng-mine', ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`app-${i}`, `eng-${i}`])) });
    const r = await read(s, ranks(new Set(['eng-mine'])), { limit: 200 });
    expect(r.kept.map((e) => e.id)).toEqual(['1']);
    expect(publish(r, 200, r.views, (e) => e)).toEqual({ entries: [entries[0]], more: false });
    expect(s.served()).toBeGreaterThan(16 * 1024 * 1024);
  });

  it('answers no read past the journal’s own bound on what it holds: a journal past it is not one it can page exactly', async () => {
    expect(SCAN_ENTRIES).toBeGreaterThanOrEqual(2_000);
    const s = spine(Array.from({ length: SCAN_ENTRIES + 1 }, (_, i) => laneA(i + 1, 'la-hidden')));
    await expect(read(s, ranks(new Set()), { limit: 200 })).rejects.toThrow(/bound/);
  });

  it('keeps no more than a page’s bytes and the one past it', async () => {
    const entries = Array.from({ length: 40 }, (_, i) => laneB(i + 1, 'app-1', 100 * 1024));
    const s = spine(entries, { 'app-1': 'eng-1' });
    const r = await read(s, ranks(new Set(['eng-1'])), { limit: 200 });
    expect(r.kept.length).toBeLessThan(13);
    const page = publish(r, 200, r.views, (entry) => entry);
    expect(page?.more).toBe(true);
    expect(page!.entries.length).toBe(r.kept.length - 1);
  });
});

describe('a page published', () => {
  const kept = [laneB(3, 'app-1'), laneB(2, 'app-1'), laneB(1, 'app-1')];
  const read = { kept, skipped: [{ lane: 'B', appSessionId: 'app-2', engineSessionId: null }] };
  /** A kept entry's journal id (a passed-by session has none). */
  const idOf = (e: EntrySession) => ('id' in e ? (e as HostEntry).id : null);

  it('says `more` exactly when a viewable entry past it was read, its ids sealed', () => {
    const all = (e: { appSessionId: string | null }) => e.appSessionId !== 'app-2';
    expect(publish(read, 2, all, (e) => ({ ...e, id: `c${e.id}` }))).toEqual({ entries: [{ ...kept[0], id: 'c3' }, { ...kept[1], id: 'c2' }], more: true });
    expect(publish(read, 3, all, (e) => e)).toEqual({ entries: kept, more: false });
    expect(publish({ kept: [], skipped: [] }, 3, all, (e) => e)).toEqual({ entries: [], more: false });
  });

  it('is not published once anything read, the entry past it too, is no longer viewable, or a session it passed by is: it is read again', () => {
    expect(publish(read, 2, (e) => idOf(e) !== '1' && e.appSessionId !== 'app-2', (e) => e)).toBeNull();
    expect(publish(read, 2, (e) => idOf(e) !== '3' && e.appSessionId !== 'app-2', (e) => e)).toBeNull();
    expect(publish(read, 2, () => true, (e) => e)).toBeNull(); // app-2 is viewable now: its entries may belong on the page
  });

  it('once read again past its bound, goes as what is viewable of what it kept', () => {
    expect(publishFiltered(read, 2, (e) => idOf(e) !== '3', (e) => e)).toEqual({ entries: [kept[1], kept[2]], more: false });
    expect(publishFiltered(read, 1, (e) => idOf(e) !== '3', (e) => e)).toEqual({ entries: [kept[1]], more: true });
  });
});
