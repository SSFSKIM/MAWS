// The history list's model (D10 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.7 of the parent): the
// versions grouped by day newest first with runs of automatic versions folded, the Named only filter, each row's title
// and one-line summary, an author from an actor key, and the version "See N new changes" compares the live document
// with. Dates in the display locale (the owner's Decision Log 43; English throughout, P4 Decision Log 4). P4 W1-B (the tracker's "P4 version history
// lines"): a turn's summary is stored as the tools' own lines, which name blocks as ^id and comments as c:id; the row
// reads them in words, naming each block and comment as the live document holds it (`SummaryWords`), so the stored
// provenance line stays as the tools wrote it.
import { dateTimeFormat, formatClock, formatDayTime } from '@shared/app/date-format';
import { actorDisplay, type Actor, type AuthorColor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { Doc, Node } from '../../../yjs';
import { YNode } from '../../../yjs/document';
import { listTabs, tabBody } from '../../tabs';
import { getThread } from '../../threads';

export type Entry = { kind: 'version'; version: ArtifactVersion } | { kind: 'run'; versions: ArtifactVersion[] };
export interface DayGroup {
  key: string;
  label: string;
  entries: Entry[];
}

const DAY = dateTimeFormat({ month: 'long', day: 'numeric' });
const DAY_YEAR = dateTimeFormat({ month: 'long', day: 'numeric', year: 'numeric' });

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
export const versionTitle = (version: ArtifactVersion): string => version.label ?? formatClock(version.at);

/** A date and time (epoch ms) as the preview's heading and Show editors write it: "Oct 12, 9:41 AM". */
export const formatWhen = (at: number): string => formatDayTime(at);

/**
 * A row's one line: the turn's summary in words (`words` names its blocks and comments; without it, or for one gone,
 * "a block" and "a comment"), the note's first line, or what made the version; null for a plain auto.
 */
export function versionSummary(version: ArtifactVersion, words?: SummaryWords): string | null {
  const summary = version.summary?.split('\n')[0]?.trim();
  if (summary) return inWords(summary, words);
  const note = version.note?.split('\n')[0]?.trim();
  if (note) return note;
  if (version.kind === 'import') return 'Imported';
  if (version.kind === 'turn') return 'Agent turn';
  return null;
}

/**
 * What a row names a block or a comment by, from the live document: a phrase ("“The first paragraph.”", "the table
 * “Region, Q1”", "a chart"), or null for one it no longer holds.
 */
export interface SummaryWords {
  block(id: string): string | null;
  thread(id: string): string | null;
}

const WORDS_MAX = 40;
/** Text as a row quotes it: one line, cut at WORDS_MAX characters, in curly quotes; null when blank. */
export function quoted(text: string): string | null {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line === '') return null;
  return `“${line.length <= WORDS_MAX ? line : `${line.slice(0, WORDS_MAX - 1).trimEnd()}…`}”`;
}

const counted = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

// The lines the tools write (edit-plan.ts's op results, artifact_reply's and artifact_resolve's), each read in words;
// any other line (a deck's publish line, a design's) is its own words already.
type Reading = (match: RegExpExecArray, block: (id: string) => string, words: SummaryWords | undefined) => string;
const READINGS: ReadonlyArray<[RegExp, Reading]> = [
  [
    /^replaced (\d+) occurrence\(s\) in (.+)$/,
    ([, n, list], block) => {
      const blocks = list.split(', ').map((id) => block(id.replace(/^\^/, '')));
      if (blocks.length === 1) return Number(n) === 1 ? `Edited ${blocks[0]}` : `Edited ${blocks[0]} in ${n} places`;
      return blocks.length === 2 ? `Edited ${blocks[0]} and ${blocks[1]}` : `Edited ${blocks[0]} and ${counted(blocks.length - 1, 'more block')}`;
    },
  ],
  [/^replaced \^(\S+)(?: \(\+(\d+) blocks\))?$/, ([, id, extra], block) => `Rewrote ${block(id)}${extra ? ` and added ${counted(Number(extra), 'block')}` : ''}`],
  [/^inserted (\d+) block\(s\) (after|before) \^(\S+): \^(\S+)/, ([, n, side, anchor, first], block) => `Inserted ${Number(n) === 1 ? block(first) : counted(Number(n), 'block')} ${side} ${block(anchor)}`],
  [/^deleted \^(\S+)$/, ([, id], block) => `Deleted ${block(id)}`],
  [/^moved \^(\S+) after (the start|\^\S+)/, ([, id, where], block) => `Moved ${block(id)} ${where === 'the start' ? 'to the start' : `after ${block(where.slice(1))}`}`],
  [/^\^(\S+) already after /, ([, id], block) => `Kept ${block(id)} in place`],
  [/^set cell \((\d+), (\d+)\) of \^(\S+)$/, ([, row, col, table], _, words) => `Edited row ${Number(row) + 1}, column ${Number(col) + 1} of ${words?.block(table) ?? 'a table'}`],
  [
    /^(replied on|resolved|reopened) c:(\S+)$/,
    ([, verb, id], _, words) => {
      const said = verb === 'replied on' ? 'Replied to' : verb === 'resolved' ? 'Resolved' : 'Reopened';
      const quote = words?.thread(id);
      return quote ? `${said} the comment on ${quote}` : `${said} a comment`;
    },
  ],
  [/^(\d+) edits$/, ([, n]) => counted(Number(n), 'edit')], // a turn summarised before summarizeTurn counted in words
];

