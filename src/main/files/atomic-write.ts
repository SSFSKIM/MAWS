// Whole-file replacement in a directory the caller chose (and, for stores, created). Never open an existing
// temporary path: even a guessed random name or a leftover symlink must fail without touching it.
import { randomUUID } from 'node:crypto';
import { closeSync, constants, fsyncSync, openSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { open, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
const temporaryFor = (file: string) => join(dirname(file), `.${randomUUID()}.tmp`);
function requireDirectory(directory: string, isDirectory: boolean): void {
  if (!isDirectory) throw Object.assign(new Error(`not a directory: ${directory}`), { code: 'ENOTDIR' });
}

export async function atomicWriteFile(file: string, text: string): Promise<void> {
  const parent = dirname(file);
  requireDirectory(parent, (await stat(parent)).isDirectory());
  const temporary = temporaryFor(file);
  const handle = await open(temporary, FLAGS, 0o600);
  try {
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export function atomicWriteFileSync(file: string, text: string): void {
  const parent = dirname(file);
  requireDirectory(parent, statSync(parent).isDirectory());
  const temporary = temporaryFor(file);
  const fd = openSync(temporary, FLAGS, 0o600);
  try {
    try {
      writeFileSync(fd, text, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, file);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* preserve the write error */ }
    throw error;
  }
}
