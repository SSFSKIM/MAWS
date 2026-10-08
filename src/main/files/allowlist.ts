// The allowlist of `files.*` (C8c execution document, Terms "Allowlist"; K1): for one session, the realpaths of its
// `directory`, each of its `additionalDirectories` and its `worktree.path`, read from main's session read model. The
// realpath is the native one (`fs.promises.realpath`), which canonicalises case on APFS as the JS implementation does
// not, so a record that spells the repository in another case still names the same root. A root that does not
// resolve is dropped, never replaced by the record's string: a session with no resolvable root reads nothing.
import fs from 'node:fs';
import { sep } from 'node:path';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { SetupIntent } from '@shared/sessions/intent';

export type AllowlistRecord = Pick<SessionRecord, 'directory' | 'additionalDirectories' | 'worktree'>;

// Whose directories `files.*` reads (E11's sitting: a New chat's Files pane answered "unknown app session" until the
// session started): a session's record once it has one; before its first send, its setup intent's location, which is
// where it will run: the chosen directory, an existing worktree, or for a worktree still to be made its repository
// until the setup makes it. A New chat with no project chosen yet has none.
export function allowlistOf(
  model: { record(appSessionId: AppSessionId): AllowlistRecord | null },
  intents: { get(appSessionId: AppSessionId): SetupIntent | null },
): (appSessionId: AppSessionId) => AllowlistRecord | null {
  return (appSessionId) => {
    const record = model.record(appSessionId);
    if (record !== null) return record;
    const intent = intents.get(appSessionId);
    const location = intent?.location ?? null;
    if (intent === null || intent === undefined || location === null) return null;
    const directory = location.kind === 'newWorktree' ? (intent.progress.worktree?.path ?? location.repoRoot) : location.path;
    return { directory, additionalDirectories: intent.additionalDirectories, worktree: null };
  };
}

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
