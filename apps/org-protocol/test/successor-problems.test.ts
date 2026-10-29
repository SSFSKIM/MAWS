// The pre-sign function (P5 O8 M4a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "The pre-sign
// function"): `successorProblems` names, before anything is signed, every problem `verifySuccessor` would refuse an
// ordinary successor for (one with no authorizing root transition) but its signatures; `stateProblems` names the
// whole-state rules `stateInvariants` judges, each by its own code. Proved over the package's vectors, whose verdicts
// are the oracle, and by one case per code.
import { describe, expect, it } from 'vitest';
import { importSigningKey } from '../src/keys.ts';
import { isMemberEmail } from '../src/names.ts';
import { PROBLEMS_PER_CODE, signOrgState, stateHash, stateInvariants, stateProblems, successorProblems, verifySuccessor, verifyTransition, type ProblemCode } from '../src/org-state.ts';
import { isOrgState } from '../src/shapes.ts';
import type { OrgState, RootTransition, Signed, SignedOrgState } from '../src/types.ts';
import { VECTOR_KEYS, VECTORS, type Case } from '../vectors/index.ts';

/** A vector argument with its `{$signed}`, `{$state}` and `{$fixture}` references resolved, as the replay does. */
function resolve(arg: unknown): unknown {
  if (Array.isArray(arg)) return arg.map(resolve);
  if (typeof arg !== 'object' || arg === null) return arg;
  const ref = arg as Record<string, unknown>;
  const name = ref.$signed ?? ref.$state ?? ref.$fixture;
  if (typeof name !== 'string' || Object.keys(ref).length !== 1) return Object.fromEntries(Object.entries(ref).map(([k, v]) => [k, resolve(v)]));
  const value = VECTORS.fixtures[name];
  return '$state' in ref ? (value as SignedOrgState).state : value;
}

const signedFixture = (name: string) => VECTORS.fixtures[name] as SignedOrgState;
const caseNamed = (name: string): Case => {
  const found = VECTORS.cases.find((c) => c.name === name);
  if (found === undefined) throw new Error(`no vector case ${name}`);
  return found;
};
const codes = async (before: OrgState, after: OrgState, opts?: Parameters<typeof successorProblems>[2]) => (await successorProblems(before, after, opts)).map((p) => p.code);

/** The successor of `head` with `edit` applied, as a writer composes one: the link set, `issued` kept. */
async function next(head: OrgState, edit: (s: OrgState) => void): Promise<OrgState> {
  const s = structuredClone(head);
  s.version += 1;
  s.prev = await stateHash(head);
  edit(s);
  return s;
}

/** The verdict codes that judge a signature rather than the state: these are `verifySuccessor`'s, after signing. */
const SIGNATURE_CODES = new Set(['not-root-signed', 'bad-signature', 'unknown-signer']);

type Judged = { name: string; head: SignedOrgState; next: SignedOrgState; expect: Case['expect'] };

/** The vectors' `verifySuccessor` cases, split into ordinary successors and those a held root transition authorizes. */
async function successorCases(): Promise<{ ordinary: Judged[]; recovery: Judged[]; outside: string[] }> {
  const ordinary: Judged[] = [];
  const recovery: Judged[] = [];
  const outside: string[] = [];
  for (const c of VECTORS.cases) {
    if (c.call !== 'verifySuccessor') continue;
    const [head, nextState, transitions] = c.args.map(resolve) as [SignedOrgState, SignedOrgState, unknown];
    // A transitions argument that is no list is a call the verifier refuses outright; the function takes none.
    if (!Array.isArray(transitions)) {
      outside.push(c.name);
      continue;
    }
    let held = false;
    for (const t of transitions as Signed<RootTransition>[]) {
      if (t.body.fromVersion === head.state.version && (await verifyTransition(head, t, head.state.root.recoveryPub)).ok) held = true;
    }
    (held ? recovery : ordinary).push({ name: c.name, head, next: nextState, expect: c.expect });
  }
  return { ordinary, recovery, outside };
}

