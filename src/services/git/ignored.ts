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
const PARSE_SLICE_MS = 4; // the longest a listing's read holds the loop before it lets the walk run

export async function gitIgnored(run: GitRun, root: string): Promise<(dir: string) => Promise<boolean>> {
  const [ignoredOut, listedOut] = await Promise.all([
    run(root, ['ls-files', '-z', '-o', '-i', '--exclude-standard', '--directory']),
    run(root, ['ls-files', '-z', '-c', '-o', '--exclude-standard', '--directory']),
  ]);
  const known = new Set<string>(); // every directory either listing reaches
  const above = new Set<string>(); // every directory with an entry of the ignored listing beneath it
  const collapsed: string[] = []; // the ignored listing's `dir/` entries
  await eachEntry(ignoredOut, (entry) => {
    addAncestors(above, entry);
    addAncestors(known, entry, true);
    if (entry.endsWith('/')) collapsed.push(detached(entry.slice(0, -1)));
  });
  await eachEntry(listedOut, (entry) => addAncestors(known, entry, true));
  const ignored = new Set(collapsed.filter((dir) => !above.has(dir)));
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

// Each entry of a NUL-terminated listing, a slice of at most PARSE_SLICE_MS at a time with the loop free between: a
// kernel-sized checkout lists 80k paths (3.9 MB), which split whole held the loop 44 ms while the tree's walk ran beside
// it, and a first slice of 5,000 entries, its code not yet optimised, 10 to 26 ms (the VM measure of M1).
async function eachEntry(out: string, take: (entry: string) => void): Promise<void> {
  let start = 0;
  let read = 0;
  let since = performance.now();
  while (start < out.length) {
    let end = out.indexOf('\0', start);
    if (end < 0) end = out.length;
    if (end > start) take(out.slice(start, end));
    start = end + 1;
    if ((++read & 255) !== 0 || performance.now() - since < PARSE_SLICE_MS) continue;
    await new Promise((resolve) => setImmediate(resolve));
    since = performance.now();
  }
}

// A copy of a directory's name that holds nothing else: V8 keeps a longer substring as a view of the string it came
// from, and a listing git wrote is one string of megabytes, held outside the heap for as long as one view of it lives.
function detached(dir: string): string {
  return Buffer.from(dir).toString();
}

// Adds every directory above `entry` (and a `dir/` entry's own, with `self`), from the deepest up, stopping at one
// already there: its own ancestors were added with it.
function addAncestors(set: Set<string>, entry: string, self = false): void {
  let end = entry.endsWith('/') ? (self ? entry.length - 1 : entry.lastIndexOf('/', entry.length - 2)) : entry.lastIndexOf('/');
  while (end > 0) {
    const dir = entry.slice(0, end);
    if (set.has(dir)) return;
    set.add(detached(dir));
    end = entry.lastIndexOf('/', end - 1);
  }
}

// `a/b/c` → `a`, `a/b`.
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
