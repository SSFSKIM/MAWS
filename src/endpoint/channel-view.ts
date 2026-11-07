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
// The journal answers a project's history whole, newest first, a page of HISTORY_LIMIT_MAX at a time and at most
// CHANNEL_PAGE_BYTES of them (src/services/channel/). A member's page is cut from as many journal pages as fill it
// (`readViewable`): each journal page is ranked as it comes and only what the member views is kept, the one entry past
// the page too, so `more` says exactly whether a viewable older entry remains, and a member who views few of a busy
// project's sessions still pages on from the last entry they were given. What a read holds is bounded by what it keeps
// (a page and one entry), not by what it scans, so it reads on to the journal's end, which holds at most 2,000 entries a
// project: a read past SCAN_ENTRIES is of a journal it can't page exactly, and is no read (thrown: `unavailable`), never a
// page that says `more: false` with a viewable entry left. A page is bounded by its bytes too (CHANNEL_PAGE_BYTES of JSON),
// within the channel's message limit and a feed's backlog; an entry is at most ~640 KiB (the journal's cuts), so a page
// always holds its first.
//
// A lane B session is ranked at every placement a reader saw of it from its mark on (`PlacementBook`): the spine's record
// read after the mark, and every record heard since the mark, before that read too, a removed record placing nobody.
// Placements only narrow within a read: none heard can widen what the member views. A page is published only while
// everything its read kept still stands, the entry past it too, and no session it passed by is viewable now (`publish`):
// else it is read again, since what it passed by may belong on the page.
import type { OrgState } from 'org-protocol';
import { HISTORY_LIMIT_MAX, type HostEntry } from '@shared/ipc/schema/channel';
import type { SessionRanks } from './authorize';
import type { EndpointServices } from './services';
import { placeRecorded, type Placement } from './targets';

/** The most a page of entries is, in bytes of JSON: within RL2's message limit and plane B's backlog. */
export const CHANNEL_PAGE_BYTES = 1024 * 1024;

/** A page as a member reads it: newest first, and whether a viewable older entry remains. */
export type ChannelPage = { entries: HostEntry[]; more: boolean };

/**
 * The most entries one read of a member's page scans: twice what the journal holds of a project (CHANNEL_BOUNDS.perProject,
 * 2,000), for what is recorded while the read goes. Past it the read is no read.
 */
export const SCAN_ENTRIES = 4_000;
/** The most distinct placements heard of one session a book holds; past it the session is placed nowhere (nobody views it). */
export const HEARD_MAX = 32;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= 512;

/**
 * Whether `project` (sminos's project id) is one of the org's projects in `head`: the reach of a `channel` feed and of
 * `channel.history`, which every member of the org holds while the project stands, as the hub admits a member to a
 * project's socket.
 */
export function orgProject(head: OrgState | null | undefined, project: string): boolean {
  return head?.projects.some((p) => p.id === project) === true;
}

/** The lane B app sessions `entries` name: the placements their cut needs. */
export function laneBSessions(entries: readonly HostEntry[]): string[] {
  return [...new Set(entries.flatMap((entry) => (entry.lane === 'B' && isId(entry.appSessionId) ? [entry.appSessionId] : [])))];
}

type Read = { start: number; placement: Placement; landed: boolean; promise: Promise<void> };
type Heard = { at: number; placement: Placement };

const samePlacement = (a: Placement, b: Placement): boolean =>
  a === null || b === null ? a === b : a.target.session === b.target.session && a.target.appSessionId === b.target.appSessionId && a.launchedBy?.member === b.launchedBy?.member;

/**
 * Every placement a reader saw of each lane B session. A reader takes a mark (`mark`) before it ranks; a session is
 * ranked for it by the reads of its record begun after the mark (`ensure`) and by every record heard after the mark
 * (`heard`: a `session.changed`, or a `session.removed` placing nobody), before or after the read began, every one of
 * which the member must view (`seen`). A placement heard again is kept once, at its latest hearing; past HEARD_MAX
 * distinct ones the session is placed nowhere. A read is begun only when none begun after the mark is held or out; while
 * one is out, every later reader waits on one more, begun once it lands, so a burst of entries costs a read a round
 * trip. What no reader still needs is let go of (`prune`).
 */
export class PlacementBook {
  #clock = 0;
  readonly #reads = new Map<string, Read[]>();
  readonly #heard = new Map<string, Heard[]>();
  readonly #next = new Map<string, Promise<void>>();

  /** A reader's mark: what it ranks by is read, or heard, after it. */
  mark(): number {
    return ++this.#clock;
  }

