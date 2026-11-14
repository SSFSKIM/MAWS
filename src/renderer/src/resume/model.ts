// The resume chooser's list (the P2 spec docs/doperpowers/plans/2026-10-08-p2-daily-driver.md, child P2-D, G1 to G3 and
// G5; owner decision 5): one data path for `/resume` and the sidebar's Resume…. Pure, so the scope, the search, the
// order and the groups are testable without React.
//
// Scope: the project the chooser opened on (P5 O6 M5: the sidebar row, `ChooserContext.row`; a session without a
// project opens on every project), its main checkout by default as `claude --resume` scopes it; All projects (⌃A)
// widens it to every listed project and the sessions of none, All worktrees (⌃W) adds the sessions in its worktrees,
// Current branch (⌃B) keeps those on the branch the project's checkout has out, Archived adds archived sessions and a
// hidden project's. The search is the sidebar's
// (`sessionMatcher`: title, project name, folder and branch). One activity time per session (`lastActivity`: its latest
// turn, else its record's update) orders the rows, groups them and is the time a row and the preview show.
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord, SessionDigest } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { dateFormats, formatClock, formatShortDate, formatWeekdayClock } from '@shared/app/date-format';
import { lastActivity, seenActivity } from '../overview/derive';
import { branchLabel, recordBranch } from '../sessions/branch-label';
import { displayTitle, listedTitle } from '../sessions/title';
import { issuedAt, listedMatcher, sessionMatcher } from '../sidebar/derive';
import { orgIndex, rowOfListed, rowOfRecord, type OrgIndex, type RowKey } from '../stores/org-projects';
import type { OrgProjects } from '../stores/registry';
import type { ListedSession } from '../stores/sessions';

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
// opened from, which it does not list (`/resume` lists the others). P5 O6 M5: `row`, the sidebar row it opened on,
// scopes it to the sessions that row groups, every machine's (`rowOfRecord`); `projectId` is then the row's checkout
// (its branch for Current branch).
export interface ChooserContext {
  projectId: ProjectId | null;
  row?: RowKey;
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
  local: MachineRef; // this machine, for the org index a row's scope reads
  listed?: ReadonlyMap<AppSessionId, ListedSession>; // P5 O7 M8: other machines' listed sessions (the sessions store's)
  people?: ReadonlySet<RowKey>; // P5 O7 M8: the rows whose People toggle is on, which draw others' listed sessions
  turnsSeen?: ReadonlyMap<AppSessionId, number>; // P5 O7 M10: the turns other machines' sessions streamed here (the sessions store's)
  registry?: OrgProjects; // the project registry (its §J.1): the row keys a row's scope groups by (the sessions store's)
}

// A row is a record's, or (P5 O7 M8) another machine's listed session with no record here, opened through its lane's
// opener (`remote-openers.ts`).
export interface ChooserRecordRow {
  record: SessionRecord;
  at: number; // the one activity time: order, group, row time and preview age
}
export interface ChooserListedRow {
  listed: ListedSession;
  at: number; // its listing's issue (sminos re-issues a listing at each change of its state)
}
export type ChooserRow = ChooserRecordRow | ChooserListedRow;
export const isListedChooserRow = (row: ChooserRow): row is ChooserListedRow => 'listed' in row;
export const chooserRowId = (row: ChooserRow): AppSessionId => (isListedChooserRow(row) ? row.listed.appId : row.record.appId);
const rowTitle = (row: ChooserRow): string => (isListedChooserRow(row) ? listedTitle(row.listed) : displayTitle(row.record));

// The branch a session ran on: its worktree's, else the one its transcript recorded (W9's rule, H2: HEAD and empty are none).
export const sessionBranch = (record: SessionRecord): string | null => branchLabel(recordBranch(record));

