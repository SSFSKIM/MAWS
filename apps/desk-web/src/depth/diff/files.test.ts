import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TWO_SUBAGENTS } from 'desk-hub/fake-machine';
import { describe, expect, it } from 'vitest';
import { diffFiles, diffTotals } from './files';

describe("the session's diff as files", () => {
  it("lists the fake machine's recorded diff per file, with each file's changed lines", () => {
    const files = diffFiles(readFileSync(join(TWO_SUBAGENTS, 'diff.patch'), 'utf8'));
    expect(files.map((f) => [f.path, f.kind, f.added, f.removed, f.hunks.length])).toEqual([
      ['.smns', 'added', 5, 0, 1],
      ['recorded.txt', 'added', 1, 0, 1],
    ]);
    expect(diffTotals(files)).toEqual({ files: 2, added: 6, removed: 0 });
  });

  it('reads a modification, a rename, a deletion, and an empty diff', () => {
    const text = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1..2 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,3 @@',
      ' one',
      '-two',
      '+TWO',
      ' three',
      'diff --git a/old.md b/new.md',
      'similarity index 100%',
      'rename from old.md',
      'rename to new.md',
      'diff --git a/gone.txt b/gone.txt',
      'deleted file mode 100644',
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
      '',
    ].join('\n');
    expect(diffFiles(text).map((f) => [f.path, f.oldPath, f.kind, f.added, f.removed])).toEqual([
      ['src/a.ts', null, 'modified', 1, 1],
      ['new.md', 'old.md', 'renamed', 0, 0],
      ['gone.txt', null, 'deleted', 0, 1],
    ]);
    expect(diffFiles('')).toEqual([]);
  });
});
