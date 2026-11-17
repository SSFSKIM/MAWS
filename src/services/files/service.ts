// The `files.*` service (C8c execution document, Interfaces "The open-first boundary"; the C8 spec's K1): list, read,
// watch and open a session's own files, every one confined to the session's allowlist (`allowlist.ts`). Beyond it, one
// file at a time and never its folder: a file the session's deliverables name (E2: `read`, `openExternal`, `reveal`), and
// (UX wave U6c, docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md, Interfaces §C) a file the session's own
// transcript links, for `read` and `openExternal` asked with `named` by a caller on this machine (`named.ts` decides).
// Either stands as a root of one for the rest of the boundary; `write`, `list` and `watch` take the roots alone.
//
// UX wave U6e (docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §B, "The write rule"): one
// admission step serves `read`, `openExternal` and `writeOutside`, the save of a file outside the folders, for a request
// on this machine that asks (the key `named`; a save always asks). In order: a grant of the file the person chose
// (`grants`, skipped for an open the agent asked for), the agent's delivery (`sent`), the transcript naming the path by a
// counted form, the grant once more; and, for a request that is no save, a name by a result form only (`result`), then
// any other record of the Library (`added`). The first that holds is the file's mark, which a read answers as `outside`,
// writable for the first three. No write of either command reaches MAWS's own folders (`own`), whatever admits the file.
//
// UX wave U6f (docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, §B): who asks is a caller
// (`FilesCaller`): this machine's own client; another machine's with no claim, whose roots leave out the machine's home
// (P5's Decision Log 237) and which the outside rule never admits; or another machine's under the claim `machine.op`
// made for one of the four outside acts the terminal's offer row admits (`files.readOutside`, `listOutside`,
// `chooseOutside`, `writeOutside`), which reaches the same admission step as this machine's client, over this machine's
// own evidence. Such a caller's read and save walk the path first and refuse it before anything inside a folder macOS
// protects is touched, unless the person opened it (`open`); its listing and its choice walk the same way. Each of its
// saves and choices is a line of the daemon's log (`outsideLog`). A file the deliveries admit, read by another machine
// with the key and no claim, is answered read-only (`why: 'added'`).
//
// The boundary opens before it trusts: a pre-check (step 1) resolves the path to its in-root realpath `real0` and
// refuses a path that ends in a symlink; step 3 opens `real0` with `O_RDONLY | O_NONBLOCK` and no link on its way
// (`O_DIRECTORY` too for a directory; ../fs/no-link.ts: `O_NOFOLLOW_ANY` on macOS, where the kernel refuses a symlink
// anywhere on the path; on Linux an lstat of each ancestor, `O_NOFOLLOW`, and the descriptor's own path confirmed as
// `real0`), so the descriptor names an object reached through `real0`'s own directories; it `fstat`s the descriptor
// (4), confirms the opened object again by a fresh realpath under a root whose `stat` names the descriptor's
// `(dev, ino)` (5), and only then judges its type (5b), so no type is ever named for an object outside. `read` serves
// from the descriptor. `list` and `watch` cannot (Node has no `fdopendir`, and `fs.watch` takes a path), so a listing
// stays private until a confirmation after its last metadata read, and a watch is confirmed after its install and
// before every batch.
//
// The recorded limits, per operation (on Linux too, P5 O3-E: there a link the open followed is refused by the
// descriptor's own path before the descriptor is used, rather than by the kernel): `read` none by race, because the
// open cannot traverse a symlink, so no substitution by symlink is ever followed, and step 5 refuses anything else that
// changed between the open and the confirmation (the reading that step 5 alone closed it was wrong: its `realpath` and
// `stat` are two path steps an ancestor flipping symlink, directory, symlink can straddle; M1 review); hard links
// inside a root, and a directory renamed into a root, are in the tree when opened, accepted by design. `list`: a
// swap-and-restore between `readdir` and the final confirmation can let outside names and metadata (never contents)
// into the answer. `watch`: a swap-and-restore between the install and its confirmation attaches the watcher outside
// until a batch's confirmation catches a standing swap, or forwards outside filenames if it was restored; a swap
// between a batch's confirmation and its per-name `lstat` classifies that batch's kinds from outside metadata.
// `openExternal` is path-checked immediately before `shell.openPath`, with no descriptor guarantee, and hands the OS
// only a regular, non-executable file of a document or media kind (`opensExternally`, an allowlist). E1: `reveal` takes
// the same pre-check and any regular file, since showing a file in Finder runs nothing.
//
// `write` (E5) is `read`'s boundary with a read-write open (and U6e's `writeOutside` shares it): it compares the file's
// hash and writes in place through the confirmed descriptor, never by path, so it shares `read`'s guarantee and never
// creates, renames or replaces a file.
// Its recorded limits: a crash between the truncate and the last write leaves the file truncated (the editor keeps its
// content and stays dirty until `ok`), and the per-file serialisation covers MAWS's own writers only, so an outside
// writer between the compare and the write is not caught (containment is guaranteed, not an atomic compare-and-swap).
import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import fs, { type BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { isNoClient, NO_CLIENT_REASON, type ClientPort } from '@shared/client/port';
import type { ClientRef } from '@shared/ipc/client';
import type { AppSessionId } from '@shared/graph/ids';
import {
  BINARY_SNIFF_BYTES,
  FILES_LIST_MAX_ENTRIES,
  FILES_READ_DEFAULT_LENGTH,
  FILES_READ_MAX_LENGTH,
  FILES_WRITE_MAX_BYTES,
  opensExternally,
  type FilesChanged,
  type FilesEntry,
  type FilesListOutput,
  type FilesOpenExternalOutput,
  type FilesReadInput,
  type FilesReadOutput,
  type FilesReadResolvedInput,
  type FilesWriteInput,
  type FilesWriteOutput,
  type FilesRevealOutput, // E1
  type FilesGrantOutput, // U6e
  type FilesWriteOutsideInput, // U6e
  FILES_MOVED, // U6e
  FILES_PROTECTED, // U6f
  type FilesChooseOutsideInput, // U6f
  type FilesChooseOutsideOutput, // U6f
  type FilesListOutsideInput, // U6f
  type FilesListOutsideOutput, // U6f
} from '@shared/ipc/schema/files';
import { HostCommandError } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import { expandHome, type Home } from '@shared/machine/home-folders';
import { confirmOpened, NO_LINK, walk, WALKED } from '../fs/no-link';
import { ReleaseFences } from '../release-fences';
import { machineHome, machineHomes } from '@shared/machine/machine-home';
import { rootsOf, under, type AllowlistRecord } from './allowlist';
import type { FileGrants } from './grants';
import { fileMime, isTextMime } from './mime';
import type { Naming } from './named';
import { listOutsideFolder, refused as refusedListing, walkOutside } from './outside-list';
import { sameIdentity, WatchTable, type Identity, type Installation } from './watch';

export type BoundaryPoint = 'before-open' | 'after-walk' /* Linux: between the ancestors' walk and the open */ | 'after-open' | 'after-readdir' | 'after-watch-install' | 'before-batch' | 'before-named' /* U6c: before the transcript is asked */ | 'after-read' /* U6b-2: between a raw read's bytes and its second look at the descriptor */ | 'after-outside-walk' /* U6f: between an outside walk and the step that takes its real path */;
export interface BoundaryHooks {
  // Test-only: awaited at each named point, at most once per step, with the path as given (`before-batch` with the
  // watched realpath), so a test can substitute the tree there deterministically. Undefined in the product.
  at?(point: BoundaryPoint, path: string): Promise<void>;
}

export interface FilesServiceOptions {
  records: (appSessionId: AppSessionId) => AllowlistRecord | null; // `SessionReadModel.record` in the product
  hooks?: BoundaryHooks;
  emit?: (payload: FilesChanged) => void; // files.changed
  port?: Pick<ClientPort, 'openExternal' | 'reveal'>; // the client port (OX4): open a file in its viewer; E1: show it in Finder
  env?: NodeJS.ProcessEnv; // MAWS_E2E and MAWS_E2E_OPEN_LOG, the e2e's openExternal (and E1's reveal) seam
  // E2: whether the session's deliverable records name this realpath (main's `DeliverableReader.admitted`), consulted for
  // a path outside the roots by `read`, `openExternal` and `reveal` only (Design §3, Decision Log 18)
  admitted?: (appSessionId: AppSessionId, real: string) => Promise<boolean>;
  // 2026-11-06: the machine's homes as the home-root rule reads them for a remote caller (machineHomes; a suite's fake one)
  homes?: () => readonly string[];
  // UX wave U6c: whether the session's transcript names this path, as the request gave it (`createNamedPaths(...).names`).
  // Asked by `read` and `openExternal` alone, for a request that carries `named`, from this machine, for a path outside the
  // roots that no delivered file admits. Absent: nothing is admitted by name.
  named?: (appSessionId: AppSessionId, path: string, signal?: AbortSignal) => Promise<Naming>;
  // UX wave U6e (docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §B): the grants of chosen files
  // (absent: nothing is chosen, and `grant` is refused); whether the session's agent delivered the file at this real path
  // (absent: nothing is sent); MAWS's own folders, as real paths, which no write reaches (absent: none)
  grants?: Pick<FileGrants, 'add' | 'has'>;
  sent?: (appSessionId: AppSessionId, real: string) => Promise<boolean>;
  own?: () => readonly string[];
  // UX wave U6f (§B): the lines of decision 10, one per ending of a claimed save and choice (absent: none); the daemon
  // user's home and the platform, which the walk of a claimed request reads (only macOS protects folders)
  outsideLog?: (line: string) => void;
  home?: () => string;
  platform?: NodeJS.Platform;
}

/** Who asks: this machine's own client; another machine's with no claim; another machine's under the claim `machine.op` made for the act it runs. */
export type FilesCaller = { remote: false } | { remote: true; claim: null } | { remote: true; claim: { member: string; device: string; opId: string } };
export type FilesClaim = Extract<FilesCaller, { claim: object }>['claim'];
export const THIS_MACHINE: FilesCaller = { remote: false };
export const UNCLAIMED: FilesCaller = { remote: true, claim: null };
const callerOf = (remote: boolean): FilesCaller => (remote ? UNCLAIMED : THIS_MACHINE);
const claimOf = (caller: FilesCaller): FilesClaim | null => (caller.remote ? caller.claim : null);

// E2: what an operation may reach beyond the roots. Only looking at a file (`read`) and handing it to the OS
// (`openExternal`, `reveal`) admit a delivered file; `write`, `list` and `watch` never do, so a file an agent delivered
// from outside is never written through MAWS and the store's version copies are never edited in place. U6c: a file the
// transcript names, for `read` and `openExternal` alone, when the request asks (`Asked`). U6e: `admitOutside`, the outside
// rule (a grant, a delivery, the transcript), for those two and `writeOutside`, whose request always asks (`save`) and
// is never admitted by a result form or an added record.
interface Purpose {
  admitDelivered: boolean;
  admitOutside: boolean;
  save?: true;
}
const ROOTS_ONLY: Purpose = { admitDelivered: false, admitOutside: false };
const DELIVERED_TOO: Purpose = { admitDelivered: true, admitOutside: false };
const DELIVERED_OR_OUTSIDE: Purpose = { admitDelivered: true, admitOutside: true };
const OUTSIDE_SAVE: Purpose = { admitDelivered: false, admitOutside: true, save: true };

// U6c: what the request itself says about a name: whether it asked (`named`), and the signal its wait ends with (its
// client's end, `register.ts`). U6e: whether the agent asked for the open (`agent`), which no grant admits (decision 19).
// U6f: whether the person opened the protected folder the path lies in (`open`), for a claimed caller's walk.
interface Asked {
  named?: boolean;
  agent?: boolean;
  signal?: AbortSignal;
  open?: boolean;
}

// U6e: what admitted a file outside the roots by the outside rule: the person chose it, the agent sent it, the
// transcript names it by a counted form, only by a result form, or another record of the Library points at it. The
// last two admit no save.
type Mark = 'chosen' | 'sent' | 'named' | 'result' | 'added';

// 2026-11-06 (the home-root rule, ./allowlist.ts): `remote`, a request from another machine (the handler context's), whose
// roots leave out the machine's home and anything above it. U6f: where U6e took `remote`, `read`, `writeOutside` and
// `grant` take the caller, absent this machine's own client.
export interface FilesService {
  list(input: { appSessionId: AppSessionId; path?: string }, remote?: boolean): Promise<FilesListOutput>;
  read(input: FilesReadInput, caller?: FilesCaller, signal?: AbortSignal): Promise<FilesReadOutput>; // U6c: `input.named`, answered with `named`; U6b-2: `input.raw`, answered with `identity`, for this machine's caller alone
  // P3-L (M6b fix wave 2): a file at a path main itself resolved (a File artifact's stored file, `library.read`), read as
  // `read` reads one: the path's realpath opened with no symlink anywhere on it, a regular file, the same answer. No
  // session and no roots: the caller's resolution is the admission, and a window never names the path.
  // P5 O7 M5a: `linkFree`, the path must be its own real path (no link anywhere on it) or the read is refused, so a caller
  // that resolved a path inside a directory it owns reads that file and nothing a link leads to (`library.read`'s export).
  readResolved(input: FilesReadResolvedInput, options?: { linkFree?: boolean }): Promise<FilesReadOutput>;
  write(input: FilesWriteInput, remote?: boolean): Promise<FilesWriteOutput>; // E5
  writeOutside(input: FilesWriteOutsideInput, caller?: FilesCaller, signal?: AbortSignal): Promise<FilesWriteOutput>; // U6e; U6f: another machine's under a claim alone
  grant(appSessionId: AppSessionId, path: string, caller?: FilesCaller): Promise<FilesGrantOutput>; // U6e; U6f: another machine's under a claim alone
  listOutside(input: FilesListOutsideInput, caller: FilesCaller): Promise<FilesListOutsideOutput>; // U6f: another machine's under a claim alone
  chooseOutside(input: FilesChooseOutsideInput, caller: FilesCaller): Promise<FilesChooseOutsideOutput>; // U6f: another machine's under a claim alone
  watch(appSessionId: AppSessionId, path: string, owner: string, remote?: boolean): Promise<void>;
  unwatch(appSessionId: AppSessionId, path: string, owner: string): Promise<void>;
  openExternal(appSessionId: AppSessionId, path: string, client: ClientRef | null, asked?: { named?: boolean; agent?: boolean; remote?: boolean; signal?: AbortSignal }): Promise<FilesOpenExternalOutput>; // U6c; U6e: `agent`
  reveal(appSessionId: AppSessionId, path: string, client: ClientRef | null): Promise<FilesRevealOutput>; // E1
  release(owner: string): void; // everything a client holds, when it ends
  watching(): string[];
  dispose(): void;
}

export const FILES_REFUSAL = "path outside the session's directories";

// How many entries of one listing are read (`lstat`, and `readlink` for a link) at once: a directory of thousands of
// names must not start thousands of filesystem calls together.
const LIST_STAT_CONCURRENCY = 64;

const { O_RDONLY, O_RDWR, O_NONBLOCK, O_DIRECTORY } = fs.constants;
// No link on the way (../fs/no-link.ts). macOS 11 and later: O_NOFOLLOW_ANY refuses a symlink anywhere on the path the
// kernel walks, not only in its last component; Node's fs.constants does not carry it, so it is passed through
// numerically, and a test asserts the kernel honours it. It replaces O_NOFOLLOW rather than joining it: macOS answers
// EINVAL for the two together (measured, Node 22.23.2 on macOS 26.6.2), and O_NOFOLLOW_ANY alone refuses a symlink in
// the last component with ELOOP as well. Linux ignores the bit (P5 O3-E M2 fix round 1: `mawsd` serves files there), so
// there the bits are O_NOFOLLOW and the open is walked and confirmed (`openConfirmed`, below).
export { O_NOFOLLOW_ANY } from '../fs/no-link';
export const OPEN_FLAGS = O_RDONLY | O_NONBLOCK | NO_LINK;
// E5's write: the same open read-write, and nothing else: no O_CREAT (the editor edits a file it opened), no O_TRUNC
// (nothing is destroyed before the compare).
const WRITE_FLAGS = O_RDWR | O_NONBLOCK | NO_LINK;

class Refusal extends Error {
  constructor() {
    super(FILES_REFUSAL);
  }
}
// U6e (decision 8): a write that would reach one of MAWS's own folders; U6f: told apart from a file the daemon's user
// may not write by the log's word alone, so it reads as the same message
class OwnFolder extends Error {
  constructor(path: string) {
    super(`not writable: ${path}`);
  }
}
const errno = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

// What steps 1 to 5b leave behind: the open descriptor, its fstat, and the confirmed realpath with its roots.
interface Confirmed {
  handle: FileHandle;
  stat: BigIntStats;
  real: string;
  roots: string[];
  mark: Mark | null; // U6e: what admitted it by the outside rule; null for a root's file and for a delivered one read without the key
}

export function createFilesService({ records, hooks, emit = () => {}, port, env = process.env, admitted /* E2 */, homes = machineHomes, named /* U6c */, grants, sent, own /* U6e */, outsideLog, home = machineHome, platform = process.platform /* U6f */ }: FilesServiceOptions): FilesService {
  const at = async (point: BoundaryPoint, path: string) => {
    await hooks?.at?.(point, path);
  };
  const watches = new WatchTable({ emit, beforeBatch: (real) => at('before-batch', real) });
  // Per confirmed file identity (`dev:ino`), the tail of its writes' chain: two writes of one file (two tabs, two
  // sessions, a hard-link alias) compare and write one after the other. Removed when its chain drains.
  const writing = new Map<string, Promise<void>>();
  const releases = new ReleaseFences<string>(); // per client: an unwatch in flight across its release drops nothing

  // Step 1: absolute, already normal (a `..` is refused before the disk is touched, since the kernel resolves `/X/..`
  // only when `/X` exists) and with no trailing separator (under which `lstat` follows a final-component symlink, so
  // the check below would pass a link to a directory), a known session with at least one resolvable root, and a
  // realpath under one of them. E2: for a purpose that admits delivered files, a realpath outside every root that the
  // session's records name is a root of its own for the rest of the boundary (`under` accepts it as equal), so step 5
  // and every later confirmation hold for exactly that file and nothing beside it. U6c (Interfaces §C) and U6e (§B,
  // `precheck`): for `read`, `openExternal` and `writeOutside` asked by a caller on this machine, a realpath outside every
  // root that the outside rule admits is such a root of one too, with its mark; U6f: for `read` and `writeOutside` asked by
  // another machine's caller under a claim too; any other remote caller never reaches the question, and the transcript is
  // asked at most once, after everything that does not need it.
  async function precheck(appSessionId: AppSessionId, path: string, purpose: Purpose, caller: FilesCaller = THIS_MACHINE, asked: Asked = {}): Promise<{ roots: string[]; real0: string; mark: Mark | null }> {
    if (!isAbsolute(path)) throw new Error('path must be absolute');
    const record = records(appSessionId);
    if (!record) throw new Error(`unknown app session: ${appSessionId}`);
    if (normalize(path) !== path || (path !== sep && path.endsWith(sep))) throw new Refusal();
    let roots = await rootsOf(record, caller.remote ? homes() : undefined); // 2026-11-06: a remote caller's, less the home
    const delivers = purpose.admitDelivered && admitted !== undefined; // E2
    // U6e step 3: whether the outside rule may admit, settled from the request's own context before a grant, the Library
    // or the transcript is touched; U6f: a remote caller only under a claim, which `register.ts` hands the four acts alone
    const outside = purpose.admitOutside && (purpose.save === true || asked.named === true) && (!caller.remote || caller.claim !== null);
    let naming: Naming | undefined;
    const namesIt = async (): Promise<Naming> => {
      if (naming === undefined) {
        await at('before-named', path);
        naming = named === undefined ? false : await named(appSessionId, path, asked.signal);
      }
      return naming;
    };
    const chosen = (real: string) => asked.agent !== true && grants !== undefined && grants.has(appSessionId, real);
    // a session with no resolvable root still reaches the evidence it may have (U6c's Decision Log 14 b)
    const evidence = outside && (named !== undefined || grants !== undefined || sent !== undefined);
    if (roots.length === 0 && !delivers && !evidence) throw new Refusal();
    // U6f (decision 18): another machine's claimed caller touches nothing inside a protected folder the person did not
    // open, before the path is resolved and before any evidence is asked; a path under one of its roots, as written, is
    // the session's own
    const walk = claimOf(caller) !== null && !roots.some((root) => under(root, path)) ? await protectedFirst(path, asked.open === true) : null;
    const walked = walk !== null && 'real' in walk ? walk.real : null;
    if (walked !== null) await at('after-outside-walk', path);
    let real0: string;
    try {
      if (walk !== null && 'gone' in walk) throw walk.gone; // the walk showed the path is not there: nothing resolves it
      real0 = await fs.promises.realpath(path);
    } catch (error) {
      const answer = await missing(path, roots, error);
      // U6c (decision 16), U6e: a granted or named path that is gone says so, as one inside the roots does
      if (answer instanceof Refusal && outside && absent(error) && (chosen(path) || (await namesIt()) !== false)) throw new Error(`not found: ${path}`, { cause: error });
      throw answer;
    }
    // U6f (the architect's ruling on the walk-to-use race): a path that changed between the walk and the resolution is
    // refused as moved, before any evidence is asked and before anything is opened
    if (walked !== null && walked !== real0) throw new Error(FILES_MOVED);
    let mark: Mark | null = null;
    if (!roots.some((root) => under(root, real0))) {
      if (outside) {
        mark = await markOf(real0);
        if (mark === null) throw new Refusal();
      } else if (delivers && (await admitted?.(appSessionId, real0))) {
        // E2: without the key, unmarked; U6f (decision 9): another machine's request with the key, which the outside rule
        // does not admit, is told the file is one it cannot save
        if (caller.remote && asked.named === true) mark = 'added';
      } else throw new Refusal();
      roots = [...roots, real0]; // a root of one
    }
    // P0 opens no symlink (K1): a path that ends in one is refused even when its target lies inside, since step 3
    // opens real0, which is the target.
    const final = await fs.promises.lstat(path).catch(() => null);
    if (!final || final.isSymbolicLink()) throw new Refusal();
    return { roots, real0, mark };

    // U6e step 5: the first evidence that holds, in the order of decision 7. A save whose client ended meanwhile (its
    // signal) is admitted by none of it (S4): the grant asked again after the search would otherwise admit it.
    async function markOf(real: string): Promise<Mark | null> {
      const mark = await firstEvidence(real);
      return purpose.save === true && asked.signal?.aborted === true ? null : mark;
    }
    async function firstEvidence(real: string): Promise<Mark | null> {
      if (chosen(real)) return 'chosen';
      if (sent !== undefined && (await sent(appSessionId, real))) return 'sent';
      const form = await namesIt();
      if (form === 'counted') return 'named';
      if (chosen(real)) return 'chosen'; // a grant made while the transcript was searched
      if (purpose.save === true) return null;
      if (form === 'result') return 'result';
      return delivers && (await admitted?.(appSessionId, real)) ? 'added' : null;
    }
  }

  // U6f (decision 18): the walk of a claimed path that enters no protected folder unopened, answering the real path it
  // ended at. `protected` is refused here, and so, failing closed, is every walk that cannot finish (the branch review,
  // Decision Log 33 (1)): a folder on the way that it cannot list (mode 0111) or a chain of links past its bound leaves
  // what lies beyond unseen, a protected folder included, so nothing resolves the path unchecked after it. One ending
  // alone goes on to the boundary's own steps, with no resolution of its own: a path shown not to be there (`gone`).
  async function protectedFirst(path: string, open: boolean): Promise<{ real: string } | { gone: Error }> {
    const walked = await walkOutside(path, where(), open);
    if (walked.ok) return { real: walked.real };
    const gone = walked.reason === 'protected' ? null : await goneAt(path, open);
    if (gone !== null) return { gone };
    throw new HostCommandError(ipcError('internal', FILES_PROTECTED, { refusal: 'protected' }));
  }
  // Whether `path` is not there, shown by the walk alone: its deepest ancestor the same walk resolves (whose inside the
  // walk found it may touch) holds no entry of the path's next part. The `lstat`'s own failure, or null when the part is
  // there (the walk then could not finish past it) or no ancestor resolves. A protected folder an ancestor's own last link
  // leads into is one the whole path's walk met on its way first, and refused there before this is asked.
  async function goneAt(path: string, open: boolean): Promise<Error | null> {
    const parts = path.split(sep).filter((part) => part !== '');
    for (let depth = parts.length - 1; depth >= 0; depth--) {
      const ancestor = await walkOutside(sep + parts.slice(0, depth).join(sep), where(), open);
      if (!ancestor.ok && ancestor.reason === 'protected') return null;
      if (!ancestor.ok) continue;
      return fs.promises.lstat(join(ancestor.real, parts[depth]!)).then(
        () => null,
        (error: unknown) => (absent(error) ? (error as Error) : null),
      );
    }
    return null;
  }
  const where = (): Home => ({ home: home(), platform });

  // The one open of the service, every descriptor's (`openConfirmed`'s and `readResolved`'s): `real` with no link on
  // its way (../fs/no-link.ts). On Linux its ancestors are walked first, and an ancestor turned into a link between the
  // walk and the open, which the open followed, is refused by the descriptor's own path, closed before anything is read
  // from it or written to it (any failure to confirm it, too). A walk's link is coded ELOOP, a missing ancestor ENOENT,
  // as the open's own would be.
  async function openNoLink(real: string, flags: number, path: string): Promise<FileHandle> {
    if (WALKED) {
      await walk(dirname(real));
      await at('after-walk', path);
    }
    const handle = await fs.promises.open(real, flags);
    try {
      await confirmOpened(handle.fd, real);
    } catch {
      await handle.close();
      throw new Refusal();
    }
    return handle;
  }

  // Steps 2 to 5b for a regular file (`read`; `write` opens it read-write) or a directory (`list`, `watch`). The caller
  // closes the handle.
  async function openConfirmed(appSessionId: AppSessionId, path: string, kind: 'file' | 'write' | 'dir', purpose: Purpose = ROOTS_ONLY, caller: FilesCaller = THIS_MACHINE, asked: Asked = {}): Promise<Confirmed> {
    const { roots, real0, mark } = await precheck(appSessionId, path, purpose, caller, asked);
    await at('before-open', path);
    let handle: FileHandle;
    try {
      // real0 with no link on its way: the descriptor names an object reached through no symlink at all, beneath a root
      // that is itself a realpath, so the open is a containment check of its own and step 5 a second one.
      handle = await openNoLink(real0, kind === 'dir' ? OPEN_FLAGS | O_DIRECTORY : kind === 'write' ? WRITE_FLAGS : OPEN_FLAGS, path);
    } catch (error) {
      // ELOOP (a component of real0 became a symlink), ENOTDIR, EISDIR and the rest: no descriptor exists to confirm,
      // so no type is named; ENOENT says `not found` only under the leak rule. A write refused permission names the
      // path, which step 1 found in-root, so the message leaks nothing.
      const code = errno(error);
      if (kind === 'write' && (code === 'EACCES' || code === 'EPERM')) throw new Error(`not writable: ${path}`, { cause: error });
      throw code === 'ENOENT' ? await missing(path, roots, error) : new Refusal();
    }
    try {
      const stat = await handle.stat({ bigint: true });
      await at('after-open', path);
      const real = await confirm(path, roots, stat);
      if (kind !== 'dir' && !stat.isFile()) throw new Error(`not a regular file: ${path}`);
      if (kind === 'dir' && !stat.isDirectory()) throw new Error(`not a directory: ${path}`);
      return { handle, stat, real, roots, mark };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async function list({ appSessionId, path }: { appSessionId: AppSessionId; path?: string }, remote = false): Promise<FilesListOutput> {
    if (path === undefined) return listRoots(appSessionId, remote);
    const { handle, stat, real, roots } = await openConfirmed(appSessionId, path, 'dir', ROOTS_ONLY, callerOf(remote));
    try {
      const names = await fs.promises.readdir(real).catch(async () => {
        throw await afterConfirmed(path, roots);
      });
      await at('after-readdir', path);
      // Private until the final confirmation below; an entry whose lstat or readlink fails is dropped unnamed.
      const collected = (await mapBounded(names, LIST_STAT_CONCURRENCY, (name) => entryAt(real, name))).filter((entry) => entry !== null);
      await confirm(path, roots, stat);
      const sorted = collected.sort((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || a.name.localeCompare(b.name));
      const root = roots.filter((candidate) => under(candidate, real)).sort((a, b) => b.length - a.length)[0] ?? null;
      return { root, path: real, entries: sorted.slice(0, FILES_LIST_MAX_ENTRIES), truncated: sorted.length > FILES_LIST_MAX_ENTRIES };
    } finally {
      await handle.close();
    }
  }

  async function listRoots(appSessionId: AppSessionId, remote: boolean): Promise<FilesListOutput> {
    const record = records(appSessionId);
    if (!record) throw new Error(`unknown app session: ${appSessionId}`);
    const roots = await rootsOf(record, remote ? homes() : undefined);
    if (roots.length === 0) throw new Refusal();
    const entries = await Promise.all(
      roots.map(async (root): Promise<FilesEntry | null> => {
        const stat = await fs.promises.stat(root).catch(() => null);
        return stat && { name: basename(root) || root, path: root, kind: kindOf(stat), size: stat.size, mtimeMs: stat.mtimeMs, target: null };
      }),
    );
    return { root: null, path: '', entries: entries.filter((entry) => entry !== null), truncated: false };
  }

  async function read({ appSessionId, path, offset = 0, length = FILES_READ_DEFAULT_LENGTH, hash = false, named: asksNamed, agent, raw: asksRaw, open }: FilesReadInput, caller: FilesCaller = THIS_MACHINE, signal?: AbortSignal): Promise<FilesReadOutput> {
    // E2: a delivered file is read; U6c: a named one too, and its every answer says so; U6e: every file the outside rule
    // admits, its every answer saying what it is (`outside`), and a file of MAWS's own saying so for every caller
    const { handle, stat, real, mark } = await openConfirmed(appSessionId, path, 'file', DELIVERED_OR_OUTSIDE, caller, { named: asksNamed, agent, signal, open });
    // U6b-2: a raw read is this machine's caller's alone; another machine's `raw` is passed over, claimed or not
    const answer = await readOpened(handle, stat, real, offset, length, hash, asksRaw === true && !caller.remote ? { path } : null);
    return {
      ...answer,
      ...(mark === null ? {} : { named: true as const, outside: mark === 'result' || mark === 'added' ? { real, writable: false, why: mark } : { real, writable: true } }),
      ...(isOwn(real) ? { own: true as const } : {}),
    };
  }

  // U6e (decision 8): a confirmed real path under one of MAWS's own folders
  function isOwn(real: string): boolean {
    return own !== undefined && own().some((folder) => under(folder, real));
  }

  // P3-L (M6b fix wave 2): see `FilesService.readResolved`.
  async function readResolved({ path, offset = 0, length = FILES_READ_DEFAULT_LENGTH, hash = false }: FilesReadResolvedInput, options: { linkFree?: boolean } = {}): Promise<FilesReadOutput> {
    if (!isAbsolute(path)) throw new Error('path must be absolute');
    let real: string;
    try {
      real = await fs.promises.realpath(path);
    } catch (error) {
      throw errno(error) === 'ENOENT' ? new Error(`not found: ${path}`, { cause: error }) : new Refusal();
    }
    if (options.linkFree && real !== path) throw new Refusal(); // P5 O7 M5a: a link on the way; the open below refuses one made after this
    await at('before-open', path);
    let handle: FileHandle;
    try {
      handle = await openNoLink(real, OPEN_FLAGS, path); // P5 O3-E: read's open, walked and confirmed on Linux (§D)
    } catch (error) {
      throw errno(error) === 'ENOENT' ? new Error(`not found: ${path}`, { cause: error }) : new Refusal();
    }
    let stat: BigIntStats;
    try {
      stat = await handle.stat({ bigint: true });
      await at('after-open', path);
      if (!stat.isFile()) throw new Error(`not a regular file: ${path}`);
    } catch (error) {
      await handle.close();
      throw error;
    }
    return readOpened(handle, stat, real, offset, length, hash);
  }

  // The read itself, over a confirmed descriptor it closes. UX wave U6b-2 (its execution document's M2): a raw read
  // (`raw`, with the path as the request gave it) answers the bytes of exactly the range asked as base64, unsettled,
  // with the descriptor's `identity`; the descriptor's state is read again after the bytes, and a read whose file
  // changed between the two is refused, so one answer never holds bytes of two versions. What passes is a write that
  // leaves all five values as they were (a file system whose times did not move between them).
  async function readOpened(handle: FileHandle, stat: BigIntStats, real: string, offset: number, length: number, hash: boolean, raw: { path: string } | null = null): Promise<FilesReadOutput> {
    try {
      // A hashed read is one read of the descriptor: the whole file into one buffer, hashed, and every byte answered
      // (the chunk, the sniffed head, the settle step's extra bytes, `bytes` itself) taken from that buffer, so the chunk
      // is always the hashed file's even when the file changes meanwhile; `utf8` is a strict decode of that same buffer.
      // Past the cap no hash is answered.
      const whole = hash && Number(stat.size) <= FILES_READ_MAX_LENGTH ? await readWhole(handle, Number(stat.size), FILES_READ_MAX_LENGTH) : null;
      const bytesAt: ByteSource = whole ? async (count, position) => whole.subarray(position, position + count) : (count, position) => readFully(handle, count, position);
      const size = whole ? whole.length : Number(stat.size);
      let chunk = await bytesAt(Math.max(0, Math.min(length, size - offset)), offset);
      const head = offset === 0 && chunk.length >= Math.min(BINARY_SNIFF_BYTES, size) ? chunk.subarray(0, BINARY_SNIFF_BYTES) : await bytesAt(Math.min(BINARY_SNIFF_BYTES, size), 0);
      const mime = fileMime(basename(real), head);
      const encoding = !raw && isTextMime(mime) ? 'utf8' : 'base64';
      if (encoding === 'utf8') chunk = await settleText(bytesAt, chunk, offset, size);
      const identity = raw ? await sameVersion(handle, stat, raw.path) : null;
      return {
        encoding,
        content: chunk.toString(encoding),
        bytes: size,
        offset,
        length: chunk.length,
        truncated: offset + chunk.length < size,
        mime,
        hash: whole ? sha256(whole) : null,
        utf8: whole ? isUtf8(whole) : null,
        ...(identity !== null && { identity }),
      };
    } finally {
      await handle.close();
    }
  }

  // U6b-2: the identity of the version a raw read's bytes are of, once its bytes are read: the descriptor's state then is
  // still the one confirmed before them, else the read is refused.
  async function sameVersion(handle: FileHandle, before: BigIntStats, path: string): Promise<string> {
    await at('after-read', path);
    const identity = identityOf(before);
    if (identityOf(await handle.stat({ bigint: true })) !== identity) throw new Error(`changed while reading: ${path}`);
    return identity;
  }

  // E5's hash-checked save (E5 execution document, Interfaces "The write"): `read`'s boundary opened read-write, then,
  // inside the file's critical section, the compare against the bytes read through the descriptor and the write in
  // place through it (truncate, write every byte, fsync). In place rather than temp-and-rename: a rename is by path into
  // a directory confirmed earlier (the race the boundary closes) and replaces the inode (mode, hard links, xattrs).
  async function write({ appSessionId, path, content, expectedHash }: FilesWriteInput, remote = false): Promise<FilesWriteOutput> {
    const bytes = sized(content);
    return save(await openConfirmed(appSessionId, path, 'write', ROOTS_ONLY, callerOf(remote)), path, bytes, expectedHash);
  }

  // U6e (§B): the save of a file the outside rule admits for a save (or of a root's file), the real path it was shown
  // compared with the one confirmed at the open (write rule, line 3). U6f: another machine's caller only under a claim,
  // each of whose endings is a line of the log
  async function writeOutside({ appSessionId, path, content, expectedHash, real, open }: FilesWriteOutsideInput, caller: FilesCaller = THIS_MACHINE, signal?: AbortSignal): Promise<FilesWriteOutput> {
    if (caller.remote && caller.claim === null) throw new Refusal();
    const saved = async (): Promise<{ answer: FilesWriteOutput; real: string; bytes: number }> => {
      const bytes = sized(content);
      const confirmed = await openConfirmed(appSessionId, path, 'write', OUTSIDE_SAVE, caller, { signal, open: open === true });
      return { answer: await save(confirmed, path, bytes, expectedHash, { real, signal }), real: confirmed.real, bytes: bytes.length };
    };
    const claim = claimOf(caller);
    if (claim === null) return (await saved()).answer;
    const logged = (ending: string) => logOutside(`outside write: ${askedBy(claim, appSessionId)}: ${ending}`);
    try {
      const done = await saved();
      logged(done.answer.status === 'ok' ? `ok ${done.bytes} bytes ${done.real}` : `conflict ${done.real}`);
      return done.answer;
    } catch (error) {
      logged(`refused (${writeRefusalWord(error)}) ${path}`);
      throw error;
    }
  }

  // U6f (decision 10): the daemon's own record of an outside act from another machine, which no failure of it changes;
  // always one line, whatever the path it names holds
  function logOutside(line: string): void {
    try {
      outsideLog?.(oneLine(line));
    } catch {
      // the act's answer stands; the log is the daemon's, and a line it could not take is not the act's to report
    }
  }

  function sized(content: string): Buffer {
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.length > FILES_WRITE_MAX_BYTES) throw new Error('content too large');
    return bytes;
  }

  // The two writes' shared part, over a confirmed read-write descriptor it closes: MAWS's own folders refused (U6e, write
  // rule line 5), the shown real path compared when given, then the file's section. `outside.signal`: the outside
  // save's client end, which refuses the save before the section and again inside it, before anything is written (S4).
  async function save({ handle, stat, real }: Confirmed, path: string, bytes: Buffer, expectedHash: string, outside?: { real: string; signal?: AbortSignal }): Promise<FilesWriteOutput> {
    const tooLarge = () => new Error(`too large to edit: ${path}`);
    const ended = () => {
      if (outside?.signal?.aborted === true) throw new Refusal();
    };
    try {
      if (isOwn(real)) throw new OwnFolder(path);
      if (outside !== undefined && real !== outside.real) throw new Error(FILES_MOVED);
      if (Number(stat.size) > FILES_WRITE_MAX_BYTES) throw tooLarge();
      ended();
      return await exclusive(`${stat.dev}:${stat.ino}`, async () => {
        ended(); // a write of the same file ahead of it may have kept it waiting
        const now = await handle.stat({ bigint: true }); // the cap applies to the size as it is inside the section
        const current = Number(now.size) <= FILES_WRITE_MAX_BYTES ? await readWhole(handle, Number(now.size), FILES_WRITE_MAX_BYTES) : null;
        if (current === null) throw tooLarge();
        const found = sha256(current);
        if (found !== expectedHash) return { status: 'conflict', hash: found };
        await handle.truncate(0);
        for (let written = 0; written < bytes.length; ) {
          written += (await handle.write(bytes, written, bytes.length - written, written)).bytesWritten;
        }
        await handle.sync();
        return { status: 'ok', hash: sha256(bytes) };
      });
    } finally {
      await handle.close();
    }
  }

  // U6e (§B): the record of a file the person chose in main's chooser, by its real path, for this session; a caller on
  // another machine with no claim, and a service given no grants, are refused. U6f: another machine's claimed caller
  // reaches it through `chooseOutside` alone, which hands it the real path its walk ended at.
  async function grant(appSessionId: AppSessionId, path: string, caller: FilesCaller = THIS_MACHINE): Promise<FilesGrantOutput> {
    if (caller.remote && caller.claim === null) throw new Refusal();
    if (!isAbsolute(path)) throw new Error('path must be absolute');
    if (!records(appSessionId)) throw new Error(`unknown app session: ${appSessionId}`);
    if (normalize(path) !== path || (path !== sep && path.endsWith(sep))) throw new Refusal();
    if (grants === undefined) throw new Refusal();
    let real: string;
    try {
      real = await fs.promises.realpath(path);
    } catch (error) {
      throw absent(error) ? new Error(`not found: ${path}`, { cause: error }) : new Refusal();
    }
    const target = await fs.promises.lstat(real).catch(() => null);
    if (!target?.isFile()) return { status: 'refused', reason: 'not-a-file' };
    grants.add(appSessionId, real);
    return { status: 'granted', path: real };
  }

  // U6f (§B, decision 8): one page of one folder of this machine, for another machine's chooser under a claim; this
  // machine's own chooser is the system's
  async function listOutside({ appSessionId, path, open, cursor }: FilesListOutsideInput, caller: FilesCaller): Promise<FilesListOutsideOutput> {
    if (claimOf(caller) === null) throw new Refusal();
    if (!records(appSessionId)) throw new Error(`unknown app session: ${appSessionId}`);
    const named = expandHome(path ?? '~', home());
    if (named === null) return refusedListing('no-folder');
    const walked = await walkOutside(named, where(), open === true);
    if (!walked.ok) return refusedListing(walked.reason === 'protected' ? 'protected' : 'no-folder');
    await at('after-outside-walk', named);
    return listOutsideFolder(walked.real, where(), cursor); // the walk's real path, resolved once
  }

  // U6f (§B, decision 7): the person's pick in another machine's chooser, under a claim: the whole path walked, a last
  // link's target included, then U6e's grant of the real path the walk ended at, and the log's line
  async function chooseOutside({ appSessionId, path, open }: FilesChooseOutsideInput, caller: FilesCaller): Promise<FilesChooseOutsideOutput> {
    const claim = claimOf(caller);
    if (claim === null) throw new Refusal();
    const logged = (ending: string) => logOutside(`outside choice: ${askedBy(claim, appSessionId)}: ${ending}`);
    let answer: FilesChooseOutsideOutput;
    try {
      if (!records(appSessionId)) throw new Error(`unknown app session: ${appSessionId}`);
      const named = expandHome(path, home());
      const walked = named === null ? null : await walkOutside(named, where(), open === true);
      if (walked === null || !walked.ok) answer = { status: 'refused', reason: walked?.ok === false && walked.reason === 'protected' ? 'protected' : 'no-file' };
      else {
        await at('after-outside-walk', path);
        answer = await grant(appSessionId, walked.real, caller); // the walk's real path, not the typed one resolved again
      }
    } catch (error) {
      logged(`refused (other) ${path}`);
      throw error;
    }
    logged(answer.status === 'granted' ? `granted ${answer.path}` : `refused (${answer.reason}) ${path}`);
    return answer;
  }

  // Runs `task` after every earlier task of the same key has settled, and before any later one starts.
  async function exclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const before = writing.get(key) ?? Promise.resolve();
    let leave!: () => void;
    const done = new Promise<void>((resolve) => (leave = resolve));
    const tail = before.then(() => done);
    writing.set(key, tail);
    await before;
    try {
      return await task();
    } finally {
      leave();
      if (writing.get(key) === tail) writing.delete(key);
    }
  }

  async function watch(appSessionId: AppSessionId, path: string, owner: string, remote = false): Promise<void> {
    const { handle, stat, real, roots } = await openConfirmed(appSessionId, path, 'dir', ROOTS_ONLY, callerOf(remote));
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

  async function openExternal(appSessionId: AppSessionId, path: string, client: ClientRef | null, asked: { named?: boolean; agent?: boolean; remote?: boolean; signal?: AbortSignal } = {}): Promise<FilesOpenExternalOutput> {
    // E2: a delivered file opens outside wherever it lives; U6c: a named one too, for a caller on this machine; U6e: every
    // file the outside rule admits for a read
    const { real0 } = await precheck(appSessionId, path, DELIVERED_OR_OUTSIDE, callerOf(asked.remote === true), { named: asked.named, agent: asked.agent, signal: asked.signal });
    // "Open externally" shows a document in its viewer; it never runs a program an agent wrote into the tree. The
    // object is admitted (step 1), so naming it in the message leaks nothing.
    const target = await fs.promises.lstat(real0).catch(() => null);
    if (!target || !target.isFile() || (target.mode & 0o111) !== 0 || !opensExternally(basename(real0))) {
      throw new Error(`not opened outside MAWS: ${path}`);
    }
    if (env.MAWS_E2E === '1' && env.MAWS_E2E_OPEN_LOG) {
      await fs.promises.appendFile(env.MAWS_E2E_OPEN_LOG, `${real0}\n`);
      return { opened: true, message: null };
    }
    if (!port) throw new Error('files.openExternal has no opener');
    const answer = await port.openExternal(client, { path: real0 });
    if (isNoClient(answer)) return { opened: false, message: NO_CLIENT_REASON };
    return answer.opened ? { opened: true, message: null } : { opened: false, message: answer.reason };
  }

  // E1 start: Reveal in Finder for a delivered file. A refusal is an answer (`revealed: false` and why), not a thrown error.
  async function reveal(appSessionId: AppSessionId, path: string, client: ClientRef | null): Promise<FilesRevealOutput> {
    let real0: string;
    try {
      ({ real0 } = await precheck(appSessionId, path, DELIVERED_TOO)); // E2
      const target = await fs.promises.lstat(real0).catch(() => null);
      if (!target?.isFile()) throw new Error(`not a file: ${path}`);
    } catch (error) {
      return { revealed: false, message: error instanceof Error ? error.message : String(error) };
    }
    if (env.MAWS_E2E === '1' && env.MAWS_E2E_OPEN_LOG) {
      await fs.promises.appendFile(env.MAWS_E2E_OPEN_LOG, `reveal ${real0}\n`);
      return { revealed: true, message: null };
    }
    if (!port) throw new Error('files.reveal has no Finder');
    return isNoClient(await port.reveal(client, real0)) ? { revealed: false, message: NO_CLIENT_REASON } : { revealed: true, message: null };
  }
  // E1 end

  return {
    list,
    read,
    readResolved, // P3-L (M6b fix wave 2)
    write,
    writeOutside, // U6e
    grant, // U6e
    listOutside, // U6f
    chooseOutside, // U6f
    watch,
    // the hold on the directory the path names now (the realpath a watch of it would be keyed by), else the first found;
    // a release of the window meanwhile (a navigation) took the page's holds, and a hold under the same key is the new
    // page's, so an unwatch that straddled it drops nothing
    unwatch: (appSessionId, path, owner) =>
      releases.hold(owner, async (released) => {
        const real = isAbsolute(path) ? await fs.promises.realpath(path).catch(() => null) : null;
        if (released()) return;
        watches.unwatch({ owner, appSessionId, path }, real);
      }),
    openExternal,
    reveal, // E1
    release: (owner) => {
      releases.release(owner);
      watches.release(owner);
    },
    watching: () => watches.watching(),
    dispose: () => watches.dispose(),
  };
}

// UX wave U6b-2 (Interfaces §B): the version of a file as an opened descriptor knows it. The change time joins the four
// other values because a writer can set a modification time back and cannot set a change time.
export const identityOf = (stat: BigIntStats): string => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;

// UX wave U6f (decision 10): a line of the log as one line. A POSIX name may hold any character but `/` and NUL, a line
// ending included, so each control character is escaped (`\n`, `\r`, any other `\xNN`) and a path cannot end its line
// and write one of its own; a line with none reads as written
const oneLine = (line: string): string => line.replace(/\p{Cc}/gu, (char) => (char === '\n' ? '\\n' : char === '\r' ? '\\r' : `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`));

// UX wave U6f (decision 10): who a line of the log is for, the claim's own (the member and device the endpoint proved)
const askedBy = (claim: FilesClaim, appSessionId: AppSessionId): string => `member ${claim.member} device ${claim.device} session ${appSessionId} op ${claim.opId}`;

// UX wave U6f (decision 10): the word a refused save's line gives for why: outside the rule, MAWS's own, moved since it
// was shown, gone, not the daemon user's to write, in a protected folder not opened, or anything else
function writeRefusalWord(error: unknown): string {
  if (error instanceof Refusal) return 'outside';
  if (error instanceof OwnFolder) return 'own';
  if (error instanceof HostCommandError) return (error.ipcError.issues as { refusal?: unknown } | undefined)?.refusal === 'protected' ? 'protected' : 'other';
  const message = error instanceof Error ? error.message : '';
  if (message === FILES_MOVED) return 'moved';
  if (message.startsWith('not found: ')) return 'missing';
  if (message.startsWith('not writable: ')) return 'not-writable';
  return 'other';
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

// `items.map(fn)` with at most `limit` calls of `fn` pending at once, the answers in the items' order.
async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const answers = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      answers[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return answers;
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
  if (absent(error) && (await missingWithin(path, roots))) return new Error(`not found: ${path}`);
  return new Refusal();
}
// A failure that says nothing is there: no such name, or a component of the path that is not a directory
const absent = (error: unknown) => errno(error) === 'ENOENT' || errno(error) === 'ENOTDIR';

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

// Bytes of one file at a position: from the descriptor (`readFully`), or from a buffer a hashed read already holds.
type ByteSource = (length: number, position: number) => Promise<Buffer>;

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// The whole file from the descriptor's start to its end, `expected` (its fstat size) a hint: a file grown since is read
// to its new end, and one that holds more than `cap` bytes answers null.
async function readWhole(handle: FileHandle, expected: number, cap: number): Promise<Buffer | null> {
  const first = await readFully(handle, expected + 1, 0);
  if (first.length <= expected) return first;
  const rest = await readFully(handle, cap + 1 - first.length, first.length);
  const whole = Buffer.concat([first, rest]);
  return whole.length > cap ? null : whole;
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
async function settleText(bytesAt: ByteSource, chunk: Buffer, offset: number, size: number): Promise<Buffer> {
  const more = (page: Buffer) => offset + page.length < size;
  if (!more(chunk)) return chunk;
  const cut = utf8Cut(chunk);
  if (cut.missing > 0) {
    chunk = cut.end > 0 ? chunk.subarray(0, cut.end) : Buffer.concat([chunk, await bytesAt(Math.min(cut.missing, size - offset - chunk.length), offset + chunk.length)]);
  }
  if (more(chunk) && chunk.at(-1) === 0x0d) {
    if (chunk.length > 1) return chunk.subarray(0, -1);
    const next = await bytesAt(1, offset + 1);
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