describe('successorProblems over the vectors', () => {
  it('finds nothing in an ordinary successor verifySuccessor accepts, and names a problem in each it refuses for a non-signature reason', async () => {
    const { ordinary } = await successorCases();
    const accepted = ordinary.filter((c) => 'ok' in c.expect && c.expect.ok);
    const refusedByState = ordinary.filter((c) => 'ok' in c.expect && !c.expect.ok && !SIGNATURE_CODES.has(c.expect.code));
    // Enough of each that a filter gone wrong can't make the proof vacuous.
    expect(accepted.length).toBeGreaterThan(20);
    expect(refusedByState.length).toBeGreaterThan(60);

    const wrong: string[] = [];
    for (const c of accepted) {
      const found = await successorProblems(c.head.state, c.next.state);
      if (found.length > 0) wrong.push(`${c.name}: accepted, yet named ${JSON.stringify(found)}`);
    }
    for (const c of refusedByState) {
      if ((await successorProblems(c.head.state, c.next.state)).length === 0) wrong.push(`${c.name}: refused ${JSON.stringify(c.expect)}, yet named nothing`);
    }
    expect(wrong).toEqual([]);
  });

  it('leaves out a successor a root transition authorizes: the recovery vector, accepted unendorsed, reads endorsement-missing here', async () => {
    // Outside the contract. A held transition changes non-signature rules (the successor takes the transition's root
    // set, and its new root devices need no endorsement), so the function judges ordinary successors alone: the one a
    // recovery authorizes replaces A's lost devices with an unendorsed one, which an ordinary successor may not.
    const { recovery } = await successorCases();
    const authorized = recovery.find((c) => c.name === 'the successor a root transition authorizes');
    expect(authorized?.expect).toEqual({ ok: true });
    expect(await codes(authorized!.head.state, authorized!.next.state)).toContain('endorsement-missing');
  });
});

