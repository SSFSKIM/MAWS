// An upload's root under a session's working directory, and what is written there: lane A's rules (P5 O9 M7,
// docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, M7 and Interfaces §B, §H), lifted for lane B's `files.upload` (P5
// O3-E M3, docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, Interfaces §F; D7). Each lane names its own files
// (`owned`, a pattern over a file's name): a rollback or a sweep removes only names its lane's pattern owns, so a file
// it did not write survives, and one lane's sweep never reads the other's record. The rules follow sminos's own for a
// desk upload (doperpowers `sminos/skills/sminos/scripts/sminos_media.py`, read for its rules; nothing of it runs here):
//
// - the files go under `<cwd>/.claude/desk-uploads/<session>/`, `cwd` the session's working directory, resolved, and are
//   reached from `/` following no link: a link anywhere on the way (an ancestor that became one since, `.claude`,
//   `desk-uploads`, the session's directory, a file's own name) refuses the upload rather than redirect the write;
// - each is created exclusively, mode 0600 (directories 0700), under the name its lane gives it; a name already there
//   refuses the upload, and only the files this upload made are taken back;
// - the repository's common `info/exclude` gains `**/.claude/desk-uploads/`, reached the same way, so an upload never
//   shows in `git status`; a linked or irregular exclude refuses the upload (sminos only logs it);
// - each root is recorded in its lane's record before anything is written under it, and swept once no upload has gone
//   to it for a day, its recorded path walked the same way.
//
// Node has no `openat`, so the walk is made per open (./no-link.ts, shared with the files service): on macOS every open
// carries `O_NOFOLLOW_ANY`, which fails the open if any component of the path is a link, atomically; elsewhere (Linux)
// each ancestor is `lstat`ed first, the open carries `O_NOFOLLOW`, which refuses every link present when it looks, and
// the opened descriptor's own path must be the walked one, so a link put above it since is refused at the open (an
// exclusive create through it has made its empty file where the link pointed by then: O3-E's D23(g) residual). Nor has
// it `mkdirat` or `unlinkat`, so each directory the walk reaches is pinned by its `dev` and `ino`, and every mutation (a
// mkdir, an unlink, an rmdir) first reopens what it touches the same way and checks it is still that directory, or a
// regular file (`mutate`, below).
import { randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmdirSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { atomicWriteFileSync } from '@shared/fs/atomic-write';
import { NotARepositoryError, type GitRun } from '../git/runner';
import { confirmOpenedSync, LinkOnTheWay, NO_LINK, walkSync, WALKED } from './no-link';

export const UPLOADS = ['.claude', 'desk-uploads'] as const; // under the working directory; the session's directory below
export const EXCLUDE_LINE = '**/.claude/desk-uploads/'; // unanchored: a session in a subdirectory of the checkout matches too
export const SWEEP_AFTER_MS = 24 * 3600_000;

// A lane's own file names: the only names a rollback or a sweep of its roots ever removes.
export type OwnedFiles = RegExp;

// A component of an upload's path that is a link or not a directory, or a file there already: nothing goes through it.
export class Unsafe extends Error {}
// The name a file of the upload was to take is there already (a link included): nothing is written over it.
export class AlreadyThere extends Unsafe {
  constructor(readonly file: string) {
    super(`${file} is already there: nothing is written over it`);
  }
}

// MAWS's upload id: 16 random bytes, base64url (lane A's bridge takes `[A-Za-z0-9_-]{1,128}`).
export const uploadId = (): string => randomBytes(16).toString('base64url');

export const rootOf = (base: string, session: string): string => join(base, ...UPLOADS, session);

// ---- the walk ---------------------------------------------------------------------------------------------------------
const code = (error: unknown) => (error as NodeJS.ErrnoException).code;

function partsOf(path: string): string[] {
  const parts = path.split(sep).filter((p) => p !== '');
  if (!isAbsolute(path) || parts.some((p) => p === '.' || p === '..')) throw new Unsafe(`${path} is not an absolute path`);
  return parts;
}

const linked = (path: string) => new Unsafe(`${path} has a link or a file on its way: nothing is written through it`);

// `path` opened with no link anywhere on its way; a link, or a component that is no directory, is Unsafe.
function openNoLink(path: string, flags: number, mode?: number): number {
  partsOf(path);
  try {
    if (WALKED) walkSync(dirname(path)); // without O_NOFOLLOW_ANY: every directory from `/` a directory, none a link, now
  } catch (error) {
    if (error instanceof LinkOnTheWay) throw new Unsafe(`${error.part} is a link or not a directory: nothing is written through it`);
    throw error;
  }
  let fd: number;
  try {
    fd = openSync(path, flags | NO_LINK, mode);
  } catch (error) {
    if (code(error) === 'ELOOP' || code(error) === 'ENOTDIR') throw linked(path);
    if (code(error) === 'EISDIR') throw new Unsafe(`${path} is a directory, not a regular file`);
    throw error;
  }
  try {
    confirmOpenedSync(fd, path);
  } catch (error) {
    closeSync(fd);
    throw error instanceof LinkOnTheWay ? linked(path) : error;
  }
  return fd;
}

// A directory the walk reached with no link on its way, pinned by its device and inode.
interface Pinned {
  path: string;
  dev: number;
  ino: number;
}

// `path`, reached with no link on its way, if it is a directory: pinned.
function pin(path: string): Pinned {
  const fd = openNoLink(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    const { dev, ino } = fstatSync(fd);
    return { path, dev, ino };
  } finally {
    closeSync(fd);
  }
}

// Still the pinned directory, reached with no link on its way; Unsafe otherwise.
function still(dir: Pinned): void {
  const now = pin(dir.path);
  if (now.dev !== dir.dev || now.ino !== dir.ino) throw new Unsafe(`${dir.path} is no longer the directory the upload walked: nothing is changed through it`);
}

// Every mutation goes through here: `under` (and the directory to remove, when one is) checked to be the very directories the walk pinned,
// reached with no link, and a file to unlink checked to be a regular file reached with no link, immediately before the
// call. What remains is the window between that check and the syscall, which Node cannot close (it has no `mkdirat`,
// `unlinkat` or `unlinkat(AT_REMOVEDIR)`). Its bound: a racer that wins it changes only what is asked here, which is
// the removal of one non-directory entry with a name its lane owns (`clear` filters every name by the lane's pattern),
// checked as a regular file just before but of a type not guaranteed at the syscall (a link, a FIFO or a socket swapped
// in is removed, never followed, its target intact), or of an empty directory; so the worst it reaches is another
// tree's upload-named entries, which the sweep would remove anyway. The uid boundary (RL §5.11) alone would not cover
// it: an engine running sandboxed writes only inside its tree, yet can plant a link there and race; the naming filter is
// what bounds that case. Accepted (the O9 document's Decision Log); rejected: a native or Python helper for the `*at`
// calls, a runtime dependency for this bounded race.
function mutate(under: Pinned, change: { mkdir: string } | { unlink: string } | { rmdir: Pinned }): void {
  still(under);
  if ('mkdir' in change) {
    mkdirSync(join(under.path, change.mkdir), 0o700);
  } else if ('unlink' in change) {
    const path = join(under.path, change.unlink);
    const fd = openNoLink(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      if (!fstatSync(fd).isFile()) throw new Unsafe(`${path} is not a regular file: it is left`);
    } finally {
      closeSync(fd);
    }
    unlinkSync(path);
  } else {
    still(change.rmdir);
    rmdirSync(change.rmdir.path);
  }
}

// The directory `path` and `below` it, each reached with no link on its way and pinned, `below` created 0700 where
// missing when `create`: the pins, `path`'s first.
function walk(path: string, below: readonly string[] = [], create = false): Pinned[] {
  const pins = [pin(path)];
  for (const name of below) {
    const parent = pins.at(-1)!;
    if (create) {
      try {
        mutate(parent, { mkdir: name });
      } catch (error) {
        if (code(error) !== 'EEXIST') throw error;
      }
    }
    pins.push(pin(join(parent.path, name)));
  }
  return pins;
}

// `name` under `dir`, created exclusively, 0600; a name already there (a link included) is AlreadyThere.
function writeNew(dir: Pinned, name: string, bytes: Buffer): void {
  still(dir);
  const path = join(dir.path, name);
  let fd: number;
  try {
    fd = openNoLink(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  } catch (error) {
    if (code(error) === 'EEXIST') throw new AlreadyThere(name);
    throw error;
  }
  try {
    for (let at = 0; at < bytes.length; ) at += writeSync(fd, bytes, at);
  } catch (error) {
    closeSync(fd);
    mutate(dir, { unlink: name }); // created by this upload: not left half written
    throw error;
  }
  closeSync(fd);
}

// The files written under `base`, the session's resolved working directory, each under its given name (one `owned`
// owns, so a rollback or a sweep can take it back): the root and the names in order. When one cannot be saved, the files this upload made are removed and
// nothing else. Throws Unsafe (AlreadyThere for a name already there), or an OSError.
export function saveFiles(base: string, session: string, files: readonly { name: string; bytes: Buffer }[], owned: OwnedFiles): { root: string; names: string[] } {
  const pins = walk(base, [...UPLOADS, session], true);
  const [parent, root] = pins.slice(-2) as [Pinned, Pinned];
  const names: string[] = [];
  try {
    for (const file of files) {
      writeNew(root, file.name, file.bytes);
      names.push(file.name);
    }
  } catch (error) {
    clear(parent, root, names, owned);
    throw error;
  }
  return { root: root.path, names };
}

// The owned files `names` (every owned file the root lists, when none are named) removed from the pinned `root`, then
// `root` from its pinned `parent` once it is empty; nothing else, nothing recursed into. Whether everything was taken:
// false when a mutation was refused (a pin that no longer holds, a file that is no regular file).
function clear(parent: Pinned, root: Pinned, names: readonly string[] | undefined, owned: OwnedFiles): boolean {
  let clean = true;
  let listed: string[];
  try {
    listed = names === undefined ? readdirSync(root.path) : [...names];
  } catch {
    return false;
  }
  for (const name of listed.filter((n) => owned.test(n))) {
    try {
      mutate(root, { unlink: name });
    } catch (error) {
      if (code(error) !== 'ENOENT') clean = false; // gone already is taken
    }
  }
  try {
    still(root);
    if (readdirSync(root.path).length === 0) mutate(parent, { rmdir: root });
  } catch (error) {
    if (code(error) !== 'ENOENT') clean = false;
  }
  return clean;
}

// An upload's files removed (every file its lane owns, when none are named), its recorded path walked from `/` without
// following a link, so a link an ancestor became since leads nowhere: whether it is done (a root already gone is). False
// when anything on the way could not be reached safely or a mutation was refused, everything there left.
export function removeFiles(root: string, owned: OwnedFiles, names?: readonly string[]): boolean {
  let pins: Pinned[];
  try {
    pins = walk(dirname(root), [basename(root)]);
  } catch (error) {
    return code(error) === 'ENOENT';
  }
  return clear(pins[0]!, pins[1]!, names, owned);
}

// The upload directories excluded from the repository `base` is in (its common `info/exclude`, which every worktree of
// it reads): true once the line is there, false when `base` is in no repository. Unsafe when `info` or the exclude is a
// link or the exclude no regular file.
export async function excludeUploads(base: string, git: GitRun): Promise<boolean> {
  let common: string;
  try {
    common = (await git(base, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
  } catch (error) {
    if (error instanceof NotARepositoryError) return false;
    throw error;
  }
  if (!isAbsolute(common)) return false;
  const info = walk(realpathSync(common), ['info'], true).at(-1)!;
  // What is there is looked at before it is opened: a socket or a FIFO fails the open itself with an error that is no
  // refusal, so an exclude that is anything but a regular file (or missing) is refused here.
  still(info);
  const there = lstatSync(join(info.path, 'exclude'), { throwIfNoEntry: false });
  if (there !== undefined && (there.isSymbolicLink() || !there.isFile())) throw new Unsafe('the repository’s info/exclude is a link or not a regular file');
  const fd = openNoLink(join(info.path, 'exclude'), constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | constants.O_NONBLOCK, 0o644);
  try {
    if (!fstatSync(fd).isFile()) throw new Unsafe('the repository’s info/exclude is not a regular file');
    const text = readFileSync(fd, 'utf8');
    if (!text.split('\n').includes(EXCLUDE_LINE)) writeSync(fd, `${text === '' || text.endsWith('\n') ? '' : '\n'}${EXCLUDE_LINE}\n`);
  } finally {
    closeSync(fd);
  }
  return true;
}

// ---- the records ------------------------------------------------------------------------------------------------------
type Root = { path: string; session: string; at: string };

export interface UploadRecords {
  record(session: string, root: string): void; // before anything is written under it; throws when it can't be kept
  sweep(): number; // the roots no upload went to for a day removed, and their records: how many (one refused stays)
}

// A lane's record: `{version: 1, roots: [{path, session, at}]}`, 0600, written whole; `at` the last upload to the root.
// Its sweep removes the files `owned` names and nothing else.
export function uploadRecords(file: string, owned: OwnedFiles, { now = Date.now, log }: { now?: () => number; log: (line: string) => void }): UploadRecords {
  const read = (): Root[] => {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown; roots?: unknown };
      if (parsed.version !== 1 || !Array.isArray(parsed.roots)) throw new Error('not version 1');
      return parsed.roots.filter((r): r is Root => typeof r?.path === 'string' && isAbsolute(r.path) && typeof r.session === 'string' && typeof r.at === 'string');
    } catch (error) {
      if (code(error) !== 'ENOENT') log(`${file} could not be read (${error instanceof Error ? error.message : String(error)}); its uploads are not swept`);
      return [];
    }
  };
  const write = (roots: Root[]) => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    atomicWriteFileSync(file, JSON.stringify({ version: 1, roots }));
  };
  return {
    record(session, root) {
      write([...read().filter((r) => r.path !== root), { path: root, session, at: new Date(now()).toISOString() }]);
    },
    sweep() {
      const roots = read();
      const old = roots.filter((r) => now() - Date.parse(r.at) >= SWEEP_AFTER_MS);
      if (old.length === 0) return 0;
      // a root that could not be reached safely, or whose removal was refused, keeps its record for a later pass
      const swept = old.filter((r) => {
        const done = removeFiles(r.path, owned);
        if (!done) log(`${r.path} was not swept: it could not be reached without a link, or held what is not its own; it is tried again later`);
        return done;
      });
      if (swept.length > 0) write(roots.filter((r) => !swept.includes(r)));
      return swept.length;
    },
  };
}
