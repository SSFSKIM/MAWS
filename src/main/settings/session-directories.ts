// The directories of every session main knows (C11 M1 fix wave): each record's directory, additional directories and
// worktree, from the read model (both launch modes) and the index. Two readers: the reveal guard's session roots
// (archived included) and C7's `@` listing roots in src/main/index.ts (unarchived only, with the projects' directories).
import type { SessionRecord } from '@shared/graph/session';

export const recordDirectories = (r: SessionRecord): string[] => [r.directory, ...r.additionalDirectories, ...(r.worktree ? [r.worktree.path] : [])];

export function knownSessionDirectories(
  model: { allRecords(): SessionRecord[] },
  index: { sessions: { list(opts: { includeArchived: boolean }): SessionRecord[] } },
  opts: { includeArchived?: boolean; warn?: (message: string, error: unknown) => void } = {},
): string[] {
  const { includeArchived = true, warn = console.warn } = opts;
  const listed = (records: SessionRecord[]) => records.filter((r) => includeArchived || !r.archived).flatMap(recordDirectories);
  const held = listed(model.allRecords());
  try {
    return [...held, ...listed(index.sessions.list({ includeArchived }))];
  } catch (error) {
    warn('[settings] session directories without the index', error);
    return held;
  }
}
