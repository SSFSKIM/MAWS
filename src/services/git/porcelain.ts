// Parsers for the git output the service reads (C4 execution document, M6). Pure functions over stdout, so every
// format is pinned without a repository: `status --porcelain=v2 --branch -z`, `rev-parse`, `for-each-ref` with NUL
// separated fields, `diff --numstat -z` and `log -z` with NUL separated fields.
import type { GitBranches, GitCommit, GitDiffFile, GitFileStatus } from '@shared/ipc/schema/git';

export interface ParsedStatus {
  branch: string | null;
  head: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
}

// Porcelain v2 record types by their first character: how many space-separated fields precede the path, and whether a
// second NUL-terminated path (the rename or copy source) follows. `!` (ignored) never makes the tree dirty and is not
// listed; `#` headers are read separately.
const RECORDS: Record<string, { fields: number; source: boolean; untracked: boolean; listed: boolean }> = {
  '1': { fields: 8, source: false, untracked: false, listed: true }, // 1 XY sub mH mI mW hH hI path
  '2': { fields: 9, source: true, untracked: false, listed: true }, // 2 XY sub mH mI mW hH hI Xscore path \0 origPath
  u: { fields: 10, source: false, untracked: false, listed: true }, // u XY sub m1 m2 m3 mW h1 h2 h3 path
  '?': { fields: 1, source: false, untracked: true, listed: true }, // ? path
  '!': { fields: 1, source: false, untracked: false, listed: false }, // ! path
};

export function parseStatus(out: string): ParsedStatus {
  const status: ParsedStatus = { branch: null, head: '', upstream: null, ahead: 0, behind: 0, files: [] };
  const entries = out.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === '') continue;
    if (entry.startsWith('# ')) {
      readHeader(status, entry.slice(2));
      continue;
    }
    const record = RECORDS[entry[0]];
    if (!record || entry[1] !== ' ') throw new Error(`unknown porcelain record: ${entry.slice(0, 40)}`);
    const parts = entry.split(' ');
    const path = parts.slice(record.fields).join(' ');
    const oldPath = record.source ? entries[++i] : null;
    if (!record.listed) continue;
    const xy = record.untracked ? '??' : parts[1];
    status.files.push({ path, oldPath, index: xy[0], worktree: xy[1], untracked: record.untracked });
  }
  return status;
}

function readHeader(status: ParsedStatus, header: string): void {
  const space = header.indexOf(' ');
  const key = header.slice(0, space);
  const value = header.slice(space + 1);
  switch (key) {
    case 'branch.oid':
      status.head = value === '(initial)' ? '' : value;
      break;
    case 'branch.head':
      status.branch = value === '(detached)' ? null : value;
      break;
    case 'branch.upstream':
      status.upstream = value;
      break;
    case 'branch.ab': {
      const match = /^\+(\d+) -(\d+)$/.exec(value);
      if (match) [status.ahead, status.behind] = [Number(match[1]), Number(match[2])];
      break;
    }
    // Other headers (`stash`, and whatever a later git adds) are not read.
  }
}

// `rev-parse --path-format=absolute --show-toplevel --git-dir --git-common-dir`: one path per line.
export function parseRevParse(out: string): { repoRoot: string; gitDir: string; commonDir: string } {
  const [repoRoot, gitDir, commonDir] = out.replace(/\n$/, '').split('\n');
  return { repoRoot, gitDir, commonDir };
}

// The remote an upstream names: `origin/main` → `origin`. An upstream without a slash is a local branch (remote `.`).
export function upstreamRemote(upstream: string | null): string | null {
  if (upstream === null) return null;
  const slash = upstream.indexOf('/');
  return slash > 0 ? upstream.slice(0, slash) : null;
}

// `for-each-ref --format=%(refname:short)%00%(upstream:short)%00%(HEAD) refs/heads`: one line per branch.
export function parseBranches(out: string): GitBranches {
  const branches = out
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [name, upstream, head] = line.split('\0');
      return { name, upstream: upstream || null, isCurrent: head === '*' };
    });
  return { current: branches.find((b) => b.isCurrent)?.name ?? null, branches };
}

// `diff --numstat -z`: `<ins>\t<del>\t<path>\0`, or for a rename `<ins>\t<del>\t\0<old>\0<new>\0`; `-` counts mark a binary.
export function parseNumstat(out: string): GitDiffFile[] {
  const tokens = out.split('\0');
  const files: GitDiffFile[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(tokens[i]);
    if (!match) continue; // the trailing empty token
    const binary = match[1] === '-';
    let path = match[3];
    let oldPath: string | null = null;
    if (path === '') {
      oldPath = tokens[++i];
      path = tokens[++i];
    }
    files.push({ path, oldPath, insertions: binary ? 0 : Number(match[1]), deletions: binary ? 0 : Number(match[2]), binary });
  }
  return files;
}

// `log --format=%H%x00%h%x00%an%x00%aI%x00%s%x00%P -z`: six NUL-separated fields per commit and a NUL between commits.
export function parseLog(out: string): GitCommit[] {
  if (out === '') return [];
  const tokens = out.split('\0');
  if (tokens.length % 6 === 1 && tokens.at(-1) === '') tokens.pop();
  const commits: GitCommit[] = [];
  for (let i = 0; i + 6 <= tokens.length; i += 6) {
    const [sha, shortSha, author, authoredAt, subject, parents] = tokens.slice(i, i + 6);
    commits.push({ sha, shortSha, author, authoredAt, subject, parents: parents === '' ? [] : parents.split(' ') });
  }
  return commits;
}
