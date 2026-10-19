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

/** How far one project's sessions can be taken as current: its socket, its backlog, and its log's verification. */
export type FeedHealth = { connected: boolean; caughtUp: boolean; pending: number; refused: number };

/**
 * `reading`: connected but its backlog has not all arrived or is not all verified yet (or it has not connected yet);
 * `stale`: its socket dropped after it caught up, so its sessions are as last seen; `current`: connected, caught up, and
 * every entry it holds checked. Refusals are reported apart: a current feed with refusals is current, less what failed.
 */
export type FeedState = 'reading' | 'stale' | 'current';

export function feedState(h: FeedHealth): FeedState {
  if (!h.connected) return h.caughtUp ? 'stale' : 'reading';
  return h.caughtUp && h.pending === 0 ? 'current' : 'reading';
}
