// The reach to a snapshot's rows (P3-E2 M3, moved here from editor/ by M5 for main's exporters, E's Decision Log 32;
// XE5, the ledger's X23 `readDataset`; DOM-free): the whole of one immutable
// snapshot, named by its asset ref and the format the displayed descriptor reads it in, read page by page from the host
// (each page bounded in rows and bytes, so the next starts at the rows the last one answered, never at `limit`). Every
// view of a dashboard and its source sheet share one reader per tab: a snapshot is read once while cached, concurrent
// readers wait on the same read, the least recently read snapshot leaves past the bound, and a failed read is not
// kept. A ref names immutable bytes, so a cached snapshot is never stale; the host checks the artifact's ownership on
// every page. E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b): given a host that holds
// (`holdDatasets`, the window's), a snapshot is held before its first page is read and while it is cached, released at
// its eviction, its failed read and `dispose`, so a refresh retiring it never takes its bytes between two pages; the
// source sheet's `holdAll` duplicates a cached snapshot's hold synchronously and holds the rest in one group, all or none.
// Without it (main's exporter, whose capture holds what it reads), nothing is held.
import type { ArtifactHost } from '../host';
import type { DatasetFormat } from './datasets';
import type { ViewTable } from './render';

/** E3: a reader's hold over snapshots it was asked to keep (the source sheet's); `ready` settles once every part is held,
 * rejecting (with nothing left held) when any is unavailable. */
export interface SnapshotLease {
  ready: Promise<void>;
  release(): void;
}

type Hold = { release(): void };

interface Entry {
  ref: string;
  reading: Promise<ViewTable>;
  hold: Promise<Hold> | null;
  cached: boolean;
  pins: number; // the leases duplicating its hold
  dropped: boolean;
}

export interface SnapshotRef {
  ref: string;
  format: DatasetFormat;
}

const CACHED = 6; // snapshots kept per tab (12 views over one dataset read it once)

export class SnapshotReader {
  private readonly cache = new Map<string, Entry>();
  private readonly leases = new Set<() => void>(); // E3: the holdAll leases not yet released

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
    const hold = this.host.holdDatasets ? this.host.holdDatasets(this.artifactId, [snapshot.ref]) : null; // E3
    hold?.catch(() => {}); // its failure is the read's
    const entry: Entry = { ref: snapshot.ref, hold, cached: true, pins: 0, dropped: false, reading: null as unknown as Promise<ViewTable> };
    entry.reading = (async () => {
      if (hold) await hold;
      return this.readAll(snapshot);
    })();
    this.cache.set(key, entry);
    entry.reading.catch(() => {
      if (this.cache.get(key) === entry) this.cache.delete(key);
      entry.cached = false;
      this.drop(entry);
    });
    while (this.cache.size > this.bound) {
      const [oldest, evicted] = this.cache.entries().next().value!;
      this.cache.delete(oldest);
      evicted.cached = false;
      this.drop(evicted);
    }
    return entry.reading;
  }

  /** E3: holds `refs` for the source sheet: a cached snapshot's hold duplicated now, the others held in one group. */
  holdAll(refs: readonly string[]): SnapshotLease {
    const wanted = [...new Set(refs)];
    if (!this.host.holdDatasets || wanted.length === 0) return { ready: Promise.resolve(), release: () => {} };
    const pinned: Entry[] = [];
    const missing: string[] = [];
    for (const ref of wanted) {
      const entry = [...this.cache.values()].find((candidate) => candidate.ref === ref && candidate.hold !== null);
      if (entry) {
        entry.pins += 1;
        pinned.push(entry);
      } else missing.push(ref);
    }
    const group = missing.length > 0 ? this.host.holdDatasets(this.artifactId, missing) : null;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.leases.delete(release);
      for (const entry of pinned) {
        entry.pins -= 1;
        this.drop(entry);
      }
      group?.then((hold) => hold.release(), () => {});
    };
    this.leases.add(release);
    const ready = Promise.all([...pinned.map((entry) => entry.hold), group]).then(() => undefined);
    ready.catch(release); // all or none
    return { ready, release };
  }

  /** E3: the tab is gone: every hold the reader took goes, its leases' duplicates included. */
  dispose(): void {
    for (const release of [...this.leases]) release();
    for (const entry of this.cache.values()) {
      entry.cached = false;
      entry.pins = 0;
      this.drop(entry);
    }
    this.cache.clear();
  }

  // An entry's hold goes once nothing keeps it: out of the cache and no lease duplicating it.
  private drop(entry: Entry): void {
    if (entry.cached || entry.pins > 0 || entry.dropped) return;
    entry.dropped = true;
    entry.hold?.then((hold) => hold.release(), () => {});
  }

  private async readAll({ ref, format }: SnapshotRef): Promise<ViewTable> {
    const first = await this.host.readDataset(this.artifactId, ref, { format });
    const rows = [...first.rows];
    while (rows.length < first.total) {
      const page = await this.host.readDataset(this.artifactId, ref, { format, offset: rows.length });
      if (page.rows.length === 0) throw new Error(`the snapshot ${ref} answered no rows at ${rows.length} of ${first.total}`);
      rows.push(...page.rows);
    }
    return { columns: first.columns, rows };
  }
}
