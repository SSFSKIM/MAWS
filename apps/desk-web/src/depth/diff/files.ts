// The session's one diff (DX4 `diff {base, text}`: the working tree against its base branch) as the files the depth
// column's Diff tab lists: MAWS's `splitPatch` cuts the unified diff per file, and each file's counts are its hunks'
// changed lines (MAWS's list takes them from `git diff --numstat`, which the desk does not have).
import { splitPatch, type PatchFile } from '../../../../../src/renderer/src/tools/code/review/review-model';

export type DiffFile = PatchFile & { added: number; removed: number };

export function diffFiles(text: string): DiffFile[] {
  return splitPatch(text).map((file) => {
    let added = 0;
    let removed = 0;
    for (const hunk of file.hunks) {
      for (const line of hunk.split('\n').slice(1)) {
        if (line.startsWith('+')) added += 1;
        else if (line.startsWith('-')) removed += 1;
      }
    }
    return { ...file, added, removed };
  });
}

export function diffTotals(files: readonly DiffFile[]): { files: number; added: number; removed: number } {
  return { files: files.length, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0) };
}