  /** A read of the session's record begun after `after`, held or out, or one begun for it; throws as `placeRecorded` does. */
  ensure(appSessionId: string, after: number, dispatch: EndpointServices['dispatch']): Promise<void> {
    const reads = this.#reads.get(appSessionId);
    const fresh = reads?.find((read) => read.start > after);
    if (fresh !== undefined) return fresh.promise;
    const next = this.#next.get(appSessionId);
    if (next !== undefined) return next;
    const out = reads?.find((read) => !read.landed);
    if (out === undefined) return this.#begin(appSessionId, dispatch);
    const queued = out.promise
      .catch(() => {})
      .then(() => {
        this.#next.delete(appSessionId);
        return this.#begin(appSessionId, dispatch);
      });
    this.#next.set(appSessionId, queued);
    return queued;
  }

  /** A record of the session heard (null: removed, or placing no engine session): one more placement its readers since are held to. */
  heard(appSessionId: string, placement: Placement): void {
    const at = ++this.#clock;
    const heard = (this.#heard.get(appSessionId) ?? []).filter((h) => !samePlacement(h.placement, placement));
    heard.push({ at, placement });
    this.#heard.set(appSessionId, heard.length > HEARD_MAX ? [{ at, placement: null }] : heard);
  }

  /** Every placement seen of the session from `after` on: its reads begun since and what was heard since; undefined while none of the reads landed. */
  seen(appSessionId: string, after: number): readonly Placement[] | undefined {
    const landed = (this.#reads.get(appSessionId) ?? []).filter((read) => read.landed && read.start > after);
    if (landed.length === 0) return undefined;
    return [...landed.map((read) => read.placement), ...(this.#heard.get(appSessionId) ?? []).filter((h) => h.at > after).map((h) => h.placement)];
  }

  /** Lets go of every landed read and every hearing but those a reader still ranks by: per session, those after its oldest mark. */
  prune(needs: Iterable<readonly [string, number]>): void {
    const oldest = new Map<string, number>();
    for (const [id, after] of needs) oldest.set(id, Math.min(oldest.get(id) ?? Infinity, after));
    for (const [id, reads] of this.#reads) {
      const after = oldest.get(id);
      const kept = reads.filter((read) => !read.landed || (after !== undefined && read.start > after));
      if (kept.length === 0) this.#reads.delete(id);
      else this.#reads.set(id, kept);
    }
    for (const [id, heard] of this.#heard) {
      const after = oldest.get(id);
      const kept = after === undefined ? [] : heard.filter((h) => h.at > after);
      if (kept.length === 0) this.#heard.delete(id);
      else this.#heard.set(id, kept);
    }
  }

  /** Whether it holds a read of the session, landed or out. */
  has(appSessionId: string): boolean {
    return this.#reads.has(appSessionId);
  }

  /** The sessions it holds reads or hearings of. */
  get size(): number {
    return new Set([...this.#reads.keys(), ...this.#heard.keys()]).size;
  }

  #begin(appSessionId: string, dispatch: EndpointServices['dispatch']): Promise<void> {
    const read: Read = { start: ++this.#clock, placement: null, landed: false, promise: Promise.resolve() };
    this.#reads.set(appSessionId, [...(this.#reads.get(appSessionId) ?? []), read]);
    read.promise = placeRecorded(appSessionId, dispatch).then(
      (placement) => {
        read.placement = placement;
        read.landed = true;
      },
      (error: unknown) => {
        const left = (this.#reads.get(appSessionId) ?? []).filter((r) => r !== read);
        if (left.length === 0) this.#reads.delete(appSessionId);
        else this.#reads.set(appSessionId, left);
        throw error;
      },
    );
    return read.promise;
  }
}

/** What names an entry's session: its lane, and that lane's id (an entry's, or a cursor's: channel-cursors.ts). */
export type EntrySession = { lane: string; appSessionId: string | null; engineSessionId: string | null };

/**
 * Whether `ranks`' member views `entry`'s session now: a lane A one by sminos's record, a lane B one at every placement
 * `book` saw of it since `after` (none read yet: not viewable).
 */
export function viewable(entry: EntrySession, ranks: SessionRanks, book: PlacementBook, after: number): boolean {
  if (entry.lane === 'A') return isId(entry.engineSessionId) && ranks.holds({ target: { lane: 'A', session: entry.engineSessionId } }, 'view');
  if (entry.lane !== 'B' || !isId(entry.appSessionId)) return false;
  const placements = book.seen(entry.appSessionId, after);
  return placements !== undefined && placements.length > 0 && placements.every((placement) => ranks.holds(placement, 'view'));
}

/** A journal page, read for what the cut relies on: an entry is kept as the spine's schema gave it, an id and a lane present. */
function journalPage(value: unknown): { entries: HostEntry[]; more: boolean } | null {
  if (!isObject(value) || !Array.isArray(value.entries) || typeof value.more !== 'boolean') return null;
  const entries = value.entries.filter((entry): entry is HostEntry => isObject(entry) && isId(entry.id) && (entry.lane === 'A' || entry.lane === 'B'));
  return { entries, more: value.more };
}

/**
 * What a member's read kept, newest first (the page's entries and the one past them), and the sessions of what it passed
 * by, each once: what `publish` checks again.
 */
export type ViewableRead = { kept: HostEntry[]; skipped: EntrySession[] };

/**
 * A project's journal from before `before` (a journal id; none: the newest), ranked page by page as it is read: `place`
 * reads the placements of the lane B sessions a journal page names, then `views` keeps what the member views of it. It
 * stops once one entry past `limit` (or past CHANNEL_PAGE_BYTES of them) is kept, or at the journal's end. Throws when the
 * spine can't answer, answers no page, or the journal runs past SCAN_ENTRIES.
 */
export async function readViewable(
  dispatch: EndpointServices['dispatch'],
  ask: { project: string; before?: string; limit: number },
  views: (entry: HostEntry) => boolean,
  place: (appSessionIds: string[]) => Promise<void>,
): Promise<ViewableRead> {
  const kept: HostEntry[] = [];
  const skipped = new Map<string, EntrySession>();
  let keptBytes = 0;
  let scanned = 0;
  let before = ask.before;
  for (;;) {
    const answer = await dispatch('machine', 'channel.history', { project: ask.project, ...(before === undefined ? {} : { before }), limit: HISTORY_LIMIT_MAX });
    if (!answer.ok) throw new Error(`the spine answered ${answer.error.code} for the history of ${ask.project.slice(0, 64)}`);
    const page = journalPage(answer.value);
    if (page === null) throw new Error(`the spine's history of ${ask.project.slice(0, 64)} is not a page`);
    await place(laneBSessions(page.entries));
    for (const entry of page.entries) {
      if (!views(entry)) {
        const session: EntrySession = { lane: entry.lane, appSessionId: entry.lane === 'B' ? entry.appSessionId : null, engineSessionId: entry.lane === 'A' ? entry.engineSessionId : null };
        skipped.set(`${session.lane}\n${session.appSessionId ?? session.engineSessionId ?? ''}`, session);
        continue;
      }
      kept.push(entry);
      keptBytes += Buffer.byteLength(JSON.stringify(entry));
      if (kept.length > ask.limit || (kept.length > 1 && keptBytes > CHANNEL_PAGE_BYTES)) return { kept, skipped: [...skipped.values()] };
    }
    if (!page.more || page.entries.length === 0) return { kept, skipped: [...skipped.values()] };
    scanned += page.entries.length;
    if (scanned >= SCAN_ENTRIES) throw new Error(`the history of ${ask.project.slice(0, 64)} runs past the scan's bound (${SCAN_ENTRIES} entries)`);
    before = page.entries[page.entries.length - 1].id;
  }
}

/** At most `limit` of `entries` and CHANNEL_PAGE_BYTES of their JSON, each as `seal` names it, `more` when one is left past them. */
function page(entries: readonly HostEntry[], limit: number, seal: (entry: HostEntry) => HostEntry): ChannelPage {
  const out: HostEntry[] = [];
  let bytes = 0;
  for (const entry of entries) {
    if (out.length === limit) break;
    const sealed = seal(entry);
    bytes += Buffer.byteLength(JSON.stringify(sealed));
    if (out.length > 0 && bytes > CHANNEL_PAGE_BYTES) break;
    out.push(sealed);
  }
  return { entries: out, more: out.length < entries.length };
}

/**
 * The page a read kept, as it goes: null (read it again) when anything it kept, the entry past the page too, is no
 * longer viewable, or a session it passed by is viewable now; else at most `limit` entries and CHANNEL_PAGE_BYTES of their
 * JSON, each as `seal` names it, `more` when a kept entry is left past them.
 */
export function publish(read: { kept: readonly HostEntry[]; skipped: readonly EntrySession[] }, limit: number, views: (entry: EntrySession) => boolean, seal: (entry: HostEntry) => HostEntry): ChannelPage | null {
  if (!read.kept.every(views) || read.skipped.some(views)) return null;
  return page(read.kept, limit, seal);
}

/** What is viewable now of what a read kept, as a page: a feed's snapshot read again past its bound (channel-feed.ts). */
export function publishFiltered(read: { kept: readonly HostEntry[] }, limit: number, views: (entry: EntrySession) => boolean, seal: (entry: HostEntry) => HostEntry): ChannelPage {
  return page(read.kept.filter(views), limit, seal);
}
