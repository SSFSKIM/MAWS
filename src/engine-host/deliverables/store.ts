// The deliverable store (P1 X12; E1 execution document, residue 7): the engine host writes one JSON record per file a
// session delivers through `send_file`, at `<userData>/deliverables/<appSessionId>/<id>.json`, through a temp file and
// a rename so a crash leaves the record whole or absent. The delivered file itself is referenced in place (A-3). E2
// owns the record and its viewer, and may move the store into the index (ledger §4, version 5), migrating these files.
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertSafeAppSessionId } from '@shared/engine/app-session-id';
import type { AppSessionId } from '@shared/graph/ids';
import { DeliverableRecordSchema, type DeliverableRecord } from '@shared/maws/deliverable';

export interface DeliverableWriter {
  write(record: DeliverableRecord): Promise<void>;
}

export class FileDeliverableStore implements DeliverableWriter {
  private readonly readRecord: (path: string) => Promise<string>;

  // `readFile`: a test seam for a record removed between the listing and its read
  constructor(private readonly userData: string, opts: { readFile?: (path: string) => Promise<string> } = {}) {
    this.readRecord = opts.readFile ?? ((path) => readFile(path, 'utf8'));
  }

  async write(record: DeliverableRecord): Promise<void> {
    const checked = DeliverableRecordSchema.parse(record);
    const dir = this.dirOf(checked.appSessionId);
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${checked.id}.json`);
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(checked)}\n`);
    await rename(temp, file);
  }

  // The session's records, oldest first. A file that does not parse as a record, and one removed after the listing named
  // it, are passed over; any other failure to read one (EACCES, EISDIR, …) rejects, so no record silently goes missing.
  async list(appSessionId: AppSessionId): Promise<DeliverableRecord[]> {
    const dir = this.dirOf(appSessionId);
    const names = await readdir(dir).catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? [] : Promise.reject(error)));
    const records: DeliverableRecord[] = [];
    for (const name of names.filter((n) => n.endsWith('.json'))) {
      const text = await this.readRecord(join(dir, name)).catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? null : Promise.reject(error)));
      if (text === null) continue;
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        continue;
      }
      const parsed = DeliverableRecordSchema.safeParse(json);
      if (parsed.success) records.push(parsed.data);
    }
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private dirOf(appSessionId: AppSessionId): string {
    assertSafeAppSessionId(appSessionId);
    return join(this.userData, 'deliverables', appSessionId);
  }
}

// The store a session without a data directory keeps (tests, and a session constructed without one).
export class MemoryDeliverableStore implements DeliverableWriter {
  readonly records: DeliverableRecord[] = [];

  async write(record: DeliverableRecord): Promise<void> {
    this.records.push(DeliverableRecordSchema.parse(record));
  }
}
