// Where the engine reads a launch's local settings (`.claude/settings.local.json`, the "consent store"; P2-F wave S,
// S-catalogue): 2.1.296 keeps one store per repository, at its canonical root (the main checkout for a linked worktree,
// the repository root for a subdirectory) when that root passes the engine's checks, and reads the cwd's own file as a
// legacy overlay beneath it. Mirrored from the engine's `localSettings` base (SPEC 03 §4.2 and §4.4 at 2.1.287;
// 2.1.292 cli.pretty.js `zn` and `Bs` for the canonical root; the 2.1.296 binary carries the same base,
// `case"localSettings":{…return RN(FWn(n),n.canonicalGitRoot)}`, and the same three refusals), for the model catalogue's
// key only (models-cache.ts); MAWS passes no `--project-config-root`, which would pin the store to that directory.
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

// The local settings files a launch in `cwd` reads, lowest first: the cwd's own file, then the canonical root's over it
// when the store moved there.
export async function localSettingsFiles(cwd: string, home: string | null): Promise<string[]> {
  const here = resolve(cwd);
  const own = join(here, '.claude', 'settings.local.json');
  const root = await gitRoot(here);
  const base = root === null ? here : await storeBase(here, await canonicalRoot(root), home);
  return base === here ? [own] : [own, join(base, '.claude', 'settings.local.json')];
}

// The nearest directory at or above `dir` holding a `.git` entry (a directory, or a worktree's file); a symbolic link
// there, or none up to the filesystem root, is no repository.
async function gitRoot(dir: string): Promise<string | null> {
  for (let at = dir; ; at = dirname(at)) {
    const entry = await lstat(join(at, '.git')).catch(() => null);
    if (entry !== null) return entry.isDirectory() || entry.isFile() ? at : null;
    if (dirname(at) === at) return null;
  }
}

// The engine's canonical root of a repository root: for a linked worktree, whose `.git` file names
// `<common>/worktrees/<name>`, a directory whose `commondir` leads back to `<common>` and whose `gitdir` points back at
// this `.git`, the checkout holding `<common>`; anything else (a plain repository, a malformed or foreign `.git` file)
// is the root itself.
async function canonicalRoot(root: string): Promise<string> {
  try {
    const text = (await readFile(join(root, '.git'), 'utf8')).trim();
    if (!text.startsWith('gitdir:')) return root;
    const admin = resolve(root, text.slice('gitdir:'.length).trim());
    const common = resolve(admin, (await readFile(join(admin, 'commondir'), 'utf8')).trim());
    if (dirname(admin) !== join(common, 'worktrees')) return root;
    const back = resolve(admin, (await readFile(join(admin, 'gitdir'), 'utf8')).trim());
    if ((await realpath(back)) !== join(await realpath(root), '.git')) return root;
    if (basename(common) === '.git') return dirname(common);
    return (await lstat(join(common, '.git')).catch(() => null)) === null ? common : root; // a bare repository's worktree
  } catch {
    return root; // a directory `.git`, or an unreadable link in the chain
  }
}

// The store's directory: the canonical root when it is not the cwd, not the home directory, and it, its `.git` entry and
// its `.claude` entry (when present) belong to this user; otherwise the cwd.
async function storeBase(cwd: string, root: string, home: string | null): Promise<string> {
  if (root === cwd) return root;
  if (home !== null && root === (await realpath(home).catch(() => resolve(home)))) return cwd;
  const uid = process.geteuid?.();
  if (uid === undefined) return cwd;
  try {
    const [dir, git, claude] = await Promise.all([stat(root), lstat(join(root, '.git')), lstat(join(root, '.claude')).catch(() => null)]);
    return dir.uid === uid && git.uid === uid && (claude === null || claude.uid === uid) ? root : cwd;
  } catch {
    return cwd;
  }
}
