// Overview grouping and the sidebar's session order (C5 execution document, Derivations; residue *Overview card* and
// *Needs-you ordering and grouping*). Pure functions over the stores' maps.
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord, SessionDigest, SessionPhase } from '@shared/ipc/schema';
import { machineOf } from '@shared/machine/address';
import { machineKey, type OrgKey } from '@shared/machine/org-key';
import type { MachineRef } from '@shared/machine/ref';
import { holderLine, isActionable, waitingItem, type NeedsYouRow } from '../attention/derive';
import { glyphFor } from '../attention/glyph';
import { machineOfRow, machineOrder } from '../stores/org-projects';
import type { ListedSession } from '../stores/sessions';

const LIVE = new Set<SessionPhase>(['starting', 'working', 'waiting', 'idle', 'failed', 'foreign']);

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NEGATIVE_INFINITY);
const byTitle = (a: SessionRecord, b: SessionRecord) => a.title.text.localeCompare(b.title.text);

export function orderProjects(projects: Iterable<ProjectRecord>): ProjectRecord[] {
  return [...projects].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export interface OverviewInput {
  records: Map<AppSessionId, SessionRecord>;
  digests: Map<AppSessionId, SessionDigest>;
  projects: Iterable<ProjectRecord>;
  rows: NeedsYouRow[];
  local: MachineRef; // P5 O6 M5: the sessions of no project group by machine, this one's first, each named as its row is
  machineName(machine: MachineRef): string;
  // P5 O7 M6 (M6c fix wave 1): other machines' listed sessions; one with no record is carded in Needs you from its
  // listing and its item (as the toolbar counts it), and in no other group, which needs a record's directory and digest.
  listed?: ReadonlyMap<AppSessionId, unknown>;
}

export interface CardGroup {
  id: 'needs-you' | ProjectId | OrgKey; // a machine's: `machine:<ref>`
  title: string;
  sessions: AppSessionId[];
}

// §5.2's board is "live or unread": a live process in any phase (a read idle session included), an unread session, or
// one in Needs you. An exited session only when unread or in Needs you; archived never.
function eligible(record: SessionRecord, digest: SessionDigest | undefined, waiting: boolean): boolean {
  if (record.archived) return false;
  return waiting || record.unread || (digest !== undefined && LIVE.has(digest.phase));
}

const latestTurn = (record: SessionRecord, digest: SessionDigest | undefined) =>
  time(digest?.turnStartedAt ?? digest?.lastTurnEndedAt ?? record.updatedAt);

export function overviewGroups({ records, digests, projects, rows, local, machineName, listed }: OverviewInput): CardGroup[] {
  const waiting = new Set(rows.map((row) => row.appSessionId));
  const carded = (id: AppSessionId) => records.has(id) || (listed?.has(id) ?? false);
  const groups: CardGroup[] = [{ id: 'needs-you', title: 'Needs you', sessions: rows.map((row) => row.appSessionId).filter(carded) }];
  const ordered = orderProjects(projects);
  const byProject = new Map<ProjectId | OrgKey, SessionRecord[]>();
  const known = new Set(ordered.map((p) => p.id));
  for (const record of records.values()) {
    if (waiting.has(record.appId) || !eligible(record, digests.get(record.appId), false)) continue;
    const key = record.projectId !== null && known.has(record.projectId) ? record.projectId : machineKey(machineOf(record.appId));
    byProject.set(key, [...(byProject.get(key) ?? []), record]);
  }
  const sorted = (list: SessionRecord[] = []) =>
    [...list]
      .sort((a, b) => latestTurn(b, digests.get(b.appId)) - latestTurn(a, digests.get(a.appId)) || byTitle(a, b))
      .map((r) => r.appId);
  for (const p of ordered) groups.push({ id: p.id, title: p.name, sessions: sorted(byProject.get(p.id)) });
  const machines = [...byProject.keys()].map(machineOfRow).filter((m) => m !== null);
  for (const m of machines.sort(machineOrder(local, machineName))) groups.push({ id: machineKey(m), title: machineName(m), sessions: sorted(byProject.get(machineKey(m))) });
  return groups.filter((group) => group.sessions.length > 0);
}

export function overviewCards(input: OverviewInput): AppSessionId[] {
  return overviewGroups(input).flatMap((group) => group.sessions);
}

// A card's activity line (residue *Overview card*): the holder of a foreign-live session; what a waiting session waits
// for, in words; what a working session is doing; else its state. The last answer is a separate line, so a working
// session shows both. P5 O9 M6 (the owner's Q1): a foreign session MAWS drives through its bridge reads as any session
// (its digest is never `foreign` then); the holder line is one with no live bridge.
export function cardActivity(record: SessionRecord, digest: SessionDigest | null, pending: AttentionItem[]): string {
  const holder = digest === null || digest.phase === 'foreign' ? holderLine(record) : null;
  if (holder) return holder;
  const waiting = waitingItem(pending);
  if (waiting && isActionable(waiting.oldest)) {
    return waiting.oldest.kind === 'permission' ? 'Waiting for approval' : glyphFor(record, digest, pending).label;
  }
  switch (digest?.phase) {
    case 'working':
    case 'starting':
      return digest.activity ?? 'Working';
    case 'waiting':
      return 'Waiting';
    case 'failed':
      return 'Failed';
    case 'exited':
      return 'Done';
  }
  return 'Idle';
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

// A card's footer (§5.2): context, cost since the human last looked, running child agents; each only when known.
export function cardFooter(digest: SessionDigest | null): string[] {
  if (!digest) return [];
  const parts: string[] = [];
  if (digest.context) parts.push(`ctx ${Math.round(digest.context.percent)}%`);
  if (digest.cost) parts.push(`$${digest.cost.sinceSeenUsd.toFixed(2)} since seen`);
  if (digest.childAgents.active > 0) parts.push(plural(digest.childAgents.active, 'agent'));
  return parts;
}

export type SidebarSort = 'priority' | 'recency';

// A listed session's last activity: when its listing was issued (sminos re-issues a listing at each change of its state).
export const issuedAt = (listed: ListedSession): number => {
  const at = Date.parse(listed.issued);
  return Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
};

// P5 O7 M10 (A; docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M10's *A remote session ranks by a stale
// activity time*): what this window knows of a session's activity beyond its record and digest, by session. Another
// machine's lane B record has no digest (no lane B module emits `session.digest`), and main holds its record only while
// a tab does, so the record as last received stops at the tab's let-go. What still arrives is its listing, issued again
// at each change of its state, and, while a tab held it, the turn events its stream delivered (`turnsSeen`, the sessions
// store's). The newest of the two (`seenAt`), for every session either names.
export type SeenActivity = ReadonlyMap<AppSessionId, number>;
export const seenAt = (listed: ListedSession | undefined, turn: number | undefined): number | undefined =>
  listed === undefined ? turn : Math.max(issuedAt(listed), turn ?? Number.NEGATIVE_INFINITY);
export function seenActivity(listed: ReadonlyMap<AppSessionId, ListedSession>, turnsSeen: ReadonlyMap<AppSessionId, number>): SeenActivity {
  const seen = new Map(turnsSeen);
  for (const [id, session] of listed) seen.set(id, seenAt(session, turnsSeen.get(id))!);
  return seen;
}

// A session's last activity: its latest turn start or turn end (C4 seeds a discovered session's turn end with its
// transcript's last record), else its record's update. The update is when the index last wrote the record, discovery
// included, so it never outranks a turn time. P5 O7 M10: a record with no turn times (another machine's lane B record)
// takes the newer of its update and what this window saw of it (`seen`, its `SeenActivity`).
export function lastActivity(record: SessionRecord, digest: SessionDigest | null | undefined, seen = Number.NEGATIVE_INFINITY): number {
  const turn = Math.max(time(digest?.turnStartedAt), time(digest?.lastTurnEndedAt));
  return turn === Number.NEGATIVE_INFINITY ? Math.max(time(record.updatedAt), seen) : turn;
}

// A record's place under `priority`: its group (0 a Needs-you row, 1 unread, 2 working, 3 the rest) and its key within
// the group (the row's index, then the latest turn end or turn start first); the rest go by recency. P5 O7 M8: the
// sidebar ranks a listed row on the same scale (`sidebar/derive.ts`, `projectItems`). P5 O7 M10: an unread record with no
// digest (another machine's lane B record) by its last activity, `seen` included, the nearest it has to a turn end.
export const RANK_REST = 3;
export function priorityRank(record: SessionRecord, digest: SessionDigest | undefined, row: number | undefined, seen?: number): [group: number, key: number] {
  if (row !== undefined) return [0, row];
  if (record.unread) return [1, -(digest === undefined ? lastActivity(record, undefined, seen) : time(digest.lastTurnEndedAt))];
  if (digest?.phase === 'working' || digest?.phase === 'starting') return [2, -time(digest.turnStartedAt)];
  return [RANK_REST, 0];
}

// Within a project. `priority`: sessions with a Needs-you row (in row order), then unread by last turn end, then working
// by turn start, then the rest by recency. `recency`: `lastActivity`. Ties by title. P5 O7 M10: `seen`, what this window
// saw of a remote record (`seenActivity`).
export function sortSessions(
  sessions: SessionRecord[],
  sort: SidebarSort,
  { digests, rows, seen }: { digests: ReadonlyMap<AppSessionId, SessionDigest>; rows: NeedsYouRow[]; seen?: SeenActivity },
): SessionRecord[] {
  const rowIndex = new Map(rows.map((row, i) => [row.appSessionId, i]));
  // Each session's keys are computed once, not per comparison (debt wave 5: a cold index sorts thousands per render).
  const keyed = sessions.map((r) => {
    const d = digests.get(r.appId);
    const at = seen?.get(r.appId);
    const [group, key] = sort === 'recency' ? [RANK_REST, 0] : priorityRank(r, d, rowIndex.get(r.appId), at);
    return { r, group, key, recency: lastActivity(r, d, at) };
  });
  return keyed
    .sort((a, b) => {
      if (a.group !== b.group) return a.group - b.group;
      if (a.group === RANK_REST) return b.recency - a.recency || byTitle(a.r, b.r);
      return a.key - b.key || byTitle(a.r, b.r);
    })
    .map(({ r }) => r);
}
