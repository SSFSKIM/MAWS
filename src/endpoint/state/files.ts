// The state directory's files (Interfaces §E): each written whole to a same-directory temporary file (0600), fsynced,
// renamed over its name, and the directory fsynced, so a reader sees the old file or the new one and a crash between the
// temporary write and the rename leaves the old one. A stray temporary file (a crash's) is swept at start. Every file is
// read only when it is a regular file this uid owns with no group or other bits, the directory's rule (private-path.ts)
// applied to its files: a symlink or a widened mode is refused, not repaired, since either means someone else could
// have put or read what is in it.
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { join } from 'node:path';

export type StateFileReason = 'symlink' | 'not_file' | 'owner' | 'mode';

export class StateFileError extends Error {
  readonly path: string;
  readonly reason: StateFileReason | 'malformed';

  constructor(path: string, reason: StateFileError['reason'], detail?: string) {
    super(`${path} ${detail ?? reason}`);
    this.name = 'StateFileError';
    this.path = path;
    this.reason = reason;
  }
}

const TEMPORARY = /\.\d+\.[A-Za-z0-9_-]+\.tmp$/;

/** Throws a StateFileError unless `path` is a regular file the uid owns, 0600 or narrower; false when it is absent. */
export function checkPrivateFile(path: string, uid = process.getuid?.()): boolean {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new StateFileError(path, 'symlink', 'is a symlink');
  if (!stat.isFile()) throw new StateFileError(path, 'not_file', 'is not a regular file');
  if (stat.uid !== uid) throw new StateFileError(path, 'owner', 'is owned by another user');
  if ((stat.mode & 0o077) !== 0) throw new StateFileError(path, 'mode', 'is open to other users (group or other permission bits are set)');
  return true;
}

/** The file's text, or null when it is absent; a file that isn't private throws (checkPrivateFile). */
export function readPrivateText(path: string, uid?: number): string | null {
  if (!checkPrivateFile(path, uid)) return null;
  return fs.readFileSync(path, 'utf8');
}

/** `text` written to `dir/name` atomically (see the header), 0600. */
export function writeAtomic(dir: string, name: string, text: string): void {
  const temporary = join(dir, `${name}.${process.pid}.${randomBytes(6).toString('base64url')}.tmp`);
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    try {
      const bytes = Buffer.from(text, 'utf8');
      let at = 0;
      while (at < bytes.length) at += fs.writeSync(fd, bytes, at, bytes.length - at);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, join(dir, name));
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  syncDirectory(dir);
}

/** Removes `dir/name`, then fsyncs the directory; nothing when it is absent. */
export function removeFile(dir: string, name: string): void {
  fs.rmSync(join(dir, name), { force: true });
  syncDirectory(dir);
}

export function syncDirectory(dir: string): void {
  const fd = fs.openSync(dir, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Deletes the temporary files a crash left in `dir` (no other writer shares the directory). */
export function sweepTemporaries(dir: string): void {
  for (const entry of fs.readdirSync(dir)) if (TEMPORARY.test(entry)) fs.rmSync(join(dir, entry), { force: true });
}

/**
 * Appends `lines` (each without its newline) to `dir/name`, created 0600 when absent, and fsyncs the file before it
 * returns: an append-only record (the signature ledger, the inbound index) is on disk before anything it vouches for
 * leaves. What follows the last newline is settled first, as `readLines` reads it: a whole record that lost only its
 * newline (a crash between the two) is kept and terminated, and a torn one (a crash mid-record, which doesn't parse)
 * is cut off, so the new lines never join it. A file that isn't private is refused (checkPrivateFile).
 */
export function appendLines(dir: string, name: string, lines: readonly string[]): void {
  const path = join(dir, name);
  const created = !checkPrivateFile(path);
  const fd = fs.openSync(path, 'a+', 0o600);
  try {
    settleTail(fd);
    const bytes = Buffer.from(lines.map((line) => `${line}\n`).join(''), 'utf8');
    let at = 0;
    while (at < bytes.length) at += fs.writeSync(fd, bytes, at, bytes.length - at);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (created) syncDirectory(dir);
}

/** Settles what follows the last newline of the file behind `fd`: a whole record terminated, a torn one cut off. */
function settleTail(fd: number): void {
  const size = fs.fstatSync(fd).size;
  if (size === 0) return;
  const last = Buffer.alloc(1);
  fs.readSync(fd, last, 0, 1, size - 1);
  if (last[0] === 10) return;
  const whole = Buffer.alloc(size);
  let at = 0;
  while (at < size) at += fs.readSync(fd, whole, at, size - at, at);
  const start = whole.lastIndexOf(10) + 1;
  if (parses(whole.subarray(start).toString('utf8'))) fs.writeSync(fd, '\n');
  else fs.ftruncateSync(fd, start);
}

/** Whether a line is a record `readLines` takes. */
function parses(line: string): boolean {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
}

/**
 * The JSON lines of `dir/name` (none when it is absent); a line that doesn't parse (a torn last write) is left out, and
 * a whole last record without its newline is taken, as `appendLines` keeps it.
 */
export function readLines(dir: string, name: string): unknown[] {
  const text = readPrivateText(join(dir, name));
  if (text === null) return [];
  const out: unknown[] = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a torn write: the line is not taken
    }
  }
  return out;
}
