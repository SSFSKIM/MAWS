// The allowlist of `files.*` (C8c execution document, Terms "Allowlist"; K1): for one session, the realpaths of its
// `directory`, each of its `additionalDirectories` and its `worktree.path`, read through the spine's view. The
// realpath is the native one (`fs.promises.realpath`), which canonicalises case on APFS as the JS implementation does
// not, so a record that spells the repository in another case still names the same root. A root that does not
// resolve is dropped, never replaced by the record's string: a session with no resolvable root reads nothing from its
// folders. What `files.*` reads beyond the allowlist, one file and never its folder (a file the session's deliverables
// name; UX wave U6c, a file its transcript links), the service decides after these roots (`precheck`, ./service.ts).
// 2026-11-06 (the home-root rule, src/shared/machine/machine-home.ts): for a remote caller (`HandlerContext.remote`, the
// endpoint's requests), a root whose realpath is the machine's home or an ancestor of it (`/`, `/Users`) is no root, since
// it would reach the whole home tree (a chat in the home has it as its directory); this machine's own clients read every
// root as before.
import fs from 'node:fs';
import { sep } from 'node:path';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { discoverRepo, POINTER_MAX, worktreeList, type GitFiles, type GitRepo } from '@shared/machine/git-reads';
import { coversHome } from '@shared/machine/machine-home';
import type { SpineView } from '@shared/spine/view';
import { workingFolder } from '@shared/sessions/working-folder';
import { mainCheckout } from '../git/main-checkout';

export type AllowlistRecord = Pick<SessionRecord, 'directory' | 'additionalDirectories' | 'worktree'> & Partial<Pick<SessionRecord, 'launchFolder' | 'agentFolder'>>;

// Whose directories `files.*` reads (E11's sitting: a New chat's Files pane answered "unknown app session" until the
// session started): a session's record once it has one; before its first send, its setup intent's location, which is
// where it will run: the chosen directory, an existing worktree, or for a worktree still to be made its repository
// until the setup makes it. A New chat with no project chosen yet has none. P5 O3-C (reader R12): both through the view.
export function allowlistOf(view: Pick<SpineView, 'record' | 'intent'>): (appSessionId: AppSessionId) => AllowlistRecord | null {
  return (appSessionId) => {
    const record = view.record(appSessionId);
    if (record !== null) return record;
    const intent = view.intent(appSessionId);
    const location = intent?.location ?? null;
    if (intent === null || intent === undefined || location === null) return null;
    const directory = location.kind === 'newWorktree' ? (intent.progress.worktree?.path ?? location.repoRoot) : location.path;
    return { directory, additionalDirectories: intent.additionalDirectories, worktree: null };
  };
}

// The roots in record order (directory, additional directories, worktree), deduplicated by realpath, then the launch
// folder and the working folder where a fact names them and the admission holds now (UX wave U8c-2, `admittedFolder`);
// for a remote caller (`remoteHomes`, the machine's homes' realpaths: machineHomes), less any that is a home or above one.
export async function rootsOf(record: AllowlistRecord, remoteHomes?: readonly string[]): Promise<string[]> {
  const declared = [record.directory, ...record.additionalDirectories, ...(record.worktree ? [record.worktree.path] : [])];
  const [resolved, facts] = await Promise.all([Promise.all(declared.map(realpathOrNull)), Promise.all([admittedFolder(record, 'launch'), admittedFolder(record, 'path')])]);
  const admitted = facts.flatMap((fact) => (fact?.checked === true ? [fact.folder] : []));
  const roots = [...new Set([...resolved.filter((root): root is string => root !== null), ...admitted])];
  return remoteHomes === undefined ? roots : roots.filter((root) => !coversHome(root, remoteHomes));
}

