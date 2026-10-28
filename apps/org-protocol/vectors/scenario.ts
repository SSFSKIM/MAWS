// The vectors' scenario: one org's chain from genesis through a second device, a promotion, a removal and a recovery,
// with the records and log events signed beside it, and each case's expected verdict. generate.ts runs it with fresh
// keys and writes the JSON the consumers replay; the package's suites also run it with keys of their own, so every
// expectation holds for any keys, not only the committed ones.
import { base64urlEncode } from '../src/base64url.ts';
import { canonicalize } from '../src/canonical.ts';
import { enrollmentMac, enrollmentMacInput } from '../src/enrollment.ts';
import { eventSigningInput, signEvent } from '../src/events.ts';
import { keyId, signInput, type B64, type SigningKey } from '../src/keys.ts';
import { endorseDevice, signOrgState, signTransition, stateHash } from '../src/org-state.ts';
import { encodePairingCode, pairingFingerprint, pairingMac, pairingMacInput, type PairingCode, type PairingFields } from '../src/pairing.ts';
import { encodeProvisioningCodeV2, PROVISIONING_CODE_V2_PREFIX, type ProvisioningCodeV2 } from '../src/provisioning.ts';
import { signRecord } from '../src/records.ts';
import { SIGNING_DOMAINS, type Signer, type Device, type RevokedKey, type EndpointRecord, type Grant, type Listing, type MachineCert, type OrgState, type RootTransition, type Signed, type SignedOrgState } from '../src/types.ts';
import type { Verdict } from '../src/verdict.ts';
import { buildHistoryScenario, type HistoryVectors } from './scenario-history.ts';
import { buildRemoteScenario, RP_ID, type ActionEncoding, type ChannelVectors } from './scenario-remote.ts';

export { buildRemoteOrg, ORG_REMOTE, ORIGIN, RP_ID, type ActionEncoding, type ChannelVectors, type HandshakeRun, type RemoteOrg } from './scenario-remote.ts';

/** Every key the scenario signs with, by role. */
export const KEY_NAMES = [
  'a1Channel', 'a1StepUp', // A's first Mac
  'a3Channel', 'a3StepUp', // A's Mac after recovery
  'a4Channel', 'a4StepUp', // A's second Mac after recovery
  'aPhone', // A's phone (web-cards)
  'b1Channel', 'b1StepUp', // B's first Mac
  'b2Channel', 'b2StepUp', // B's second Mac
  'recovery', // the org's offline recovery key
  'mini', 'vmBuild', // machines the state lists
  'miniRotated', 'newcomer', // mini's next key; a machine enrolled later
  'delegation', 'vm1', 'vm1Rival', 'vm1Next', // a delegation, the VM it certifies, a rival claim on its ref, its successor
  'delegationB', // a second delegation's key
  'stranger', // a key the org never listed
  'c1Channel', 'c1StepUp', // C's Mac, in the remote org (scenario-remote.ts)
  'aPasskey', // A's phone's passkey (WebAuthn, ES256)
  'deviceEphemeral', 'machineEphemeral', // RL2's ephemerals, fixed so a handshake's bytes repeat
] as const;
export type KeyName = (typeof KEY_NAMES)[number];
export type Keys = Record<KeyName, SigningKey>;

/** A reference into `fixtures`: a signed state, its `state`, or any other fixture as it stands. */
export type Ref = { $signed: string } | { $state: string } | { $fixture: string };
export type Arg = Ref | string | number | null | Arg[] | Record<string, unknown>;

export type Case = {
  name: string;
  call:
    | 'verifyGenesis'
    | 'verifySuccessor'
    | 'verifyTransition'
    | 'verifyGrant'
    | 'verifyMachineCert'
    | 'verifyCertRetirement'
    | 'verifyListing'
    | 'verifyEndpointRecord'
    | 'verifyEvent'
    | 'signerFor'
    | 'contestedRefs'
    | 'machineKeys'
    | 'verifyRewind'
    | 'verifyAttestation'
    | 'verifyStepUp'
    | 'verifyWebAuthn'
    | 'isAction';
  args: Arg[];
  expect: (Verdict & { owners?: string[]; counter?: number }) | { signers: Signer[] } | { refs: string[] } | { keys: B64[]; contested: boolean } | { valid: boolean };
};
export type DualCase = { name: string; org: string; project: string; orgKey: string; event: Record<string, unknown> };
export type Encodings = {
  kids: Array<{ pub: B64; kid: string }>;
  stateHashes: Array<{ state: { $state: string }; hash: B64 }>;
  inputs: Array<{ domain: string; body: unknown; input: string }>;
  /** RL4's actions: signing input, digest, fingerprint. */
  actions: ActionEncoding[];
};
/** Enrollment MACs (enrollment.ts): `input` is the length-prefixed encoding, base64url; `k` the pairing secret. */
export type EnrollmentCase = { name: string; machinePub: B64; ref: string; tokenId: string; k: string; input: string; mac: string };
/**
 * A device's pairing (pairing.ts, O13 §A): a code, its decoded form, a phone's entry with its MAC input (base64url), MAC
 * under the code's `k` and fingerprint, and the same entry with its passkey swapped and its channel key kept, its MAC
 * recomputed under the same `k` (a leaked one), whose fingerprint differs (RL DL28).
 */
export type PairingVector = {
  code: string;
  decoded: PairingCode;
  fields: PairingFields;
  input: string;
  mac: string;
  fingerprint: string;
  swapped: { fields: PairingFields; mac: string; fingerprint: string };
};
/**
 * The v2 provisioning code (provisioning.ts, P5 O14 §A): codes with and without the legacy key, each as its text and its
 * decoded fields, and texts the decoder refuses, each with its named refusal (the TypeError's message).
 */
export type ProvisioningVector = {
  codes: Array<{ name: string; text: string; decoded: ProvisioningCodeV2 }>;
  refusals: Array<{ name: string; text: string; error: string }>;
};
export type VectorSet = {
  fixtures: Record<string, unknown>;
  cases: Case[];
  dual: DualCase[];
  encodings: Encodings;
  enrollment: EnrollmentCase[];
  pairing: PairingVector;
  provisioning: ProvisioningVector;
  channel: ChannelVectors;
  history: HistoryVectors;
};

export const ORG = 'org-vectors';
export const PROJECT = 'proj-1';
export const A = '0a1b2c3d4e5f60718293a4b5c6d7e8f9';
export const B = 'f9e8d7c6b5a4938271605f4e3d2c1b0a';
// Machine refs (RL §2.3): opaque, [A-Za-z0-9_-]{16,64}.
export const REF_MINI = 'mref-mini-0000001';
export const REF_VM_BUILD = 'mref-vmbuild-00001';
// Delegation ids: 32 lowercase hex (the provisioning key's id). A certificate's ref starts with its delegation's id and
// `_`, then at least 128 random bits (22 base64url characters).
const DLG_VM = '0d1e2a3b4c5d6e7f8091a2b3c4d5e6f7';
const DLG_B = '1b2c3d4e5f60718293a4b5c6d7e8f901';
const DLG_OTHER = '2c3d4e5f60718293a4b5c6d7e8f90112';
export const REF_VM1 = `${DLG_VM}_vm1AAAAAAAAAAAAAAAAAAA`;
export const REF_NEWCOMER = 'mref-newcomer-0001';
export const REF_VM1_NEXT = `${DLG_VM}_vm1nextAAAAAAAAAAAAAAA`;
const REF_VM1_B = `${DLG_B}_box1AAAAAAAAAAAAAAAAAA`;
const REF_GHOST = 'mref-ghost-000001';
/** 0x04 and 64 zero bytes: an uncompressed point's encoding, off the curve. */
const OFF_CURVE = base64urlEncode(Uint8Array.from([4, ...new Array<number>(64).fill(0)]));
/** A string RFC 8785 cannot write: a lone UTF-16 surrogate. */
const LONE = 'text \ud800 alone';
const NOW = '2026-10-28T00:00:00.000Z';
const DELEGATION_EXPIRES = '2026-11-27T00:00:00.000Z';
/** When the scenario's retired keys stop signing; events at 04:00 fall before it, events at 06:00 after. */
const RETIRE_AT = '2026-10-27T05:00:00.000Z';
const LATE = '2026-10-27T06:00:00.000Z';
const LATER = '2026-12-01T00:00:00.000Z';
const at = (hour: number) => `2026-10-27T${String(hour).padStart(2, '0')}:00:00.000Z`;

