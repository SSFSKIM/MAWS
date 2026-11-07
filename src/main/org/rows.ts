// The remote rows (P5 O8 M2, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M2's "Where rows come from",
// "Which rows exist", "The join to org projects", the snapshot rule's `complete` and `pending`, and Interfaces §C's
// `listings.json`, §G and §H): main's source of the sessions other machines list at the hub. It keeps every listing the
// Registry feed brings that verifies against the held org head, caches them, and emits `OrgRows` for the machines in
// O7's RL2 roster. The hub is not trusted: each record is verified (`verifyListing`) against the session's view, and
// judged against its key's high-water mark.
//
// Each key (`<ref>/<session>`) keeps a mark of the newest record accepted for it, apart from its row: its revision, the
// SHA-256 of its canonical form, the key id that signed it, the delegation of the certificate it was signed under (null
// for an enrolled machine), and whether it withdrew the session (`gone`). A record below its mark is ignored; one at the
// mark's revision is the same record when its hash is the mark's (a live mark's row is restored or kept, a `gone` mark's
// key stays without one) and a conflict otherwise (ignored, logged); one above it is verified and becomes the row (or
// removes it) and the mark. A mark is dropped only when the held head lists its key in `revoked` or `retired`, or its
// delegation in `revoked`: never by count or age, never at a delegation's `expires`, never on an empty `machineKeys`
// (rounds 2 to 4 of the document's review), since each of those lets a still-verifiable older revision return.
//
// A record that fails verification waits in a bounded set (UNVERIFIED_MAX, newest kept) and is tried again at each
// change of the session; at each new head or certificate set every held record is verified again, and one that fails
// leaves the rows for the waiting set. The feed's `listings` pages, once `last` arrives, replace the rows: a key the
// snapshot lacks leaves the rows (withdrawn listings are never in pages) and keeps its mark, unless a live `listing`
// frame brought it since the feed opened. Everything runs in one queue, behind the cache's read, so no record is judged
// before the persisted marks are held.
//
// M5 ("Names"; Interfaces §L): beside the rows go `member`, the signed-in member they were computed for (so "you" is
// judged against the same identity as `mine`), and `members`, every member id some row's owners name with its email
// and name from the held head (an id the head doesn't list reads "former member"), so the renderer derives nothing from
// state it doesn't hold.
//
// M6b ("Channel listings into the rows"): a private session's listing never reaches the hub, only its owners and shares
// through `endpoint.listings` over a channel, so the rows also read each roster machine's listings from its link: at
// link up, at each new head, after each policy act (`refreshChannel`), and every ROWS_CHANNEL_MS while up. Each record
// is judged as a hub one is, under the same marks. A held key keeps two memberships apart, whichever source showed it
// first: the hub's (its snapshot's pages and the live frames since the feed opened) and its machine's last channel
// answer. Each is the revision that source last showed the key at, and holds while that is the key's newest accepted
// revision: a higher revision from either source replaces the record (the other's older one no longer holds), an older
// one is ignored (a delayed hub `gone` included), and a `gone` at a higher revision removes the row from both. A hub
// snapshot's completion clears only the hub's membership of the keys it lacked, and a channel answer only the channel's
// of its machine's keys it lacked; a call that failed (a dropped link) clears nothing. A row is drawn while either
// holds, so a session that goes private moves from the hub's snapshot to the channel's without its row blinking. A
// record waiting on verification remembers which sources showed it, and a held one keeps no row once neither holds.
// When a `gone` lands for a row the channel held (the hub's withdrawal arriving before the channel's private listing),
// the row goes, as the rule says, and the machine's channel is asked at once, so it comes back within a round trip.
//
// Electron-free: vitest's node project runs it, and O3 moves it with the index into `mawsd`.
import { createHash } from 'node:crypto';
import {
  canonicalize,
  isListing,
  isListingGone,
  isSigned,
  keyId,
  verifyListing,
  verifyMachineCert,
  type Certificates,
  type Listing,
  type OrgState,
  type Signed,
  type SignedOrgState,
} from '../../../apps/org-protocol/src/index.ts';
import { FORMER_MEMBER, type OrgMember, type OrgRows, type RemoteRow } from '@shared/ipc/schema/org';
import type { ProjectRecord } from '@shared/ipc/schema/session';
import type { OrgKey } from '@shared/machine/org-key';
import type { MachineRef } from '@shared/machine/ref';
import type { LinkState } from '../machines/manager';
import type { RemoteLink } from '../machines/remote/link';
import { memberNames } from '@shared/org/member-name';
import { repoProjectId } from '@shared/machine/project-ids';
import type { OrgFiles } from './files';
import type { RegistryFeed } from './registry-feed';
import type { OrgSession, SignedIn } from './session';
import { orgTiming, type OrgTiming } from './timing';

