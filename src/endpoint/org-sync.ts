// The endpoint's org state (O10 M2; RL §5.2): the signed state its machine holds, the one authority over who may reach
// it. Every state and transition it adopts is verified by the protocol package against its head and pins
// (`verifyPinnedChain` at the first sync, then `advanceHead` and `verifyRewind`), whoever carried it: the hub
// (`sync`), a device's handshake page (`advance`, the channel's `OrgView`), or an admin's delivery. Adoption is
// serialized, each against the head the one before left, and lands on disk (org.json, written whole and renamed into
// place: the head and its window are one commit) before anything is told of it, so a revocation is acted on only once it
// would survive a crash. A state below the high-water mark is refused (`rollback`), as is one that doesn't follow the
// head (`fork`, or the verdict).
//
// The chain window (org.json's `chain`) keeps the states issued in the last 30 days and the head always, with the
// transitions that authorized them; it is what `since` pages a device's catch-up from. `acceptedTransitions` keeps every
// transition that authorized an adopted state from the first sync on, which `verifyRewind`'s `issued` rule needs whole,
// and forward adoption checks each transition against them too (`advanceHead`'s replay barrier). A rewind (a recovery
// transition from below the head) drops the states after its `fromVersion` from both, and the high-water mark with
// them, since the recovery key says those states were forged.
import {
  advanceHead,
  isCertificates,
  isSignedOrgState,
  NO_CERTIFICATES,
  stateHash,
  verifyPinnedChain,
  verifyRewind,
  verifySuccessor,
  type Certificates,
  type OrgState,
  type OrgView,
  type RootTransition,
  type Signed,
  type SignedOrgState,
} from 'org-protocol';
import type { OrgStateView } from 'desk-hub/protocol';
import type { ChainEntry, EndpointState, OrgFile } from './state/store';

export type { OrgStateView };

/** What a new head took away from the one before: whatever held these must lose what they gave (M3–M6 act on it). */
export type Removed = { members: string[]; devices: Array<{ member: string; device: string }>; keys: string[] };
export type OrgChange = { previous: SignedOrgState | null; head: SignedOrgState; rewound: boolean; removed: Removed };
export type AdoptResult = { adopted: number; rewound: boolean; refused?: string };

const DAY_MS = 86_400_000;
/** The chain window keeps the states issued this recently (and the head always). */
export const CHAIN_WINDOW_MS = 30 * DAY_MS;
/** A head issued longer ago stops every remote action (RL §5.2's backstop: an admin app signs a successor weekly). */
export const BACKSTOP_MS = 30 * DAY_MS;
/** The most pages one sync reads (a page is about 1 MiB and holds at least one state). */
const MAX_PAGES = 1000;

/** `maxPages`: a suite's lower cap on the pages one read takes (MAX_PAGES otherwise). */
type Options = { log: (line: string) => void; now?: () => number; maxPages?: number };

export class EndpointOrg implements OrgView {
  #queue: Promise<unknown> = Promise.resolve();
  readonly #listeners = new Set<(change: OrgChange) => void>();
  readonly #certificateListeners = new Set<() => void>();
  readonly #state: EndpointState;
  readonly #log: (line: string) => void;
  readonly #now: () => number;
  readonly #maxPages: number;

  constructor(state: EndpointState, options: Options) {
    this.#state = state;
    this.#log = options.log;
    this.#now = options.now ?? Date.now;
    this.#maxPages = Math.max(1, options.maxPages ?? MAX_PAGES);
  }