describe('successorProblems names each problem by its code', () => {
  /** The vector cases that stand for each code: the code is among those the function names for the case's successor. */
  const byVector: Array<[ProblemCode, string]> = [
    ['shape', 'a successor with a lone surrogate'],
    ['other-org', 'a successor of another org'],
    ['version-not-next', 'a successor two versions past the head'],
    ['version-not-next', 'an older version than the head'],
    ['prev-not-head', 'a successor whose prev is not the head'],
    ['prev-not-head', 'a fork at the head: another state of the head version'],
    ['revives-revoked', "a successor revoking a machine's key it keeps"],
    ['revives-revoked', 'a revoked device key made current again, its revocation dropped'],
    ['recovery-changed', 'a successor that changes the recovery key'],
    ['issued-backwards', 'a successor issued before the head'],
    ['root-not-admin', 'a demotion that keeps the root key'],
    ['key-off-curve', 'a successor whose root set is a key off the curve'],
    ['machine-ref-taken', 'a successor with two machines of one ref'],
    ['key-held-twice', 'a successor giving two machines one key'],
    ['key-held-twice', 'a successor giving a delegation the recovery key'],
    ['prefix-names-machine', "a successor naming a machine under a delegation's prefix"],
    ['prefix-names-machine', 'a successor enrolling DC-mini beside the prefix dc-'],
    ['prefix-overlaps', "a successor adding a delegation with another's prefix"],
    ['prefix-overlaps', "a successor adding a delegation whose prefix nests in another's"],
    ['prefix-overlaps', "then a delegation whose prefix holds the revoked one's"],
    ['delegation-id-used', "then a delegation taking the revoked one's id"],
    ['ref-shapes-delegation', "a successor enrolling a machine under a ref of a live delegation's shape"],
    ['ref-shapes-delegation', "a successor adding a delegation whose id shapes an enrolled machine's ref"],
    ['retired-under-revoked-delegation', "then its delegation revoked, the certificate's key left retired"],
    ['retired-key-held', 'a successor retiring a key it still holds'],
    ['retired-kid-mismatch', "a successor whose retired key id is not its key's"],
    ['retired-and-revoked', 'then the retired key both retired and revoked'],
    ['legacy-retired', 'a successor retiring the legacy key at another version'],
    ['legacy-retired', 'then the legacy retirement moved'],
    ['machine-names', "a successor changing a machine's ref under its name"],
    ['machine-names', 'then a name dropped from the record'],
    ['machine-names', 'a successor whose record gains a name no machine has'],
    ['machine-ref-changed', "a successor changing a machine's ref under its key"],
    ['keys-unaccounted', "a successor rotating a machine's key, the old one neither retired nor revoked"],
    ['keys-unaccounted', 'a successor ending a delegation before its successor was issued'],
    ['keys-unaccounted', "a successor changing a delegation's key"],
    ['endorsement-missing', 'a second device without an endorsement'],
  ];
  for (const [code, name] of byVector) {
    it(`${code}: ${name}`, async () => {
      const [head, nextState] = caseNamed(name).args.map(resolve) as [SignedOrgState, SignedOrgState];
      expect(await codes(head.state, nextState.state)).toContain(code);
    });
  }

  /** Whole-state codes the vectors show only on a genesis: named by stateProblems on that state. */
  const byGenesis: Array<[ProblemCode, string]> = [
    ['email-taken', 'genesis with two members of one email'],
    ['owners-unknown', 'genesis with a machine owned by a non-member'],
    ['empty-roots', 'genesis with an empty root'],
    ['root-not-admin', 'genesis whose root names a channel key'],
    ['key-held-twice', "genesis with a device whose step-up key is its channel key"],
  ];
  for (const [code, name] of byGenesis) {
    it(`${code}: ${name}`, async () => {
      expect((await stateProblems(signedFixture(name).state)).map((p) => p.code)).toContain(code);
    });
  }

  // The rest, composed on v3 (A with a Mac and a phone, B with two Macs, two machines, a delegation, a project).
  const v3 = () => signedFixture('v3').state;
  const composed: Array<[ProblemCode, (s: OrgState) => void]> = [
    ['member-id-taken', (s) => s.members.push({ ...structuredClone(s.members[1]), email: 'c@example.com', devices: [] })],
    ['device-id-taken', (s) => (s.members[1].devices[1] = { ...s.members[1].devices[1], id: s.members[1].devices[0].id })],
    ['machine-name-taken', (s) => (s.machines[1] = { ...s.machines[1], name: s.machines[0].name.toUpperCase() })],
    ['delegation-id-used', (s) => s.delegations.push({ ...s.delegations[0], pub: VECTOR_KEYS.delegationB.pub, prefix: 'zz-' })],
    ['project-id-taken', (s) => s.projects.push({ ...s.projects[0], name: 'again' })],
    ['root-key-twice', (s) => s.root.keys.push(s.root.keys[0])],
    ['revoked-twice', (s) => {
      const entry = { keyId: VECTOR_KEYS.stranger.kid, holder: { machine: 'mref-ghost-000001' } };
      s.revoked.push(entry, structuredClone(entry));
    }],
    ['retired-twice', (s) => {
      const entry = { keyId: VECTOR_KEYS.stranger.kid, pub: VECTOR_KEYS.stranger.pub, notAfter: s.issued, holder: { machine: 'mref-ghost-000001' } };
      s.retired.push(entry, structuredClone(entry));
    }],
    ['owners-unknown', (s) => (s.delegations[0].owners = ['0'.repeat(32)])],
  ];
  for (const [code, edit] of composed) {
    it(`${code}: composed on v3`, async () => {
      const state = structuredClone(v3());
      edit(state);
      expect(isOrgState(state)).toBe(true);
      expect((await stateProblems(state)).map((p) => p.code)).toContain(code);
      expect(await stateInvariants(state)).toBe(false);
      // The same rule, named as a successor's problem.
      expect(await codes(signedFixture('v2').state, await next(signedFixture('v2').state, (s) => Object.assign(s, structuredClone(state), { version: s.version, prev: s.prev })))).toContain(code);
    });
  }

  it('names the holder: owners-unknown names the machine or delegation, revives-revoked the key', async () => {
    const state = structuredClone(v3());
    state.machines[0].owners = ['0'.repeat(32)];
    const problems = await stateProblems(state);
    expect(problems.find((p) => p.code === 'owners-unknown')?.detail).toContain(state.machines[0].name);
    const revived = caseNamed("a successor revoking a machine's key it keeps").args.map(resolve) as [SignedOrgState, SignedOrgState];
    const named = (await successorProblems(revived[0].state, revived[1].state)).find((p) => p.code === 'revives-revoked');
    expect(named?.detail).toContain(VECTOR_KEYS.mini.kid);
  });

  it('a shape problem is named alone: nothing past the shape is judged', async () => {
    const [head, nextState] = caseNamed('a successor with a lone surrogate').args.map(resolve) as [SignedOrgState, SignedOrgState];
    expect(await codes(head.state, nextState.state)).toEqual(['shape']);
    expect(await codes(head.state, { ...head.state, members: 'none' } as unknown as OrgState)).toEqual(['shape']);
  });
});