const signed = (name: string): Ref => ({ $signed: name });
const stateOf = (name: string): Ref => ({ $state: name });
const fixture = (name: string): Ref => ({ $fixture: name });
const ok = (): Verdict => ({ ok: true });
/** The certificates and their delegations' retirements a verifier is handed beside the state. */
const bundle = (certs: Arg[] = [], retirements: Arg[] = []): Arg => ({ certs, retirements });
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
  /** The `revoked` entries for each key of `member`'s `device`. */
  const revokedDevice = async (member: string, d: Device): Promise<RevokedKey[]> => [
    { keyId: await keyId(d.channelPub), holder: { member, device: d.id, class: d.class, key: 'channel' } },
    ...(d.stepUpPub === undefined ? [] : [{ keyId: await keyId(d.stepUpPub), holder: { member, device: d.id, class: d.class, key: 'step-up' as const } }]),
  ];
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
    machineNames: [],
    retired: [],
    revoked: [],
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
    (s) => {
      s.machines.push({ name: 'mini', ref: REF_MINI, pub: k.mini.pub, owners: [B] });
      s.machineNames.push({ name: 'mini', ref: REF_MINI });
    },
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
    s.machines.push({ name: 'mini', ref: REF_MINI, pub: k.mini.pub, owners: [A] }, { name: 'builder', ref: REF_VM_BUILD, pub: k.vmBuild.pub, owners: 'org' });
    s.machineNames.push({ name: 'mini', ref: REF_MINI }, { name: 'builder', ref: REF_VM_BUILD });
    s.delegations.push({ id: DLG_VM, pub: k.delegation.pub, prefix: 'vm-', expires: DELEGATION_EXPIRES, maxUses: 3, offlineRevokeS: 3600, owners: 'org' });
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
  const bRevoked = [...(await revokedDevice(B, b1)), ...(await revokedDevice(B, b2Endorsed))];
  const v5 = await sign(await next(v4, (s) => {
    s.members.splice(1, 1);
    s.root.keys = s.root.keys.filter((key) => key !== b1Root);
    s.revoked.push(...bRevoked);
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
  // The lost devices' keys are revoked: the recovered state names them, and keeps every revocation of the head.
  const aLost = [...(await revokedDevice(A, a1)), ...(await revokedDevice(A, phone))];
  const recovered = await next(v5, (s) => {
    s.members[0].devices = [a3];
    s.root.keys = [a3Root];
    s.revoked.push(...aLost);
  }, 6);
  await successorCase('the successor a root transition authorizes', recovered, ['a3StepUp'], ok(), 'v5', [fixture('t5')]);
  keep('v6', fixtures['the successor a root transition authorizes']);
  await successorCase('the same successor without the transition', recovered, ['a3StepUp'], no('not-root-signed'), 'v5');
  await successorCase('a successor a transition authorizes, dropping a revocation of the head', await next(v5, (s) => {
    s.members[0].devices = [a3];
    s.root.keys = [a3Root];
    s.revoked = [...aLost];
  }, 6), ['a3StepUp'], no('malformed'), 'v5', [fixture('t5')]);
  await successorCase('a successor a transition authorizes, its lost devices neither retired nor revoked', await next(v5, (s) => {
    s.members[0].devices = [a3];
    s.root.keys = [a3Root];
  }, 6), ['a3StepUp'], no('malformed'), 'v5', [fixture('t5')]);
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
      s.revoked.push(...aLost.filter((r) => 'device' in r.holder && r.holder.device === phone.id));
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

  {
    // Root transitions held together: either order authorizes the successor that takes one of their root sets.
    const a4 = mac('dev-a4', 'a4Channel', 'a4StepUp');
    const t5ab = await signTransition({ ...transition, newRootKeys: [k.a3StepUp.pub, k.a4StepUp.pub] }, k.recovery.privateKey, k.recovery.pub);
    keep('t5 to two keys', t5ab);
    const a4Root = await kid('a4StepUp');
    const toTwo = await next(v5, (s) => {
      s.members[0].devices = [a3, a4];
      s.root.keys = [a3Root, a4Root];
      s.revoked.push(...aLost);
    }, 6);
    await successorCase('a successor taking the second of two held transitions, the first listed first', toTwo, ['a3StepUp'], ok(), 'v5', [fixture('t5'), fixture('t5 to two keys')]);
    await successorCase('a successor taking the second of two held transitions, the second listed first', toTwo, ['a3StepUp'], ok(), 'v5', [fixture('t5 to two keys'), fixture('t5')]);
    await transitionCase(
      'a root transition to a key off the curve',
      await signTransition({ ...transition, newRootKeys: [OFF_CURVE] }, k.recovery.privateKey, k.recovery.pub),
      no('malformed'),
    );
  }
  await genesisVariant('genesis pinning a recovery key off the curve', (s) => (s.root.recoveryPub = OFF_CURVE), 'a1StepUp', no('malformed'));
  {
    const offRoot = await keyId(OFF_CURVE);
    await successorCase(
      'a successor whose root set is a key off the curve',
      await next(v2, (s) => {
        s.members[0].devices.push({ id: 'dev-a-off', class: 'native-mac', keyStorage: 'software', channelPub: k.stranger.pub, stepUpPub: OFF_CURVE });
        s.root.keys = [offRoot];
      }, 2),
      ['a1StepUp'],
      no('malformed'),
    );
  }

  // Machine refs (RL §2.3) and the names given to them (`machineNames`).
  await genesisVariant('genesis with a machine ref outside its grammar', (s) => {
    s.machines.push({ name: 'mini', ref: 'short', pub: k.mini.pub, owners: [A] });
    s.machineNames.push({ name: 'mini', ref: 'short' });
  }, 'a1StepUp', no('malformed'));
  await genesisVariant('genesis naming a machine its record does not hold', (s) => s.machines.push({ name: 'mini', ref: REF_MINI, pub: k.mini.pub, owners: [A] }), 'a1StepUp', no('malformed'));
  await genesisVariant('genesis whose record holds a name no machine has', (s) => s.machineNames.push({ name: 'mini', ref: REF_MINI }), 'a1StepUp', no('malformed'));
  await successorCase('a successor with two machines of one ref', await next(v2, (s) => {
    s.machines.push({ name: 'box', ref: REF_MINI, pub: k.newcomer.pub, owners: [A] });
    s.machineNames.push({ name: 'box', ref: REF_MINI });
  }, 2), ['a1StepUp'], no('malformed'));
  await successorCase("a successor rotating a machine's key, the old one neither retired nor revoked", await next(v2, (s) => (s.machines[0].pub = k.miniRotated.pub), 2), ['a1StepUp'], no('malformed'));
  const miniRevoked = { keyId: await kid('mini'), holder: { machine: REF_MINI } };
  await successorCase("a successor rotating a machine's key and revoking the old one", await next(v2, (s) => {
    s.machines[0].pub = k.miniRotated.pub;
    s.revoked.push(miniRevoked);
  }, 2), ['a1StepUp'], ok());
  await successorCase("a successor revoking a machine's key under another holder", await next(v2, (s) => {
    s.machines[0].pub = k.miniRotated.pub;
    s.revoked.push({ ...miniRevoked, holder: { machine: REF_VM_BUILD } });
  }, 2), ['a1StepUp'], no('malformed'));
  await successorCase("a successor revoking a machine's key it keeps", await next(v2, (s) => s.revoked.push(miniRevoked), 2), ['a1StepUp'], no('revoked'));
  await successorCase("a successor changing a machine's ref under its key", await next(v2, (s) => {
    s.machines[0].name = 'mini-two';
    s.machines[0].ref = REF_NEWCOMER;
    s.machineNames.push({ name: 'mini-two', ref: REF_NEWCOMER });
  }, 2), ['a1StepUp'], no('malformed'));
  await successorCase("a successor changing a machine's ref under its name", await next(v2, (s) => {
    s.machines[0].ref = REF_NEWCOMER;
    s.machines[0].pub = k.newcomer.pub;
    s.revoked.push(miniRevoked);
  }, 2), ['a1StepUp'], no('name-retired'));
  const renamed = await sign(await next(v2, (s) => {
    s.machines[0].name = 'studio';
    s.machineNames.push({ name: 'studio', ref: REF_MINI });
  }, 2), 'a1StepUp');
  keep('v3 renamed', renamed);
  cases.push({ name: 'a successor renaming a machine, keeping its ref', call: 'verifySuccessor', args: [signed('v2'), signed('v3 renamed'), []], expect: ok() });
  await successorCase('then the old name given to a new machine', await next(renamed, (s) => {
    s.machines.push({ name: 'mini', ref: REF_NEWCOMER, pub: k.newcomer.pub, owners: [A] });
    s.machineNames.push({ name: 'mini', ref: REF_NEWCOMER });
  }, 3), ['a1StepUp'], no('name-retired'), 'v3 renamed');
  await successorCase('then the old name given to a new machine, its pair left out', await next(renamed, (s) => {
    s.machines.push({ name: 'Mini', ref: REF_NEWCOMER, pub: k.newcomer.pub, owners: [A] });
  }, 3), ['a1StepUp'], no('name-retired'), 'v3 renamed');
  await successorCase('then the machine renamed back to its old name', await next(renamed, (s) => (s.machines[0].name = 'mini'), 3), ['a1StepUp'], ok(), 'v3 renamed');
  await successorCase('then a name dropped from the record', await next(renamed, (s) => {
    s.machines[0].name = 'mini';
    s.machineNames = s.machineNames.filter((p) => p.name !== 'studio');
  }, 3), ['a1StepUp'], no('name-retired'), 'v3 renamed');
  // Name namespaces (RL DL 25): no machine name lies under a delegation's prefix, and no prefix matches or nests in
  // another, both compared without case.
  const dlgB = { id: DLG_B, pub: k.delegationB.pub, prefix: 'box-', expires: DELEGATION_EXPIRES, maxUses: 3, offlineRevokeS: 3600, owners: 'org' as const };
  await successorCase("a successor naming a machine under a delegation's prefix", await next(v2, (s) => {
    s.machines.push({ name: 'VM-9', ref: REF_NEWCOMER, pub: k.newcomer.pub, owners: [A] });
    s.machineNames.push({ name: 'VM-9', ref: REF_NEWCOMER });
  }, 2), ['a1StepUp'], no('malformed'));
  await successorCase('a successor enrolling DC-mini beside the prefix dc-', await next(v2, (s) => {
    s.delegations.push({ ...dlgB, prefix: 'dc-' });
    s.machines.push({ name: 'DC-mini', ref: REF_NEWCOMER, pub: k.newcomer.pub, owners: [A] });
    s.machineNames.push({ name: 'DC-mini', ref: REF_NEWCOMER });
  }, 2), ['a1StepUp'], no('malformed'));
  await successorCase("a successor adding a delegation whose prefix covers a machine's name", await next(v2, (s) => s.delegations.push({ ...dlgB, prefix: 'MI' }), 2), ['a1StepUp'], no('malformed'));
  await successorCase("a successor adding a delegation whose prefix covers a renamed machine's old name", await next(renamed, (s) => s.delegations.push({ ...dlgB, prefix: 'min' }), 3), ['a1StepUp'], no('malformed'), 'v3 renamed');
  await successorCase("a successor adding a delegation with another's prefix", await next(v2, (s) => s.delegations.push({ ...dlgB, prefix: 'VM-' }), 2), ['a1StepUp'], no('malformed'));
  await successorCase("a successor adding a delegation whose prefix nests in another's", await next(v2, (s) => s.delegations.push({ ...dlgB, prefix: 'vm-x' }), 2), ['a1StepUp'], no('malformed'));
  await successorCase("a successor adding a delegation whose prefix holds another's", await next(v2, (s) => s.delegations.push({ ...dlgB, prefix: 'v' }), 2), ['a1StepUp'], no('malformed'));
  const withB = await sign(await next(v2, (s) => s.delegations.push(dlgB), 2), 'a1StepUp');
  keep('v3 with a second delegation', withB);
  cases.push({ name: 'a successor adding a delegation with a prefix of its own', call: 'verifySuccessor', args: [signed('v2'), signed('v3 with a second delegation'), []], expect: ok() });

  // Delegations: id, key and prefix never change; `expires` moves only while both values lie ahead; one leaves the state
  // only by its key's revocation, which frees its prefix.
  const dlgRevoked = { keyId: await kid('delegation'), holder: { delegation: DLG_VM, prefix: 'vm-' } };
  await successorCase("a successor changing a delegation's key", await next(v2, (s) => (s.delegations[0].pub = k.delegationB.pub), 2), ['a1StepUp'], no('malformed'));
  await successorCase("a successor changing a delegation's prefix", await next(v2, (s) => (s.delegations[0].prefix = 'vmx-'), 2), ['a1StepUp'], no('malformed'));
  await successorCase('a successor renewing a live delegation', await next(v2, (s) => (s.delegations[0].expires = LATER), 2), ['a1StepUp'], ok());
  await successorCase('a successor ending a delegation before its successor was issued', await next(v2, (s) => (s.delegations[0].expires = at(1)), 2), ['a1StepUp'], no('malformed'));
  await successorCase('a successor renewing an expired delegation', await next(v2, (s) => {
    s.issued = '2026-11-28T00:00:00.000Z';
    s.delegations[0].expires = LATER;
  }, 2), ['a1StepUp'], no('malformed'));
  await successorCase('a successor dropping a delegation, its key not revoked', await next(v2, (s) => (s.delegations = []), 2), ['a1StepUp'], no('malformed'));
  await successorCase('a successor revoking a delegation it keeps', await next(v2, (s) => s.revoked.push(dlgRevoked), 2), ['a1StepUp'], no('revoked'));
  await successorCase('a successor revoking a delegation under another id', await next(v2, (s) => {
    s.delegations = [];
    s.revoked.push({ ...dlgRevoked, holder: { delegation: DLG_OTHER, prefix: 'vm-' } });
  }, 2), ['a1StepUp'], no('malformed'));
  await successorCase("a successor revoking a delegation under another prefix", await next(v2, (s) => {
    s.delegations = [];
    s.revoked.push({ ...dlgRevoked, holder: { delegation: DLG_VM, prefix: 'other-' } });
  }, 2), ['a1StepUp'], no('malformed'));
  const noDelegation = await sign(await next(v2, (s) => {
    s.delegations = [];
    s.revoked.push(dlgRevoked);
  }, 2), 'a1StepUp');
  keep('v2 without the delegation', noDelegation);
  cases.push({ name: 'a successor dropping a delegation, its key revoked', call: 'verifySuccessor', args: [signed('v2'), signed('v2 without the delegation'), []], expect: ok() });
  // A key has one holder at a time, on the state alone, and a key leaving its holder is retired or revoked even when it
  // reappears under another: a delegation dropped while its key becomes a machine's would leave no revocation, and a
  // later delegation could take its prefix and certify its VMs' keys again.
  await successorCase("a successor dropping a delegation, its key now a machine's, not revoked", await next(v2, (s) => {
    s.delegations = [];
    s.machines.push({ name: 'host-d', ref: REF_NEWCOMER, pub: k.delegation.pub, owners: [A] });
    s.machineNames.push({ name: 'host-d', ref: REF_NEWCOMER });
  }, 2), ['a1StepUp'], no('malformed'));
  await successorCase("a successor dropping a delegation, its key revoked and now a machine's", await next(v2, (s) => {
    s.delegations = [];
    s.revoked.push(dlgRevoked);
    s.machines.push({ name: 'host-d', ref: REF_NEWCOMER, pub: k.delegation.pub, owners: [A] });
    s.machineNames.push({ name: 'host-d', ref: REF_NEWCOMER });
  }, 2), ['a1StepUp'], no('revoked'));
  await successorCase("a successor giving a machine a delegation's key", await next(v2, (s) => {
    s.machines.push({ name: 'host-d', ref: REF_NEWCOMER, pub: k.delegation.pub, owners: [A] });
    s.machineNames.push({ name: 'host-d', ref: REF_NEWCOMER });
  }, 2), ['a1StepUp'], no('malformed'));
  await successorCase("a successor giving two machines one key", await next(v2, (s) => {
    s.machines.push({ name: 'host-d', ref: REF_NEWCOMER, pub: k.mini.pub, owners: [A] });
    s.machineNames.push({ name: 'host-d', ref: REF_NEWCOMER });
  }, 2), ['a1StepUp'], no('malformed'));
  await successorCase("a successor giving a machine a device's channel key", await next(v2, (s) => {
    s.machines.push({ name: 'host-d', ref: REF_NEWCOMER, pub: k.b1Channel.pub, owners: [A] });
    s.machineNames.push({ name: 'host-d', ref: REF_NEWCOMER });
  }, 2), ['a1StepUp'], no('malformed'));
  await successorCase("a successor giving a delegation the recovery key", await next(v2, (s) => s.delegations.push({ ...dlgB, pub: k.recovery.pub }), 2), ['a1StepUp'], no('malformed'));
  await genesisVariant("genesis with a device whose step-up key is its channel key", (s) => {
    s.members[0].devices[0].stepUpPub = s.members[0].devices[0].channelPub;
    s.root.keys = [channelRoot];
  }, 'a1Channel', no('malformed'));

  // A revoked delegation's prefix and id stay reserved for the life of the org (RL DL 26), and no enrolled ref takes the
  // `<id>_` shape of a delegation the state knows: so no later delegation or entry reopens the revoked one's history.
  await successorCase("then a delegation taking the revoked one's prefix", await next(noDelegation, (s) => s.delegations.push({ ...dlgB, prefix: 'vm-' }), 3), ['a1StepUp'], no('malformed'), 'v2 without the delegation');
  await successorCase("then a delegation whose prefix holds the revoked one's", await next(noDelegation, (s) => s.delegations.push({ ...dlgB, prefix: 'v' }), 3), ['a1StepUp'], no('malformed'), 'v2 without the delegation');
  await successorCase("then a delegation taking the revoked one's id", await next(noDelegation, (s) => s.delegations.push({ ...dlgB, id: DLG_VM, prefix: 'zz-' }), 3), ['a1StepUp'], no('malformed'), 'v2 without the delegation');
  await successorCase("then a machine named under the revoked prefix", await next(noDelegation, (s) => {
    s.machines.push({ name: 'vm-7', ref: REF_NEWCOMER, pub: k.newcomer.pub, owners: [A] });
    s.machineNames.push({ name: 'vm-7', ref: REF_NEWCOMER });
  }, 3), ['a1StepUp'], no('malformed'), 'v2 without the delegation');
  await successorCase("then a machine enrolled under a ref of the revoked delegation's shape", await next(noDelegation, (s) => {
    s.machines.push({ name: 'host-9', ref: `${DLG_VM}_hostAAAAAAAAAAAAAAAAAA`, pub: k.newcomer.pub, owners: [A] });
    s.machineNames.push({ name: 'host-9', ref: `${DLG_VM}_hostAAAAAAAAAAAAAAAAAA` });
  }, 3), ['a1StepUp'], no('malformed'), 'v2 without the delegation');
  await successorCase("a successor enrolling a machine under a ref of a live delegation's shape", await next(v2, (s) => {
    s.machines.push({ name: 'host-9', ref: `${DLG_VM}_hostAAAAAAAAAAAAAAAAAA`, pub: k.newcomer.pub, owners: [A] });
    s.machineNames.push({ name: 'host-9', ref: `${DLG_VM}_hostAAAAAAAAAAAAAAAAAA` });
  }, 2), ['a1StepUp'], no('malformed'));
  await successorCase("a successor adding a delegation whose id shapes an enrolled machine's ref", await next(v2, (s) => {
    s.machines.push({ name: 'host-9', ref: `${DLG_B}_hostAAAAAAAAAAAAAAAAAA`, pub: k.newcomer.pub, owners: [A] });
    s.machineNames.push({ name: 'host-9', ref: `${DLG_B}_hostAAAAAAAAAAAAAAAAAA` });
    s.delegations.push(dlgB);
  }, 2), ['a1StepUp'], no('malformed'));
  await successorCase("then a delegation taking the revoked one's key", await next(noDelegation, (s) => s.delegations.push({ ...dlgB, pub: k.delegation.pub }), 3), ['a1StepUp'], no('revoked'), 'v2 without the delegation');
  await successorCase('a successor whose record gains a name no machine has', await next(v2, (s) => s.machineNames.push({ name: 'spare', ref: REF_NEWCOMER }), 2), ['a1StepUp'], no('malformed'));

  const strangerKid = await kid('stranger');
  // Retired keys (RL §5.2): a key that left honestly keeps its past; one dropped without retirement is revoked.
  const miniRetired = { keyId: await kid('mini'), pub: k.mini.pub, notAfter: RETIRE_AT, holder: { machine: REF_MINI } };
  await genesisVariant('genesis retiring a key', (s) => s.retired.push(miniRetired), 'a1StepUp', no('malformed'));
  await genesisVariant('genesis revoking a key', (s) => s.revoked.push({ keyId: miniRetired.keyId, holder: miniRetired.holder }), 'a1StepUp', no('malformed'));
  const rotatedRetired = await sign(await next(v2, (s) => {
    s.machines[0].pub = k.miniRotated.pub;
    s.retired.push(miniRetired);
  }, 2), 'a1StepUp');
  keep('v3 mini retired', rotatedRetired);
  cases.push({ name: "a successor rotating a machine's key and retiring the old one", call: 'verifySuccessor', args: [signed('v2'), signed('v3 mini retired'), []], expect: ok() });
  await successorCase('a successor retiring a key it still holds', await next(v2, (s) => s.retired.push(miniRetired), 2), ['a1StepUp'], no('malformed'));
  await successorCase("a successor retiring a key under another holder", await next(v2, (s) => {
    s.machines[0].pub = k.miniRotated.pub;
    s.retired.push({ ...miniRetired, holder: { machine: REF_VM_BUILD } });
  }, 2), ['a1StepUp'], no('malformed'));
  await successorCase("a successor whose retired key id is not its key's", await next(v2, (s) => {
    s.machines[0].pub = k.miniRotated.pub;
    s.retired.push({ ...miniRetired, keyId: strangerKid });
  }, 2), ['a1StepUp'], no('malformed'));
  await successorCase('then the retirement moved later', await next(rotatedRetired, (s) => (s.retired[0].notAfter = LATE), 3), ['a1StepUp'], no('malformed'), 'v3 mini retired');
  // A retired key never becomes current again (RL DL 24): mini's K1 → K2 → K1, at once or after a quiet step.
  // K2 leaves honestly (retired) as K1 returns, so only K1's retirement can refuse the step.
  const k2Retired = { keyId: await kid('miniRotated'), pub: k.miniRotated.pub, notAfter: LATE, holder: { machine: REF_MINI } };
  const backToK1 = (s: OrgState) => {
    s.machines[0].pub = k.mini.pub;
    s.retired.push(k2Retired);
  };
  await successorCase('a rotation K1 to K2 to K1, the retirement kept', await next(rotatedRetired, backToK1, 3), ['a1StepUp'], no('malformed'), 'v3 mini retired');
  const quietAfterRetirement = await sign(await next(rotatedRetired, (s) => s.projects.push({ id: 'proj-quiet', name: 'quiet' }), 3), 'a1StepUp');
  keep('v4 after mini retired', quietAfterRetirement);
  await successorCase('a rotation K1 to K2 to K1 after an intermediate state', await next(quietAfterRetirement, backToK1, 4), ['a1StepUp'], no('malformed'), 'v4 after mini retired');
  await successorCase('a rotation K1 to K2 to K3, K2 retired', await next(quietAfterRetirement, (s) => {
    s.machines[0].pub = k.newcomer.pub;
    s.retired.push(k2Retired);
  }, 4), ['a1StepUp'], ok(), 'v4 after mini retired');
  await successorCase('then the retirement dropped, its key not revoked', await next(rotatedRetired, (s) => (s.retired = []), 3), ['a1StepUp'], no('malformed'), 'v3 mini retired');
  const dropped = await sign(await next(rotatedRetired, (s) => {
    s.retired = [];
    s.revoked.push(miniRevoked);
  }, 3), 'a1StepUp');
  keep('v4 mini retirement revoked', dropped);
  cases.push({ name: 'then the retired key revoked', call: 'verifySuccessor', args: [signed('v3 mini retired'), signed('v4 mini retirement revoked'), []], expect: ok() });
  await successorCase('then the retired key revoked under another holder', await next(rotatedRetired, (s) => {
    s.retired = [];
    s.revoked.push({ ...miniRevoked, holder: { machine: REF_VM_BUILD } });
  }, 3), ['a1StepUp'], no('malformed'), 'v3 mini retired');
  await successorCase('then the retired key both retired and revoked', await next(rotatedRetired, (s) => s.revoked.push(miniRevoked), 3), ['a1StepUp'], no('malformed'), 'v3 mini retired');
  await successorCase('then the retired key revoked and made current again', await next(rotatedRetired, (s) => {
    s.retired = [];
    s.revoked.push(miniRevoked);
    s.machines[0].pub = k.mini.pub;
  }, 3), ['a1StepUp'], no('revoked'), 'v3 mini retired');
  await successorCase('then a revocation dropped', await next(dropped, (s) => (s.revoked = []), 4), ['a1StepUp'], no('malformed'), 'v4 mini retirement revoked');
  await successorCase('then the retired key made current again, its retirement dropped in the same step', await next(rotatedRetired, (s) => {
    s.retired = [];
    s.machines[0].pub = k.mini.pub;
  }, 3), ['a1StepUp'], no('malformed'), 'v3 mini retired');
  await successorCase('then the revoked key retired again', await next(dropped, (s) => s.retired.push(miniRetired), 4), ['a1StepUp'], no('malformed'), 'v4 mini retirement revoked');
  {
    const revoked = fixtures["a successor rotating a machine's key and revoking the old one"] as SignedOrgState;
    await successorCase('then a revoked key retired after all', await next(revoked, (s) => s.retired.push(miniRetired), 3), ['a1StepUp'], no('malformed'), "a successor rotating a machine's key and revoking the old one");
  }
  {
    // B's first Mac leaves: its keys retired, or (the other branch) revoked.
    const v3 = fixtures.v3 as SignedOrgState;
    const b1Retired = { keyId: await kid('b1Channel'), pub: k.b1Channel.pub, notAfter: RETIRE_AT, holder: { member: B, device: 'dev-b1', class: 'native-mac' as const, key: 'channel' as const } };
    const b1StepUpRetired = { keyId: await kid('b1StepUp'), pub: k.b1StepUp.pub, notAfter: RETIRE_AT, holder: { ...b1Retired.holder, key: 'step-up' as const } };
    keep('v4 b1 retired', await sign(await next(v3, (s) => {
      s.members[1].devices = s.members[1].devices.filter((d) => d.id !== 'dev-b1');
      s.retired.push(b1Retired, b1StepUpRetired);
    }, 3), 'a1StepUp'));
    cases.push({ name: "a successor retiring a member's device", call: 'verifySuccessor', args: [signed('v3'), signed('v4 b1 retired'), []], expect: ok() });
    await successorCase('a successor dropping a device, its keys neither retired nor revoked', await next(v3, (s) => (s.members[1].devices = s.members[1].devices.filter((d) => d.id !== 'dev-b1')), 3), ['a1StepUp'], no('malformed'), 'v3');
    await successorCase('a successor dropping a device, one key retired and the other not', await next(v3, (s) => {
      s.members[1].devices = s.members[1].devices.filter((d) => d.id !== 'dev-b1');
      s.retired.push(b1Retired);
    }, 3), ['a1StepUp'], no('malformed'), 'v3');
    const b1Keys = await revokedDevice(B, b1);
    const b1Revoked = await sign(await next(v3, (s) => {
      s.members[1].devices = s.members[1].devices.filter((d) => d.id !== 'dev-b1');
      s.revoked.push(...b1Keys);
    }, 3), 'a1StepUp');
    keep('v4 b1 revoked', b1Revoked);
    cases.push({ name: "a successor revoking a member's device", call: 'verifySuccessor', args: [signed('v3'), signed('v4 b1 revoked'), []], expect: ok() });
    // A key enters `retired` only in the step it stops being current: revoked at v4, it can't be retired at v6.
    const quiet = await sign(await next(b1Revoked, (s) => s.projects.push({ id: 'proj-quiet', name: 'quiet' }), 4), 'a1StepUp');
    keep('v5 after b1 revoked', quiet);
    // A revoked key never becomes current again (RL DL 24): `revoked` is append-only and apart from the current keys.
    const b1Back: Device = { ...b1, endorsement: await endorseDevice(ORG, B, b1, k.b2StepUp.privateKey, k.b2StepUp.pub) };
    const readded = await next(b1Revoked, (s) => s.members[1].devices.push(b1Back), 4);
    keep('v5 b1 re-added', await sign(readded, 'a1StepUp'));
    cases.push({ name: 'a revoked device key made current again', call: 'verifySuccessor', args: [signed('v4 b1 revoked'), signed('v5 b1 re-added'), []], expect: no('revoked') });
    await successorCase('a revoked device key made current again, its revocation dropped', await next(b1Revoked, (s) => {
      s.members[1].devices.push(b1Back);
      s.revoked = [];
    }, 4), ['a1StepUp'], no('revoked'), 'v4 b1 revoked');
    await successorCase('then a retired device key made current again, its retirement dropped in the same step', await next(fixtures['v4 b1 retired'] as SignedOrgState, (s) => {
      s.retired = [];
      s.members[1].devices.push(b1Back);
    }, 4), ['a1StepUp'], no('malformed'), 'v4 b1 retired');
    await successorCase('a device key dropped two steps before, retired now', await next(quiet, (s) => s.retired.push(b1Retired), 5), ['a1StepUp'], no('malformed'), 'v5 after b1 revoked');
    await successorCase("a successor retiring a device's channel key as its step-up key", await next(v3, (s) => {
      s.members[1].devices = s.members[1].devices.filter((d) => d.id !== 'dev-b1');
      s.retired.push({ ...b1Retired, holder: { ...b1Retired.holder, key: 'step-up' } });
    }, 3), ['a1StepUp'], no('malformed'), 'v3');
  }

  // The DX1 org key's retirement in the state (O14 M5a): added at its own version, kept or dropped after, never moved.
  {
    const retired = await sign(await next(v2, (s) => void (s.legacyRetired = { version: s.version, at: s.issued }), 2), 'a1StepUp');
    keep('v3 legacy key retired', retired);
    cases.push({ name: 'a successor retiring the legacy key', call: 'verifySuccessor', args: [signed('v2'), signed('v3 legacy key retired'), []], expect: ok() });
    await successorCase('a successor retiring the legacy key at another version', await next(v2, (s) => void (s.legacyRetired = { version: 1, at: s.issued }), 2), ['a1StepUp'], no('malformed'));
    await successorCase('then the legacy retirement kept', await next(retired, (s) => s.projects.push({ id: 'proj-kept', name: 'kept' }), 3), ['a1StepUp'], ok(), 'v3 legacy key retired');
    await successorCase('then the legacy retirement dropped', await next(retired, (s) => delete s.legacyRetired, 3), ['a1StepUp'], ok(), 'v3 legacy key retired');
    await successorCase('then the legacy retirement moved', await next(retired, (s) => void (s.legacyRetired = { version: 3, at: s.issued }), 3), ['a1StepUp'], no('malformed'), 'v3 legacy key retired');
    await successorCase('a successor whose legacy retirement carries another field', await next(v2, (s) => void Object.assign(s, { legacyRetired: { version: s.version, at: s.issued, by: A } }), 2), ['a1StepUp'], no('malformed'));
  }

  // Wire input RFC 8785 cannot write, or no shape at all: a verdict, never a throw.
  cases.push({ name: 'genesis that is not an object', call: 'verifyGenesis', args: [null], expect: no('malformed') });
  {
    const lone = clone(genesisState);
    lone.members[0].email = LONE;
    keep('genesis with a lone surrogate', { state: lone, sigs: g1.sigs });
    cases.push({ name: 'genesis with a lone surrogate', call: 'verifyGenesis', args: [signed('genesis with a lone surrogate')], expect: no('malformed') });
    const loneNext = await next(v2, (s) => s.projects.push({ id: 'proj-lone', name: LONE }), 2);
    keep('a successor with a lone surrogate', { state: loneNext, sigs: v2.sigs });
    cases.push({ name: 'a successor with a lone surrogate', call: 'verifySuccessor', args: [signed('v2'), signed('a successor with a lone surrogate'), []], expect: no('malformed') });
    cases.push({ name: 'a successor whose transitions are not a list', call: 'verifySuccessor', args: [signed('v2'), signed('v3'), 'none'], expect: no('malformed') });
  }

  // Records against v2: a grant, a VM's certificate, listings and endpoint records.
  const grant: Grant = { org: ORG, machine: REF_MINI, machineKey: await kid('mini'), member: B, rights: ['spawn'], version: 1, issued: at(2) };
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
    await signRecord(SIGNING_DOMAINS.grant, { ...grant, machine: REF_VM_BUILD, machineKey: await kid('vmBuild') }, k.a1StepUp.privateKey, k.a1StepUp.pub),
    ok(),
  );
  await recordCase('a grant on an unlisted machine', 'verifyGrant', await signRecord(SIGNING_DOMAINS.grant, { ...grant, machine: REF_GHOST }, k.a1StepUp.privateKey, k.a1StepUp.pub), no('not-listed'));
  // A grant names the machine key it was made for: after a rotation, a grant for the old key is refused.
  const rotatedAway = "a successor rotating a machine's key and revoking the old one";
  await recordCase("a grant for a machine's key it has rotated away from", 'verifyGrant', await signRecord(SIGNING_DOMAINS.grant, grant, k.a1StepUp.privateKey, k.a1StepUp.pub), no('not-listed'), [], rotatedAway);
  await recordCase("a grant for a machine's rotated key", 'verifyGrant', await signRecord(SIGNING_DOMAINS.grant, { ...grant, machineKey: await kid('miniRotated') }, k.a1StepUp.privateKey, k.a1StepUp.pub), ok(), [], rotatedAway);
  await recordCase("a grant signed by a revoked device's key", 'verifyGrant', await signRecord(SIGNING_DOMAINS.grant, { ...grant, member: A }, k.b1StepUp.privateKey, k.b1StepUp.pub), no('revoked'), [], 'v4 b1 revoked');
  {
    const g = await signRecord(SIGNING_DOMAINS.grant, grant, k.a1StepUp.privateKey, k.a1StepUp.pub);
    await recordCase('a grant whose rights changed after signing', 'verifyGrant', { body: { ...grant, rights: ['spawn', 'shell'] }, sig: g.sig }, no('bad-signature'));
  }
  {
    // A grant for a VM under a delegation (O10 M1): for its live certificate's key, signed by its delegation's owners
    // (here the org's: its admins).
    const vmGrant: Grant = { ...grant, machine: REF_VM1, machineKey: await kid('vm1') };
    const withCert = [bundle([fixture('cert vm-1')]), NOW];
    await recordCase('a grant for a certified VM, signed by an admin of its org-owned delegation', 'verifyGrant', await signRecord(SIGNING_DOMAINS.grant, vmGrant, k.a1StepUp.privateKey, k.a1StepUp.pub), ok(), withCert);
    await recordCase('a grant for a certified VM, signed by a member who owns no part of it', 'verifyGrant', await signRecord(SIGNING_DOMAINS.grant, vmGrant, k.b1StepUp.privateKey, k.b1StepUp.pub), no('unknown-signer'), withCert);
    await recordCase("a grant for a certified VM's other key", 'verifyGrant', await signRecord(SIGNING_DOMAINS.grant, { ...vmGrant, machineKey: await kid('vm1Rival') }, k.a1StepUp.privateKey, k.a1StepUp.pub), no('not-listed'), withCert);
    await recordCase('a grant for a certified VM without its certificate', 'verifyGrant', await signRecord(SIGNING_DOMAINS.grant, vmGrant, k.a1StepUp.privateKey, k.a1StepUp.pub), no('not-listed'), [bundle(), NOW]);
  }

  const certBody: MachineCert = { org: ORG, machine: REF_VM1, name: 'vm-1', pub: k.vm1.pub, delegation: DLG_VM, use: 1, issued: at(3) };
  const cert = await signRecord(SIGNING_DOMAINS.machineCert, certBody, k.delegation.privateKey, k.delegation.pub);
  const certCase = (name: string, record: unknown, expect: Verdict, now = NOW, state = 'v2') => recordCase(name, 'verifyMachineCert', record, expect, [now], state);
  await certCase('a machine certificate under a live delegation', cert, ok());
  keep('cert vm-1', cert);
  await certCase('a machine certificate after its delegation is removed', cert, no('not-listed'), NOW, 'v2 without the delegation');
  await certCase('a machine certificate after its delegation expires', cert, no('expired'), LATER);
  await certCase('a machine certificate past its delegation\'s uses', await signRecord(SIGNING_DOMAINS.machineCert, { ...certBody, use: 4 }, k.delegation.privateKey, k.delegation.pub), no('expired'));
  await certCase('a machine certificate outside the prefix', await signRecord(SIGNING_DOMAINS.machineCert, { ...certBody, name: 'box-1' }, k.delegation.privateKey, k.delegation.pub), no('unknown-signer'));
  await certCase('a machine certificate under an enrolled name', await signRecord(SIGNING_DOMAINS.machineCert, { ...certBody, name: 'mini' }, k.delegation.privateKey, k.delegation.pub), no('unknown-signer'));
  await certCase('a machine certificate under its prefix in another case', await signRecord(SIGNING_DOMAINS.machineCert, { ...certBody, name: 'VM-1' }, k.delegation.privateKey, k.delegation.pub), ok());
  await certCase("a machine certificate whose ref is not its delegation's", await signRecord(SIGNING_DOMAINS.machineCert, { ...certBody, machine: REF_VM_BUILD, name: 'vm-2' }, k.delegation.privateKey, k.delegation.pub), no('unknown-signer'));
  await certCase('a machine certificate for a ref a state entry holds', cert, no('contested'), NOW, 'v3 vm-1 enrolled');
  await certCase('a machine certificate signed by another key', await signRecord(SIGNING_DOMAINS.machineCert, certBody, k.stranger.privateKey, k.stranger.pub), no('unknown-signer'));
  await certCase('a machine certificate whose key changed after signing', { body: { ...certBody, pub: k.stranger.pub }, sig: cert.sig }, no('bad-signature'));

  const listing: Listing = { org: ORG, machine: REF_MINI, session: 'b1f0c3a2-5d6e-4f70-8a9b-0c1d2e3f4a5b', revision: 1, issued: at(3), fields: { owners: [A], project: PROJECT, lane: 'B', state: 'waiting', title: 'fix the build' } };
  const vmListing: Listing = { ...listing, machine: REF_VM1, fields: { ...listing.fields, owners: [A, B] } };
  const certs = bundle([fixture('cert vm-1')]);
  {
    // A rival certificate claiming vm-1's ref with another key: the ref is contested, and refused for both claimants.
    keep('cert vm-1 rival', await signRecord(SIGNING_DOMAINS.machineCert, { ...certBody, pub: k.vm1Rival.pub, use: 2 }, k.delegation.privateKey, k.delegation.pub));
  }
  const contested = bundle([fixture('cert vm-1'), fixture('cert vm-1 rival')]);
  const listingCase = (name: string, record: unknown, expect: Verdict, withCerts: Arg = bundle(), state = 'v2') => recordCase(name, 'verifyListing', record, expect, [withCerts, NOW], state);
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
  await listingCase('a listing of an unlisted machine', await signRecord(SIGNING_DOMAINS.listing, { ...listing, machine: REF_GHOST }, k.mini.privateKey, k.mini.pub), no('not-listed'));

  const endpoint: EndpointRecord = { org: ORG, machine: REF_MINI, addresses: ['wss://100.64.0.7:7420'], issued: at(3) };
  const endpointCase = (name: string, record: unknown, expect: Verdict, withCerts: Arg = bundle(), state = 'v2') => recordCase(name, 'verifyEndpointRecord', record, expect, [withCerts, NOW], state);
  const miniEndpoint = await signRecord(SIGNING_DOMAINS.endpoint, endpoint, k.mini.privateKey, k.mini.pub);
  await endpointCase('an endpoint record signed by its listed machine', miniEndpoint, ok());
  await endpointCase('an endpoint record signed by a certified VM', await signRecord(SIGNING_DOMAINS.endpoint, { ...endpoint, machine: REF_VM1 }, k.vm1.privateKey, k.vm1.pub), ok(), certs);
  await endpointCase(
    "a VM's endpoint record after its delegation is removed",
    await signRecord(SIGNING_DOMAINS.endpoint, { ...endpoint, machine: REF_VM1 }, k.vm1.privateKey, k.vm1.pub),
    no('not-listed'),
    certs,
    'v2 without the delegation',
  );
  await endpointCase('an endpoint record whose addresses changed after signing', { body: { ...endpoint, addresses: ['wss://203.0.113.9:7420'] }, sig: miniEndpoint.sig }, no('bad-signature'));
  await endpointCase('an endpoint record signed as a listing', { body: endpoint, sig: (await signRecord(SIGNING_DOMAINS.listing, endpoint, k.mini.privateKey, k.mini.pub)).sig }, no('bad-signature'));

  {
    // Records RFC 8785 cannot write, and certificate lists that are not lists.
    const g = fixtures['a grant signed by the machine owner'] as Signed<Grant>;
    await recordCase('a grant with a lone surrogate', 'verifyGrant', { body: { ...g.body, org: LONE }, sig: g.sig }, no('malformed'));
    await certCase('a machine certificate with a lone surrogate', { body: { ...certBody, delegation: LONE }, sig: cert.sig }, no('malformed'));
    await listingCase('a listing with a lone surrogate', { body: { ...listing, fields: { ...listing.fields, title: LONE } }, sig: mini.sig }, no('malformed'));
    await listingCase('a listing whose certificates are not a list', mini, no('malformed'), 'none');
    await endpointCase('an endpoint record with a lone surrogate', { body: { ...endpoint, addresses: [LONE] }, sig: miniEndpoint.sig }, no('malformed'));
    await listingCase("a listing of a contested ref", await signRecord(SIGNING_DOMAINS.listing, vmListing, k.vm1.privateKey, k.vm1.pub), no('contested'), contested);
    await endpointCase("an endpoint record of a contested ref", await signRecord(SIGNING_DOMAINS.endpoint, { ...endpoint, machine: REF_VM1 }, k.vm1Rival.privateKey, k.vm1Rival.pub), no('contested'), contested);
  }
  // Log events in PROJECT, against v2.
  const ctx = { org: ORG, project: PROJECT };
  const say = { ts: at(4).replace(':00.000Z', ':01.234Z'), created: at(4).replace(':00.000Z', ':01.000Z'), writer: 'mini/67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b', seq: 42, kind: 'say', from: 'maws-45', to: '*', text: 'the build is green' };
  const eventCase = async (name: string, event: unknown, expect: Verdict, at: { org?: string; project?: string; state?: string; certs?: Arg } = {}) => {
    keep(name, event);
    cases.push({ name, call: 'verifyEvent', args: [{ org: at.org ?? ORG, project: at.project ?? PROJECT }, stateOf(at.state ?? 'v2'), fixture(name), at.certs ?? bundle(), NOW], expect });
  };
  const machineSay = await signEvent(ctx, say, k.mini.privateKey, k.mini.pub);
  await eventCase("a machine's event signed by its key", machineSay, ok());
  cases.push({ name: "a machine's event replayed into another project", call: 'verifyEvent', args: [{ org: ORG, project: 'proj-2' }, stateOf('v2'), fixture("a machine's event signed by its key"), bundle(), NOW], expect: no('bad-signature') });
  {
    // Another org's state that lists the same key: the event, signed for ORG, does not verify there.
    const other = clone(v2State);
    other.org = 'org-other';
    keep('v2 of another org', { state: other, sigs: [] });
    cases.push({ name: "a machine's event replayed into another org", call: 'verifyEvent', args: [{ org: 'org-other', project: PROJECT }, stateOf('v2 of another org'), fixture("a machine's event signed by its key"), bundle(), NOW], expect: no('bad-signature') });
    cases.push({ name: "an event judged against another org's state", call: 'verifyEvent', args: [{ org: 'org-other', project: PROJECT }, stateOf('v2'), fixture("a machine's event signed by its key"), bundle(), NOW], expect: no('malformed') });
  }
  await eventCase("a machine's event whose text changed after signing", { ...machineSay, text: 'the build is red' }, no('bad-signature'));
  await eventCase("a machine's event whose seq changed after signing", { ...machineSay, seq: 43 }, no('bad-signature'));
  await eventCase("a machine's event signed by another key", await signEvent(ctx, say, k.stranger.privateKey, k.stranger.pub), no('unknown-signer'));
  const vmSay = await signEvent(ctx, { ...say, writer: 'vm-1/0b9c8d7e-6f5a-4b3c-2d1e-0f9a8b7c6d5e' }, k.vm1.privateKey, k.vm1.pub);
  await eventCase("a certified VM's event", vmSay, ok(), { certs });
  await eventCase("a VM's event without its certificate", vmSay, no('unknown-signer'));
  await eventCase("a VM's event after its delegation is revoked", vmSay, no('revoked'), { certs, state: 'v2 without the delegation' });
  await eventCase("a machine's event under its renamed machine's old name", machineSay, ok(), { state: 'v3 renamed' });
  await eventCase(
    "a machine's event under a name the record gives another ref",
    await signEvent(ctx, { ...say, writer: 'builder/67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b' }, k.mini.privateKey, k.mini.pub),
    no('unknown-signer'),
  );
  await eventCase("a VM's event under a contested ref", vmSay, no('unknown-signer'), { certs: contested });
  await eventCase('an event with a lone surrogate', { ...machineSay, text: LONE }, no('malformed'));
  cases.push({ name: 'an event that is not an object', call: 'verifyEvent', args: [{ org: ORG, project: PROJECT }, stateOf('v2'), null, bundle(), NOW], expect: no('malformed') });
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
  await eventCase('words from a device the head has since revoked', position(human, 7), no('revoked'), { state: 'v6' });

  // Retired and revoked keys' events, judged by the signer's own timestamp.
  await eventCase("a retired machine key's event stamped before its notAfter", machineSay, ok(), { state: 'v3 mini retired' });
  await eventCase(
    "a retired machine key's event stamped after its notAfter",
    await signEvent(ctx, { ...say, ts: LATE, created: LATE, seq: 43 }, k.mini.privateKey, k.mini.pub),
    no('expired'),
    { state: 'v3 mini retired' },
  );
  await eventCase(
    "a retired machine key's event created before its notAfter, its ts after",
    await signEvent(ctx, { ...say, ts: LATE, seq: 44 }, k.mini.privateKey, k.mini.pub),
    ok(),
    { state: 'v3 mini retired' },
  );
  await eventCase(
    "a retired machine key's event created after its notAfter, its ts before",
    await signEvent(ctx, { ...say, created: LATE, seq: 45 }, k.mini.privateKey, k.mini.pub),
    no('expired'),
    { state: 'v3 mini retired' },
  );
  {
    const bare: Record<string, unknown> = { ...say, seq: 46 };
    delete bare.created;
    // Signed below `signEvent`, which refuses to sign it: the signature is good, and only the missing `created` refuses.
    await eventCase("a machine's event without created", { ...bare, sig: await signInput(eventSigningInput(ctx, bare), k.mini.privateKey, k.mini.pub) }, no('malformed'));
    await eventCase("a machine's event whose created is not a time", { ...machineSay, created: 'yesterday' }, no('malformed'));
  }
  await eventCase("a revoked machine key's event", machineSay, no('revoked'), { state: "a successor rotating a machine's key and revoking the old one" });
  await listingCase("a revoked machine key's listing", mini, no('revoked'), bundle(), "a successor rotating a machine's key and revoking the old one");
  {
    const bDraft = { ...draft, member: B, text: 'on my way out' };
    const early = position(await signEvent(ctx, bDraft, k.b1Channel.privateKey, k.b1Channel.pub), 3, B);
    await eventCase("a retired device key's words, created before its notAfter though the hub stamped them after", early, ok(), { state: 'v4 b1 retired' });
    await eventCase(
      "a retired device key's words created after its notAfter",
      position(await signEvent(ctx, { ...bDraft, created: LATE }, k.b1Channel.privateKey, k.b1Channel.pub), 4, B),
      no('expired'),
      { state: 'v4 b1 retired' },
    );
    await eventCase("a revoked device key's words", early, no('revoked'), { state: 'v4 b1 revoked' });
    // B leaves the org; b1's retirement stays, so its words before notAfter still verify. b2 is revoked.
    const b2Keys = await revokedDevice(B, b2Endorsed);
    keep('v5 B removed', await sign(await next(fixtures['v4 b1 retired'] as SignedOrgState, (s) => {
      s.members = s.members.filter((m) => m.id !== B);
      s.revoked.push(...b2Keys);
    }, 4), 'a1StepUp'));
    cases.push({ name: 'a successor removing a member whose device was retired', call: 'verifySuccessor', args: [signed('v4 b1 retired'), signed('v5 B removed'), []], expect: ok() });
    await eventCase("a retired device key's words after its member left", early, ok(), { state: 'v5 B removed' });
    await eventCase("a revoked device key's words after its member left", position(await signEvent(ctx, bDraft, k.b2Channel.privateKey, k.b2Channel.pub), 5, B), no('revoked'), { state: 'v5 B removed' });
  }
  cases.push({
    name: "a rotated machine's writer: its current key, and its retired one until notAfter",
    call: 'signerFor',
    args: [stateOf('v3 mini retired'), 'mini/human', bundle(), NOW],
    expect: { signers: [{ pub: k.miniRotated.pub, notAfter: null }, { pub: k.mini.pub, notAfter: RETIRE_AT }] },
  });

  // A delegation certificate's retirement: a record its own delegation key signs, or an admin's edit of the state, which
  // also revokes one (RL DL 24).
  {
    const retirement = { org: ORG, keyId: await kid('vm1'), notAfter: RETIRE_AT };
    keep('vm-1 retired by its delegation', await signRecord(SIGNING_DOMAINS.certRetire, retirement, k.delegation.privateKey, k.delegation.pub));
    const retireCase = (name: string, record: Arg, expect: Verdict, withCerts: Arg[] = [fixture('cert vm-1')]) =>
      cases.push({ name, call: 'verifyCertRetirement', args: [stateOf('v2'), record, withCerts], expect });
    retireCase("a certificate's retirement signed by its delegation key", fixture('vm-1 retired by its delegation'), ok());
    keep('vm-1 retired by an admin', await signRecord(SIGNING_DOMAINS.certRetire, retirement, k.a1StepUp.privateKey, k.a1StepUp.pub));
    retireCase("a certificate's retirement record signed by an admin device", fixture('vm-1 retired by an admin'), no('unknown-signer'));
    keep('vm-1 retired by a stranger', await signRecord(SIGNING_DOMAINS.certRetire, retirement, k.stranger.privateKey, k.stranger.pub));
    retireCase("a certificate's retirement signed by another key", fixture('vm-1 retired by a stranger'), no('unknown-signer'));
    retireCase("a certificate's retirement by a delegation key, the certificate unknown", fixture('vm-1 retired by its delegation'), no('unknown-signer'), []);
    const vm1Revoked = { keyId: await kid('vm1'), holder: { machine: REF_VM1 } };
    const vm1Retired = { keyId: await kid('vm1'), pub: k.vm1.pub, notAfter: RETIRE_AT, holder: { machine: REF_VM1 } };
    await successorCase("a successor revoking a certificate's key", await next(v2, (s) => s.revoked.push(vm1Revoked), 2), ['a1StepUp'], ok());
    keep('v3 vm-1 revoked', fixtures["a successor revoking a certificate's key"]);
    await successorCase("a successor retiring a certificate's key", await next(v2, (s) => s.retired.push(vm1Retired), 2), ['a1StepUp'], ok());
    keep('v3 vm-1 retired by an admin', fixtures["a successor retiring a certificate's key"]);
    await certCase("a machine certificate whose key the state retired", cert, no('expired'), NOW, 'v3 vm-1 retired by an admin');
    const adminRetired = fixtures["a successor retiring a certificate's key"] as SignedOrgState;
    await successorCase("then its delegation revoked, the certificate's key left retired", await next(adminRetired, (s) => {
      s.delegations = [];
      s.revoked.push(dlgRevoked);
    }, 3), ['a1StepUp'], no('malformed'), 'v3 vm-1 retired by an admin');
    await successorCase("then its delegation revoked, the certificate's key revoked with it", await next(adminRetired, (s) => {
      s.delegations = [];
      s.retired = [];
      s.revoked.push(dlgRevoked, vm1Revoked);
    }, 3), ['a1StepUp'], ok(), 'v3 vm-1 retired by an admin');
    keep('v4 vm-1 and its delegation revoked', fixtures["then its delegation revoked, the certificate's key revoked with it"]);
    await eventCase("an admin-retired certificate's event after its delegation is revoked", vmSay, no('revoked'), { state: 'v4 vm-1 and its delegation revoked', certs });
    await successorCase("then a delegation reissuing the old VM's key under the revoked prefix", await next(fixtures['v4 vm-1 and its delegation revoked'] as SignedOrgState, (s) => s.delegations.push({ ...dlgB, prefix: 'vm-' }), 4), ['a1StepUp'], no('malformed'), 'v4 vm-1 and its delegation revoked');
    await certCase("a machine certificate whose key the state revoked", cert, no('revoked'), NOW, 'v3 vm-1 revoked');
    await successorCase('a successor retiring an unknown key under a device', await next(v2, (s) => s.retired.push({ ...vm1Retired, holder: { member: A, device: 'dev-gone', class: 'native-mac', key: 'channel' } }), 2), ['a1StepUp'], no('malformed'));
    await successorCase("a successor revoking an unknown key under a device", await next(v2, (s) => s.revoked.push({ ...vm1Revoked, holder: { member: A, device: 'dev-gone', class: 'native-mac', key: 'channel' } }), 2), ['a1StepUp'], no('malformed'));

    const retired = bundle([fixture('cert vm-1')], [fixture('vm-1 retired by its delegation')]);
    await eventCase("a retired certificate's event stamped before its notAfter", vmSay, ok(), { certs: retired });
    await eventCase(
      "a retired certificate's event stamped after its notAfter",
      await signEvent(ctx, { ...say, writer: vmSay.writer, ts: LATE, created: LATE, seq: 43 }, k.vm1.privateKey, k.vm1.pub),
      no('expired'),
      { certs: retired },
    );
    await listingCase("a retired certificate's listing", await signRecord(SIGNING_DOMAINS.listing, vmListing, k.vm1.privateKey, k.vm1.pub), no('not-listed'), retired);
    await eventCase("a revoked certificate's event", vmSay, no('revoked'), { state: 'v3 vm-1 revoked', certs });
    await eventCase("a revoked certificate's event beside its delegation's retirement", vmSay, no('revoked'), { state: 'v3 vm-1 revoked', certs: retired });
    await listingCase("a revoked certificate's listing", await signRecord(SIGNING_DOMAINS.listing, vmListing, k.vm1.privateKey, k.vm1.pub), no('revoked'), certs, 'v3 vm-1 revoked');
    await eventCase("an admin-retired certificate's event stamped before its notAfter", vmSay, ok(), { state: 'v3 vm-1 retired by an admin', certs });
    await eventCase("an admin-retired certificate's event stamped after its notAfter", await signEvent(ctx, { ...say, writer: vmSay.writer, ts: LATE, created: LATE, seq: 43 }, k.vm1.privateKey, k.vm1.pub), no('expired'), { state: 'v3 vm-1 retired by an admin', certs });
    keep('vm-1 retired late by its delegation', await signRecord(SIGNING_DOMAINS.certRetire, { ...retirement, notAfter: LATER }, k.delegation.privateKey, k.delegation.pub));
    await eventCase(
      "an admin-retired certificate's late event beside a later retirement by its delegation",
      await signEvent(ctx, { ...say, writer: vmSay.writer, ts: LATE, created: LATE, seq: 43 }, k.vm1.privateKey, k.vm1.pub),
      no('expired'),
      { state: 'v3 vm-1 retired by an admin', certs: bundle([fixture('cert vm-1')], [fixture('vm-1 retired late by its delegation')]) },
    );

    // A recreated VM takes the retired one's name under a new ref; unretired, the two contest the name.
    keep('cert vm-1 next', await signRecord(SIGNING_DOMAINS.machineCert, { ...certBody, machine: REF_VM1_NEXT, pub: k.vm1Next.pub, use: 2 }, k.delegation.privateKey, k.delegation.pub));
    const nextListing = await signRecord(SIGNING_DOMAINS.listing, { ...vmListing, machine: REF_VM1_NEXT }, k.vm1Next.privateKey, k.vm1Next.pub);
    await listingCase("a recreated VM's listing under its predecessor's retired name", nextListing, ok(), bundle([fixture('cert vm-1'), fixture('cert vm-1 next')], [fixture('vm-1 retired by its delegation')]));
    await listingCase("a recreated VM's listing beside its unretired predecessor", nextListing, no('contested'), bundle([fixture('cert vm-1'), fixture('cert vm-1 next')]));

    const vmListingSigned = await signRecord(SIGNING_DOMAINS.listing, vmListing, k.vm1.privateKey, k.vm1.pub);
    const lateVmSay = await signEvent(ctx, { ...say, writer: vmSay.writer, ts: LATE, created: LATE, seq: 43 }, k.vm1.privateKey, k.vm1.pub);

    // A retirement binds to the certificates of its own signer's delegation: delegation B's holder can't retire vm-1,
    // certified under the first, by a certificate-shaped object or a certificate of its own carrying vm-1's key.
    keep('vm-1 retired by delegation B', await signRecord(SIGNING_DOMAINS.certRetire, retirement, k.delegationB.privateKey, k.delegationB.pub));
    keep('a certificate-shaped vm-1 naming delegation B', { body: { ...certBody, name: 'box-1', machine: REF_VM1_B, delegation: DLG_B }, sig: cert.sig });
    keep('cert vm-1 under delegation B', await signRecord(SIGNING_DOMAINS.machineCert, { ...certBody, name: 'box-1', machine: REF_VM1_B, delegation: DLG_B }, k.delegationB.privateKey, k.delegationB.pub));
    const onB = (name: string, record: Arg, expect: Verdict, withCerts: Arg[]) =>
      cases.push({ name, call: 'verifyCertRetirement', args: [stateOf('v3 with a second delegation'), record, withCerts], expect });
    onB("a retirement by another delegation, through a certificate-shaped object", fixture('vm-1 retired by delegation B'), no('unknown-signer'), [fixture('a certificate-shaped vm-1 naming delegation B')]);
    onB('a retirement by another delegation of its own certificate of the key', fixture('vm-1 retired by delegation B'), ok(), [fixture('cert vm-1 under delegation B')]);
    await listingCase(
      "a VM's listing beside another delegation's retirement, through a certificate-shaped object",
      vmListingSigned,
      ok(),
      bundle([fixture('cert vm-1'), fixture('a certificate-shaped vm-1 naming delegation B')], [fixture('vm-1 retired by delegation B')]),
      'v3 with a second delegation',
    );
    await listingCase(
      "a VM's listing beside another delegation's retirement of its own certificate of the key",
      vmListingSigned,
      ok(),
      bundle([fixture('cert vm-1 under delegation B'), fixture('cert vm-1')], [fixture('vm-1 retired by delegation B')]),
      'v3 with a second delegation',
    );
    await eventCase("a VM's late event beside another delegation's retirement of its own certificate of the key", lateVmSay, ok(), {
      state: 'v3 with a second delegation',
      certs: bundle([fixture('cert vm-1 under delegation B'), fixture('cert vm-1')], [fixture('vm-1 retired by delegation B')]),
    });

    // Delegation B can't take vm-1's ref, even by a certificate it retires at once with a future notAfter: a
    // certificate's ref starts with its own delegation's id (RL DL 25), judged on the certificate alone.
    keep('cert on vm-1 ref under delegation B', await signRecord(SIGNING_DOMAINS.machineCert, { ...certBody, name: 'box-2', pub: k.vm1Rival.pub, delegation: DLG_B }, k.delegationB.privateKey, k.delegationB.pub));
    keep('box-2 retired late by delegation B', await signRecord(SIGNING_DOMAINS.certRetire, { org: ORG, keyId: await kid('vm1Rival'), notAfter: LATER }, k.delegationB.privateKey, k.delegationB.pub));
    const crossRef = bundle([fixture('cert vm-1'), fixture('cert on vm-1 ref under delegation B')], [fixture('box-2 retired late by delegation B')]);
    await certCase("a certificate claiming another delegation's ref", fixtures['cert on vm-1 ref under delegation B'], no('unknown-signer'), NOW, 'v3 with a second delegation');
    await listingCase("a VM's listing beside another delegation's retired certificate of its ref", vmListingSigned, ok(), crossRef, 'v3 with a second delegation');
    await eventCase(
      "another delegation's retired certificate of a VM's ref, its event",
      await signEvent(ctx, { ...say, writer: 'box-2/0b9c8d7e-6f5a-4b3c-2d1e-0f9a8b7c6d5e' }, k.vm1Rival.privateKey, k.vm1Rival.pub),
      no('unknown-signer'),
      { state: 'v3 with a second delegation', certs: crossRef },
    );
    // Within one delegation a retired claim on a ref stays legitimate: a key rotation is a new certificate of the ref.
    keep('cert vm-1 rotated', await signRecord(SIGNING_DOMAINS.machineCert, { ...certBody, pub: k.vm1Next.pub, use: 2 }, k.delegation.privateKey, k.delegation.pub));
    await listingCase(
      "a VM's listing under its rotated certificate, the old one retired",
      await signRecord(SIGNING_DOMAINS.listing, vmListing, k.vm1Next.privateKey, k.vm1Next.pub),
      ok(),
      bundle([fixture('cert vm-1'), fixture('cert vm-1 rotated')], [fixture('vm-1 retired by its delegation')]),
    );

    // A ref an entry holds, claimed by a live certificate, is contested for every claimant, the entry included; only
    // an authenticated, live certificate contests. vm-1 enrolling natively under its certificate's ref is refused (RL
    // DL 26: no entry's ref takes a known delegation's `<id>_` shape), so these vectors judge a state no valid chain
    // reaches, and show the record and event rules hold regardless.
    const vm1Host = { name: 'host-1', ref: REF_VM1, pub: k.newcomer.pub, owners: [A] };
    const hosted = await sign(await next(v2, (s) => {
      s.machines.push(vm1Host);
      s.machineNames.push({ name: 'host-1', ref: REF_VM1 });
    }, 2), 'a1StepUp');
    keep('v3 vm-1 enrolled', hosted);
    cases.push({ name: "a successor enrolling a VM under its certificate's ref", call: 'verifySuccessor', args: [signed('v2'), signed('v3 vm-1 enrolled'), []], expect: no('malformed') });
    keep('v4 vm-1 enrolled, its certificate revoked', await sign(await next(hosted, (s) => s.revoked.push(vm1Revoked), 3), 'a1StepUp'));
    keep('a forged cert vm-1', { body: certBody, sig: (await signRecord(SIGNING_DOMAINS.machineCert, certBody, k.stranger.privateKey, k.stranger.pub)).sig });
    const host = 'v3 vm-1 enrolled';
    const hostListing = await signRecord(SIGNING_DOMAINS.listing, vmListing, k.newcomer.privateKey, k.newcomer.pub);
    const hostEndpoint = await signRecord(SIGNING_DOMAINS.endpoint, { ...endpoint, machine: REF_VM1 }, k.newcomer.privateKey, k.newcomer.pub);
    const hostSay = await signEvent(ctx, { ...say, writer: 'host-1/67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b' }, k.newcomer.privateKey, k.newcomer.pub);
    await listingCase("an enrolled machine's listing while a live certificate claims its ref", hostListing, no('contested'), certs, host);
    await listingCase("an enrolled machine's listing beside its retired certificate", hostListing, ok(), retired, host);
    await endpointCase("an enrolled machine's endpoint record while a live certificate claims its ref", hostEndpoint, no('contested'), certs, host);
    await eventCase("an enrolled machine's event while a live certificate claims its ref", hostSay, no('unknown-signer'), { state: host, certs });
    await eventCase("an enrolled machine's event beside its retired certificate", hostSay, ok(), { state: host, certs: retired });
    const keysCase = (name: string, withCerts: Arg, expect: { keys: B64[]; contested: boolean }) =>
      cases.push({ name, call: 'machineKeys', args: [stateOf(host), REF_VM1, withCerts, NOW], expect });
    keysCase("an enrolled machine's keys", bundle(), { keys: [k.newcomer.pub], contested: false });
    keysCase("an enrolled machine's keys while a live certificate claims its ref", certs, { keys: [], contested: true });
    keysCase("an enrolled machine's keys beside its retired certificate", retired, { keys: [k.newcomer.pub], contested: false });
    const contestCase = (name: string, withCerts: Arg, refs: string[], now = NOW, state = host) => cases.push({ name, call: 'contestedRefs', args: [stateOf(state), withCerts, now], expect: { refs } });
    contestCase("contested refs: a live certificate on an entry's ref", certs, [REF_VM1]);
    contestCase("contested refs: a forged certificate on an entry's ref", bundle([fixture('a forged cert vm-1')]), []);
    contestCase("contested refs: an expired certificate on an entry's ref", certs, [], LATER);
    contestCase("contested refs: a retired certificate on an entry's ref", retired, []);
    contestCase("contested refs: a revoked certificate on an entry's ref", certs, [], NOW, 'v4 vm-1 enrolled, its certificate revoked');

    // An expired certificate and its renewal under another delegation: the event verifies under the renewal. The state
    // gives both delegations one prefix, which no valid chain reaches (RL DL 25); verifyEvent's rule holds regardless.
    const renewal = clone(v2State);
    renewal.delegations[0].expires = RETIRE_AT;
    renewal.delegations.push({ ...dlgB, prefix: 'vm-' });
    keep('v2 with a renewal delegation', { state: renewal, sigs: [] });
    keep('cert vm-1 renewed under delegation B', await signRecord(SIGNING_DOMAINS.machineCert, { ...certBody, machine: REF_VM1_B, delegation: DLG_B, issued: at(5) }, k.delegationB.privateKey, k.delegationB.pub));
    await eventCase("a VM's event after its certificate expired, under its renewal", lateVmSay, ok(), { state: 'v2 with a renewal delegation', certs: bundle([fixture('cert vm-1'), fixture('cert vm-1 renewed under delegation B')]) });
    await eventCase("a VM's event after its certificate expired, without its renewal", lateVmSay, no('expired'), { state: 'v2 with a renewal delegation', certs: bundle([fixture('cert vm-1')]) });

    // A retired certificate keeps its history when its ref is enrolled later; a live one is refused.
    await eventCase("a retired certificate's event, its ref enrolled since", vmSay, ok(), { state: host, certs: retired });
    await eventCase("a retired certificate's late event, its ref enrolled since", lateVmSay, no('expired'), { state: host, certs: retired });
    await eventCase("a live certificate's event, its ref enrolled since", vmSay, no('unknown-signer'), { state: host, certs });
  }

  // Who may sign as a writer.
  const signerCase = (name: string, state: string, writer: string, keys: B64[], withCerts: Arg = bundle(), notAfter: string | null = null) =>
    cases.push({ name, call: 'signerFor', args: [stateOf(state), writer, withCerts, NOW], expect: { signers: keys.map((pub) => ({ pub, notAfter })) } });
  signerCase("a member's writer: their devices' channel keys, the web-cards phone excepted", 'v2', `hub/${A}`, [k.a1Channel.pub]);
  signerCase("a listed machine's writer: its key", 'v2', 'mini/67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b', [k.mini.pub]);
  signerCase("a certified VM's writer: its certificate's key", 'v2', 'vm-1/human', [k.vm1.pub], certs, DELEGATION_EXPIRES);
  signerCase('a legacy writer: no key', 'v2', 'legacy/chat', []);
  signerCase("a contested ref's writer: no key", 'v2', 'vm-1/human', [], contested);
  signerCase("a renamed machine's old name: its ref's key", 'v3 renamed', 'mini/human', [k.mini.pub]);
  signerCase("a renamed machine's new name: its ref's key", 'v3 renamed', 'studio/human', [k.mini.pub]);
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

  const remote = await buildRemoteScenario(k, fixtures);
  cases.push(...remote.cases);
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
    actions: remote.actions,
  };
  // The enrollment MAC's encoding: fields that plain concatenation would run together encode apart.
  const pairing = new Uint8Array(32).map((_, i) => i);
  const enrollment: EnrollmentCase[] = [];
  for (const [name, ref, tokenId] of [
    ['ab', 'cdeeeeeeeeeeeeee', 'enroll-1'],
    ['a', 'bcdeeeeeeeeeeeeee', 'enroll-1'],
    ['ab', 'cdeeeeeeeeeeeeeex', 'enroll-1'],
    ['ab', 'cdeeeeeeeeeeeeee', 'xenroll-1'],
  ] as const) {
    const fields = { name, machinePub: k.vm1.pub, ref, tokenId };
    enrollment.push({ ...fields, k: base64urlEncode(pairing), input: base64urlEncode(enrollmentMacInput(fields)), mac: await enrollmentMac(pairing, fields) });
  }
  // A phone's pairing under a code A's first Mac shows.
  const pairingK = new Uint8Array(16).map((_, i) => 0xa0 + i);
  const decoded: PairingCode = { hub: 'https://desk.example', org: ORG, member: A, roots: [await kid('a1StepUp')], recoveryPub: k.recovery.pub, k: base64urlEncode(pairingK) };
  const phoneEntry: PairingFields['device'] = {
    id: 'dev-a-phone-2',
    class: 'web-cards',
    keyStorage: 'webcrypto',
    channelPub: k.aPhone.pub,
    passkey: { credentialId: base64urlEncode(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])), publicKey: k.aPasskey.pub, rpId: RP_ID },
  };
  const pairFields: PairingFields = { org: ORG, member: A, device: phoneEntry };
  const swappedFields: PairingFields = { ...pairFields, device: { ...phoneEntry, passkey: { credentialId: base64urlEncode(Uint8Array.from([8, 7, 6, 5])), publicKey: k.stranger.pub, rpId: RP_ID } } };
  const devicePairing: PairingVector = {
    code: encodePairingCode(decoded),
    decoded,
    fields: pairFields,
    input: base64urlEncode(pairingMacInput(pairFields)),
    mac: await pairingMac(pairingK, pairFields),
    fingerprint: await pairingFingerprint(ORG, A, phoneEntry),
    swapped: { fields: swappedFields, mac: await pairingMac(pairingK, swappedFields), fingerprint: await pairingFingerprint(ORG, A, swappedFields.device) },
  };
  return { fixtures, cases, dual, encodings, enrollment, pairing: devicePairing, provisioning: await provisioningVector(k), channel: remote.channel, history: await buildHistoryScenario(k) };
}

