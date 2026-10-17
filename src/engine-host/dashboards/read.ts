// The bounded dataset read (P3-E2 M2; ledger X23's `artifacts.readDataset` as amended by parent Decision Log 8; XE5):
// one snapshot, named by its immutable asset ref and the format the displayed or exported descriptor gives it (assets
// are deduplicated by content, so one ref may be bound as CSV in one descriptor and TSV in another), parsed by the
// host's parser and answered a page at a time. Never a lookup of the live descriptor: a label and its rows come from one
// descriptor.
//
// Every call checks that the artifact is live and holds the ref, cache hits included (a ref implies no authority). A
// page holds at most `limit` rows (DATASET_READ_MAX_ROWS) and at most DATASET_READ_MAX_BYTES of JSON; the caller
// continues at `offset + rows.length`, and a single row larger than a page is refused `tooLarge`. The parse cache is
// keyed by the bytes' sha256 and the format, bounded by entries and by the bytes its parsed tables hold (`heldBytes`:
// what a table expands to, not its source's size), least recently read leaving first; a table larger than the whole
// cache answers its read and is not kept. It is not authoritative and starts cold after a restart.
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
const CACHE_HELD_BYTES = 64 * 1024 * 1024;

// E2 M6 (panel P2 scalpel-4#2, E's Decision Logs 40 and 41): what a cache entry holds, charged from its whole shape,
// never its source's size alone (a sparse JSON file of 600 KB expands to 200,000 x 256 cells). A policy, complete and
// monotonic (every part of the entry is charged, and more rows, cells, columns, warnings or characters never charge
// less), not an exact heap measure: the entry and its key, the table's containers, a row array's headers and an 8-byte
// slot per cell, a 16-byte box per number that is not a small integer, each column's object with its name and type,
// each warning, each string at its header and two bytes per character (the larger of V8's two forms), and the source's
// length besides, the decoded text a field sliced from it may keep alive. A scratch heap probe on V8 without pointer
// compression put these charges at or above the measured heap of the tables it tried; that is a diagnostic, not a
// bound for every table. Counting stops once past `cap`: such a table is not kept.
const ENTRY_BYTES = 256; // the cache entry, its Map slot, the parsed table and its three arrays' headers
const ROW_BYTES = 80;
const SLOT_BYTES = 8;
const BOXED_NUMBER_BYTES = 16;
const STRING_BYTES = 32;
const COLUMN_BYTES = 64; // a column object; its name and type are charged as strings
const SMALL_INTEGER = 2 ** 30;

const stringBytes = (text: string) => STRING_BYTES + 2 * text.length;

function heldBytes(key: string, parsed: ParsedDataset, sourceBytes: number, cap: number): number {
  const width = parsed.columns.length;
  let held = ENTRY_BYTES + stringBytes(key) + sourceBytes;
  for (const column of parsed.columns) held += SLOT_BYTES + COLUMN_BYTES + stringBytes(column.name) + stringBytes(column.type) + (column.mismatches === undefined ? 0 : BOXED_NUMBER_BYTES);
  for (const warning of parsed.warnings) held += SLOT_BYTES + stringBytes(warning);
  held += parsed.rows.length * (SLOT_BYTES + ROW_BYTES + width * SLOT_BYTES);
  for (const row of parsed.rows) {
    if (held > cap) return held;
    for (const cell of row) {
      if (typeof cell === 'string') held += stringBytes(cell);
      else if (typeof cell === 'number' && !(Number.isInteger(cell) && Math.abs(cell) < SMALL_INTEGER)) held += BOXED_NUMBER_BYTES;
    }
  }
  return held;
}

const encoder = new TextEncoder();
const jsonBytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;

export class DatasetReader {
  private readonly cache = new Map<string, { parsed: ParsedDataset; size: number }>(); // in read order, oldest first; size: heldBytes
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(
    private readonly store: ArtifactStore,
    options: { maxEntries?: number; maxBytes?: number } = {},
  ) {
    this.maxEntries = options.maxEntries ?? CACHE_ENTRIES;
    this.maxBytes = options.maxBytes ?? CACHE_HELD_BYTES;
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
    // sized as the page serialises: rows add their own bytes and a comma, and the empty page is counted with
    // `truncated: false`, its longer spelling, so a page that turns out complete still fits (E2 M6)
    let bytes = jsonBytes({ columns: parsed.columns, rows: [], total: parsed.rows.length, truncated: false });
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

  private parsed(artifactId: string, sha256: string, sourceBytes: number, format: DatasetFormat): ParsedDataset {
    const key = `${sha256}:${format}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit.parsed;
    }
    const parsed = parseDataset(this.store.files.readAsset(artifactId, sha256), format);
    if (parsed instanceof DatasetError) throw new ArtifactStoreError(parsed.kind, `the snapshot does not read as ${format}: ${parsed.reason}`, parsed.line === undefined ? {} : { line: parsed.line });
    const size = heldBytes(key, parsed, sourceBytes, this.maxBytes);
    if (size > this.maxBytes) return parsed; // larger than the whole cache: answered, never kept
    this.cache.set(key, { parsed, size });
    let held = [...this.cache.values()].reduce((sum, entry) => sum + entry.size, 0);
    for (const [old, entry] of this.cache) {
      if (this.cache.size <= this.maxEntries && held <= this.maxBytes) break;
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
