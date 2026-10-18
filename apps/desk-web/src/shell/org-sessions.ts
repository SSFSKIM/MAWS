// The org view's sessions (smns org directory §8): each project's sessions as its own view groups them
// (`useDeskSessions`, over the project's verified log and its live state) merged into one list — waiting on the owner,
// then working, then idle; an ended session is not drawn. Within a group the newest join comes first, by the `ts` of the
// membership's `joined` (`joinedTs`): the sidebar's `joinedAt` is an offset in one project's log and orders nothing
// across two.
import type { SessionGroup } from '../log/projection';
import type { DeskSession } from './sessions';

export const ORG_GROUPS = ['waiting', 'working', 'idle'] as const;
export type OrgGroup = (typeof ORG_GROUPS)[number];

export type OrgSession = DeskSession & { projectName: string };

/** One project's sessions, grouped, with its name as the grid shows it. */
export type ProjectFeed = { project: string; name: string; groups: Record<SessionGroup, DeskSession[]> };

export function mergeOrgGroups(feeds: Iterable<ProjectFeed>): Record<OrgGroup, OrgSession[]> {
  const merged: Record<OrgGroup, OrgSession[]> = { waiting: [], working: [], idle: [] };
  for (const { name, groups } of feeds) for (const group of ORG_GROUPS) for (const s of groups[group]) merged[group].push({ ...s, projectName: name });
  for (const group of ORG_GROUPS)
    merged[group].sort((a, b) => b.joinedTs.localeCompare(a.joinedTs) || a.projectName.localeCompare(b.projectName) || a.alias.localeCompare(b.alias));
  return merged;
}
