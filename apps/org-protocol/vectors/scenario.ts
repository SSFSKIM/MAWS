// The vectors' scenario: one org's chain from genesis through a second device, a promotion, a removal and a recovery,
// with the records and log events signed beside it, and each case's expected verdict. generate.ts runs it with fresh
// keys and writes the JSON the consumers replay; the package's suites also run it with keys of their own, so every
// expectation holds for any keys, not only the committed ones.
import { base64urlEncode } from '../src/base64url.ts';
import { canonicalize } from '../src/canonical.ts';
import { signEvent } from '../src/events.ts';
import { keyId, type B64, type SigningKey } from '../src/keys.ts';
import { endorseDevice, signOrgState, signTransition, stateHash } from '../src/org-state.ts';
import { signRecord } from '../src/records.ts';
import { SIGNING_DOMAINS, type Device, type EndpointRecord, type Grant, type Listing, type MachineCert, type OrgState, type RootTransition, type Signed, type SignedOrgState } from '../src/types.ts';
import type { Verdict } from '../src/verdict.ts';

/** Every key the scenario signs with, by role. */
export const KEY_NAMES = [
  'a1Channel', 'a1StepUp', // A's first Mac
  'a3Channel', 'a3StepUp', // A's Mac after recovery
  'aPhone', // A's phone (web-cards)
  'b1Channel', 'b1StepUp', // B's first Mac
  'b2Channel', 'b2StepUp', // B's second Mac
  'recovery', // the org's offline recovery key
  'mini', 'vmBuild', // machines the state lists
  'delegation', 'vm1', // a delegation and the VM it certifies
  'stranger', // a key the org never listed
] as const;
export type KeyName = (typeof KEY_NAMES)[number];
export type Keys = Record<KeyName, SigningKey>;

/** A reference into `fixtures`: a signed state, its `state`, or any other fixture as it stands. */
export type Ref = { $signed: string } | { $state: string } | { $fixture: string };
export type Arg = Ref | string | number | null | Arg[] | Record<string, unknown>;

export type Case = {
  name: string;
  call: 'verifyGenesis' | 'verifySuccessor' | 'verifyTransition' | 'verifyGrant' | 'verifyMachineCert' | 'verifyListing' | 'verifyEndpointRecord' | 'verifyEvent' | 'signerFor';
  args: Arg[];
  expect: Verdict | { keys: string[] };
};
export type DualCase = { name: string; org: string; project: string; orgKey: string; event: Record<string, unknown> };
export type Encodings = {
  kids: Array<{ pub: B64; kid: string }>;
  stateHashes: Array<{ state: { $state: string }; hash: B64 }>;
  inputs: Array<{ domain: string; body: unknown; input: string }>;
};
export type VectorSet = { fixtures: Record<string, unknown>; cases: Case[]; dual: DualCase[]; encodings: Encodings };

export const ORG = 'org-vectors';
export const PROJECT = 'proj-1';
export const A = '0a1b2c3d4e5f60718293a4b5c6d7e8f9';
export const B = 'f9e8d7c6b5a4938271605f4e3d2c1b0a';
const NOW = '2026-10-28T00:00:00.000Z';
const LATER = '2026-12-01T00:00:00.000Z';
const at = (hour: number) => `2026-10-27T${String(hour).padStart(2, '0')}:00:00.000Z`;

const signed = (name: string): Ref => ({ $signed: name });
const stateOf = (name: string): Ref => ({ $state: name });
const fixture = (name: string): Ref => ({ $fixture: name });
const ok = (): Verdict => ({ ok: true });
const no = (code: Exclude<Verdict, { ok: true }>['code']): Verdict => ({ ok: false, code });
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const withoutEndorsement = (device: Device): Device => {
  const bare = { ...device };
  delete bare.endorsement;
  return bare;
};

