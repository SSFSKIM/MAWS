// Git's metadata read directly, for a remote setup's reads before trust (P5 O7 M9,
// docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Remote setup"; the task review's round 2). The machine's
// git is hardened (src/services/git/runner.ts: no fsmonitor, no hooks, no helpers), so running it in a folder runs
// nothing the folder names; but git still reads whatever the folder's config points it at (an `[include]`, an
// `[includeIf]`, an excludes or attributes file), and that may be in a protected folder nobody opened. So until the
// folder's trust is accepted its git is not run: what the registration and the trust read need of git is read here, each
// file through the home's walk (./home-folders.ts), and nothing a config names is followed.
//
// What is read, each as git reads it: the nearest `.git` from the folder up (a directory, else a file naming one), the
// git dir's `commondir`, the config (the common dir's, and the git dir's `config.worktree` where the repository turns it
// on), and the common dir's `worktrees` (./git-objects.ts reads HEAD and the object store). Git's rules mirrored: a
// folder that is itself a git dir is a bare repository's; outside a linked worktree, `core.worktree` names the work
// tree, relative to the git dir, and `core.bare` leaves none. Not mirrored, since none changes a key: git's ownership check (`safe.directory`) and its stop
// at a file-system boundary.
import { lstat, open, readdir, type FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { walk, type Home, type HomeRefusal } from './home-folders';

/** A read refused: it would touch an unopened protected folder (or leave the home through a link where that is refused). */
export class SetupReadRefused extends Error {
  constructor(
    readonly reason: HomeRefusal,
    readonly path: string,
  ) {
    super(`${reason}: ${path}`);
  }
}

/** What git refuses: a `.git` file that names no git dir, a config line it cannot parse, a repository format it doesn't know. */
export class GitLayoutError extends Error {}

/** The files a read may touch, each reached through the walk; a refusal throws `SetupReadRefused`. */
export interface GitFiles {
  /** The real path `path` leads to, links followed (a file or a directory), or null when it leads nowhere. */
  real(path: string): Promise<string | null>;
  /** What `path` itself is, its last link not followed (git's lstat), or null when there is nothing. */
  entry(path: string): Promise<'file' | 'directory' | 'link' | 'other' | null>;
  /** The bytes of the regular file `path` leads to, or null when there is none or it is larger than `max`. */
  read(path: string, max: number): Promise<Buffer | null>;
  /** The names in the directory `path` leads to, or null when there is none. */
  list(path: string): Promise<string[] | null>;
  /** The regular file `path` leads to, opened for reading, or null; the caller closes it. */
  open(path: string): Promise<FileHandle | null>;
}

/** The files under `where` read so that nothing inside a protected folder `opened` doesn't admit is touched. */
export function guardedFiles(where: Home, opened: (folder: string) => boolean): GitFiles {
  const real = async (path: string): Promise<string | null> => {
    const resolved = await walk(path, where, { opened, outside: true, file: true });
    if (resolved.ok) return resolved.real;
    if (resolved.reason === 'no-folder') return null;
    throw new SetupReadRefused(resolved.reason, path);
  };
  const regular = async (path: string): Promise<string | null> => {
    const at = await real(path);
    return at !== null && (await lstat(at).catch(() => null))?.isFile() === true ? at : null; // never a FIFO's open, which blocks
  };
  return {
    real,
    async entry(path) {
      const folder = await real(dirname(path)); // a folder's real path is one whose inside may be read
      if (folder === null) return null;
      const stat = await lstat(join(folder, basename(path))).catch(() => null);
      return stat === null ? null : stat.isSymbolicLink() ? 'link' : stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other';
    },
    async read(path, max) {
      const at = await regular(path);
      if (at === null) return null;
      const handle = await open(at, 'r').catch(() => null);
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
    async list(path) {
      const at = await real(path);
      return at === null ? null : readdir(at).catch(() => null);
    },
    async open(path) {
      const at = await regular(path);
      return at === null ? null : open(at, 'r').catch(() => null);
    },
  };
}

// ---- the config ---------------------------------------------------------------------------------------------------------

/** A config's entries in file order, each named as `git config --list` names it; `value` null for a key with no `=`. */
export interface GitConfig {
  entries: { name: string; value: string | null }[];
  /** The last value of `name` (its section and key in any case), null for a key with no `=`; undefined when unset. */
  get(name: string): string | null | undefined;
  /** `name` read as git reads a boolean; undefined when unset or not one. */
  bool(name: string): boolean | undefined;
}

/** A config file's most git writes in practice; anything larger is no config a read here takes. */
const CONFIG_MAX = 1024 * 1024;

/** The canonical form of a name for lookup: section and key lower-cased, a subsection kept as written. */
function canonicalName(name: string): string {
  const first = name.indexOf('.');
  const last = name.lastIndexOf('.');
  if (first === -1) return name.toLowerCase();
  if (first === last) return name.toLowerCase();
  return `${name.slice(0, first).toLowerCase()}.${name.slice(first + 1, last)}.${name.slice(last + 1).toLowerCase()}`;
}

function configOf(entries: GitConfig['entries']): GitConfig {
  return {
    entries,
    get(name) {
      const wanted = canonicalName(name);
      let value: string | null | undefined;
      for (const entry of entries) if (entry.name === wanted) value = entry.value;
      return value;
    },
    bool(name) {
      const value = this.get(name);
      if (value === undefined) return undefined;
      if (value === null) return true;
      const word = value.toLowerCase();
      if (['true', 'yes', 'on'].includes(word)) return true;
      if (['false', 'no', 'off', ''].includes(word)) return false;
      return /^-?\d+$/.test(word) ? Number(word) !== 0 : undefined;
    },
  };
}

const KEY_CHAR = /[A-Za-z0-9-]/;
const SECTION_CHAR = /[A-Za-z0-9.-]/;

/**
 * A config's entries as git's own parser takes them (config.c: `git_parse_source`): sections `[name]`, `[name "sub"]` and
 * the legacy `[name.sub]`; keys with or without a value; values with quotes, the escapes `\n` `\t` `\b` `\\` `\"`, a
 * trailing `\` continuing the line, comments after `#` or `;`, spaces outside quotes kept only between words. An
 * `[include]` or `[includeIf]` is an entry like any other; nothing here reads what it names. Throws `GitLayoutError` where
 * git reports a bad config line.
 */
export function parseConfig(text: string): GitConfig {
  const entries: GitConfig['entries'] = [];
  let i = text.startsWith('﻿') ? 1 : 0;
  let section: string | null = null;
  const bad = () => new GitLayoutError(`bad config line ${text.slice(0, i).split('\n').length}`);
  const peek = () => (i < text.length ? text[i] : '');
  while (i < text.length) {
    const c = text[i];
    if (c === '\n' || c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '#' || c === ';') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '[') {
      i++;
      let name = '';
      while (SECTION_CHAR.test(peek())) name += text[i++];
      if (peek() === ' ' || peek() === '\t') {
        while (peek() === ' ' || peek() === '\t') i++;
        if (peek() !== '"') throw bad();
        i++;
        let sub = '';
        for (;;) {
          const s = peek();
          if (s === '' || s === '\n') throw bad();
          i++;
          if (s === '"') break;
          if (s === '\\') {
            const escaped = peek();
            if (escaped === '' || escaped === '\n') throw bad();
            sub += escaped;
            i++;
          } else sub += s;
        }
        if (peek() !== ']' || name === '') throw bad();
        i++;
        section = `${name.toLowerCase()}.${sub}`;
      } else {
        if (peek() !== ']' || name === '') throw bad();
        i++;
        const dot = name.indexOf('.');
        section = dot === -1 ? name.toLowerCase() : `${name.slice(0, dot).toLowerCase()}.${name.slice(dot + 1).toLowerCase()}`; // the legacy form folds its subsection
      }
      continue;
    }
    if (section === null || !/[A-Za-z]/.test(c)) throw bad();
    let key = '';
    while (KEY_CHAR.test(peek())) key += text[i++];
    while (peek() === ' ' || peek() === '\t') i++;
    const name = `${section}.${key.toLowerCase()}`;
    if (peek() === '\r' && text[i + 1] === '\n') i++;
    if (peek() === '\n' || peek() === '') {
      entries.push({ name, value: null }); // a key with no `=` (git takes nothing else after one, not even a comment)
      continue;
    }
    if (peek() !== '=') throw bad();
    i++;
    entries.push({ name, value: parseValue() });
  }
  return configOf(entries);

  function parseValue(): string {
    let value = '';
    let spaces = 0; // spaces outside quotes, kept only once a word follows them
    let quoted = false;
    let comment = false;
    for (;;) {
      let c = peek();
      if (c === '\r' && text[i + 1] === '\n') c = text[++i];
      if (c === '' || c === '\n') {
        if (quoted) throw bad();
        if (c === '\n') i++;
        return value;
      }
      i++;
      if (comment) continue;
      if (!quoted && (c === ' ' || c === '\t')) {
        if (value.length > 0) spaces++;
        continue;
      }
      if (!quoted && (c === '#' || c === ';')) {
        comment = true;
        continue;
      }
      if (spaces > 0) {
        value += ' '.repeat(spaces);
        spaces = 0;
      }
      if (c === '\\') {
        let escaped = peek();
        if (escaped === '\r' && text[i + 1] === '\n') escaped = text[++i];
        i++;
        if (escaped === '\n') continue; // the line goes on
        const meant = { t: '\t', n: '\n', b: '\b', '\\': '\\', '"': '"' }[escaped];
        if (meant === undefined) throw bad();
        value += meant;
        continue;
      }
      if (c === '"') {
        quoted = !quoted;
        continue;
      }
      value += c;
    }
  }
}

// ---- the repository -----------------------------------------------------------------------------------------------------

/** A repository as git finds it from a folder: its work tree (null for a bare one), git dir, common dir and config, each real. */
export interface GitRepo {
  workTree: string | null;
  gitDir: string;
  commonDir: string;
  config: GitConfig;
}

/** A pointer file (`.git`, `commondir`, a worktree's `gitdir`) is a line; anything longer is no pointer git writes. */
const POINTER_MAX = 64 * 1024;

const text = (bytes: Buffer | null) => (bytes === null ? null : bytes.toString('utf8'));

/** The path a pointer names, relative to `base` unless absolute; the walk climbs its `..` as the kernel does. */
const named = (target: string, base: string) => (isAbsolute(target) ? target : `${base}${sep}${target}`);

/**
 * The repository the folder `directory` (a real path) is in, found as git finds it, or null when it is in none. Throws
 * `GitLayoutError` where git refuses the layout, `SetupReadRefused` where a read would touch an unopened protected folder.
 */
export async function discoverRepo(directory: string, files: GitFiles): Promise<GitRepo | null> {
  for (let folder = directory; ; folder = dirname(folder)) {
    const dot = join(folder, '.git');
    const at = await files.real(dot);
    if (at !== null) {
      const kind = await files.entry(at);
      if (kind === 'file') return repoAt(await gitfileTarget(at, folder, files), folder, files);
      if (kind === 'directory' && (await isGitDir(at, files))) return repoAt(at, folder, files);
    }
    if (await isGitDir(folder, files)) return repoAt(folder, null, files); // a bare repository, or a folder inside a git dir
    if (dirname(folder) === folder) return null;
  }
}

/** The git dir a `.git` file names (`gitdir: <path>`, relative to its folder), which must be one. */
async function gitfileTarget(file: string, folder: string, files: GitFiles): Promise<string> {
  const content = text(await files.read(file, POINTER_MAX));
  if (content === null || !content.startsWith('gitdir: ')) throw new GitLayoutError(`invalid gitfile format: ${file}`);
  const target = await files.real(named(content.slice('gitdir: '.length).trimEnd(), folder));
  if (target === null || !(await isGitDir(target, files))) throw new GitLayoutError(`not a git repository: ${file}`);
  return target;
}

/** git's `is_git_directory`: a HEAD that names a ref or an object, and the common dir's `objects` and `refs`. */
async function isGitDir(path: string, files: GitFiles): Promise<boolean> {
  const head = text(await files.read(join(path, 'HEAD'), POINTER_MAX));
  if (head === null || !(/^ref:\s*refs\//.test(head) || /^[0-9a-f]{40}/.test(head))) return false;
  const common = await commonDirOf(path, files);
  return common !== null && (await isDirectory(join(common, 'objects'), files)) && (await isDirectory(join(common, 'refs'), files));
}

async function isDirectory(path: string, files: GitFiles): Promise<boolean> {
  const at = await files.real(path);
  return at !== null && (await files.entry(at)) === 'directory';
}

/** The common dir of the git dir `gitDir`: its `commondir`'s, relative to it, else itself; null when that names nowhere. */
async function commonDirOf(gitDir: string, files: GitFiles): Promise<string | null> {
  const content = text(await files.read(join(gitDir, 'commondir'), POINTER_MAX));
  if (content === null) return gitDir;
  return files.real(named(content.trimEnd(), gitDir));
}

async function configAt(path: string, files: GitFiles): Promise<GitConfig['entries']> {
  const content = text(await files.read(path, CONFIG_MAX));
  return content === null ? [] : parseConfig(content).entries;
}

/** The repository whose git dir is `gitDir`, found through `.git` in `folder` (null: the git dir was found itself). */
async function repoAt(gitDir: string, folder: string | null, files: GitFiles): Promise<GitRepo> {
  const commonDir = await commonDirOf(gitDir, files);
  if (commonDir === null) throw new GitLayoutError(`no common dir: ${gitDir}`);
  let config = configOf(await configAt(join(commonDir, 'config'), files));
  const format = Number(config.get('core.repositoryformatversion') ?? '0');
  if (!(format === 0 || format === 1)) throw new GitLayoutError(`unknown repository format ${format}: ${commonDir}`);
  if (format === 1 && config.bool('extensions.worktreeconfig') === true) config = configOf([...config.entries, ...(await configAt(join(gitDir, 'config.worktree'), files))]);
  // a linked worktree's git dir (one with a `commondir`) takes neither `core.worktree` nor `core.bare`: its folder is its
  // work tree (setup.c: `check_repository_format_gently`'s `has_common`)
  const linked = (await files.read(join(gitDir, 'commondir'), POINTER_MAX)) !== null;
  const worktree = linked ? undefined : config.get('core.worktree');
  let workTree: string | null;
  if (linked) workTree = folder;
  else if (typeof worktree === 'string') {
    workTree = await files.real(named(worktree, gitDir));
    if (workTree === null) throw new GitLayoutError(`core.worktree names no folder: ${gitDir}`);
  } else workTree = config.bool('core.bare') === true ? null : folder;
  return { workTree, gitDir, commonDir, config };
}

/**
 * The repository's worktrees as `git worktree list` has them: the main one first (the common dir's real path, less a
 * trailing `/.git`; bare as `core.bare` says), then each the common dir's `worktrees/<id>/gitdir` names (less its
 * `/.git`, relative to that entry unless absolute). `worktrees` is walked before it is listed.
 */
export async function worktreeList(repo: GitRepo, files: GitFiles): Promise<{ path: string; bare: boolean }[]> {
  const main = repo.commonDir.endsWith(`${sep}.git`) ? repo.commonDir.slice(0, -'/.git'.length) : repo.commonDir;
  const entries = [{ path: main, bare: repo.config.bool('core.bare') === true }];
  const folder = await files.real(join(repo.commonDir, 'worktrees'));
  const ids = folder === null ? null : await files.list(folder);
  for (const id of (ids ?? []).sort()) {
    const content = text(await files.read(join(folder!, id, 'gitdir'), POINTER_MAX))?.trimEnd();
    if (!content) continue;
    const path = content.endsWith('/.git') ? content.slice(0, -'/.git'.length) : content;
    entries.push({ path: isAbsolute(path) ? path : `${join(folder!, id)}${sep}${path}`, bare: false });
  }
  return entries;
}