describe('endorsing', () => {
  // v2 lists B with one Mac; B's second Mac arrives with no endorsement, as the signer endorses it inside the same
  // Touch ID that signs the state.
  const v2 = () => signedFixture('v2').state;
  const b2 = { id: 'dev-b2', class: 'native-mac' as const, keyStorage: 'software' as const, channelPub: VECTOR_KEYS.b2Channel.pub, stepUpPub: VECTOR_KEYS.b2StepUp.pub };
  const withB2 = () => next(v2(), (s) => s.members.find((m) => m.devices.some((d) => d.id === 'dev-b1'))!.devices.push({ ...b2 }));

  it('counts a named device as endorsed by one of its member\'s own step-up keys', async () => {
    expect(await codes(v2(), await withB2())).toEqual(['endorsement-missing']);
    expect(await codes(v2(), await withB2(), { endorsing: { kid: VECTOR_KEYS.b1StepUp.kid, devices: ['dev-b2'] } })).toEqual([]);
  });

  it('refuses another member\'s key, the member\'s channel key, a key outside the state, and a device it does not name', async () => {
    for (const kid of [VECTOR_KEYS.a1StepUp.kid, VECTOR_KEYS.b1Channel.kid, VECTOR_KEYS.stranger.kid]) {
      expect(await codes(v2(), await withB2(), { endorsing: { kid, devices: ['dev-b2'] } }), kid).toEqual(['endorsement-missing']);
    }
    expect(await codes(v2(), await withB2(), { endorsing: { kid: VECTOR_KEYS.b1StepUp.kid, devices: ['dev-b3'] } })).toEqual(['endorsement-missing']);
  });

  it('needs no endorsement for a member\'s first device', async () => {
    const first = await next(v2(), (s) => s.members.push({ id: 'c'.repeat(32), email: 'c@example.com', role: 'member', devices: [{ ...b2, id: 'dev-c1' }] }));
    expect(await codes(v2(), first)).toEqual([]);
  });
});

describe('email-grammar', () => {
  // v2 lists A and B. An email is judged where a successor writes it, a member's new or changed, and nowhere it is read.
  const v2 = () => signedFixture('v2').state;
  const newcomer = (email: string) => (s: OrgState) => void s.members.push({ id: 'c'.repeat(32), email, role: 'member', devices: [] });

  it("isMemberEmail takes an address in the app hub client's grammar, and nothing else", () => {
    for (const email of ['a@b', 'Ana.Lopez+tag@Example.COM', 'ü@例え.jp', `${'x'.repeat(64)}@${'y'.repeat(253)}`]) expect(isMemberEmail(email), email).toBe(true);
    const refused = ['', 'no-at', '@b', 'a@', 'a@b@c', ' a@b', 'a@b ', 'a b@c', 'a@b\nc', 'a\u0000@b', 'a\u0085@b', `${'x'.repeat(65)}@b`, `a@${'y'.repeat(254)}`, 7, null];
    for (const email of refused) expect(isMemberEmail(email), JSON.stringify(email)).toBe(false);
  });

  it("names a new member's email outside it, and a changed one, naming the member and the email", async () => {
    expect(await codes(v2(), await next(v2(), newcomer('c@example.com')))).toEqual([]);
    const added = await successorProblems(v2(), await next(v2(), newcomer('c at example.com')));
    expect(added).toEqual([{ code: 'email-grammar', detail: expect.stringContaining(`member ${'c'.repeat(32)}'s email "c at example.com"`) as string }]);
    expect(await codes(v2(), await next(v2(), (s) => (s.members[1].email = `${s.members[1].email} `)))).toEqual(['email-grammar']);
  });

  it("never judges an unchanged member's: a head holding one is followed, and fixed, without it", async () => {
    const legacy = structuredClone(v2());
    legacy.members[1].email = 'b at example.com';
    expect(await codes(legacy, await next(legacy, (s) => s.projects.push({ id: 'proj-later', name: 'later' })))).toEqual([]);
    expect(await codes(legacy, await next(legacy, (s) => (s.members[1].email = 'b@example.com')))).toEqual([]);
  });

  it("stays the writer's rule: isOrgState and verifySuccessor take the same successor once signed", async () => {
    const head = signedFixture('v2');
    const state = await next(head.state, newcomer('c at example.com'));
    expect(isOrgState(state)).toBe(true);
    const signed = await signOrgState(state, [await importSigningKey(VECTOR_KEYS.a1StepUp.jwk)]);
    expect(await verifySuccessor(head, signed, [])).toEqual({ ok: true });
  });
});

