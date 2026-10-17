// The reach to a snapshot's rows (P3-E2 M3, moved here from editor/ by M5 for main's exporters, E's Decision Log 32;
// XE5, the ledger's X23 `readDataset`; DOM-free): the whole of one immutable
// snapshot, named by its asset ref and the format the displayed descriptor reads it in, read page by page from the host
// (each page bounded in rows and bytes, so the next starts at the rows the last one answered, never at `limit`). Every
// view of a dashboard and its source sheet share one reader per tab: a snapshot is read once while cached, concurrent
// readers wait on the same read, the least recently read snapshot leaves past the bound, and a failed read is not
// kept. A ref names immutable bytes, so a cached snapshot is never stale; the host checks the artifact's ownership on
// every page. E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b): given a host that holds
// (`holdDatasets`, the window's), a snapshot is held before its first page is read, for as long as the cache keeps it
// and, apart from that, for as long as a read still pages through it: an eviction, a failed read or `dispose` lets the
// hold go only once no page will be asked any more (a disposal stops a read before its next page). A hold the host lost
// (`invalidated`, the engine host's restart) takes a settled snapshot out of the cache, so its next read holds afresh;
// a read in flight holds the same immutable ref again once and pages on, else fails as unavailable. The source sheet's
// `holdAll` duplicates a cached snapshot's hold synchronously and holds the rest in one group, all or none, its lease
// invalidated with any hold it rests on. Without holds (main's exporter, whose capture holds what it reads), nothing is
// held.
import type { ArtifactHost, DatasetPage } from '../host';
import type { DatasetFormat } from './datasets';
import type { ViewTable } from './render';

/** E3: a reader's hold over snapshots it was asked to keep (the source sheet's); `ready` settles once every part is held,
 * rejecting (with nothing left held) when any is unavailable; `invalidated` resolves once a hold it rests on is lost. */
export interface SnapshotLease {
  ready: Promise<void>;
  invalidated: Promise<void>;
  release(): void;
}

type Hold = { release(): void; invalidated?: Promise<void> };

interface Entry {
  ref: string;
  reading: Promise<ViewTable>;
  current: Promise<Hold> | null; // the hold the read rests on now
  acquired: Hold[]; // every hold taken for it, let go when it is dropped
  cached: boolean;
  inFlight: boolean; // a read is still paging through it
  pins: number; // the leases duplicating its hold
  lost: boolean; // its current hold was lost (a host restart)
  reheld: boolean; // its one re-hold is spent
  cancelled: boolean; // disposed: no further page
  dropped: boolean;
  onLost: Set<() => void>;
}

export interface SnapshotRef {
  ref: string;
  format: DatasetFormat;
}

const CACHED = 6; // snapshots kept per tab (12 views over one dataset read it once)

export class SnapshotReader {
  private readonly cache = new Map<string, Entry>();
  private readonly leases = new Set<() => void>(); // E3: the holdAll leases not yet released
  private readonly reads = new Set<Entry>(); // E3: every read still paging, cached or already evicted

  constructor(
    private readonly host: Pick<ArtifactHost, 'readDataset'> & Partial<Pick<ArtifactHost, 'holdDatasets'>>,
    readonly artifactId: string,
    private readonly bound = CACHED,
  ) {}

  read(snapshot: SnapshotRef): Promise<ViewTable> {
    const key = `${snapshot.format}\u0000${snapshot.ref}`;
    const held = this.cache.get(key);
    if (held) {
      this.cache.delete(key); // most recently read last
      this.cache.set(key, held);
      return held.reading;
    }
    const entry: Entry = { ref: snapshot.ref, reading: null as unknown as Promise<ViewTable>, current: null, acquired: [], cached: true, inFlight: true, pins: 0, lost: false, reheld: false, cancelled: false, dropped: false, onLost: new Set() };
    if (this.host.holdDatasets) this.acquire(entry); // E3
    this.reads.add(entry);
    entry.reading = (async () => {
      try {
        return await this.readAll(snapshot, entry);
      } finally {
        this.reads.delete(entry);
        entry.inFlight = false;
        if (entry.lost) this.uncache(key, entry); // read whole, yet its hold is gone: the next read holds afresh
        this.drop(entry);
      }
    })();
    this.cache.set(key, entry);
    entry.reading.catch(() => this.uncache(key, entry));
    while (this.cache.size > this.bound) {
      const [oldest, evicted] = this.cache.entries().next().value!;
      this.uncache(oldest, evicted);
    }
    return entry.reading;
  }

