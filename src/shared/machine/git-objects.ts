// HEAD's top-level files read from a repository's object store directly (P5 O7 M9, round 2; ./git-reads.ts says why no
// git runs before trust): what `git ls-tree -z HEAD` lists of HEAD's regular top-level files, which the project fold's
// content check compares with a main checkout's files (src/services/index/projects.ts' `holdsHead`). Every file is
// reached through the walk.
//
// HEAD is followed through loose refs (the git dir's for HEAD and the per-worktree refs, the common dir's for the rest)
// and `packed-refs`; an object is read loose or from a pack (`.idx` version 2, offset and reference deltas), in the
// common dir's `objects` and each store its `info/alternates` names, SHA-1 or SHA-256 as `extensions.objectFormat`
// says. Every doubt answers null (no fold): a reftable repository, an unborn HEAD, an object missing (a partial clone) or
// larger than OBJECT_MAX, a pack this does not read.
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, join, sep } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { GitFiles, GitRepo } from './git-reads';

export type TreeFile = { name: string; id: string };

/** The largest object read; HEAD's commit and top-level tree are far smaller. */
const OBJECT_MAX = 16 * 1024 * 1024;
const REF_MAX = 4096;
const PACKED_REFS_MAX = 64 * 1024 * 1024;
const SYMREF_DEPTH = 5; // git's own bound on symbolic refs
const DELTA_DEPTH = 4096;
const ALTERNATE_DEPTH = 5; // git's own bound on nested alternates

const TYPES = ['', 'commit', 'tree', 'blob', 'tag'] as const;
type GitObject = { type: (typeof TYPES)[number]; data: Buffer };

/** HEAD's regular top-level files as `ls-tree` lists them (names and blob ids), or null when HEAD names none to read. */
export async function headTreeFiles(repo: GitRepo, files: GitFiles): Promise<TreeFile[] | null> {
  if ((repo.config.get('extensions.refstorage') ?? 'files').toLowerCase() !== 'files') return null;
  const hashLength = (repo.config.get('extensions.objectformat') ?? 'sha1').toLowerCase() === 'sha256' ? 32 : 20;
  const head = await resolveRef(repo, 'HEAD', files, hashLength);
  if (head === null) return null;
  const store = new ObjectStore(await objectDirs(join(repo.commonDir, 'objects'), files), files, hashLength);
  let object = await store.read(head);
  for (let peeled = 0; object !== null && object.type !== 'tree' && peeled < SYMREF_DEPTH; peeled++) {
    const next = /^(?:tree|object) ([0-9a-f]+)$/m.exec(object.type === 'commit' || object.type === 'tag' ? object.data.toString('utf8') : '');
    object = next === null ? null : await store.read(next[1]);
  }
  return object?.type === 'tree' ? treeFiles(object.data, hashLength) : null;
}

/** The regular files of a tree object: `<mode> <name>\0<id>` each, a mode whose type bits say a regular file. */
function treeFiles(data: Buffer, hashLength: number): TreeFile[] | null {
  const out: TreeFile[] = [];
  for (let at = 0; at < data.length; ) {
    const space = data.indexOf(0x20, at);
    const nul = data.indexOf(0, space + 1);
    if (space === -1 || nul === -1 || nul + 1 + hashLength > data.length) return null;
    const mode = parseInt(data.toString('latin1', at, space), 8);
    if ((mode & 0o170000) === 0o100000) out.push({ name: data.toString('utf8', space + 1, nul), id: data.toString('hex', nul + 1, nul + 1 + hashLength) });
    at = nul + 1 + hashLength;
  }
  return out;
}

const PER_WORKTREE = /^(?:HEAD|refs\/(?:worktree|bisect|rewritten)\/.+)$/;
const REF_NAME = /^(?:HEAD|refs\/(?:[^/\0]+\/)*[^/\0]+)$/;

