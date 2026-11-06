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
// project's sessions still pages on from the last entry they were given. What a read scans is bounded (SCAN_BYTES of the
// journal's JSON): past it the page is what it found, `more` false (a member viewing next to nothing of a project whose
// entries are large reads the rest from a later entry they view). A page is bounded by its bytes too (CHANNEL_PAGE_BYTES of
// JSON), within the channel's message limit and a feed's backlog; an entry is at most ~640 KiB (the journal's cuts), so a
// page always holds its first.
//
// Fix wave (P5 O8 M7b): a lane B session is ranked at every placement a reader saw of it since its read began
// (`PlacementBook`): the spine's record read after the reader's mark, and every record heard since, a removed record
// placing nobody. Placements only narrow within a read: none heard can widen what the member views. A page is published
// only while everything its read kept still stands, the entry past it too (`publish`); else it is read again.
import type { OrgState } from 'org-protocol';
import { HISTORY_LIMIT_MAX, type HostEntry } from '@shared/ipc/schema/channel';
import type { SessionRanks } from './authorize';
import type { EndpointServices } from './services';
import { placeRecorded, type Placement } from './targets';

/** The most a page of entries is, in bytes of JSON: within RL2's message limit and plane B's backlog. */
export const CHANNEL_PAGE_BYTES = 1024 * 1024;

/** A page as a member reads it: newest first, and whether a viewable older entry remains. */
export type ChannelPage = { entries: HostEntry[]; more: boolean };

/** The most of the journal's JSON one read of a member's page scans. */
export const SCAN_BYTES = 16 * 1024 * 1024;

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

type Read = { start: number; placements: Placement[]; landed: boolean; promise: Promise<void> };

/**
 * Every placement a reader saw of each lane B session, read by read. A reader takes a mark (`mark`) before it ranks; a
 * session is ranked for it by the reads begun after its mark (`ensure`), each holding the spine's record as read and every
 * record heard since the read began (`heard`: a `session.changed`, or a `session.removed` placing nobody), every one of
 * which the member must view (`seen`). A read is begun only when none begun after the mark is held or out; while one is
 * out, every later reader waits on one more, begun once it lands, so a burst of entries costs a read a round trip. What
 * no reader still needs is let go of (`prune`).
 */
export class PlacementBook {
  #clock = 0;
  readonly #reads = new Map<string, Read[]>();
  readonly #next = new Map<string, Promise<void>>();

  /** A reader's mark: what it ranks by is read after it. */
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

  /** A record of the session heard (null: removed, or placing no engine session): one more placement of every read of it. */
  heard(appSessionId: string, placement: Placement): void {
    for (const read of this.#reads.get(appSessionId) ?? []) read.placements.push(placement);
  }

  /** Every placement the reads of the session begun after `after` saw; undefined while none of them landed. */
  seen(appSessionId: string, after: number): readonly Placement[] | undefined {
    const landed = (this.#reads.get(appSessionId) ?? []).filter((read) => read.landed && read.start > after);
    return landed.length === 0 ? undefined : landed.flatMap((read) => read.placements);
  }

  /** Lets go of every landed read but those a reader still ranks by: per session, the reads begun after its oldest mark. */
  prune(needs: Iterable<readonly [string, number]>): void {
    const oldest = new Map<string, number>();
    for (const [id, after] of needs) oldest.set(id, Math.min(oldest.get(id) ?? Infinity, after));
    for (const [id, reads] of this.#reads) {
      const after = oldest.get(id);
      const kept = reads.filter((read) => !read.landed || (after !== undefined && read.start > after));
      if (kept.length === 0) this.#reads.delete(id);
      else this.#reads.set(id, kept);
    }
  }

  /** Whether it holds a read of the session, landed or out. */
  has(appSessionId: string): boolean {
    return this.#reads.has(appSessionId);
  }

  /** The sessions it holds reads of. */
  get size(): number {
    return this.#reads.size;
  }

  #begin(appSessionId: string, dispatch: EndpointServices['dispatch']): Promise<void> {
    const read: Read = { start: ++this.#clock, placements: [], landed: false, promise: Promise.resolve() };
    this.#reads.set(appSessionId, [...(this.#reads.get(appSessionId) ?? []), read]);
    read.promise = placeRecorded(appSessionId, dispatch).then(
      (placement) => {
        read.placements.unshift(placement);
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

/** What a member's read kept, newest first: the page's entries and the one past them; `truncated`, stopped at SCAN_BYTES. */
export type ViewableRead = { kept: HostEntry[]; truncated: boolean };

/**
 * A project's journal from before `before` (a journal id; none: the newest), ranked page by page as it is read: `place`
 * reads the placements of the lane B sessions a journal page names, then `views` keeps what the member views of it. It
 * stops once one entry past `limit` (or past CHANNEL_PAGE_BYTES of them) is kept, at the journal's end, or past
 * SCAN_BYTES scanned. Throws when the spine can't answer, or answers no page.
 */
export async function readViewable(
  dispatch: EndpointServices['dispatch'],
  ask: { project: string; before?: string; limit: number },
  views: (entry: HostEntry) => boolean,
  place: (appSessionIds: string[]) => Promise<void>,
): Promise<ViewableRead> {
  const kept: HostEntry[] = [];
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
      if (!views(entry)) continue;
      kept.push(entry);
      keptBytes += Buffer.byteLength(JSON.stringify(entry));
      if (kept.length > ask.limit || (kept.length > 1 && keptBytes > CHANNEL_PAGE_BYTES)) return { kept, truncated: false };
    }
    if (!page.more || page.entries.length === 0) return { kept, truncated: false };
    scanned += Buffer.byteLength(JSON.stringify(page.entries));
    if (scanned >= SCAN_BYTES) return { kept, truncated: true };
    before = page.entries[page.entries.length - 1].id;
  }
}

/**
 * The page a read kept, as it goes: null (read it again) when anything it kept, the entry past the page too, is no
 * longer viewable; else at most `limit` entries and CHANNEL_PAGE_BYTES of their JSON, each as `seal` names it, `more`
 * when a kept entry is left past them.
 */
export function publish(kept: readonly HostEntry[], limit: number, views: (entry: HostEntry) => boolean, seal: (entry: HostEntry) => HostEntry): ChannelPage | null {
  if (!kept.every(views)) return null;
  const entries: HostEntry[] = [];
  let bytes = 0;
  for (const entry of kept) {
    if (entries.length === limit) break;
    const sealed = seal(entry);
    bytes += Buffer.byteLength(JSON.stringify(sealed));
    if (entries.length > 0 && bytes > CHANNEL_PAGE_BYTES) break;
    entries.push(sealed);
  }
  return { entries, more: entries.length < kept.length };
}