export async function buildScenario(k: Keys): Promise<VectorSet> {
  const fixtures: Record<string, unknown> = {};
  const cases: Case[] = [];
  const kid = (name: KeyName) => keyId(k[name].pub);
  const sign = (state: OrgState, ...by: KeyName[]) => signOrgState(state, by.map((n) => k[n]));
  const keep = (name: string, value: unknown) => {
    fixtures[name] = value;
    return value;
  };
  const mac = (id: string, channel: KeyName, stepUp: KeyName): Device => ({ id, class: 'native-mac', keyStorage: 'software', channelPub: k[channel].pub, stepUpPub: k[stepUp].pub });
  const next = async (head: SignedOrgState, edit: (s: OrgState) => void, hour: number): Promise<OrgState> => {
    const s = clone(head.state);
    s.version += 1;
    s.prev = await stateHash(head.state);
    s.issued = at(hour);
    edit(s);
    return s;
  };

  // Genesis: A, the admin, with one Mac, which is the root.
  const a1 = mac('dev-a1', 'a1Channel', 'a1StepUp');
  const genesisState: OrgState = {
    org: ORG,
    version: 1,
    prev: null,
    issued: at(0),
    root: { keys: [await kid('a1StepUp')], recoveryPub: k.recovery.pub },
    members: [{ id: A, email: 'a@example.com', role: 'admin', devices: [a1] }],
    machines: [],
    delegations: [],
    projects: [],
  };
  const g1 = (await sign(genesisState, 'a1StepUp')) as SignedOrgState;
  keep('g1', g1);
  cases.push({ name: 'genesis signed by its own root', call: 'verifyGenesis', args: [signed('g1')], expect: ok() });
  const genesisVariant = async (name: string, edit: (s: OrgState) => void, by: KeyName, expect: Verdict) => {
    const s = clone(genesisState);
    edit(s);
    keep(name, await sign(s, by));
    cases.push({ name, call: 'verifyGenesis', args: [signed(name)], expect });
  };
  await genesisVariant('genesis signed by a key outside its root', () => {}, 'stranger', no('not-root-signed'));
  await genesisVariant('genesis at version 2', (s) => (s.version = 2), 'a1StepUp', no('malformed'));
  await genesisVariant('genesis with a prev', (s) => (s.prev = base64urlEncode(new Uint8Array(32))), 'a1StepUp', no('bad-link'));
  const channelRoot = await kid('a1Channel');
  await genesisVariant('genesis whose root names a channel key', (s) => (s.root.keys = [channelRoot]), 'a1Channel', no('malformed'));
  await genesisVariant('genesis with an empty root', (s) => (s.root.keys = []), 'a1StepUp', no('malformed'));
  await genesisVariant(
    'genesis whose web-cards device holds a step-up key',
    (s) => s.members[0].devices.push({ id: 'dev-phone', class: 'web-cards', keyStorage: 'webcrypto', channelPub: k.aPhone.pub, stepUpPub: k.stranger.pub }),
    'a1StepUp',
    no('malformed'),
  );
  await genesisVariant(
    'genesis with two members of one email',
    (s) => s.members.push({ id: B, email: 'A@example.com', role: 'member', devices: [] }),
    'a1StepUp',
    no('malformed'),
  );
  await genesisVariant(
    'genesis with a machine owned by a non-member',
    (s) => s.machines.push({ name: 'mini', pub: k.mini.pub, owners: [B] }),
    'a1StepUp',
    no('malformed'),
  );
  await genesisVariant('genesis with an unknown field', (s) => Object.assign(s, { extra: true }), 'a1StepUp', no('malformed'));

  // v2: B joins with a first device (no endorsement); A adds a phone (endorsed by A's Mac); machines, a delegation and
  // a project are listed.
  const phone: Device = {
    id: 'dev-a-phone',
    class: 'web-cards',
    keyStorage: 'webcrypto',
    channelPub: k.aPhone.pub,
    passkey: { credentialId: base64urlEncode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), publicKey: base64urlEncode(new Uint8Array(77).fill(9)), rpId: 'desk.example' },
  };
  phone.endorsement = await endorseDevice(ORG, A, phone, k.a1StepUp.privateKey, k.a1StepUp.pub);
  const b1 = mac('dev-b1', 'b1Channel', 'b1StepUp');
  const v2State = await next(g1, (s) => {
    s.members[0].devices.push(phone);
    s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1] });
    s.machines.push({ name: 'mini', pub: k.mini.pub, owners: [A] }, { name: 'vm-build', pub: k.vmBuild.pub, owners: 'org' });
    s.delegations.push({ id: 'dlg-vm', pub: k.delegation.pub, prefix: 'vm-', expires: '2026-11-27T00:00:00.000Z', maxUses: 3, offlineRevokeS: 3600, owners: 'org' });
    s.projects.push({ id: PROJECT, name: 'one' });
  }, 1);
  const v2 = await sign(v2State, 'a1StepUp');
  keep('v2', v2);
  cases.push({ name: 'a successor adding a member, an endorsed phone, machines and a delegation', call: 'verifySuccessor', args: [signed('g1'), signed('v2'), []], expect: ok() });
  const phoneUnendorsed = await next(g1, (s) => s.members[0].devices.push(withoutEndorsement(phone)), 1);
  keep('v2 phone without endorsement', await sign(phoneUnendorsed, 'a1StepUp'));
  cases.push({ name: 'a new device of a member with devices, unendorsed', call: 'verifySuccessor', args: [signed('g1'), signed('v2 phone without endorsement'), []], expect: no('endorsement-missing') });

  // v3: B's second Mac, endorsed by B's first and countersigned by the admin.
  const b2 = mac('dev-b2', 'b2Channel', 'b2StepUp');
  const b2Endorsed: Device = { ...b2, endorsement: await endorseDevice(ORG, B, b2, k.b1StepUp.privateKey, k.b1StepUp.pub) };
  const withB2 = (device: Device) => next(v2, (s) => s.members[1].devices.push(device), 2);
  keep('v3', await sign(await withB2(b2Endorsed), 'a1StepUp'));
  cases.push({ name: "a member's second device, endorsed by their first and countersigned by an admin", call: 'verifySuccessor', args: [signed('v2'), signed('v3'), []], expect: ok() });
  const successorCase = async (name: string, state: OrgState, by: KeyName[], expect: Verdict, head = 'v2', transitions: Arg[] = []) => {
    keep(name, await sign(state, ...by));
    cases.push({ name, call: 'verifySuccessor', args: [signed(head), signed(name), transitions], expect });
  };
  await successorCase('a second device without an endorsement', await withB2(b2), ['a1StepUp'], no('endorsement-missing'));
  await successorCase(
    'a second device whose channel key changed after its endorsement',
    await withB2({ ...b2Endorsed, channelPub: k.stranger.pub }),
    ['a1StepUp'],
    no('bad-signature'),
  );
  await successorCase(
    'a second device whose key storage changed after its endorsement',
    await withB2({ ...b2Endorsed, keyStorage: 'enclave' }),
    ['a1StepUp'],
    no('bad-signature'),
  );
  await successorCase(
    "a second device endorsed by another member's device",
    await withB2({ ...b2, endorsement: await endorseDevice(ORG, B, b2, k.a1StepUp.privateKey, k.a1StepUp.pub) }),
    ['a1StepUp'],
    no('unknown-signer'),
  );
  await successorCase(
    "a second device endorsed by the member's channel key",
    await withB2({ ...b2, endorsement: await endorseDevice(ORG, B, b2, k.b1Channel.privateKey, k.b1Channel.pub) }),
    ['a1StepUp'],
    no('unknown-signer'),
  );
  await successorCase(
    'a second device endorsed for another org',
    await withB2({ ...b2, endorsement: await endorseDevice('org-other', B, b2, k.b1StepUp.privateKey, k.b1StepUp.pub) }),
    ['a1StepUp'],
    no('bad-signature'),
  );
  await successorCase('a successor signed by a member, not an admin', await withB2(b2Endorsed), ['b1StepUp'], no('not-root-signed'));
  {
    // A signature made over another state, carried onto this one.
    const other = await sign(await withB2(b2), 'a1StepUp');
    const forged: SignedOrgState = { state: await withB2(b2Endorsed), sigs: other.sigs };
    keep('a successor carrying a signature over another state', forged);
    cases.push({ name: 'a successor carrying a signature over another state', call: 'verifySuccessor', args: [signed('v2'), signed('a successor carrying a signature over another state'), []], expect: no('bad-signature') });
  }
  await successorCase('a fork at the head: another state of the head version', await next(v2, (s) => s.projects.push({ id: 'proj-2', name: 'two' }), 2), ['a1StepUp'], no('not-head'), 'v3');
  cases.push({ name: 'an older version than the head', call: 'verifySuccessor', args: [signed('v3'), signed('v2'), []], expect: no('rollback') });
  {
    const v3 = fixtures.v3 as SignedOrgState;
    keep('v4 beyond a gap', await sign(await next(v3, () => {}, 3), 'a1StepUp'));
    cases.push({ name: 'a successor two versions past the head', call: 'verifySuccessor', args: [signed('v2'), signed('v4 beyond a gap'), []], expect: no('not-head') });
  }
  {
    const s = await withB2(b2Endorsed);
    s.prev = await stateHash(g1.state);
    await successorCase('a successor whose prev is not the head', s, ['a1StepUp'], no('not-head'));
  }
  await successorCase('a successor of another org', await next(v2, (s) => (s.org = 'org-other'), 2), ['a1StepUp'], no('bad-link'));
  await successorCase('a successor that changes the recovery key', await next(v2, (s) => (s.root.recoveryPub = k.stranger.pub), 2), ['a1StepUp'], no('malformed'));
  await successorCase('a successor issued before the head', await next(v2, (s) => (s.issued = at(0)), 2), ['a1StepUp'], no('malformed'));

  // v4: B becomes an admin, and a root key; v5: B is removed, and leaves the root set.
  const v3 = fixtures.v3 as SignedOrgState;
  const b1Root = await kid('b1StepUp');
  const v4 = await sign(await next(v3, (s) => {
    s.members[1].role = 'admin';
    s.root.keys.push(b1Root);
  }, 3), 'a1StepUp');
  keep('v4', v4);
  cases.push({ name: 'a member promoted to admin and root', call: 'verifySuccessor', args: [signed('v3'), signed('v4'), []], expect: ok() });
  await successorCase('a demotion that keeps the root key', await next(v4, (s) => (s.members[1].role = 'member'), 4), ['a1StepUp'], no('malformed'), 'v4');
  const v5 = await sign(await next(v4, (s) => {
    s.members.splice(1, 1);
    s.root.keys = s.root.keys.filter((key) => key !== b1Root);
  }, 4), 'b1StepUp');
  keep('v5', v5);
  cases.push({ name: 'an admin removed, by their own root key', call: 'verifySuccessor', args: [signed('v4'), signed('v5'), []], expect: ok() });
  await successorCase("a successor signed by a removed admin's key", await next(v5, (s) => s.projects.push({ id: 'proj-3', name: 'three' }), 5), ['b1StepUp'], no('not-root-signed'), 'v5');

  // A root transition by the recovery key at v5, naming A's new Mac; the successor it authorizes replaces A's lost
  // devices with the new one, unendorsed, and takes the new root set.
  const transition: RootTransition = { org: ORG, fromVersion: 5, newRootKeys: [k.a3StepUp.pub], issued: at(5) };
  const t5 = await signTransition(transition, k.recovery.privateKey, k.recovery.pub);
  keep('t5', t5);
  cases.push({ name: 'a root transition signed by the pinned recovery key', call: 'verifyTransition', args: [signed('v5'), fixture('t5'), k.recovery.pub], expect: ok() });
  const transitionCase = async (name: string, t: Signed<RootTransition>, expect: Verdict, head = 'v5') => {
    keep(name, t);
    cases.push({ name, call: 'verifyTransition', args: [signed(head), fixture(name), k.recovery.pub], expect });
  };
  await transitionCase('a root transition signed by an admin key', await signTransition(transition, k.a1StepUp.privateKey, k.a1StepUp.pub), no('unknown-signer'));
  await transitionCase('a root transition whose new keys changed after signing', { body: { ...transition, newRootKeys: [k.stranger.pub] }, sig: t5.sig }, no('bad-signature'));
  await transitionCase('a root transition against an older version', await signTransition({ ...transition, fromVersion: 4 }, k.recovery.privateKey, k.recovery.pub), no('rollback'));
  await transitionCase('a root transition against a later version', await signTransition({ ...transition, fromVersion: 6 }, k.recovery.privateKey, k.recovery.pub), no('not-head'));
  await transitionCase('a root transition of another org', await signTransition({ ...transition, org: 'org-other' }, k.recovery.privateKey, k.recovery.pub), no('bad-link'));

  const a3 = mac('dev-a3', 'a3Channel', 'a3StepUp');
  const a3Root = await kid('a3StepUp');
  const recovered = await next(v5, (s) => {
    s.members[0].devices = [a3];
    s.root.keys = [a3Root];
  }, 6);
  await successorCase('the successor a root transition authorizes', recovered, ['a3StepUp'], ok(), 'v5', [fixture('t5')]);
  keep('v6', fixtures['the successor a root transition authorizes']);
  await successorCase('the same successor without the transition', recovered, ['a3StepUp'], no('not-root-signed'), 'v5');
  await successorCase(
    'a successor signed by the old root while a transition is held',
    await next(v5, (s) => s.projects.push({ id: 'proj-3', name: 'three' }), 6),
    ['a1StepUp'],
    no('not-root-signed'),
    'v5',
    [fixture('t5')],
  );
  await successorCase(
    "a successor after a transition that keeps the old root key",
    await next(v5, (s) => {
      s.members[0].devices = [s.members[0].devices[0], a3];
      s.root.keys = [s.root.keys[0], a3Root];
    }, 6),
    ['a3StepUp'],
    no('malformed'),
    'v5',
    [fixture('t5')],
  );
  {
    const bogus = await signTransition(transition, k.stranger.privateKey, k.stranger.pub);
    keep('t5 by a stranger', bogus);
    await successorCase(
      'a successor by the old root, beside a transition that fails to verify',
      await next(v5, (s) => s.projects.push({ id: 'proj-3', name: 'three' }), 6),
      ['a1StepUp'],
      ok(),
      'v5',
      [fixture('t5 by a stranger')],
    );
  }
  cases.push({ name: 'a rollback after a transition', call: 'verifySuccessor', args: [signed('v6'), signed('v5'), [fixture('t5')]], expect: no('rollback') });

  // Records against v2: a grant, a VM's certificate, listings and endpoint records.
  const grant: Grant = { org: ORG, machine: 'mini', member: B, rights: ['spawn'], version: 1, issued: at(2) };
  const recordCase = async (name: string, call: Case['call'], record: unknown, expect: Verdict, extra: Arg[] = [], state = 'v2') => {
    keep(name, record);
    cases.push({ name, call, args: [stateOf(state), fixture(name), ...extra], expect });
  };
  await recordCase('a grant signed by the machine owner', 'verifyGrant', await signRecord(SIGNING_DOMAINS.grant, grant, k.a1StepUp.privateKey, k.a1StepUp.pub), ok());
  await recordCase("a grant signed by the owner's channel key", 'verifyGrant', await signRecord(SIGNING_DOMAINS.grant, grant, k.a1Channel.privateKey, k.a1Channel.pub), no('unknown-signer'));
  await recordCase('a grant signed by a member who does not own the machine', 'verifyGrant', await signRecord(SIGNING_DOMAINS.grant, grant, k.b1StepUp.privateKey, k.b1StepUp.pub), no('unknown-signer'));
  await recordCase(
    'a grant on an org-owned machine, signed by an admin',
    'verifyGrant',
    await signRecord(SIGNING_DOMAINS.grant, { ...grant, machine: 'vm-build' }, k.a1StepUp.privateKey, k.a1StepUp.pub),
    ok(),
  );
  await recordCase('a grant on an unlisted machine', 'verifyGrant', await signRecord(SIGNING_DOMAINS.grant, { ...grant, machine: 'ghost' }, k.a1StepUp.privateKey, k.a1StepUp.pub), no('not-listed'));
  {
    const g = await signRecord(SIGNING_DOMAINS.grant, grant, k.a1StepUp.privateKey, k.a1StepUp.pub);
    await recordCase('a grant whose rights changed after signing', 'verifyGrant', { body: { ...grant, rights: ['spawn', 'shell'] }, sig: g.sig }, no('bad-signature'));
  }

  const certBody: MachineCert = { org: ORG, machine: 'vm-1', pub: k.vm1.pub, delegation: 'dlg-vm', use: 1, issued: at(3) };
  const cert = await signRecord(SIGNING_DOMAINS.machineCert, certBody, k.delegation.privateKey, k.delegation.pub);
  const certCase = (name: string, record: unknown, expect: Verdict, now = NOW, state = 'v2') => recordCase(name, 'verifyMachineCert', record, expect, [now], state);
  await certCase('a machine certificate under a live delegation', cert, ok());
  keep('cert vm-1', cert);
  const v2NoDelegation = clone(v2State);
  v2NoDelegation.delegations = [];
  keep('v2 without the delegation', { state: v2NoDelegation, sigs: [] });
  await certCase('a machine certificate after its delegation is removed', cert, no('not-listed'), NOW, 'v2 without the delegation');
  await certCase('a machine certificate after its delegation expires', cert, no('expired'), LATER);
  await certCase('a machine certificate past its delegation\'s uses', await signRecord(SIGNING_DOMAINS.machineCert, { ...certBody, use: 4 }, k.delegation.privateKey, k.delegation.pub), no('expired'));
  await certCase('a machine certificate outside the prefix', await signRecord(SIGNING_DOMAINS.machineCert, { ...certBody, machine: 'box-1' }, k.delegation.privateKey, k.delegation.pub), no('unknown-signer'));
  await certCase('a machine certificate for a listed machine', await signRecord(SIGNING_DOMAINS.machineCert, { ...certBody, machine: 'VM-Build' }, k.delegation.privateKey, k.delegation.pub), no('unknown-signer'));
  await certCase('a machine certificate signed by another key', await signRecord(SIGNING_DOMAINS.machineCert, certBody, k.stranger.privateKey, k.stranger.pub), no('unknown-signer'));
  await certCase('a machine certificate whose key changed after signing', { body: { ...certBody, pub: k.stranger.pub }, sig: cert.sig }, no('bad-signature'));

  const listing: Listing = { org: ORG, machine: 'mini', session: 'b1f0c3a2-5d6e-4f70-8a9b-0c1d2e3f4a5b', revision: 1, issued: at(3), fields: { owners: [A], project: PROJECT, lane: 'B', state: 'waiting', title: 'fix the build' } };
  const vmListing: Listing = { ...listing, machine: 'vm-1', fields: { ...listing.fields, owners: [A, B] } };
  const certs = [fixture('cert vm-1')];
  const listingCase = (name: string, record: unknown, expect: Verdict, withCerts: Arg[] = [], state = 'v2') => recordCase(name, 'verifyListing', record, expect, [withCerts, NOW], state);
  const mini = await signRecord(SIGNING_DOMAINS.listing, listing, k.mini.privateKey, k.mini.pub);
  await listingCase('a listing signed by its listed machine', mini, ok());
  await listingCase('a listing signed by a certified VM', await signRecord(SIGNING_DOMAINS.listing, vmListing, k.vm1.privateKey, k.vm1.pub), ok(), certs);
  await listingCase("a VM's listing without its certificate", await signRecord(SIGNING_DOMAINS.listing, vmListing, k.vm1.privateKey, k.vm1.pub), no('not-listed'));
  await listingCase("a VM's listing after its delegation is removed", await signRecord(SIGNING_DOMAINS.listing, vmListing, k.vm1.privateKey, k.vm1.pub), no('not-listed'), certs, 'v2 without the delegation');
  await listingCase('a listing of a listed machine signed by another key', await signRecord(SIGNING_DOMAINS.listing, listing, k.stranger.privateKey, k.stranger.pub), no('unknown-signer'));
  await listingCase('a listing whose title changed after signing', { body: { ...listing, fields: { ...listing.fields, title: 'rm -rf' } }, sig: mini.sig }, no('bad-signature'));
  await listingCase(
    'a listing naming @machine as an owner',
    await signRecord(SIGNING_DOMAINS.listing, { ...listing, fields: { ...listing.fields, owners: ['@machine'] } }, k.mini.privateKey, k.mini.pub),
    no('malformed'),
  );
  await listingCase('a listing of an unlisted machine', await signRecord(SIGNING_DOMAINS.listing, { ...listing, machine: 'ghost' }, k.mini.privateKey, k.mini.pub), no('not-listed'));

  const endpoint: EndpointRecord = { org: ORG, machine: 'mini', addresses: ['wss://100.64.0.7:7420'], issued: at(3) };
  const endpointCase = (name: string, record: unknown, expect: Verdict, withCerts: Arg[] = [], state = 'v2') => recordCase(name, 'verifyEndpointRecord', record, expect, [withCerts, NOW], state);
  const miniEndpoint = await signRecord(SIGNING_DOMAINS.endpoint, endpoint, k.mini.privateKey, k.mini.pub);
  await endpointCase('an endpoint record signed by its listed machine', miniEndpoint, ok());
  await endpointCase('an endpoint record signed by a certified VM', await signRecord(SIGNING_DOMAINS.endpoint, { ...endpoint, machine: 'vm-1' }, k.vm1.privateKey, k.vm1.pub), ok(), certs);
  await endpointCase(
    "a VM's endpoint record after its delegation is removed",
    await signRecord(SIGNING_DOMAINS.endpoint, { ...endpoint, machine: 'vm-1' }, k.vm1.privateKey, k.vm1.pub),
    no('not-listed'),
    certs,
    'v2 without the delegation',
  );
  await endpointCase('an endpoint record whose addresses changed after signing', { body: { ...endpoint, addresses: ['wss://203.0.113.9:7420'] }, sig: miniEndpoint.sig }, no('bad-signature'));
  await endpointCase('an endpoint record signed as a listing', { body: endpoint, sig: (await signRecord(SIGNING_DOMAINS.listing, endpoint, k.mini.privateKey, k.mini.pub)).sig }, no('bad-signature'));

  // Log events in PROJECT, against v2.
  const ctx = { org: ORG, project: PROJECT };
  const say = { ts: at(4).replace(':00.000Z', ':01.234Z'), writer: 'mini/67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b', seq: 42, kind: 'say', from: 'maws-45', to: '*', text: 'the build is green' };
  const eventCase = async (name: string, event: unknown, expect: Verdict, at: { org?: string; project?: string; state?: string; certs?: Arg[] } = {}) => {
    keep(name, event);
    cases.push({ name, call: 'verifyEvent', args: [{ org: at.org ?? ORG, project: at.project ?? PROJECT }, stateOf(at.state ?? 'v2'), fixture(name), at.certs ?? [], NOW], expect });
  };
  const machineSay = await signEvent(ctx, say, k.mini.privateKey, k.mini.pub);
  await eventCase("a machine's event signed by its key", machineSay, ok());
  cases.push({ name: "a machine's event replayed into another project", call: 'verifyEvent', args: [{ org: ORG, project: 'proj-2' }, stateOf('v2'), fixture("a machine's event signed by its key"), [], NOW], expect: no('bad-signature') });
  cases.push({ name: "a machine's event replayed into another org", call: 'verifyEvent', args: [{ org: 'org-other', project: PROJECT }, stateOf('v2'), fixture("a machine's event signed by its key"), [], NOW], expect: no('bad-signature') });
  await eventCase("a machine's event whose text changed after signing", { ...machineSay, text: 'the build is red' }, no('bad-signature'));
  await eventCase("a machine's event whose seq changed after signing", { ...machineSay, seq: 43 }, no('bad-signature'));
  await eventCase("a machine's event signed by another key", await signEvent(ctx, say, k.stranger.privateKey, k.stranger.pub), no('unknown-signer'));
  const vmSay = await signEvent(ctx, { ...say, writer: 'vm-1/0b9c8d7e-6f5a-4b3c-2d1e-0f9a8b7c6d5e' }, k.vm1.privateKey, k.vm1.pub);
  await eventCase("a certified VM's event", vmSay, ok(), { certs });
  await eventCase("a VM's event without its certificate", vmSay, no('unknown-signer'));
  await eventCase("a VM's event after its delegation is removed", vmSay, no('unknown-signer'), { certs, state: 'v2 without the delegation' });
  await eventCase('a legacy writer', await signEvent(ctx, { ...say, writer: 'legacy/chat' }, k.mini.privateKey, k.mini.pub), no('unknown-signer'));

  // A device's words: signed as a draft, then positioned by the hub (`writer`, `seq`, `ts` lie outside the signature).
  const draft = { kind: 'human', from: 'human', member: A, to: '*', text: 'ship it', created: at(4), nonce: base64urlEncode(new Uint8Array(16).fill(7)) };
  const position = (event: object, seq: number, member = A) => ({ ...event, writer: `hub/${member}`, seq, ts: at(5).replace(':00.000Z', ':00.500Z') });
  const human = await signEvent(ctx, draft, k.a1Channel.privateKey, k.a1Channel.pub);
  await eventCase("a member's words signed by their device's channel key", position(human, 7), ok());
  await eventCase("a member's words at another position the hub assigned", position(human, 8), ok());
  await eventCase("a member's words placed under another member's writer", position(human, 7, B), no('malformed'));
  await eventCase("a member's words signed by their step-up key", position(await signEvent(ctx, draft, k.a1StepUp.privateKey, k.a1StepUp.pub), 7), no('unknown-signer'));
  await eventCase("a member's words signed by their web-cards phone", position(await signEvent(ctx, draft, k.aPhone.privateKey, k.aPhone.pub), 7), no('unknown-signer'));
  await eventCase("a member's words signed by another member's device", position(await signEvent(ctx, draft, k.b1Channel.privateKey, k.b1Channel.pub), 7), no('unknown-signer'));
  await eventCase('words from a device the head has since removed', position(human, 7), no('unknown-signer'), { state: 'v6' });

  // Who may sign as a writer.
  const signerCase = (name: string, state: string, writer: string, keys: B64[], withCerts: Arg[] = []) =>
    cases.push({ name, call: 'signerFor', args: [stateOf(state), writer, withCerts, NOW], expect: { keys } });
  signerCase("a member's writer: their devices' channel keys, the web-cards phone excepted", 'v2', `hub/${A}`, [k.a1Channel.pub]);
  signerCase("a listed machine's writer: its key", 'v2', 'mini/67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b', [k.mini.pub]);
  signerCase("a certified VM's writer: its certificate's key", 'v2', 'vm-1/human', [k.vm1.pub], certs);
  signerCase('a legacy writer: no key', 'v2', 'legacy/chat', []);
  signerCase("an unknown member's writer: no key", 'v2', `hub/${'0'.repeat(32)}`, []);

  // Dual coding: v2 first, then DX1's mac over the event with `sig` present (desk-hub's suite checks the mac with DX1).
  // The bytes 0x00…0x1f, desk-hub's own DX1 vector key (codes.json), which the secret scan knows as a test value.
  const orgKey = new Uint8Array(32).map((_, i) => i);
  const dual: DualCase[] = [];
  const dualCase = async (name: string, event: Record<string, unknown>, nonce: string) => {
    const sealed = await sealV1(orgKey, PROJECT, event, nonce);
    dual.push({ name, org: ORG, project: PROJECT, orgKey: base64urlEncode(orgKey), event: sealed });
    await eventCase(name, sealed, ok());
  };
  await dualCase("a dual-coded machine event", machineSay, base64urlEncode(new Uint8Array(16).fill(1)));
  await dualCase("a dual-coded member's words", position(await signEvent(ctx, { ...draft, text: 'and tag it' }, k.a1Channel.privateKey, k.a1Channel.pub), 9), base64urlEncode(new Uint8Array(16).fill(2)));

  const encodings: Encodings = {
    kids: await Promise.all((['a1StepUp', 'mini', 'recovery'] as const).map(async (n) => ({ pub: k[n].pub, kid: await kid(n) }))),
    stateHashes: [
      { state: { $state: 'g1' }, hash: await stateHash(g1.state) },
      { state: { $state: 'v2' }, hash: await stateHash(v2State) },
    ],
    inputs: await Promise.all(
      (
        [
          [SIGNING_DOMAINS.grant, 'a grant signed by the machine owner'],
          [SIGNING_DOMAINS.machineCert, 'cert vm-1'],
          [SIGNING_DOMAINS.listing, 'a listing signed by its listed machine'],
          [SIGNING_DOMAINS.endpoint, 'an endpoint record signed by its listed machine'],
          [SIGNING_DOMAINS.transition, 't5'],
        ] as const
      ).map(async ([domain, name]) => {
        const body = (fixtures[name] as Signed<unknown>).body;
        return { domain, body, input: `${domain}\n${canonicalize(body)}` };
      }),
    ),
  };
  return { fixtures, cases, dual, encodings };
}

/** DX1's seal of a log event (`codes.ts` `seal`), written out so the vectors need nothing from desk-hub. */
async function sealV1(orgKey: Uint8Array, project: string, event: Record<string, unknown>, nonce: string): Promise<Record<string, unknown>> {
  const covered: Record<string, unknown> = { ...event, mac: { nonce } };
  if (typeof covered.writer === 'string' && covered.writer.startsWith('hub/')) {
    delete covered.writer;
    delete covered.seq;
    delete covered.ts;
  }
  const key = await crypto.subtle.importKey('raw', new Uint8Array(orgKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const value = new Uint8Array(await crypto.subtle.sign('HMAC', key, new Uint8Array(new TextEncoder().encode(`smns-hub-log-v1\n${project}\n${canonicalize(covered)}`))));
  return { ...event, mac: { nonce, value: base64urlEncode(value) } };
}
