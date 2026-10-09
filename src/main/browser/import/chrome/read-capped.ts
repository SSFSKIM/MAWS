// One of the import's enumerated read-only file reads (E4b Design §9; cua board #90): a file in a Chrome profile read in
// place, never through a symlink (`O_NOFOLLOW` on the last component; the callers check the directories above), never
// blocking on a FIFO, and only when it is a regular file no larger than the cap. Answers the text (or, for the profile
// picture, the bytes), or why not, as a code that never quotes the file.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

export type CappedRead = { text: string } | 'missing' | 'unreadable' | 'tooLarge';
export type CappedBytesRead = { bytes: Buffer } | 'missing' | 'unreadable' | 'tooLarge';

export async function readCappedNoFollow(file: string, maxBytes: number): Promise<CappedRead> {
  const read = await readCappedBytesNoFollow(file, maxBytes);
  return typeof read === 'string' ? read : { text: read.bytes.toString('utf8') };
}

export async function readCappedBytesNoFollow(file: string, maxBytes: number): Promise<CappedBytesRead> {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); // a FIFO never blocks; isFile refuses it
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable'; // a symlink is ELOOP
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) return 'unreadable';
    if (info.size > maxBytes) return 'tooLarge';
    return { bytes: await handle.readFile() };
  } catch {
    return 'unreadable';
  } finally {
    await handle.close();
  }
}
