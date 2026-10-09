// The resume chooser's list (the P2 spec docs/doperpowers/plans/2026-10-08-p2-daily-driver.md, child P2-D, G1 to G3 and
// G5; owner decision 5): one data path for `/resume` and the sidebar's Resume…. Pure, so the scope, the search, the
// order and the groups are testable without React.
//
// Scope: the project the chooser opened on (a session without a project opens on every project), its main checkout by
// default as `claude --resume` scopes it; All projects (⌃A) widens it to every listed project and Other sessions, All
// worktrees (⌃W) adds the sessions in its worktrees, Current branch (⌃B) keeps those on the branch the project's
// checkout has out, Archived adds archived sessions and a hidden project's. The search is the sidebar's
// (`sessionMatcher`: title, project name, folder and branch). One activity time per session (`lastActivity`: its latest
// turn, else its record's update) orders the rows, groups them and is the time a row and the preview show.
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord, SessionDigest } from '@shared/ipc/schema';
import { formatClock, formatShortDate, formatWeekdayClock } from '../app/date-format';
import { lastActivity } from '../overview/derive';
import { branchLabel, recordBranch } from '../sessions/branch-label';
import { displayTitle } from '../sessions/title';
import { sessionMatcher } from '../sidebar/derive';

export interface ChooserToggles {
  allProjects: boolean;
  currentBranch: boolean;
  allWorktrees: boolean;
  archived: boolean;
}

export const NO_TOGGLES: ChooserToggles = { allProjects: false, currentBranch: false, allWorktrees: false, archived: false };

// The toggle each chord flips, ⌃ plus the CLI's letter (Archived has none: the CLI has no such toggle).
export const TOGGLE_KEYS: Record<string, keyof ChooserToggles> = { a: 'allProjects', b: 'currentBranch', w: 'allWorktrees' };

// Where the chooser opened: a project (null: a session without a project, so every project), and the session it was
// opened from, which it does not list (`/resume` lists the others).
export interface ChooserContext {
  projectId: ProjectId | null;
  exclude: AppSessionId | null;
}

// The toggles a chooser opens with: All projects when there is no project to scope to.
export const initialToggles = (context: ChooserContext): ChooserToggles => ({ ...NO_TOGGLES, allProjects: context.projectId === null });

export interface ChooserInput {
  records: ReadonlyMap<AppSessionId, SessionRecord>;
  digests: ReadonlyMap<AppSessionId, SessionDigest>;
  projects: ReadonlyMap<ProjectId, ProjectRecord>;
  context: ChooserContext;
  toggles: ChooserToggles;
  branch: string | null; // the project's checked-out branch, null while unknown (Current branch then keeps nothing)
  query: string;
}

export interface ChooserRow {
  record: SessionRecord;
  at: number; // the one activity time: order, group, row time and preview age
}

// The branch a session ran on: its worktree's, else the one its transcript recorded (W9's rule, H2: HEAD and empty are none).
export const sessionBranch = (record: SessionRecord): string | null => branchLabel(recordBranch(record));

// The candidates, newest first (ties by title, then id, so the order is stable while the stores change).
export function chooserRows({ records, digests, projects, context, toggles, branch, query }: ChooserInput): ChooserRow[] {
  const matches = sessionMatcher(query, projects);
  const rows: ChooserRow[] = [];
  for (const record of records.values()) {
    if (record.appId === context.exclude) continue;
    const project = record.projectId === null ? null : projects.get(record.projectId);
    if (!toggles.archived && (record.archived || project?.hidden)) continue;
    if (!toggles.allProjects && record.projectId !== context.projectId) continue;
    if (!toggles.allWorktrees && record.worktree !== null) continue;
    if (toggles.currentBranch && (branch === null || sessionBranch(record) !== branch)) continue;
    if (!matches(record)) continue;
    rows.push({ record, at: lastActivity(record, digests.get(record.appId)) });
  }
  return rows.sort((a, b) => b.at - a.at || displayTitle(a.record).localeCompare(displayTitle(b.record)) || a.record.appId.localeCompare(b.record.appId));
}

// ---- groups ----------------------------------------------------------------------------------------------------------

export type GroupKind = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'week';

export interface ChooserGroup {
  key: string;
  kind: GroupKind;
  label: string;
  rows: ChooserRow[];
}

const DAY = 24 * 60 * 60 * 1000;
const midnight = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
// The local Monday that starts the week holding `ms` (its own first hour: a day the clock skips midnight on starts later,
// and the Monday does not inherit it).
const weekStart = (ms: number): number => {
  const d = new Date(midnight(ms));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// The group a time falls in, by local calendar: Today, Yesterday, the earlier days of this week, last week, then one
// group per week ("Week of Sep 14"). A time in the future (a clock moved back) counts as today.
export function groupOf(at: number, now: number): { key: string; kind: GroupKind; label: string } {
  const today = midnight(now);
  if (at >= today) return { key: 'today', kind: 'today', label: 'Today' };
  // a day's length moves at a time change: yesterday is the calendar day before today, whatever its length
  const yesterday = midnight(today - DAY / 2);
  if (at >= yesterday) return { key: 'yesterday', kind: 'yesterday', label: 'Yesterday' };
  const thisWeek = weekStart(now);
  if (at >= thisWeek) return { key: 'thisWeek', kind: 'thisWeek', label: 'Earlier this week' };
  const lastWeek = weekStart(thisWeek - DAY / 2);
  if (at >= lastWeek) return { key: 'lastWeek', kind: 'lastWeek', label: 'Last week' };
  const week = weekStart(at);
  return { key: `week:${week}`, kind: 'week', label: `Week of ${formatShortDate(week, now)}` };
}

// Rows (already newest first) in their groups, newest group first.
export function chooserGroups(rows: readonly ChooserRow[], now: number): ChooserGroup[] {
  const groups: ChooserGroup[] = [];
  for (const row of rows) {
    const group = groupOf(row.at, now);
    const last = groups.at(-1);
    if (last?.key === group.key) last.rows.push(row);
    else groups.push({ ...group, rows: [row] });
  }
  return groups;
}

// What a row says of its time inside its group: the clock time for Today and Yesterday, the weekday and the clock for
// the rest of this week, the date for the weeks before; in the system locale, as the rest of MAWS (`app/date-format.ts`).
export function rowTime(at: number, kind: GroupKind, now: number): string {
  if (kind === 'today' || kind === 'yesterday') return formatClock(at);
  if (kind === 'thisWeek') return formatWeekdayClock(at);
  return formatShortDate(at, now);
}

// The row's folder badge: a worktree's folder name, else the project's name (a session without one: its folder's name);
// none when it says what the scope already says: the project the list is scoped to (`scopedTo`; null under All
// projects, where every row names its own), outside a worktree.
export function folderBadge(record: SessionRecord, projects: ReadonlyMap<ProjectId, ProjectRecord>, scopedTo: ProjectId | null): string | null {
  const base = (path: string) => path.replace(/\/+$/, '').split('/').at(-1) || path;
  if (record.worktree !== null) return base(record.worktree.path);
  if (record.projectId !== null && record.projectId === scopedTo) return null;
  return (record.projectId !== null ? projects.get(record.projectId)?.name : null) ?? base(record.directory);
}

// The branch as a row shows it: the last path segment (`feature/x` reads `x`), the whole name in its title.
export const shortBranch = (branch: string): string => branch.split('/').filter(Boolean).at(-1) ?? branch;
