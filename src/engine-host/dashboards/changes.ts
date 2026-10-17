// The derived per-dataset change index (P3-E2 M2; the execution document's concurrency rule, parent Decision Log 6):
// for each dashboard, the revision at which each descriptor last changed, kept in the store's existing metadata
// (`meta`, no schema change) and written by the dashboard adapter's hooks in the frame of the write that changed it, so
// it commits with that write or not at all. A descriptor's identity is the Yjs item that holds its current value: every
// write of a descriptor (a bind, a replacement, a removal, a restore's revert, a value equal to an earlier one) makes a
// new item, so writing an equal descriptor back still advances the revision (no ABA), and a removal is a tombstone.
//
// Derived, never an authority (XE2): the Y.Doc and its assets are the data; a dashboard whose index is missing starts
// one at the live revision, every descriptor (present or not) dated there, so a base older than that reads again.
import { DATASETS_ROOT } from '@artifacts/dashboard/datasets';
import type { Doc } from '@artifacts/yjs';

export const changeIndexKey = (artifactId: string): string => `dashboard.datasets:${artifactId}`;

// `since`: the revision the index started at, the date of every id it has no entry for. `entries`: [id, the item of
// its value ("client:clock", null once removed), the revision of that change].
interface Stored {
  v: 1;
  since: number;
  entries: [string, string | null, number][];
}

interface MetaStore {
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
}

/** The item holding each dataset's current value, by id ("client:clock"). */
function writesOf(doc: Doc): Map<string, string> {
  const writes = new Map<string, string>();
  for (const [id, item] of doc.get(DATASETS_ROOT)._map) if (!item.deleted) writes.set(id, `${item.id.client}:${item.id.clock}`);
  return writes;
}

function read(meta: MetaStore, artifactId: string): Stored | null {
  const raw = meta.getMeta(changeIndexKey(artifactId));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Stored;
    return parsed.v === 1 && Number.isInteger(parsed.since) && Array.isArray(parsed.entries) ? parsed : null;
  } catch {
    return null; // unreadable: as missing, started again at the live revision
  }
}

export class DatasetChanges {
  constructor(
    private readonly meta: MetaStore,
    private readonly revision: (artifactId: string) => number,
  ) {}

  /** Inside the frame of a write to `artifactId`: date each descriptor `doc` now holds differently at the revision. */
  note(artifactId: string, doc: Doc): void {
    const seq = this.revision(artifactId);
    const writes = writesOf(doc);
    const stored = read(this.meta, artifactId);
    if (!stored) {
      this.meta.setMeta(changeIndexKey(artifactId), JSON.stringify({ v: 1, since: seq, entries: [...writes].map(([id, write]) => [id, write, seq]) } satisfies Stored));
      return;
    }
    const entries = new Map(stored.entries.map(([id, write, at]) => [id, { write, at }]));
    let changed = false;
    for (const [id, write] of writes) {
      if (entries.get(id)?.write === write) continue;
      entries.set(id, { write, at: seq });
      changed = true;
    }
    for (const [id, entry] of entries) {
      if (writes.has(id) || entry.write === null) continue;
      entries.set(id, { write: null, at: seq });
      changed = true;
    }
    if (changed) this.meta.setMeta(changeIndexKey(artifactId), JSON.stringify({ v: 1, since: stored.since, entries: [...entries].map(([id, { write, at }]) => [id, write, at]) } satisfies Stored));
  }

  /** The revision `datasetId`'s descriptor of `artifactId` last changed at: when unknown, the index's start, else live. */
  lastChange(artifactId: string, datasetId: string): number {
    const stored = read(this.meta, artifactId);
    if (!stored) return this.revision(artifactId);
    return stored.entries.find(([id]) => id === datasetId)?.[2] ?? stored.since;
  }
}
