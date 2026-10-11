// Where the engine reads a launch's local settings (`.claude/settings.local.json`, the "consent store"; P2-F wave S,
// S-catalogue): 2.1.296 keeps one store per repository, at its canonical root (the main checkout for a linked worktree,
// the repository root for a subdirectory) when that root passes the engine's checks, and reads the cwd's own file as a
// legacy overlay beneath it. Mirrored from the engine's `localSettings` base (SPEC 03 §4.2 and §4.4 at 2.1.287;
// 2.1.292 cli.pretty.js `zn` and `Bs` for the canonical root; the 2.1.296 binary carries the same base,
// `case"localSettings":{…return RN(FWn(n),n.canonicalGitRoot)}`, and the same three refusals), for the model catalogue's
// key only (models-cache.ts); MAWS passes no `--project-config-root`, which would pin the store to that directory.
// The repository walk and the canonical root carry the engine's filesystem guards (S-catalogue review: a guard left
// out lets the key take the main checkout's store while the engine keeps the worktree's). Its network-path refusals
// are not mirrored (`zi`, and the mount checks inside its walk: `/net`, `/Network`, an automounted `/home`, UNC and
// `/.vol`-style paths), which keep it from touching an automount; a repository MAWS launches in is not reached that way.
import { lstat, readFile, readlink, realpath, stat } from 'node:fs/promises';
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

// The nearest directory at or above `dir` whose `.git` entry the engine takes for a repository's (2.1.296 `Vn` with
// `Ue`): a directory or a file, or a symbolic link whose text walks safely and which resolves to one. Any other entry
// (a dangling link, a FIFO) is walked past.
async function gitRoot(dir: string): Promise<string | null> {
  for (let at = dir; ; at = dirname(at)) {
    if (await isGitEntry(join(at, '.git'), at)) return at;
    if (dirname(at) === at) return null;
  }
}

// The engine's canonical root of a repository root (2.1.296 `Xn`, 2.1.292 `zn`): for a linked worktree, whose `.git`
// file names `<common>/worktrees/<name>`, a directory whose `commondir` leads back to `<common>` and whose `gitdir`
// points back at this `.git`, the checkout holding `<common>`; anything else is the root itself. Each guard the engine
// applies on that path is here: every path text must walk safely (`v_`), and `commondir` and `gitdir` must be plain
// files, never a symbolic link or a special file (`eU`), which is checked before either is read.
async function canonicalRoot(root: string): Promise<string> {
  try {
    const text = (await readFile(join(root, '.git'), 'utf8')).trim();
    if (!text.startsWith('gitdir:')) return root;
    const named = text.slice('gitdir:'.length).trim();
    if (!(await walksSafely(named, root))) return root;
    const admin = resolve(root, named);
    if (!(await isPlainFile(join(admin, 'commondir')))) return root;
    const commonText = (await readFile(join(admin, 'commondir'), 'utf8')).trim();
    if (!(await walksSafely(commonText, admin))) return root;
    const common = resolve(admin, commonText);
    if (dirname(admin) !== join(common, 'worktrees')) return root;
    if (!(await isPlainFile(join(admin, 'gitdir')))) return root;
    const backText = (await readFile(join(admin, 'gitdir'), 'utf8')).trim();
    if (!(await walksSafely(backText, admin))) return root;
    if ((await realpath(resolve(admin, backText))) !== join(await realpath(root), '.git')) return root;
    if (basename(common) === '.git') return dirname(common);
    return (await isGitEntry(join(common, '.git'), common)) ? root : common; // a bare repository's worktree
  } catch {
    return root; // a directory `.git`, or an unreadable file in the chain
  }
}

type Kind = 'file' | 'dir' | 'symlink' | 'special' | 'absent' | 'other';

// An entry's own kind, not following a link (2.1.296 `pt`): a missing path is absent, any other failure `other`.
async function kindOf(path: string): Promise<Kind> {
  try {
    const entry = await lstat(path);
    return entry.isSymbolicLink() ? 'symlink' : entry.isFile() ? 'file' : entry.isDirectory() ? 'dir' : 'special';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : 'other';
  }
}

// A symbolic link's text, or null when it cannot be read or is not valid UTF-8 free of NUL (2.1.296 `nMt`).
async function linkText(path: string): Promise<string | null> {
  try {
    const raw = await readlink(path, { encoding: 'buffer' });
    const text = raw.toString('utf8');
    return text.includes('\0') || !Buffer.from(text, 'utf8').equals(raw) ? null : text;
  } catch {
    return null;
  }
}

// Whether an absolute path walks safely component by component (2.1.296 `Me`): no component is a special file or
// fails to stat for a reason other than absence, and each symbolic link met has a readable text and is followed, the
// rest of the path appended to its target, within 40 links. A missing component is no refusal.
async function walks(path: string, links = 40): Promise<boolean> {
  if (links <= 0) return false;
  const parts = path.slice(1).split(/\/+/);
  let at = '/';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part === '' || part === '.') continue;
    if (part === '..') {
      at = dirname(at);
      continue;
    }
    at = join(at, part);
    const kind = await kindOf(at);
    if (kind === 'other' || kind === 'special') return false;
    if (kind !== 'symlink') continue;
    const text = await linkText(at);
    if (text === null) return false;
    const target = text.startsWith('/') ? text : `${dirname(at)}/${text}`;
    const rest = parts.slice(i + 1).join('/');
    return walks(rest === '' ? target : target.endsWith('/') ? target + rest : `${target}/${rest}`, links - 1);
  }
  return true;
}

// Whether a path text read from a git file walks safely from its base (2.1.296 `v_`): both as written (a relative text
// appended to the base, `..` taken after each link) and as resolved.
async function walksSafely(text: string, base: string): Promise<boolean> {
  const written = text.startsWith('/') ? text : `${base}/${text}`;
  if (!(await walks(written))) return false;
  const resolved = resolve(base, text);
  return resolved === written || walks(resolved);
}

// Whether a git admin file may be read (2.1.296 `eU` refuses otherwise): its path walks safely and the file itself is
// not a symbolic link, a special file or unstattable.
async function isPlainFile(path: string): Promise<boolean> {
  if (!(await walks(path))) return false;
  const kind = await kindOf(path);
  return kind !== 'symlink' && kind !== 'special' && kind !== 'other';
}

// Whether a `.git` entry makes its directory a repository (2.1.296 `Ue`): a directory or a file, or a symbolic link
// whose text walks safely from the directory and which resolves to a directory or a file.
async function isGitEntry(entry: string, dir: string): Promise<boolean> {
  try {
    const own = await lstat(entry);
    if (!own.isSymbolicLink()) return own.isDirectory() || own.isFile();
    const text = await linkText(entry);
    if (text === null || !(await walksSafely(text, dir))) return false;
    const target = await stat(entry);
    return target.isDirectory() || target.isFile();
  } catch {
    return false;
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