  /** A head is held: the first sync has been adopted. */
  get ready(): boolean {
    return (this.#state.org?.head ?? null) !== null;
  }

  head(): SignedOrgState {
    const head = this.#state.org?.head ?? null;
    if (head === null) throw new Error('the endpoint holds no org state yet');
    return head;
  }

  certificates(): Certificates {
    return this.#state.org?.certificates ?? NO_CERTIFICATES;
  }

  since(version: number): { states: SignedOrgState[]; transitions: Signed<RootTransition>[] } {
    const { states, transitions } = this.#window();
    return { states: states.filter((s) => s.state.version > version), transitions: transitions.filter((t) => t.body.fromVersion >= version) };
  }

  advance(states: SignedOrgState[], transitions: Signed<RootTransition>[]): Promise<void> {
    return this.adopt(states, transitions).then(() => undefined);
  }

  /** Verifies and adopts what `states` and `transitions` carry onto the head, after every adoption already asked for. */
  adopt(states: unknown, transitions: unknown): Promise<AdoptResult> {
    return this.#serial(() => this.#adopt(list(states).filter(isSignedOrgState), list(transitions) as Signed<RootTransition>[]));
  }

  /**
   * Reads the hub's state from the head on (from version 0 at the first sync), a page at a time, and adopts it. Its
   * `head` tells a rollback apart; its certificates are kept beside the state as served (each use verifies them).
   *
   * A sync reads at most `maxPages` pages, and every state it reads goes into one pool that `#adopt` judges whole. When
   * the first page after the head serves a recovery from below the head that passes `verifyRewind` against it (only one
   * the recovery key signed, and none already accepted), half of what is left is the recovery's (`#recover`) and the
   * rest the read after the head's, each getting what the other leaves: neither can starve the other. What was read
   * when the pages run out is adopted, and the next sync goes on from there.
   */
  async sync(fetchView: (since: number) => Promise<OrgStateView>): Promise<AdoptResult> {
    const budget: Budget = { left: this.#maxPages };
    const pool = new Pool();
    const first = await this.#read(fetchView, budget, pool, this.ready ? this.head().state.version : 0, Infinity, 1);
    let view = first.view as OrgStateView;
    const bases = await this.#bases(list(view.transitions) as Signed<RootTransition>[]);
    if (bases.length > 0) {
      const share: Budget = { left: Math.ceil(budget.left / 2) };
      budget.left -= share.left;
      await this.#recover(fetchView, share, pool, bases, list(view.transitions) as Signed<RootTransition>[]);
      budget.left += share.left;
    }
    if (!first.ended) {
      const rest = await this.#read(fetchView, budget, pool, first.last);
      view = rest.view ?? view;
      if (!rest.ended) this.#log(`endpoint: the org state's chain ran past ${this.#maxPages} pages; the rest waits for the next sync`);
    }
    const served = isSignedOrgState(view.head) ? view.head : null;
    const certificates = isCertificates(view.certificates) ? view.certificates : null;
    return this.#serial(() => this.#adopt(pool.states, list(view.transitions) as Signed<RootTransition>[], served, certificates));
  }

  /**
   * The hub's chain after `since` into `pool`, a page at a time, while `budget` has pages left: at most `pages` pages,
   * up to the page that reaches version `until`. The last page's view (null when none was read), the version to read on
   * from, and whether the hub had nothing after it.
   */
  async #read(fetchView: (since: number) => Promise<OrgStateView>, budget: Budget, pool: Pool, since: number, until = Infinity, pages = Infinity): Promise<{ view: OrgStateView | null; last: number; ended: boolean }> {
    let cursor = since;
    let view: OrgStateView | null = null;
    for (let page = 0; page < pages && budget.left > 0; page++) {
      view = await fetchView(cursor);
      budget.left--;
      const got = list(view.chain).filter(isSignedOrgState);
      await pool.add(got);
      if (view.more !== true || got.length === 0) return { view, last: cursor, ended: true };
      cursor = got[got.length - 1].state.version;
      if (cursor >= until) break;
    }
    return { view, last: cursor, ended: false };
  }

  /** The `fromVersion`s, newest first, of the transitions in `transitions` that pass `verifyRewind` against the head. */
  async #bases(transitions: Signed<RootTransition>[]): Promise<number[]> {
    const org = this.#state.org;
    const head = org?.head ?? null;
    if (org === null || head === null) return [];
    const bases = new Set<number>();
    for (const t of transitions) {
      if (typeof t?.body?.fromVersion !== 'number' || t.body.fromVersion >= head.state.version || bases.has(t.body.fromVersion)) continue;
      if ((await verifyRewind(head, t, org.pinned.recoveryPub, org.acceptedTransitions)).ok) bases.add(t.body.fromVersion);
    }
    return [...bases].sort((x, y) => y - x);
  }

