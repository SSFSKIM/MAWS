// Overview grouping and the sidebar's session order (C5 execution document, Derivations; residue *Overview card* and
// *Needs-you ordering and grouping*). Pure functions over the stores' maps.
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord, SessionDigest, SessionPhase } from '@shared/ipc/schema';
import { holderLine, isActionable, waitingItem, type NeedsYouRow } from '../attention/derive';
import { glyphFor } from '../attention/glyph';

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
}

export interface CardGroup {
  id: 'needs-you' | 'other' | ProjectId;
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

export function overviewGroups({ records, digests, projects, rows }: OverviewInput): CardGroup[] {
  const waiting = new Set(rows.map((row) => row.appSessionId));
  const groups: CardGroup[] = [{ id: 'needs-you', title: 'Needs you', sessions: rows.map((row) => row.appSessionId).filter((id) => records.has(id)) }];
  const ordered = orderProjects(projects);
  const byProject = new Map<ProjectId | 'other', SessionRecord[]>();
  const known = new Set(ordered.map((p) => p.id));
  for (const record of records.values()) {
    if (waiting.has(record.appId) || !eligible(record, digests.get(record.appId), false)) continue;
    const key = record.projectId !== null && known.has(record.projectId) ? record.projectId : 'other';
    byProject.set(key, [...(byProject.get(key) ?? []), record]);
  }
  const sorted = (list: SessionRecord[] = []) =>
    [...list]
      .sort((a, b) => latestTurn(b, digests.get(b.appId)) - latestTurn(a, digests.get(a.appId)) || byTitle(a, b))
      .map((r) => r.appId);
  for (const p of ordered) groups.push({ id: p.id, title: p.name, sessions: sorted(byProject.get(p.id)) });
  groups.push({ id: 'other', title: 'Other sessions', sessions: sorted(byProject.get('other')) });
  return groups.filter((group) => group.sessions.length > 0);
}

export function overviewCards(input: OverviewInput): AppSessionId[] {
  return overviewGroups(input).flatMap((group) => group.sessions);
}

// A card's activity line (residue *Overview card*): the holder of a foreign-live session; what a waiting session waits
// for, in words; what a working session is doing; else its state. The last answer is a separate line, so a working
// session shows both.
export function cardActivity(record: SessionRecord, digest: SessionDigest | null, pending: AttentionItem[]): string {
  const holder = holderLine(record);
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

const recency = (record: SessionRecord, digest: SessionDigest | undefined) =>
  Math.max(time(digest?.turnStartedAt), time(digest?.lastTurnEndedAt), time(record.updatedAt));

// Within a project. `priority`: sessions with a Needs-you row (in row order), then unread by last turn end, then working
// by turn start, then the rest by recency. `recency`: the latest of turn start, turn end and update. Ties by title.
export function sortSessions(
  sessions: SessionRecord[],
  sort: SidebarSort,
  { digests, rows }: { digests: Map<AppSessionId, SessionDigest>; rows: NeedsYouRow[] },
): SessionRecord[] {
  const rowIndex = new Map(rows.map((row, i) => [row.appSessionId, i]));
  const byRecency = (a: SessionRecord, b: SessionRecord) => recency(b, digests.get(b.appId)) - recency(a, digests.get(a.appId)) || byTitle(a, b);
  if (sort === 'recency') return [...sessions].sort(byRecency);

  const rank = (r: SessionRecord): [number, number] => {
    const d = digests.get(r.appId);
    const row = rowIndex.get(r.appId);
    if (row !== undefined) return [0, row];
    if (r.unread) return [1, -time(d?.lastTurnEndedAt)];
    if (d?.phase === 'working' || d?.phase === 'starting') return [2, -time(d.turnStartedAt)];
    return [3, 0];
  };
  return [...sessions].sort((a, b) => {
    const [ga, ka] = rank(a);
    const [gb, kb] = rank(b);
    if (ga !== gb) return ga - gb;
    if (ga === 3) return byRecency(a, b);
    return ka - kb || byTitle(a, b);
  });
}
