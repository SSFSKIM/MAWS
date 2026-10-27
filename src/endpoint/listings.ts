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
// The endpoint record (`{org, machine, addresses, issued}`) names the machine's direct carriers (M4's listener on the
// tailnet); an empty list is a relay-only machine. It is signed at each welcome and whenever the addresses change.
import { createHash } from 'node:crypto';
import {
  isMemberId,
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
import type { HubUpFrame } from './hub-link';
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
  /** A session's listing was just signed and sent: a notify held for its listing may follow it now. */
  signed?(session: string): void;
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
  #queue: Promise<unknown> = Promise.resolve();

  constructor(ctx: RecordsContext) {
    this.#ctx = ctx;
  }

  /** A session as it stands now: listed, or listed again, when it qualifies and a field changed. */
  report(report: SessionReport): Promise<void> {
    this.#reports.set(report.session, report);
    return this.#serial(() => this.#evaluate(report.session));
  }

  /** A session that left the machine: no longer listed or sent again. */
  gone(session: string): Promise<void> {
    this.#reports.delete(session);
    return this.#serial(async () => {
      const file = this.#ctx.store.read();
      if (!(session in file)) return;
      const rest = { ...file };
      delete rest[session];
      this.#ctx.store.write(rest);
    });
  }

  /** Every reported session judged again (a new head, a project opened). */
  refresh(): Promise<void> {
    return this.#serial(async () => {
      for (const session of this.#reports.keys()) await this.#evaluate(session);
    });
  }

  /** A connection was welcomed: every listing held goes again, signed anew where the key or the org it was made under changed. */
  welcome(): Promise<void> {
    return this.#serial(async () => {
      for (const [session, entry] of Object.entries(this.#ctx.store.read())) {
        const report = this.#reports.get(session);
        if (report !== undefined && !this.#qualifies(report)) continue;
        if (this.#current(entry.record)) this.#ctx.send({ t: 'listing', record: entry.record });
        // Made under another key or org: signed again from its report; one not reported yet waits for sminos's.
        else if (report !== undefined) await this.#evaluate(session);
      }
    });
  }

  /** The project of a session listed now, or null: what `notify` may name (a session the hub holds no listing of pushes to no one). */
  listed(session: string): { project: string } | null {
    const report = this.#reports.get(session);
    if (report === undefined || !this.#qualifies(report) || !(session in this.#ctx.store.read())) return null;
    return { project: report.project };
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
    const head = this.#ctx.head();
    if (report === undefined || head === null || !this.#qualifies(report)) return;
    const owners = await resolveOwners(report.owners, head.state, this.#ctx.ref(), head.certificates, new Date(this.#ctx.now()));
    const fields: Listing['fields'] = { owners, project: report.project, lane: report.lane, state: report.state, title: report.title };
    const held = this.#ctx.store.read()[session];
    if (held !== undefined && held.hash === hashOf(fields) && this.#current(held.record)) return;
    await this.#sign(session, fields);
  }

  async #sign(session: string, fields: Listing['fields']): Promise<void> {
    const key = this.#ctx.key();
    const head = this.#ctx.head();
    if (key === null || head === null) return;
    const file = this.#ctx.store.read();
    const now = this.#ctx.now();
    const revision = Math.max((file[session]?.revision ?? 0) + 1, now);
    const issued = new Date(now).toISOString();
    const body: Listing = { org: head.state.org, machine: this.#ctx.ref(), session, revision, issued, fields };
    const record = await signRecord(SIGNING_DOMAINS.listing, body, key.key.privateKey, key.key.pub);
    this.#ctx.store.write({ ...this.#ctx.store.read(), [session]: { revision, issued, hash: hashOf(fields), record } });
    // Sent now if a connection is up; else the next welcome sends what the file holds.
    this.#ctx.send({ t: 'listing', record });
    this.#ctx.signed?.(session);
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

const hashOf = (fields: Listing['fields']): string => createHash('sha256').update(JSON.stringify(fields)).digest('base64url');
