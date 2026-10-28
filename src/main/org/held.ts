// The held org view (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "The held org view" and
// Interfaces §C, §D): the org's signed chain from genesis as this profile holds it in `<userData>/org/chain.json`, with
// the root transitions that authorized it, every transition accepted, the superseded states and the hub's certificates.
// It is O7's `OrgView` for the app's links and the device side of the org's trust.
//
// Adoption follows `EndpointOrg`'s rules (src/endpoint/org-sync.ts), rebuilt on the protocol package's verifiers since
// main never imports the endpoint: successors by `advanceHead` against the accepted transitions; a recovery from below
// the head by `verifyRewind`, its base the held state at `fromVersion`, the states after it moved to `superseded`; a
// served head below the high-water mark refused `rollback`, one at the held version with another hash `fork`.
// Adoptions run one at a time, each against the head the one before left, and land in chain.json and then the anchor
// (`saveAnchor`, registration.json's) before any listener is told, so what a listener acts on survives a crash.
//
// The anchor (the genesis hash, and the held head's version and hash) is the trust that outlives chain.json. At load the
// held chain is checked as one run from the anchored genesis, never against the pins again (a recovery may have rewound
// below the state the pinned roots first signed), and must account for the anchored state; a chain that doesn't is
// refused (`held-chain`), and only a served chain holding the anchored state on its own line, or a re-anchoring on a
// fresh code's pins, opens it again.
import {
  advanceHead,
  canonicalize,
  isCertificates,
  isSignedOrgState,
  stateHash,
  verifyGenesis,
  verifyPinnedChain,
  verifyRewind,
  verifySuccessor,
  verifyTransition,
  type Certificates,
  type OrgPins,
  type OrgView,
  type RootTransition,
  type Signed,
  type SignedOrgState,
} from '../../../apps/org-protocol/src/index.ts';
import { CHAIN_FILE, isChainFile, type Anchor, type ChainFile, type OrgFiles } from './files';

export type { Anchor };

export type Served = { chain: SignedOrgState[]; head: SignedOrgState | null; transitions: Signed<RootTransition>[]; certificates: Certificates | null };
export type AdoptResult = { adopted: number; rewound: boolean; certificatesChanged: boolean; refused?: 'rollback' | 'fork' | string };

export interface HeldOrg extends OrgView {
  /** A verified chain is held (always, once `startHeldOrg` answered one). */
  ready(): boolean;
  /**
   * Verifies and adopts what the hub (or, with `head` and `certificates` null, a link's handshake) served, after every
   * adoption already asked for. A served certificate set that differs replaces the held one even when no state is
   * adopted (`certificatesChanged`).
   */
  adoptServed(served: Served): Promise<AdoptResult>;
  /** Called once per adoption that moved the head, after chain.json and the anchor are written. */
  onAdopted(listener: () => void): () => void;
  /** The states recoveries rewound away, oldest rewind first (kept for M3's offer). */
  superseded(): readonly SignedOrgState[];
  highWater(): number;
}

export type StartInput = {
  files: OrgFiles;
  /** registration.json's; null only at registration and re-anchoring, which then need `first` and `pins`. */
  anchor: Anchor | null;
  /** Writes registration.json's anchor; called after each chain.json write that moved the head. */
  saveAnchor(anchor: Anchor): Promise<void>;
  /** Read only with `anchor` null: the code's, for `verifyPinnedChain`. A held chain is never pinned again. */
  pins?: OrgPins;
  /** The hub's chain from genesis: the first chain (with `pins`), or the one that may reopen a held chain that failed. */
  first?: { chain: SignedOrgState[]; transitions: Signed<RootTransition>[]; certificates: Certificates };
  log(line: string): void;
};

export type StartResult = { ok: true; held: HeldOrg } | { ok: false; reason: string };

/** What chain.json holds, in memory. `chain` runs from genesis to the head; `highWater` is the head's version. */
type Held = Omit<ChainFile, 'version'>;