  /**
   * Reads into `pool`, within `share`, what a recovery from below the head needs (the app's rule, src/main/org/held.ts's
   * `rereadFrom`, with the endpoint's window): the first state under it at `fromVersion + 1`, which a read after the
   * head leaves out whenever that state is at or below the head's version (a sibling of the head: the hub never had the
   * head, an admin having delivered it straight to the machines), with the base at `fromVersion` when the window no
   * longer holds it. Each base, newest first, gets two pages at most; once `#rewind` finds a rewind in the pool, its line
   * is read on up to the head's version (the read after the head has the rest), and nothing more is probed. It picks
   * only what is read: `#adopt` verifies the rewind again, against the head it adopts onto.
   */
  async #recover(fetchView: (since: number) => Promise<OrgStateView>, share: Budget, pool: Pool, bases: number[], transitions: Signed<RootTransition>[]): Promise<void> {
    const org = this.#state.org as OrgFile;
    const head = org.head as SignedOrgState;
    for (const from of bases) {
      if (share.left <= 0) return;
      const window = this.#window();
      const since = window.states.some((s) => s.state.version === from) ? from : Math.max(0, from - 1);
      await this.#read(fetchView, share, pool, since, from + 1, 2);
      const rewind = await this.#rewind(org, window, pool.states, transitions, () => {});
      if (rewind === null) continue;
      const end = await runEnd(rewind.first, pool.states);
      if (end < head.state.version) await this.#read(fetchView, share, pool, end, head.state.version);
      return;
    }
  }

  /**
   * Runs `run` in the adoptions' queue: nothing is adopted while it runs, so what it reads of the head holds until it
   * returns (the grant ledger's intake and an enrollment's writes run here, against the adoptions that change both).
   */
  exclusive<T>(run: () => Promise<T>): Promise<T> {
    return this.#serial(run);
  }

  /** Called after each adoption is on disk, in order. A listener's failure is logged and stops nothing. */
  onAdopted(listener: (change: OrgChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Called after a sync puts a changed certificate set on disk under the same head (an adoption's set is the
   * `onAdopted` listeners' to read). A listener's failure is logged and stops nothing.
   */
  onCertificates(listener: () => void): () => void {
    this.#certificateListeners.add(listener);
    return () => this.#certificateListeners.delete(listener);
  }

  /** `state-too-old` while the head was issued more than 30 days ago (reads and subscriptions go on). */
  actionsRefusal(): 'state-too-old' | null {
    const head = this.#state.org?.head ?? null;
    if (head === null) return null;
    return this.#now() - Date.parse(head.state.issued) > BACKSTOP_MS ? 'state-too-old' : null;
  }

  #serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(run);
    this.#queue = next.catch(() => {});
    return next;
  }

  async #adopt(states: SignedOrgState[], transitions: Signed<RootTransition>[], served: SignedOrgState | null = null, certificates: Certificates | null = null): Promise<AdoptResult> {
    const org = this.#state.org;
    if (org === null) throw new Error('the endpoint is not enrolled in an org');
    if (org.head === null) return this.#first(org, states, transitions, certificates);

    let head = org.head;
    let window = this.#window();
    let accepted = org.acceptedTransitions;
    const took: Signed<RootTransition>[] = [];
    const rewind = await this.#rewind(org, window, states, transitions);
    if (rewind !== null) {
      const from = rewind.t.body.fromVersion;
      window = { states: [...window.states.filter((s) => s.state.version < from), rewind.base], transitions: window.transitions.filter((t) => t.body.fromVersion < from) };
      accepted = [...accepted.filter((t) => t.fromVersion < from), rewind.t.body];
      head = rewind.first;
      took.push(rewind.t);
    }
    const run = await advanceHead(head, states, transitions, accepted);
    took.push(...run.transitions);
    const adopted = [...(rewind === null ? [] : [rewind.first]), ...run.adopted];
    if (adopted.length === 0) {
      const refused = await this.#refusal(org.head, org.highWater, states, served);
      if (refused !== null) this.#log(`endpoint: org state refused: ${refused}`);
      if (certificates !== null && JSON.stringify(certificates) !== JSON.stringify(org.certificates)) {
        this.#state.setOrg({ ...org, certificates });
        this.#tell(this.#certificateListeners, undefined);
      }
      return { adopted: 0, rewound: false, ...(refused === null ? {} : { refused: refused.split(' ')[0] }) };
    }
    const below = adopted[0].state.version - 1;
    this.#commit(org, {
      previous: org.head,
      head: run.head,
      hashes: [...org.hashes.slice(0, below), ...(await hashesOf(adopted))],
      states: [...window.states, ...adopted],
      transitions: [...window.transitions, ...took],
      accepted: [...accepted, ...run.transitions.map((t) => t.body)],
      certificates: certificates ?? org.certificates,
      rewound: rewind !== null,
    });
    return { adopted: adopted.length, rewound: rewind !== null };
  }

  async #first(org: OrgFile, states: SignedOrgState[], transitions: Signed<RootTransition>[], certificates: Certificates | null): Promise<AdoptResult> {
    if (states.length === 0) return { adopted: 0, rewound: false };
    const verdict = await verifyPinnedChain(states, transitions, org.pinned);
    if (!verdict.ok) {
      this.#log(`endpoint: org state refused: ${verdict.code} (the first sync's chain is not the org the enrollment code pinned)`);
      return { adopted: 0, rewound: false, refused: verdict.code };
    }
    this.#commit(org, {
      previous: null,
      head: verdict.head,
      hashes: await hashesOf(verdict.adopted),
      states: verdict.adopted,
      transitions: verdict.transitions,
      accepted: verdict.transitions.map((t) => t.body),
      certificates: certificates ?? org.certificates,
      rewound: false,
    });
    return { adopted: verdict.adopted.length, rewound: false };
  }

  /**
   * The newest recovery transition among `transitions` that rewinds the head, with the state at its `fromVersion` (the
   * base) and the first state under it; or null. The base is the window's; once it has aged out of the window, one the
   * delivery carries whose hash is the one the endpoint recorded when it adopted that version (`hashes`): the very state
   * it verified then. A transition binds no base, so a base known only by the first state's `prev` could be anyone's,
   * and a base under another recovery key would let its own root sign that first state.
   */
  async #rewind(org: OrgFile, window: Window, states: SignedOrgState[], transitions: Signed<RootTransition>[], log = this.#log): Promise<{ t: Signed<RootTransition>; base: SignedOrgState; first: SignedOrgState } | null> {
    const head = org.head as SignedOrgState;
    const candidates = transitions.filter((t) => typeof t?.body?.fromVersion === 'number' && t.body.fromVersion < head.state.version);
    candidates.sort((x, y) => (x.body.issued < y.body.issued ? 1 : -1));
    for (const t of candidates) {
      if (!(await verifyRewind(head, t, org.pinned.recoveryPub, org.acceptedTransitions)).ok) continue;
      const from = t.body.fromVersion;
      const held = window.states.find((s) => s.state.version === from);
      const adopted = org.hashes[from - 1];
      const bases: SignedOrgState[] = held !== undefined ? [held] : [];
      for (const s of held === undefined && adopted !== undefined ? states : []) {
        if (s.state.version === from && (await stateHash(s.state)) === adopted) bases.push(s);
      }
      if (bases.length === 0) {
        log(`endpoint: a recovery transition from version ${from} reaches before the chain the endpoint keeps, and the delivery doesn't carry the state it adopted at version ${from}`);
        continue;
      }
      for (const base of bases) {
        for (const s of states) {
          if (s.state.version === from + 1 && (await verifySuccessor(base, s, [t])).ok) return { t, base, first: s };
        }
      }
    }
    return null;
  }

  /** Why nothing in `states` (or the hub's `served` head) was adopted, or null when it held nothing newer. */
  async #refusal(head: SignedOrgState, highWater: number, states: SignedOrgState[], served: SignedOrgState | null): Promise<string | null> {
    const version = head.state.version;
    if (served !== null && served.state.version < highWater) return `rollback (the hub's head is version ${served.state.version}, below the high-water mark ${highWater})`;
    if (served !== null && served.state.version === version && (await stateHash(served.state)) !== (await stateHash(head.state))) {
      return `fork (the hub's head at version ${version} is not the endpoint's)`;
    }
    const next = states.find((s) => s.state.version === version + 1);
    if (next === undefined) {
      return states.some((s) => s.state.version < highWater) && served === null ? `rollback (states below the high-water mark ${highWater})` : null;
    }
    const verdict = await verifySuccessor(head, next, []);
    if (!verdict.ok && verdict.code === 'not-head') return `fork (version ${version + 1} does not follow the head)`;
    return verdict.ok ? null : `${verdict.code} (version ${version + 1})`;
  }

  #commit(org: OrgFile, next: { previous: SignedOrgState | null; head: SignedOrgState; hashes: string[]; states: SignedOrgState[]; transitions: Signed<RootTransition>[]; accepted: RootTransition[]; certificates: Certificates; rewound: boolean }): void {
    const chain = windowEntries(next.states, next.transitions, next.head, this.#now());
    this.#state.setOrg({ ...org, head: next.head, chain, hashes: next.hashes, certificates: next.certificates, acceptedTransitions: next.accepted, highWater: next.head.state.version });
    const change: OrgChange = { previous: next.previous, head: next.head, rewound: next.rewound, removed: removals(next.previous?.state ?? null, next.head.state) };
    this.#tell(this.#listeners, change);
  }

  #tell<T>(listeners: Set<(value: T) => void>, value: T): void {
    for (const listener of listeners) {
      try {
        listener(value);
      } catch (error) {
        this.#log(`endpoint: a listener of the org state failed: ${(error as Error).message}`);
      }
    }
  }

  /** The chain window held with the head (which it ends at). */
  #window(): Window {
    const states: SignedOrgState[] = [];
    const transitions: Signed<RootTransition>[] = [];
    for (const entry of this.#state.org?.chain ?? []) {
      if ('state' in entry) states.push(entry.state);
      else transitions.push(entry.transition);
    }
    return { states, transitions };
  }
}

