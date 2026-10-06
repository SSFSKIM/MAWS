// The deliverable store (P1 X12; E1 execution document, residue 7; E2 execution document, Design §2): the engine host
// writes one JSON record per deliverable at `<userData>/deliverables/<appSessionId>/<id>.json`, through a temp file and
// a rename so a crash leaves the record whole or absent. A delivered file is referenced in place (A-3); an artifact's
// versions are copied beside its record as `<id>/v<n>.html` (E2). The layout and the parsing are shared with main's
// reader (`@shared/maws/deliverable-files`). Every settled write announces itself through `onWritten` (the session
// relays it as `deliverables.changed`), so no tool has to remember to. The writer stays in the host and assumes nothing
// about main or a window (X13).
import { open, readFile } from 'node:fs/promises';
import type { AppSessionId } from '@shared/graph/ids';
import { DeliverableRecordSchema, type DeliverableRecord } from '@shared/maws/deliverable';
import { deliverablesDir, readRecords, recordPath, versionPath, writeAtomic, writeRecord } from '@shared/maws/deliverable-files';
import { ARTIFACT_MAX_BYTES } from '@shared/maws/tools';

export type DeliverableChange = 'created' | 'updated';
// Called after every settled `write` (`created`) and `update` (`updated`), never for one that failed; must not throw.
export type OnDeliverableWritten = (record: DeliverableRecord, change: DeliverableChange) => void;

// An artifact version's copy: where it landed and the bytes copied (the tool counts the page's external URLs in them).
export interface VersionCopy {
  path: string;
  content: Buffer;
}

export interface DeliverableWriter {
  write(record: DeliverableRecord): Promise<void>; // a new record
  update(record: DeliverableRecord): Promise<void>; // a rewrite of an existing record, whole
  get(appSessionId: AppSessionId, id: string): Promise<DeliverableRecord | null>;
  list(appSessionId: AppSessionId): Promise<DeliverableRecord[]>; // oldest first
  findArtifact(appSessionId: AppSessionId, artifactId: string): Promise<DeliverableRecord | null>;
  // Copies the source, read whole under ARTIFACT_MAX_BYTES, as version `n` of the record.
  copyVersion(appSessionId: AppSessionId, recordId: string, version: number, sourcePath: string): Promise<VersionCopy>;
  // Runs `task` after every task queued before it for the session settled: the session's write chain, so two calls that
  // read a record, add a version and rewrite it never interleave their version numbers.
  exclusive<T>(appSessionId: AppSessionId, task: () => Promise<T>): Promise<T>;
}

const MIB = 1024 * 1024;

// The source of a version, read whole: a regular file of at most ARTIFACT_MAX_BYTES (checked on the open file, so one
// that grew since the tool's own check is still refused).
async function readSource(sourcePath: string): Promise<Buffer> {
  const handle = await open(sourcePath, 'r');
  try {
    const found = await handle.stat();
    if (!found.isFile()) throw new Error('not a regular file');
    const tooLarge = (bytes: number) => new Error(`too large (${bytes} bytes; the limit is ${ARTIFACT_MAX_BYTES / MIB} MiB)`);
    if (found.size > ARTIFACT_MAX_BYTES) throw tooLarge(found.size);
    const content = await handle.readFile();
    if (content.length > ARTIFACT_MAX_BYTES) throw tooLarge(content.length);
    return content;
  } finally {
    await handle.close();
  }
}

// One promise chain per session; a task that fails releases the chain for the next.
class SessionChains {
  private readonly tails = new Map<AppSessionId, Promise<unknown>>();

  run<T>(appSessionId: AppSessionId, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(appSessionId) ?? Promise.resolve();
    const next = previous.then(task, task);
    const tail = next.catch(() => {});
    this.tails.set(appSessionId, tail);
    void tail.then(() => {
      if (this.tails.get(appSessionId) === tail) this.tails.delete(appSessionId);
    });
    return next;
  }
}

export class FileDeliverableStore implements DeliverableWriter {
  private readonly readRecord: (path: string) => Promise<string>;
  private readonly onWritten: OnDeliverableWritten;
  private readonly chains = new SessionChains();