/** The provisioning codes under the scenario's delegation, and the decoder's refusals of texts around them. */
async function provisioningVector(k: Keys): Promise<ProvisioningVector> {
  const privateJwk = (await crypto.subtle.exportKey('jwk', k.delegation.privateKey)) as JsonWebKey;
  const plain: ProvisioningCodeV2 = {
    hub: 'https://desk.example',
    org: ORG,
    roots: [await keyId(k.a1StepUp.pub)],
    recoveryPub: k.recovery.pub,
    token: 'provisioning-token-vm',
    delegation: { id: DLG_VM, prefix: 'vm-', privateJwk },
  };
  // A fixed key (0x40, 0x41, …): the push scan's allowlist names this value (.github/maws-app/gitleaks.toml).
  const legacy: ProvisioningCodeV2 = { ...plain, legacy: { org: ORG, key: base64urlEncode(new Uint8Array(32).map((_, i) => 0x40 + i)) } };
  const wrap = (body: string) => PROVISIONING_CODE_V2_PREFIX + base64urlEncode(new TextEncoder().encode(body));
  const publicJwk: JsonWebKey = { ...privateJwk };
  delete publicJwk.d;
  const without = (field: keyof ProvisioningCodeV2) => {
    const code: Record<string, unknown> = { ...plain };
    delete code[field];
    return code;
  };
  const refusals: Array<[string, string, string]> = [
    ['another prefix', `smns-provision-v1.${encodeProvisioningCodeV2(plain).slice(PROVISIONING_CODE_V2_PREFIX.length)}`, 'not smns-provision-v2'],
    ['not JSON', wrap('{"hub":'), 'damaged'],
    ['no token', wrap(JSON.stringify(without('token'))), 'no token'],
    ['an unknown field', wrap(JSON.stringify({ ...plain, machine: 'vm-one' })), 'unknown field machine'],
    ['a public key for the delegation key', wrap(JSON.stringify({ ...plain, delegation: { ...plain.delegation, privateJwk: publicJwk } })), 'bad delegation.privateJwk'],
    ['a legacy key of 128 bits', wrap(JSON.stringify({ ...plain, legacy: { org: ORG, key: base64urlEncode(new Uint8Array(16)) } })), 'bad legacy.key'],
  ];
  return {
    codes: [
      { name: 'a code without the legacy key', text: encodeProvisioningCodeV2(plain), decoded: plain },
      { name: 'a code carrying the legacy key', text: encodeProvisioningCodeV2(legacy), decoded: legacy },
    ],
    refusals: refusals.map(([name, text, reason]) => ({ name, text, error: `provisioning code: ${reason}` })),
  };
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
