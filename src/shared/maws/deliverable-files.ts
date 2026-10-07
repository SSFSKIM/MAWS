// The deliverable store's layout and parsing, shared by the engine host's writer and main's reader (E2 execution
// document, Design §2; node-only). Under `<userData>/deliverables/<appSessionId>/`: `<recordId>.json` (X12's record) and,
// for an artifact, `<recordId>/v<n>.html` (MAWS's copy of version `n`). Every write goes through a temp file and a
// rename, so a crash leaves a file whole or absent; a reader lists `.json` names only, so version directories and temp
// files are passed over. E1's `FileDeliverableStore.list` body lives here as `readRecords`.
// E4c adds `screenshots/<recordId>.<png|jpg>` (a browser screenshot's picture, named by the host, written by main).
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertSafeAppSessionId } from '../engine/app-session-id';
import { HostCommandError } from '../host/runtime';
import type { AppSessionId } from '../graph/ids';
import { DeliverableRecordSchema, type DeliverableRecord } from './deliverable';

export function deliverablesDir(userData: string, appSessionId: AppSessionId): string {
  assertSafeAppSessionId(appSessionId);
  return join(userData, 'deliverables', appSessionId);
}

// A record id names a file and a directory under the session's directory, so only X12's uuid is accepted: an id that
// arrives from outside (a renderer's `deliverables.get`, a URL) can never name a path elsewhere.
function assertDeliverableId(id: string): void {
  if (!DeliverableRecordSchema.shape.id.safeParse(id).success) throw new HostCommandError({ code: 'invalid_input', message: 'invalid deliverable id' });
}

export function recordPath(userData: string, appSessionId: AppSessionId, id: string): string {
  assertDeliverableId(id);
  return join(deliverablesDir(userData, appSessionId), `${id}.json`);
}

export function versionPath(userData: string, appSessionId: AppSessionId, id: string, version: number): string {
  assertDeliverableId(id);
  return join(deliverablesDir(userData, appSessionId), id, `v${version}.html`);
}

// E4c start: a browser screenshot's file. The host names it with `png`; main writes the `jpg` sibling instead after the
// JPEG fallback, and the host accepts either (E4c execution document, Design §7).
export function screenshotsDir(userData: string, appSessionId: AppSessionId): string {
  return join(deliverablesDir(userData, appSessionId), 'screenshots');
}

export function screenshotPath(userData: string, appSessionId: AppSessionId, id: string, ext: 'png' | 'jpg'): string {
  assertDeliverableId(id);
  return join(screenshotsDir(userData, appSessionId), `${id}.${ext}`);
}
// E4c end

// The data at `path` through a temp file beside it and a rename; a temp file whose write or rename failed is removed.
// The temp name is unique per write, so two overlapping writes of one path each land whole (the last rename wins).
export async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(temp, data);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

// One record, checked against X12 before the disk is touched.
export async function writeRecord(path: string, record: DeliverableRecord): Promise<void> {
  const checked = DeliverableRecordSchema.parse(record);
  await writeAtomic(path, `${JSON.stringify(checked)}\n`);
}

// A directory's records, oldest first. A file that does not parse as a record, and one removed after the listing named
// it, are passed over; any other failure to read one (EACCES, EISDIR, …) rejects, so no record silently goes missing.
// `read`: a test seam for a record removed between the listing and its read.
export async function readRecords(dir: string, read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8')): Promise<DeliverableRecord[]> {
  const names = await readdir(dir).catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? [] : Promise.reject(error)));
  const records: DeliverableRecord[] = [];
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    const text = await read(join(dir, name)).catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? null : Promise.reject(error)));
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
