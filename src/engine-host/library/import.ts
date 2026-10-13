// The X12 import of P3-L's cutover (the P3-L document, Decision Log 4, 5, 22, 29 and 30): the deliverables the owner's
// sessions made before P3, walked from `<userData>/deliverables/<appSessionId>/<id>.json` with X12's lenient reader and
// landed as artifacts through A's `ArtifactStore.importArtifact`, one call per record, under the record's own id (so a
// transcript's delivery, a side thread's anchor and a tab keep naming it).
//
// - `artifact` becomes `html`: its `v<n>.html` copies as `import` versions in order at their own times, the latest the
//   live content, each named after the page the agent published; the agent's id as the handle. `file` and `screenshot`
//   become `file`, the file in place. The title is the record's, else its file's name; the times are the record's.
// - Every version and the creation are the record's session's, with a `created` link: X12 names no session per version
//   (a side thread's `artifact_update` of an ancestor's page is recorded in the ancestor's record), so there is no other
//   session to link `edited`. No project (the host knows no session's project), no `caption`, no `sourceUrl`.
// - A record whose id is already an artifact (A's mirror of a store write, an earlier run, a deleted one) is skipped
//   before anything is read, so a rerun after a crash lands only what is left. A handle the session already holds in
//   the store is dropped (A refuses it `handleTaken`) and the page imported without it. A record whose file is gone
//   (nothing at its path) is counted `missing`; one that cannot be read (a locked directory, not a regular file) or
//   landed, `failed` with the reason; each with a log line, none stopping the walk.
//
// Not wired to run here: the cutover (M6b) runs it once at store open.
import type { Dirent, Stats } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Actor } from '@shared/artifacts/actor';
import { StoredDeliverableRecordSchema, type DeliverableRecord } from '@shared/maws/deliverable';
import { ArtifactStoreError } from '../documents/errors';
import type { ArtifactStore, ImportInput } from '../documents/store';

export interface DeliverablesImport {
  imported: number; // landed this run
  skipped: number; // already an artifact
  missing: number; // a file the record names is gone
  failed: number; // not a record, or not landed
}

type Outcome = keyof DeliverablesImport;

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
// Gone: nothing at the path. Any other error (a locked directory, an I/O fault) is a file that may still be there.
const isAbsent = (error: unknown) => ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '');

// A record's import input, or why there is none: a file it names is gone (`missing`), or it cannot be read (`failed`).
type Prepared = { input: ImportInput } | { outcome: 'missing' | 'failed'; why: string };

export async function importDeliverables(store: Pick<ArtifactStore, 'get' | 'importArtifact'>, deliverablesDir: string, log: (line: string) => void): Promise<DeliverablesImport> {
  const counts: DeliverablesImport = { imported: 0, skipped: 0, missing: 0, failed: 0 };
  const count = (outcome: Outcome, line?: string) => {
    counts[outcome]++;
    if (line !== undefined) log(line);
  };
  for (const { path, record, why } of await readTree(deliverablesDir)) {
    if (!record) {
      count('failed', `${path} is not a deliverable record (${why}); not imported`);
      continue;
    }
    if (store.get(record.id, { includeDeleted: true })) {
      count('skipped');
      continue;
    }
    const prepared = await prepare(record);
    if ('outcome' in prepared) {
      count(prepared.outcome, `the deliverable ${record.id} (${path}) ${prepared.why}; not imported`);
      continue;
    }
    count(...(await land(store, prepared.input, path)));
  }
  return counts;
}

// Every record file under the tree, oldest record first (a record's `createdAt`, then its id); one that does not parse
// carries why. An absent tree has none; one that cannot be listed rejects (a tree not read is not an import done).
async function readTree(root: string): Promise<{ path: string; record?: DeliverableRecord; why?: string }[]> {
  const sessions = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? ([] as Dirent[]) : Promise.reject(error)));
  const found: { path: string; record?: DeliverableRecord; why?: string }[] = [];
  for (const dir of sessions.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const entries = await readdir(join(root, dir.name), { withFileTypes: true });
    for (const entry of entries.filter((e) => e.isFile() && e.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(root, dir.name, entry.name);
      try {
        const parsed = StoredDeliverableRecordSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
        found.push(parsed.success ? { path, record: parsed.data } : { path, why: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') });
      } catch (error) {
        found.push({ path, why: reasonOf(error) });
      }
    }
  }
  const order = (item: (typeof found)[number]) => item.record?.createdAt ?? '';
  return found.sort((a, b) => order(a).localeCompare(order(b)) || a.path.localeCompare(b.path));
}

async function prepare(record: DeliverableRecord): Promise<Prepared> {
  const versions = record.versions.length > 0 ? record.versions : [{ path: record.path, at: record.updatedAt ?? record.createdAt }];
  const createdAt = Date.parse(record.createdAt);
  const ats = versions.map((version) => Date.parse(version.at));
  const updatedAt = record.updatedAt !== undefined ? Date.parse(record.updatedAt) : ats.at(-1)!;
  if (![createdAt, updatedAt, ...ats].every((time) => Number.isSafeInteger(time) && time >= 0)) return { outcome: 'failed', why: 'has a time that is not a date' };
  const actor: Actor = { kind: 'session', appSessionId: record.appSessionId };
  const common = {
    id: record.id,
    title: record.title ?? basename(record.path),
    createdAt,
    updatedAt,
    createdBy: actor,
    links: [{ appSessionId: record.appSessionId, role: 'created' as const, lastAt: createdAt }],
  };
  if (record.kind !== 'artifact') {
    // A delivered file stays where it is: its latest path, one version at the last version's time.
    let found: Stats;
    try {
      found = await stat(record.path);
    } catch (error) {
      if (isAbsent(error)) return { outcome: 'missing', why: `names a file that is gone (${record.path})` };
      return { outcome: 'failed', why: `could not reach ${record.path}: ${reasonOf(error)}` };
    }
    if (!found.isFile()) return { outcome: 'failed', why: `names ${record.path}, which is not a regular file` };
    return { input: { ...common, kind: 'file', versions: [{ at: ats.at(-1)!, actor, content: { path: record.path } }] } };
  }
  const read: ImportInput['versions'] = [];
  for (const [i, version] of versions.entries()) {
    let bytes: Uint8Array;
    try {
      bytes = await readFile(version.path);
    } catch (error) {
      if (isAbsent(error)) return { outcome: 'missing', why: `names a version copy that is gone (${version.path})` };
      return { outcome: 'failed', why: `could not read ${version.path}: ${reasonOf(error)}` };
    }
    const name = version.sourcePath !== undefined ? basename(version.sourcePath) : undefined;
    read.push({ at: ats[i]!, actor, content: name ? { bytes, name } : { bytes } });
  }
  return { input: { ...common, kind: 'html', ...(record.artifactId !== undefined ? { handle: record.artifactId } : {}), versions: read } };
}

// One `importArtifact` call, and one more without the handle when the session already holds it in the store.
async function land(store: Pick<ArtifactStore, 'importArtifact'>, input: ImportInput, path: string): Promise<[Outcome, string?]> {
  try {
    return [(await store.importArtifact(input)).imported ? 'imported' : 'skipped'];
  } catch (error) {
    if (error instanceof ArtifactStoreError && error.code === 'handleTaken' && input.handle !== undefined) {
      const { handle, ...unhandled } = input;
      const [outcome, line] = await land(store, unhandled, path);
      return [outcome, line ?? `the deliverable ${input.id} (${path}) is imported without its handle ${handle}, which its session already holds`];
    }
    return ['failed', `the deliverable ${input.id} (${path}) was not imported: ${reasonOf(error)}`];
  }
}