  // `readFile`: a test seam for a record removed between the listing and its read
  constructor(private readonly userData: string, opts: { readFile?: (path: string) => Promise<string>; onWritten?: OnDeliverableWritten } = {}) {
    this.readRecord = opts.readFile ?? ((path) => readFile(path, 'utf8'));
    this.onWritten = opts.onWritten ?? (() => {});
  }

  async write(record: DeliverableRecord): Promise<void> {
    await this.save(record);
    this.onWritten(record, 'created');
  }

  async update(record: DeliverableRecord): Promise<void> {
    await this.save(record);
    this.onWritten(record, 'updated');
  }

  async get(appSessionId: AppSessionId, id: string): Promise<DeliverableRecord | null> {
    let text: string;
    try {
      text = await this.readRecord(recordPath(this.userData, appSessionId, id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    try {
      const parsed = DeliverableRecordSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  // The session's records, oldest first (`readRecords`: a malformed or vanished file passed over, other errors rejected).
  list(appSessionId: AppSessionId): Promise<DeliverableRecord[]> {
    return readRecords(deliverablesDir(this.userData, appSessionId), this.readRecord);
  }

  async findArtifact(appSessionId: AppSessionId, artifactId: string): Promise<DeliverableRecord | null> {
    return (await this.list(appSessionId)).find((record) => record.kind === 'artifact' && record.artifactId === artifactId) ?? null;
  }

  async copyVersion(appSessionId: AppSessionId, recordId: string, version: number, sourcePath: string): Promise<VersionCopy> {
    const path = versionPath(this.userData, appSessionId, recordId, version);
    const content = await readSource(sourcePath);
    await writeAtomic(path, content);
    return { path, content };
  }

  exclusive<T>(appSessionId: AppSessionId, task: () => Promise<T>): Promise<T> {
    return this.chains.run(appSessionId, task);
  }

  private save(record: DeliverableRecord): Promise<void> {
    const checked = DeliverableRecordSchema.parse(record);
    return writeRecord(recordPath(this.userData, checked.appSessionId, checked.id), checked);
  }
}

// The store a session without a data directory keeps (tests, and a session constructed without one): the same surface,
// the version copies kept as bytes under a `memory:` path.
export class MemoryDeliverableStore implements DeliverableWriter {
  readonly records: DeliverableRecord[] = [];
  readonly copies = new Map<string, Buffer>();
  private readonly onWritten: OnDeliverableWritten;
  private readonly chains = new SessionChains();

  constructor(opts: { onWritten?: OnDeliverableWritten } = {}) {
    this.onWritten = opts.onWritten ?? (() => {});
  }

  async write(record: DeliverableRecord): Promise<void> {
    this.records.push(DeliverableRecordSchema.parse(record));
    this.onWritten(record, 'created');
  }

  async update(record: DeliverableRecord): Promise<void> {
    const checked = DeliverableRecordSchema.parse(record);
    const index = this.records.findIndex((r) => r.appSessionId === checked.appSessionId && r.id === checked.id);
    if (index === -1) this.records.push(checked);
    else this.records[index] = checked;
    this.onWritten(record, 'updated');
  }

  async get(appSessionId: AppSessionId, id: string): Promise<DeliverableRecord | null> {
    return this.records.find((r) => r.appSessionId === appSessionId && r.id === id) ?? null;
  }

  async list(appSessionId: AppSessionId): Promise<DeliverableRecord[]> {
    return this.records.filter((r) => r.appSessionId === appSessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async findArtifact(appSessionId: AppSessionId, artifactId: string): Promise<DeliverableRecord | null> {
    return (await this.list(appSessionId)).find((record) => record.kind === 'artifact' && record.artifactId === artifactId) ?? null;
  }

  async copyVersion(appSessionId: AppSessionId, recordId: string, version: number, sourcePath: string): Promise<VersionCopy> {
    const content = await readSource(sourcePath);
    const path = `memory:/${appSessionId}/${recordId}/v${version}.html`;
    this.copies.set(path, content);
    return { path, content };
  }

  exclusive<T>(appSessionId: AppSessionId, task: () => Promise<T>): Promise<T> {
    return this.chains.run(appSessionId, task);
  }
}
