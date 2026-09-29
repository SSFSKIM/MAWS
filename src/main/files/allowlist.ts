// The allowlist of `files.*` (C8c execution document, Terms "Allowlist"; K1): for one session, the realpaths of its
// `directory`, each of its `additionalDirectories` and its `worktree.path`, read from main's session read model. The
// realpath is the native one (`fs.promises.realpath`), which canonicalises case on APFS as the JS implementation does
// not, so a record that spells the repository in another case still names the same root. A root that does not
// resolve is dropped, never replaced by the record's string: a session with no resolvable root reads nothing.
import fs from 'node:fs';
import { sep } from 'node:path';
import type { SessionRecord } from '@shared/graph/session';

export type AllowlistRecord = Pick<SessionRecord, 'directory' | 'additionalDirectories' | 'worktree'>;

// The roots in record order (directory, additional directories, worktree), deduplicated by realpath.
export async function rootsOf(record: AllowlistRecord): Promise<string[]> {
  const declared = [record.directory, ...record.additionalDirectories, ...(record.worktree ? [record.worktree.path] : [])];
  const resolved = await Promise.all(declared.map((path) => fs.promises.realpath(path).catch(() => null)));
  return [...new Set(resolved.filter((root): root is string => root !== null))];
}

// Whether a realpath lies under a root: equal to it, or inside it at a segment boundary (`/repo2` is not under `/repo`).
export function under(root: string, real: string): boolean {
  if (real === root) return true;
  return real.startsWith(root.endsWith(sep) ? root : root + sep);
}
