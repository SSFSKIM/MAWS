// The supervisor's files and the facts both ends read from them (E10 execution document, §Design 1 "The directory",
// "The lock", §Design 6 "Build id"). Everything lives under `<userData>/supervisor/` (mode 0700): `host.sock`,
// `host.lock`, `host.token`, `host.log`, `live.json`, and (P5 O10 M7) `ops.jsonl`, lane B's operation ledger. The lock is the candidate supervisor's, never main's: it is
// created atomically with its content (`link` of a pre-written `host.lock.<pid>`), a live pid is never stale, and a
// stale lock is broken under `host.lock.break` (taken the same way) so two breakers cannot unlink each other's fresh
// locks. Main reads the lock (pid, procStart, socketPath) and the token from here too; nothing in this module touches
// the engine.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as nodeFs from 'node:fs';
import { join } from 'node:path';
import * as z from 'zod';

export const SUPERVISOR_FILES = {
  socket: 'host.sock',
  lock: 'host.lock',
  breaker: 'host.lock.break',
  token: 'host.token',
  log: 'host.log',
  live: 'live.json',
  ops: 'ops.jsonl', // P5 O10 M7: lane B's operation ledger (ops.ts, @shared/host/op-ledger)
} as const;

// Exit codes of a detached engine host: 0 clean, 1 fatal, START_EXIT_HELD when another supervisor holds the lock.
export const START_EXIT_HELD = 3;
export const BREAK_STALE_MS = 10_000; // a break file older than this was left by a breaker that died
export const PID_POLL_MS = 200; // how long a candidate waits for another candidate's break to finish
// `sockaddr_un.sun_path` is 104 bytes on macOS (sys/un.h), one of them the terminating NUL.
export const SOCKET_PATH_MAX_BYTES = 103;

export interface LockFile {
  pid: number;
  procStart: string; // `ps -o lstart=` under LC_ALL=C TZ=UTC; '' when it could not be read at start
  protocol: number;
  buildId: string;
  socketPath: string;
  startedAt: string;
}

// Loose on purpose: a later protocol may add fields, and a lock this build cannot fully read must still never be
// taken for stale while its pid lives. Only pid and procStart decide liveness.
const LockFileSchema = z.looseObject({
  pid: z.number().int().positive(),
  procStart: z.string(),
  protocol: z.number().int(),
  buildId: z.string(),
  socketPath: z.string(),
  startedAt: z.string(),
});

export interface LockDeps {
  fs: Pick<typeof nodeFs, 'writeFileSync' | 'linkSync' | 'unlinkSync' | 'readFileSync' | 'statSync' | 'renameSync'>;
  isAlive(pid: number): boolean;
  procStartOf(pid: number): string | null;
  now(): number;
  sleep(ms: number): Promise<void>;
  pid?: number; // the candidate's own pid; process.pid unless a test plays several candidates in one process
}

const errnoOf = (error: unknown) => (error as NodeJS.ErrnoException).code;

// The lock as written, or null when it is absent or unparseable. P5 O2 M3: `name` for another host's lock (`mawsd`'s).
export function readLock(dir: string, fs: Pick<typeof nodeFs, 'readFileSync'> = nodeFs, name: string = SUPERVISOR_FILES.lock): LockFile | null {
  try {
    return parseLock(fs.readFileSync(join(dir, name), 'utf8'));
  } catch {
    return null;
  }
}

// Whether the process a lock (or a ledger) names is still that process. A pid that is alive is live unless its start
// time is readable and differs from the recorded one (pid reuse); an unreadable or unrecorded start time never makes a
// live pid stale.
export function isSameProcess(record: { pid: number; procStart: string }, deps: Pick<LockDeps, 'isAlive' | 'procStartOf'>): boolean {
  if (!deps.isAlive(record.pid)) return false;
  if (record.procStart === '') return true;
  const current = deps.procStartOf(record.pid);
  return current === null || current === record.procStart;
}

// The lock's and its break file's names inside the directory (P5 O2 M4: another host's, the pty host's or `mawsd`'s).
export interface LockNames {
  lock: string;
  breaker: string;
}