/** A ref's object id, through symbolic refs, loose files and `packed-refs`; null when it names none. */
async function resolveRef(repo: GitRepo, name: string, files: GitFiles, hashLength: number, depth = 0): Promise<string | null> {
  if (depth > SYMREF_DEPTH || !REF_NAME.test(name) || name.split('/').some((part) => part === '.' || part === '..')) return null;
  const id = new RegExp(`^[0-9a-f]{${hashLength * 2}}$`);
  const loose = (await files.read(join(PER_WORKTREE.test(name) ? repo.gitDir : repo.commonDir, name), REF_MAX))?.toString('utf8').trim();
  if (loose !== undefined) {
    if (loose.startsWith('ref:')) return resolveRef(repo, loose.slice('ref:'.length).trim(), files, hashLength, depth + 1);
    return id.test(loose) ? loose : null;
  }
  if (PER_WORKTREE.test(name)) return null;
  const packed = (await files.read(join(repo.commonDir, 'packed-refs'), PACKED_REFS_MAX))?.toString('utf8') ?? '';
  for (const line of packed.split('\n')) {
    const space = line.indexOf(' ');
    if (line.slice(space + 1) === name && id.test(line.slice(0, space))) return line.slice(0, space);
  }
  return null;
}

/** The object dirs: the repository's own, then each its alternates name (relative to the dir naming them), in order. */
async function objectDirs(own: string, files: GitFiles): Promise<string[]> {
  const dirs: string[] = [];
  const visit = async (dir: string, depth: number) => {
    const real = await files.real(dir);
    if (real === null || dirs.includes(real)) return;
    dirs.push(real);
    if (depth >= ALTERNATE_DEPTH) return;
    const alternates = (await files.read(join(real, 'info/alternates'), REF_MAX * 16))?.toString('utf8') ?? '';
    for (const line of alternates.split('\n')) {
      const path = line.trim();
      if (path === '' || path.startsWith('#') || path.startsWith('"')) continue; // a quoted path is one git writes for an odd name: not read
      await visit(isAbsolute(path) ? path : `${real}${sep}${path}`, depth + 1);
    }
  };
  await visit(own, 0);
  return dirs;
}

class ObjectStore {
  constructor(
    private readonly dirs: string[],
    private readonly files: GitFiles,
    private readonly hashLength: number,
  ) {}

  /** The object `id`, loose or packed, in the first store holding it; null when none does or it can't be read. */
  async read(id: string, depth = 0): Promise<GitObject | null> {
    if (depth > DELTA_DEPTH) return null;
    for (const dir of this.dirs) {
      const loose = await this.files.read(join(dir, id.slice(0, 2), id.slice(2)), OBJECT_MAX);
      if (loose !== null) return looseObject(loose);
      for (const name of ((await this.files.list(join(dir, 'pack'))) ?? []).filter((entry) => /^pack-[0-9a-f]+\.idx$/.test(entry)).sort()) {
        const found = await this.packed(join(dir, 'pack', name), id, depth);
        if (found !== undefined) return found;
      }
    }
    return null;
  }

  /** The object `id` from the pack whose index is `idx`: undefined when the index lists it not. */
  private async packed(idx: string, id: string, depth: number): Promise<GitObject | null | undefined> {
    const index = await this.files.open(idx);
    if (index === null) return undefined;
    let offset: number | null;
    try {
      offset = await indexOffset(index, Buffer.from(id, 'hex'), this.hashLength);
    } finally {
      await index.close();
    }
    if (offset === null) return undefined;
    const pack = await this.files.open(idx.replace(/\.idx$/, '.pack'));
    if (pack === null) return null;
    try {
      return await this.entry(pack, offset, depth);
    } finally {
      await pack.close();
    }
  }

  /** The pack entry at `offset`, its deltas applied. */
  private async entry(pack: FileHandle, offset: number, depth: number): Promise<GitObject | null> {
    if (depth > DELTA_DEPTH) return null;
    const head = await readAt(pack, offset, 32 + this.hashLength);
    let at = 0;
    let byte = head[at++];
    const type = (byte >> 4) & 7;
    let size = byte & 15;
    for (let shift = 4; byte & 0x80; shift += 7) {
      byte = head[at++];
      size += (byte & 0x7f) * 2 ** shift;
    }
    if (size > OBJECT_MAX || at >= head.length) return null;
    let base: GitObject | null = null;
    if (type === 6) {
      byte = head[at++];
      let back = byte & 0x7f;
      while (byte & 0x80) {
        byte = head[at++];
        back = (back + 1) * 128 + (byte & 0x7f);
      }
      base = await this.entry(pack, offset - back, depth + 1);
    } else if (type === 7) {
      base = await this.read(head.toString('hex', at, at + this.hashLength), depth + 1);
      at += this.hashLength;
    } else if (type < 1 || type > 4) return null;
    const data = await inflateAt(pack, offset + at, size);
    if (data === null) return null;
    if (type < 5) return { type: TYPES[type], data };
    if (base === null) return null;
    const applied = applyDelta(base.data, data);
    return applied === null ? null : { type: base.type, data: applied };
  }
}