function inWords(line: string, words: SummaryWords | undefined): string {
  const block = (id: string) => (id === '?' ? null : words?.block(id)) ?? 'a block'; // `?`: a block the batch made, unnamed
  for (const [pattern, read] of READINGS) {
    const match = pattern.exec(line);
    if (match) return read(match, block, words);
  }
  return line;
}

// A block with no words of its own, named by what it is; a table by its first row.
const NOUNS: Record<string, string> = { chart: 'a chart', diagram: 'a diagram', mathBlock: 'an equation', horizontalRule: 'a divider', image: 'an image' };
const childNodes = (node: Node): Node[] => node.toArray().filter((child): child is Node => child instanceof YNode);
const textOf = (node: Node): string => node.toArray().map((part) => (typeof part === 'string' ? part : part instanceof YNode ? ` ${textOf(part)} ` : '')).join('');
const nounWithin = (node: Node): string | null => NOUNS[node.name] ?? childNodes(node).map(nounWithin).find((noun) => noun !== null) ?? null;

function blockWords(node: Node): string {
  if (NOUNS[node.name]) return NOUNS[node.name];
  if (node.name === 'table') {
    const head = childNodes(node)[0];
    const cells = head ? childNodes(head).map((cell) => textOf(cell).replace(/\s+/g, ' ').trim()) : [];
    const words = quoted(cells.filter(Boolean).join(', '));
    return words ? `the table ${words}` : 'a table';
  }
  return quoted(textOf(node)) ?? nounWithin(node) ?? 'an empty block';
}

/** The words of a live document (every tab's blocks by id, read on first use; each comment by its quote). */
export function documentWords(doc: Doc): SummaryWords {
  let byId: Map<string, Node> | null = null;
  const nodes = (): Map<string, Node> => {
    if (byId) return byId;
    const found = new Map<string, Node>();
    const walk = (node: Node): void => {
      for (const child of childNodes(node)) {
        const id: unknown = child.getAttr('id');
        if (typeof id === 'string' && !found.has(id)) found.set(id, child);
        walk(child);
      }
    };
    for (const tab of listTabs(doc)) {
      const body = tabBody(doc, tab.id);
      if (body) walk(body);
    }
    return (byId = found);
  };
  return {
    block: (id) => {
      const node = nodes().get(id);
      return node ? blockWords(node) : null;
    },
    thread: (id) => quoted(getThread(doc, id)?.quote ?? ''),
  };
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
export function newChangesBase(versions: readonly ArtifactVersion[], lastViewedAt: number | null, lastViewedSeq?: number | null): { since: ArtifactVersion | null } | null {
  if (lastViewedAt === null) return null;
  const unseen = (version: ArtifactVersion) => lastViewedSeq == null ? version.at > lastViewedAt : version.seq > lastViewedSeq;
  const changed = versions.some((version) => unseen(version) && version.actor.kind === 'session' && (version.kind === 'auto' || version.kind === 'turn'));
  if (!changed) return null;
  const since = versions.filter((version) => !unseen(version)).sort((a, b) => lastViewedSeq == null ? b.at - a.at || b.seq - a.seq : b.seq - a.seq || b.at - a.at)[0] ?? null;
  return { since };
}
