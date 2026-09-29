// `git.lsFiles`, the composer's `@` file source (C7 execution document, Interfaces "X2 additions"; C4's git invocation
// conventions through its runner): `git ls-files --cached --others --exclude-standard -z` in `directory`, so tracked and
// untracked files that are not ignored, relative to `directory`, with their parent directories (a trailing `/`) as
// items too; outside a repository, a bounded walk (depth 6, 20,000 entries, never into node_modules, .git, dist or
// .claude/worktrees). The listing is cached per directory for 10 s and filtered per query by the fuzzy scorer. Only a
// directory inside one a session or project names is listed, so the command cannot enumerate arbitrary paths.
import type { Dirent } from 'node:fs';
import { readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { rankPaths } from '@shared/composer/fuzzy';
import type { LsFiles, LsFilesInput } from '@shared/ipc/schema/git';
import { NotARepositoryError, type GitRun } from './runner';

export const CACHE_MS = 10_000;
export const WALK_MAX_DEPTH = 6;
export const WALK_MAX_ENTRIES = 20_000;
const SKIPPED = new Set(['node_modules', '.git', 'dist']);

export interface FileListerOptions {
  run: GitRun;
  roots: () => string[] | Promise<string[]>; // every session's and project's directories (and additional directories)
  walkMaxEntries?: number;
}

interface Listing {
  at: number;
  paths: string[];
  source: LsFiles['source'];
  capped: boolean; // the walk stopped at its entry cap
}

export class FileLister {
  private readonly cache = new Map<string, Listing>();

  constructor(private readonly opts: FileListerOptions) {}

  async list({ directory, query, limit }: LsFilesInput): Promise<LsFiles> {
    const resolved = await this.allowed(directory);
    let listing = this.cache.get(resolved);
    if (!listing || Date.now() - listing.at > CACHE_MS) {
      listing = await this.load(resolved);
      this.cache.set(resolved, listing);
    }
    const ranked = rankPaths(query, listing.paths);
    return { paths: ranked.slice(0, limit), truncated: ranked.length > limit || listing.capped, source: listing.source };
  }

  private async allowed(directory: string): Promise<string> {
    const resolved = await realpath(directory);
    const roots = await Promise.all((await this.opts.roots()).map((root) => realpath(root).catch(() => null)));
    const inside = roots.some((root) => root !== null && (resolved === root || resolved.startsWith(root.endsWith('/') ? root : `${root}/`)));
    if (!inside) throw new Error(`git.lsFiles: ${directory} is not a directory of any session or project`);
    return resolved;
  }

  private async load(directory: string): Promise<Listing> {
    try {
      const files = (await this.opts.run(directory, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])).split('\0').filter((p) => p !== '');
      return { at: Date.now(), paths: withDirectories(files), source: 'git', capped: false };
    } catch (error) {
      if (!(error instanceof NotARepositoryError)) throw error;
    }
    const { paths, capped } = await walk(directory, this.opts.walkMaxEntries ?? WALK_MAX_ENTRIES);
    return { at: Date.now(), paths, source: 'walk', capped };
  }
}

// The files and every directory above one of them, a directory written with its trailing `/`.
function withDirectories(files: string[]): string[] {
  const dirs = new Set<string>();
  for (const file of files) {
    for (let i = file.indexOf('/'); i !== -1; i = file.indexOf('/', i + 1)) dirs.add(file.slice(0, i + 1));
  }
  return [...files, ...dirs];
}

// Breadth first, so a cap keeps the shallow entries; symbolic links are listed and never followed.
async function walk(root: string, maxEntries: number): Promise<{ paths: string[]; capped: boolean }> {
  const paths: string[] = [];
  let level: string[] = [''];
  for (let depth = 0; depth <= WALK_MAX_DEPTH && level.length > 0; depth++) {
    const next: string[] = [];
    for (const rel of level) {
      let entries: Dirent[];
      try {
        entries = await readdir(join(root, rel), { withFileTypes: true });
      } catch {
        continue; // unreadable: skipped
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
          if (SKIPPED.has(entry.name) || path === '.claude/worktrees' || path.endsWith('/.claude/worktrees')) continue;
          paths.push(`${path}/`);
          next.push(path);
        } else {
          paths.push(path);
        }
        if (paths.length >= maxEntries) return { paths, capped: true };
      }
    }
    level = next;
  }
  return { paths, capped: false };
}
