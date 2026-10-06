// Main's read-only view of the deliverable store (E2 execution document, Design §2; X12, X13). The engine host writes
// `<userData>/deliverables/<appSessionId>/<id>.json` and an artifact's version copies; main reads them here for
// `deliverables.*`, the `maws-deliverable:` scheme, the capture, and the files service's admission of delivered paths.
// No cache (Decision Log 19): every call reads the directory again, so a record this host or another MAWS process wrote
// a moment ago is found at the next read with no invalidation protocol. The layout and the parsing are the host's own
// (`@shared/maws/deliverable-files`).
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isSafeAppSessionId } from '@shared/engine/app-session-id';
import type { AppSessionId } from '@shared/graph/ids';
import { DELIVERABLES_LIST_ALL_DEFAULT } from '@shared/ipc/schema/deliverables';
import { DeliverableRecordSchema, type DeliverableRecord } from '@shared/maws/deliverable';
import { deliverablesDir, readRecords, recordPath } from '@shared/maws/deliverable-files';

export interface DeliverableLookup {
  record: DeliverableRecord | null;
  present: boolean[]; // per version, in order: whether its file is still a regular file on disk
}

// Newest first: an artifact by its last version, anything else by its creation.
const newestFirst = (a: DeliverableRecord, b: DeliverableRecord) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt);

const errno = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

export class DeliverableReader {
  constructor(private readonly userData: string) {}

  // The session's records, newest first. Refuses an app session id that is not one path component.
  async list(appSessionId: AppSessionId): Promise<DeliverableRecord[]> {
    return (await readRecords(deliverablesDir(this.userData, appSessionId))).sort(newestFirst);
  }

  // Every session's records, newest first, at most `limit`: a walk of `deliverables/*/*.json` on demand (G1).
  async listAll(limit = DELIVERABLES_LIST_ALL_DEFAULT): Promise<DeliverableRecord[]> {
    const top = join(this.userData, 'deliverables');
    const entries = await readdir(top, { withFileTypes: true }).catch((error: unknown) => (errno(error) === 'ENOENT' ? [] : Promise.reject(error)));
    const sessions = entries.filter((entry) => entry.isDirectory() && isSafeAppSessionId(entry.name));
    const records = (await Promise.all(sessions.map((entry) => readRecords(join(top, entry.name))))).flat();
    return records.sort(newestFirst).slice(0, limit);
  }

  // One record by id, null when its file is gone or does not parse. Refuses an id that is not a record uuid.
  async get(appSessionId: AppSessionId, id: string): Promise<DeliverableLookup> {
    let text: string;
    try {
      text = await readFile(recordPath(this.userData, appSessionId, id), 'utf8');
    } catch (error) {
      if (errno(error) === 'ENOENT') return { record: null, present: [] };
      throw error;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { record: null, present: [] };
    }
    const parsed = DeliverableRecordSchema.safeParse(json);
    if (!parsed.success) return { record: null, present: [] };
    const present = await Promise.all(parsed.data.versions.map((version) => stat(version.path).then((s) => s.isFile(), () => false)));
    return { record: parsed.data, present };
  }

  // Whether the session's records name `real` (a realpath) as a record's path or a version's path, each realpathed now:
  // the files service's admission of a delivered file outside the session's directories (Design §3). Exactly that file,
  // never its directory.
  async admitted(appSessionId: AppSessionId, real: string): Promise<boolean> {
    if (!isSafeAppSessionId(appSessionId)) return false;
    const records = await this.list(appSessionId);
    const named = new Set(records.flatMap((record) => [record.path, ...record.versions.map((version) => version.path)]));
    for (const path of named) {
      if ((await realpath(path).catch(() => null)) === real) return true;
    }
    return false;
  }
}
