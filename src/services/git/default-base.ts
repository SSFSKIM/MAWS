// The default-branch rule (UX wave U5b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md,
// Interfaces §C and decision 13): the one answer to "what is this repository's default branch", read on the session's
// machine and used by Review's "This branch" and Source control's list of commits. Its first two steps, which remote
// and the branch that remote's HEAD names, are the scm service's (it calls them here, for a push's and a pull request's
// defaults); the rule adds the fallbacks after them. Every call only reads (`config`, `for-each-ref`, `symbolic-ref`,
// `rev-parse`, `merge-base`), and nothing fetches.
import { GitCommandError, type GitRun } from './runner';

export interface DefaultBase {
  ref: string; // `<remote>/<name>`, or a local branch's name
  commit: string; // what the ref names, when it was read
  mergeBase: string; // `git merge-base <ref> HEAD`
}

// The current branch's upstream remote, else `origin`, else the sole remote.
export async function defaultRemote(read: GitRun, directory: string, names: readonly string[]): Promise<string | null> {
  const current = (await read(directory, ['for-each-ref', '--format=%(HEAD)%00%(upstream:remotename)', 'refs/heads']))
    .split('\n')
    .find((line) => line.startsWith('*\0'));
  const upstream = current?.slice(2) ?? '';
  if (names.includes(upstream)) return upstream;
  if (names.includes('origin')) return 'origin';
  return names.length === 1 ? names[0] : null;
}

// The remote's HEAD branch (`refs/remotes/<remote>/HEAD`, set by clone or `remote set-head`), when git knows it. The
// full ref, not `--short`: a local branch named like the remote ref would make the short name ambiguous.
export async function remoteHeadBranch(read: GitRun, directory: string, remote: string): Promise<string | null> {
  try {
    const ref = (await read(directory, ['symbolic-ref', '-q', `refs/remotes/${remote}/HEAD`])).trim();
    const prefix = `refs/remotes/${remote}/`;
    return ref.startsWith(prefix) && ref.length > prefix.length ? ref.slice(prefix.length) : null;
  } catch (error) {
    if (error instanceof GitCommandError) return null;
    throw error;
  }
}

// The base "This branch" and the branch's commits are measured against. The remote is `defaultRemote`'s. The base ref
// is the first of these that names a commit: the branch the remote's HEAD names, `<remote>/main`, `<remote>/master`,
// local `main`, local `master`. Null when none does, when HEAD names no commit yet, when the ref shares no commit with
// HEAD, and when it is the local branch HEAD is on (the default branch with no remote copy). A detached HEAD is compared
// like any other.
export async function defaultBase(read: GitRun, directory: string): Promise<DefaultBase | null> {
  const ref = await defaultBaseRef(read, directory);
  const mergeBase = ref === null ? null : await mergeBaseWithHead(read, directory, ref.commit);
  return ref === null || mergeBase === null ? null : { ...ref, mergeBase };
}

// The rule's ref, before its merge base is asked: a caller can ask the merge base beside another read of the ref (the
// branch read's `behind`), since without a commit-graph each walks the history (P5).
export async function defaultBaseRef(read: GitRun, directory: string): Promise<Omit<DefaultBase, 'mergeBase'> | null> {
  const [names, onBranch, head] = await Promise.all([remoteNames(read, directory), currentBranchRef(read, directory), headCommit(read, directory)]);
  if (head === null) return null;
  const remote = names.length === 0 ? null : await defaultRemote(read, directory, names);
  const headBranch = remote === null ? null : await remoteHeadBranch(read, directory, remote);
  const candidates = [
    ...(remote === null ? [] : [...(headBranch === null ? [] : [`refs/remotes/${remote}/${headBranch}`]), `refs/remotes/${remote}/main`, `refs/remotes/${remote}/master`]),
    'refs/heads/main',
    'refs/heads/master',
  ];
  const commits = await commitsNamed(read, directory, candidates);
  const chosen = candidates.find((ref) => commits.has(ref));
  if (chosen === undefined || chosen === onBranch) return null;
  return { ref: shortName(chosen), commit: commits.get(chosen)! };
}

// `git merge-base <commit> HEAD`, or null when they share no commit (git exits 1 and prints nothing). `head`: HEAD's
// commit as the caller resolved it, so one read measures every step against the same HEAD (Decision Log 52).
export async function mergeBaseWithHead(read: GitRun, directory: string, commit: string, head = 'HEAD'): Promise<string | null> {
  return (await read(directory, ['merge-base', commit, head], { acceptExitCodes: [1] })).trim() || null;
}

// Every configured remote with a URL, by name (git exits 1 when there is none).
async function remoteNames(read: GitRun, directory: string): Promise<string[]> {
  const out = await read(directory, ['config', '-z', '--get-regexp', '^remote\\..*\\.url$'], { acceptExitCodes: [1] });
  const names = new Set<string>();
  for (const entry of out.split('\0')) {
    const newline = entry.indexOf('\n');
    if (newline !== -1) names.add(entry.slice('remote.'.length, newline - '.url'.length));
  }
  return [...names];
}

// `refs/heads/<branch>` HEAD is on, or null for a detached HEAD.
async function currentBranchRef(read: GitRun, directory: string): Promise<string | null> {
  return (await read(directory, ['symbolic-ref', '-q', 'HEAD'], { acceptExitCodes: [1] })).trim() || null;
}

// The commit HEAD names, or null before the first commit.
export async function headCommit(read: GitRun, directory: string): Promise<string | null> {
  return commitNamed(read, directory, 'HEAD');
}

// The commit a full ref name (or HEAD) names now, or null when it names none.
export async function commitNamed(read: GitRun, directory: string, name: string): Promise<string | null> {
  return (await read(directory, ['rev-parse', '-q', '--verify', `${name}^{commit}`], { acceptExitCodes: [1] })).trim() || null;
}

// Which of `refs` exist and name a commit, with the commit. `for-each-ref` matches a pattern from its start up to a
// slash, so only an exact name is taken; a symbolic ref whose target is gone is not listed.
async function commitsNamed(read: GitRun, directory: string, refs: readonly string[]): Promise<Map<string, string>> {
  const out = await read(directory, ['for-each-ref', '--format=%(refname)%00%(objecttype)%00%(objectname)', ...refs]);
  const named = new Map<string, string>();
  for (const line of out.split('\n')) {
    const [name, type, commit] = line.split('\0');
    if (type === 'commit' && refs.includes(name)) named.set(name, commit);
  }
  return named;
}

function shortName(ref: string): string {
  return ref.replace(/^refs\/(?:remotes|heads)\//, '');
}