/**
 * Opens the held view in one of three ways:
 *  - `anchor` null, with `first` and `pins` (registration, re-anchoring): the whole served run pinned, or nothing; then
 *    chain.json and the anchor are written, in that order.
 *  - `anchor` alone (every start): chain.json read under the load rule; an anchor below the held head is moved up.
 *  - `anchor` with `first` (a held chain that failed): the served chain taken only if it is one run from the anchored
 *    genesis holding the anchored state on its own line; chain.json is then written anew and the anchor moved to its head.
 * `{ok: false}` reads `held-chain`, or with `pins` the verdict's code.
 */
export async function startHeldOrg(input: StartInput): Promise<StartResult> {
  const { files, anchor, log } = input;
  if (anchor === null) {
    if (input.first === undefined || input.pins === undefined) throw new TypeError('a registration needs the first chain and its pins');
    return register(input, input.first, input.pins);
  }
  if (input.first !== undefined) return recover(input, anchor, input.first);
  const file = await files.read(CHAIN_FILE);
  if (!isChainFile(file)) {
    log(`org: ${CHAIN_FILE} is absent or malformed; the held chain is closed`);
    return { ok: false, reason: 'held-chain' };
  }
  const failure = await loadRule(file, anchor);
  if (failure !== null) {
    log(`org: ${CHAIN_FILE} fails the load rule (${failure}); the held chain is closed`);
    return { ok: false, reason: 'held-chain' };
  }
  const held = new HeldChain(input, { chain: file.chain, transitions: file.transitions, accepted: file.accepted, certificates: file.certificates, highWater: file.chain.length, superseded: file.superseded }, anchor.genesis);
  // A crash between chain.json and the anchor (a forward adoption, or a rewind) left the anchor below the held head.
  const at = await held.anchor();
  if (!sameAnchor(at, anchor)) await held.saveAnchor(at, 'moved up at load');
  return { ok: true, held };
}

async function register(input: StartInput, first: NonNullable<StartInput['first']>, pins: OrgPins): Promise<StartResult> {
  const verdict = await verifyPinnedChain(first.chain, first.transitions, pins);
  if (!verdict.ok) {
    input.log(`org: the served chain is refused: ${verdict.code}`);
    return { ok: false, reason: verdict.code };
  }
  // The whole served run or nothing: a run that stops short holds a state that doesn't verify.
  if (verdict.adopted.length !== first.chain.length) {
    const at = verdict.adopted.length;
    const why = await verifySuccessor(verdict.adopted[at - 1], first.chain[at], first.transitions);
    const reason = why.ok ? 'not-head' : why.code;
    input.log(`org: the served chain is refused: ${reason} (it stops at version ${verdict.head.state.version} of ${first.chain.length} states)`);
    return { ok: false, reason };
  }
  const held = new HeldChain(input, fresh(verdict.adopted, verdict.transitions, first.certificates), await stateHash(verdict.adopted[0].state));
  await held.write();
  await input.saveAnchor(await held.anchor());
  return { ok: true, held };
}

async function recover(input: StartInput, anchor: Anchor, first: NonNullable<StartInput['first']>): Promise<StartResult> {
  // Its own line must reach the anchored state: one a recovery rewound below the anchor is refused, since the accepted
  // transitions and the base `verifyRewind` needs went with the damaged file (round 2's finding).
  const run = await oneRun(first.chain, first.transitions, anchor.genesis);
  const failure = typeof run === 'string' ? run : (await holds(first.chain, anchor)) ? null : `it doesn't hold the anchored state at version ${anchor.version}`;
  if (typeof run === 'string' || failure !== null) {
    input.log(`org: the hub's chain doesn't reopen the held chain (${failure})`);
    return { ok: false, reason: 'held-chain' };
  }
  const held = new HeldChain(input, fresh(first.chain, run, first.certificates), anchor.genesis);
  await held.write();
  await input.saveAnchor(await held.anchor());
  input.log(`org: the held chain was taken again from the hub, at version ${first.chain.length}`);
  return { ok: true, held };
}

/**
 * The version to read the hub's chain again from, when a page read after the held head (`?since=<head>`) may carry a
 * recovery from below it, or null when the page is enough. A recovery needs the states from its `fromVersion` on, which
 * that page leaves out (the first state under it authenticates the rewind); a served head below the held one is judged
 * with the whole chain, which tells a rewind from a rollback. M1's sync and M3's signer both follow the hub by it.
 */
