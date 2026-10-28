// The machine's signed records at the hub (O10 M3; RL6, RL §5.8, §4.1): a listing for each session it relays, and its
// endpoint record. They are the only things the hub learns of the machine's sessions and carriers, and the hub keeps
// and serves them to the org's apps; each is signed with the machine key, which the hub and every app verify against
// the org state.
//
// A session is listed when sminos reports it (M6) in a project the endpoint relays (one opened on RL1's log plane) and
// its access isn't `private`: a private session goes over channels only (M8), and nothing of it reaches the hub. Its
// listing is `{org, machine, session, revision, issued, fields: {owners, project, lane, state, title}}`, `owners`
// resolved from `@machine` against the head the endpoint holds (the machine's member owners, or the admins of an
// org-owned machine; RL §5.8: the token never leaves the machine). A listing is signed again only when a field changes,
// the owners' resolution included, so a new head that changes the machine's owners or the admins re-issues the
// `@machine` listings. Its revision is the later of one past the last and the clock's milliseconds, so it rises across a
// lost state directory too, which the hub's revision rule (`stale-listing`) would otherwise refuse until the old
// revision is passed. `listings.json` keeps each listing whole, and every welcome sends them again byte for byte: the
// hub takes a resend of what it holds, and a listing sent while no connection was up reaches it then.
//
// A listed session that leaves, or becomes `private`, is withdrawn (RL6; the remote layer's Decision Log 27): one last
// revision whose `state` is `LISTING_GONE`, with `owners`, `project` and `title` empty, kept and resent like any other,
// so the hub's revision rule still refuses a replay of an earlier one and every app that cached the session drops it.
// Reported again, it is listed at a higher revision. A session never listed, or withdrawn already, signs nothing; one
// whose listing no connection carried yet in this run is dropped from the file instead, so nothing of it, not even its
// id, reaches the hub.
//
// While a session's listing is being judged again (a report, a new head), it names no project for a notify: the hub
// pushes to the owners its listing names, so a notify must follow the listing that names the owners now. Once judged,
// `listedNow` lets what was held for it go.
//
// A record the hub refused for now (`503`: the Registry busy or unreachable, with RL1 still open) is tried again with
// the link's backoff while the connection lasts (`RecordRetries`), a listing byte for byte while it is still its
// session's latest; the next welcome sends everything again anyway.
//
// The endpoint record (`{org, machine, addresses, issued}`) names the machine's direct carriers (M4's listener on the
// tailnet); an empty list is a relay-only machine. It is signed at each welcome and whenever the addresses change.
import { createHash } from 'node:crypto';
import {
  isListingGone,
  isMemberId,
  LISTING_GONE,
  machineOwners,
  ownerMembers,
  signRecord,
  SIGNING_DOMAINS,
  type Certificates,
  type EndpointRecord,
  type Listing,
  type OrgState,
  type Signed,
  type SigningKey,
} from 'org-protocol';
import { reconnectDelay, type HubUpFrame } from './hub-link';
import type { ListingsFile } from './state/store';

/** The owner token for the machine's own owners (RL §5.8), resolved here and never sent. */
export const MACHINE_OWNERS = '@machine';

/** A session as sminos reports it (M6 maps its `member` frames to this). */
export type SessionReport = {
  session: string;
  project: string;
  lane: 'A' | 'B';
  state: string;
  title: string;
  /** Member ids and `@machine`. */
  owners: readonly string[];
  /** Absent means `listed` (O12); `private` is never listed. */
  access?: string;
};

/** What the records are made from and sent through. */
export type RecordsContext = {
  /** The machine's ref (the services', given at start). */
  ref(): string;
  /** The machine key in force and its id; null while none is held. */
  key(): { key: SigningKey; keyId: string } | null;
  /** The head and the certificates beside it; null before the first sync. */
  head(): { state: OrgState; certificates: Certificates } | null;
  now(): number;
  send(frame: HubUpFrame): boolean;
  /** Whether the endpoint relays `project` (it is open on RL1's log plane). */
  relays(project: string): boolean;
  store: { read(): ListingsFile; write(file: ListingsFile): void };
  log(line: string): void;
  /** A session's listing is current (just signed and sent, or judged unchanged): a notify held for it may follow it now. */
  listedNow?(session: string): void;
  /** A listed session of `project` is about to be withdrawn: what the hub was told of it (its pending count) is settled
   * first, while the hub still holds its owners. */
  withdrawing?(session: string, project: string): void;
};

