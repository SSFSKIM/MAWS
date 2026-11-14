// Projects and the membership rule (C4 execution document, Interfaces "Index", *Project membership rule*, as amended by
// its Decision Log on 2026-10-01). A session belongs to the project whose directory equals the realpath of its effective
// directory, or whose `<directory>/.claude/worktrees/<name>` contains it, or whose checkout owns the linked git worktree
// containing it (in both worktree cases its record carries the worktree). Discovery creates a project (origin
// `discovered`, named by the basename) for an existing directory with a session that has messages; a directory that no
// longer exists has no project ("Other sessions"); a removed project is hidden and keeps its id, so rediscovery never
// resurrects it. C5's `ProjectRecord` is the row projected.
import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve as resolvePath, sep } from 'node:path';
import type { ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectOrg, ProjectRecord } from '@shared/ipc/schema/session';
import { branchName } from '@shared/sessions/branch';
import { indexTopLevelFiles, type TopLevelFile } from '@shared/machine/git-index';
import { discoverRepo, GitLayoutError, worktreeList, type GitFiles } from '@shared/machine/git-reads';
import type { OrgKey } from '@shared/machine/org-key';
import type { Anchor, DeclaredRow, KeptStatement } from '@shared/machine/registry';
import { slugOf } from '../../engine-host/fs/paths';
import { gitBinary, gitEnv } from '../git/runner';
import { readFolder, sameFolder } from './anchor';
import type { Db } from './db';
import type { RemoteReads } from './org-project';

interface ProjectRow {
  id: string;
  directory: string;
  name: string;
  slug: string;
  origin: 'user' | 'discovered';
  hidden: number;
  sort_order: number;
  created_at: string;
  last_activity_at: string | null;
  org_key: string | null; // P5 O6 M5: the org project as derived (migration 13), null until it is
  org_name: string | null;
  org_source: ProjectOrg['source'] | null;
  org_smns_id: string | null;
  // the project registry (Interfaces §F.1; ADDED_COLUMNS)
  stated_minted: string | null;
  stated_linked: string | null;
  anchor: string | null; // JSON Anchor
  name_rev: number | null;
  location_state: 'missing' | 'replaced' | null;
  org_remote: string | null;
  org_hub: number | null; // 0: a `.smns` naming no hub of the org decides
  org_by: string | null; // how the rule last decided (OrgDerivation['by']), on an enrolled machine
  org_at: string | null; // the folder that decided
}

export type Origin = ProjectRow['origin'];

// Where a directory lands: its realpath (null when it does not exist), the project directory it belongs under, and the
// worktree root when it lies inside `<project>/.claude/worktrees/<name>` or inside a linked worktree of the project's
// checkout.
export interface Location {
  realpath: string | null;
  projectDirectory: string | null;
  worktreePath: string | null;
}

const WORKTREE = /^(.+)\/\.claude\/worktrees\/([^/]+)(?:\/.*)?$/;
const GIT_TIMEOUT_MS = 2_000;
const WARM_CONCURRENCY = 4; // git calls the warm-up keeps in flight
const EVIDENCE_FILES = 4; // top-level files of HEAD read for content evidence, smallest first
const EVIDENCE_BYTES = 256 * 1024; // the largest one read

