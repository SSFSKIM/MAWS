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
import { memberNames } from '@shared/org/member-name';
import { repoProjectId } from '@shared/machine/project-ids';
import type { OrgFiles } from './files';
import type { RegistryFeed } from './registry-feed';
import type { OrgSession, SignedIn } from './session';
import { orgTiming, type OrgTiming } from './timing';

export const LISTINGS_FILE = 'listings.json';

/** A key's high-water mark (Interfaces §C). */
export type ListingMark = { revision: number; hash: string; kid: string; delegation: string | null; gone: boolean };
export type ListingsFile = { version: 1; org: string; records: Signed<Listing>[]; marks: Record<string, ListingMark> };

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

type Waiting = { key: string; hash: string; record: Signed<Listing> };

export function createRemoteRows(deps: RemoteRowsDeps): RemoteRows {
  const timing = orgTiming(deps.timing);
  const now = () => new Date(deps.now?.() ?? Date.now());
  const log = (line: string) => deps.log(`[org-rows] ${line}`);

  /** The org the marks, rows and waiting records belong to: the signed-in org's, once one signed in. */
  let dataOrg: string | null = null;
  const marks = new Map<string, ListingMark>();
  /** The accepted live records, each verified against the head and certificates last judged against. */
  const held = new Map<string, Signed<Listing>>();
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

  function wait(entry: Waiting, state: OrgState): void {
    // a record whose key the head retired or revoked can never verify
    if (markDead(state, entry.record.sig.kid, null)) return;
    const id = `${entry.key}\n${entry.hash}`;
    waiting.delete(id);
    waiting.set(id, entry);
    while (waiting.size > timing.UNVERIFIED_MAX) waiting.delete(waiting.keys().next().value as string);
  }

  function accept(entry: Waiting, delegation: string | null): void {
    const { key, hash, record } = entry;
    const gone = isListingGone(record.body);
    if (gone) held.delete(key);
    else held.set(key, record);
    marks.set(key, { revision: record.body.revision, hash, kid: record.sig.kid, delegation, gone });
    for (const [id, other] of waiting) if (other.key === key && other.record.body.revision <= record.body.revision) waiting.delete(id);
    changed();
  }

  /** One record against its key's mark, then the head. */
  async function judge(current: SignedIn, record: Signed<Listing>, hash = listingHash(record)): Promise<void> {
    const key = listingKey(record.body);
    const mark = marks.get(key);
    if (mark !== undefined) {
      if (record.body.revision < mark.revision) return;
      if (record.body.revision === mark.revision) {
        if (hash !== mark.hash) {
          log(`a conflicting record for ${shown(key)} at revision ${mark.revision} ignored`);
          return;
        }
        if (mark.gone || held.has(key)) return;
      }
    }
    const state = current.view.head().state;
    const certificates = current.view.certificates();
    const at = now();
    if (!(await verified(current, record, at))) {
      wait({ key, hash, record }, state);
      return;
    }
    accept({ key, hash, record }, await delegationOf(state, certificates, record, at));
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
      await judge(current, entry.record, entry.hash);
      if (waiting.get(id) === entry) waiting.delete(id);
    }
  }

  async function reverifyHeld(current: SignedIn): Promise<void> {
    const state = current.view.head().state;
    for (const [key, record] of [...held]) {
      if (held.get(key) !== record || (await verified(current, record, now()))) continue;
      held.delete(key);
      wait({ key, hash: listingHash(record), record }, state);
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
    for (const record of file.records) {
      if (!usable(current, record)) continue;
      const key = listingKey(record.body);
      const hash = listingHash(record);
      const mark = marks.get(key);
      if (mark === undefined || mark.gone || mark.revision !== record.body.revision || mark.hash !== hash) {
        log(`a cached record for ${shown(key)} is not its mark's, skipped`);
        continue;
      }
      await judge(current, record, hash);
    }
  }

  // ---- the session ----

  async function sessionChanged(): Promise<void> {
    const current = deps.session.current();
    if (current === null) return; // signed out: no rows; what is held stays
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
      await judge(current, record);
    }
    if (!last) return;
    // the replace rule: a key neither the snapshot nor a live frame since the open brought leaves the rows (its mark stays)
    const kept = (key: string) => snapshotKeys.has(key) || liveKeys.has(key);
    for (const key of [...held.keys()]) {
      if (kept(key)) continue;
      held.delete(key);
      changed();
    }
    for (const [id, entry] of waiting) if (!kept(entry.key)) waiting.delete(id);
    gathering = false;
    snapshotApplied = true;
  }

  async function listing(record: unknown): Promise<void> {
    const current = signedIn();
    if (current === null || !usable(current, record)) return;
    liveKeys.add(listingKey(record.body));
    await judge(current, record);
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
    for (const record of held.values()) {
      const body = record.body;
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
      const file: ListingsFile = { version: 1, org: dataOrg, records: [...held.values()], marks: Object.fromEntries(marks) };
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
    deps.onRoster(schedule),
    deps.onLocalProjects(() => void readProjects()),
  ];

  const loaded = Promise.all([enqueue('the cache', sessionChanged), readProjects()]).then(() => {});

  return {
    rows,
    loaded,
    settled: () => queue,
    async close() {
      if (closed) return;
      for (const off of unsubscribe) off();
      await queue;
      closed = true;
      if (emitTimer !== null) clearTimeout(emitTimer);
      if (writeTimer !== null) clearTimeout(writeTimer);
      emitTimer = writeTimer = null;
      await write();
    },
  };
}