// The candidates, newest first (ties by title, then id, so the order is stable while the stores change).
//
// P5 O7 M8: the listed sessions with no record here join them, filed as the sidebar files them (`rowOfListed`; a record
// at a listed address sits where its listing does, another machine's always, `rowOfRecord`). Another
// member's session (its listing not yours), held as a listing or as a record, is listed only under a row whose People
// toggle is on, whatever the toggles; a row nobody draws (an all-hidden project's) never lets it through. A listing
// names no folder, worktree or branch: All worktrees keeps them, Current branch none.
export function chooserRows({ records, digests, projects, context, toggles, branch, query, local, listed = new Map(), people = new Set(), turnsSeen = new Map(), registry }: ChooserInput): ChooserRow[] {
  const matches = sessionMatcher(query, projects);
  const seen = seenActivity(listed, turnsSeen); // P5 O7 M10: a held remote record's activity past the record, as the sidebar ranks it
  const matchesListed = listedMatcher(query);
  let held: OrgIndex | null = null; // built when a row or a listing asks for it
  const index = () => (held ??= orgIndex(projects.values(), local, registry));
  const { row } = context;
  const shown = row === undefined ? undefined : new Set([row]); // the row it opened on is listed, as the sidebar showed it
  const recordRow = (record: SessionRecord): RowKey | null => {
    return rowOfRecord(index(), projects, record, listed, shown);
  };
  const inScope = (record: SessionRecord) => (row === undefined ? record.projectId === context.projectId : recordRow(record) === row);
  const drawsOthers = (filed: RowKey | null) => filed !== null && people.has(filed);
  const othersRecord = (record: SessionRecord) => listed.get(record.appId)?.mine === false;
  const rows: ChooserRow[] = [];
  for (const record of records.values()) {
    if (record.appId === context.exclude) continue;
    const project = record.projectId === null ? null : projects.get(record.projectId);
    if (!toggles.archived && (record.archived || project?.hidden)) continue;
    if (!toggles.allProjects && !inScope(record)) continue;
    if (!toggles.allWorktrees && record.worktree !== null) continue;
    if (toggles.currentBranch && (branch === null || sessionBranch(record) !== branch)) continue;
    if (!matches(record)) continue;
    if (othersRecord(record) && !drawsOthers(recordRow(record))) continue;
    rows.push({ record, at: lastActivity(record, digests.get(record.appId), seen.get(record.appId)) });
  }
  if (!toggles.currentBranch) {
    for (const session of listed.values()) {
      if (records.has(session.appId) || session.appId === context.exclude) continue; // a record is listed in its place
      const filed = rowOfListed(index(), session, shown);
      if (filed === null && !toggles.archived) continue; // an all-hidden project's
      if (!session.mine && !drawsOthers(filed)) continue; // others' behind their row's toggle
      if (!toggles.allProjects && (row === undefined || filed !== row)) continue;
      if (!matchesListed(session)) continue;
      rows.push({ listed: session, at: issuedAt(session) });
    }
  }
  return rows.sort((a, b) => b.at - a.at || rowTitle(a).localeCompare(rowTitle(b)) || chooserRowId(a).localeCompare(chooserRowId(b)));
}

// ---- groups ----------------------------------------------------------------------------------------------------------

export type GroupKind = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'week';

export interface ChooserGroup<R extends { at: number } = ChooserRow> {
  key: string;
  kind: GroupKind;
  label: string;
  rows: R[];
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
// group per week ("Week of Sep 14"). A time in the future (a clock moved back) counts as today. The days and weeks are
// named in the display locale, as the transcript's day separators are (`@shared/app/date-format`).
export function groupOf(at: number, now: number): { key: string; kind: GroupKind; label: string } {
  const words = dateFormats();
  const today = midnight(now);
  if (at >= today) return { key: 'today', kind: 'today', label: words.day(0) };
  // a day's length moves at a time change: yesterday is the calendar day before today, whatever its length
  const yesterday = midnight(today - DAY / 2);
  if (at >= yesterday) return { key: 'yesterday', kind: 'yesterday', label: words.day(1) };
  const thisWeek = weekStart(now);
  if (at >= thisWeek) return { key: 'thisWeek', kind: 'thisWeek', label: words.week(0) };
  const lastWeek = weekStart(thisWeek - DAY / 2);
  if (at >= lastWeek) return { key: 'lastWeek', kind: 'lastWeek', label: words.week(1) };
  const week = weekStart(at);
  return { key: `week:${week}`, kind: 'week', label: `Week of ${words.shortDate(week, now)}` };
}

// Rows (already newest first) in their groups, newest group first.
export function chooserGroups<R extends { at: number }>(rows: readonly R[], now: number): ChooserGroup<R>[] {
  const groups: ChooserGroup<R>[] = [];
  for (const row of rows) {
    const group = groupOf(row.at, now);
    const last = groups.at(-1);
    if (last?.key === group.key) last.rows.push(row);
    else groups.push({ ...group, rows: [row] });
  }
  return groups;
}

// What a row says of its time inside its group: the clock time for Today and Yesterday, the weekday and the clock for
// the rest of this week, the date for the weeks before; in the display locale, as the rest of MAWS (`@shared/app/date-format`).
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
