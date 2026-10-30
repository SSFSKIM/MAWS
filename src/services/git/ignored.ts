// What git ignores in a repository, as the watch tree's prune (P5 O3-E M1, Interfaces §B; O3-G's item 2): the tree never
// walks or watches a directory git ignores. Read once when a root's watch starts, from two listings: the ignored
// entries (`ls-files -o -i --exclude-standard --directory`) and the rest (`ls-files -c -o --exclude-standard
// --directory`, tracked files and untracked ones, a wholly untracked directory collapsed). An ignored directory is one
// the first lists collapsed (`dir/`) with nothing of that listing beneath it: git also lists, as `dir/`, a directory
// whose entries are all ignored though it is not, and lists those entries after it; such a directory stays watched, so a
// file git would show there is seen. A directory either listing reaches existed when git listed, so the listings answer
// it; one they never reach (made later, or inside a collapsed untracked directory) is asked of `git check-ignore`, one
// call per batch window of at most CHECK_IGNORE_BATCH_MS for every directory asked in it, the directory held unwatched
// until its verdict. A batch git cannot answer (a path inside a submodule fails the whole call) admits its directories:
// watched rather than missed.
import type { GitRun } from './runner';

export const CHECK_IGNORE_BATCH_MS = 250; // the repository watcher's own debounce

export async function gitIgnored(run: GitRun, root: string): Promise<(dir: string) => Promise<boolean>> {
  const [ignoredOut, listedOut] = await Promise.all([
    run(root, ['ls-files', '-z', '-o', '-i', '--exclude-standard', '--directory']),
    run(root, ['ls-files', '-z', '-c', '-o', '--exclude-standard', '--directory']),
  ]);
  const ignoredEntries = entries(ignoredOut);
  const known = new Set<string>(); // every directory either listing reaches
  const above = new Set<string>(); // every directory with an entry of the ignored listing beneath it
  for (const entry of [...ignoredEntries, ...entries(listedOut)]) {
    if (entry.endsWith('/')) known.add(entry.slice(0, -1));
    for (const ancestor of ancestors(entry)) known.add(ancestor);
  }
  for (const entry of ignoredEntries) for (const ancestor of ancestors(entry)) above.add(ancestor);
  const ignored = new Set(ignoredEntries.filter((entry) => entry.endsWith('/')).map((entry) => entry.slice(0, -1)).filter((dir) => !above.has(dir)));
  const batch = new CheckIgnoreBatch(run, root);
  return async (dir) => {
    if (ignored.has(dir) || ancestors(dir).some((ancestor) => ignored.has(ancestor))) return true;
    if (known.has(dir)) return false;
    return batch.ask(dir);
  };
}

function entries(out: string): string[] {
  return out.split('\0').filter((entry) => entry !== '');
}

// `a/b/c` (or `a/b/c/`) → `a`, `a/b`.
function ancestors(path: string): string[] {
  const parts = path.replace(/\/$/, '').split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

class CheckIgnoreBatch {
  private waiting = new Map<string, ((ignored: boolean) => void)[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly run: GitRun,
    private readonly root: string,
  ) {}

  ask(dir: string): Promise<boolean> {
    return new Promise((resolve) => {
      const answers = this.waiting.get(dir) ?? [];
      answers.push(resolve);
      this.waiting.set(dir, answers);
      if (this.timer !== null) return;
      this.timer = setTimeout(() => void this.flush(), CHECK_IGNORE_BATCH_MS);
      this.timer.unref?.();
    });
  }

  private async flush(): Promise<void> {
    const asked = this.waiting;
    this.waiting = new Map();
    this.timer = null;
    let ignored: Set<string>;
    try {
      const input = [...asked.keys()].map((dir) => `${dir}\0`).join('');
      ignored = new Set(entries(await this.run(this.root, ['check-ignore', '-z', '--stdin'], { input, acceptExitCodes: [1] })));
    } catch {
      ignored = new Set();
    }
    for (const [dir, answers] of asked) for (const answer of answers) answer(ignored.has(dir));
  }
}
