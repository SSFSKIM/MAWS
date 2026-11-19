// ⌘K's Recent (UX wave U6b-5a, docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-keyboard.md, M4; decision 18;
// Interfaces §E; B6): with nothing typed, the first group is what this run opened, newest first, from the window's one
// opened list (`keymap/visits.ts`, which Back and Forward's record shares), eight at most, filled with the sessions most
// recently active when fewer were opened, so the list is useful right after a relaunch. A session is drawn at once from
// its record; an artifact by the row its machine answers to `library.get`, and not while that answer has not come or
// is null (it no longer exists). Archived sessions and sessions this window has no record of are never listed.
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { LibraryRow } from '@shared/ipc/schema/library';
import type { MachineRef } from '@shared/machine/ref';
import type { Opened } from '../keymap/visits';

export const RECENT_MAX = 8;

export type OpenedArtifact = Extract<Opened, { kind: 'artifact' }>;
export type RecentRow = { kind: 'session'; record: SessionRecord } | { kind: 'artifact'; artifactId: string; machine: MachineRef; row: LibraryRow };

// An artifact id names no machine, and two machines' artifacts may share one: the key of an answer names both.
export const artifactKey = (machine: MachineRef, artifactId: string): string => `${machine}/${artifactId}`;

export interface RecentInput {
  opened: readonly Opened[]; // newest first
  records: ReadonlyMap<AppSessionId, SessionRecord>;
  activity(record: SessionRecord): number; // the fill's order: most recent first
  answered: ReadonlyMap<string, LibraryRow | null>; // `library.get`'s answers by `artifactKey`; absent: not answered yet
}

// The rows to draw, and the artifacts to ask `library.get` for. An artifact not answered yet holds its place in the first
// eight (Decision Log 16 (v)): no more reads are out at once than the places left, and an answer that turns out null
// frees its place for the next. The fill with sessions is drawn at once and gives way as the artifacts' rows come.
export function recentRows({ opened, records, activity, answered }: RecentInput): { rows: RecentRow[]; ask: OpenedArtifact[] } {
  const rows: RecentRow[] = [];
  const ask: OpenedArtifact[] = [];
  const listed = new Set<AppSessionId>();
  for (const entry of opened) {
    if (rows.length + ask.length === RECENT_MAX) break;
    if (entry.kind === 'session') {
      const record = records.get(entry.appSessionId);
      if (record === undefined || record.archived || listed.has(record.appId)) continue;
      listed.add(record.appId);
      rows.push({ kind: 'session', record });
      continue;
    }
    const row = answered.get(artifactKey(entry.machine, entry.artifactId));
    if (row === undefined) ask.push(entry);
    else if (row !== null) rows.push({ kind: 'artifact', artifactId: entry.artifactId, machine: entry.machine, row });
  }
  if (rows.length < RECENT_MAX) {
    const fill = [...records.values()].filter((r) => !r.archived && !listed.has(r.appId)).sort((a, b) => activity(b) - activity(a));
    for (const record of fill.slice(0, RECENT_MAX - rows.length)) rows.push({ kind: 'session', record });
  }
  return { rows, ask };
}
