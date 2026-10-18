// E3 M1 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b; E's Decision Log 48 (3)): the tab's snapshot
// reader holds what it caches. A snapshot's hold is taken before its first page is read and kept while it is cached,
// released at its eviction, its failed read and the reader's disposal. The source sheet's `holdAll` duplicates a cached
// snapshot's hold synchronously (no gap a refresh's collection could fall in) and holds the rest in one group, all or
// none, until the sheet lets go.
import { describe, expect, it, vi } from 'vitest';
import type { DatasetPage } from '../host';
import { SnapshotReader } from './snapshots';

const page = (ref: string): DatasetPage => ({ columns: [{ name: 'v', type: 'string' }], rows: [[ref]], total: 1, truncated: false });

function host(options: { refuse?: string[]; failRead?: string[] } = {}) {
  const log: string[] = [];
  const held = new Map<number, string[]>();
  let next = 0;
  let gate: Promise<void> | null = null;
  const holdDatasets = vi.fn(async (_artifactId: string, refs: readonly string[]) => {
    if (gate) await gate;
    if (refs.some((ref) => options.refuse?.includes(ref))) throw new Error(`the snapshot ${refs.join(',')} is unavailable`);
    const id = ++next;
    held.set(id, [...refs]);
    log.push(`hold ${refs.join(',')}`);
    return {
      invalidated: new Promise<void>(() => {}), // no restart in these cases
      release: () => {
        if (held.delete(id)) log.push(`release ${refs.join(',')}`);
      },
    };
  });
  const readDataset = vi.fn(async (_artifactId: string, ref: string) => {
    log.push(`page ${ref}`);
    if (options.failRead?.includes(ref)) throw new Error(`no asset ${ref}`);
    return page(ref);
  });
  const heldRefs = () => [...held.values()].flat().sort();
  return { host: { holdDatasets, readDataset }, log, heldRefs, gate: (until: Promise<void> | null) => (gate = until) };
}
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const snap = (ref: string) => ({ ref, format: 'json' as const });

describe('the snapshot reader’s holds (E3)', () => {
  it('holds a snapshot before reading it and keeps the hold while cached, released at its eviction', async () => {
    const h = host();
    const reader = new SnapshotReader(h.host, 'dash1', 2);
    await reader.read(snap('assets/a.json'));
    expect(h.log).toEqual(['hold assets/a.json', 'page assets/a.json']);
    await reader.read(snap('assets/a.json')); // cached: no second hold or read
    await reader.read(snap('assets/b.json'));
    expect(h.heldRefs()).toEqual(['assets/a.json', 'assets/b.json']);
    await reader.read(snap('assets/c.json')); // a leaves the cache, and its hold with it
    await settle();
    expect(h.heldRefs()).toEqual(['assets/b.json', 'assets/c.json']);
  });

  it('a snapshot whose hold fails is never read nor cached; a failed read lets its hold go', async () => {
    const h = host({ refuse: ['assets/gone.json'], failRead: ['assets/broken.json'] });
    const reader = new SnapshotReader(h.host, 'dash1');
    await expect(reader.read(snap('assets/gone.json'))).rejects.toThrow(/unavailable/);
    expect(h.log).toEqual([]);
    await expect(reader.read(snap('assets/broken.json'))).rejects.toThrow(/no asset/);
    await settle();
    expect(h.heldRefs()).toEqual([]);
    expect(h.host.holdDatasets).toHaveBeenCalledTimes(2);
  });

  it('holdAll duplicates a cached snapshot’s hold at once and holds the others in one group; eviction meanwhile keeps both', async () => {
    const h = host();
    const reader = new SnapshotReader(h.host, 'dash1', 1);
    await reader.read(snap('assets/a.json'));
    h.log.length = 0;
    const lease = reader.holdAll(['assets/a.json', 'assets/b.json', 'assets/c.json']);
    await lease.ready;
    expect(h.log).toEqual(['hold assets/b.json,assets/c.json']); // a: the cache's own hold, duplicated
    await reader.read(snap('assets/d.json')); // evicts a, which the sheet still holds
    await settle();
    expect(h.heldRefs()).toEqual(['assets/a.json', 'assets/b.json', 'assets/c.json', 'assets/d.json']);
    lease.release();
    lease.release();
    await settle();
    expect(h.heldRefs()).toEqual(['assets/d.json']);
  });

  it('holdAll is all or none: a part refused lets go of the rest and fails ready', async () => {
    const h = host({ refuse: ['assets/gone.json'] });
    const reader = new SnapshotReader(h.host, 'dash1', 1);
    await reader.read(snap('assets/a.json'));
    const lease = reader.holdAll(['assets/a.json', 'assets/gone.json']);
    await expect(lease.ready).rejects.toThrow(/unavailable/);
    await reader.read(snap('assets/z.json')); // a's eviction now releases it: the failed lease no longer pins it
    await settle();
    expect(h.heldRefs()).toEqual(['assets/z.json']);
  });

  it('disposal lets go of every hold, the cache’s and a pending one’s', async () => {
    const h = host();
    const reader = new SnapshotReader(h.host, 'dash1');
    await reader.read(snap('assets/a.json'));
    const lease = reader.holdAll(['assets/a.json', 'assets/b.json']);
    await lease.ready;
    let open!: () => void;
    h.gate(new Promise<void>((resolve) => (open = resolve)));
    const pending = reader.read(snap('assets/c.json'));
    reader.dispose();
    open();
    await pending.catch(() => {});
    await settle();
    expect(h.heldRefs()).toEqual([]);
  });

  it('without holds (main’s exporter, which captured its own), reads as before', async () => {
    const readDataset = vi.fn(async (_id: string, ref: string) => page(ref));
    const reader = new SnapshotReader({ readDataset }, 'dash1');
    expect((await reader.read(snap('assets/a.json'))).rows).toEqual([['assets/a.json']]);
    const lease = reader.holdAll(['assets/a.json']);
    await expect(lease.ready).resolves.toBeUndefined();
    lease.release();
  });
});