/** A loose object's inflated `<type> <size>\0<data>`. */
function looseObject(bytes: Buffer): GitObject | null {
  let inflated: Buffer;
  try {
    inflated = inflateSync(bytes, { maxOutputLength: OBJECT_MAX + 64 });
  } catch {
    return null;
  }
  const nul = inflated.indexOf(0);
  const header = /^(commit|tree|blob|tag) (\d+)$/.exec(inflated.toString('latin1', 0, nul));
  if (nul === -1 || header === null || Number(header[2]) !== inflated.length - nul - 1) return null;
  return { type: header[1] as GitObject['type'], data: inflated.subarray(nul + 1) };
}

async function readAt(file: FileHandle, position: number, length: number): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  const { bytesRead } = await file.read(bytes, 0, length, position);
  return bytes.subarray(0, bytesRead);
}

/** The offset of `id` in the pack an `.idx` (version 2) indexes, or null when it lists it not. */
async function indexOffset(index: FileHandle, id: Buffer, hashLength: number): Promise<number | null> {
  const header = await readAt(index, 0, 8 + 256 * 4);
  if (header.length < 8 + 256 * 4 || header.readUInt32BE(0) !== 0xff744f63 || header.readUInt32BE(4) !== 2) return null;
  const fanout = (i: number) => header.readUInt32BE(8 + i * 4);
  const count = fanout(255);
  const ids = 8 + 256 * 4;
  let low = id[0] === 0 ? 0 : fanout(id[0] - 1);
  let high = fanout(id[0]);
  while (low < high) {
    const middle = (low + high) >>> 1;
    const order = Buffer.compare(await readAt(index, ids + middle * hashLength, hashLength), id);
    if (order === 0) {
      const offsets = ids + count * hashLength + count * 4;
      const small = (await readAt(index, offsets + middle * 4, 4)).readUInt32BE(0);
      if ((small & 0x80000000) === 0) return small;
      const large = await readAt(index, offsets + count * 4 + (small & 0x7fffffff) * 8, 8);
      return Number(large.readBigUInt64BE(0));
    }
    if (order < 0) low = middle + 1;
    else high = middle;
  }
  return null;
}

/** The zlib stream at `position` inflated to its `size` bytes: read in a window that grows until the stream ends in it. */
async function inflateAt(pack: FileHandle, position: number, size: number): Promise<Buffer | null> {
  const end = (await pack.stat()).size;
  for (let window = size + 1024; ; window *= 2) {
    const bytes = await readAt(pack, position, Math.min(window, end - position));
    try {
      const data = inflateSync(bytes, { maxOutputLength: OBJECT_MAX + 64 }); // bytes past the stream's end are left
      return data.length === size ? data : null;
    } catch {
      if (position + window >= end) return null; // a truncated stream with all the file read: corrupt
    }
  }
}

/** git's delta: the base's and result's sizes, then copies from the base and inserted bytes. */
function applyDelta(base: Buffer, delta: Buffer): Buffer | null {
  let at = 0;
  const size = () => {
    let value = 0;
    for (let shift = 0; at < delta.length; shift += 7) {
      const byte = delta[at++];
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) break;
    }
    return value;
  };
  if (size() !== base.length) return null;
  const out = Buffer.alloc(size());
  let written = 0;
  while (at < delta.length) {
    const op = delta[at++];
    if (op & 0x80) {
      let offset = 0;
      let length = 0;
      for (let i = 0; i < 4; i++) if (op & (1 << i)) offset += delta[at++] * 2 ** (8 * i);
      for (let i = 0; i < 3; i++) if (op & (1 << (4 + i))) length += delta[at++] * 2 ** (8 * i);
      if (length === 0) length = 0x10000;
      if (offset + length > base.length || written + length > out.length) return null;
      base.copy(out, written, offset, offset + length);
      written += length;
    } else if (op !== 0) {
      if (at + op > delta.length || written + op > out.length) return null;
      delta.copy(out, written, at, at + op);
      at += op;
      written += op;
    } else return null;
  }
  return written === out.length ? out : null;
}