type Window = { states: SignedOrgState[]; transitions: Signed<RootTransition>[] };
type Budget = { left: number };

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The states one sync read, each once by version and hash, in the order read. */
class Pool {
  readonly states: SignedOrgState[] = [];
  readonly #seen = new Set<string>();

  async add(states: SignedOrgState[]): Promise<void> {
    for (const s of states) {
      const key = `${s.state.version} ${await stateHash(s.state)}`;
      if (this.#seen.has(key)) continue;
      this.#seen.add(key);
      this.states.push(s);
    }
  }
}

/** The version the run from `first` reaches in `states`, each state the one after the last by version and `prev`. */
async function runEnd(first: SignedOrgState, states: SignedOrgState[]): Promise<number> {
  let at = first;
  for (;;) {
    const hash = await stateHash(at.state);
    const next = states.find((s) => s.state.version === at.state.version + 1 && s.state.prev === hash);
    if (next === undefined) return at.state.version;
    at = next;
  }
}

const hashesOf = (states: SignedOrgState[]): Promise<string[]> => Promise.all(states.map((s) => stateHash(s.state)));

/** The window's entries in chain order: the states issued since the cutoff and the head, each after its transition. */
function windowEntries(states: SignedOrgState[], transitions: Signed<RootTransition>[], head: SignedOrgState, now: number): ChainEntry[] {
  const cutoff = new Date(now - CHAIN_WINDOW_MS).toISOString();
  const kept = states.filter((s) => s.state.version <= head.state.version && (s.state.issued >= cutoff || s.state.version === head.state.version));
  const oldest = Math.min(...kept.map((s) => s.state.version));
  const entries: Array<{ at: number; entry: ChainEntry }> = [
    ...kept.map((state) => ({ at: state.state.version, entry: { state } })),
    ...transitions.filter((t) => t.body.fromVersion >= oldest - 1 && t.body.fromVersion < head.state.version).map((transition) => ({ at: transition.body.fromVersion + 0.5, entry: { transition } })),
  ];
  return entries.sort((x, y) => x.at - y.at).map((e) => e.entry);
}

/** The members, devices and keys `previous` held that `next` doesn't (a device whose keys changed is a new device). */
export function removals(previous: OrgState | null, next: OrgState): Removed {
  if (previous === null) return { members: [], devices: [], keys: [] };
  const members = previous.members.filter((m) => !next.members.some((n) => n.id === m.id)).map((m) => m.id);
  const devices: Removed['devices'] = [];
  for (const member of previous.members) {
    const now = next.members.find((n) => n.id === member.id);
    for (const d of member.devices) {
      const kept = now?.devices.some((n) => n.id === d.id && n.channelPub === d.channelPub && n.stepUpPub === d.stepUpPub && n.class === d.class);
      if (!kept) devices.push({ member: member.id, device: d.id });
    }
  }
  const before = new Set(previous.revoked.map((r) => r.keyId));
  const keys = next.revoked.filter((r) => !before.has(r.keyId)).map((r) => r.keyId);
  return { members, devices, keys };
}
