// A checkout's top-level files as its index records them (P5 O7 M9, round 3; ./git-reads.ts says why no git runs before
// trust): the evidence the project fold's content check (src/services/index/projects.ts' `holdsHead`) compares with a
// main checkout's files, read from the checkout's git dir `index` through the walk, in place of HEAD's tree (which
// takes the object store: inflating, packs, deltas). The index is what the checkout last staged, HEAD's tree plus any
// staged change, so the two answers differ only for a main checkout whose smallest top-level files are staged and not
// committed (or committed and staged back).
//
// The format (git's Documentation/gitformat-index.txt): `DIRC`, a version (2, 3 or 4), an entry count, the entries
// (v2 and v3 padded to 8 bytes, v4's paths prefix-compressed), extensions, and a trailing hash of everything before it
// (all zero under `index.skipHash`). Bounded and strict: a file over INDEX_MAX or a count over ENTRIES_MAX, an unknown
// version, a name over NAME_MAX or all names over NAMES_MAX decoded (v4's prefixes), a malformed entry or extension, a
// mandatory extension (a split index's `link`, a sparse index's `sdir`, any lower-case one) or a wrong hash answers
// null, which folds nothing. Only plain top-level names are answered (no `/`, `.` or `..`).
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { GitFiles, GitRepo } from './git-reads';

/** A regular top-level file the index records: its name and blob id. */
export type TopLevelFile = { name: string; id: string };

const INDEX_MAX = 64 * 1024 * 1024;
const ENTRIES_MAX = 1_000_000;
const NAME_MAX = 4096; // git's own bound on a path (PATH_MAX)
const NAMES_MAX = 16 * 1024 * 1024; // every entry's decoded name, the filtered ones counted: v4's prefixes can't grow it past this
const FIXED = 40; // ctime, mtime, dev, ino, mode, uid, gid, size: ten 32-bit fields
const EXTENDED = 0x4000;
const STAGE = 0x3000;
const SKIP_WORKTREE = 0x4000; // in the extended flags
const INTENT_TO_ADD = 0x2000;

/** The repository's checkout's regular top-level files at stage 0 as its index records them, or null when it can't say. */
export async function indexTopLevelFiles(repo: GitRepo, files: GitFiles): Promise<TopLevelFile[] | null> {
  const bytes = await files.read(join(repo.gitDir, 'index'), INDEX_MAX);
  return bytes === null ? null : parseIndex(bytes, (repo.config.get('extensions.objectformat') ?? 'sha1').toLowerCase() === 'sha256' ? 32 : 20);
}

/** The index `bytes`' regular top-level files (see the header); null for anything this does not read exactly. */
export function parseIndex(bytes: Buffer, hashLength: number): TopLevelFile[] | null {
  if (bytes.length < 12 + hashLength || bytes.toString('latin1', 0, 4) !== 'DIRC') return null;
  const version = bytes.readUInt32BE(4);
  const count = bytes.readUInt32BE(8);
  if (version < 2 || version > 4 || count > ENTRIES_MAX) return null;
  const end = bytes.length - hashLength; // the trailing hash
  const trailer = bytes.subarray(end);
  if (trailer.some((byte) => byte !== 0) && !createHash(hashLength === 32 ? 'sha256' : 'sha1').update(bytes.subarray(0, end)).digest().equals(trailer)) return null;
  const out: TopLevelFile[] = [];
  let at = 12;
  let previous = '';
  let decoded = 0;
  for (let n = 0; n < count; n++) {
    const header = FIXED + hashLength + 2;
    if (at + header > end) return null;
    const mode = bytes.readUInt32BE(at + 24);
    const id = bytes.toString('hex', at + FIXED, at + FIXED + hashLength);
    const flags = bytes.readUInt16BE(at + FIXED + hashLength);
    let pathAt = at + header;
    let extended = 0;
    if (flags & EXTENDED) {
      if (version < 3 || pathAt + 2 > end) return null;
      extended = bytes.readUInt16BE(pathAt);
      pathAt += 2;
    }
    let name: string;
    if (version === 4) {
      let byte = bytes[pathAt++];
      let strip = byte & 0x7f;
      while (byte & 0x80) {
        if (pathAt >= end) return null;
        byte = bytes[pathAt++];
        strip = (strip + 1) * 128 + (byte & 0x7f);
      }
      const nul = bytes.indexOf(0, pathAt);
      if (strip > previous.length || nul === -1 || nul >= end || previous.length - strip + (nul - pathAt) > NAME_MAX) return null;
      name = previous.slice(0, previous.length - strip) + bytes.toString('latin1', pathAt, nul);
      at = nul + 1;
    } else {
      const nul = bytes.indexOf(0, pathAt);
      if (nul === -1 || nul >= end || nul - pathAt > NAME_MAX) return null;
      name = bytes.toString('latin1', pathAt, nul);
      at += (pathAt - at + (nul - pathAt) + 8) & ~7;
      if (at > end) return null;
    }
    decoded += name.length;
    if (decoded > NAMES_MAX) return null;
    previous = name; // compared and compressed as bytes: latin1 keeps one character per byte
    const regular = (mode & 0o170000) === 0o100000;
    if (regular && (flags & STAGE) === 0 && (extended & (SKIP_WORKTREE | INTENT_TO_ADD)) === 0 && !name.includes('/') && name !== '' && name !== '.' && name !== '..') {
      out.push({ name: Buffer.from(name, 'latin1').toString('utf8'), id });
    }
  }
  for (; at < end; ) {
    if (at + 8 > end) return null;
    const signature = bytes.toString('latin1', at, at + 4);
    const size = bytes.readUInt32BE(at + 4);
    // only an optional extension (its signature's first letter upper case) is skipped, as git skips it; a mandatory one
    // (`link`, a split index's, whose entries live in another file; `sdir`, a sparse index's; any other) is not read here
    if (!/^[A-Z]/.test(signature) || at + 8 + size > end) return null;
    at += 8 + size;
  }
  return out;
}
