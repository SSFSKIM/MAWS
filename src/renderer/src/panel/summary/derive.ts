// The summary's pure derivations (C8a execution document, Interfaces *Summary derivations*): the change line from C4's
// status and uncommitted diff, the push state and its GitHub link, background work by kind, and the Sources list and
// Subagents glyph line over C6's disclosure-independent `turnActivity` (never the disclosed rows, which change as the
// reader collapses turns).
import type { EngineSessionStatus } from '@shared/engine/status';
import type { GitDiffFile, GitStatus } from '@shared/ipc/schema/git';
import type { SubagentRef, TurnActivity } from '../../transcript';

export type ChangeLine =
  | { kind: 'clean' }
  | { kind: 'change'; insertions: number; deletions: number; files: number; untracked: number; binary: number }
  | { kind: 'unknown' };

// Clean when the tree is (git.diff is not called then); otherwise the diff's non-binary sums, K from the status (so
// untracked files count in K and not in the sums, since `git diff HEAD` excludes them); unknown until the diff answers.
export function changeLine(status: GitStatus | null, uncommitted: GitDiffFile[] | null): ChangeLine {
  if (status && !status.dirty) return { kind: 'clean' };
  if (!status || !uncommitted) return { kind: 'unknown' };
  let insertions = 0;
  let deletions = 0;
  let binary = 0;
  for (const file of uncommitted) {
    if (file.binary) binary += 1;
    else {
      insertions += file.insertions;
      deletions += file.deletions;
    }
  }
  return { kind: 'change', insertions, deletions, files: status.files.length, untracked: status.files.filter((f) => f.untracked).length, binary };
}

export type PushState = { kind: 'not_pushed' } | { kind: 'ahead'; ahead: number; behind: number; upstream: string };

export function pushState(status: GitStatus): PushState {
  return status.upstream === null ? { kind: 'not_pushed' } : { kind: 'ahead', ahead: status.ahead, behind: status.behind, upstream: status.upstream };
}

// `git@github.com:o/r.git`, `ssh://git@github.com/o/r.git` and `https://github.com/o/r(.git)` name one repository.
const GITHUB_REMOTE = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;

export function githubUrl(remoteUrl: string | null, branch: string | null): string | null {
  const match = remoteUrl === null ? null : GITHUB_REMOTE.exec(remoteUrl);
  if (!match) return null;
  const repo = `https://github.com/${match[1]}/${match[2]}`;
  return branch === null ? repo : `${repo}/tree/${branch}`;
}

export interface BackgroundCounts {
  shells: number;
  workflows: number;
  monitors: number;
  other: number;
}

// Agents are Subagents' to count; a monitor is matched by prefix and anything unnamed kept as `other` rather than
// guessed (the fixtures show `local_bash`, `local_workflow` and `local_agent` only).
export function backgroundCounts(tasks: EngineSessionStatus['backgroundTasks']): BackgroundCounts {
  const counts: BackgroundCounts = { shells: 0, workflows: 0, monitors: 0, other: 0 };
  for (const { taskType } of tasks) {
    if (taskType === 'local_agent') continue;
    if (taskType === 'local_bash') counts.shells += 1;
    else if (taskType === 'local_workflow') counts.workflows += 1;
    else if (taskType.startsWith('monitor')) counts.monitors += 1;
    else counts.other += 1;
  }
  return counts;
}

export type Source =
  | { kind: 'file'; path: string; at: string }
  | { kind: 'web'; url: string; host: string; at: string }
  | { kind: 'mcp'; tool: string; server: string; at: string };

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

// One source per path, URL or MCP tool (read and edited alike; the newest use wins), newest first, bounded.
export function sourcesOf(turns: TurnActivity[], limit = 10): Source[] {
  const byKey = new Map<string, Source>();
  const keep = (key: string, source: Source) => {
    const held = byKey.get(key);
    if (!held || held.at < source.at) byKey.set(key, source);
  };
  for (const turn of turns) {
    for (const { path, at } of turn.files) keep(`file:${path}`, { kind: 'file', path, at });
    for (const { url, mcp, at } of turn.tools) {
      const host = url === null ? null : hostOf(url);
      if (url !== null && host !== null) keep(`web:${url}`, { kind: 'web', url, host, at });
      if (mcp) keep(`mcp:${mcp.server}/${mcp.tool}`, { kind: 'mcp', server: mcp.server, tool: mcp.tool, at });
    }
  }
  // A stable sort on the ISO times: equal times keep first-seen order.
  return [...byKey.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

const TERMINAL = new Set(['finished', 'finished_with_errors', 'stopped']);

// The activity's children, those still running before the finished, bounded. Each entry is the ref itself (with its
// status), so the glyph line hands it to C6's `SubagentGlyph` as the transcript does.
export function agentGlyphs(turns: TurnActivity[], limit = 4): (SubagentRef & { status: TurnActivity['subagents'][number]['status'] })[] {
  const all = turns.flatMap((turn) => turn.subagents);
  return [...all.filter((a) => !TERMINAL.has(a.status)), ...all.filter((a) => TERMINAL.has(a.status))].slice(0, limit);
}