export const LISTINGS_FILE = 'listings.json';

/** A key's high-water mark (Interfaces §C). */
export type ListingMark = { revision: number; hash: string; kid: string; delegation: string | null; gone: boolean };
/** M6b: the revision each source last showed a held key at, null while its set lacks the key. */
export type ListingShown = { hub: number | null; channel: number | null };
/** `shown` (M6b) is absent from a file M2 wrote, whose records were all the hub's. */
export type ListingsFile = { version: 1; org: string; records: Signed<Listing>[]; marks: Record<string, ListingMark>; shown?: Record<string, ListingShown> };
/** What the rows read of an RL2 link (M6b): its state, and `endpoint.listings`. */
export type ListingsLink = Pick<RemoteLink, 'call'> & { state(): LinkState; onState(listener: (state: LinkState) => void): () => void };
type Source = keyof ListingShown;

/** `<ref>/<session>`: a ref holds no `/`, so the first one splits it. */
export const listingKey = (listing: Listing): string => `${listing.machine}/${listing.session}`;
/** The SHA-256 of the record's canonical form (body and signature), base64url as the package's B64. */
export const listingHash = (record: Signed<Listing>): string => createHash('sha256').update(canonicalize(record)).digest('base64url');

export interface RemoteRows {
  rows(): OrgRows;
  /** The cache read and, if signed in then, applied; the local projects read. */
  loaded: Promise<void>;
  /** Resolves once everything received so far is applied (the suites', and a caller that must read after a change). */
  settled(): Promise<void>;
  /** M6b: the machine's channel listings read again (after a policy act's outcome), while its link is up. */
  refreshChannel(ref: MachineRef): void;
  close(): Promise<void>;
}

export interface RemoteRowsDeps {
  session: OrgSession;
  feed: RegistryFeed;
  /** O7's RL2 roster (`Machines.onRemote`): the local machine and contested refs left out. */
  roster(): readonly MachineRef[];
  onRoster(listener: () => void): () => void;
  localProjects(): Promise<readonly ProjectRecord[]>;
  onLocalProjects(listener: () => void): () => void;
  /** M6b: a roster machine's link (`Machines.remote`), for its channel listings; null while it has none. */
  link(ref: MachineRef): ListingsLink | null;
  files: OrgFiles;
  emit(rows: OrgRows): void;
  now?(): number;
  timing?: Partial<OrgTiming>;
  log(line: string): void;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function isMark(value: unknown): value is ListingMark {
  return (
    isObject(value) &&
    typeof value.revision === 'number' &&
    Number.isInteger(value.revision) &&
    value.revision >= 1 &&
    typeof value.hash === 'string' &&
    typeof value.kid === 'string' &&
    (value.delegation === null || typeof value.delegation === 'string') &&
    typeof value.gone === 'boolean'
  );
}

const isRevision = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 1);
const isShown = (value: unknown): value is ListingShown => isObject(value) && isRevision(value.hub) && isRevision(value.channel);

function isListingsFile(value: unknown): value is ListingsFile {
  return isObject(value) && value.version === 1 && typeof value.org === 'string' && Array.isArray(value.records) && isObject(value.marks);
}

