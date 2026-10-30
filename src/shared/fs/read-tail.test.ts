import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jsonLines, readTail } from './read-tail';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-tail-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readTail', () => {
  it('keeps a first line the tail starts exactly on, drops one it starts inside, and reads a short file whole', async () => {
    const file = join(dir, 'h.jsonl');
    writeFileSync(file, 'aaa\nbbb\nccc\n'); // 12 bytes; 'bbb' starts at byte 4
    expect(await readTail(file, 8)).toBe('bbb\nccc\n'); // starts on the boundary: 'bbb' is complete
    expect(await readTail(file, 7)).toBe('ccc\n'); // starts inside 'bbb'
    expect(await readTail(file, 12)).toBe('aaa\nbbb\nccc\n');
    expect(await readTail(file, 100)).toBe('aaa\nbbb\nccc\n');
    expect(await readTail(join(dir, 'missing'), 8)).toBeNull();
  });

  it('parses one JSON value per line, skipping torn and blank lines', () => {
    expect(jsonLines('{"a":1}\n\n{"b":\n{"c":3}\n{"d"')).toEqual([{ a: 1 }, { c: 3 }]);
  });
});
