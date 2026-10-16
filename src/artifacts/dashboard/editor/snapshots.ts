// The editor's reach to a snapshot's rows (P3-E2 M3; XE5, the ledger's X23 `readDataset`): the whole of one immutable
// snapshot, named by its asset ref and the format the displayed descriptor reads it in, read page by page from the host
// (each page bounded in rows and bytes, so the next starts at the rows the last one answered, never at `limit`). Every
// view of a dashboard and its source sheet share one reader per tab: a snapshot is read once while cached, concurrent
// readers wait on the same read, the least recently read snapshot leaves past the bound, and a failed read is not
// kept. A ref names immutable bytes, so a cached snapshot is never stale; the host checks the artifact's ownership on
// every page.
import type { ArtifactHost } from '../../host';
import type { DatasetFormat } from '../datasets';
import type { ViewTable } from '../render';

export interface SnapshotRef {
  ref: string;
  format: DatasetFormat;
}

const CACHED = 6; // snapshots kept per tab (12 views over one dataset read it once)

export class SnapshotReader {
  private readonly cache = new Map<string, Promise<ViewTable>>();

  constructor(
    private readonly host: Pick<ArtifactHost, 'readDataset'>,
    readonly artifactId: string,
    private readonly bound = CACHED,
  ) {}

  read(snapshot: SnapshotRef): Promise<ViewTable> {
    const key = `${snapshot.format}\u0000${snapshot.ref}`;
    const held = this.cache.get(key);
    if (held) {
      this.cache.delete(key); // most recently read last
      this.cache.set(key, held);
      return held;
    }
    const reading = this.readAll(snapshot);
    this.cache.set(key, reading);
    reading.catch(() => {
      if (this.cache.get(key) === reading) this.cache.delete(key);
    });
    while (this.cache.size > this.bound) this.cache.delete(this.cache.keys().next().value!);
    return reading;
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
