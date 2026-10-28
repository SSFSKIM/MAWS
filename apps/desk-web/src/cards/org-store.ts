// The signed org state this phone holds (P5 O13 §B, M3; RL §5.2), as the endpoint holds its own (O10 M2,
// `src/endpoint/org-sync.ts`): the head, the chain window after it was first verified, the root transitions it adopted
// and the delegated machines' certificates as the hub serves them beside the state. The hub only carries it: the first
// sync is verified as one run anchored to the pairing code's pins (`verifyPinnedChain`), and every later state, whoever
// carried it (`GET /api/org/state?since=<held>`, or a machine's channel handshake through `advance`), is verified onto
// the head (`advanceHead`, with the transitions accepted so far as its replay barrier). A state that does not follow
// is refused and the head stays. Each adoption is written to IndexedDB's `org` store (keyed by org id) before anything
// is told of it, and adoptions run one at a time, each against the head the one before left.
//
// The certificates move without a state change (a delegated VM's certificate advances no version), so the store also
// re-reads the state on demand (`refresh`), at most once a minute for each reason (a listing whose machine it cannot
// resolve, a push landing, the cards view opening), counted from when the read finished; a second ask while one runs
// shares it.
//
// Not followed here: a recovery transition that rewinds the head (`verifyRewind`). The phone then keeps its head and
// refuses the rewound branch; it pairs again under the recovered org. `hashes` (each adopted version's state hash, kept
// past the window) is held so a later rewind can be judged against what the phone verified.
import {
  advanceHead,
  isCertificates,
  isSignedOrgState,
  NO_CERTIFICATES,
  stateHash,
  verifyPinnedChain,
  verifySuccessor,
  type B64,
  type Certificates,
  type OrgPins,
  type OrgView,
  type RootTransition,
  type Signed,
  type SignedOrgState,
} from 'org-protocol';
import type { OrgStateView } from 'desk-hub/protocol';
import { committed, DESK_DB, done, openDesk } from '../store/idb';

export type OrgRecord = { head: SignedOrgState; chain: SignedOrgState[]; transitions: Signed<RootTransition>[]; certificates: Certificates; hashes: B64[] };

export interface OrgPersistence {
  load(org: string): Promise<OrgRecord | null>;
  save(org: string, record: OrgRecord): Promise<void>;
  forget(org: string): Promise<void>;
}

/** The hub's view of the state from version `since` on (`GET /api/org/state?since=`), a page at a time. */
export type OrgSource = (since: number) => Promise<OrgStateView>;

/**
 * What a sync came to: how many states it adopted, and when it adopted none though the hub served a head it does not
 * hold, why (`rollback`, `fork`, or the package's verdict code, `bad-link` and `not-root-signed` for a first chain that is
 * not the pinned org's).
 */
export type SyncResult = { adopted: number; refused?: string };

export type OrgChange = { head: SignedOrgState; certificates: Certificates };

const DAY_MS = 86_400_000;
/** The chain window keeps the states issued this recently, and the head always (the endpoint's rule). */
export const CHAIN_WINDOW_MS = 30 * DAY_MS;
/** The most pages one sync reads (a page is about 1 MiB and holds at least one state). */
const MAX_PAGES = 1000;
/** A re-read for one reason runs at most this often. */
export const REFRESH_EVERY_MS = 60_000;

export class OrgStore implements OrgView {
  #record: OrgRecord | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #listeners = new Set<(change: OrgChange) => void>();
  /** When each reason's last re-read finished. */
  readonly #refreshed = new Map<string, number>();
  readonly #refreshing = new Map<string, Promise<SyncResult>>();

  constructor(
    readonly org: string,
    private readonly deps: { persistence: OrgPersistence; source: OrgSource; now?: () => number },
  ) {}

  #now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** Reads what the device kept. */
  async load(): Promise<void> {
    this.#record = await this.deps.persistence.load(this.org);
  }