/** Whether the head is signed evidence that the mark's key can never speak again (the only reason a mark drops). */
function markDead(state: OrgState, kid: string, delegation: string | null): boolean {
  return (
    state.retired.some((r) => r.keyId === kid) ||
    state.revoked.some((r) => r.keyId === kid || (delegation !== null && 'delegation' in r.holder && r.holder.delegation === delegation))
  );
}

/** A log's view of a hub-supplied key: bounded, quoted. */
const shown = (key: string) => JSON.stringify(key.length > 120 ? `${key.slice(0, 120)}…` : key);

/** A record that failed verification, and the sources that showed it (M6b). */
type Waiting = { key: string; hash: string; record: Signed<Listing>; sources: Set<Source> };
/** An accepted live record, and the revision each source last showed its key at (M6b). */
type Held = { record: Signed<Listing> } & ListingShown;
/** Whether either source holds the held key at its record's revision, the newest accepted. */
const holds = (h: Held): boolean => h.hub === h.record.body.revision || h.channel === h.record.body.revision;
const HUB: ReadonlySet<Source> = new Set(['hub']);
const CHANNEL: ReadonlySet<Source> = new Set(['channel']);
/** A machine's channel, as the rows read it: one `endpoint.listings` call out at a time (`again`: one more after it). */
type Watch = { ref: MachineRef; link: ListingsLink; up: boolean; asking: boolean; again: boolean; timer: ReturnType<typeof setTimeout> | null; off: () => void };

