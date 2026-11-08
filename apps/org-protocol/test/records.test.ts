// A grant's eligibility (P5 O8 M4b, "Grants"): `grantProblems` judges an unsigned grant before anything is signed,
// by everything `verifyGrant` checks but the signature itself: the machine listed or certified, `machineKey` its
// current uncontested key, the member listed, the rights known, and the signer's kid a step-up key of an owner's device
// (an admin's when the org owns the machine). Proved over the package's vectors, whose verdicts are the oracle, and by
// one case per problem.
import { describe, expect, it } from 'vitest';
import { importSigningKey } from '../src/keys.ts';
import { grantProblems, NO_CERTIFICATES, signRecord, verifyGrant, type GrantProblemCode } from '../src/records.ts';
import { SIGNING_DOMAINS, type Certificates, type Grant, type OrgState, type Signed, type SignedOrgState } from '../src/types.ts';
import { A, B, ORG, REF_MINI, REF_VM1, REF_VM_BUILD, VECTOR_KEYS, VECTORS, type KeyName } from '../vectors/index.ts';

const NOW = new Date('2026-10-28T00:00:00.000Z');
const state = (name: string) => (VECTORS.fixtures[name] as SignedOrgState).state;
const fixture = <T>(name: string) => VECTORS.fixtures[name] as T;
const kid = (name: KeyName) => VECTOR_KEYS[name].kid;
const V2 = state('v2');

/** The scenario's grant: Bob may spawn on Alice's `mini`. */
const draft = (edit: Partial<Grant> = {}): Grant => ({ org: ORG, machine: REF_MINI, machineKey: kid('mini'), member: B, rights: ['spawn'], version: 1, issued: '2026-10-21T00:00:00.000Z', ...edit });
const vm1 = (certs: string[]): Certificates => ({ certs: certs.map((c) => fixture<Certificates['certs'][number]>(c)), retirements: [] });
const codes = async (s: OrgState, body: unknown, signer: KeyName | string, certs: Certificates = NO_CERTIFICATES): Promise<GrantProblemCode[]> =>
  (await grantProblems(s, certs, body as Grant, signer in VECTOR_KEYS ? kid(signer as KeyName) : signer, NOW)).map((p) => p.code);

/** A vector argument with its `{$state}` and `{$fixture}` references resolved, as the replay does. */
function resolve(arg: unknown): unknown {
  if (Array.isArray(arg)) return arg.map(resolve);
  if (typeof arg !== 'object' || arg === null) return arg;
  const ref = arg as Record<string, unknown>;
  const name = ref.$state ?? ref.$fixture;
  if (typeof name !== 'string' || Object.keys(ref).length !== 1) return Object.fromEntries(Object.entries(ref).map(([k, v]) => [k, resolve(v)]));
  const value = VECTORS.fixtures[name];
  return '$state' in ref ? (value as SignedOrgState).state : value;
}

describe("grantProblems against the vectors' grants", () => {
  const grants = VECTORS.cases.filter((c) => c.call === 'verifyGrant');

  it('finds nothing in a grant verifyGrant accepts or refuses only for its signature, and something in every other', async () => {
    expect(grants.length).toBeGreaterThan(10);
    for (const c of grants) {
      const [s, g, certs, now] = c.args.map(resolve) as [OrgState, Signed<Grant>, Certificates | undefined, string | undefined];
      const verdict = c.expect as { ok: boolean; code?: string };
      const problems = await grantProblems(s, certs ?? NO_CERTIFICATES, g.body, g.sig.kid, now === undefined ? new Date() : new Date(now));
      expect(problems.length === 0, c.name).toBe(verdict.ok || verdict.code === 'bad-signature');
    }
  });
});

