// The session's working folder (UX wave U8, contract UC-4): the checkout the agent is working in now, the one answer that
// Review, Source control, the terminal, the card, the composer, uploads and the endpoint read, so that they follow the
// agent together. No file reads the session's folder except through this selector, and no file outside this module
// reads the record's two facts it answers from (test/one-working-folder.test.ts, both rules).
//
// Second landing (U8c-2; docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md, §D): the record's own
// fields keep build F's meaning, the folder the engine files the session under (`filed` below), which a move by the
// engine's worktree tool changes and a shell `cd` does not. Beside them the index writes two optional facts from the
// transcript's newest rows: the folder the session was launched in, while the engine files it elsewhere in the same
// repository, and where the agent is, while that is not where the session is filed. Each overrides only where it is
// present, so a record without them (build F's, or one from a machine on build F) answers the filed folder. Imports
// nothing but the record's type and `branchName`: the renderer, main, the daemon, the services and the endpoint all
// bundle it.
import type { SessionRecord } from '../graph/session';
import { branchName } from './branch';

export interface WorkingFolder {
  path: string; // the checkout the agent is working in now
  cwd: string; // the agent's folder inside it
  launch: string; // the folder the session was launched in, which does not move while the agent moves in its repository
  moved: boolean; // path !== launch
}

// A field read later must stay optional in this Pick, as the files allowlist's record (src/services/files/allowlist.ts)
// passes here.
type Folders = Pick<SessionRecord, 'directory' | 'worktree'> & Partial<Pick<SessionRecord, 'launchFolder' | 'agentFolder'>>;

// Validates nothing: a record whose directory is '' answers '' (the index writes that when it knows none).
export function workingFolder(record: Folders): WorkingFolder {
  const filed = record.worktree?.path ?? record.directory; // where the engine files the session: build F's folder
  const launch = record.launchFolder ?? filed;
  const path = record.agentFolder?.checkout ?? filed;
  return { path, cwd: record.agentFolder?.cwd ?? record.directory, launch, moved: path !== launch };
}

// The linked worktree the agent is working in now; null in the repository's main checkout and in a folder that is no worktree.
export function workingWorktree(record: Folders): { path: string; branch: string | null } | null {
  const at = record.agentFolder;
  return at === undefined ? record.worktree : at.linked ? { path: at.checkout, branch: at.branch } : null;
}

// The branch recorded for the working folder; `HEAD` and empty are none. A reader that has git's answer shows that instead (branchLabel).
export function workingBranch(record: Folders & Pick<SessionRecord, 'branch'>): string | null {
  const at = record.agentFolder;
  return at === undefined ? (branchName(record.worktree?.branch) ?? branchName(record.branch)) : branchName(at.branch);
}
