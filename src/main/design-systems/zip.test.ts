// The zip writer the `claude` export packs Claude's files with: a standard archive (deflated where that is smaller,
// stored otherwise; UTF-8 names), read back here entry by entry and, where the system has it, by the system's `unzip`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readZip } from './read-zip.test-support';
import { zipFiles } from './zip';

const text = (value: string) => new TextEncoder().encode(value);

describe('zipFiles', () => {
  const files = {
    'tokens.json': `${JSON.stringify({ name: 'Harbor', color: { tokens: Array.from({ length: 40 }, (_, i) => ({ name: `c${i}`, value: '#123456' })) } }, null, 2)}\n`,
    'README.md': '# Harbor — 항구\n',
    'fonts/face.woff2': new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3]),
  };

  it('writes every file under its path, deflating text that shrinks and storing what does not, with each crc', () => {
    const entries = readZip(zipFiles(files));
    expect(entries.map((e) => e.name)).toEqual(['tokens.json', 'README.md', 'fonts/face.woff2']);
    for (const entry of entries) {
      const source = files[entry.name as keyof typeof files];
      const bytes = typeof source === 'string' ? text(source) : source;
      expect(entry.data, entry.name).toEqual(bytes);
      expect(entry.crc, entry.name).toBe(crc32(bytes));
    }
    expect(entries.find((e) => e.name === 'tokens.json')!.method).toBe(8);
    expect(entries.find((e) => e.name === 'fonts/face.woff2')!.method).toBe(0);
  });

  it('writes an empty archive for no files', () => {
    expect(readZip(zipFiles({}))).toEqual([]);
  });

  it.skipIf(!existsSync('/usr/bin/unzip'))('is an archive the system’s unzip tests clean', () => {
    const dir = mkdtempSync(join(tmpdir(), 'maws-zip-'));
    try {
      const path = join(dir, 'export.zip');
      writeFileSync(path, zipFiles(files));
      expect(execFileSync('/usr/bin/unzip', ['-t', path], { encoding: 'utf8' })).toContain('No errors detected');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