describe('an adversarial state, before any signature is checked', () => {
  // verifySuccessor judges the whole state before the root signature, so what it costs to judge one is open to anyone
  // who can hand a verifier an envelope: the hub, an endpoint and the app alike. Many copies of one delegation make
  // every pairwise rule fire for every pair.
  const N = 120;
  const flooded = async () => {
    const v2 = signedFixture('v2');
    const state = await next(v2.state, (s) => (s.delegations = Array.from({ length: N }, () => structuredClone(s.delegations[0]))));
    // A stale signature (v3's): the verdict must come from the state, as before, and cheaply.
    return { head: v2, signed: { state, sigs: signedFixture('v3').sigs } as SignedOrgState };
  };

  it('is refused malformed, as before', async () => {
    const { head, signed } = await flooded();
    expect(isOrgState(signed.state)).toBe(true);
    expect(await verifySuccessor(head, signed, [])).toEqual({ ok: false, code: 'malformed' });
  });

  it('stops at its first problem, building no detail, when only the verdict is asked for', async () => {
    const { signed } = await flooded();
    let details = 0;
    expect(await stateProblems(signed.state, { first: true, onDetail: () => details++ })).toHaveLength(1);
    expect(details).toBe(0);
    expect(await stateInvariants(signed.state)).toBe(false);
  });

  it('keeps at most PROBLEMS_PER_CODE problems per code in the full diagnostics, and builds no detail past that', async () => {
    const { head, signed } = await flooded();
    const judges = [
      (onDetail: () => void) => stateProblems(signed.state, { onDetail }),
      (onDetail: () => void) => successorProblems(head.state, signed.state, { onDetail }),
    ];
    for (const judge of judges) {
      let details = 0;
      const found = await judge(() => details++);
      const perCode = new Map<string, number>();
      for (const p of found) perCode.set(p.code, (perCode.get(p.code) ?? 0) + 1);
      for (const [code, count] of perCode) expect(count, code).toBeLessThanOrEqual(PROBLEMS_PER_CODE);
      // The pairwise rule fired for every pair (N·(N−1)/2 of them) yet reported only up to its cap.
      expect(perCode.get('prefix-overlaps')).toBe(PROBLEMS_PER_CODE);
      expect(details).toBe(found.length);
    }
  });
});

describe('stateInvariants and stateProblems', () => {
  /** Every org state the vectors hold, at any depth of a fixture or a case's arguments. */
  function statesIn(value: unknown, into: OrgState[], seen: Set<unknown>): void {
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    seen.add(value);
    if (isOrgState(value)) into.push(value);
    for (const child of Array.isArray(value) ? value : Object.values(value)) statesIn(child, into, seen);
  }

  it('agree on every vector', async () => {
    const states: OrgState[] = [];
    const seen = new Set<unknown>();
    statesIn(VECTORS.fixtures, states, seen);
    for (const c of VECTORS.cases) statesIn(c.args.map(resolve), states, seen);
    const verdicts = await Promise.all(states.map(async (s) => [await stateInvariants(s), (await stateProblems(s)).length === 0]));
    expect(verdicts.filter(([held, none]) => held !== none)).toEqual([]);
    // Both outcomes occur, so the agreement is not vacuous.
    expect(verdicts.filter(([held]) => held).length).toBeGreaterThan(50);
    expect(verdicts.filter(([held]) => !held).length).toBeGreaterThan(30);
  });
});