const LIST = ['worktree', 'list', '--porcelain', '-z'];
const TREE = ['ls-tree', '-z', 'HEAD'];
const TOP_LEVEL_FILE = /^(?:100644|100755) blob ([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/s;

type LinkedWorktree = { main: string; root: string };

// One git call with the git service's binary and environment; null when git cannot answer (not a repository, git
// missing, timed out). `locate` runs it synchronously (discovery locates inside its database transactions); the warm-up
// runs it in a child process main does not wait on.
function gitOutput(directory: string, args: string[]): string | null {
  try {
    return execFileSync(gitBinary(process.env), ['-C', directory, ...args], {
      env: gitEnv(process.env),
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function gitOutputAsync(directory: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(gitBinary(process.env), ['-C', directory, ...args], { env: gitEnv(process.env), encoding: 'utf8', timeout: GIT_TIMEOUT_MS }, (error, stdout) =>
      resolve(error ? null : stdout),
    );
  });
}

const canonical = (path: string) => realpathSync.native(path).normalize('NFC');
const exists = (path: string) => lstatSync(path, { throwIfNoEntry: false }) !== undefined;

// The main checkout of the linked worktree whose root is `root`, or null when `root` is no linked worktree of one. Git
// lists the main worktree first, but it derives that path from the common dir (the common dir's parent when it is named
// `.git`, else the common dir itself), so the answer is checked rather than taken. `root` must be one of the linked
// entries: a submodule or a checkout with a separate git dir is the main worktree of its own repository, which git then
// names after the git dir. The repository must not be bare. And the directory git names must hold a `.git` and the work
// tree (`holdsHead`): a separate git dir named `.git` makes git name that dir's parent, which may hold anything, files
// named like the checkout's included, and the real checkout is recorded nowhere git can read, so such a worktree stays a
// directory of its own rather than folding under the wrong one.
export function mainWorktree(root: string): string | null {
  const main = listedMain(root, gitOutput(root, LIST));
  return main !== null && holdsHead(main, treeFiles(gitOutput(main, TREE))) ? main : null;
}

// `mainWorktree` off main's thread; `holdsHeadOf` runs `holdsHead` over the main checkout's tree, once per warm-up.
async function mainWorktreeAsync(root: string, holdsHeadOf: (main: string) => Promise<boolean>): Promise<string | null> {
  const main = listedMain(root, await gitOutputAsync(root, LIST));
  return main !== null && (await holdsHeadOf(main)) ? main : null;
}

// The directory `git worktree list` names as the main worktree, realpathed, when `root` is one of its linked entries,
// the repository is not bare and that directory holds a `.git`.
function listedMain(root: string, listed: string | null): string | null {
  if (listed === null) return null;
  const entries: { path: string; bare: boolean }[] = [];
  for (const line of listed.split('\0')) {
    if (line.startsWith('worktree ')) entries.push({ path: line.slice('worktree '.length), bare: false });
    else if (line === 'bare' && entries.length > 0) entries[entries.length - 1].bare = true;
  }
  const isRoot = (path: string) => {
    try {
      return canonical(path) === root;
    } catch {
      return false; // a linked worktree whose directory is gone
    }
  };
  const [first, ...linked] = entries;
  if (first === undefined || first.bare || !linked.some((entry) => isRoot(entry.path))) return null;
  let main: string;
  try {
    main = canonical(first.path);
  } catch {
    return null; // a main checkout that is gone
  }
  return exists(join(main, '.git')) ? main : null;
}

// Whether `main` holds HEAD's work tree, judged by content, never by names: at least one regular top-level file has
// exactly the bytes HEAD records for its path (git's blob id, the hash of `blob <size>\0` and the bytes; SHA-256 in a
// SHA-256 repository). The smallest few non-empty files are read (an empty one matches any empty file of its name), each
// at most EVIDENCE_BYTES. Every doubt answers no: a checkout whose top-level files are all edited, or whose HEAD tracks
// none, stays apart, as every linked worktree did before the fold.
function holdsHead(main: string, tree: TopLevelFile[] | null): boolean {
  if (tree === null) return false;
  const candidates: { path: string; id: string; size: number }[] = [];
  for (const { name, id } of tree) {
    if (!isBasename(name)) continue;
    const path = join(main, name);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat?.isFile() && stat.size > 0 && stat.size <= EVIDENCE_BYTES) candidates.push({ path, id, size: stat.size });
  }
  candidates.sort((a, b) => a.size - b.size);
  return candidates.slice(0, EVIDENCE_FILES).some(({ path, id }) => {
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch {
      return false; // gone or unreadable since the stat
    }
    return createHash(id.length === 64 ? 'sha256' : 'sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === id;
  });
}

// A name that is one entry of the folder it is joined to, never a way out of it.
const isBasename = (name: string) => name !== '' && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\0');

// `holdsHead` with every stat and read through the walk (a remote setup's, before trust; `mainWorktreeRead`).
async function holdsHeadRead(main: string, tree: TopLevelFile[] | null, files: GitFiles): Promise<boolean> {
  if (tree === null) return false;
  const candidates: { path: string; id: string; size: number }[] = [];
  for (const { name, id } of tree) {
    if (!isBasename(name)) continue;
    const path = join(main, name);
    const size = await files.fileSize(path);
    if (size !== null && size > 0 && size <= EVIDENCE_BYTES) candidates.push({ path, id, size });
  }
  candidates.sort((a, b) => a.size - b.size);
  for (const { path, id } of candidates.slice(0, EVIDENCE_FILES)) {
    const bytes = await files.read(path, EVIDENCE_BYTES);
    if (bytes !== null && createHash(id.length === 64 ? 'sha256' : 'sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === id) return true;
  }
  return false;
}

// HEAD's regular top-level files as `ls-tree -z HEAD` lists them; null when git gave no answer.
function treeFiles(tree: string | null): TopLevelFile[] | null {
  if (tree === null) return null;
  return tree.split('\0').flatMap((entry) => {
    const match = TOP_LEVEL_FILE.exec(entry);
    return match === null ? [] : [{ name: match[2], id: match[1] }];
  });
}

// Each directory's linked-worktree answer for the life of the process (null: not inside one). Discovery locates once per
// transcript summary, thousands of times over a few hundred directories, so git runs at most once per directory; a
// failure is remembered too, so a git that hangs costs its timeout once rather than on every summary. The first answer
// stays: `warmLinkedWorktrees` never replaces one `locate` computed meanwhile.
const linkedWorktrees = new Map<string, LinkedWorktree | null>();

// `mainWorktreeOf` is the seam a test counts git calls through; whichever call filled the cache, its answers are the
// cache's.
export function locate(directory: string | null, mainWorktreeOf: (root: string) => string | null = mainWorktree): Location {
  if (directory === null || directory === '') return { realpath: null, projectDirectory: null, worktreePath: null };
  let realpath: string;
  try {
    realpath = canonical(directory);
  } catch {
    return { realpath: null, projectDirectory: null, worktreePath: null };
  }
  const worktree = WORKTREE.exec(realpath);
  if (worktree) {
    // A managed worktree made inside a linked worktree (the engine makes them under whichever checkout it runs in)
    // belongs to the main checkout too, or it would bring the linked worktree back as a project of its own.
    const projectDirectory = linkedWorktree(worktree[1], mainWorktreeOf)?.main ?? worktree[1];
    return { realpath, projectDirectory, worktreePath: `${worktree[1]}/.claude/worktrees/${worktree[2]}` };
  }
  const linked = linkedWorktree(realpath, mainWorktreeOf);
  if (linked) return { realpath, projectDirectory: linked.main, worktreePath: linked.root };
  return { realpath, projectDirectory: realpath, worktreePath: null };
}

// P4 W2-B (tracker 2026-10-07 "The index sync's warm-up queue…"): whether `locate(directory)` answers without git: no
// directory, one that is gone, or one whose answer the cache holds. A directory never asked about reads no, though its
// answer may need no git either (no `.git` file above it): the reading that costs one realpath.
export function locatesWithoutGit(directory: string | null): boolean {
  if (directory === null || directory === '') return true;
  let realpath: string;
  try {
    realpath = canonical(directory);
  } catch {
    return true;
  }
  return linkedWorktrees.has(WORKTREE.exec(realpath)?.[1] ?? realpath);
}

function linkedWorktree(directory: string, mainWorktreeOf: (root: string) => string | null): LinkedWorktree | null {
  let answer = linkedWorktrees.get(directory);
  if (answer === undefined) linkedWorktrees.set(directory, (answer = findLinkedWorktree(directory, mainWorktreeOf)));
  return answer;
}

function findLinkedWorktree(directory: string, mainWorktreeOf: (root: string) => string | null): LinkedWorktree | null {
  try {
    const root = candidateRoot(directory);
    const main = root === null ? null : mainWorktreeOf(root);
    return root === null || main === null ? null : { main, root };
  } catch {
    return null; // a directory that cannot be read: no fold
  }
}

// Answers the linked-worktree question for `directories` with git in child processes, WARM_CONCURRENCY at a time, so
// that a later `locate` of each reads the cache instead of blocking main on git (`IndexSessionSource.start` warms the
// visible projects' directories before its refold). Each main checkout's content is checked once per warm-up.
export async function warmLinkedWorktrees(directories: Iterable<string>): Promise<void> {
  const asked = new Set<string>();
  for (const directory of directories) {
    try {
      const realpath = canonical(directory);
      asked.add(WORKTREE.exec(realpath)?.[1] ?? realpath); // the directory `locate` asks about
    } catch {
      // gone: `locate` answers it without the cache
    }
  }
  const queue = [...asked];
  const checked = new Map<string, Promise<boolean>>();
  const holdsHeadOf = (main: string) => {
    let answer = checked.get(main);
    if (answer === undefined) checked.set(main, (answer = gitOutputAsync(main, TREE).then((tree) => holdsHead(main, treeFiles(tree)))));
    return answer;
  };
  const worker = async () => {
    for (let directory = queue.shift(); directory !== undefined; directory = queue.shift()) {
      if (linkedWorktrees.has(directory)) continue;
      let answer: LinkedWorktree | null = null;
      try {
        const root = candidateRoot(directory);
        const main = root === null ? null : await mainWorktreeAsync(root, holdsHeadOf);
        if (root !== null && main !== null) answer = { main, root };
      } catch {
        // a directory that cannot be read: no fold
      }
      if (!linkedWorktrees.has(directory)) linkedWorktrees.set(directory, answer);
    }
  };
  await Promise.all(Array.from({ length: WARM_CONCURRENCY }, worker));
}

// P5 O7 M9 round 2: a remote setup's registration, before the folder's trust is accepted, answers the linked-worktree
// question with no git run in it: what `mainWorktree` asks git is read from git's files (src/shared/machine/git-reads.ts,
// git-index.ts), each through the home's walk, a config's include never followed. The content check's evidence is the
// main checkout's index rather than HEAD's tree (round 3: no object store is read): the same answer but for a main
// checkout whose smallest top-level files are staged and not committed. The answer fills the cache, so the
// `locate` that follows asks git nothing; one already there stays. A read the walk refuses throws; any other doubt
// answers no fold, as a git that cannot answer does.
export async function warmLinkedWorktreeRead(directory: string, files: GitFiles): Promise<void> {
  const realpath = canonical(directory);
  const asked = WORKTREE.exec(realpath)?.[1] ?? realpath;
  if (linkedWorktrees.has(asked)) return;
  let root: string | null;
  try {
    root = candidateRoot(asked);
  } catch {
    root = null; // a directory that cannot be read: no fold
  }
  const main = root === null ? null : await mainWorktreeRead(root, files);
  if (!linkedWorktrees.has(asked)) linkedWorktrees.set(asked, root === null || main === null ? null : { main, root });
}

// `mainWorktree`'s answer from git's files: the listing's main worktree when `root` is one of its linked entries, the
// repository is not bare, the main worktree holds a `.git` and the work tree its index records (`holdsHead`).
async function mainWorktreeRead(root: string, files: GitFiles): Promise<string | null> {
  const realOf = async (path: string) => (await files.real(path))?.normalize('NFC') ?? null;
  try {
    const repo = await discoverRepo(root, files);
    if (repo === null) return null;
    const [first, ...linked] = await worktreeList(repo, files);
    if (first === undefined || first.bare) return null;
    let listed = false;
    for (const entry of linked) {
      listed = (await realOf(entry.path)) === root;
      if (listed) break;
    }
    const main = listed ? await realOf(first.path) : null;
    if (main === null || (await files.entry(join(main, '.git'))) === null) return null;
    const own = await discoverRepo(main, files);
    return own !== null && (await holdsHeadRead(main, await indexTopLevelFiles(own, files), files)) ? main : null;
  } catch (error) {
    if (error instanceof GitLayoutError) return null; // where git refuses the layout, it answers nothing
    throw error;
  }
}

// The nearest `.git` decides, as it does for git itself: a directory is a main checkout's, which folds nowhere and needs
// no git call; a file is a linked worktree's or a submodule's (or a checkout's with a separate git dir), which only git
// tells apart (`mainWorktree`). The root holding that file, else null; throws when an ancestor cannot be read.
function candidateRoot(directory: string): string | null {
  for (let root = directory; ; root = dirname(root)) {
    const entry = lstatSync(join(root, '.git'), { throwIfNoEntry: false });
    if (entry !== undefined) return entry.isFile() ? root : null;
    if (dirname(root) === root) return null;
  }
}

// UX wave U8c-2 (docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md, §B): which repository a folder is
// in, read from git's own files with no git run, as `locate`'s reads are synchronous (the index applies summaries inside
// its transactions). Two folders are in the same repository when their common git directory is the same; the work tree
// is the folder that holds the nearest `.git`. It mirrors only this much of git: no `core.worktree`, no bare repository,
// no mount boundary. It is the files admission's predicate read once, when the record's facts are written; what may be
// read, written or listed there is decided again at each act, with git's fuller reader (src/shared/machine/git-reads.ts).
export interface Repository {
  commonDir: string; // each path a realpath
  workTree: string;
  linked: boolean;
}

// The nearest `.git` at or above the folder's realpath. A directory: the main checkout's. A file `gitdir: <G>`: a linked
// worktree's when `<G>/commondir` names another directory, which counts only while `<G>/gitdir` names this file back
// (a copy of a worktree's pointer is in no repository); otherwise a submodule's or a separate git dir's, its own. None up
// to the root, or anything unreadable: null.
export function repositoryAt(folder: string): Repository | null {
  try {
    for (let root = canonical(folder); ; root = dirname(root)) {
      const dotGit = join(root, '.git');
      const entry = lstatSync(dotGit, { throwIfNoEntry: false });
      if (entry?.isDirectory()) return { commonDir: canonical(dotGit), workTree: root, linked: false };
      if (entry?.isFile()) return pointedRepository(root, dotGit);
      if (entry !== undefined || dirname(root) === root) return null;
    }
  } catch {
    return null;
  }
}

function pointedRepository(workTree: string, dotGit: string): Repository | null {
  const gitDir = canonical(resolvePath(workTree, pointer(dotGit, 'gitdir: ')));
  const named = optionalPointer(join(gitDir, 'commondir'));
  const commonDir = named === null ? gitDir : canonical(resolvePath(gitDir, named));
  const linked = commonDir !== gitDir;
  if (linked) {
    const back = optionalPointer(join(gitDir, 'gitdir'));
    if (back === null || canonical(resolvePath(gitDir, back)) !== canonical(dotGit)) return null;
  }
  return { commonDir, workTree, linked };
}

// A pointer file's one line, less `prefix`; throws when it is not one. Only a regular file is opened (its type read
// first, links followed, without an open): these reads run inside the index's transaction, where opening a FIFO would
// block for ever, so anything else is unreadable metadata (the branch review's P2).
function pointer(path: string, prefix = ''): string {
  if (!statSync(path).isFile()) throw new Error(`not a regular file: ${path}`);
  const line = readFileSync(path, 'utf8').split('\n')[0].trimEnd();
  if (!line.startsWith(prefix) || line.length === prefix.length) throw new Error(`not a pointer: ${path}`);
  return line.slice(prefix.length);
}

const optionalPointer = (path: string): string | null => (exists(path) ? pointer(path) : null);

// Where the agent's folder sits for a session launched in `launch` (a realpath): its checkout (the launch folder itself
// inside the launch folder's own work tree, else the root of the work tree the folder is in), the folder's realpath, that
// work tree, and whether it is a linked worktree. Null for a folder that does not resolve, is in another repository, or
// is in none under a launch folder that is in one. "At or under" is at a segment boundary. `repositoryOf` is how a folder's
// repository is read (a batch's shared reads, `folder-facts.ts`).
export function checkoutIn(
  launch: string,
  folder: string,
  repositoryOf: (folder: string) => Repository | null = repositoryAt,
): { checkout: string; cwd: string; workTree: string | null; linked: boolean } | null {
  let c: string;
  try {
    c = canonical(folder);
  } catch {
    return null;
  }
  const within = c === launch || c.startsWith(launch.endsWith(sep) ? launch : launch + sep);
  const rc = repositoryOf(c);
  const rl = repositoryOf(launch);
  if (rl === null) return rc === null && within ? { checkout: launch, cwd: c, workTree: null, linked: false } : null;
  if (rc === null || rc.commonDir !== rl.commonDir) return null;
  if (rc.workTree === rl.workTree) return { checkout: within ? launch : rl.workTree, cwd: c, workTree: rl.workTree, linked: rl.linked };
  return { checkout: rc.workTree, cwd: c, workTree: rc.workTree, linked: rc.linked };
}

// The branch `HEAD` names at a work tree (its git directory's `HEAD`, `ref: refs/heads/<name>`); null when it is
// detached, unreadable or no work tree's.
export function headBranch(workTree: string): string | null {
  try {
    const dotGit = join(workTree, '.git');
    const entry = lstatSync(dotGit);
    const gitDir = entry.isDirectory() ? dotGit : entry.isFile() ? resolvePath(workTree, pointer(dotGit, 'gitdir: ')) : null;
    if (gitDir === null) return null;
    const head = pointer(join(gitDir, 'HEAD'));
    return head.startsWith('ref: refs/heads/') ? branchName(head.slice('ref: refs/heads/'.length)) : null;
  } catch {
    return null;
  }
}

const declared = (row: ProjectRow) => row.origin === 'user' && !row.hidden;
const ownStatement = (row: ProjectRow) => row.stated_linked ?? row.stated_minted;
// A file there, as far as it can be read: a folder that cannot be read (EACCES, ENOTDIR, ELOOP) holds no evidence (M8's
// review 2, finding 2)
function isFile(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch {
    return false;
  }
}
// The project registry (§A's `stated`; M8's review 1, finding 12): a stored statement decides the row's project, its own
// or one above it (`org_at` says which folder), as the rule last decided; not while its folder is replaced.
const statedOf = (row: ProjectRow): 'minted' | 'linked' | null =>
  !declared(row) || row.location_state === 'replaced' ? null : row.org_by === 'link' ? 'linked' : row.org_by === 'minted' ? 'minted' : null;

const project = (row: ProjectRow): ProjectRecord => {
  const stated = statedOf(row);
  return {
    id: row.id as ProjectId,
    name: row.name,
    directory: row.directory,
    order: row.sort_order,
    createdAt: row.created_at,
    ...(row.origin !== 'user' ? { discovered: true } : {}),
    ...(row.hidden ? { hidden: true } : {}), // W11: carried on the renderer's list, which hides it
    ...(row.org_key !== null && row.org_source !== null ? { org: orgOf(row)! } : {}), // P5 O6 M5: absent until derived
    // the project registry (Interfaces §F), each absent where it does not apply
    ...(stated !== null ? { stated } : {}),
    ...(declared(row) && row.location_state !== null ? { state: row.location_state } : {}),
    ...(row.name_rev !== null ? { nameRev: row.name_rev } : {}),
    ...(row.org_remote !== null ? { remote: row.org_remote } : {}),
    ...(row.org_hub === 0 ? { hub: false as const } : {}),
  };
};

const orgOf = (row: ProjectRow): ProjectOrg | null =>
  row.org_key === null || row.org_source === null ? null : { key: row.org_key as OrgKey, name: row.org_name ?? '', source: row.org_source, smnsId: row.org_smns_id };

// P5 O6 M5: what the org-project rule reads of a row, and what derives one (`Index.refreshOrgProjects`).
export interface OrgRow {
  id: ProjectId;
  directory: string;
  name: string;
  files?: GitFiles; // P5 O7 M9 round 3: a remote setup's registration's checked reader, read through before trust
  remoteReads?: RemoteReads; // M8's Fix 3: the act's reads of the remotes, which the act's every derivation shares
}
export type DeriveOrgOf = (row: OrgRow) => void;

/** Where a row's own statement stands (the project registry, Interfaces §F). */
export interface StatementRow {
  id: ProjectId;
  directory: string;
  name: string;
  declared: boolean;
  nameRev: number | null;
  state: 'missing' | 'replaced' | null;
  minted: string | null;
  linked: string | null;
  anchor: Anchor | null;
  smnsId: string | null; // the rule's project as last derived
}

// The broadest folders (Interfaces §F.4): a filesystem root, the home directory and a folder above it, which get a
// stored statement only by an explicit add of that very folder.
export const isBroadFolder = (directory: string, home: string): boolean => dirname(directory) === directory || directory === home || home.startsWith(directory.endsWith(sep) ? directory : directory + sep);

// A transcript removed by retention keeps an archived session record, not an otherwise empty discovered project
// in the sidebar or Hidden projects. User-added projects and sessions awaiting their first transcript remain.
const HAS_PRESENT_SESSION = `EXISTS (SELECT 1 FROM sessions WHERE sessions.project_id = projects.id
  AND (sessions.transcript_path IS NOT NULL OR sessions.summary IS NULL))`;
const HAS_PROJECT_CONTENT = `(origin = 'user' OR ${HAS_PRESENT_SESSION})`;

export class ProjectStore {
  private readonly listeners = new Set<(revision: number) => void>();
  private deriveOrg: DeriveOrgOf | null = null; // P5 O6 M5: set once the org refresh starts; a new row is derived after its commit

  constructor(
    private readonly db: Db,
    private readonly stamp: () => number, // the index-wide revision, taken once per committed change
    private readonly attachOrphans: (projectId: ProjectId, directory: string) => void, // sessions already in a new project's directory
    // the project registry: a relocate's merge moves the merged row's sessions to the located row (SessionStore.moveProject)
    private readonly moveSessions: (from: ProjectId, to: ProjectId) => void = () => {},
  ) {}

  // The project registry (M8's review 1, finding 8): whether the declared rows would fit one projects record (the seam's
  // `fits`), asked before a first use or a `.smns` declares a row
  private fits: (rows: readonly DeclaredRow[]) => boolean = () => true;
  onFits(fits: ((rows: readonly DeclaredRow[]) => boolean) | null): void {
    this.fits = fits ?? (() => true);
  }

  private fitsWith(row: ProjectRow): boolean {
    const rows = this.admissionRows();
    return rows.some((r) => r.pid === row.id) || this.fits([...rows, declaredRowOf(row) ?? prospectiveRow({ pid: row.id, path: row.directory })]);
  }

  // The project registry (Interfaces §F.4, moment (b)): told after the commit that made a row the user's by a first MAWS use
  private usedListener: ((id: ProjectId) => void) | null = null;
  // Moved by each write to what `sessionJoined` reads of the rows, besides its own checks' writes: a statement moved (a
  // declaration, a removal, a mint, a link, a relocation, a restore) or an org answer written
  private joinInputs = 0;
  onUsed(listener: ((id: ProjectId) => void) | null): void {
    this.usedListener = listener;
  }

  // UX1 upgrade: these fields are written by MAWS engine launches/resumes, not discovery.
  // Older databases did not promote origin when a discovered session ran. Explicit hiding still wins.
  preserveUsedProjects(): void {
    if (this.db.readOnly) return;
    this.db.exec(`UPDATE projects SET origin = 'user' WHERE origin = 'discovered' AND EXISTS (
      SELECT 1 FROM sessions s WHERE s.project_id = projects.id AND (
        s.gateway_routed IS NOT NULL OR s.model_requested IS NOT NULL OR s.lineage_source = 'intent'
        OR json_extract(s.holder, '$.kind') = 'self'
        OR EXISTS (SELECT 1 FROM owner_channel_sessions o WHERE o.app_session_id = s.app_id AND o.launch_id IS NOT NULL)
      ))`);
  }

  // Starting/resuming chooses a project, but never reverses Remove from sidebar.
  usedByMaws(id: ProjectId): void {
    this.db.transaction(() => {
      const row = this.row(id);
      if (row.origin === 'user') return;
      // M8's review 1 (finding 8): a declaration that would not fit one projects record is not made
      if (!row.hidden && !this.fitsWith(row)) return console.warn(`[index] ${row.directory} is not declared: the declared folders would not fit one projects record`);
      this.db.update('projects', 'id', id, { origin: 'user' });
      this.statementsMoved();
      this.changed();
      this.db.defer(`used:${id}`, () => this.usedListener?.(id));
    });
  }

  // Visible projects in their order (then by creation).
  list(opts: { includeHidden?: boolean } = {}): ProjectRecord[] {
    const where = opts.includeHidden ? '' : `WHERE hidden = 0 AND ${HAS_PROJECT_CONTENT}`;
    return this.db.all<ProjectRow>(`SELECT * FROM projects ${where} ORDER BY sort_order, created_at, id`).map(project);
  }

  // What `session.projects.list` answers (W11, I5): the visible projects and, marked `hidden`, those removed from the
  // sidebar, so the renderer keeps their sessions out of Other sessions and can offer them back. Discovered projects
  // without a present session are omitted, including those whose last transcript vanished. Their rows stay, so a
  // restored transcript recovers its membership and the owner's explicit hide is not undone.
  listWithRemoved(): ProjectRecord[] {
    return this.db
      .all<ProjectRow>(
        `SELECT * FROM projects WHERE ${HAS_PROJECT_CONTENT} ORDER BY sort_order, created_at, id`,
      )
      .map(project);
  }

  // The project for a realpath, creating it with `origin` when there is none. An explicit add (`user`) of a project
  // discovery created, or one the user removed, makes it the user's and visible again; discovery never unhides.
  // `files` (P5 O7 M9 round 3): a remote setup's registration's checked reader, which the new row's org derivation reads
  // through (org-project.ts' `OrgIo`)
  ensureForDirectory(realpath: string, origin: Origin, files?: GitFiles, remoteReads?: RemoteReads): ProjectRecord {
    return this.db.transaction(() => {
      const existing = this.db.get<ProjectRow>('SELECT * FROM projects WHERE directory = ?', realpath);
      if (existing) {
        if (origin === 'user' && (existing.origin !== 'user' || existing.hidden)) {
          this.db.update('projects', 'id', existing.id, { origin: 'user', hidden: 0 });
          this.statementsMoved(); // a statement kept on a removed row counts again
          this.changed();
        }
        return project(this.row(existing.id));
      }
      const id = randomUUID() as ProjectId;
      const { next } = this.db.get<{ next: number }>('SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM projects')!;
      this.db.insert('projects', {
        id,
        directory: realpath,
        name: basename(realpath) || realpath,
        slug: slugOf(realpath),
        origin,
        hidden: 0,
        sort_order: next,
        created_at: new Date().toISOString(),
        last_activity_at: null,
      });
      this.changed();
      this.attachOrphans(id, realpath);
      this.db.defer(`org:${id}`, () => this.deriveOrg?.({ id, directory: realpath, name: basename(realpath) || realpath, ...(files === undefined ? {} : { files }), ...(remoteReads === undefined ? {} : { remoteReads }) }));
      return project(this.row(id));
    });
  }

  // `session.projects.add`: an existing directory, realpathed, as the user's project.
  add(directory: string, remoteReads?: RemoteReads): ProjectRecord {
    const { realpath } = locate(directory);
    if (realpath === null || !statSync(realpath).isDirectory()) throw new Error(`not a directory: ${directory}`);
    return this.ensureForDirectory(realpath, 'user', undefined, remoteReads);
  }

  // `nameRev` (the project registry, Interfaces §G): with a name, the rename's counter, written in the same statement
  update(id: ProjectId, patch: { name?: string; order?: number }, nameRev?: number): ProjectRecord {
    return this.db.transaction(() => {
      this.row(id);
      const values: Record<string, string | number> = {};
      if (patch.name !== undefined) values.name = patch.name;
      if (patch.name !== undefined && this.row(id).org_source === 'folder') values.org_name = patch.name; // P5 O6 M5: rule 4 takes the project's name
      if (patch.name !== undefined && nameRev !== undefined) values.name_rev = nameRev;
      if (patch.order !== undefined) values.sort_order = patch.order;
      if (this.db.update('projects', 'id', id, values) > 0) this.changed();
      return project(this.row(id));
    });
  }

  // `session.projects.remove`: hidden, never deleted, so its id survives rediscovery and its sessions stay attached.
  // The project registry: its stored statement stays, and counts on neither side while the row is hidden (Interfaces §G).
  hide(id: ProjectId): void {
    this.db.transaction(() => {
      if (this.row(id).hidden) return;
      this.db.update('projects', 'id', id, { hidden: 1 });
      this.statementsMoved();
      this.changed();
    });
  }

  resolveMembership(effectiveDirectory: string): { projectId: ProjectId | null; worktree: SessionRecord['worktree'] } {
    const location = locate(effectiveDirectory);
    return { projectId: this.projectAt(location), worktree: location.worktreePath === null ? null : { path: location.worktreePath, branch: null } };
  }

  // The project a located directory belongs to; with `create`, discovery's rule makes one for an existing directory.
  projectAt(location: Location, create = false): ProjectId | null {
    if (location.projectDirectory === null) return null;
    const row = this.db.get<{ id: string }>('SELECT id FROM projects WHERE directory = ?', location.projectDirectory);
    if (row) return row.id as ProjectId;
    return create ? this.ensureForDirectory(location.projectDirectory, 'discovered').id : null;
  }

  // Visible projects whose own directory now locates inside a worktree of another project's checkout: linked worktrees
  // registered as projects of their own before the membership rule folded them (SessionStore.refoldLinkedWorktrees).
  inWorktrees(): { id: ProjectId; origin: Origin; location: Location }[] {
    return this.db.all<ProjectRow>('SELECT * FROM projects WHERE hidden = 0 ORDER BY sort_order, created_at, id').flatMap((row) => {
      const location = locate(row.directory);
      return location.worktreePath === null ? [] : [{ id: row.id as ProjectId, origin: row.origin, location }];
    });
  }

  // P5 O6 M5 ("Persisting and refreshing"): every row, for the start-up refresh; and the rule's answer for one, written
  // (and told, as any project change is) only when it differs from what the row holds. A row gone meanwhile is left.
  orgRows(): OrgRow[] {
    return this.db.all<ProjectRow>('SELECT * FROM projects ORDER BY sort_order, created_at, id').map((row) => ({ id: row.id as ProjectId, directory: row.directory, name: row.name }));
  }

  // `observed` (the project registry): what the rule saw beside the label, the remote key and whether a `.smns` naming no
  // hub of the org decided, kept on an enrolled machine only (null otherwise), so a signed-out row reads as before
  setOrg(id: ProjectId, org: ProjectOrg, observed: { remote: string | null; hub: boolean; by: string; at: string | null } | null = null): void {
    if (this.db.readOnly) return;
    this.db.transaction(() => {
      const row = this.db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
      if (!row) return;
      const before = orgOf(row);
      const remote = observed?.remote ?? null;
      const hub = observed === null || observed.hub ? null : 0;
      const by = observed?.by ?? null;
      const at = observed?.at ?? null;
      if (before !== null && before.key === org.key && before.name === org.name && before.source === org.source && before.smnsId === org.smnsId && row.org_remote === remote && row.org_hub === hub && row.org_by === by && row.org_at === at) return;
      this.db.update('projects', 'id', id, { org_key: org.key, org_name: org.name, org_source: org.source, org_smns_id: org.smnsId, org_remote: remote, org_hub: hub, org_by: by, org_at: at });
      this.joinInputs += 1;
      this.changed();
    });
  }

  // P5 O8 M7b: a project's org project as its row holds it, for the project channel's join; null until it is derived,
  // or for a project the index holds no row of.
  org(id: ProjectId): ProjectOrg | null {
    const row = this.db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
    return row === null ? null : orgOf(row);
  }

  /** Whether the index cannot be used (a newer app's schema, or a run refused the spine). */
  get unavailable(): boolean {
    return this.db.readOnly;
  }

  onCreated(derive: DeriveOrgOf | null): void {
    this.deriveOrg = derive;
  }

  // ---- the project registry: stored statements (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §F) --

  /**
   * The stored statement in force at a canonical path (§F.2): the row's when it is declared, has one, and the folder now
   * at the path is the one it was made on. A folder found to be another is marked `replaced`, and one found again present.
   */
  statementAt(path: string): { minted: string | null; linked: string | null } | null {
    if (this.db.readOnly) return null;
    const row = this.db.get<ProjectRow>('SELECT * FROM projects WHERE directory = ?', path);
    if (!row || !declared(row) || ownStatement(row) === null) return null;
    if (this.observeRow(row) !== null) return null;
    return { minted: row.stated_minted, linked: row.stated_linked };
  }

  /**
   * The state of a declared row's folder (§F.6), written when it changed and told as any project change is: `missing`
   * where there is no folder at the path (a folder this process may not read is present), `replaced` where its anchor
   * names another folder. Answers the state.
   */
  observe(id: ProjectId): 'missing' | 'replaced' | null {
    const row = this.db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
    return row === null ? null : this.observeRow(row);
  }

  private observeRow(current: ProjectRow): 'missing' | 'replaced' | null {
    if (!declared(current)) return null;
    let state: 'missing' | 'replaced' | null = null;
    if (folderAt(current.directory) === 'absent') state = 'missing';
    else if (current.anchor !== null) {
      const reading = readFolder(current.directory); // null: present but not readable, which compares nothing
      if (reading !== null && !sameFolder(JSON.parse(current.anchor) as Anchor, reading)) state = 'replaced';
    }
    if (state !== current.location_state && !this.db.readOnly) {
      this.db.transaction(() => {
        this.setState(current.id as ProjectId, state);
        // M8's review 1 (finding 3): a replaced folder's own statement counts no more, so the answer it gave is dropped at
        // once and the row derived again, before anything is filed under the old project
        if (state === 'replaced' && (current.org_by === 'link' || current.org_by === 'minted') && current.org_at === current.directory) {
          this.db.update('projects', 'id', current.id, { org_smns_id: null, org_by: null, org_at: null });
        }
        // and the rows beneath, which the statement decided too; a folder back at its path (its original returned, or
        // found again) is derived again the same way (M8's review 2, finding 3)
        if (state === 'replaced' || current.location_state !== null) {
          for (const row of [{ id: current.id as ProjectId, directory: current.directory, name: current.name }, ...this.rowsBeneath(current.directory)]) {
            this.db.defer(`org:${row.id}`, () => this.deriveOrg?.(row));
          }
        }
      });
    }
    return state;
  }

  /** A declared row whose folder is not at its path (§F.6's `missing`, observed now). */
  missingDeclared(id: ProjectId): boolean {
    const row = this.db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
    if (row === null || !declared(row) || folderAt(row.directory) !== 'absent') return false;
    this.observeRow(row);
    return true;
  }

  setState(id: ProjectId, state: 'missing' | 'replaced' | null): void {
    this.db.transaction(() => {
      if (this.db.update('projects', 'id', id, { location_state: state }) > 0) this.changed();
    });
  }

  /** The declared rows, for the folder checks and minting's moment (c). */
  declaredIds(): ProjectId[] {
    return this.db.all<{ id: string }>("SELECT id FROM projects WHERE origin = 'user' AND hidden = 0 ORDER BY sort_order, created_at, id").map((row) => row.id as ProjectId);
  }

  /** A row as `session.projects.list` answers it. */
  record(id: ProjectId): ProjectRecord {
    return project(this.row(id));
  }

  statementRow(id: ProjectId): StatementRow {
    const row = this.row(id);
    return { id, directory: row.directory, name: row.name, declared: declared(row), nameRev: row.name_rev, state: row.location_state, minted: row.stated_minted, linked: row.stated_linked, anchor: row.anchor === null ? null : (JSON.parse(row.anchor) as Anchor), smnsId: row.org_smns_id };
  }

  /** A row's folder and name now; null once it is gone (a relocate's merge deletes one). */
  placeOf(id: ProjectId): { directory: string; name: string } | null {
    const row = this.db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
    return row === null ? null : { directory: row.directory, name: row.name };
  }

  /** The statement row at a canonical path, declared or not; null when there is no row there. */
  statementRowAt(path: string): StatementRow | null {
    const row = this.db.get<{ id: string }>('SELECT id FROM projects WHERE directory = ?', path);
    return row === null ? null : this.statementRow(row.id as ProjectId);
  }

  /** Mints a row (§F.4): a random UUID and the anchor of its folder; nothing when it has a minted id already. Answers whether it did. */
  mint(id: ProjectId, minted: string, anchor: Anchor): boolean {
    return this.db.transaction(() => {
      const row = this.row(id);
      if (row.stated_minted !== null) return false;
      this.db.update('projects', 'id', id, { stated_minted: minted, ...(row.anchor === null ? { anchor: JSON.stringify(anchor) } : {}) });
      this.statementsMoved();
      this.changed();
      return true;
    });
  }

  /** Sets or clears a row's link (§G), anchoring it to the folder there when it has no anchor yet. Answers whether it changed. */
  setLink(id: ProjectId, into: string | null, anchor: Anchor | null): boolean {
    return this.db.transaction(() => {
      const row = this.row(id);
      if (row.stated_linked === into) return false;
      this.db.update('projects', 'id', id, { stated_linked: into, ...(row.anchor === null && anchor !== null ? { anchor: JSON.stringify(anchor) } : {}) });
      this.statementsMoved();
      this.changed();
      return true;
    });
  }

  /**
   * `setLink` only while the row is still at `path` (§G's `link` with `expect`; panel 1, A2), checked in the transaction
   * that sets it: `changed` when the row has moved since, nothing set.
   */
  setLinkAt(id: ProjectId, into: string | null, anchor: Anchor | null, path: string): boolean | 'changed' {
    return this.db.transaction(() => (this.row(id).directory === path ? this.setLink(id, into, anchor) : 'changed'));
  }

  /**
   * Points a row at a folder's new path (§G's `relocate`), its anchor that folder's and its state cleared. A row at that
   * path with a statement of its own refuses it (`has-statement`); one without is merged: its sessions and artifacts move
   * to the located row and it is deleted, the one place a row is. Answers whether it merged.
   */
  relocate(id: ProjectId, path: string, anchor: Anchor): { merged: boolean } | { refused: 'has-statement' } {
    return this.db.transaction(() => {
      const row = this.row(id);
      const there = path === row.directory ? null : this.db.get<ProjectRow>('SELECT * FROM projects WHERE directory = ?', path);
      if (there && ownStatement(there) !== null) return { refused: 'has-statement' as const };
      if (there) {
        this.moveSessions(there.id as ProjectId, id);
        this.db.run('UPDATE library_artifacts SET project_id = ? WHERE project_id = ?', id, there.id);
        this.db.run('DELETE FROM projects WHERE id = ?', there.id);
      }
      const renamed: Record<string, string> = row.name_rev === null && path !== row.directory ? { name: basename(path) || path } : {};
      this.db.update('projects', 'id', id, { directory: path, slug: slugOf(path), anchor: JSON.stringify(anchor), location_state: null, ...renamed });
      this.statementsMoved();
      this.changed();
      return { merged: there !== null };
    });
  }

  /** Hides a row only while `statements_gen` is still `gen` (§G's checked `remove`). Answers whether the generation held. */
  hideAt(id: ProjectId, gen: number): boolean {
    return this.db.transaction(() => {
      if (this.statementsGen() !== gen) return false;
      this.hide(id);
      return true;
    });
  }

  /**
   * The row at a `.smns` folder made the user's (§F.5), as a first MAWS use makes it, created when absent; a removed row
   * stays removed.
   */
  declareByFile(directory: string, shape: DeclaredRow = prospectiveRow({ pid: randomUUID(), path: directory })): void {
    if (this.db.readOnly) return;
    this.db.transaction(() => {
      const existing = this.db.get<ProjectRow>('SELECT * FROM projects WHERE directory = ?', directory);
      if (!existing) {
        if (folderAt(directory) !== 'present') return;
        if (!this.fits([...this.admissionRows(), shape])) return console.warn(`[index] ${directory} is not declared: the declared folders would not fit one projects record`);
        this.ensureForDirectory(directory, 'user');
      } else if (existing.origin !== 'user' && !existing.hidden) this.usedByMaws(existing.id as ProjectId);
    });
  }

  /** Whether a `.smns` in `directory` would declare a row there now (§F.5): none there yet, or a discovered one not removed. */
  promotionDue(directory: string): boolean {
    const existing = this.db.get<ProjectRow>('SELECT * FROM projects WHERE directory = ?', directory);
    return existing === null || (existing.origin !== 'user' && !existing.hidden);
  }

  /** Whether any session is filed under the row. */
  hasSession(id: ProjectId): boolean {
    return this.db.get('SELECT 1 FROM sessions WHERE project_id = ? LIMIT 1', id) !== null;
  }

  /**
   * A session was filed under the row (discovered, started, or moved in). A stated row's folder is checked first, so a
   * replaced one files nothing under the old project (M8's review 1, finding 3). And where a `.smns` on the row's path
   * belongs to a folder that is not declared yet, the row is derived again after the commit, so that folder is declared
   * (§F.5; finding 9). Without a git call: a `stat` per folder up the path, and a derivation only where a promotion is due.
   * Once per row in a transaction, until what the checks read of the rows is written there (`joinInputs`): a scan that
   * files thousands of sessions under one row checks it for the first, and the answer stands for the rest. A folder that
   * changes on disk meanwhile is the folder checks' to find, as it is between any two sessions.
   */
  sessionJoined(id: ProjectId): void {
    if (!this.db.firstInTransaction(`joined:${id}:${this.joinInputs}`)) return;
    const row = this.db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
    if (!row) return;
    if (declared(row) && ownStatement(row) !== null) this.observeRow(row);
    else this.observeDecider(row);
    if (this.undeclaredSmns(row.directory)) this.db.defer(`org:${id}`, () => this.deriveOrg?.({ id, directory: row.directory, name: row.name }));
  }

  // M8's review 1 (finding 3, the inherited case): a row whose project a statement above it decided has that folder's
  // anchor checked as its own would be (one stat); a statement that no longer counts (its folder replaced or missing, its
  // row removed) drops the answer it gave at once, and the row is derived again, before anything is filed under it.
  private observeDecider(row: ProjectRow): void {
    if ((row.org_by !== 'link' && row.org_by !== 'minted') || row.org_at === null || row.org_at === row.directory) return;
    const decider = this.db.get<ProjectRow>('SELECT * FROM projects WHERE directory = ?', row.org_at);
    if (decider !== null && declared(decider) && ownStatement(decider) !== null && this.observeRow(decider) === null) return;
    if (this.db.readOnly) return;
    this.db.transaction(() => {
      this.db.update('projects', 'id', row.id, { org_smns_id: null, org_by: null, org_at: null });
      this.changed();
      this.db.defer(`org:${row.id}`, () => this.deriveOrg?.({ id: row.id as ProjectId, directory: row.directory, name: row.name }));
    });
  }

  // The nearest `.smns` walking up from `directory` sits in a folder with no row, or one discovery made and nobody removed.
  private undeclaredSmns(directory: string): boolean {
    for (let folder = directory; ; folder = dirname(folder)) {
      if (isFile(join(folder, '.smns'))) {
        const there = this.db.get<ProjectRow>('SELECT * FROM projects WHERE directory = ?', folder);
        return there === null || (there.origin !== 'user' && !there.hidden);
      }
      if (dirname(folder) === folder) return false;
    }
  }

  /** The rows beneath a folder (not the folder's own), which a statement change there is told to (M8's decision). */
  rowsBeneath(directory: string): OrgRow[] {
    const prefix = directory.endsWith(sep) ? directory : directory + sep;
    return this.db
      .all<ProjectRow>("SELECT * FROM projects WHERE substr(directory, 1, length(?)) = ? ORDER BY sort_order, created_at, id", prefix, prefix)
      .map((row) => ({ id: row.id as ProjectId, directory: row.directory, name: row.name }));
  }

  /** The highest `nameRev` this machine's rows hold for a project. */
  highestNameRev(smnsId: string): number {
    return this.db.get<{ rev: number | null }>('SELECT MAX(name_rev) AS rev FROM projects WHERE org_smns_id = ?', smnsId)?.rev ?? 0;
  }

  // ---- the index's own facts (index_meta) -------------------------------------------------------------------------------

  indexId(): string {
    return this.db.get<{ value: string }>("SELECT value FROM index_meta WHERE key = 'index_id'")!.value;
  }

  statementsGen(): number {
    return Number(this.db.get<{ value: string }>("SELECT value FROM index_meta WHERE key = 'statements_gen'")?.value ?? 0);
  }

  meta(key: string): string | null {
    return this.db.get<{ value: string }>('SELECT value FROM index_meta WHERE key = ?', key)?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    if (this.db.readOnly) return;
    this.db.run('INSERT INTO index_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  // in the open transaction: a stored statement, or whether one counts (a declared row's path, its hiding), changed
  private statementsMoved(): void {
    this.joinInputs += 1;
    this.db.run("UPDATE index_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'statements_gen'");
  }

  // ---- what the endpoint reads of the index (§H's `ProjectsSource`) ----------------------------------------------------

  /** The declared rows as the endpoint states them; a row not yet derived is left out (`declaredDerived` says whether any is). */
  declaredRows(): DeclaredRow[] {
    return this.db.all<ProjectRow>("SELECT * FROM projects WHERE origin = 'user' AND hidden = 0 ORDER BY sort_order, created_at, id").flatMap((row) => declaredRowOf(row) ?? []);
  }

  /** The declared rows a projects record would hold, a row not yet derived standing in at its folder row's size (M8's review 2, finding 4). */
  admissionRows(): DeclaredRow[] {
    return this.db
      .all<ProjectRow>("SELECT * FROM projects WHERE origin = 'user' AND hidden = 0 ORDER BY sort_order, created_at, id")
      .map((row) => declaredRowOf(row) ?? prospectiveRow({ pid: row.id, path: row.directory }));
  }

  /** The declared row at `path` as it would be published under `decided`'s statement (finding 5); null when there is none derived. */
  declaredRowUnder(path: string, decided: { smnsId: string; by: 'link' | 'minted'; at: string } | null): DeclaredRow | null {
    const row = this.db.get<ProjectRow>('SELECT * FROM projects WHERE directory = ?', path);
    if (row === null || !declared(row)) return null;
    return declaredRowOf(decided === null ? row : { ...row, org_smns_id: decided.smnsId, org_by: decided.by, org_at: decided.at, org_hub: null });
  }

  /** The declared row as it would be published once renamed (§G's `update`; panel 1, scalpel-2#2); null when none is derived. */
  declaredRowRenamed(id: ProjectId, name: string, nameRev: number): DeclaredRow | null {
    const row = this.row(id);
    return declared(row) ? declaredRowOf({ ...row, name, name_rev: nameRev }) : null;
  }

  /**
   * A missing declared folder's identity while the machine is enrolled (M8's review 2, finding 1): with a stored statement
   * of its own, the statement's (its link, else its minted id), decided at itself, the label kept or else rebuilt from the
   * row's own name; without one, the answer it last had. False when it has neither, for the rule to derive.
   */
  keepMissing(id: ProjectId, machine: string): boolean {
    const row = this.db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
    if (row === null) return true;
    const own = ownStatement(row);
    if (own === null) return orgOf(row) !== null;
    const label = orgOf(row) ?? { key: `folder:${machine}:${row.id}` as OrgKey, name: row.name, source: 'folder' as const, smnsId: null };
    this.setOrg(id, { ...label, smnsId: own }, { remote: row.org_remote, hub: true, by: row.stated_linked !== null ? 'link' : 'minted', at: row.directory });
    return true;
  }

  /** The declared row at a canonical path as the endpoint states it; null when there is none or it is not yet derived. */
  declaredRowAt(path: string): DeclaredRow | null {
    const row = this.db.get<ProjectRow>('SELECT * FROM projects WHERE directory = ?', path);
    return row === null || !declared(row) ? null : declaredRowOf(row);
  }

  /** Whether every declared row has been derived, so `declaredRows` holds them all. */
  declaredDerived(): boolean {
    return this.db.get("SELECT 1 FROM projects WHERE origin = 'user' AND hidden = 0 AND (org_key IS NULL OR org_source IS NULL) LIMIT 1") === null;
  }

  /** Every row's stored statement whole, removed rows' included (§H's kept file). */
  keptStatements(): KeptStatement[] {
    return this.db
      .all<ProjectRow>("SELECT * FROM projects WHERE (stated_minted IS NOT NULL OR stated_linked IS NOT NULL OR name_rev IS NOT NULL) AND origin = 'user' ORDER BY directory")
      .map((row) => ({ path: row.directory, minted: row.stated_minted, linked: row.stated_linked, anchor: row.anchor === null ? null : (JSON.parse(row.anchor) as Anchor), name: row.name, nameRev: row.name_rev, hidden: row.hidden === 1 }));
  }

  /**
   * A rebuilt index's statements back from the endpoint's kept file (§H; constraint 5's second exception): each written to
   * the row at its path, the row created when absent (the user's) and hidden when the statement says so.
   */
  restore(statements: readonly KeptStatement[]): void {
    if (this.db.readOnly || statements.length === 0) return;
    this.db.transaction(() => {
      for (const kept of statements) {
        const id = this.ensureForDirectory(kept.path, 'user').id;
        // M8's review 1 (finding 6): the answers derived before the restore no longer stand, for the folder and beneath it,
        // so the endpoint's snapshot waits until they are derived again
        const beneath = kept.path.endsWith(sep) ? kept.path : kept.path + sep;
        this.db.run(
          'UPDATE projects SET org_key = NULL, org_name = NULL, org_source = NULL, org_smns_id = NULL, org_remote = NULL, org_hub = NULL, org_by = NULL, org_at = NULL WHERE directory = ? OR substr(directory, 1, length(?)) = ?',
          kept.path,
          beneath,
          beneath,
        );
        this.db.update('projects', 'id', id, {
          stated_minted: kept.minted,
          stated_linked: kept.linked,
          anchor: kept.anchor === null ? null : JSON.stringify(kept.anchor),
          name_rev: kept.nameRev,
          ...(kept.nameRev !== null ? { name: kept.name } : {}),
          hidden: kept.hidden ? 1 : 0,
        });
      }
      this.statementsMoved();
      this.changed();
    });
  }

  // A transcript appeared or vanished: discovered project visibility follows its present sessions.
  sessionPresenceChanged(): void {
    this.changed();
  }

  // After commit, once per transaction that changed projects, with that change's revision.
  onChange(listener: (revision: number) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private row(id: string): ProjectRow {
    const row = this.db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
    if (!row) throw new Error(`unknown project: ${id}`);
    return row;
  }

  private changed(): void {
    this.db.defer('projects', () => {
      const revision = this.stamp();
      for (const listener of this.listeners) listener(revision);
    });
  }
}

// Whether a folder is at a path, links followed (Interfaces §F.6): none where nothing is there or it is no directory, and a
// path this process may not read counts as present.
function folderAt(path: string): 'absent' | 'present' {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true ? 'present' : 'absent';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOTDIR' ? 'absent' : 'present';
  }
}

// A declared row as the endpoint states it (§H's `DeclaredRow`); null until derived. `statedAt` is the folder whose
// statement decides (M8's review 1, finding 12): the row's own path for a statement at it, an ancestor's for one above.
// A replaced folder's own statement counts on neither side, yet the location stays its statement's, `replaced`, with
// Use this folder and Remove beside it on every device (design §10; panel 1, sweep#1): its id is the statement's, its
// label the folder's as now derived, and it carries no `stated`, so sminos files nothing by it (§D, §E.2).
function declaredRowOf(row: ProjectRow): DeclaredRow | null {
  const org = orgOf(row);
  if (org === null) return null;
  const stated = statedOf(row);
  const replacedStatement = row.location_state === 'replaced' ? ownStatement(row) : null;
  return {
    pid: row.id,
    path: row.directory,
    name: locationName(row, org, stated),
    ...(row.name_rev !== null ? { nameRev: row.name_rev } : {}),
    org: replacedStatement === null ? org : { ...org, smnsId: replacedStatement },
    ...(stated !== null ? { stated } : {}),
    ...(stated !== null && row.org_at !== null ? { statedAt: row.org_at } : {}),
    ...(row.org_hub === 0 ? { hub: false as const } : {}),
    ...(row.org_remote !== null ? { remote: row.org_remote } : {}),
    ...(row.location_state !== null ? { state: row.location_state } : {}),
  };
}

/**
 * The row a declaration would add to the record, for the seam's `fits` (M8's review 1, finding 8): as the rule answers it
 * when that is known, else a folder row's label, whose size a folder's key and name bound.
 */
export function prospectiveRow({ pid, path, org, remote, hub, by, at }: { pid: string; path: string; org?: ProjectOrg; remote?: string | null; hub?: boolean; by?: string; at?: string | null }): DeclaredRow {
  const label = org ?? { key: `folder:${pid}:${pid}` as OrgKey, name: basename(path) || path, source: 'folder' as const, smnsId: null };
  const row = { id: pid, directory: path, name: basename(path) || path, origin: 'user', hidden: 0, name_rev: null, location_state: null, org_remote: remote ?? null, org_hub: hub === false ? 0 : null, org_by: by ?? null, org_at: at ?? null } as unknown as ProjectRow;
  return declaredRowOf({ ...row, org_key: label.key, org_name: label.name, org_source: label.source, org_smns_id: label.smnsId })!;
}

// A location's own name (Interfaces §A): the deciding `.smns`'s when a file decides; else a rename's; else the remote's
// name; else the folder's base name.
function locationName(row: ProjectRow, org: ProjectOrg, stated: 'minted' | 'linked' | null): string {
  if (org.source === 'smns' && stated === null && org.smnsId === org.key.slice('smns:'.length)) return org.name;
  if (row.name_rev !== null) return row.name;
  if (org.source === 'remote') return org.name;
  if (row.org_remote !== null) return row.org_remote.slice(row.org_remote.lastIndexOf('/') + 1); // the key's, lower-cased
  return basename(row.directory) || row.directory;
}
