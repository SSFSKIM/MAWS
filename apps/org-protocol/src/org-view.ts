// What a channel's two ends know of the org (RL2, Interfaces §A's `OrgView`): the verifier's head, its certificates,
// the chain after a version it can hand a peer that is behind, and an `advance` that verifies and adopts successors a
// peer carried. The endpoint's view writes each new head to disk before it adopts it (M2); a device's, and the suites',
// is `memoryOrgView`. Either way the verification is `advanceHead`, the package's.
import { keyId, signingInput, verifyInput, type B64 } from './keys.ts';
import { NO_CERTIFICATES } from './records.ts';
import { issuedAfterAll, verifyGenesis, verifySuccessor, verifyTransition } from './org-state.ts';
import { isRootTransition, isSigned } from './shapes.ts';
import { SIGNING_DOMAINS, type Certificates, type RootTransition, type Signed, type SignedOrgState } from './types.ts';
import type { VerdictCode } from './verdict.ts';

export interface OrgView {
  head(): SignedOrgState;
  certificates(): Certificates;
  /** The states after `version` and the root transitions from it on, each in chain order, as far as the view holds them. */
  since(version: number): { states: SignedOrgState[]; transitions: Signed<RootTransition>[] };
  /**
   * Verifies and adopts every successor of the head among `states`, in version order, until one fails to verify. Calls
   * are serialized: each verifies against the head the one before it left, so a page verified against an older head
   * never lands after a newer one (two channels' handshakes can each carry a page at once).
   */
  advance(states: SignedOrgState[], transitions: Signed<RootTransition>[]): Promise<void>;
}

/**
 * The successors among `states` that follow `head` one by one, each verified by `verifySuccessor` against the one
 * before (with the transitions among `transitions` held for it), up to the first that fails or is missing: the new head,
 * the states adopted, and for each successor a root transition authorized, that transition. A peer's states are
 * org-signed, so who carried them doesn't matter. A verifier that keeps the transitions it accepted passes them as
 * `accepted`: a transition then authorizes only when it is issued after every one of them and those the run took before
 * it (`issuedAfterAll`), since a recovery's rewind can bring an older transition's `fromVersion` back to the head.
 */
export async function advanceHead(
  head: SignedOrgState,
  states: unknown,
  transitions: unknown,
  accepted?: RootTransition[],
): Promise<{ head: SignedOrgState; adopted: SignedOrgState[]; transitions: Signed<RootTransition>[] }> {
  const offered = Array.isArray(states) ? (states as SignedOrgState[]) : [];
  const offeredTransitions = Array.isArray(transitions) ? (transitions as Signed<RootTransition>[]) : [];
  const barrier = accepted === undefined ? null : [...accepted];
  const byVersion = new Map<number, SignedOrgState>();
  for (const s of offered) {
    const version = (s as { state?: { version?: unknown } } | null)?.state?.version;
    if (typeof version === 'number' && !byVersion.has(version)) byVersion.set(version, s);
  }
  const adopted: SignedOrgState[] = [];
  const took: Signed<RootTransition>[] = [];
  let current = head;
  for (;;) {
    const next = byVersion.get(current.state.version + 1);
    const held = barrier === null ? offeredTransitions : offeredTransitions.filter((t) => isSigned(t, isRootTransition) && issuedAfterAll(t.body, barrier));
    if (next === undefined || !(await verifySuccessor(current, next, held)).ok) break;
    // Only the transition that authorized this successor is taken. The verifier keeps what it takes as accepted
    // (`verifyRewind`'s `issued` rule), so neither one a peer forged nor a genuine one to a root set the successor
    // didn't take may enter it: a later recovery would then be refused as older than it.
    const authorizing = await authorizedBy(current, next, held);
    if (authorizing !== null) {
      took.push(authorizing);
      barrier?.push(authorizing.body);
    }
    adopted.push(next);
    current = next;
  }
  return { head: current, adopted, transitions: took };
}

/** What a machine pins at enrollment (RL §5.2), from its code: the root key ids of the head then, and the recovery key. */
export type OrgPins = { roots: string[]; recoveryPub: B64 };

