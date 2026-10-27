// What a channel's two ends know of the org (RL2, Interfaces §A's `OrgView`): the verifier's head, its certificates,
// the chain after a version it can hand a peer that is behind, and an `advance` that verifies and adopts successors a
// peer carried. The endpoint's view writes each new head to disk before it adopts it (M2); a device's, and the suites',
// is `memoryOrgView`. Either way the verification is `advanceHead`, the package's.
import { NO_CERTIFICATES } from './records.ts';
import { verifySuccessor, verifyTransition } from './org-state.ts';
import type { Certificates, RootTransition, Signed, SignedOrgState } from './types.ts';

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
 * org-signed, so who carried them doesn't matter.
 */
export async function advanceHead(
  head: SignedOrgState,
  states: unknown,
  transitions: unknown,
): Promise<{ head: SignedOrgState; adopted: SignedOrgState[]; transitions: Signed<RootTransition>[] }> {
  const offered = Array.isArray(states) ? (states as SignedOrgState[]) : [];
  const held = Array.isArray(transitions) ? (transitions as Signed<RootTransition>[]) : [];
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
    if (next === undefined || !(await verifySuccessor(current, next, held)).ok) break;
    // Only the transition that authorized this successor is taken. The verifier keeps what it takes as accepted
    // (`verifyRewind`'s `issued` rule), so neither one a peer forged nor a genuine one to a root set the successor
    // didn't take may enter it: a later recovery would then be refused as older than it.
    const authorizing = await authorizedBy(current, next, held);
    if (authorizing !== null) took.push(authorizing);
    adopted.push(next);
    current = next;
  }
  return { head: current, adopted, transitions: took };
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