/** The member ids `owners` names: `@machine` as the machine's owners in `state` (none for a machine it doesn't list). */
export async function resolveOwners(owners: readonly string[], state: OrgState, ref: string, certificates: Certificates, now: Date): Promise<string[]> {
  const machine = await machineOwners(state, ref, certificates, now);
  const ofMachine = machine === null ? [] : ownerMembers(state, machine);
  const out: string[] = [];
  for (const owner of owners) {
    for (const id of owner === MACHINE_OWNERS ? ofMachine : [owner]) if (isMemberId(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

export class Listings {
  readonly #ctx: RecordsContext;
  readonly #reports = new Map<string, SessionReport>();
  /** Sessions that left whose withdrawal is still to be signed (no key or head when they left). */
  readonly #leaving = new Set<string>();
  /** Sessions whose listing no connection carried in this run, nor any earlier one (the file held none at its signing). */
  readonly #unheard = new Set<string>();
  /** How many judgments of each session are queued or running: while any is, `listed()` names nothing. */
  readonly #judging = new Map<string, number>();
  #queue: Promise<unknown> = Promise.resolve();

  constructor(ctx: RecordsContext) {
    this.#ctx = ctx;
  }

  /** A session as it stands now: listed, or listed again, when it qualifies and a field changed. */
  report(report: SessionReport): Promise<void> {
    this.#reports.set(report.session, report);
    this.#leaving.delete(report.session);
    return this.#judge([report.session]);
  }

  /** A session that left the machine: withdrawn, if it is listed. */
  gone(session: string): Promise<void> {
    this.#reports.delete(session);
    this.#leaving.add(session);
    return this.#serial(() => this.#withdraw(session));
  }

  /** Every reported session judged again (a new head, a project opened), and every withdrawal still owed signed. */
  refresh(): Promise<void> {
    const judged = this.#judge([...this.#reports.keys()]);
    return this.#serial(async () => {
      for (const session of this.#leaving) await this.#withdraw(session);
    }).then(() => judged);
  }

  /** A connection was welcomed: every listing held goes again, signed anew where the key or the org it was made under
   * changed, a withdrawal included; a withdrawal still owed is signed. */
  welcome(): Promise<void> {
    return this.#serial(async () => {
      for (const [session, entry] of Object.entries(this.#ctx.store.read())) {
        const report = this.#reports.get(session);
        if (isListingGone(entry.record.body)) {
          if (this.#current(entry.record)) this.#send(session, entry.record);
          else if (report === undefined || !this.#qualifies(report)) await this.#sign(session, entry.record.body.fields);
          else await this.#evaluate(session);
        } else if (this.#leaving.has(session) || report?.access === 'private') await this.#withdraw(session);
        else if (report !== undefined && !this.#qualifies(report)) continue;
        else if (this.#current(entry.record)) this.#send(session, entry.record);
        // Made under another key or org: signed again from its report; one not reported yet waits for sminos's.
        else if (report !== undefined) await this.#evaluate(session);
      }
    });
  }

  /** The project of a session listed now, its listing current and carried to the hub, or null: what `notify` may name
   * (a session the hub holds no listing of pushes to no one, and one being listed again would push to the owners of its
   * last listing). */
  listed(session: string): { project: string } | null {
    const report = this.#reports.get(session);
    const held = this.#ctx.store.read()[session];
    if (report === undefined || !this.#qualifies(report) || held === undefined || isListingGone(held.record.body) || this.#judging.has(session) || this.#unheard.has(session)) return null;
    return { project: report.project };
  }

  /** Sends the session's listing at `revision` again, byte for byte, if it is still the latest held and made under the
   * key in force (the hub refused it for now); whether it was sent. */
  resend(session: string, revision: number): Promise<boolean> {
    let sent = false;
    return this.#serial(async () => {
      const entry = this.#ctx.store.read()[session];
      if (entry?.revision === revision && this.#current(entry.record)) sent = this.#send(session, entry.record);
    }).then(() => sent);
  }

  /**
   * The signed listing of a session as it stands now, for a member's `endpoint.listings` (M8): the one held and sent to
   * the hub when it is current, else one signed for the asker alone (a private session's, one in a project the endpoint
   * doesn't relay, one not listed yet), kept nowhere and sent nowhere, at a revision past any held. Null with no key or
   * head.
   */
  async recordFor(report: SessionReport): Promise<Signed<Listing> | null> {
    const key = this.#ctx.key();
    const head = this.#ctx.head();
    if (key === null || head === null) return null;
    const owners = await resolveOwners(report.owners, head.state, this.#ctx.ref(), head.certificates, new Date(this.#ctx.now()));
    const fields: Listing['fields'] = { owners, project: report.project, lane: report.lane, state: report.state, title: report.title };
    const held = this.#ctx.store.read()[report.session];
    if (held !== undefined && !isListingGone(held.record.body) && held.hash === hashOf(fields) && this.#current(held.record)) return held.record;
    const now = this.#ctx.now();
    const body: Listing = { org: head.state.org, machine: this.#ctx.ref(), session: report.session, revision: Math.max((held?.revision ?? 0) + 1, now), issued: new Date(now).toISOString(), fields };
    return signRecord(SIGNING_DOMAINS.listing, body, key.key.privateKey, key.key.pub);
  }

  /** Judges each of `sessions` again, `listed()` naming none of them until its judgment is done. */
  #judge(sessions: string[]): Promise<void> {
    for (const session of sessions) this.#judging.set(session, (this.#judging.get(session) ?? 0) + 1);
    return this.#serial(async () => {
      for (const session of sessions) {
        try {
          await this.#evaluate(session);
        } catch (error) {
          this.#ctx.log(`endpoint: a listing could not be made: ${(error as Error).message}`);
        } finally {
          const left = (this.#judging.get(session) ?? 1) - 1;
          if (left > 0) this.#judging.set(session, left);
          else this.#judging.delete(session);
          if (left <= 0 && this.listed(session) !== null) this.#ctx.listedNow?.(session);
        }
      }
    });
  }

  /** Sends a listing; a session's that reaches a connection is no longer unheard. */
  #send(session: string, record: Signed<Listing>): boolean {
    const sent = this.#ctx.send({ t: 'listing', record });
    if (sent) this.#unheard.delete(session);
    return sent;
  }

  #qualifies(report: SessionReport): boolean {
    return report.access !== 'private' && this.#ctx.relays(report.project);
  }

  /** Signed by the key in force for this machine, in the head's org. */
  #current(record: Signed<Listing>): boolean {
    const key = this.#ctx.key();
    const head = this.#ctx.head();
    return key !== null && head !== null && record.sig.kid === key.keyId && record.body.org === head.state.org && record.body.machine === this.#ctx.ref();
  }

  async #evaluate(session: string): Promise<void> {
    const report = this.#reports.get(session);
    if (report?.access === 'private') return this.#withdraw(session);
    const head = this.#ctx.head();
    if (report === undefined || head === null || !this.#qualifies(report)) return;
    const owners = await resolveOwners(report.owners, head.state, this.#ctx.ref(), head.certificates, new Date(this.#ctx.now()));
    const fields: Listing['fields'] = { owners, project: report.project, lane: report.lane, state: report.state, title: report.title };
    const held = this.#ctx.store.read()[session];
    if (held !== undefined && held.hash === hashOf(fields) && this.#current(held.record)) return;
    await this.#sign(session, fields);
  }

  /** The last revision of a session listed now: `LISTING_GONE`, every field but its lane empty. */
  async #withdraw(session: string): Promise<void> {
    const held = this.#ctx.store.read()[session];
    if (held === undefined || isListingGone(held.record.body)) {
      this.#leaving.delete(session);
      return;
    }
    if (this.#unheard.has(session)) {
      // No connection carried it: the hub has nothing of the session, and gets nothing.
      const rest = { ...this.#ctx.store.read() };
      delete rest[session];
      this.#ctx.store.write(rest);
      this.#unheard.delete(session);
      this.#leaving.delete(session);
      return;
    }
    if (this.#ctx.key() === null || this.#ctx.head() === null) return; // owed: signed at the next refresh or welcome
    const { project, lane } = held.record.body.fields;
    if (project !== null) this.#ctx.withdrawing?.(session, project);
    if (await this.#sign(session, { owners: [], project: null, lane, state: LISTING_GONE, title: '' })) this.#leaving.delete(session);
  }

  /** Signs and sends a revision of the session's listing, and keeps it; false when no key or head is held. */
  async #sign(session: string, fields: Listing['fields']): Promise<boolean> {
    const key = this.#ctx.key();
    const head = this.#ctx.head();
    if (key === null || head === null) return false;
    const file = this.#ctx.store.read();
    const unheard = file[session] === undefined || this.#unheard.has(session);
    const now = this.#ctx.now();
    const revision = Math.max((file[session]?.revision ?? 0) + 1, now);
    const issued = new Date(now).toISOString();
    const body: Listing = { org: head.state.org, machine: this.#ctx.ref(), session, revision, issued, fields };
    const record = await signRecord(SIGNING_DOMAINS.listing, body, key.key.privateKey, key.key.pub);
    this.#ctx.store.write({ ...this.#ctx.store.read(), [session]: { revision, issued, hash: hashOf(fields), record } });
    // Sent now if a connection is up; else the next welcome sends what the file holds.
    if (!this.#send(session, record) && unheard) this.#unheard.add(session);
    return true;
  }

  #serial(run: () => Promise<void>): Promise<void> {
    const next = this.#queue.then(run).catch((error: unknown) => this.#ctx.log(`endpoint: a listing could not be made: ${(error as Error).message}`));
    this.#queue = next;
    return next;
  }
}

/** The machine's endpoint record: signed at each welcome and on each change of its addresses (M4's listener). */
export class EndpointRecords {
  readonly #ctx: Pick<RecordsContext, 'ref' | 'key' | 'head' | 'now' | 'send' | 'log'>;
  #addresses: string[] = [];
  #issued = 0;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(ctx: Pick<RecordsContext, 'ref' | 'key' | 'head' | 'now' | 'send' | 'log'>) {
    this.#ctx = ctx;
  }

  get addresses(): readonly string[] {
    return this.#addresses;
  }

  /** Signs the record now, issued later than any before it, and sends it. */
  issue(): Promise<void> {
    return this.#serial(async () => {
      const key = this.#ctx.key();
      const head = this.#ctx.head();
      if (key === null || head === null) return;
      this.#issued = Math.max(this.#ctx.now(), this.#issued + 1);
      const body: EndpointRecord = { org: head.state.org, machine: this.#ctx.ref(), addresses: [...this.#addresses], issued: new Date(this.#issued).toISOString() };
      this.#ctx.send({ t: 'endpoint', record: await signRecord(SIGNING_DOMAINS.endpoint, body, key.key.privateKey, key.key.pub) });
    });
  }

  /** The direct listener's addresses (M4); a change is signed and sent at once. */
  setAddresses(addresses: readonly string[]): Promise<void> {
    const next = [...new Set(addresses)].sort();
    if (next.length === this.#addresses.length && next.every((a, i) => a === this.#addresses[i])) return Promise.resolve();
    this.#addresses = next;
    return this.issue();
  }

  #serial(run: () => Promise<void>): Promise<void> {
    const next = this.#queue.then(run).catch((error: unknown) => this.#ctx.log(`endpoint: the endpoint record could not be made: ${(error as Error).message}`));
    this.#queue = next;
    return next;
  }
}

/**
 * The records the hub refused for now, each tried again after the link's backoff (`reconnectDelay`, 1 s doubling to
 * 30 s, jittered), one timer per record, its wait growing with each refusal; `clear()` when the connection ends, since
 * the next welcome sends every record again.
 */
export class RecordRetries {
  readonly #random: () => number;
  readonly #setTimer: (run: () => void, ms: number) => () => void;
  readonly #timers = new Map<string, () => void>();
  readonly #attempts = new Map<string, number>();

  constructor(options: { random?(): number; setTimer?(run: () => void, ms: number): () => void } = {}) {
    this.#random = options.random ?? Math.random;
    this.#setTimer =
      options.setTimer ??
      ((run, ms) => {
        const timer = setTimeout(run, ms);
        timer.unref?.();
        return () => clearTimeout(timer);
      });
  }

  /** `run` again after the backoff, unless a retry of `key` is waiting already. */
  retry(key: string, run: () => void): void {
    if (this.#timers.has(key)) return;
    const attempt = this.#attempts.get(key) ?? 0;
    this.#attempts.set(key, attempt + 1);
    this.#timers.set(
      key,
      this.#setTimer(() => {
        this.#timers.delete(key);
        run();
      }, reconnectDelay(attempt, this.#random)),
    );
  }

  clear(): void {
    for (const cancel of this.#timers.values()) cancel();
    this.#timers.clear();
    this.#attempts.clear();
  }
}

const hashOf = (fields: Listing['fields']): string => createHash('sha256').update(JSON.stringify(fields)).digest('base64url');
