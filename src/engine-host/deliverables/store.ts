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
  constructor(private readonly userData: string) {}

  async write(record: DeliverableRecord): Promise<void> {
    const checked = DeliverableRecordSchema.parse(record);
    const dir = this.dirOf(checked.appSessionId);
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${checked.id}.json`);
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(checked)}\n`);
    await rename(temp, file);
  }

  // The session's records, oldest first; a file that does not parse as a record is passed over.
  async list(appSessionId: AppSessionId): Promise<DeliverableRecord[]> {
    const dir = this.dirOf(appSessionId);
    const names = await readdir(dir).catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? [] : Promise.reject(error)));
    const records: DeliverableRecord[] = [];
    for (const name of names.filter((n) => n.endsWith('.json'))) {
      let json: unknown;
      try {
        json = JSON.parse(await readFile(join(dir, name), 'utf8'));
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
