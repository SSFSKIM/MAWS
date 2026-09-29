import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveTextFile, type SaveDialog } from './save-text';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-save-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('layout.saveTextFile writes then renames', () => {
  it('opens the save dialog at Downloads/<defaultName> and writes the text there through a temporary file', async () => {
    const target = join(dir, 'a.txt');
    const showSaveDialog = vi.fn<SaveDialog>(async () => ({ canceled: false, filePath: target }));
    const writes: string[] = [];
    const renames: [string, string][] = [];
    const result = await saveTextFile(
      { defaultName: 'a.txt', text: '❯ Reply with exactly OK\n' },
      {
        showSaveDialog,
        downloads: '/Users/new/Downloads',
        fs: {
          writeFile: async (path, text) => {
            writes.push(path);
            const { writeFile } = await import('node:fs/promises');
            await writeFile(path, text);
          },
          rename: async (from, to) => {
            renames.push([from, to]);
            const { rename } = await import('node:fs/promises');
            await rename(from, to);
          },
        },
      },
    );
    expect(showSaveDialog).toHaveBeenCalledExactlyOnceWith({ defaultPath: '/Users/new/Downloads/a.txt' });
    expect(result).toEqual({ saved: true, path: target });
    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toBe(target);
    expect(writes[0]!.startsWith(dir)).toBe(true); // beside the target, so the rename stays on one volume
    expect(renames).toEqual([[writes[0], target]]);
    expect(readFileSync(target, 'utf8')).toBe('❯ Reply with exactly OK\n');
    expect(readdirSync(dir)).toEqual(['a.txt']);
  });

  it('writes with the real file system by default and replaces an existing file whole', async () => {
    const target = join(dir, 'b.txt');
    const deps = { showSaveDialog: async () => ({ canceled: false, filePath: target }), downloads: dir };
    await saveTextFile({ defaultName: 'b.txt', text: 'first, longer text' }, deps);
    await saveTextFile({ defaultName: 'b.txt', text: 'second' }, deps);
    expect(readFileSync(target, 'utf8')).toBe('second');
    expect(readdirSync(dir)).toEqual(['b.txt']);
  });

  it('answers saved: false on cancel and writes nothing', async () => {
    const result = await saveTextFile({ defaultName: 'a.txt', text: 'x' }, { showSaveDialog: async () => ({ canceled: true, filePath: '' }), downloads: dir });
    expect(result).toEqual({ saved: false });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('refuses a defaultName with a path separator before opening any dialog', async () => {
    const showSaveDialog = vi.fn<SaveDialog>();
    for (const defaultName of ['../x.txt', 'a/b.txt', 'a\\b.txt']) {
      await expect(saveTextFile({ defaultName, text: 'x' }, { showSaveDialog, downloads: dir })).rejects.toThrow(/path separator/);
    }
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it('removes its temporary file when the write fails, and fails', async () => {
    const target = join(dir, 'c.txt');
    const deps = {
      showSaveDialog: async () => ({ canceled: false, filePath: target }),
      downloads: dir,
      fs: { writeFile: async () => Promise.reject(new Error('disk full')), rename: vi.fn() },
    };
    await expect(saveTextFile({ defaultName: 'c.txt', text: 'x' }, deps)).rejects.toThrow('disk full');
    expect(deps.fs.rename).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toEqual([]);
  });
});