export function rereadFrom(view: HeldOrg, served: Pick<Served, 'transitions' | 'head'>): number | null {
  const version = view.head().state.version;
  const known = new Set(view.since(0).transitions.map((t) => canonicalize(t.body)));
  const below = list(served.transitions)
    .filter((t): t is Signed<RootTransition> => typeof (t as Signed<RootTransition>)?.body?.fromVersion === 'number')
    .filter((t) => t.body.fromVersion < version && !known.has(canonicalize(t.body)))
    .map((t) => t.body.fromVersion);
  if (below.length > 0) return Math.max(0, Math.min(...below));
  const head = served.head?.state?.version;
  return typeof head === 'number' && head < version ? 0 : null;
}

const fresh = (chain: SignedOrgState[], transitions: Signed<RootTransition>[], certificates: Certificates): Held => ({
  chain,
  transitions,
  accepted: transitions.map((t) => t.body),
  certificates,
  highWater: chain.length,
  superseded: [],
});

/**
 * `chain` as one run from the genesis `genesis` names: the genesis verifies and every later state follows by
 * `advanceHead` over `transitions`. The transitions that authorized states of it, or why it isn't one.
 */
async function oneRun(chain: SignedOrgState[], transitions: Signed<RootTransition>[], genesis: string): Promise<Signed<RootTransition>[] | string> {
  if (chain.length === 0 || !chain.every(isSignedOrgState)) return 'malformed';
  if ((await stateHash(chain[0].state)) !== genesis) return 'not the anchored genesis';
  const verdict = await verifyGenesis(chain[0]);
  if (!verdict.ok) return `genesis ${verdict.code}`;
  const run = await advanceHead(chain[0], chain.slice(1), transitions);
  // Every state held is one of the run, in order: a duplicate or a state past a gap would end it short.
  if (run.adopted.length !== chain.length - 1) return `the run stops at version ${run.head.state.version} of ${chain.length}`;
  return run.transitions;
}

/** `chain` (from genesis, in version order) holds the anchored version with the anchored hash. */
async function holds(chain: SignedOrgState[], anchor: Anchor): Promise<boolean> {
  const at = chain[anchor.version - 1];
  return at !== undefined && (await stateHash(at.state)) === anchor.head;
}

/** The load rule (the document's "At load"), or null when `file` passes it. */
async function loadRule(file: ChainFile, anchor: Anchor): Promise<string | null> {
  const run = await oneRun(file.chain, file.transitions, anchor.genesis);
  if (typeof run === 'string') return run;
  // `accepted` is the barrier a later recovery is checked against: it holds at least the run's own transitions.
  const accepted = new Set(file.accepted.map((t) => canonicalize(t)));
  if (!run.every((t) => accepted.has(canonicalize(t.body)))) return 'accepted lacks a transition of the chain';
  if (await holds(file.chain, anchor)) return null;
  return (await rewoundFrom(file, anchor)) ? null : `neither the chain nor a verified rewind accounts for the anchored version ${anchor.version}`;
}

/**
 * The anchored state is superseded by a verified rewind (a crash cut off the rewind's anchor write): it is among
 * `superseded`, a transition in `accepted` from a version below it authorized the chain's state after that version, and
 * the superseded states hash-chain from that same base to the anchored one.
 */
async function rewoundFrom(file: ChainFile, anchor: Anchor): Promise<boolean> {
  const hashes = new Map<string, SignedOrgState>();
  for (const s of file.superseded) hashes.set(await stateHash(s.state), s);
  const anchored = hashes.get(anchor.head);
  if (anchored === undefined || anchored.state.version !== anchor.version) return false;
  for (const body of file.accepted) {
    const from = body.fromVersion;
    const base = file.chain[from - 1];
    const next = file.chain[from];
    if (from >= anchor.version || base === undefined || next === undefined) continue;
    const t = file.transitions.find((x) => canonicalize(x.body) === canonicalize(body));
    if (t === undefined || !(await authorizes(base, next, t))) continue;
    // Back from the anchored state by `prev`, through the superseded states, to the base.
    let s = anchored;
    while (s.state.version > from + 1) {
      const before = hashes.get(s.state.prev ?? '');
      if (before === undefined || before.state.version !== s.state.version - 1) break;
      s = before;
    }
    if (s.state.version === from + 1 && s.state.prev === (await stateHash(base.state))) return true;
  }
  return false;
}

