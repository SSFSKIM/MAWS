// What the Resume… picker lists (§5.1 as amended 2026-10-01, W11, I7; the owner's model is `claude --resume`): a
// project's sessions, newest first, narrowed by the search (the sidebar's own rule: title, project name, directory) and
// three toggles as the CLI names them. By default the project's main checkout only; All worktrees (⌃W) adds the
// sessions in its worktrees; Current branch (⌃B) keeps those on the branch the project's checkout has out; All projects
// (⌃A) widens the scope to every listed project and Other sessions. Archived sessions and a hidden project's never show.
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord, SessionDigest } from '@shared/ipc/schema';
import { lastActivity } from '../overview/derive';
import { rowBranch, sessionMatcher } from './derive';

export interface ResumeToggles {
  allProjects: boolean;
  currentBranch: boolean;
  allWorktrees: boolean;
}

export const NO_TOGGLES: ResumeToggles = { allProjects: false, currentBranch: false, allWorktrees: false };

// The toggle each chord flips, ⌃ plus the CLI's letter.
export const TOGGLE_KEYS: Record<string, keyof ResumeToggles> = { a: 'allProjects', b: 'currentBranch', w: 'allWorktrees' };

export interface ResumeInput {
  records: ReadonlyMap<AppSessionId, SessionRecord>;
  digests: ReadonlyMap<AppSessionId, SessionDigest>;
  projects: ReadonlyMap<ProjectId, ProjectRecord>;
  projectId: ProjectId; // the project the picker opened on
  toggles: ResumeToggles;
  branch: string | null; // the project's checked-out branch, null while unknown (Current branch then keeps nothing)
  query: string;
}

// The branch a session ran on: its worktree's, else the one its transcript recorded.
export const sessionBranch = (record: SessionRecord): string | null => (record.worktree !== null ? rowBranch(record) : record.branch);

export function resumeCandidates({ records, digests, projects, projectId, toggles, branch, query }: ResumeInput): SessionRecord[] {
  const matches = sessionMatcher(query, projects);
  const shown = [...records.values()].filter((record) => {
    if (record.archived) return false;
    const project = record.projectId === null ? null : projects.get(record.projectId);
    if (project?.hidden) return false;
    if (!toggles.allProjects && record.projectId !== projectId) return false;
    if (!toggles.allWorktrees && record.worktree !== null) return false;
    if (toggles.currentBranch && (branch === null || sessionBranch(record) !== branch)) return false;
    return matches(record);
  });
  const at = new Map(shown.map((r) => [r.appId, lastActivity(r, digests.get(r.appId))]));
  return shown.sort((a, b) => at.get(b.appId)! - at.get(a.appId)!);
}
