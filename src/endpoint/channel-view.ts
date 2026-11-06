// The project channel's to-human entries as a remote member may read them (P5 O8 M7b,
// docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7b, Interfaces §O): the `channel.history` row's cut (calls.ts)
// and the `channel` feed's. To-human text is its session's content, so an entry goes to a member only for a session they
// hold `view` on, ranked lane by lane, since an entry names its session in its own lane's id:
//   - a lane A entry by its engine session, through sminos's member record (the `session` rule's target): a lane A
//     session sminos holds no record of, or one whose record is lane B's, is nobody's to rank;
//   - a lane B entry by its app session's placement in the spine's record (`placeRecorded`, targets.ts), and by every
//     placement a reader saw of it, none of which may widen the member's rights (the `each-session` rule's).
// An entry of neither shape is nobody's. The rank is read from the records as they stand when the entry goes.
//
// The journal answers a project's history whole, newest first, a page of HISTORY_LIMIT_MAX at a time (src/services/
// channel/). A member's page is cut from as many journal pages as fill it: reading stops once one entry more than the page
// holds is viewable, or the journal ends, so `more` says exactly whether a viewable older entry remains, and a member who
// views few of a busy project's sessions still pages on from the last entry they were given. The journal holds at most
// 2,000 entries a project, so a page reads at most eleven. A page is bounded by its bytes too (CHANNEL_PAGE_BYTES of JSON),
// within the channel's message limit and a feed's backlog; an entry is at most ~640 KiB (the journal's cuts), so a page
// always holds its first.
import { HISTORY_LIMIT_MAX, type HostEntry } from '@shared/ipc/schema/channel';
import type { SessionRanks } from './authorize';
import type { EndpointServices } from './services';
import { placeRecorded, type Placement } from './targets';

/** The most a page of entries is, in bytes of JSON: within RL2's message limit and plane B's backlog. */
export const CHANNEL_PAGE_BYTES = 1024 * 1024;

/** A page as a member reads it: newest first, and whether a viewable older entry remains. */
export type ChannelPage = { entries: HostEntry[]; more: boolean };

/** Every placement a reader saw of a lane B session (none read yet: undefined). */
export type SeenPlacements = (appSessionId: string) => readonly Placement[] | undefined;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= 512;

/** The lane B app sessions `entries` name: the placements their cut needs. */
export function laneBSessions(entries: readonly HostEntry[]): string[] {
  return [...new Set(entries.flatMap((entry) => (entry.lane === 'B' && isId(entry.appSessionId) ? [entry.appSessionId] : [])))];
}

/** Whether `ranks`' member views `entry`'s session now (a lane B one at every placement seen of it). */
export function viewable(entry: HostEntry, ranks: SessionRanks, seen: SeenPlacements): boolean {
  if (entry.lane === 'A') return isId(entry.engineSessionId) && ranks.holds({ target: { lane: 'A', session: entry.engineSessionId } }, 'view');
  if (entry.lane !== 'B' || !isId(entry.appSessionId)) return false;
  const placements = seen(entry.appSessionId);
  return placements !== undefined && placements.length > 0 && placements.every((placement) => ranks.holds(placement, 'view'));
}

/** A journal page, read for what the cut relies on: an entry is kept as the spine's schema gave it, an id and a lane present. */
function journalPage(value: unknown): { entries: HostEntry[]; more: boolean } | null {
  if (!isObject(value) || !Array.isArray(value.entries) || typeof value.more !== 'boolean') return null;
  const entries = value.entries.filter((entry): entry is HostEntry => isObject(entry) && isId(entry.id) && (entry.lane === 'A' || entry.lane === 'B'));
  return { entries, more: value.more };
}

/**
 * A project's journal from before `before` (an entry id; none: the newest), read until one entry more than `limit` is
 * viewable or the journal ends. `place` reads the placements of the lane B sessions each journal page names before the
 * next is read; `views` is the cut as it stands then. Throws when the spine can't answer, or answers no page.
 */
export async function readHistory(
  dispatch: EndpointServices['dispatch'],
  ask: { project: string; before?: string; limit: number },
  place: (appSessionIds: string[]) => Promise<void>,
  views: (entry: HostEntry) => boolean,
): Promise<{ entries: HostEntry[]; more: boolean }> {
  const entries: HostEntry[] = [];
  let before = ask.before;
  let kept = 0;
  for (;;) {
    const answer = await dispatch('machine', 'channel.history', { project: ask.project, ...(before === undefined ? {} : { before }), limit: HISTORY_LIMIT_MAX });
    if (!answer.ok) throw new Error(`the spine answered ${answer.error.code} for the history of ${ask.project.slice(0, 64)}`);
    const page = journalPage(answer.value);
    if (page === null) throw new Error(`the spine's history of ${ask.project.slice(0, 64)} is not a page`);
    await place(laneBSessions(page.entries));
    entries.push(...page.entries);
    kept += page.entries.filter(views).length;
    if (!page.more || page.entries.length === 0 || kept > ask.limit) return { entries, more: page.more && page.entries.length > 0 };
    before = page.entries[page.entries.length - 1].id;
  }
}

/** `readHistory`'s entries cut by `views` as it stands now: at most `limit` of them and CHANNEL_PAGE_BYTES of JSON. */
export function cutPage(read: { entries: readonly HostEntry[]; more: boolean }, limit: number, views: (entry: HostEntry) => boolean): ChannelPage {
  const kept = read.entries.filter(views);
  const entries: HostEntry[] = [];
  let bytes = 0;
  for (const entry of kept) {
    if (entries.length === limit) break;
    bytes += Buffer.byteLength(JSON.stringify(entry));
    if (entries.length > 0 && bytes > CHANNEL_PAGE_BYTES) break;
    entries.push(entry);
  }
  return { entries, more: entries.length < kept.length || read.more };
}

/** The placements of `ids` not yet in `placed`, read from the spine's records (`placeRecorded`); throws as it does. */
export async function placeInto(placed: Map<string, Placement>, ids: readonly string[], dispatch: EndpointServices['dispatch']): Promise<void> {
  const missing = ids.filter((id) => !placed.has(id));
  for (const [id, placement] of await Promise.all(missing.map(async (id) => [id, await placeRecorded(id, dispatch)] as const))) placed.set(id, placement);
}