  /** A head is held: a first sync was verified against the pins. */
  get ready(): boolean {
    return this.#record !== null;
  }

  held(): OrgRecord | null {
    return this.#record;
  }

  head(): SignedOrgState {
    if (this.#record === null) throw new Error('this device holds no org state yet');
    return this.#record.head;
  }

  certificates(): Certificates {
    return this.#record?.certificates ?? NO_CERTIFICATES;
  }

  since(version: number): { states: SignedOrgState[]; transitions: Signed<RootTransition>[] } {
    const record = this.#record;
    if (record === null) return { states: [], transitions: [] };
    return { states: record.chain.filter((s) => s.state.version > version), transitions: record.transitions.filter((t) => t.body.fromVersion >= version) };
  }

  /** A channel's catch-up page: verified onto the head as the hub's are (the `OrgView` a channel advances). */
  advance(states: SignedOrgState[], transitions: Signed<RootTransition>[]): Promise<void> {
    return this.#serial(async () => {
      if (this.#record !== null) await this.#onto(this.#record, states, transitions, null);
    });
  }

  /** Called after each change is kept: a new head, or new certificates under the same head. */
  onChange(listener: (change: OrgChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Reads the hub's state after the held head (from version 0 at the first sync) and adopts what verifies. */
  sync(pins: OrgPins): Promise<SyncResult> {
    return this.#serial(async () => {
      let cursor = this.#record?.head.state.version ?? 0;
      const chain: SignedOrgState[] = [];
      let view: OrgStateView;
      for (let page = 0; ; page++) {
        view = await this.deps.source(cursor);
        const got = list(view.chain).filter(isSignedOrgState);
        chain.push(...got);
        if (view.more !== true || got.length === 0 || page + 1 >= MAX_PAGES) break;
        cursor = got[got.length - 1].state.version;
      }
      const transitions = list(view.transitions) as Signed<RootTransition>[];
      const certificates = isCertificates(view.certificates) ? view.certificates : null;
      if (this.#record === null) return this.#first(chain, transitions, certificates, pins);
      return this.#onto(this.#record, chain, transitions, certificates, isSignedOrgState(view.head) ? view.head : null);
    });
  }

  /**
   * Re-reads the state for `reason` (a machine ref, `landing`, `cards`) unless a read for it finished within the last
   * minute: the certificates come with every read, whatever the version. A read for the reason still under way is
   * shared, so every ask settles once it has. Null when none ran.
   */
  refresh(reason: string, pins: OrgPins): Promise<SyncResult | null> {
    const running = this.#refreshing.get(reason);
    if (running !== undefined) return running;
    const last = this.#refreshed.get(reason);
    if (last !== undefined && this.#now() - last < REFRESH_EVERY_MS) return Promise.resolve(null);
    const read = this.sync(pins).finally(() => {
      this.#refreshing.delete(reason);
      this.#refreshed.set(reason, this.#now());
    });
    this.#refreshing.set(reason, read);
    return read;
  }

  /** Drops what the device kept of the org. */
  forget(): Promise<void> {
    return this.#serial(async () => {
      await this.deps.persistence.forget(this.org);
      this.#record = null;
      this.#refreshed.clear();
    });
  }

