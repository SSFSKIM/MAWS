// The `files.*` service (C8c execution document, Interfaces "The open-first boundary"; the C8 spec's K1): list, read,
// watch and open a session's own files, every one confined to the session's allowlist (`allowlist.ts`).
//
// The boundary opens before it trusts: a pre-check (step 1) resolves the path to its in-root realpath `real0` and
// refuses a path that ends in a symlink; step 3 opens `real0` with `O_RDONLY | O_NONBLOCK | O_NOFOLLOW_ANY`
// (`O_DIRECTORY` too for a directory), so the kernel refuses a symlink anywhere on the path and the descriptor names an
// object reached through `real0`'s own directories; it `fstat`s the descriptor (4), confirms the opened object again
// by a fresh realpath under a root whose `stat` names the descriptor's `(dev, ino)` (5), and only then judges its type
// (5b), so no type is ever named for an object outside. `read` serves from the descriptor. `list` and `watch` cannot
// (Node has no `fdopendir`, and `fs.watch` takes a path), so a listing stays private until a confirmation after its
// last metadata read, and a watch is confirmed after its install and before every batch.
//
// The recorded limits, per operation: `read` none by race, because the open cannot traverse a symlink, so no
// substitution by symlink is ever followed, and step 5 refuses anything else that changed between the open and the
// confirmation (the reading that step 5 alone closed it was wrong: its `realpath` and `stat` are two path steps an
// ancestor flipping symlink, directory, symlink can straddle; M1 review); hard links inside a root, and a directory
// renamed into a root, are in the tree when opened, accepted by design. `list`: a swap-and-restore between `readdir` and
// the final confirmation can let outside names and metadata (never contents) into the answer. `watch`: a
// swap-and-restore between the install and its confirmation attaches the watcher outside until a batch's confirmation
// catches a standing swap, or forwards outside filenames if it was restored; a swap between a batch's confirmation and
// its per-name `lstat` classifies that batch's kinds from outside metadata. `openExternal` is path-checked immediately
// before `shell.openPath`, with no descriptor guarantee, and hands the OS only a regular, non-executable file of a document
// or media kind (`opensExternally`, an allowlist).
import fs, { type BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';
import type { AppSessionId } from '@shared/graph/ids';
import {
  BINARY_SNIFF_BYTES,
  FILES_LIST_MAX_ENTRIES,
  FILES_READ_DEFAULT_LENGTH,
  opensExternally,
  type FilesChanged,
  type FilesEntry,
  type FilesListOutput,
  type FilesOpenExternalOutput,
  type FilesReadInput,
  type FilesReadOutput,
} from '@shared/ipc/schema/files';
import { rootsOf, under, type AllowlistRecord } from './allowlist';
import { fileMime, isTextMime } from './mime';
import { sameIdentity, WatchTable, type Identity, type Installation } from './watch';

export type BoundaryPoint = 'before-open' | 'after-open' | 'after-readdir' | 'after-watch-install' | 'before-batch';
export interface BoundaryHooks {
  // Test-only: awaited at each named point, at most once per step, with the path as given (`before-batch` with the
  // watched realpath), so a test can substitute the tree there deterministically. Undefined in the product.
  at?(point: BoundaryPoint, path: string): Promise<void>;
}

export interface FilesServiceOptions {
  records: (appSessionId: AppSessionId) => AllowlistRecord | null; // `SessionReadModel.record` in the product
  hooks?: BoundaryHooks;
  emit?: (payload: FilesChanged) => void; // files.changed
  openPath?: (path: string) => Promise<string>; // Electron's shell.openPath: '' on success, else the error text
  env?: NodeJS.ProcessEnv; // MAWS_E2E and MAWS_E2E_OPEN_LOG, the e2e's openExternal seam
}

export interface FilesService {
  list(input: { appSessionId: AppSessionId; path?: string }): Promise<FilesListOutput>;
  read(input: FilesReadInput): Promise<FilesReadOutput>;
  watch(appSessionId: AppSessionId, path: string, owner: number): Promise<void>;
  unwatch(appSessionId: AppSessionId, path: string, owner: number): void;
  openExternal(appSessionId: AppSessionId, path: string): Promise<FilesOpenExternalOutput>;
  release(owner: number): void; // everything a window holds, when it closes or navigates
  watching(): string[];
  dispose(): void;
}

export const FILES_REFUSAL = "path outside the session's directories";

const { O_RDONLY, O_NONBLOCK, O_DIRECTORY } = fs.constants;
// macOS only (MAWS is macOS only; macOS 11 and later): refuse a symlink anywhere on the path the kernel walks, not only
// in its last component. Node's fs.constants does not carry it, so it is passed through numerically; a test asserts the
// kernel honours it, so a port to a platform that ignores the bit fails loudly instead of silently losing the guard.
// It replaces O_NOFOLLOW rather than joining it: macOS answers EINVAL for the two together (measured, Node 22.23.2 on
// macOS 26.6.2), and O_NOFOLLOW_ANY alone refuses a symlink in the last component with ELOOP as well.
export const O_NOFOLLOW_ANY = 0x20000000;
export const OPEN_FLAGS = O_RDONLY | O_NONBLOCK | O_NOFOLLOW_ANY;

class Refusal extends Error {
  constructor() {
    super(FILES_REFUSAL);
  }
}
const errno = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

// What steps 1 to 5b leave behind: the open descriptor, its fstat, and the confirmed realpath with its roots.
interface Confirmed {
  handle: FileHandle;
  stat: BigIntStats;
  real: string;
  roots: string[];
}

export function createFilesService({ records, hooks, emit = () => {}, openPath, env = process.env }: FilesServiceOptions): FilesService {
  const at = async (point: BoundaryPoint, path: string) => {
    await hooks?.at?.(point, path);
  };
  const watches = new WatchTable({ emit, beforeBatch: (real) => at('before-batch', real) });

  // Step 1: absolute, already normal (a `..` is refused before the disk is touched, since the kernel resolves `/X/..`
  // only when `/X` exists), a known session with at least one resolvable root, and a realpath under one of them.
  async function precheck(appSessionId: AppSessionId, path: string): Promise<{ roots: string[]; real0: string }> {
    if (!isAbsolute(path)) throw new Error('path must be absolute');
    const record = records(appSessionId);
    if (!record) throw new Error(`unknown app session: ${appSessionId}`);
    if (normalize(path) !== path) throw new Refusal();
    const roots = await rootsOf(record);
    if (roots.length === 0) throw new Refusal();
    let real0: string;
    try {
      real0 = await fs.promises.realpath(path);
    } catch (error) {
      throw await missing(path, roots, error);
    }
    if (!roots.some((root) => under(root, real0))) throw new Refusal();
    // P0 opens no symlink (K1): a path that ends in one is refused even when its target lies inside, since step 3
    // opens real0, which is the target.
    const own = await fs.promises.lstat(path).catch(() => null);
    if (!own || own.isSymbolicLink()) throw new Refusal();
    return { roots, real0 };
  }

  // Steps 2 to 5b for a regular file (`read`) or a directory (`list`, `watch`). The caller closes the handle.
  async function openConfirmed(appSessionId: AppSessionId, path: string, kind: 'file' | 'dir'): Promise<Confirmed> {
    const { roots, real0 } = await precheck(appSessionId, path);
    await at('before-open', path);
    let handle: FileHandle;
    try {
      // real0 with O_NOFOLLOW_ANY: the descriptor names an object reached through no symlink at all, beneath a root that
      // is itself a realpath, so the open is a containment check of its own and step 5 a second one.
      handle = await fs.promises.open(real0, kind === 'dir' ? OPEN_FLAGS | O_DIRECTORY : OPEN_FLAGS);
    } catch (error) {
      // ELOOP (a component of real0 became a symlink), ENOTDIR, EISDIR and the rest: no descriptor exists to confirm,
      // so no type is named; ENOENT says `not found` only under the leak rule.
      throw errno(error) === 'ENOENT' ? await missing(path, roots, error) : new Refusal();
    }
    try {
      const stat = await handle.stat({ bigint: true });
      await at('after-open', path);
      const real = await confirm(path, roots, stat);
      if (kind === 'file' && !stat.isFile()) throw new Error(`not a regular file: ${path}`);
      if (kind === 'dir' && !stat.isDirectory()) throw new Error(`not a directory: ${path}`);
      return { handle, stat, real, roots };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async function list({ appSessionId, path }: { appSessionId: AppSessionId; path?: string }): Promise<FilesListOutput> {
    if (path === undefined) return listRoots(appSessionId);
    const { handle, stat, real, roots } = await openConfirmed(appSessionId, path, 'dir');
    try {
      const names = await fs.promises.readdir(real).catch(async () => {
        throw await afterConfirmed(path, roots);
      });
      await at('after-readdir', path);
      // Private until the final confirmation below; an entry whose lstat or readlink fails is dropped unnamed.
      const collected = (await Promise.all(names.map((name) => entryAt(real, name)))).filter((entry) => entry !== null);
      await confirm(path, roots, stat);
      const sorted = collected.sort((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || a.name.localeCompare(b.name));
      const root = roots.filter((candidate) => under(candidate, real)).sort((a, b) => b.length - a.length)[0] ?? null;
      return { root, path: real, entries: sorted.slice(0, FILES_LIST_MAX_ENTRIES), truncated: sorted.length > FILES_LIST_MAX_ENTRIES };
    } finally {
      await handle.close();
    }
  }

  async function listRoots(appSessionId: AppSessionId): Promise<FilesListOutput> {
    const record = records(appSessionId);
    if (!record) throw new Error(`unknown app session: ${appSessionId}`);
    const roots = await rootsOf(record);
    if (roots.length === 0) throw new Refusal();
    const entries = await Promise.all(
      roots.map(async (root): Promise<FilesEntry | null> => {
        const stat = await fs.promises.stat(root).catch(() => null);
        return stat && { name: basename(root) || root, path: root, kind: kindOf(stat), size: stat.size, mtimeMs: stat.mtimeMs, target: null };
      }),
    );
    return { root: null, path: '', entries: entries.filter((entry) => entry !== null), truncated: false };
  }

  async function read({ appSessionId, path, offset = 0, length = FILES_READ_DEFAULT_LENGTH }: FilesReadInput): Promise<FilesReadOutput> {
    const { handle, stat, real } = await openConfirmed(appSessionId, path, 'file');
    try {
      const size = Number(stat.size);
      let chunk = await readFully(handle, Math.max(0, Math.min(length, size - offset)), offset);
      const head = offset === 0 && chunk.length >= Math.min(BINARY_SNIFF_BYTES, size) ? chunk.subarray(0, BINARY_SNIFF_BYTES) : await readFully(handle, Math.min(BINARY_SNIFF_BYTES, size), 0);
      const mime = fileMime(basename(real), head);
      const encoding = isTextMime(mime) ? 'utf8' : 'base64';
      if (encoding === 'utf8') chunk = await settleText(handle, chunk, offset, size);
      return {
        encoding,
        content: chunk.toString(encoding),
        bytes: size,
        offset,
        length: chunk.length,
        truncated: offset + chunk.length < size,
        mime,
      };
    } finally {
      await handle.close();
    }
  }

  async function watch(appSessionId: AppSessionId, path: string, owner: number): Promise<void> {
    const { handle, stat, real, roots } = await openConfirmed(appSessionId, path, 'dir');
    const holder = { owner, appSessionId, path };
    try {
      const identity: Identity = { dev: stat.dev, ino: stat.ino };
      const existing = watches.identityOf(real);
      if (existing && sameIdentity(existing, identity)) return watches.join(real, holder);
      if (existing) watches.invalidateReal(real); // the directory at this realpath is not the one being watched
      let installation: Installation;
      try {
        installation = watches.install(real, identity);
      } catch {
        throw await afterConfirmed(path, roots);
      }
      try {
        await at('after-watch-install', path);
        await confirm(path, roots, stat);
      } catch (error) {
        installation.close();
        throw error;
      }
      // Another holder may have installed while this one awaited: join it when it watches the same directory.
      const raced = watches.identityOf(real);
      if (raced && sameIdentity(raced, identity)) {
        installation.close();
        return watches.join(real, holder);
      }
      if (raced) watches.invalidateReal(real);
      if (!installation.adopt(holder)) throw new Refusal();
    } finally {
      await handle.close();
    }
  }

  async function openExternal(appSessionId: AppSessionId, path: string): Promise<FilesOpenExternalOutput> {
    const { real0 } = await precheck(appSessionId, path);
    // "Open externally" shows a document in its viewer; it never runs a program an agent wrote into the tree. The
    // object is in-root (step 1), so naming it in the message leaks nothing.
    const target = await fs.promises.lstat(real0).catch(() => null);
    if (!target || !target.isFile() || (target.mode & 0o111) !== 0 || !opensExternally(basename(real0))) {
      throw new Error(`not opened outside MAWS: ${path}`);
    }
    if (env.MAWS_E2E === '1' && env.MAWS_E2E_OPEN_LOG) {
      await fs.promises.appendFile(env.MAWS_E2E_OPEN_LOG, `${real0}\n`);
      return { opened: true, message: null };
    }
    if (!openPath) throw new Error('files.openExternal has no opener');
    const message = await openPath(real0);
    return message === '' ? { opened: true, message: null } : { opened: false, message };
  }

  return {
    list,
    read,
    watch,
    unwatch: (appSessionId, path, owner) => watches.unwatch({ owner, appSessionId, path }),
    openExternal,
    release: (owner) => watches.release(owner),
    watching: () => watches.watching(),
    dispose: () => watches.dispose(),
  };
}

// Step 5 (and the late confirmations): a fresh realpath of the path as given, under a root, whose `stat` names the
// descriptor's object. Answers the confirmed realpath.
async function confirm(path: string, roots: readonly string[], opened: Identity): Promise<string> {
  const real = await fs.promises.realpath(path).catch(() => null);
  if (real === null || !roots.some((root) => under(root, real))) throw new Refusal();
  const now = await fs.promises.stat(real, { bigint: true }).catch(() => null);
  if (!now || !sameIdentity(now, opened)) throw new Refusal();
  return real;
}

async function entryAt(real: string, name: string): Promise<FilesEntry | null> {
  const path = join(real, name);
  try {
    const stat = await fs.promises.lstat(path);
    const kind = kindOf(stat);
    const target = kind === 'symlink' ? await fs.promises.readlink(path) : null;
    return { name, path, kind, size: stat.size, mtimeMs: stat.mtimeMs, target };
  } catch {
    return null; // deleted since readdir, or unreadable: dropped, and Node's message (which names it) discarded
  }
}

function kindOf(stat: fs.Stats): FilesEntry['kind'] {
  if (stat.isSymbolicLink()) return 'symlink';
  if (stat.isDirectory()) return 'dir';
  if (stat.isFile()) return 'file';
  return 'other';
}

// The leak rule for a path that does not resolve: `not found` only when the realpath of its deepest existing ancestor
// lies under a root and no component exists without resolving (a dangling symlink could point anywhere); otherwise
// the refusal, so the command says nothing about what exists elsewhere. C4's rule in `readSpill`
// (src/engine-host/fs/artifacts.ts), walked on the path as given so the kernel resolves every link.
// A path-based step after step 5 (`readdir`, `fs.watch`) failed: Node's message names the path and says whether
// something exists there, so it is never surfaced. The path is resolved again: gone, it answers the leak rule (`not
// found` only inside); still resolving, the refusal, whatever it now names.
async function afterConfirmed(path: string, roots: readonly string[]): Promise<Error> {
  try {
    await fs.promises.realpath(path);
  } catch (error) {
    return missing(path, roots, error);
  }
  return new Refusal();
}

async function missing(path: string, roots: readonly string[], error: unknown): Promise<Error> {
  const code = errno(error);
  if ((code === 'ENOENT' || code === 'ENOTDIR') && (await missingWithin(path, roots))) return new Error(`not found: ${path}`);
  return new Refusal();
}

async function missingWithin(path: string, roots: readonly string[]): Promise<boolean> {
  let ancestor = path;
  const tail: string[] = [];
  for (;;) {
    const parent = dirname(ancestor);
    if (parent === ancestor) return false;
    tail.unshift(basename(ancestor));
    ancestor = parent;
    const real = await fs.promises.realpath(ancestor).then(
      (resolved) => resolved,
      (failure: unknown) => (errno(failure) === 'ENOENT' || errno(failure) === 'ENOTDIR' ? null : false),
    );
    if (real === false) return false;
    if (real === null) continue;
    const dangling = await fs.promises.lstat(join(ancestor, tail[0])).then(
      () => true,
      () => false,
    );
    return !dangling && roots.some((root) => under(root, join(real, ...tail)));
  }
}

async function readFully(handle: FileHandle, length: number, position: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return buffer.subarray(0, filled);
}

// A utf8 chunk that does not end the file ends on a character boundary and never between a CRLF's `\r` and `\n`, so
// continuation reads concatenate exactly. Up to three trailing bytes of an incomplete sequence are withheld, then a
// trailing `\r`; a chunk that withholding would leave empty reads forward instead (at most three bytes to finish the
// character, one for the `\n`), so a pager always advances (C4's `readSpill` rule).
async function settleText(handle: FileHandle, chunk: Buffer, offset: number, size: number): Promise<Buffer> {
  const more = (page: Buffer) => offset + page.length < size;
  if (!more(chunk)) return chunk;
  const cut = utf8Cut(chunk);
  if (cut.missing > 0) {
    chunk = cut.end > 0 ? chunk.subarray(0, cut.end) : Buffer.concat([chunk, await readFully(handle, Math.min(cut.missing, size - offset - chunk.length), offset + chunk.length)]);
  }
  if (more(chunk) && chunk.at(-1) === 0x0d) {
    if (chunk.length > 1) return chunk.subarray(0, -1);
    const next = await readFully(handle, 1, offset + 1);
    if (next[0] === 0x0a) return Buffer.concat([chunk, next]); // a lone `\r` not followed by `\n` splits no CRLF
  }
  return chunk;
}

// Where `page` must end so it does not end inside a UTF-8 sequence, and how many bytes that last sequence lacks (0 when
// the page ends on a boundary). Bytes that are not valid UTF-8 are left as they are. C4's `utf8Cut` (artifacts.ts).
function utf8Cut(page: Buffer): { end: number; missing: number } {
  const whole = { end: page.length, missing: 0 };
  let start = page.length - 1;
  while (start >= 0 && page.length - start <= 4 && (page[start] & 0xc0) === 0x80) start--;
  if (start < 0 || page.length - start > 4) return whole;
  const lead = page[start];
  const width = lead < 0x80 ? 1 : (lead & 0xe0) === 0xc0 ? 2 : (lead & 0xf0) === 0xe0 ? 3 : (lead & 0xf8) === 0xf0 ? 4 : 0;
  if (width === 0 || start + width <= page.length) return whole;
  return { end: start, missing: start + width - page.length };
}