// E3 M1 fix wave (task review findings 1 and 6): the cache's ownership of a snapshot and a read still paging through it are
// apart. An evicted or disposed snapshot keeps its hold until its read has completed or stopped (no page is asked after
// a disposal); a hold the host lost (`invalidated`, a host restart) takes a settled snapshot out of the cache, and an
// in-flight read re-holds the same immutable ref once and pages on, or fails as unavailable.
function pagedHost(options: { lostWhenAsked?: number[] } = {}) {
  const log: string[] = [];
  const held = new Map<number, string>();
  const invalidations = new Map<number, () => void>();
  let next = 0;
  const gates = new Map<string, () => void>(); // `${ref}@${offset}` held open until released
  const holdDatasets = vi.fn(async (_artifactId: string, refs: readonly string[]) => {
    const id = ++next;
    held.set(id, refs.join(','));
    let invalidate!: () => void;
    const invalidated = new Promise<void>((resolve) => (invalidate = resolve));
    invalidations.set(id, invalidate);
    if (options.lostWhenAsked?.includes(id)) invalidate(); // the host restarted while this hold was asked for
    log.push(`hold#${id} ${refs.join(',')}`);
    return { release: () => void (held.delete(id) && log.push(`release#${id}`)), invalidated };
  });
  const totalOf = (ref: string) => (ref === 'assets/long.json' ? 4 : 3); // rows of a snapshot, one a page
  const readDataset = vi.fn(async (_artifactId: string, ref: string, options: { offset?: number }) => {
    const offset = options.offset ?? 0;
    log.push(`page ${ref}@${offset}`);
    const key = `${ref}@${offset}`;
    if (wanted.has(key)) await new Promise<void>((resolve) => gates.set(key, resolve));
    const total = totalOf(ref);
    return { columns: [{ name: 'v', type: 'string' as const }], rows: [[`${ref}:${offset}`]], total, truncated: offset + 1 < total };
  });
  const wanted = new Set<string>();
  return {
    host: { holdDatasets, readDataset },
    log,
    heldRefs: () => [...held.values()].sort(),
    gate: (key: string) => wanted.add(key),
    open: (key: string) => {
      wanted.delete(key);
      gates.get(key)?.();
    },
    invalidate: (id: number) => invalidations.get(id)!(),
  };
}

