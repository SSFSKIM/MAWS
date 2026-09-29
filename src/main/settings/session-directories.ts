// The directories of every session main knows (C11 M1 fix wave): each record's directory, additional directories and
// worktree, from the read model (both launch modes) and the index (archived included). The reveal guard's session
// roots; C7's `@` listing roots in src/main/index.ts can adopt it (tracker row).
import type { SessionRecord } from '@shared/graph/session';

export const recordDirectories = (r: SessionRecord): string[] => [r.directory, ...r.additionalDirectories, ...(r.worktree ? [r.worktree.path] : [])];

export function knownSessionDirectories(
  model: { allRecords(): SessionRecord[] },
  index: { sessions: { list(opts: { includeArchived: boolean }): SessionRecord[] } },
  warn: (message: string, error: unknown) => void = console.warn,
): string[] {
  const held = model.allRecords().flatMap(recordDirectories);
  try {
    return [...held, ...index.sessions.list({ includeArchived: true }).flatMap(recordDirectories)];
  } catch (error) {
    warn('[settings] session directories without the index', error);
    return held;
  }
}