describe('grantProblems', () => {
  it("passes an owner's unsigned draft, and an admin's on a machine the org owns", async () => {
    expect(await codes(V2, draft(), 'a1StepUp')).toEqual([]);
    expect(await codes(V2, draft({ machine: REF_VM_BUILD, machineKey: kid('vmBuild'), rights: ['spawn', 'shell', 'machine-admin'] }), 'a1StepUp')).toEqual([]);
    expect(await codes(V2, draft({ machine: REF_VM1, machineKey: kid('vm1') }), 'a1StepUp', vm1(['cert vm-1']))).toEqual([]);
    // A withdrawal is a grant with no rights.
    expect(await codes(V2, draft({ rights: [] }), 'a1StepUp')).toEqual([]);
  });

  it('refuses a member who is not an admin on a machine the org owns, and an admin on a machine members own', async () => {
    expect(await codes(V2, draft({ machine: REF_VM_BUILD, machineKey: kid('vmBuild') }), 'b1StepUp')).toEqual(['signer-not-owner']);
    const bobs = structuredClone(V2);
    bobs.machines.find((m) => m.ref === REF_MINI)!.owners = [B];
    expect(await codes(bobs, draft(), 'a1StepUp')).toEqual(['signer-not-owner']);
    expect(await codes(bobs, draft(), 'b1StepUp')).toEqual([]);
  });

  it.each<[string, () => Promise<GrantProblemCode[]>, GrantProblemCode[]]>([
    ['a body that is not a grant', () => codes(V2, { ...draft(), extra: 1 }, 'a1StepUp'), ['malformed']],
    ['an unknown right', () => codes(V2, draft({ rights: ['root' as Grant['rights'][number]] }), 'a1StepUp'), ['unknown-rights']],
    ['a right named twice', () => codes(V2, draft({ rights: ['spawn', 'spawn'] }), 'a1StepUp'), ['unknown-rights']],
    // A sparse list passes the shape's walk, which skips the hole, but no signature covers it: canonicalize refuses it.
    ['rights with a hole', () => codes(V2, draft({ rights: new Array(1) }), 'a1StepUp'), ['malformed']],
    ['certificates that are not a set', () => grantProblems(V2, { certs: 'none' } as unknown as Certificates, draft(), kid('a1StepUp'), NOW).then((ps) => ps.map((p) => p.code)), ['malformed']],
    ["another org's grant", () => codes(V2, draft({ org: 'org-other' }), 'a1StepUp'), ['other-org']],
    ['a member the state does not list', () => codes(V2, draft({ member: 'ffffffffffffffffffffffffffffffff' }), 'a1StepUp'), ['member-not-listed']],
    ['a machine neither listed nor certified', () => codes(V2, draft({ machine: 'mref-ghost-000001' }), 'a1StepUp'), ['machine-not-listed']],
    ['a certified machine without its certificate', () => codes(V2, draft({ machine: REF_VM1, machineKey: kid('vm1') }), 'a1StepUp'), ['machine-not-listed']],
    ["a key that is not the machine's current one", () => codes(V2, draft({ machineKey: kid('miniRotated') }), 'a1StepUp'), ['machine-key-not-current']],
    ["a certified machine's other key", () => codes(V2, draft({ machine: REF_VM1, machineKey: kid('vm1Rival') }), 'a1StepUp', vm1(['cert vm-1'])), ['machine-key-not-current']],
    ['a machine whose ref two certificates contest', () => codes(V2, draft({ machine: REF_VM1, machineKey: kid('vm1') }), 'a1StepUp', vm1(['cert vm-1', 'cert vm-1 rival'])), ['machine-contested']],
    ["an owner's channel key", () => codes(V2, draft(), 'a1Channel'), ['signer-not-owner']],
    ['a member who does not own the machine', () => codes(V2, draft(), 'b1StepUp'), ['signer-not-owner']],
    ['a key the state never listed', () => codes(V2, draft(), 'stranger'), ['signer-not-owner']],
    ["a revoked device's key", () => codes(state('v4 b1 revoked'), draft({ member: A }), 'b1StepUp'), ['signer-revoked']],
  ])('names %s', async (_label, run, expected) => {
    expect(await run()).toEqual(expected);
  });

  it("names each problem a draft has, in verifyGrant's order", async () => {
    expect(await codes(V2, draft({ org: 'org-other', member: 'ffffffffffffffffffffffffffffffff', machineKey: kid('miniRotated') }), 'b1StepUp')).toEqual([
      'other-org',
      'member-not-listed',
      'machine-key-not-current',
      'signer-not-owner',
    ]);
  });
});

describe('verifyGrant, built on grantProblems', () => {
  const sign = async (body: Grant, signer: KeyName) => {
    const key = await importSigningKey(VECTOR_KEYS[signer].jwk);
    return signRecord(SIGNING_DOMAINS.grant, body, key.privateKey, key.pub);
  };

  it("reads each problem as its verdict: the first one's", async () => {
    expect(await verifyGrant(V2, await sign(draft(), 'a1StepUp'))).toEqual({ ok: true });
    expect(await verifyGrant(V2, await sign(draft({ rights: ['root' as Grant['rights'][number]] }), 'a1StepUp'))).toEqual({ ok: false, code: 'malformed' });
    expect(await verifyGrant(V2, await sign(draft({ org: 'org-other', member: 'ffffffffffffffffffffffffffffffff' }), 'a1StepUp'))).toEqual({ ok: false, code: 'malformed' });
    expect(await verifyGrant(V2, await sign(draft({ member: 'ffffffffffffffffffffffffffffffff' }), 'b1StepUp'))).toEqual({ ok: false, code: 'not-listed' });
    expect(await verifyGrant(V2, await sign(draft({ machine: REF_VM1, machineKey: kid('vm1') }), 'a1StepUp'), vm1(['cert vm-1', 'cert vm-1 rival']), NOW)).toEqual({ ok: false, code: 'contested' });
    expect(await verifyGrant(V2, await sign(draft({ machineKey: kid('miniRotated') }), 'b1StepUp'))).toEqual({ ok: false, code: 'not-listed' });
    expect(await verifyGrant(state('v4 b1 revoked'), await sign(draft({ member: A }), 'b1StepUp'))).toEqual({ ok: false, code: 'revoked' });
  });
});