describe('the snapshot reader’s holds and its reads in flight (E3)', () => {
  it('an evicted snapshot keeps its hold while its pages are still read, and lets it go once the read completes', async () => {
    const h = pagedHost();
    const reader = new SnapshotReader(h.host, 'dash1', 2);
    h.gate('assets/a.json@1');
    const reading = reader.read(snap('assets/a.json'));
    await vi.waitFor(() => expect(h.log).toContain('page assets/a.json@1'));
    for (const ref of ['assets/b.json', 'assets/c.json', 'assets/d.json']) await reader.read(snap(ref)); // a evicted meanwhile
    await settle();
    expect(h.heldRefs()).toContain('assets/a.json'); // its read still needs the bytes
    h.open('assets/a.json@1');
    expect((await reading).rows).toHaveLength(3);
    await settle();
    expect(h.heldRefs()).not.toContain('assets/a.json');
  });

  it('disposal during a read asks no further page, then lets the hold go', async () => {
    const h = pagedHost();
    const reader = new SnapshotReader(h.host, 'dash1');
    h.gate('assets/a.json@1');
    const reading = reader.read(snap('assets/a.json'));
    await vi.waitFor(() => expect(h.log).toContain('page assets/a.json@1'));
    reader.dispose();
    expect(h.heldRefs()).toEqual(['assets/a.json']); // the page in flight still reads the bytes
    h.open('assets/a.json@1');
    await expect(reading).rejects.toThrow(/closed/);
    await settle();
    expect(h.log.filter((line) => line.startsWith('page'))).toEqual(['page assets/a.json@0', 'page assets/a.json@1']);
    expect(h.heldRefs()).toEqual([]);
  });

  it('a settled snapshot whose hold the host lost leaves the cache: the next read holds and reads it afresh', async () => {
    const h = pagedHost();
    const reader = new SnapshotReader(h.host, 'dash1');
    await reader.read(snap('assets/a.json'));
    h.invalidate(1);
    await settle();
    expect(h.heldRefs()).toEqual([]);
    await reader.read(snap('assets/a.json'));
    expect(h.log.filter((line) => line.startsWith('hold'))).toEqual(['hold#1 assets/a.json', 'hold#2 assets/a.json']);
  });

  it('a read whose hold is lost mid-way holds the same ref again once and pages on; lost again, it fails as unavailable', async () => {
    const h = pagedHost();
    const reader = new SnapshotReader(h.host, 'dash1');
    h.gate('assets/a.json@1');
    const reading = reader.read(snap('assets/a.json'));
    await vi.waitFor(() => expect(h.log).toContain('page assets/a.json@1'));
    h.invalidate(1);
    h.open('assets/a.json@1');
    expect((await reading).rows).toEqual([['assets/a.json:0'], ['assets/a.json:1'], ['assets/a.json:2']]);
    expect(h.log).toEqual(['hold#1 assets/a.json', 'page assets/a.json@0', 'page assets/a.json@1', 'release#1', 'hold#2 assets/a.json', 'page assets/a.json@2']);
    h.gate('assets/long.json@1');
    h.gate('assets/long.json@2');
    const twice = reader.read(snap('assets/long.json'));
    await vi.waitFor(() => expect(h.log).toContain('page assets/long.json@1'));
    h.invalidate(3);
    h.open('assets/long.json@1');
    await vi.waitFor(() => expect(h.log).toContain('page assets/long.json@2')); // held again (#4), paging on
    h.invalidate(4);
    h.open('assets/long.json@2');
    await expect(twice).rejects.toThrow(/unavailable/);
    expect(h.log.filter((line) => line.startsWith('page assets/long'))).toEqual(['page assets/long.json@0', 'page assets/long.json@1', 'page assets/long.json@2']); // never a page past the second loss
    await settle();
    expect(h.heldRefs()).toEqual(['assets/a.json']);
  });

  it('a lease is invalidated when a hold it rests on is lost', async () => {
    const h = pagedHost();
    const reader = new SnapshotReader(h.host, 'dash1');
    await reader.read(snap('assets/a.json'));
    const lease = reader.holdAll(['assets/a.json', 'assets/b.json']);
    await lease.ready;
    let lost = false;
    void lease.invalidated.then(() => (lost = true));
    h.invalidate(2); // the group holding b
    await settle();
    expect(lost).toBe(true);
    lease.release();
  });
});

// E3 M1 residual correction (re-review): a disposal stops every read still in flight, those an eviction already took out
// of the cache included; a hold found lost when its acquisition settles (or just before a page) is never read through.
describe('the snapshot reader’s reads in flight, residual cases (E3)', () => {
  it('disposal stops an evicted read still in flight: no page after it, its hold let go once the page out settles', async () => {
    const h = pagedHost();
    const reader = new SnapshotReader(h.host, 'dash1', 1);
    h.gate('assets/a.json@1');
    const reading = reader.read(snap('assets/a.json'));
    await vi.waitFor(() => expect(h.log).toContain('page assets/a.json@1'));
    await reader.read(snap('assets/b.json')); // a leaves the cache, its read still paging
    reader.dispose();
    expect(h.heldRefs()).toContain('assets/a.json'); // the page out still reads its bytes
    h.open('assets/a.json@1');
    await expect(reading).rejects.toThrow(/closed/);
    await settle();
    expect(h.log.filter((line) => line.startsWith('page assets/a'))).toEqual(['page assets/a.json@0', 'page assets/a.json@1']);
    expect(h.heldRefs()).toEqual([]);
  });

  it('a hold already lost when it is answered is never read through: the reader holds once more, then reads', async () => {
    const h = pagedHost({ lostWhenAsked: [1] });
    const reader = new SnapshotReader(h.host, 'dash1');
    const table = await reader.read(snap('assets/a.json'));
    expect(table.rows).toHaveLength(3);
    expect(h.log.slice(0, 4)).toEqual(['hold#1 assets/a.json', 'release#1', 'hold#2 assets/a.json', 'page assets/a.json@0']);
  });

  it('lost at its acquisition twice, a snapshot is unavailable and no page is read', async () => {
    const h = pagedHost({ lostWhenAsked: [1, 2] });
    const reader = new SnapshotReader(h.host, 'dash1');
    await expect(reader.read(snap('assets/a.json'))).rejects.toThrow(/unavailable/);
    expect(h.log.filter((line) => line.startsWith('page'))).toEqual([]);
    await settle();
    expect(h.heldRefs()).toEqual([]);
  });
});
