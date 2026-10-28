// The directories of every session main knows (C11 M1 fix wave): each record's directory, additional directories and
// worktree, from the spine's view (P5 O3-C reader R11: the records the renderer is told, in both launch modes). Two
// readers: the reveal guard's session roots (archived included) and `git.lsFiles`'s listing roots (unarchived only, with
// the intents' and the projects' directories; src/services/git/ls-files.ts).
import type { SessionRecord } from '@shared/graph/session';

export const recordDirectories = (r: SessionRecord): string[] => [r.directory, ...r.additionalDirectories, ...(r.worktree ? [r.worktree.path] : [])];

export function knownSessionDirectories(view: { records(): readonly SessionRecord[] }, opts: { includeArchived?: boolean } = {}): string[] {
  const { includeArchived = true } = opts;
  return view.records().filter((r) => includeArchived || !r.archived).flatMap(recordDirectories);
}