export function createRemoteRows(deps: RemoteRowsDeps): RemoteRows {
  const timing = orgTiming(deps.timing);
  const now = () => new Date(deps.now?.() ?? Date.now());
  const log = (line: string) => deps.log(`[org-rows] ${line}`);

  /** The org the marks, rows and waiting records belong to: the signed-in org's, once one signed in. */
  let dataOrg: string | null = null;
  const marks = new Map<string, ListingMark>();
  /** The accepted live records a source holds, each verified against the head and certificates last judged against. */
  const held = new Map<string, Held>();
  /** Records that failed verification, by `<key>\n<hash>`, oldest first. */
  const waiting = new Map<string, Waiting>();
  /** The cache as read, until a signed-in session applies it. */
  let cache: ListingsFile | null = null;
  let judgedAgainst: { head: SignedOrgState; certificates: Certificates } | null = null;

  // This run's feed: the snapshot gathered since the last open, and what the open announced.
  let gathering = false;
  let snapshotKeys = new Set<string>();
  /** Keys a live `listing` frame brought since the open: a snapshot that lacks them was taken before them. */
  let liveKeys = new Set<string>();
  let snapshotApplied = false;
  let announced: number | null = null;

  let projects: readonly ProjectRecord[] = [];
  let projectsRead = 0;
  let joinMemo: { projects: readonly ProjectRecord[]; org: string; join: Map<string, OrgKey> } | null = null;

  // M6b: each roster machine's channel, and the head they were last all asked at
  const watched = new Map<MachineRef, Watch>();
  let askedAt: SignedOrgState | null = null;

  let closed = false;
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  let lastEmitted: string | null = null;
  let writeTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let writing: Promise<void> = Promise.resolve();

  // ---- the queue ----

  let queue: Promise<void> = (async () => {
    const raw = await deps.files.read(LISTINGS_FILE);
    if (raw === null) return;
    if (isListingsFile(raw)) cache = raw;
    else log(`${LISTINGS_FILE} is not a listings file, treated as absent`);
  })().catch((error: unknown) => log(`${LISTINGS_FILE} did not read: ${(error as Error).message}`));

  function enqueue(what: string, step: () => Promise<void> | void): Promise<void> {
    const run = queue.then(async () => {
      if (closed) return;
      try {
        await step();
      } catch (error) {
        log(`${what} failed: ${(error as Error).message}`);
      }
      schedule();
    });
    queue = run;
    return run;
  }

  // ---- judging ----

  const signedIn = (): SignedIn | null => {
    const current = deps.session.current();
    return current !== null && current.identity.org === dataOrg ? current : null;
  };

  /**
   * The delegation of the certificate a verified record was signed under; null for an enrolled machine's key. Only a
   * certificate that verifies under the same head counts: the hub's set is only shape-checked, and a copy of a genuine
   * certificate with its `delegation` altered would otherwise name a delegation whose revocation drops the mark. Two
   * verified certificates for the machine and key naming different delegations give null too, which keeps the mark
   * until the key itself is retired or revoked: the barrier errs toward staying.
   */
  async function delegationOf(state: OrgState, certificates: Certificates, record: Signed<Listing>, at: Date): Promise<string | null> {
    if (state.machines.some((m) => m.ref === record.body.machine)) return null;
    let found: string | null = null;
    for (const cert of certificates.certs) {
      if (cert.body.machine !== record.body.machine || (await keyId(cert.body.pub)) !== record.sig.kid) continue;
      if (!(await verifyMachineCert(state, cert, at)).ok) continue;
      if (found !== null && found !== cert.body.delegation) return null;
      found = cert.body.delegation;
    }
    return found;
  }

  async function verified(current: SignedIn, record: Signed<Listing>, at: Date): Promise<boolean> {
    const verdict = await verifyListing(current.view.head().state, record, current.view.certificates(), at);
    return verdict.ok;
  }

  /** Waits a record for a later judgment, with the sources that showed it (merged into its earlier wait, if any). */
  function wait(entry: Waiting, state: OrgState): void {
    // a record whose key the head retired or revoked can never verify
    if (markDead(state, entry.record.sig.kid, null)) return;
    const id = `${entry.key}\n${entry.hash}`;
    const before = waiting.get(id);
    waiting.delete(id);
    waiting.set(id, before === undefined ? entry : { ...entry, sources: new Set([...before.sources, ...entry.sources]) });
    while (waiting.size > timing.UNVERIFIED_MAX) waiting.delete(waiting.keys().next().value as string);
  }

  /** A source's set no longer holds the key at its newest revision: its membership goes, and the row with the last one. */
  function release(key: string, source: Source): void {
    const h = held.get(key);
    if (h === undefined || h[source] === null) return;
    h[source] = null;
    if (!holds(h)) held.delete(key);
    changed();
  }

  /** `source` left the waiting records `kept` says no to: a record no source shows any more stops waiting. */
  function unwait(source: Source, kept: (entry: Waiting) => boolean): void {
    for (const [id, entry] of waiting) {
      if (kept(entry) || !entry.sources.delete(source)) continue;
      if (entry.sources.size === 0) waiting.delete(id);
    }
  }

  function accept(entry: Waiting, delegation: string | null): void {
    const { key, hash, record, sources } = entry;
    const revision = record.body.revision;
    const gone = isListingGone(record.body);
    const next: Held = { record, hub: sources.has('hub') ? revision : null, channel: sources.has('channel') ? revision : null };
    // a withdrawal of a row its machine's channel held (the hub's, as a session goes private) asks that channel at once,
    // so the row it may still list comes back within a round trip rather than at the next period
    if (gone && held.get(key)?.channel != null) {
      const watch = watched.get(record.body.machine as MachineRef);
      if (watch !== undefined) ask(watch);
    }
    if (gone || !holds(next)) held.delete(key);
    else held.set(key, next);
    marks.set(key, { revision, hash, kid: record.sig.kid, delegation, gone });
    for (const [id, other] of waiting) if (other.key === key && other.record.body.revision <= revision) waiting.delete(id);
    changed();
  }

  /**
   * One record against its key's mark, then the head, as `sources` showed it (M6b): the hub, a channel, or for a cached
   * or waiting record the sources that held it. An older record changes nothing; the mark's own record, held, is now
   * held by these sources too; anything newer is verified, waits with its sources, or replaces the row as theirs alone.
   */
  async function judge(current: SignedIn, record: Signed<Listing>, sources: ReadonlySet<Source>, hash = listingHash(record)): Promise<void> {
    const key = listingKey(record.body);
    const revision = record.body.revision;
    const mark = marks.get(key);
    if (mark !== undefined) {
      if (revision < mark.revision) return;
      if (revision === mark.revision) {
        if (hash !== mark.hash) {
          log(`a conflicting record for ${shown(key)} at revision ${mark.revision} ignored`);
          return;
        }
        if (mark.gone) return;
        const h = held.get(key);
        if (h !== undefined) {
          for (const source of sources) {
            if (h[source] === revision) continue;
            h[source] = revision;
            changed();
          }
          return;
        }
      }
    }
    const state = current.view.head().state;
    const certificates = current.view.certificates();
    const at = now();
    if (!(await verified(current, record, at))) {
      wait({ key, hash, record, sources: new Set(sources) }, state);
      return;
    }
    accept({ key, hash, record, sources: new Set(sources) }, await delegationOf(state, certificates, record, at));
  }

  /** A hub-supplied record's shape, and its org: anything else never verifies and isn't held. */
  function usable(current: SignedIn, record: unknown): record is Signed<Listing> {
    return isSigned(record, isListing) && record.body.org === current.identity.org;
  }

  /** Drops every mark (and its row) whose key or delegation the head has ended, and waiting records of ended keys. */
  function dropEnded(state: OrgState): void {
    for (const [key, mark] of marks) {
      if (!markDead(state, mark.kid, mark.delegation)) continue;
      marks.delete(key);
      held.delete(key);
      changed();
    }
    for (const [id, entry] of waiting) if (markDead(state, entry.record.sig.kid, null)) waiting.delete(id);
  }

  async function retryWaiting(current: SignedIn): Promise<void> {
    // Each entry stays in `waiting` while it is judged, so a read meanwhile still names its machine in `pending`. Then
    // it goes unless the judgment replaced it: `accept` has removed it, `wait` has set a new entry, and anything else
    // (below its mark, a conflict, an ended key) leaves this one.
    for (const [id, entry] of [...waiting]) {
      await judge(current, entry.record, entry.sources, entry.hash);
      if (waiting.get(id) === entry) waiting.delete(id);
    }
  }

  /** The sources holding a held key now. */
  const holders = (h: Held): Set<Source> => new Set((['hub', 'channel'] as const).filter((source) => h[source] === h.record.body.revision));

  async function reverifyHeld(current: SignedIn): Promise<void> {
    const state = current.view.head().state;
    for (const [key, h] of [...held]) {
      if (held.get(key) !== h || (await verified(current, h.record, now()))) continue;
      held.delete(key);
      wait({ key, hash: listingHash(h.record), record: h.record, sources: holders(h) }, state);
      changed();
    }
  }

  async function applyCache(current: SignedIn, file: ListingsFile): Promise<void> {
    if (file.org !== current.identity.org) {
      log(`${LISTINGS_FILE} holds another org's listings, discarded`);
      return;
    }
    for (const [key, mark] of Object.entries(file.marks)) if (isMark(mark) && !marks.has(key)) marks.set(key, mark);
    dropEnded(current.view.head().state);
    const sourcesOf = file.shown === undefined ? null : isObject(file.shown) ? file.shown : {};
    for (const record of file.records) {
      if (!usable(current, record)) continue;
      const key = listingKey(record.body);
      const hash = listingHash(record);
      const mark = marks.get(key);
      if (mark === undefined || mark.gone || mark.revision !== record.body.revision || mark.hash !== hash) {
        log(`a cached record for ${shown(key)} is not its mark's, skipped`);
        continue;
      }
      // M6b: held again by the sources that held it; a file M2 wrote held only the hub's
      const was: unknown = sourcesOf === null ? { hub: mark.revision, channel: null } : sourcesOf[key];
      const sources = new Set<Source>(isShown(was) ? (['hub', 'channel'] as const).filter((source) => was[source] === mark.revision) : []);
      await judge(current, record, sources, hash);
    }
  }

  // ---- the session ----

  async function sessionChanged(): Promise<void> {
    const current = deps.session.current();
    if (current === null) {
      askedAt = null; // signed out: no rows; what is held stays, and the next sign-in reads every channel again
      return;
    }
    if (dataOrg !== current.identity.org) {
      if (dataOrg !== null) {
        log('the signed-in org changed: the listings held for the last one are dropped');
        marks.clear();
        held.clear();
        waiting.clear();
        snapshotApplied = false;
      }
      dataOrg = current.identity.org;
      judgedAgainst = null;
      askedAt = null;
    }
    const head = current.view.head();
    const certificates = current.view.certificates();
    if (judgedAgainst === null || judgedAgainst.head !== head || judgedAgainst.certificates !== certificates) {
      judgedAgainst = { head, certificates };
      dropEnded(head.state);
      await reverifyHeld(current);
    }
    await retryWaiting(current);
    if (cache !== null) {
      const file = cache;
      cache = null;
      await applyCache(current, file);
    }
    // M6b: every channel read again at the sign-in and at each new head
    if (askedAt !== head) {
      askedAt = head;
      for (const watch of watched.values()) ask(watch);
    }
  }

  // ---- the feed ----

  function opened(): void {
    gathering = true;
    snapshotKeys = new Set();
    liveKeys = new Set();
    snapshotApplied = false;
    announced = null;
  }

  async function page(records: readonly unknown[], last: boolean): Promise<void> {
    const current = signedIn();
    if (current === null) return;
    if (!gathering) {
      gathering = true;
      snapshotKeys = new Set();
    }
    for (const record of records) {
      if (!usable(current, record)) continue;
      snapshotKeys.add(listingKey(record.body));
      await judge(current, record, HUB);
    }
    if (!last) return;
    // the replace rule: a key neither the snapshot nor a live frame since the open brought leaves the hub's set (its mark
    // stays), and its row unless its machine's channel holds it (M6b)
    const kept = (key: string) => snapshotKeys.has(key) || liveKeys.has(key);
    for (const key of [...held.keys()]) if (!kept(key)) release(key, 'hub');
    unwait('hub', (entry) => kept(entry.key));
    gathering = false;
    snapshotApplied = true;
  }

  async function listing(record: unknown): Promise<void> {
    const current = signedIn();
    if (current === null || !usable(current, record)) return;
    liveKeys.add(listingKey(record.body));
    await judge(current, record, HUB);
  }

  // ---- the channels (M6b) ----

  /** One machine's channel answer, if it is still the one asked of: its records judged, and its keys it lacked released. */
  async function channelAnswer(watch: Watch, org: string, result: Awaited<ReturnType<ListingsLink['call']>>): Promise<void> {
    const current = signedIn();
    if (current === null || current.identity.org !== org || watched.get(watch.ref) !== watch) return;
    // a failed call (a dropped link, a refusal) says nothing of what the machine lists, so it releases nothing
    if (!result.ok) return void log(`${shown(watch.ref)}'s channel listings did not read: ${result.error.code}`);
    const listings = isObject(result.output) ? result.output.listings : undefined;
    if (!Array.isArray(listings)) return void log(`${shown(watch.ref)}'s channel listings are not a list, ignored`);
    const keys = new Set<string>();
    for (const record of listings) {
      // a machine answers for its own sessions alone
      if (!usable(current, record) || record.body.machine !== watch.ref) continue;
      keys.add(listingKey(record.body));
      await judge(current, record, CHANNEL);
    }
    const ofMachine = (key: string) => key.startsWith(`${watch.ref}/`);
    for (const key of [...held.keys()]) if (ofMachine(key) && !keys.has(key)) release(key, 'channel');
    unwait('channel', (entry) => !ofMachine(entry.key) || keys.has(entry.key));
  }

  /** Reads the machine's channel listings, one call at a time; then again in ROWS_CHANNEL_MS while its link is up. */
  function ask(watch: Watch): void {
    if (closed || !watch.up || dataOrg === null || deps.session.current()?.identity.org !== dataOrg) return;
    if (watch.asking) {
      watch.again = true;
      return;
    }
    watch.asking = true;
    watch.again = false;
    if (watch.timer !== null) clearTimeout(watch.timer);
    watch.timer = null;
    const org = dataOrg;
    void watch.link
      .call('endpoint.listings', null)
      .catch((error: unknown) => ({ ok: false as const, error: { code: (error as Error).message } }))
      .then((result) => {
        void enqueue('a channel answer', () => channelAnswer(watch, org, result));
        watch.asking = false;
        if (watch.again) return ask(watch);
        if (closed || !watch.up || watched.get(watch.ref) !== watch) return;
        watch.timer = setTimeout(() => {
          watch.timer = null;
          ask(watch);
        }, timing.ROWS_CHANNEL_MS);
        (watch.timer as { unref?: () => void }).unref?.();
      });
  }

  function unwatch(watch: Watch): void {
    watch.off();
    if (watch.timer !== null) clearTimeout(watch.timer);
    watch.timer = null;
    watch.up = false;
  }

  /** Watches each roster machine's link: asked at its link up, its watch ended when it leaves (its memberships stay). */
  function watchRoster(): void {
    if (closed) return;
    const roster = new Set(deps.roster());
    for (const [ref, watch] of watched) {
      if (roster.has(ref) && deps.link(ref) === watch.link) continue;
      unwatch(watch);
      watched.delete(ref);
    }
    for (const ref of roster) {
      if (watched.has(ref)) continue;
      const link = deps.link(ref);
      if (link === null) continue;
      const watch: Watch = { ref, link, up: false, asking: false, again: false, timer: null, off: () => {} };
      watched.set(ref, watch);
      const onState = (state: LinkState) => {
        const was = watch.up;
        watch.up = state === 'up';
        if (watch.up && !was) ask(watch);
        if (!watch.up && watch.timer !== null) {
          clearTimeout(watch.timer);
          watch.timer = null;
        }
      };
      watch.off = link.onState(onState);
      onState(link.state());
    }
  }

  // ---- the rows ----

  function joinIds(org: string): Map<string, OrgKey> {
    if (joinMemo !== null && joinMemo.projects === projects && joinMemo.org === org) return joinMemo.join;
    const join = new Map<string, OrgKey>();
    for (const project of projects) {
      const own = project.org;
      if (own === undefined) continue;
      let id: string | null = null;
      if (own.source === 'smns') id = own.smnsId;
      else if (own.key.startsWith('remote:')) id = repoProjectId(org, own.key.slice('remote:'.length));
      if (id !== null && !join.has(id)) join.set(id, own.key);
    }
    joinMemo = { projects, org, join };
    return join;
  }

  function rows(): OrgRows {
    const machines = [...deps.roster()];
    const current = signedIn();
    if (current === null) return { machines, rows: [], complete: false, pending: [], members: [], member: null };
    const roster = new Set<string>(machines);
    const join = joinIds(current.identity.org);
    const member = current.identity.member;
    const out: RemoteRow[] = [];
    for (const h of held.values()) {
      const body = h.record.body;
      if (!roster.has(body.machine)) continue;
      out.push({
        machine: body.machine as MachineRef,
        session: body.session,
        lane: body.fields.lane,
        state: body.fields.state,
        title: body.fields.title,
        owners: [...body.fields.owners],
        project: body.fields.project,
        orgKey: body.fields.project === null ? null : (join.get(body.fields.project) ?? null),
        availability: body.fields.lane === 'A' ? 'foreign_held' : null,
        revision: body.revision,
        issued: body.issued,
        mine: body.fields.owners.includes(member),
        // M6b: a private session's channel listing states who it reaches, and the policy revision it was made at
        ...(body.fields.audience === undefined ? {} : { audience: [...body.fields.audience] }),
        ...(body.fields.policyRev === undefined ? {} : { policyRev: body.fields.policyRev }),
      });
    }
    out.sort((a, b) => (a.machine === b.machine ? (a.session < b.session ? -1 : a.session > b.session ? 1 : 0) : a.machine < b.machine ? -1 : 1));
    const waitingMachines = new Set([...waiting.values()].map((entry) => entry.record.body.machine));
    const complete = snapshotApplied && (announced === null || current.view.head().state.version >= announced);
    return { machines, rows: out, complete, pending: machines.filter((m) => waitingMachines.has(m)), members: ownersOf(current.view.head().state, out), member };
  }

  /** M5: every member some row's owners name, in the order the rows first name them, as the held head lists them. */
  function ownersOf(state: OrgState, out: readonly RemoteRow[]): OrgMember[] {
    const names = memberNames(state.members);
    const emails = new Map(state.members.map((m) => [m.id, m.email]));
    const ids = new Set(out.flatMap((row) => row.owners));
    return [...ids].map((id) => ({ id, email: emails.get(id) ?? null, name: names.get(id) ?? FORMER_MEMBER }));
  }

  function schedule(): void {
    if (closed || emitTimer !== null) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      if (closed) return;
      const next = rows();
      const text = JSON.stringify(next);
      if (text === lastEmitted) return;
      lastEmitted = text;
      deps.emit(next);
    }, timing.ROWS_COALESCE_MS);
    (emitTimer as { unref?: () => void }).unref?.();
  }

  // ---- the cache ----

  function changed(): void {
    dirty = true;
    if (closed || writeTimer !== null) return;
    writeTimer = setTimeout(() => {
      writeTimer = null;
      void write();
    }, timing.ROWS_CACHE_WRITE_MS);
    (writeTimer as { unref?: () => void }).unref?.();
  }

  function write(): Promise<void> {
    writing = writing.then(async () => {
      if (!dirty || dataOrg === null) return;
      dirty = false;
      const file: ListingsFile = {
        version: 1,
        org: dataOrg,
        records: [...held.values()].map((h) => h.record),
        marks: Object.fromEntries(marks),
        shown: Object.fromEntries([...held].map(([key, h]) => [key, { hub: h.hub, channel: h.channel }])),
      };
      try {
        const check = await deps.files.check();
        if (check === null || !check.ok) {
          log(`${LISTINGS_FILE} not written: ${check === null ? `${deps.files.dir} does not exist` : check.detail}`);
          return;
        }
        await deps.files.write(LISTINGS_FILE, file);
      } catch (error) {
        log(`${LISTINGS_FILE} not written: ${(error as Error).message}`);
      }
    });
    return writing;
  }

  // ---- wiring ----

  async function readProjects(): Promise<void> {
    const mine = ++projectsRead;
    try {
      const list = await deps.localProjects();
      if (mine === projectsRead) projects = list;
    } catch (error) {
      log(`the local projects did not read: ${(error as Error).message}`);
    }
    schedule();
  }

  const unsubscribe = [
    deps.session.onChanged(() => void enqueue('a session change', sessionChanged)),
    deps.feed.onOpen(() => void enqueue('the feed opening', opened)),
    deps.feed.onClose(() => void enqueue('the feed closing', () => void (gathering = false))),
    deps.feed.onState((version) =>
      void enqueue('a state notice', () => {
        if (gathering) announced = Math.max(announced ?? 0, version);
      }),
    ),
    deps.feed.onListings(({ records, last }) => void enqueue('a listings page', () => page(Array.isArray(records) ? records : [], last))),
    deps.feed.onListing((record) => void enqueue('a listing', () => listing(record))),
    deps.onRoster(() => {
      watchRoster();
      schedule();
    }),
    deps.onLocalProjects(() => void readProjects()),
  ];
  watchRoster();

  const loaded = Promise.all([enqueue('the cache', sessionChanged), readProjects()]).then(() => {});

  return {
    rows,
    loaded,
    settled: () => queue,
    refreshChannel(ref) {
      const watch = watched.get(ref);
      if (watch !== undefined) ask(watch);
    },
    async close() {
      if (closed) return;
      for (const off of unsubscribe) off();
      for (const watch of watched.values()) unwatch(watch);
      watched.clear();
      await queue;
      closed = true;
      if (emitTimer !== null) clearTimeout(emitTimer);
      if (writeTimer !== null) clearTimeout(writeTimer);
      emitTimer = writeTimer = null;
      await write();
    },
  };
}