/** `t` is a valid transition on `base` and the one `next` is signed under (not the old root set). */
async function authorizes(base: SignedOrgState, next: SignedOrgState, t: Signed<RootTransition>): Promise<boolean> {
  return (await verifyTransition(base, t, base.state.root.recoveryPub)).ok && (await verifySuccessor(base, next, [t])).ok;
}

const sameAnchor = (a: Anchor, b: Anchor) => a.genesis === b.genesis && a.version === b.version && a.head === b.head;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

class HeldChain implements HeldOrg {
  #held: Held;
  readonly #genesis: string;
  readonly #input: StartInput;
  readonly #listeners = new Set<() => void>();
  /** The states logged as following nothing held, by hash: each is logged once. */
  readonly #ignored = new Set<string>();
  #queue: Promise<unknown> = Promise.resolve();

  constructor(input: StartInput, held: Held, genesis: string) {
    this.#input = input;
    this.#held = held;
    this.#genesis = genesis;
  }

  ready(): boolean {
    return this.#held.chain.length > 0;
  }

  head(): SignedOrgState {
    return this.#held.chain[this.#held.chain.length - 1];
  }

  certificates(): Certificates {
    return this.#held.certificates;
  }

  since(version: number): { states: SignedOrgState[]; transitions: Signed<RootTransition>[] } {
    return {
      states: this.#held.chain.filter((s) => s.state.version > version),
      transitions: this.#held.transitions.filter((t) => t.body.fromVersion >= version),
    };
  }

  superseded(): readonly SignedOrgState[] {
    return this.#held.superseded;
  }

  highWater(): number {
    return this.#held.highWater;
  }

  advance(states: SignedOrgState[], transitions: Signed<RootTransition>[]): Promise<void> {
    return this.adoptServed({ chain: states, head: null, transitions, certificates: null }).then(() => undefined);
  }

  adoptServed(served: Served): Promise<AdoptResult> {
    const run = this.#queue.then(() => this.#adopt(served));
    this.#queue = run.catch(() => {});
    return run;
  }