// Takes `<dir>/host.lock` for this candidate: 'taken', or 'held' when a live supervisor holds it, whatever its socket
// does (one between its lock and its listen, or in its exit order, must not lose its files). P5 O2 M4: `names` for
// another host's lock.
export async function takeLock(dir: string, mine: Omit<LockFile, 'pid' | 'procStart' | 'startedAt'>, deps: LockDeps, names: LockNames = SUPERVISOR_FILES): Promise<'taken' | 'held'> {
  const { fs } = deps;
  const pid = deps.pid ?? process.pid;
  const lockPath = join(dir, names.lock);
  const ownPath = join(dir, `${names.lock}.${pid}`);
  const lock: LockFile = { pid, procStart: deps.procStartOf(pid) ?? '', ...mine, startedAt: new Date(deps.now()).toISOString() };
  fs.writeFileSync(ownPath, JSON.stringify(lock), { mode: 0o600 });
  try {
    for (;;) {
      try {
        fs.linkSync(ownPath, lockPath);
        return 'taken';
      } catch (error) {
        if (errnoOf(error) !== 'EEXIST') throw error;
      }
      let raw: string;
      try {
        raw = fs.readFileSync(lockPath, 'utf8');
      } catch (error) {
        if (errnoOf(error) === 'ENOENT') continue; // its holder unlinked it meanwhile: link again
        throw error;
      }
      const holder = parseLock(raw);
      if (holder && isSameProcess(holder, deps)) return 'held';
      if (!breakStale(raw)) await deps.sleep(PID_POLL_MS);
    }
  } finally {
    try {
      fs.unlinkSync(ownPath);
    } catch {
      // already gone
    }
  }

  // Unlinks the stale lock whose content was `staleRaw`, serialised under the break file; false when another candidate
  // holds the break file (the caller waits and retries). The socket file is never touched here.
  //
  // E11 (the stale-break race): the break file is taken as the lock is, by linking a pre-written per-candidate file
  // naming its writer (pid, start time, a nonce), and it is stale once its writer is gone or it is older than
  // BREAK_STALE_MS. A stale one is moved onto a per-candidate name before it is removed, and removed only if what moved
  // is what was judged stale: a fresh file another candidate put there meanwhile is linked back and waited for, so two
  // candidates that judged one dead breaker's file stale together never both break.
  function breakStale(staleRaw: string): boolean {
    const breakPath = join(dir, names.breaker);
    const ownBreak = `${breakPath}.${pid}`;
    const moved = `${breakPath}.${pid}.stale`;
    const own = JSON.stringify({ pid, procStart: lock.procStart, nonce: randomUUID() });
    fs.writeFileSync(ownBreak, own, { mode: 0o600 });
    try {
      for (;;) {
        try {
          fs.linkSync(ownBreak, breakPath);
          break;
        } catch (error) {
          if (errnoOf(error) !== 'EEXIST') throw error;
        }
        const judged = readIfPresent(breakPath);
        if (judged === null) continue; // its breaker finished meanwhile: link again
        if (!breakIsStale(judged, breakPath)) return false;
        try {
          fs.renameSync(breakPath, moved);
        } catch (error) {
          if (errnoOf(error) === 'ENOENT') continue; // another candidate moved it first
          throw error;
        }
        if (fs.readFileSync(moved, 'utf8') !== judged) {
          // a live breaker's fresh file took the stale one's place: put it back (unless a third candidate's is already
          // there) and wait for it
          try {
            fs.linkSync(moved, breakPath);
          } catch (error) {
            if (errnoOf(error) !== 'EEXIST') throw error;
          }
          fs.unlinkSync(moved);
          return false;
        }
        fs.unlinkSync(moved);
      }
      try {
        if (readIfPresent(lockPath) === staleRaw) fs.unlinkSync(lockPath); // still the same stale lock, not a fresh one another took
      } finally {
        if (readIfPresent(breakPath) === own) fs.unlinkSync(breakPath);
      }
      return true;
    } finally {
      fs.unlinkSync(ownBreak);
    }
  }

  // A break file is stale when its writer is gone, or once it is older than BREAK_STALE_MS (a stuck breaker, or one an
  // earlier build left empty).
  function breakIsStale(raw: string, path: string): boolean {
    const writer = parseBreaker(raw);
    if (writer && !isSameProcess(writer, deps)) return true;
    try {
      return deps.now() - fs.statSync(path).mtimeMs > BREAK_STALE_MS;
    } catch (error) {
      if (errnoOf(error) === 'ENOENT') return false; // gone meanwhile: the next link decides
      throw error;
    }
  }

  function readIfPresent(path: string): string | null {
    try {
      return fs.readFileSync(path, 'utf8');
    } catch (error) {
      if (errnoOf(error) === 'ENOENT') return null;
      throw error;
    }
  }
}

