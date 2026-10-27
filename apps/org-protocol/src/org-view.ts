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
  /** Verifies and adopts every successor of the head among `states`, in version order, until one fails to verify. */
  advance(states: SignedOrgState[], transitions: Signed<RootTransition>[]): Promise<void>;
}

/**
 * The successors among `states` that follow `head` one by one, each verified by `verifySuccessor` against the one
 * before (with the transitions among `transitions` held for it), up to the first that fails or is missing: the new head,
 * the states adopted and the transitions they took (each verified against the state it leaves). A peer's states are org-signed, so who carried them doesn't matter.
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
    // Only a transition the recovery key signed for this version is taken: the verifier keeps what it takes as accepted
    // (`verifyRewind`'s `issued` rule), so one a peer forged must never enter it.
    for (const t of held) if ((await verifyTransition(current, t, current.state.root.recoveryPub)).ok) took.push(t);
    adopted.push(next);
    current = next;
  }
  return { head: current, adopted, transitions: took };
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
  return {
    head: () => chain[chain.length - 1],
    certificates: () => certificates,
    since: (version) => ({
      states: chain.filter((s) => s.state.version > version),
      transitions: transitions.filter((t) => t.body.fromVersion >= version),
    }),
    async advance(states, offered) {
      const result = await advanceHead(chain[chain.length - 1], states, offered);
      chain.push(...result.adopted);
      for (const t of result.transitions) if (!transitions.includes(t)) transitions.push(t);
    },
  };
}
