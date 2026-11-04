// What a remote setup's registration and trust read touch beyond the folder itself (P5 O7 M9, "Remote setup"; the task
// review's finding 3), checked before any git call or file read, by the endpoint's setup policy (with the folders the
// member opened) and again by the guarded handlers (src/services/machine/setup.ts, with the folders the checked
// directory itself is in): every pointer git or the trust reader follows from the folder is resolved by the home's walk
// (./home-folders.ts) and held to the same protected rule.
//
// - git's discovery: the nearest `.git` from the folder up. A directory is the git dir; a file names one (`gitdir:`),
//   relative to its folder. The git dir's `commondir`, relative to it, names the common dir (else the git dir is it). The
//   main checkout is the common dir's folder when it is named `.git` (the project fold's content check reads there), and
//   each linked worktree the common dir lists (`worktrees/*/gitdir`, the worktree's `.git` file) is read by
//   `git worktree list`.
// - the trust read's files: `.claude/settings.json`, `.claude/settings.local.json` and `.mcp.json`, each followed.
// A pointer that leads nowhere (a pruned worktree, a missing file) touches nothing past what was checked, so it is no
// refusal; one through an unopened protected folder is `protected`. A pointer may lead out of the home: nothing outside it
// is protected.
import { lstat, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { walk, type Home, type HomeRefusal } from './home-folders';

/** The files the trust read reads in the folder (src/services/sessions/trust.ts' `gatedFiles`). */
export const TRUST_FILES = ['.claude/settings.json', '.claude/settings.local.json', '.mcp.json'] as const;
/** A pointer file is a line; anything longer is no pointer git writes. */
const POINTER_MAX = 4096;

type Opened = (folder: string) => boolean;

/** Why a setup's reads past `directory` (its checked real path) would touch an unopened protected folder, or null. */
export async function setupReadsRefusal(directory: string, where: Home, opened: Opened, options: { trustFiles: boolean }): Promise<HomeRefusal | null> {
  const git = await gitRefusal(directory, where, opened);
  if (git !== null) return git;
  if (!options.trustFiles) return null;
  for (const file of TRUST_FILES) {
    const refusal = await pointerRefusal(join(directory, file), where, opened, true);
    if (refusal !== null) return refusal;
  }
  return null;
}

/**
 * Whether reading `path` (a file the trust read opens) touches no unopened protected folder: the guard the trust reader
 * asks before each read in a guarded run.
 */
export async function readable(path: string, where: Home, opened: Opened): Promise<boolean> {
  return (await pointerRefusal(path, where, opened, true)) === null;
}

/** `path` followed (a file when `file`): null when it leads nowhere or somewhere readable. */
async function pointerRefusal(path: string, where: Home, opened: Opened, file: boolean): Promise<HomeRefusal | null> {
  const resolved = await walk(path, where, { opened, outside: true, file });
  return resolved.ok || resolved.reason === 'no-folder' ? null : resolved.reason;
}

async function gitRefusal(directory: string, where: Home, opened: Opened): Promise<HomeRefusal | null> {
  // the nearest `.git`, from the folder up: each folder on the way is the checked directory or one holding it
  let holder: string | null = null;
  for (let folder = directory; ; folder = dirname(folder)) {
    if (await exists(join(folder, '.git'))) {
      holder = folder;
      break;
    }
    if (dirname(folder) === folder) break;
  }
  if (holder === null) return null;
  const dotGit = await walk(join(holder, '.git'), where, { opened, outside: true, file: true });
  if (!dotGit.ok) return dotGit.reason === 'no-folder' ? null : dotGit.reason;
  const gitDir = (await isDirectory(dotGit.real)) ? dotGit.real : await followPointer(dotGit.real, holder, /^gitdir: (.+)$/m, where, opened);
  if (gitDir === null || typeof gitDir === 'object') return gitDir === null ? null : gitDir.refusal;
  const common = await followPointer(join(gitDir, 'commondir'), gitDir, /^(.+)$/m, where, opened);
  if (common !== null && typeof common === 'object') return common.refusal;
  const commonDir = common ?? gitDir;
  if (basename(commonDir) === '.git') {
    const main = await pointerRefusal(dirname(commonDir), where, opened, false);
    if (main !== null) return main;
  }
  let worktrees: string[];
  try {
    worktrees = await readdir(join(commonDir, 'worktrees'));
  } catch {
    return null;
  }
  for (const id of worktrees) {
    const entry = await followPointer(join(commonDir, 'worktrees', id, 'gitdir'), join(commonDir, 'worktrees', id), /^(.+)$/m, where, opened, true);
    if (entry !== null && typeof entry === 'object') return entry.refusal;
    if (entry !== null) {
      const refusal = await pointerRefusal(dirname(entry), where, opened, false); // `git worktree list` reads the worktree's `.git` there
      if (refusal !== null) return refusal;
    }
  }
  return null;
}

/**
 * The path the pointer file `file` names (its `pattern`'s first group, relative to `base`), resolved by the walk: null
 * when there is no such file or it names nowhere, a refusal when reading or following it would touch an unopened
 * protected folder. `named`: answer the named path itself (a worktree's `.git` file), not its resolution.
 */
async function followPointer(file: string, base: string, pattern: RegExp, where: Home, opened: Opened, named = false): Promise<string | { refusal: HomeRefusal } | null> {
  const at = await walk(file, where, { opened, outside: true, file: true });
  if (!at.ok) return at.reason === 'no-folder' ? null : { refusal: at.reason };
  let text: string;
  try {
    text = (await readFile(at.real, 'utf8')).slice(0, POINTER_MAX);
  } catch {
    return null;
  }
  const match = pattern.exec(text);
  if (match === null) return null;
  const target = match[1].trim();
  const path = isAbsolute(target) ? target : `${base}${sep}${target}`; // the walk climbs its `..` as the kernel does
  if (named) return path;
  const resolved = await walk(path, where, { opened, outside: true });
  if (!resolved.ok) return resolved.reason === 'no-folder' ? null : { refusal: resolved.reason };
  return resolved.real;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}