const BreakerSchema = z.looseObject({ pid: z.number().int().positive(), procStart: z.string() });
function parseBreaker(raw: string): { pid: number; procStart: string } | null {
  try {
    const parsed = BreakerSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseLock(raw: string): LockFile | null {
  try {
    const parsed = LockFileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// `<dir>/host.sock` when it fits sun_path, else a per-profile directory under the user's tmpdir (never /tmp, which is
// shared). The lock records the path, so a client never computes the fallback itself. P5 O2 M4: `fallback` names another
// host's directory there (`<fallback>-<12 hex of the key's sha1>`), so two hosts of one profile never share one.
export function socketPathFor(dir: string, userData: string, tmpdir: string, fallback: string = 'maws-supervisor'): string {
  const inDir = join(dir, SUPERVISOR_FILES.socket);
  if (Buffer.byteLength(inDir, 'utf8') <= SOCKET_PATH_MAX_BYTES) return inDir;
  const profile = createHash('sha1').update(userData).digest('hex').slice(0, 12);
  return join(tmpdir, `${fallback}-${profile}`, SUPERVISOR_FILES.socket);
}

const buildIds = new Map<string, string>();

// The engine-host entry's content hash: main hashes its `?modulePath` file and the supervisor its `process.argv[1]`, the
// same file in dev or inside app.asar, so one `pnpm build` agrees and a rebuild differs. Cached per process and path.
export function buildIdOf(file: string): string {
  let id = buildIds.get(file);
  if (id === undefined) {
    id = createHash('sha1').update(nodeFs.readFileSync(file)).digest('hex').slice(0, 16);
    buildIds.set(file, id);
  }
  return id;
}

// P5 O2 (the bundle swap): `file`'s build id as the file is on disk now, never cached; null when it is missing or cannot
// be read. A file inside an `app.asar` is read from the archive now at that path: Electron holds each archive it opened,
// header and file handle, for the life of the process (lib/node/asar-fs-wrapper.ts's `cachedArchives`), so an ordinary
// read there answers from the archive this process started with even after the bundle was replaced.
export function currentBuildIdOf(file: string): string | null {
  const archive = /^(.*?\.asar)[/\\](.+)$/.exec(file);
  const asar = process.noAsar;
  process.noAsar = true; // the archive file itself, not the directory Electron's fs makes of it (a no-op in plain Node)
  try {
    const bytes = archive ? readFromArchive(archive[1], archive[2].split(/[/\\]/)) : nodeFs.readFileSync(file);
    return createHash('sha1').update(bytes).digest('hex').slice(0, 16);
  } catch {
    return null;
  } finally {
    process.noAsar = asar;
  }
}

// A file's bytes from an asar archive (@electron/asar's format): two Chromium pickles, the first holding the size of the
// second, which holds the header's JSON; a file's `offset` counts from the header's end, and an unpacked one lies beside
// the archive under `<archive>.unpacked/`.
function readFromArchive(archive: string, inner: string[]): Buffer {
  const fd = nodeFs.openSync(archive, 'r');
  try {
    const read = (length: number, position: number) => {
      const bytes = Buffer.alloc(length);
      if (nodeFs.readSync(fd, bytes, 0, length, position) !== length) throw new Error(`${archive} is shorter than its header says`);
      return bytes;
    };
    const sizes = read(16, 0);
    const headerEnd = 8 + sizes.readUInt32LE(4);
    let entry = JSON.parse(read(sizes.readUInt32LE(12), 16).toString('utf8')) as AsarEntry;
    for (const name of inner) {
      const files = entry.files;
      if (!files || !Object.hasOwn(files, name)) throw new Error(`${archive} holds no ${inner.join('/')}`);
      entry = files[name];
    }
    if (entry.unpacked) return nodeFs.readFileSync(join(`${archive}.unpacked`, ...inner));
    if (typeof entry.size !== 'number' || typeof entry.offset !== 'string') throw new Error(`${inner.join('/')} in ${archive} is not a file`);
    return read(entry.size, headerEnd + Number(entry.offset));
  } finally {
    nodeFs.closeSync(fd);
  }
}

interface AsarEntry {
  files?: Record<string, AsarEntry>;
  size?: number;
  offset?: string;
  unpacked?: boolean;
}

// `process.kill(pid, 0)`: ESRCH is dead; EPERM is a live process of another user.
export function isAlive(pid: number): boolean {
  if (!(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errnoOf(error) === 'EPERM';
  }
}

// A process's start time as C4's holder check reads it (`ps -o lstart=` under LC_ALL=C TZ=UTC); null when ps finds
// no such process or cannot run.
export function procStartOf(pid: number): string | null {
  try {
    const out = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { env: { LC_ALL: 'C', TZ: 'UTC' }, encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] });
    const start = out.trim();
    return start === '' ? null : start;
  } catch {
    return null;
  }
}