  #serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(run);
    this.#queue = next.catch(() => {});
    return next;
  }

  async #first(chain: SignedOrgState[], transitions: Signed<RootTransition>[], certificates: Certificates | null, pins: OrgPins): Promise<SyncResult> {
    if (chain.length === 0) return { adopted: 0 };
    const verdict = await verifyPinnedChain(chain, transitions, pins);
    if (!verdict.ok) return { adopted: 0, refused: verdict.code };
    if (verdict.head.state.org !== this.org) return { adopted: 0, refused: 'bad-link' };
    await this.#commit({
      head: verdict.head,
      chain: verdict.adopted,
      transitions: verdict.transitions,
      certificates: certificates ?? NO_CERTIFICATES,
      hashes: await hashesOf(verdict.adopted),
    });
    return { adopted: verdict.adopted.length };
  }

  async #onto(record: OrgRecord, states: SignedOrgState[], transitions: Signed<RootTransition>[], certificates: Certificates | null, served: SignedOrgState | null = null): Promise<SyncResult> {
    const run = await advanceHead(record.head, states, transitions, record.transitions.map((t) => t.body));
    const certificatesChanged = certificates !== null && JSON.stringify(certificates) !== JSON.stringify(record.certificates);
    if (run.adopted.length === 0) {
      if (certificatesChanged) await this.#commit({ ...record, certificates });
      const refused = await refusal(record.head, states, served);
      return refused === null ? { adopted: 0 } : { adopted: 0, refused };
    }
    await this.#commit({
      head: run.head,
      chain: [...record.chain, ...run.adopted],
      transitions: [...record.transitions, ...run.transitions],
      certificates: certificates ?? record.certificates,
      hashes: [...record.hashes, ...(await hashesOf(run.adopted))],
    });
    return { adopted: run.adopted.length };
  }

  async #commit(next: OrgRecord): Promise<void> {
    const cutoff = new Date(this.#now() - CHAIN_WINDOW_MS).toISOString();
    const record = { ...next, chain: next.chain.filter((s) => s.state.issued >= cutoff || s.state.version === next.head.state.version) };
    await this.deps.persistence.save(this.org, record);
    this.#record = record;
    for (const listener of this.#listeners) {
      try {
        listener({ head: record.head, certificates: record.certificates });
      } catch (error) {
        console.error('desk: a listener of the org state failed', error);
      }
    }
  }
}

/** Why nothing was adopted though the hub served a head this device does not hold; null when it served nothing newer. */
async function refusal(head: SignedOrgState, states: SignedOrgState[], served: SignedOrgState | null): Promise<string | null> {
  const version = head.state.version;
  if (served !== null && served.state.version < version) return 'rollback';
  if (served !== null && served.state.version === version && (await stateHash(served.state)) !== (await stateHash(head.state))) return 'fork';
  const next = states.find((s) => s.state.version === version + 1);
  if (next === undefined) return served !== null && served.state.version > version ? 'not-head' : null;
  const verdict = await verifySuccessor(head, next, []);
  return verdict.ok ? null : verdict.code;
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const hashesOf = (states: SignedOrgState[]): Promise<B64[]> => Promise.all(states.map((s) => stateHash(s.state)));

export function idbOrgPersistence(): OrgPersistence {
  return {
    async load(org) {
      const db = await openDesk();
      const value = (await done(db.transaction(DESK_DB.org).objectStore(DESK_DB.org).get(org))) as OrgRecord | undefined;
      return value !== undefined && isSignedOrgState(value.head) ? value : null;
    },
    async save(org, record) {
      const tx = (await openDesk()).transaction(DESK_DB.org, 'readwrite');
      tx.objectStore(DESK_DB.org).put(record, org);
      await committed(tx);
    },
    async forget(org) {
      const tx = (await openDesk()).transaction(DESK_DB.org, 'readwrite');
      tx.objectStore(DESK_DB.org).delete(org);
      await committed(tx);
    },
  };
}

export function memoryOrgPersistence(): OrgPersistence {
  const records = new Map<string, OrgRecord>();
  return {
    load: async (org) => structuredClone(records.get(org) ?? null),
    save: async (org, record) => void records.set(org, structuredClone(record)),
    forget: async (org) => void records.delete(org),
  };
}

let active: OrgStore | null = null;

/** The device's org store for a channel (M4): the package's `OrgView`. Throws while no head is held. */
export function orgView(): OrgView {
  if (active === null || !active.ready) throw new Error('this device holds no verified org state yet');
  return active;
}

/** Makes `store` the one `orgView` answers (the device controller's, register.ts). */
export function activateOrgStore(store: OrgStore | null): void {
  active = store;
}