/**
 * A machine's first sync (O10 M2): the org's chain from its genesis, as the hub serves it to a machine that holds no
 * state yet, verified as one run (the genesis, then `advanceHead` over the rest) and anchored to the pins. The genesis
 * names the pinned recovery key, which no successor may change; and some state of the run carries a valid signature by
 * a pinned root key, the key's point found among that state's admin devices or its predecessor's (a kid is a hash of
 * its point). A state a pinned key signed is the org the enrolling member's app named, and its `prev` binds every state
 * before it, so a hub can't make up an org around the owner's public keys. The run is adopted up to the last state that
 * verifies, when that prefix is anchored; `transitions` are every one that authorized a state of it, which `verifyRewind`
 * needs as its `accepted` from the first sync on. `bad-link` for another recovery key, `not-root-signed` for a run no
 * pinned key signed.
 */
export async function verifyPinnedChain(
  chain: unknown,
  transitions: unknown,
  pins: OrgPins,
): Promise<{ ok: true; head: SignedOrgState; adopted: SignedOrgState[]; transitions: Signed<RootTransition>[] } | { ok: false; code: VerdictCode }> {
  if (!Array.isArray(chain) || chain.length === 0) return { ok: false, code: 'malformed' };
  const genesis = chain[0] as SignedOrgState;
  const first = await verifyGenesis(genesis);
  if (!first.ok) return first;
  if (genesis.state.root.recoveryPub !== pins.recoveryPub) return { ok: false, code: 'bad-link' };
  const run = await advanceHead(genesis, chain.slice(1), transitions);
  const adopted = [genesis, ...run.adopted];
  const roots = new Set(pins.roots);
  for (let i = 0; i < adopted.length; i++) {
    if (await signedByPinned(adopted[i], adopted[i - 1], roots)) return { ok: true, head: run.head, adopted, transitions: run.transitions };
  }
  return { ok: false, code: 'not-root-signed' };
}

async function signedByPinned(s: SignedOrgState, before: SignedOrgState | undefined, roots: Set<string>): Promise<boolean> {
  const points = new Map<string, B64>();
  for (const holder of [s, before]) {
    for (const member of holder?.state.members ?? []) {
      if (member.role !== 'admin') continue;
      for (const d of member.devices) if (d.stepUpPub !== undefined) points.set(await keyId(d.stepUpPub), d.stepUpPub);
    }
  }
  const input = signingInput(SIGNING_DOMAINS.orgState, s.state);
  for (const sig of s.sigs) {
    const pub = points.get(sig.kid);
    if (roots.has(sig.kid) && pub !== undefined && (await verifyInput(input, sig, pub))) return true;
  }
  return false;
}

/** The transition among `held` that authorized `next` on `current`, or null when the old root set signed it. */
async function authorizedBy(current: SignedOrgState, next: SignedOrgState, held: Signed<RootTransition>[]): Promise<Signed<RootTransition> | null> {
  for (const t of held) {
    if (!(await verifyTransition(current, t, current.state.root.recoveryPub)).ok) continue;
    if ((await verifySuccessor(current, next, [t])).ok) return t;
  }
  return null;
}

/**
 * An org view held in memory from `chain`, a run of states ending at the head and trusted as given (the caller verified
 * it), with the transitions it took.
 */
export function memoryOrgView(input: { chain: SignedOrgState[]; transitions?: Signed<RootTransition>[]; certificates?: Certificates }): OrgView {
  if (input.chain.length === 0) throw new TypeError('an org view holds at least its head');
  const chain = [...input.chain];
  const transitions = [...(input.transitions ?? [])];
  const certificates = input.certificates ?? NO_CERTIFICATES;
  let queue: Promise<void> = Promise.resolve();
  return {
    head: () => chain[chain.length - 1],
    certificates: () => certificates,
    since: (version) => ({
      states: chain.filter((s) => s.state.version > version),
      transitions: transitions.filter((t) => t.body.fromVersion >= version),
    }),
    advance(states, offered) {
      const run = queue.then(async () => {
        const result = await advanceHead(chain[chain.length - 1], states, offered);
        chain.push(...result.adopted);
        for (const t of result.transitions) if (!transitions.includes(t)) transitions.push(t);
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}
