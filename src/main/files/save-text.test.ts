import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveTextFile, type SaveDialog } from './save-text';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'maws-save-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('layout.saveTextFile writes then renames', () => {
  it('opens the save dialog at Downloads/<defaultName> and saves the text without temporary leftovers', async () => {
    const target = join(dir, 'a.txt');
    const showSaveDialog = vi.fn<SaveDialog>(async () => ({ canceled: false, filePath: target }));
    const result = await saveTextFile({ defaultName: 'a.txt', text: 'Reply with exactly OK\n' }, { showSaveDialog, downloads: '/Users/new/Downloads' });
    expect(showSaveDialog).toHaveBeenCalledExactlyOnceWith({ defaultPath: '/Users/new/Downloads/a.txt' });
    expect(result).toEqual({ saved: true, path: target });
    expect(readFileSync(target, 'utf8')).toBe('Reply with exactly OK\n');
    expect(readdirSync(dir)).toEqual(['a.txt']);
  });

  it('replaces an existing file whole', async () => {
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
      await expect(saveTextFile({ defaultName, text: 'x' }, { showSaveDialog, downloads: dir })).rejects.toMatchObject({
        error: { code: 'invalid_input', message: expect.stringContaining('path separator') },
      });
    }
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it('removes its temporary file on a failed rename and leaves the destination intact', async () => {
    const target = join(dir, 'folder');
    mkdirSync(target);
    writeFileSync(join(target, 'kept.txt'), 'keep');
    await expect(saveTextFile({ defaultName: 'a.txt', text: 'x' }, { showSaveDialog: async () => ({ canceled: false, filePath: target }), downloads: dir })).rejects.toThrow();
    expect(readFileSync(join(target, 'kept.txt'), 'utf8')).toBe('keep');
    expect(readdirSync(dir)).toEqual(['folder']);
  });

  it('refuses a destination whose parent is not a directory', async () => {
    const parent = join(dir, 'not-a-directory');
    writeFileSync(parent, 'keep');
    await expect(saveTextFile({ defaultName: 'a.txt', text: 'x' }, { showSaveDialog: async () => ({ canceled: false, filePath: join(parent, 'a.txt') }), downloads: dir })).rejects.toMatchObject({ code: 'ENOTDIR' });
    expect(readFileSync(parent, 'utf8')).toBe('keep');
    expect(readdirSync(dir)).toEqual(['not-a-directory']);
  });
});