  onAdopted(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  async anchor(): Promise<Anchor> {
    const head = this.head();
    return { genesis: this.#genesis, version: head.state.version, head: await stateHash(head.state) };
  }

  async write(): Promise<void> {
    const file: ChainFile = { version: 1, ...this.#held };
    await this.#input.files.write(CHAIN_FILE, file);
  }

  /**
   * After chain.json moved the head. A failed anchor write leaves the anchor naming a state chain.json still holds or
   * records as superseded, which the next load moves up, so it is logged and the adoption stands.
   */
  async saveAnchor(anchor: Anchor, why: string): Promise<void> {
    try {
      await this.#input.saveAnchor(anchor);
    } catch (error) {
      this.#input.log(`org: the anchor was not ${why}: ${(error as Error).message}`);
    }
  }

  async #adopt(served: Served): Promise<AdoptResult> {
    const states = list(served.chain).filter(isSignedOrgState);
    const transitions = list(served.transitions) as Signed<RootTransition>[];
    const head = isSignedOrgState(served.head) ? served.head : null;
    const certificates = isCertificates(served.certificates) ? served.certificates : null;
    const held = this.#held;
    const certificatesChanged = certificates !== null && canonicalize(certificates) !== canonicalize(held.certificates);

    let chain = held.chain;
    let kept = held.transitions;
    let accepted = held.accepted;
    let superseded = held.superseded;
    const rewind = await this.#rewind(states, transitions);
    if (rewind !== null) {
      const from = rewind.t.body.fromVersion;
      // The recovery key says the states after `fromVersion` were forged: they leave the chain (kept as superseded),
      // with the transitions that authorized them, and the recovery joins the accepted ones as the barrier.
      superseded = [...superseded, ...chain.slice(from)];
      chain = [...chain.slice(0, from), rewind.first];
      kept = [...kept.filter((t) => t.body.fromVersion < from), rewind.t];
      accepted = [...accepted.filter((t) => t.fromVersion < from), rewind.t.body];
    }
    const run = await advanceHead(chain[chain.length - 1], states, transitions, accepted);
    if (rewind === null && run.adopted.length === 0) {
      const refused = await this.#refusal(states, head);
      if (refused !== null) this.#input.log(`org: org state refused: ${refused}`);
      if (certificatesChanged) {
        await this.#commit({ ...held, certificates }, false);
      }
      return { adopted: 0, rewound: false, certificatesChanged, ...(refused === null ? {} : { refused: refused.split(' ')[0] }) };
    }
    const next = [...chain, ...run.adopted];
    await this.#commit(
      {
        chain: next,
        transitions: [...kept, ...run.transitions],
        accepted: [...accepted, ...run.transitions.map((t) => t.body)],
        certificates: certificates ?? held.certificates,
        highWater: next.length,
        superseded,
      },
      true,
    );
    return { adopted: (rewind === null ? 0 : 1) + run.adopted.length, rewound: rewind !== null, certificatesChanged };
  }

  /** chain.json first, then (when the head moved) the anchor, then the listeners. Memory follows the file. */
  async #commit(next: Held, moved: boolean): Promise<void> {
    await this.#input.files.write(CHAIN_FILE, { version: 1, ...next } satisfies ChainFile);
    this.#held = next;
    if (!moved) return;
    await this.saveAnchor(await this.anchor(), 'moved with the head');
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch (error) {
        this.#input.log(`org: a listener of the held chain failed: ${(error as Error).message}`);
      }
    }
  }

  /**
   * The newest recovery among `transitions` that rewinds the head, with the first state under it; or null. The base is
   * the held state at its `fromVersion` (the whole chain is held), so a delivery can't supply a base of its own.
   */
  async #rewind(states: SignedOrgState[], transitions: Signed<RootTransition>[]): Promise<{ t: Signed<RootTransition>; first: SignedOrgState } | null> {
    const { chain, accepted } = this.#held;
    const head = chain[chain.length - 1];
    const recoveryPub = chain[0].state.root.recoveryPub;
    const candidates = transitions.filter((t) => typeof t?.body?.fromVersion === 'number' && t.body.fromVersion < head.state.version);
    candidates.sort((x, y) => (x.body.issued < y.body.issued ? 1 : -1));
    for (const t of candidates) {
      const base = chain[t.body.fromVersion - 1];
      if (base === undefined || !(await verifyRewind(head, t, recoveryPub, accepted)).ok) continue;
      for (const s of states) {
        if (s.state.version === t.body.fromVersion + 1 && (await verifySuccessor(base, s, [t])).ok) return { t, first: s };
      }
    }
    return null;
  }

  /** Why nothing offered was adopted, or null when nothing newer was offered (a state past a gap is logged once). */
  async #refusal(states: SignedOrgState[], served: SignedOrgState | null): Promise<string | null> {
    const head = this.head();
    const version = head.state.version;
    const highWater = this.#held.highWater;
    if (served !== null && served.state.version < highWater) return `rollback (the hub's head is version ${served.state.version}, below the high-water mark ${highWater})`;
    if (served !== null && served.state.version === version && (await stateHash(served.state)) !== (await stateHash(head.state))) {
      return `fork (the hub's head at version ${version} is not the held one)`;
    }
    const next = states.find((s) => s.state.version === version + 1);
    if (next === undefined) {
      for (const s of states) {
        if (s.state.version <= version + 1) continue;
        const hash = await stateHash(s.state);
        if (this.#ignored.has(hash)) continue;
        this.#ignored.add(hash);
        this.#input.log(`org: version ${s.state.version} follows nothing held (the head is version ${version}); ignored`);
      }
      return states.some((s) => s.state.version < highWater) && served === null ? `rollback (states below the high-water mark ${highWater})` : null;
    }
    const verdict = await verifySuccessor(head, next, []);
    if (!verdict.ok && verdict.code === 'not-head') return `fork (version ${version + 1} does not follow the head)`;
    return verdict.ok ? null : `${verdict.code} (version ${version + 1})`;
  }
}
