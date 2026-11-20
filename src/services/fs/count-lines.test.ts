// The count of a new file's lines through an opened descriptor (UX wave U5b-2, Interfaces §C, decision 15): the
// lines as git counts an added file, binary by a NUL, the cap on the bytes actually read, a link counted by its own
// one line and never followed, and the races between the listing and the open that the boundary closes.
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countAddedLines } from './count-lines';

const CAP = 1024 * 1024;
let base: string;
let root: string;
let outside: string;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'maws-count-lines-')));
  root = join(base, 'repo');
  outside = join(base, 'outside');
  mkdirSync(join(root, 'sub'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n'); // seven lines, never to be counted
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';

describe('the count of a new file', () => {
  it('counts a new file of twelve lines 12, a last line without its newline, and an empty file 0', async () => {
    writeFileSync(join(root, 'twelve.txt'), lines(12));
    writeFileSync(join(root, 'open-ended.txt'), 'a\nb\nc');
    writeFileSync(join(root, 'empty.txt'), '');
    expect(await countAddedLines(root, 'twelve.txt', CAP)).toMatchObject({ insertions: 12, binary: false });
    expect(await countAddedLines(root, 'open-ended.txt', CAP)).toMatchObject({ insertions: 3, binary: false });
    expect(await countAddedLines(root, 'empty.txt', CAP)).toEqual({ insertions: 0, binary: false, bytesRead: 0 });
  });

  it('reads a NUL among the first 8,000 bytes as binary with no count, and one after them as text', async () => {
    writeFileSync(join(root, 'image.bin'), Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0, 1, 2]), Buffer.from('\n')]));
    writeFileSync(join(root, 'late.txt'), Buffer.concat([Buffer.from('x'.repeat(8000) + '\n'), Buffer.from([0]), Buffer.from('\n')]));
    expect(await countAddedLines(root, 'image.bin', CAP)).toMatchObject({ insertions: null, binary: true });
    expect(await countAddedLines(root, 'late.txt', CAP)).toMatchObject({ insertions: 2, binary: false });
  });

  it('counts a file of exactly the cap, and gives a file past it no count after reading the cap and one byte', async () => {
    writeFileSync(join(root, 'at-cap.txt'), 'a'.repeat(CAP - 1) + '\n');
    writeFileSync(join(root, 'past-cap.txt'), 'b\n'.repeat(CAP)); // twice the cap
    expect(await countAddedLines(root, 'at-cap.txt', CAP)).toEqual({ insertions: 1, binary: false, bytesRead: CAP });
    expect(await countAddedLines(root, 'past-cap.txt', CAP)).toEqual({ insertions: null, binary: false, bytesRead: CAP + 1 });
  });

  it('gives a file that grows past the cap during the read no count, and reads no more than the cap and one byte', async () => {
    writeFileSync(join(root, 'growing.log'), lines(3)); // small when it is opened
    const counted = await countAddedLines(root, 'growing.log', CAP, { afterOpen: (path) => appendFileSync(path, 'c'.repeat(3 * CAP)) });
    expect(counted).toEqual({ insertions: null, binary: false, bytesRead: CAP + 1 });
  });

  it('counts a symbolic link to a file outside the repository 1, its diff being the target\'s path, and never opens the target', async () => {
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
    expect(await countAddedLines(root, 'link.txt', CAP)).toEqual({ insertions: 1, binary: false, bytesRead: 0 });
  });

  // §C's step 3 decides this case: the open is refused for a link, and an lstat then says the last component is one,
  // so it counts as the link it now is (the one line its diff would show); nothing outside is read.
  it('reads nothing outside when the file is replaced by a link between the listing and the open', async () => {
    writeFileSync(join(root, 'swapped.txt'), lines(12));
    const counted = await countAddedLines(root, 'swapped.txt', CAP, {
      beforeOpen: (path) => {
        rmSync(path);
        symlinkSync(join(outside, 'secret.txt'), path);
      },
    });
    expect(counted).toEqual({ insertions: 1, binary: false, bytesRead: 0 });
  });

  it('gives no count and reads nothing outside when an ancestor directory is replaced by a link between the listing and the open', async () => {
    writeFileSync(join(root, 'sub', 'secret.txt'), lines(12));
    const counted = await countAddedLines(root, join('sub', 'secret.txt'), CAP, {
      beforeOpen: () => {
        renameSync(join(root, 'sub'), join(base, 'moved-away'));
        symlinkSync(outside, join(root, 'sub'));
      },
    });
    expect(counted).toEqual({ insertions: null, binary: false, bytesRead: 0 });
  });

  it('gives a directory and a missing file no count', async () => {
    mkdirSync(join(root, 'dir'));
    expect(await countAddedLines(root, 'dir', CAP)).toEqual({ insertions: null, binary: false, bytesRead: 0 });
    expect(await countAddedLines(root, 'gone.txt', CAP)).toEqual({ insertions: null, binary: false, bytesRead: 0 });
  });
});
