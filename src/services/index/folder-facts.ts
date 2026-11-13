// The record's two facts (UX wave U8c-2; docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md, §B to §D):
// where the session was launched and where its agent is, written by the index beside every column build F's record
// carries. Those columns keep build F's rule (the record is filed at the folder the engine files the session under, its
// home); the facts are two nullable columns, each present only where it differs from what they say, and each stamped
// with the transcript's size and mtime that the same write stores, so a value build F has overtaken (F files a newer
// transcript and moves the size and mtime, never writing these columns) is not believed. Both are functions of one
// summary: nothing is remembered from an earlier one, and nothing read for the newest row's folder is kept.
import type { SessionRecord } from '@shared/graph/session';
import { branchName } from '@shared/sessions/branch';
import type { TranscriptSummary } from '@shared/wire/store';
import { checkoutIn, headBranch, locate, repositoryAt, type Location } from './projects';

export interface FolderColumns {
  launch_folder: string | null; // JSON { folder, size, mtimeMs }
  agent_folder: string | null; // JSON { checkout, cwd, branch, linked, size, mtimeMs }
}

const NONE: FolderColumns = { launch_folder: null, agent_folder: null };

// §B, from the summary's three folders: H, its first row's (`directory`); R, the home its tail names (`relocatedCwd`);
// C, its newest row's (`newestCwd`). `home` is where `upsertFromSummary` filed the record (`locate(R ?? H)`), and `stamp`
// the size and mtime the same write stores.
export function folderColumns(summary: TranscriptSummary, home: Location, stamp: { size: number; mtimeMs: number }): FolderColumns {
  const { directory: first, relocatedCwd: relocated, newestCwd: newest } = summary;
  if (newest === undefined || home.realpath === null) return NONE; // an older producer's summary, or the home is gone
  if (first === (relocated ?? first) && first === newest) return NONE; // one folder: nothing is read
  const filed = home.worktreePath ?? home.realpath;
  const directory = home.realpath;
  const launch = relocated !== null && relocated !== first ? launchOf(first, directory) ?? filed : filed;
  // Where the newest row names no checkout of the launch folder's repository (null, gone, elsewhere), the agent is taken
  // to be in the filed folder's checkout (Decision Log 12): the filed folder itself, but for a home the engine's `/cd` moved
  // into a plain sub-folder of a checkout, whose checkout is that checkout's root, never the sub-folder
  const at = (newest === null ? null : checkoutIn(launch, newest)) ?? checkoutIn(launch, directory);
  const agent =
    at === null || (at.checkout === filed && at.cwd === directory)
      ? null
      : {
          checkout: at.checkout,
          cwd: at.cwd,
          // the engine's rows describe the home's work tree; another checkout's branch is the one its HEAD names
          branch: at.workTree === null || at.workTree === repositoryAt(directory)?.workTree ? branchName(summary.gitBranch) : headBranch(at.workTree),
          linked: at.linked,
        };
  return {
    launch_folder: launch === filed ? null : JSON.stringify({ folder: launch, ...stamp }),
    agent_folder: agent === null ? null : JSON.stringify({ ...agent, ...stamp }),
  };
}

// The first row's folder, located as the index locates a record's folder, when the engine has re-homed the session
// inside that folder's repository; null when it is gone, in no repository, or in another than the home's (a session the
// person moved with `/cd` to another repository is launched there, as far as the window is concerned).
function launchOf(first: string | null, directory: string): string | null {
  const located = locate(first);
  if (located.realpath === null) return null;
  const [launched, filed] = [repositoryAt(located.realpath), repositoryAt(directory)];
  return launched !== null && filed !== null && launched.commonDir === filed.commonDir ? (located.worktreePath ?? located.realpath) : null;
}

// The facts a row's two columns give its record, each only while its stamp is the row's stored size and mtime. A value
// this build cannot read (another build's shape) gives none.
export function factsOf(row: { launch_folder?: string | null; agent_folder?: string | null; transcript_size: number | null; transcript_mtime_ms: number | null }): Partial<Pick<SessionRecord, 'launchFolder' | 'agentFolder'>> {
  const current = (value: Record<string, unknown> | null) => value !== null && value.size === row.transcript_size && value.mtimeMs === row.transcript_mtime_ms;
  const launch = parsed(row.launch_folder);
  const folder = launch?.folder;
  const launchFolder = current(launch) && typeof folder === 'string' ? folder : undefined;
  const agent = parsed(row.agent_folder);
  const [checkout, cwd, branch, linked] = [agent?.checkout, agent?.cwd, agent?.branch, agent?.linked];
  const agentFolder =
    current(agent) && typeof checkout === 'string' && typeof cwd === 'string' && (branch === null || typeof branch === 'string') && typeof linked === 'boolean'
      ? { checkout, cwd, branch, linked }
      : undefined;
  return { ...(launchFolder !== undefined && { launchFolder }), ...(agentFolder !== undefined && { agentFolder }) };
}

function parsed(text: string | null | undefined): Record<string, unknown> | null {
  if (typeof text !== 'string') return null;
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
