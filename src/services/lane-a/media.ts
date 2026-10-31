// A local lane A upload (P5 O9 M7, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, M7 and Interfaces §B, §H): the
// images and PDFs the composer serialized, decoded and checked here, saved where a Read of them asks nothing, and handed
// to the bridge's `media` op, which reads each into the conversation by a Read of its own at the main loop's next step.
// The save follows sminos's own rules for a desk upload (doperpowers `sminos/skills/sminos/scripts/sminos_media.py`,
// read for its rules; nothing of it runs here):
//
// - the files go under `<cwd>/.claude/desk-uploads/<engineSessionId>/`, `cwd` the session's live directory as its bridge
//   reads it, resolved, and are reached from `/` following no link: a link anywhere on the way (an ancestor that became
//   one since, `.claude`, `desk-uploads`, the session's directory, a file's own name) refuses the upload rather than
//   redirect the write;
// - each is created exclusively, mode 0600 (directories 0700), as `<upload>.<n>.<ext>`, the extension the one its bytes'
//   signature names (the Read picks image or PDF handling by it); a name already there refuses the upload, and only the
//   files this upload made are taken back;
// - the repository's common `info/exclude` gains `**/.claude/desk-uploads/`, reached the same way, so an upload never
//   shows in `git status`; a linked or irregular exclude refuses the upload (sminos only logs it);
// - each root is recorded in `<userData>/lane-a/uploads.json` before anything is written under it, and swept once no
//   upload has gone to it for a day, its recorded path walked the same way.
//
// Node has no `openat`, so the walk is made per open (../fs/no-link.ts, shared with the files service): on macOS every
// open carries `O_NOFOLLOW_ANY`, which fails the open if any component of the path is a link, atomically; elsewhere
// (Linux) each ancestor is `lstat`ed first, the open carries `O_NOFOLLOW`, which refuses every link present when it
// looks, and the opened descriptor's own path must be the walked one, so a link put above it since is refused at the
// open (an exclusive create through it has made its empty file where the link pointed by then). Nor has it `mkdirat`
// or `unlinkat`, so each directory the walk reaches is pinned by its `dev` and `ino`, and every mutation (a mkdir, an
// unlink, an rmdir) first reopens what it touches the same way and checks it is still that directory, or a regular
// file (`mutate`, below).
import { randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmdirSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import type { ControlResult } from '@shared/ipc/schema/lane-a';
import { atomicWriteFileSync } from '@shared/fs/atomic-write';
import { confirmOpenedSync, LinkOnTheWay, NO_LINK, walkSync, WALKED } from '../fs/no-link';
import { NotARepositoryError, type GitRun } from '../git/runner';
import type { PostResult } from './deliveries';

// DX6 `media`'s types, each with its stored extension.
export const MEDIA_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf' } as const;
export type MediaType = keyof typeof MEDIA_TYPES;
export const FILES_MAX = 4; // the bridge's MEDIA_FILES_MAX
const MiB = 1024 * 1024;
// The composer's own bounds (C3's, the API's per-file limits): the bridge sets none, reading the files by path.
export const BYTES_MAX: Record<MediaType, number> = { 'image/png': 5 * MiB, 'image/jpeg': 5 * MiB, 'image/gif': 5 * MiB, 'image/webp': 5 * MiB, 'application/pdf': 32 * MiB };
export const UPLOADS = ['.claude', 'desk-uploads'] as const; // under the working directory; the session's directory below
export const EXCLUDE_LINE = '**/.claude/desk-uploads/'; // unanchored: a session in a subdirectory of the checkout matches too
export const SWEEP_AFTER_MS = 24 * 3600_000;

// A component of an upload's path that is a link or not a directory, or a file there already: nothing goes through it.
export class Unsafe extends Error {}

export interface DecodedFile {
  name: string; // for display only
  mediaType: MediaType;
  ext: string;
  bytes: Buffer;
}

export function typeOf(bytes: Buffer): MediaType | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  const head = bytes.subarray(0, 12).toString('latin1');
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif';
  if (bytes.length >= 12 && head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp';
  if (head.startsWith('%PDF-')) return 'application/pdf';
  return null;
}

// Standard base64, strictly: no other character, padded as encoded.
function decode(data: string): Buffer | null {
  if (data === '' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null;
  const bytes = Buffer.from(data, 'base64');
  return bytes.length > 0 && bytes.toString('base64') === data ? bytes : null;
}

const sizeOf = (bytes: number) => (bytes >= MiB ? `${Math.ceil(bytes / MiB)} MB` : `${Math.ceil(bytes / 1024)} KB`);

// The upload's files decoded, or why not: one to four, each one of the five types with bytes that are that type, within
// its bound. Checked before anything is written.
export function checkUpload(files: readonly { name: string; mediaType: string; data: string }[]): { ok: true; files: DecodedFile[] } | { ok: false; reason: string } {
  if (files.length < 1 || files.length > FILES_MAX) return { ok: false, reason: `a message takes 1 to ${FILES_MAX} images or PDFs` };
  const out: DecodedFile[] = [];
  for (const file of files) {
    if (!(file.mediaType in MEDIA_TYPES)) return { ok: false, reason: `${file.name} is not a PNG, JPEG, GIF or WebP image or a PDF` };
    const mediaType = file.mediaType as MediaType;
    const bytes = decode(file.data);
    if (bytes === null) return { ok: false, reason: `${file.name} did not arrive as base64 bytes` };
    if (typeOf(bytes) !== mediaType) return { ok: false, reason: `${file.name}'s bytes are not ${mediaType}` };
    if (bytes.length > BYTES_MAX[mediaType]) return { ok: false, reason: `${file.name} is ${sizeOf(bytes.length)}; ${mediaType === 'application/pdf' ? 'a PDF' : 'an image'} can be at most ${BYTES_MAX[mediaType] / MiB} MB` };
    out.push({ name: file.name, mediaType, ext: MEDIA_TYPES[mediaType], bytes });
  }
  return { ok: true, files: out };
}

// MAWS's upload id: 16 random bytes, base64url (the bridge's `[A-Za-z0-9_-]{1,128}`).
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

// Every mutation goes through here: `under` (and `also`, when given) checked to be the very directories the walk pinned,
// reached with no link, and a file to unlink checked to be a regular file reached with no link, immediately before the
// call. What remains is the window between that check and the syscall, which Node cannot close (it has no `mkdirat`,
// `unlinkat` or `unlinkat(AT_REMOVEDIR)`). Its bound: a racer that wins it changes only what is asked here, which is
// the removal of one non-directory entry with an upload's name (`<upload>.<n>.<ext>`, `clear` filters every name),
// checked as a regular file just before but of a type not guaranteed at the syscall (a link, a FIFO or a socket swapped
// in is removed, never followed, its target intact), or of an empty directory; so the worst it reaches is another
// tree's upload-named entries, which the sweep would remove anyway. The uid
// boundary (RL §5.11) alone would not cover it: an engine running sandboxed writes only inside its tree, yet can plant a
// link there and race; the naming filter is what bounds that case. Accepted (the O9 document's Decision Log); rejected:
// a native or Python helper for the `*at` calls, a runtime dependency of main for this bounded race.
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

// `name` under `dir`, created exclusively, 0600; a name already there (a link included) is Unsafe.
function writeNew(dir: Pinned, name: string, bytes: Buffer): void {
  still(dir);
  const path = join(dir.path, name);
  let fd: number;
  try {
    fd = openNoLink(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  } catch (error) {
    if (code(error) === 'EEXIST') throw new Unsafe(`${name} is already there: nothing is written over it`);
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

// The upload's files written under `base`, the session's resolved working directory: its root and the files' names in
// order. When one cannot be saved, the files this upload made are removed and nothing else. Throws Unsafe, or an
// OSError.
export function saveUpload(base: string, session: string, upload: string, files: readonly DecodedFile[]): { root: string; names: string[] } {
  const pins = walk(base, [...UPLOADS, session], true);
  const [parent, root] = pins.slice(-2) as [Pinned, Pinned];
  const names: string[] = [];
  try {
    files.forEach((file, n) => {
      const name = `${upload}.${n}.${file.ext}`;
      writeNew(root, name, file.bytes);
      names.push(name);
    });
  } catch (error) {
    clear(parent, root, names);
    throw error;
  }
  return { root: root.path, names };
}

// An upload's own file name (`<upload>.<n>.<ext>`): the only names a removal ever touches.
const UPLOAD_FILE = /^[A-Za-z0-9_-]{1,128}\.[0-3]\.(?:png|jpg|gif|webp|pdf)$/;

// The upload files `names` (every upload file the root lists, when none are named) removed from the pinned `root`, then
// `root` from its pinned `parent` once it is empty; nothing else, nothing recursed into. Whether everything was taken:
// false when a mutation was refused (a pin that no longer holds, a file that is no regular file).
function clear(parent: Pinned, root: Pinned, names?: readonly string[]): boolean {
  let clean = true;
  let listed: string[];
  try {
    listed = names === undefined ? readdirSync(root.path) : [...names];
  } catch {
    return false;
  }
  for (const name of listed.filter((n) => UPLOAD_FILE.test(n))) {
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

// An upload's files removed (every upload file, when none are named), its recorded path walked from `/` without
// following a link, so a link an ancestor became since leads nowhere: whether it is done (a root already gone is). False
// when anything on the way could not be reached safely or a mutation was refused, everything there left.
export function removeUpload(root: string, names?: readonly string[]): boolean {
  let pins: Pinned[];
  try {
    pins = walk(dirname(root), [basename(root)]);
  } catch (error) {
    return code(error) === 'ENOENT';
  }
  return clear(pins[0]!, pins[1]!, names);
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

// `uploads.json`: `{version: 1, roots: [{path, session, at}]}`, 0600, written whole; `at` the last upload to the root.
export function uploadRecords(file: string, { now = Date.now, log = (line: string) => console.warn(`[lane-a] ${line}`) }: { now?: () => number; log?: (line: string) => void } = {}): UploadRecords {
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
        const done = removeUpload(r.path);
        if (!done) log(`${r.path} was not swept: it could not be reached without a link, or held what is not its own; it is tried again later`);
        return done;
      });
      if (swept.length > 0) write(roots.filter((r) => !swept.includes(r)));
      return swept.length;
    },
  };
}

// ---- the op -----------------------------------------------------------------------------------------------------------
export interface MediaDeps {
  session: string; // the engine session id
  launch: string | null; // the launch the upload was admitted under, carried by every post of it
  post(body: Record<string, unknown>, launch: string | null): Promise<PostResult>;
  records: UploadRecords;
  git: GitRun;
  retryDelaysMs: readonly number[]; // before the second and third posts of a lost one
  log(line: string): void;
}

const refused = (code: string, message: string): ControlResult => ({ state: 'refused', code, message });
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The bridge's answer to a `media` post: held (queued, or a duplicate of an upload it holds), a definite refusal, or
// lost (it may hold it).
function heldOf(posted: PostResult): 'held' | 'lost' | ControlResult {
  if (posted.kind === 'lost' || posted.status === 504 || posted.status === 503) return 'lost';
  const body = posted.body ?? {};
  const result = (body.result ?? {}) as Record<string, unknown>;
  if (posted.status === 200 && body.ok === true && (result.queued === true || result.duplicate === true)) return 'held';
  const message = typeof body.error === 'string' ? body.error : `the bridge answered ${posted.status}`;
  return refused(typeof body.code === 'string' ? body.code : posted.status === 400 ? 'bad-args' : 'refused', message);
}

// One upload, end to end: checked, the session's directory read from its bridge, the root recorded, the exclude entry,
// the save, then the `media` op, retried under the same upload id when its answer is lost (the bridge answers a held
// upload `duplicate`). A refusal of the bridge's takes the files back; a silence leaves them (it may hold them).
export async function sendMedia(deps: MediaDeps, files: readonly { name: string; mediaType: string; data: string }[]): Promise<ControlResult> {
  const checked = checkUpload(files);
  if (!checked.ok) return refused('bad-args', checked.reason);
  // The read is fenced too: an upload admitted under another launch saves nothing.
  const read = await deps.post({ op: 'read', what: 'status' }, deps.launch);
  if (read.kind === 'answer' && typeof read.body?.code === 'string') return refused(read.body.code, typeof read.body.error === 'string' ? read.body.error : `the bridge answered ${read.status}`);
  const cwd = read.kind === 'answer' && read.status === 200 && read.body?.ok === true ? ((read.body.result ?? {}) as Record<string, unknown>).cwd : null;
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return refused('failed', 'the session did not say where it works, so nothing was saved');
  let base: string;
  try {
    base = realpathSync(cwd);
  } catch (error) {
    return refused('failed', `the session’s directory could not be read (${errorText(error)}), so nothing was saved`);
  }
  const upload = uploadId();
  const root = rootOf(base, deps.session);
  try {
    deps.records.record(deps.session, root);
  } catch (error) {
    return refused('failed', `the upload could not be recorded (${errorText(error)}), so nothing was saved`);
  }
  try {
    if (!(await excludeUploads(base, deps.git))) deps.log(`${deps.session}: ${base} is in no repository; its uploads are not excluded from git`);
  } catch (error) {
    if (error instanceof Unsafe) return refused('unsafe', `the upload was not saved: ${error.message}`);
    deps.log(`${deps.session}: ${root} was not excluded from git (${errorText(error)})`);
  }
  let names: string[];
  try {
    names = saveUpload(base, deps.session, upload, checked.files).names;
  } catch (error) {
    return refused(error instanceof Unsafe ? 'unsafe' : 'failed', `the upload was not saved: ${errorText(error)}`);
  }
  const body = { op: 'media', upload, root, files: checked.files.map((f, n) => ({ n, path: join(root, names[n]!), name: f.name, mediaType: f.mediaType })) };
  for (let attempt = 0; attempt <= deps.retryDelaysMs.length; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, deps.retryDelaysMs[attempt - 1]));
    const held = heldOf(await deps.post(body, deps.launch));
    if (held === 'lost') continue;
    if (held === 'held') return { state: 'done', result: { upload, root, paths: body.files.map((f) => f.path) } };
    removeUpload(root, names); // the bridge refused it: nothing holds its files
    return held;
  }
  return { state: 'unknown', why: 'timeout', id: upload };
}
