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
import { basename, dirname, join } from 'node:path';
import type { ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord } from '@shared/ipc/schema/session';
import { slugOf } from '../../engine-host/fs/paths';
import { gitBinary, gitEnv } from '../git/runner';
import type { Db } from './db';

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
  return main !== null && holdsHead(main, gitOutput(main, TREE)) ? main : null;
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
function holdsHead(main: string, tree: string | null): boolean {
  if (tree === null) return false;
  const candidates: { path: string; id: string; size: number }[] = [];
  for (const entry of tree.split('\0')) {
    const match = TOP_LEVEL_FILE.exec(entry);
    if (match === null) continue;
    const path = join(main, match[2]);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat?.isFile() && stat.size > 0 && stat.size <= EVIDENCE_BYTES) candidates.push({ path, id: match[1], size: stat.size });
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
    if (answer === undefined) checked.set(main, (answer = gitOutputAsync(main, TREE).then((tree) => holdsHead(main, tree))));
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

const project = (row: ProjectRow): ProjectRecord => ({
  id: row.id as ProjectId,
  name: row.name,
  directory: row.directory,
  order: row.sort_order,
  createdAt: row.created_at,
  ...(row.hidden ? { hidden: true } : {}), // W11: carried on the renderer's list, which hides it
});

export class ProjectStore {
  private readonly listeners = new Set<(revision: number) => void>();

  constructor(
    private readonly db: Db,
    private readonly stamp: () => number, // the index-wide revision, taken once per committed change
    private readonly attachOrphans: (projectId: ProjectId, directory: string) => void, // sessions already in a new project's directory
  ) {}

  // Visible projects in their order (then by creation).
  list(opts: { includeHidden?: boolean } = {}): ProjectRecord[] {
    const where = opts.includeHidden ? '' : 'WHERE hidden = 0';
    return this.db.all<ProjectRow>(`SELECT * FROM projects ${where} ORDER BY sort_order, created_at, id`).map(project);
  }

  // What `session.projects.list` answers (W11, I5): the visible projects and, marked `hidden`, those removed from the
  // sidebar, so the renderer keeps their sessions out of Other sessions and can offer them back. A hidden project
  // discovery made that holds no session is left out: the start-up refold hides the linked worktrees it folds that way
  // once their sessions have moved (`SessionStore.refoldLinkedWorktrees`), and nobody removed those.
  listWithRemoved(): ProjectRecord[] {
    return this.db
      .all<ProjectRow>(
        `SELECT * FROM projects WHERE hidden = 0 OR origin = 'user' OR EXISTS (SELECT 1 FROM sessions WHERE sessions.project_id = projects.id)
         ORDER BY sort_order, created_at, id`,
      )
      .map(project);
  }

  // The project for a realpath, creating it with `origin` when there is none. An explicit add (`user`) of a project
  // discovery created, or one the user removed, makes it the user's and visible again; discovery never unhides.
  ensureForDirectory(realpath: string, origin: Origin): ProjectRecord {
    return this.db.transaction(() => {
      const existing = this.db.get<ProjectRow>('SELECT * FROM projects WHERE directory = ?', realpath);
      if (existing) {
        if (origin === 'user' && (existing.origin !== 'user' || existing.hidden)) {
          this.db.update('projects', 'id', existing.id, { origin: 'user', hidden: 0 });
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
      return project(this.row(id));
    });
  }

  // `session.projects.add`: an existing directory, realpathed, as the user's project.
  add(directory: string): ProjectRecord {
    const { realpath } = locate(directory);
    if (realpath === null || !statSync(realpath).isDirectory()) throw new Error(`not a directory: ${directory}`);
    return this.ensureForDirectory(realpath, 'user');
  }

  update(id: ProjectId, patch: { name?: string; order?: number }): ProjectRecord {
    return this.db.transaction(() => {
      this.row(id);
      const values: Record<string, string | number> = {};
      if (patch.name !== undefined) values.name = patch.name;
      if (patch.order !== undefined) values.sort_order = patch.order;
      if (this.db.update('projects', 'id', id, values) > 0) this.changed();
      return project(this.row(id));
    });
  }

  // `session.projects.remove`: hidden, never deleted, so its id survives rediscovery and its sessions stay attached.
  hide(id: ProjectId): void {
    this.db.transaction(() => {
      if (this.row(id).hidden) return;
      this.db.update('projects', 'id', id, { hidden: 1 });
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
