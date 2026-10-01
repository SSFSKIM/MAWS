// The sidebar's readings of the stores (§5.1 as amended 2026-10-01, W5; C5 execution document, M3): the two levels of
// the drill-in (the project list, then one project's page with its sessions grouped Main first and then each worktree),
// what a row says, and how old it is. Pure, so the layout is testable without React.
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord, SessionDigest } from '@shared/ipc/schema';
import type { WorktreeInfo } from '@shared/sessions/worktree';
import { holderLine, waitingItem, type NeedsYouRow } from '../attention/derive';
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

// ---- level one: the project list ---------------------------------------------------------------------------------------

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

// ---- level two: one project's page -------------------------------------------------------------------------------------

export interface SessionGroup {
  key: string; // 'main', or the worktree's path
  kind: 'main' | 'worktree';
  label: string; // "Main", or the worktree's folder name
  branch: string | null; // the checkout's branch, beside the label
  path: string | null; // the worktree's path (null for Main)
  sessions: SessionRecord[];
}

export interface ProjectPage {
  pinned: SessionRecord[]; // pin keeps a session at the top of its project, above the groups
  groups: SessionGroup[]; // Main first, then each worktree that holds a session, in `git worktree list` order
  grouped: boolean; // a project with no worktree session shows one flat list, without a Main heading
}

export interface ProjectPageInput {
  sessions: readonly SessionRecord[]; // the project's sessions, not archived
  digests: Map<AppSessionId, SessionDigest>;
  rows: NeedsYouRow[];
  sort: SidebarSort;
  matches: (record: SessionRecord) => boolean;
  worktrees: readonly WorktreeInfo[] | null; // `git.worktree.list` for the project's directory, when read
}

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;
const trimSlash = (path: string) => path.replace(/\/+$/, '');

// The page: pinned sessions first, then Main, then each worktree with a session. Worktrees git lists come in git's
// order with git's branch; a worktree git does not list (removed since, or not read yet) follows, by folder name, with
// the branch its sessions recorded.
export function projectPage({ sessions, digests, rows, sort, matches, worktrees }: ProjectPageInput): ProjectPage {
  const order = (list: SessionRecord[]) => sortSessions(list, sort, { digests, rows });
  const shown = sessions.filter(matches);
  const pinned = order(shown.filter((r) => r.pinned));
  const listed = new Map((worktrees ?? []).filter((w) => !w.isMain).map((w, i) => [trimSlash(w.path), { info: w, index: i }]));
  const main: SessionRecord[] = [];
  const byWorktree = new Map<string, SessionRecord[]>();
  for (const record of shown) {
    if (record.pinned) continue;
    if (record.worktree === null) {
      main.push(record);
      continue;
    }
    const key = trimSlash(record.worktree.path);
    const list = byWorktree.get(key);
    if (list) list.push(record);
    else byWorktree.set(key, [record]);
  }
  const worktreeGroups: SessionGroup[] = [...byWorktree].map(([path, list]) => {
    const info = listed.get(path)?.info;
    const recorded = list.find((r) => r.worktree?.branch ?? r.branch);
    return {
      key: path,
      kind: 'worktree',
      label: basename(path),
      branch: info ? info.branch : (recorded?.worktree?.branch ?? recorded?.branch ?? null),
      path,
      sessions: order(list),
    };
  });
  worktreeGroups.sort((a, b) => {
    const ia = listed.get(a.key)?.index ?? Number.POSITIVE_INFINITY;
    const ib = listed.get(b.key)?.index ?? Number.POSITIVE_INFINITY;
    return ia - ib || a.label.localeCompare(b.label);
  });
  const mainBranch = worktrees?.find((w) => w.isMain)?.branch ?? null;
  const grouped = worktreeGroups.length > 0;
  const groups: SessionGroup[] = [];
  if (main.length > 0) groups.push({ key: 'main', kind: 'main', label: 'Main', branch: mainBranch, path: null, sessions: order(main) });
  groups.push(...worktreeGroups);
  return { pinned, groups, grouped };
}

// Whether a project's page needs `git.worktree.list` (its order and branches): only when a session sits in a worktree.
export const hasWorktreeSessions = (sessions: readonly SessionRecord[]) => sessions.some((r) => r.worktree !== null);

// ---- row text ----------------------------------------------------------------------------------------------------------

// What a row says under its title (§5.1: the current activity while working, the last assistant line when idle):
// the holder for a foreign-live session, the line of the item its Needs-you row shows (`waitingItem`), the activity
// while working, else the last answer.
export function secondaryLine(record: SessionRecord, digest: SessionDigest | null | undefined, pending: AttentionItem[]): string | null {
  const holder = holderLine(record);
  if (holder) return holder;
  const waiting = waitingItem(pending);
  if (waiting) return waiting.oldest.summary;
  if (isWorking(digest ?? undefined) && digest?.activity) return digest.activity;
  return digest?.lastAssistantLine ?? null;
}

// The row's branch chip: a worktree session's branch (C10's record, else the index's), since a session in the project
// directory is on the project's own branch and a chip on every row would say nothing. Null for a detached worktree.
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