  /** E3: holds `refs` for the source sheet: a cached snapshot's hold duplicated now, the others held in one group. */
  holdAll(refs: readonly string[]): SnapshotLease {
    const wanted = [...new Set(refs)];
    if (!this.host.holdDatasets || wanted.length === 0) return { ready: Promise.resolve(), invalidated: new Promise(() => {}), release: () => {} };
    const pinned: Entry[] = [];
    const missing: string[] = [];
    for (const ref of wanted) {
      const entry = [...this.cache.values()].find((candidate) => candidate.ref === ref && candidate.current !== null && !candidate.lost);
      if (entry) {
        entry.pins += 1;
        pinned.push(entry);
      } else missing.push(ref);
    }
    const group = missing.length > 0 ? this.host.holdDatasets(this.artifactId, missing) : null;
    let lose!: () => void;
    const invalidated = new Promise<void>((resolve) => (lose = resolve));
    for (const entry of pinned) entry.onLost.add(lose);
    void group?.then((hold) => hold.invalidated?.then(lose), () => {});
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.leases.delete(release);
      for (const entry of pinned) {
        entry.onLost.delete(lose);
        entry.pins -= 1;
        this.drop(entry);
      }
      group?.then((hold) => hold.release(), () => {});
    };
    this.leases.add(release);
    const ready = Promise.all([...pinned.map((entry) => entry.current), group]).then(() => undefined);
    ready.catch(release); // all or none
    return { ready, invalidated, release };
  }

  /** E3: the tab is gone: every hold goes once no read pages through it, and no read asks another page. */
  dispose(): void {
    for (const release of [...this.leases]) release();
    for (const entry of [...this.cache.values(), ...this.reads]) {
      entry.cached = false;
      entry.cancelled = true; // a read in flight asks no further page; its hold goes once the page out settles
      this.drop(entry);
    }
    this.cache.clear();
  }

  // A hold of the entry's ref, made its current one; its loss is heard as the current hold's alone. The current hold
  // settles a turn after it is answered, so a loss already signalled with the answer (a restart while it was asked for)
  // has landed before anything reads through it.
  private acquire(entry: Entry): void {
    const current: Promise<Hold> = this.host.holdDatasets!(this.artifactId, [entry.ref]).then(async (taken) => {
      entry.acquired.push(taken);
      if (entry.dropped) taken.release();
      else
        void taken.invalidated?.then(() => {
          if (entry.current === current && !entry.dropped) this.lose(entry);
        });
      await new Promise((resolve) => setTimeout(resolve, 0));
      return taken;
    });
    entry.current = current;
    current.catch(() => {}); // its failure is the read's
  }

  private lose(entry: Entry): void {
    entry.lost = true;
    for (const listener of [...entry.onLost]) listener();
    if (!entry.inFlight) {
      for (const [key, candidate] of this.cache) if (candidate === entry) this.uncache(key, entry);
    }
  }

  private uncache(key: string, entry: Entry): void {
    if (this.cache.get(key) === entry) this.cache.delete(key);
    entry.cached = false;
    this.drop(entry);
  }

  // An entry's holds go once nothing keeps it: out of the cache, no lease duplicating it and no read paging through it.
  private drop(entry: Entry): void {
    if (entry.cached || entry.pins > 0 || entry.inFlight || entry.dropped) return;
    entry.dropped = true;
    for (const hold of entry.acquired.splice(0)) hold.release();
  }

  // One page, asked only through a hold still the entry's own: a disposal stops the read; a hold lost (before or while
  // its acquisition settled, or since the last page) is taken again once, the same immutable ref, else the snapshot is
  // unavailable. Ownership is checked in the very turn that asks for the page.
  private async page(entry: Entry, format: DatasetFormat, offset?: number): Promise<DatasetPage> {
    for (;;) {
      if (entry.cancelled) throw new Error(`the snapshot ${entry.ref} was not read: the dashboard was closed`);
      if (!entry.current) return this.host.readDataset(this.artifactId, entry.ref, { format, ...(offset !== undefined && { offset }) });
      if (entry.lost) {
        if (entry.reheld) throw new Error(`the snapshot ${entry.ref} is unavailable: the host restarted twice while it was read`);
        entry.reheld = true;
        entry.lost = false;
        for (const hold of entry.acquired.splice(0)) hold.release();
        this.acquire(entry);
      }
      await entry.current;
      if (!entry.cancelled && !entry.lost) return this.host.readDataset(this.artifactId, entry.ref, { format, ...(offset !== undefined && { offset }) });
    }
  }

  private async readAll({ ref, format }: SnapshotRef, entry: Entry): Promise<ViewTable> {
    const first = await this.page(entry, format);
    const rows = [...first.rows];
    while (rows.length < first.total) {
      const page = await this.page(entry, format, rows.length);
      if (page.rows.length === 0) throw new Error(`the snapshot ${ref} answered no rows at ${rows.length} of ${first.total}`);
      rows.push(...page.rows);
    }
    return { columns: first.columns, rows };
  }
}
