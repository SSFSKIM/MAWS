import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { atomicWriteFile, atomicWriteFileSync } from './atomic-write';

const disk = vi.hoisted(() => ({ syncFails: false }));
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs, fsyncSync: (fd: number) => {
    if (disk.syncFails) throw new Error('sync failed');
    fs.fsyncSync(fd);
  } };
});
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  const open: typeof fs.open = async (...args) => {
    const handle = await fs.open(...args);
    const sync = handle.sync.bind(handle);
    handle.sync = async () => {
      if (disk.syncFails) throw new Error('sync failed');
      await sync();
    };
    return handle;
  };
  return { ...fs, open };
});
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'maws-atomic-sync-')); });
afterEach(() => { disk.syncFails = false; rmSync(dir, { recursive: true, force: true }); });

it.each(['async', 'sync'])('%s refuses replacement if flushing the descriptor fails, cleans up, and can retry', async (mode) => {
  const file = join(dir, 'saved.txt');
  writeFileSync(file, 'original');
  const write = () => mode === 'async' ? atomicWriteFile(file, 'replacement') : atomicWriteFileSync(file, 'replacement');
  disk.syncFails = true;
  await expect(Promise.resolve().then(write)).rejects.toThrow('sync failed');
  expect(readFileSync(file, 'utf8')).toBe('original');
  expect(readdirSync(dir)).toEqual(['saved.txt']);
  disk.syncFails = false;
  await write();
  expect(readFileSync(file, 'utf8')).toBe('replacement');
  expect(readdirSync(dir)).toEqual(['saved.txt']);
});

it.each(['async', 'sync'])('%s creates and replaces files with 229–255-byte basenames without leaving temporary files', async (mode) => {
  for (let length = 229; length <= 255; length += 1) {
    const file = join(dir, 'a'.repeat(length));
    const write = (text: string) => mode === 'async' ? atomicWriteFile(file, text) : atomicWriteFileSync(file, text);
    await write('first');
    expect(readFileSync(file, 'utf8')).toBe('first');
    await write('replacement');
    expect(readFileSync(file, 'utf8')).toBe('replacement');
  }
  expect(readdirSync(dir)).toHaveLength(27);
});