// UX wave U8c-2 (docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md, §G, M3 decision 3): the one
// admission of a folder that comes from one of the record's two facts, evaluated at the act. The selector's `launch` or
// `path` that is the record's own directory or worktree is answered as the record names it (`checked` false: a root
// trusted and resolved by each caller as today, nothing read). Any other is admitted only when, read now: it and the
// record's directory resolve; git finds a work tree for its realpath (the folder holding the nearest `.git` at or above
// it); and that work tree is itself one of the work trees of the repository the directory is in (the main one, or one its
// `worktrees/` entries name), of the same common git directory. Then `{ folder: realpath, checked: true }`, the value the
// check ran on, which the caller uses; else null, any failure to read included. A listed work tree that merely contains
// the folder is not enough: a repository made inside one, or a submodule, has a work tree of its own. Read from git's own
// files (src/shared/machine/git-reads.ts), no process started and nothing kept between calls. The endpoint reads the same
// predicate through the machine's `git.worktree.list` (src/endpoint/targets.ts); one table of cases holds both
// (test/support/admission-cases.ts).
export async function admittedFolder(record: AllowlistRecord, which: 'launch' | 'path'): Promise<{ folder: string; checked: boolean } | null> {
  const folder = workingFolder(record)[which];
  if (folder === record.directory || folder === record.worktree?.path) return { folder, checked: false };
  const [real, anchor] = await Promise.all([realpathOrNull(folder), realpathOrNull(record.directory)]);
  if (real === null || anchor === null) return null;
  try {
    const [at, home] = await Promise.all([discoverRepo(real, PLAIN_FILES), discoverRepo(anchor, PLAIN_FILES)]);
    if (at === null || home === null || at.workTree === null || at.commonDir !== home.commonDir) return null;
    const trees = await Promise.all((await worktreeList(home, PLAIN_FILES)).map((tree, i) => (i === 0 && !tree.bare && tree.path === home.commonDir ? mainOf(home) : realpathOrNull(tree.path))));
    return trees.includes(at.workTree) ? { folder: real, checked: true } : null;
  } catch {
    return null; // git's layout refused, or a read failed: no root
  }
}

const realpathOrNull = (path: string): Promise<string | null> => fs.promises.realpath(path).catch(() => null);

// The main work tree of a repository whose git dir is apart from it, which git's list names by the git dir itself: the
// checkout the worktree service takes for it (src/services/git/main-checkout.ts, the one repair both readers use), read
// from git's own files; null where none is known (the record's directory in a linked worktree outside its checkout).
const mainOf = async (home: GitRepo): Promise<string | null> =>
  home.workTree === null
    ? null
    : mainCheckout(
        { toplevel: home.workTree, gitDir: home.gitDir, commonDir: home.commonDir },
        { canonical: PLAIN_FILES.real, pointer: async (path) => (await PLAIN_FILES.read(path, POINTER_MAX))?.toString('utf8') ?? null },
      );

// Nothing there (ENOENT; ENOTDIR, a path through a file) is an absence, which the reader answers null; any other failure
// (EACCES, EIO, ELOOP, …) is thrown, so the admission refuses where git itself would stop (§G: a read that fails refuses).
const absent = (error: unknown): null => {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return null;
  throw error;
};

// Git's files as they are, for `admittedFolder`: plain reads with no home walk (the files service reads the session's own
// folders, which it was given). A read is of a regular file only, never a FIFO's open, which would block.
const PLAIN_FILES: GitFiles = {
  real: (path) => fs.promises.realpath(path).catch(absent),
  async entry(path) {
    const stat = await fs.promises.lstat(path).catch(absent);
    return stat === null ? null : stat.isSymbolicLink() ? 'link' : stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other';
  },
  async read(path, max) {
    const at = await PLAIN_FILES.real(path);
    if (at === null || (await fs.promises.lstat(at).catch(absent))?.isFile() !== true) return null;
    const handle = await fs.promises.open(at, 'r').catch(absent);
    if (handle === null) return null;
    try {
      const { size } = await handle.stat();
      if (size > max) return null;
      const bytes = Buffer.alloc(size);
      const { bytesRead } = await handle.read(bytes, 0, size, 0);
      return bytes.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
  list: (path) => fs.promises.readdir(path).catch(absent),
  async fileSize(path) {
    const stat = await fs.promises.lstat(path).catch(absent);
    return stat?.isFile() === true ? stat.size : null;
  },
  async device(path) {
    return (await fs.promises.stat(path).catch(absent))?.dev ?? null;
  },
};

// Whether a realpath lies under a root: equal to it, or inside it at a segment boundary (`/repo2` is not under `/repo`).
export function under(root: string, real: string): boolean {
  if (real === root) return true;
  return real.startsWith(root.endsWith(sep) ? root : root + sep);
}
