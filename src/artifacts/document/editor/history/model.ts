// The history list's model (D10 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.7 of the parent): the
// versions grouped by day newest first with runs of automatic versions folded, the Named only filter, each row's title
// and one-line summary, an author from an actor key, and the version "See N new changes" compares the live document
// with. Dates in the United States frame (the owner's Decision Log 43).
import { actorDisplay, type Actor, type AuthorColor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import type { ArtifactVersion } from '@shared/artifacts/version';

export type Entry = { kind: 'version'; version: ArtifactVersion } | { kind: 'run'; versions: ArtifactVersion[] };
export interface DayGroup {
  key: string;
  label: string;
  entries: Entry[];
}

const LOCALE = 'en-US';
const TIME = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat(LOCALE, { month: 'long', day: 'numeric' });
const DAY_YEAR = new Intl.DateTimeFormat(LOCALE, { month: 'long', day: 'numeric', year: 'numeric' });
const WHEN = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const dayKey = (time: number): string => {
  const d = new Date(time);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
function dayLabel(time: number, now: number): string {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(time) === dayKey(now)) return 'Today';
  if (dayKey(time) === dayKey(yesterday.getTime())) return 'Yesterday';
  return new Date(time).getFullYear() === new Date(now).getFullYear() ? DAY.format(time) : DAY_YEAR.format(time);
}

/** A version the owner named: Save version's, or an automatic one given a label. */
export const isNamed = (version: ArtifactVersion): boolean => version.kind === 'named' || (version.kind === 'auto' && version.label !== undefined);

/** Newest first, by day; a run of two or more automatic versions in a row folds into one entry. */
export function groupVersions(versions: readonly ArtifactVersion[], { now, namedOnly = false }: { now: number; namedOnly?: boolean }): DayGroup[] {
  const sorted = versions.filter((version) => !namedOnly || isNamed(version)).sort((a, b) => b.at - a.at || b.seq - a.seq);
  const groups: DayGroup[] = [];
  for (const version of sorted) {
    const key = dayKey(version.at);
    let group = groups[groups.length - 1];
    if (group?.key !== key) groups.push((group = { key, label: dayLabel(version.at, now), entries: [] }));
    const last = group.entries[group.entries.length - 1];
    const folds = version.kind === 'auto' && !isNamed(version);
    const lastFolds = last !== undefined && (last.kind === 'run' || (last.version.kind === 'auto' && !isNamed(last.version)));
    if (folds && lastFolds) {
      if (last.kind === 'run') last.versions.push(version);
      else group.entries[group.entries.length - 1] = { kind: 'run', versions: [last.version, version] };
    } else group.entries.push({ kind: 'version', version });
  }
  return groups;
}

/** A row's title: its label, else its time. */
export const versionTitle = (version: ArtifactVersion): string => version.label ?? TIME.format(version.at);

/** A date and time (epoch ms) as the preview's heading and Show editors write it: "Oct 12, 9:41 AM". */
export const formatWhen = (at: number): string => WHEN.format(at);

/** A row's one line: the turn's summary, the note's first line, or what made the version; null for a plain auto. */
export function versionSummary(version: ArtifactVersion): string | null {
  const line = (version.summary ?? version.note)?.split('\n')[0]?.trim();
  if (line) return line;
  if (version.kind === 'import') return 'Imported';
  if (version.kind === 'turn') return 'Agent turn';
  return null;
}

/** An actor as provenance and versions name it (X29's `actorKey`). */
export function actorOfKey(key: string): Actor | null {
  if (key === 'human') return { kind: 'human' };
  return key.startsWith('session:') ? { kind: 'session', appSessionId: key.slice('session:'.length) as AppSessionId } : null;
}

/** Who an actor key is, as chips and the change marks show it: "You", a session's title or "Claude", and its colour. */
export function authorOf(key: string, sessionTitle?: (appSessionId: string) => string | undefined): { name: string; color: AuthorColor } {
  const actor = actorOfKey(key) ?? ({ kind: 'session', appSessionId: key as AppSessionId } as const);
  return actorDisplay(actor, actor.kind === 'session' ? sessionTitle?.(actor.appSessionId) : undefined);
}

/**
 * "See N new changes" (§4.7): offered when an automatic or turn version by a session is newer than the owner's last
 * view, comparing the live document with the newest version at or before that view (`since`, null when none is: the
 * comparison is with nothing). Null when not offered, and when the artifact was never viewed.
 */
export function newChangesBase(versions: readonly ArtifactVersion[], lastViewedAt: number | null): { since: ArtifactVersion | null } | null {
  if (lastViewedAt === null) return null;
  const changed = versions.some((version) => version.at > lastViewedAt && version.actor.kind === 'session' && (version.kind === 'auto' || version.kind === 'turn'));
  if (!changed) return null;
  const since = versions.filter((version) => version.at <= lastViewedAt).sort((a, b) => b.at - a.at || b.seq - a.seq)[0] ?? null;
  return { since };
}
