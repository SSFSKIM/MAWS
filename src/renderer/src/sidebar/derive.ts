// The sidebar's readings of the stores (§5.1 as amended 2026-10-01, W11; C5 execution document, M3): the project list
// of Codex's flat tree, one expanded project's sessions with their caps, what a row says, and how old it is. Pure, so
// the layout is testable without React.
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord, SessionDigest } from '@shared/ipc/schema';
import type { NeedsYouRow } from '../attention/derive';
import { lastActivity, sortSessions, type SidebarSort } from '../overview/derive';

// "Other sessions": the pseudo-project at the end of the list, for sessions without a (known) project.
export const OTHER_SESSIONS = 'other' as const;
export type ProjectKey = ProjectId | typeof OTHER_SESSIONS;

const isWorking = (digest: SessionDigest | undefined) => digest?.phase === 'working' || digest?.phase === 'starting';

// Case-insensitive substring over the title, the project's name and the directory. The ⌘K palette searches sessions
// with the same rule, so the sidebar's filter and the palette agree on what a query finds.
export function sessionMatcher(query: string, projects: ReadonlyMap<ProjectId, ProjectRecord>): (record: SessionRecord) => boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return () => true;
  return (record) =>
    record.title.text.toLowerCase().includes(q) ||
    record.directory.toLowerCase().includes(q) ||
    (record.projectId !== null && (projects.get(record.projectId)?.name.toLowerCase().includes(q) ?? false));
}

// ---- the project list --------------------------------------------------------------------------------------------------

export interface ProjectListInput {
  records: ReadonlyMap<AppSessionId, SessionRecord>;
  digests: ReadonlyMap<AppSessionId, SessionDigest>;
  projects: readonly ProjectRecord[];
  rows: NeedsYouRow[]; // the Needs-you rows: a project's waiting count is how many of its sessions have one
}

export interface ProjectEntry {
  key: ProjectKey;
  project: ProjectRecord | null; // null for Other sessions
  name: string;
  sessions: SessionRecord[]; // not archived, unsorted
  rollup: { waiting: number; working: number };
}

const OTHER_NAME = 'Other sessions';

// Every project, then Other sessions when it holds anything, each with its sessions and its waiting (◐) and working (●)
// counts. Projects are sorted by recency of activity: the latest movement of any of their sessions (archived ones
// included, so archiving does not demote a project), a project without sessions by when it was added; ties by the
// project order, then the name.
export function projectList({ records, digests, projects, rows }: ProjectListInput): ProjectEntry[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const waiting = new Set(rows.map((row) => row.appSessionId));
  const grouped = new Map<ProjectKey, { live: SessionRecord[]; activity: number }>();
  for (const record of records.values()) {
    const key: ProjectKey = record.projectId !== null && byId.has(record.projectId) ? record.projectId : OTHER_SESSIONS;
    const entry = grouped.get(key) ?? { live: [], activity: Number.NEGATIVE_INFINITY };
    if (!grouped.has(key)) grouped.set(key, entry);
    entry.activity = Math.max(entry.activity, lastActivity(record, digests.get(record.appId)));
    if (!record.archived) entry.live.push(record);
  }
  const entryOf = (key: ProjectKey, project: ProjectRecord | null): ProjectEntry => {
    const sessions = grouped.get(key)?.live ?? [];
    return {
      key,
      project,
      name: project?.name ?? OTHER_NAME,
      sessions,
      rollup: { waiting: sessions.filter((r) => waiting.has(r.appId)).length, working: sessions.filter((r) => isWorking(digests.get(r.appId))).length },
    };
  };
  const activityOf = (key: ProjectKey, project: ProjectRecord) => grouped.get(key)?.activity ?? Date.parse(project.createdAt);
  const listed = projects
    .map((project) => ({ entry: entryOf(project.id, project), activity: activityOf(project.id, project) }))
    .sort((a, b) => b.activity - a.activity || a.entry.project!.order - b.entry.project!.order || a.entry.name.localeCompare(b.entry.name))
    .map(({ entry }) => entry);
  const other = entryOf(OTHER_SESSIONS, null);
  return other.sessions.length > 0 ? [...listed, other] : listed;
}

// The list while searching: the projects whose name matches, and those holding a session that matches.
export function filterProjectList(entries: ProjectEntry[], query: string, projects: ReadonlyMap<ProjectId, ProjectRecord>): ProjectEntry[] {
  const q = query.trim().toLowerCase();
  if (q === '') return entries;
  const matches = sessionMatcher(query, projects);
  return entries.filter((e) => (e.project !== null && e.name.toLowerCase().includes(q)) || e.sessions.some(matches));
}

// ---- an expanded project's sessions ------------------------------------------------------------------------------------

// Codex's shape, as the owner corrected it (waves plan §2 I4, 2026-10-01): five project rows by recency, then "Show
// more" for the rest (Codex's `maxGroups={5}`, readable/chatgpt-26.928.40906/renderer/app/app-initial-27bc4044d9e8.js:547146);
// an expanded project's five sessions (`maxItems={ncs}`, `ncs = 5`, :545584), then "Show more" to eight at most, never
// more (Codex adds ten per click; the owner capped it). Whatever lies
// past eight is the Resume… picker's (I7), reached from the project row, so a project never takes the list over.
export const PROJECTS_FIRST = 5;
export const SESSIONS_FIRST = 5;
export const SESSIONS_CAP = 8;

// How many of `total` sessions an expanded project shows, before and after its "Show more".
export const shownCount = (total: number, more: boolean): number => Math.min(total, more ? SESSIONS_CAP : SESSIONS_FIRST);

export interface ProjectSessionsInput {
  sessions: readonly SessionRecord[]; // the project's sessions, not archived
  digests: Map<AppSessionId, SessionDigest>;
  rows: NeedsYouRow[];
  sort: SidebarSort;
  matches: (record: SessionRecord) => boolean;
}

// One flat list: pinned sessions first (pin keeps a session at the top of its project), then the rest in the chosen
// sort; worktree sessions sit among them, marked by their branch (`rowBranch`).
export function projectSessions({ sessions, digests, rows, sort, matches }: ProjectSessionsInput): SessionRecord[] {
  const order = (list: SessionRecord[]) => sortSessions(list, sort, { digests, rows });
  const shown = sessions.filter(matches);
  return [...order(shown.filter((r) => r.pinned)), ...order(shown.filter((r) => !r.pinned))];
}

// ---- row text ----------------------------------------------------------------------------------------------------------

// A worktree session's branch (C10's record, else the index's), as its row's ⎇ label and its hover card name it; null
// for a session in the project directory and for a detached worktree.
export function rowBranch(record: SessionRecord): string | null {
  if (record.worktree === null) return null;
  return record.worktree.branch ?? record.branch ?? null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function formatAge(ms: number): string {
  if (ms < MINUTE) return 'now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  if (ms < WEEK) return `${Math.floor(ms / DAY)}d`;
  return `${Math.floor(ms / WEEK)}w`;
}

// A working session is "now"; otherwise the age of its last activity.
export function sessionAge(record: SessionRecord, digest: SessionDigest | null | undefined, now: number): string {
  if (isWorking(digest ?? undefined)) return 'now';
  return formatAge(now - lastActivity(record, digest));
}

// A waiting request shows how long its item has waited (the request preview, C7's card).
export const needsYouAge = (oldest: AttentionItem, now: number): string => formatAge(now - Date.parse(oldest.createdAt));
