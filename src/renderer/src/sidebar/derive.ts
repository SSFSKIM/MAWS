// The sidebar's readings of the stores (C5 execution document, M3; residue *Sidebar scale* and *Needs-you ordering
// and grouping*): which sessions go in which section, what a row says, and how old it is. Pure, so the layout is
// testable without React.
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord, SessionDigest } from '@shared/ipc/schema';
import { holderLine, waitingItem, type NeedsYouRow } from '../attention/derive';
import { lastActivity, sortSessions, type SidebarSort } from '../overview/derive';

// A project renders at most this many sessions before "Show N more" (residue *Sidebar scale*: no virtualisation).
export const PROJECT_PAGE = 20;

export interface SidebarInput {
  records: Map<AppSessionId, SessionRecord>;
  digests: Map<AppSessionId, SessionDigest>;
  projects: ProjectRecord[]; // in sidebar order
  rows: NeedsYouRow[]; // the Needs-you rows, in their order
  sort: SidebarSort;
  query: string;
}

export interface ProjectSection {
  project: ProjectRecord;
  sessions: SessionRecord[]; // sorted; pinned sessions are under Pinned instead
  rollup: { needsYou: number; working: number };
}

export interface SidebarModel {
  needsYou: NeedsYouRow[];
  pinned: SessionRecord[];
  projects: ProjectSection[]; // while searching, only the projects with a match
  other: SessionRecord[]; // no project, or a project the list does not hold
  searching: boolean;
  // Whether Pinned and Other sessions hold anything before the search filters them: a section with sessions keeps its
  // heading while a search empties it, one with none shows no heading.
  hasPinned: boolean;
  hasOther: boolean;
}

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

export function sidebarModel({ records, digests, projects, rows, sort, query }: SidebarInput): SidebarModel {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const matches = sessionMatcher(query, byId);
  const order = (list: SessionRecord[]) => sortSessions(list, sort, { digests, rows });
  const waiting = new Set(rows.map((row) => row.appSessionId));

  const live = [...records.values()].filter((r) => !r.archived);
  const grouped = new Map<ProjectId | null, SessionRecord[]>();
  for (const r of live) {
    const key = r.projectId !== null && byId.has(r.projectId) ? r.projectId : null;
    const list = grouped.get(key);
    if (list) list.push(r);
    else grouped.set(key, [r]);
  }

  const sections = projects.map((project) => {
    const all = grouped.get(project.id) ?? [];
    return {
      project,
      sessions: order(all.filter((r) => !r.pinned && matches(r))),
      rollup: {
        needsYou: all.filter((r) => waiting.has(r.appId)).length,
        working: all.filter((r) => isWorking(digests.get(r.appId))).length,
      },
    };
  });
  const searching = query.trim() !== '';
  const others = (grouped.get(null) ?? []).filter((r) => !r.pinned);
  return {
    needsYou: rows.filter((row) => {
      const r = records.get(row.appSessionId);
      return r !== undefined && matches(r);
    }),
    pinned: order(live.filter((r) => r.pinned && matches(r))),
    projects: searching ? sections.filter((s) => s.sessions.length > 0) : sections,
    other: order(others.filter(matches)),
    searching,
    hasPinned: live.some((r) => r.pinned),
    hasOther: others.length > 0,
  };
}

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

// A Needs-you row shows how long its oldest item has waited.
export const needsYouAge = (oldest: AttentionItem, now: number): string => formatAge(now - Date.parse(oldest.createdAt));
