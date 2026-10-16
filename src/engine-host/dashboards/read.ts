// The bounded dataset read (P3-E2 M2; ledger X23's `artifacts.readDataset` as amended by parent Decision Log 8; XE5):
// one snapshot, named by its immutable asset ref and the format the displayed or exported descriptor gives it (assets
// are deduplicated by content, so one ref may be bound as CSV in one descriptor and TSV in another), parsed by the
// host's parser and answered a page at a time. Never a lookup of the live descriptor: a label and its rows come from one
// descriptor.
//
// Every call checks that the artifact is live and holds the ref, cache hits included (a ref implies no authority). A
// page holds at most `limit` rows (DATASET_READ_MAX_ROWS) and at most DATASET_READ_MAX_BYTES of JSON; the caller
// continues at `offset + rows.length`, and a single row larger than a page is refused `tooLarge`. The parse cache is
// keyed by the bytes' sha256 and the format, bounded by entries and by source bytes, least recently read leaving first;
// it is not authoritative and starts cold after a restart.
import { DATASET_READ_MAX_BYTES, DATASET_READ_MAX_ROWS, type Cell, type DatasetFormat } from '@artifacts/dashboard/datasets';
import { DatasetError, parseDataset, type ParsedDataset } from '@artifacts/dashboard/parse';
import type { DatasetPage } from '@artifacts/host';
import { ArtifactStoreError } from '../documents/errors';
import type { ArtifactStore } from '../documents/store';

export interface DatasetReadOptions {
  format: DatasetFormat;
  offset?: number;
  limit?: number;
}

// Candidates with the read's bounds, until the mini measures them (the execution document's acceptance 7).
const CACHE_ENTRIES = 8;
const CACHE_SOURCE_BYTES = 64 * 1024 * 1024;

const encoder = new TextEncoder();
const jsonBytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;

export class DatasetReader {
  private readonly cache = new Map<string, { parsed: ParsedDataset; size: number }>(); // in read order, oldest first
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(
    private readonly store: ArtifactStore,
    options: { maxEntries?: number; maxBytes?: number } = {},
  ) {
    this.maxEntries = options.maxEntries ?? CACHE_ENTRIES;
    this.maxBytes = options.maxBytes ?? CACHE_SOURCE_BYTES;
  }

  /** One page of the snapshot `ref` of `artifactId` read as `format`. Synchronous over the store's state; a caller
   * revealing it wraps it in `store.readCommitted`. */
  read(artifactId: string, ref: string, { format, offset = 0, limit = DATASET_READ_MAX_ROWS }: DatasetReadOptions): DatasetPage {
    if (!this.store.get(artifactId)) throw new ArtifactStoreError('notFound', `no artifact ${artifactId}`, { artifactId });
    const asset = this.store.listAssets(artifactId).find((candidate) => candidate.ref === ref);
    if (!asset) throw new ArtifactStoreError('notFound', `no asset ${ref} in ${artifactId}`, { artifactId, ref });
    const parsed = this.parsed(artifactId, asset.sha256, asset.size, format);
    const rows: Cell[][] = [];
    const end = Math.min(parsed.rows.length, offset + Math.min(limit, DATASET_READ_MAX_ROWS));
    let bytes = jsonBytes({ columns: parsed.columns, rows: [], total: parsed.rows.length, truncated: true });
    for (let r = offset; r < end; r++) {
      const row = parsed.rows[r]!;
      const size = jsonBytes(row) + (rows.length > 0 ? 1 : 0);
      if (bytes + size > DATASET_READ_MAX_BYTES) {
        if (rows.length === 0) throw new ArtifactStoreError('tooLarge', `row ${r} of ${ref} is larger than one page of ${DATASET_READ_MAX_BYTES} bytes`, { row: r, limit: DATASET_READ_MAX_BYTES });
        break;
      }
      bytes += size;
      rows.push(row);
    }
    return { columns: parsed.columns, rows, total: parsed.rows.length, truncated: offset + rows.length < parsed.rows.length };
  }

  /** The cache's keys, oldest first (tests). */
  cached(): string[] {
    return [...this.cache.keys()];
  }

  private parsed(artifactId: string, sha256: string, size: number, format: DatasetFormat): ParsedDataset {
    const key = `${sha256}:${format}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit.parsed;
    }
    const parsed = parseDataset(this.store.files.readAsset(artifactId, sha256), format);
    if (parsed instanceof DatasetError) throw new ArtifactStoreError(parsed.kind, `the snapshot does not read as ${format}: ${parsed.reason}`, parsed.line === undefined ? {} : { line: parsed.line });
    this.cache.set(key, { parsed, size });
    let held = [...this.cache.values()].reduce((sum, entry) => sum + entry.size, 0);
    for (const [old, entry] of this.cache) {
      if (this.cache.size <= this.maxEntries && held <= this.maxBytes) break;
      if (old === key) continue;
      this.cache.delete(old);
      held -= entry.size;
    }
    return parsed;
  }
}

const readers = new WeakMap<ArtifactStore, DatasetReader>();

/** The one reader of a store (its cache shared by the IPC and main's exporters through it). */
export function datasetReaderOf(store: ArtifactStore): DatasetReader {
  let reader = readers.get(store);
  if (!reader) readers.set(store, (reader = new DatasetReader(store)));
  return reader;
}
