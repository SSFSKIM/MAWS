// The remote layer's vectors beyond O11's (docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md, M1): one org's
// chain built for RL2's channel, RL4's action and RL9's attestation, with their cases. scenario.ts runs it after its own
// and writes both into vectors.json; the channel suite builds the same chain with keys of its own (`buildRemoteOrg`).
//
// The org: Alice, the admin, with a Mac (a1) and a web-cards phone holding a passkey; Bob with a Mac (b1, then b2);
// Carol with a Mac (c1). `mini` is Alice's, `builder` the org's, and the `vm-` delegation, with its VM `vm-1`, is Bob's.
//   r1  genesis
//   r2  a project added
//   r3  Bob's second Mac, endorsed by his first
//   r4  Carol removed, her keys revoked; Bob's first Mac retired, its keys good until 05:00
// The channel's transcripts are recorded from a live run of both ends with fixed ephemerals and nonces, so every byte
// but the ECDSA signatures repeats; a replay drives each end against the other's recorded messages.
import { actionDigest, actionFingerprint, actionSigningInput, signStepUp, type Action } from '../src/action.ts';
import { base64urlDecode, base64urlEncode } from '../src/base64url.ts';
import { canonicalize } from '../src/canonical.ts';
import {
  acceptChannel,
  ChannelError,
  deviceMacInput,
  deviceTranscript,
  handshakeSecrets,
  importEphemeral,
  machineMacInput,
  machineTranscript,
  openChannel,
  sharedSecret,
  type ByteDuplex,
  type DeviceIdentity,
  type MachineIdentity,
} from '../src/channel.ts';
import { signEvent } from '../src/events.ts';
import { REKEY_FRAMES, rekeyDirection, sealFrame, type DirectionKeys } from '../src/frames.ts';
import { keyId, signBody, utf8, type B64 } from '../src/keys.ts';
import { endorseDevice, signOrgState, signTransition, stateHash } from '../src/org-state.ts';
import { memoryOrgView, type OrgView } from '../src/org-view.ts';
import { signRecord } from '../src/records.ts';
import { SIGNING_DOMAINS, type Certificates, type Device, type MachineCert, type OrgState, type RevokedKey, type RootTransition, type Signed, type SignedOrgState } from '../src/types.ts';
import type { Verdict } from '../src/verdict.ts';
import { SoftwareAuthenticator } from '../test-support/authenticator.ts';
import { duplexPair } from '../test-support/tamper-relay.ts';
import type { Arg, Case, KeyName, Keys } from './scenario.ts';

export const ORG_REMOTE = 'org-remote';
const PROJECT = 'proj-1';
const ALICE = '1a1b2c3d4e5f60718293a4b5c6d7e8f9';
const BOB = '2b1b2c3d4e5f60718293a4b5c6d7e8f9';
const CAROL = '3c1b2c3d4e5f60718293a4b5c6d7e8f9';
const REF_MINI = 'mref-mini-0000001';
const REF_BUILDER = 'mref-builder-00001';
const DLG = '0d1e2a3b4c5d6e7f8091a2b3c4d5e6f7';
const REF_VM = `${DLG}_vm1AAAAAAAAAAAAAAAAAAA`;
export const RP_ID = 'desk.example';
export const ORIGIN = 'https://desk.example';
const NOW = '2026-10-28T00:00:00.000Z';
const SESSION = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const at = (hour: number, minute = 0) => `2026-10-27T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const bytes = (fill: number, n: number) => base64urlEncode(new Uint8Array(n).fill(fill));
const ok = (): Verdict => ({ ok: true });
const no = (code: Exclude<Verdict, { ok: true }>['code']): Verdict => ({ ok: false, code });

export type RemoteOrg = {
  id: string;
  members: { A: string; B: string; C: string };
  states: Record<'r1' | 'r2' | 'r3' | 'r4', SignedOrgState>;
  chain: SignedOrgState[];
  certificates: Certificates;
  passkey: { credentialId: B64; publicKey: B64; rpId: string };
};

/** The org's chain r1–r4 and its VM's certificate, signed with `k`. */
export async function buildRemoteOrg(k: Keys): Promise<RemoteOrg> {
  const mac = (id: string, channel: KeyName, stepUp: KeyName): Device => ({ id, class: 'native-mac', keyStorage: 'software', channelPub: k[channel].pub, stepUpPub: k[stepUp].pub });
  const passkey = { credentialId: base64urlEncode(Uint8Array.from([9, 8, 7, 6])), publicKey: k.aPasskey.pub, rpId: RP_ID };
  const a1 = mac('dev-a1', 'a1Channel', 'a1StepUp');
  const phone: Device = { id: 'dev-a-phone', class: 'web-cards', keyStorage: 'webcrypto', channelPub: k.aPhone.pub, passkey };
  const b1 = mac('dev-b1', 'b1Channel', 'b1StepUp');
  const c1 = mac('dev-c1', 'c1Channel', 'c1StepUp');
  const sign = (state: OrgState) => signOrgState(state, [k.a1StepUp]);
  const next = async (head: SignedOrgState, edit: (s: OrgState) => void, hour: number) => {
    const s = clone(head.state);
    s.version += 1;
    s.prev = await stateHash(head.state);
    s.issued = at(hour);
    edit(s);
    return sign(s);
  };
  const keysOf = async (member: string, d: Device) => [
    { keyId: await keyId(d.channelPub), pub: d.channelPub, holder: { member, device: d.id, class: d.class, key: 'channel' as const } },
    ...(d.stepUpPub === undefined ? [] : [{ keyId: await keyId(d.stepUpPub), pub: d.stepUpPub, holder: { member, device: d.id, class: d.class, key: 'step-up' as const } }]),
  ];
  const r1 = await sign({
    org: ORG_REMOTE,
    version: 1,
    prev: null,
    issued: at(0),
    root: { keys: [await keyId(k.a1StepUp.pub)], recoveryPub: k.recovery.pub },
    members: [
      { id: ALICE, email: 'alice@example.com', role: 'admin', devices: [a1, phone] },
      { id: BOB, email: 'bob@example.com', role: 'member', devices: [b1] },
      { id: CAROL, email: 'carol@example.com', role: 'member', devices: [c1] },
    ],
    machines: [
      { name: 'mini', ref: REF_MINI, pub: k.mini.pub, owners: [ALICE] },
      { name: 'builder', ref: REF_BUILDER, pub: k.vmBuild.pub, owners: 'org' },
    ],
    machineNames: [
      { name: 'mini', ref: REF_MINI },
      { name: 'builder', ref: REF_BUILDER },
    ],
    retired: [],
    revoked: [],
    delegations: [{ id: DLG, pub: k.delegation.pub, prefix: 'vm-', expires: '2026-11-27T00:00:00.000Z', maxUses: 3, offlineRevokeS: 3600, owners: [BOB] }],
    projects: [{ id: PROJECT, name: 'one' }],
  });
  const r2 = await next(r1, (s) => s.projects.push({ id: 'proj-2', name: 'two' }), 1);
  const b2: Device = mac('dev-b2', 'b2Channel', 'b2StepUp');
  b2.endorsement = await endorseDevice(ORG_REMOTE, BOB, b2, k.b1StepUp.privateKey, k.b1StepUp.pub);
  const r3 = await next(r2, (s) => s.members[1].devices.push(b2), 2);
  const carolGone: RevokedKey[] = (await keysOf(CAROL, c1)).map(({ keyId: kid, holder }) => ({ keyId: kid, holder }));
  const b1Retired = (await keysOf(BOB, b1)).map((r) => ({ ...r, notAfter: at(5) }));
  const r4 = await next(r3, (s) => {
    s.members = s.members.filter((m) => m.id !== CAROL);
    s.members[1].devices = s.members[1].devices.filter((d) => d.id !== 'dev-b1');
    s.revoked.push(...carolGone);
    s.retired.push(...b1Retired);
  }, 3);
  const cert: MachineCert = { org: ORG_REMOTE, machine: REF_VM, name: 'vm-1', pub: k.vm1.pub, delegation: DLG, use: 1, issued: at(0) };
  return {
    id: ORG_REMOTE,
    members: { A: ALICE, B: BOB, C: CAROL },
    states: { r1, r2, r3, r4 },
    chain: [r1, r2, r3, r4],
    certificates: { certs: [await signRecord(SIGNING_DOMAINS.machineCert, cert, k.delegation.privateKey, k.delegation.pub)], retirements: [] },
    passkey,
  };
}

// ---- The channel's vectors ------------------------------------------------------------------------------------------

/** Base64url of the bytes. */
type Bytes = string;
export type KeysVector = { key: Bytes; iv: Bytes };
/** One handshake's key schedule and transcripts, from its recorded messages (canonical JSON text). */
export type TranscriptVector = {
  name: string;
  deviceEphemeral: JsonWebKey;
  h1: string;
  h2: string;
  h3: string;
  machinePub: B64;
  devicePub: B64;
  salt: Bytes;
  kmR: Bytes;
  kmI: Bytes;
  i2r: KeysVector;
  r2i: KeysVector;
  channelId: B64;
  machineTranscript: string;
  deviceTranscript: string;
  machineMacInput: string;
  deviceMacInput: string;
};
export type HandshakeConnection = {
  ephemeral: JsonWebKey;
  nonce: B64;
  /** The other end's messages, fed in turn: the device's after each of its own, the endpoint's before each of its own. */
  inbound: Bytes[];
  /** What this end sends, compared byte for byte but for each handshake message's `sig` (ECDSA is randomized). */
  outbound: Bytes[];
  expect: { ok: true; channelId: B64 } | { ok: false; reason: string; stateVersion?: number };
};
/** One end's connections against one org view, which carries what each adopted into the next. */
export type HandshakeRun = {
  name: string;
  side: 'device' | 'endpoint';
  /** The view's chain, by fixture name, and its certificates. */
  chain: string[];
  /** The end's long-term key (the device's channel key, the machine's key), a test key. */
  key: JsonWebKey;
  identity: { org: string; member: string; device: string; clientClass: 'native-mac' | 'web-cards'; machine: string } | { ref: string };
  build: string;
  capabilities: string[];
  pageBytes?: number;
  now: string;
  connections: HandshakeConnection[];
  headAfter: number;
};
export type FrameVector = { name: string; keys: KeysVector; epoch: number; seq: number; plaintext: Bytes; frame: Bytes };
export type ReceiveVector = { name: string; keys: KeysVector; start: { epoch: number; seq: number }; frames: Bytes[]; expect: { opened: number; reason?: string } };
export type ChannelVectors = { transcripts: TranscriptVector[]; runs: HandshakeRun[]; frames: FrameVector[]; rekeys: Array<{ keys: KeysVector; next: KeysVector }>; receives: ReceiveVector[] };
/** An action's encodings: its signing input (text), digest and fingerprint. */
export type ActionEncoding = { name: string; action: Action; input: string; digest: B64; fingerprint: B64 };

const keysVector = (k: DirectionKeys): KeysVector => ({ key: base64urlEncode(k.key), iv: base64urlEncode(k.iv) });
const text = (b64: Bytes) => new TextDecoder().decode(base64urlDecode(b64));

type Side = { view: OrgView; chain: string[]; pageBytes?: number; ephemeral: KeyName; nonce: number };
type Recorded = { device: Bytes[]; endpoint: Bytes[]; deviceSettled: number; endpointSettled: number; deviceResult: HandshakeConnection['expect']; endpointResult: HandshakeConnection['expect'] };

/** Both ends over one link, each send logged; each end's messages counted when its handshake settles. */
async function recordConnection(k: Keys, machine: MachineIdentity, device: DeviceIdentity, endpointSide: Side, deviceSide: Side): Promise<Recorded> {
  const [d, e] = duplexPair();
  const log: { device: Bytes[]; endpoint: Bytes[] } = { device: [], endpoint: [] };
  const logged = (io: ByteDuplex, into: Bytes[]): ByteDuplex => ({ ...io, send: (b) => (into.push(base64urlEncode(b)), io.send(b)), onBytes: (l) => io.onBytes(l), onClose: (l) => io.onClose?.(l), close: (r) => io.close(r) });
  const outcome = (error: unknown): HandshakeConnection['expect'] => {
    const failure = error as ChannelError;
    return failure.stateVersion === undefined ? { ok: false, reason: failure.reason } : { ok: false, reason: failure.reason, stateVersion: failure.stateVersion };
  };
  const now = () => new Date(NOW);
  let endpointSettled = 0;
  let deviceSettled = 0;
  const accepting = acceptChannel(logged(e, log.endpoint), machine, endpointSide.view, {
    now,
    pageBytes: endpointSide.pageBytes,
    ephemeral: await importEphemeral(await jwkOf(k, endpointSide.ephemeral)),
    nonce: bytes(endpointSide.nonce, 32),
  }).then(
    async ({ channel, peer }) => {
      endpointSettled = log.endpoint.length;
      await channel.send({ t: 'caps', member: peer.member, device: peer.device, clientClass: peer.clientClass, machine: { grades: [] }, stateVersion: endpointSide.view.head().state.version });
      return { ok: true as const, channelId: channel.id };
    },
    (error) => {
      endpointSettled = log.endpoint.length;
      return outcome(error);
    },
  );
  const opening = openChannel(logged(d, log.device), device, deviceSide.view, {
    now,
    machine: machine.ref,
    pageBytes: deviceSide.pageBytes,
    ephemeral: await importEphemeral(await jwkOf(k, deviceSide.ephemeral)),
    nonce: bytes(deviceSide.nonce, 32),
  }).then(
    (channel) => {
      deviceSettled = log.device.length;
      return { ok: true as const, channelId: channel.id };
    },
    (error) => {
      deviceSettled = log.device.length;
      return outcome(error);
    },
  );
  const [endpointResult, deviceResult] = await Promise.all([accepting, opening]);
  return { ...log, deviceSettled, endpointSettled, deviceResult, endpointResult };
}

/** The private JWK of a scenario key, as the vectors carry a test key. */
async function jwkOf(k: Keys, name: KeyName): Promise<JsonWebKey> {
  const { kty, crv, x, y, d } = await crypto.subtle.exportKey('jwk', k[name].privateKey);
  return { kty, crv, x, y, d };
}

// ---- The scenario ---------------------------------------------------------------------------------------------------

export type RemoteScenario = { cases: Case[]; channel: ChannelVectors; actions: ActionEncoding[] };

/** The remote org's fixtures (kept under `remote …` in `fixtures`) and cases. */
export async function buildRemoteScenario(k: Keys, fixtures: Record<string, unknown>): Promise<RemoteScenario> {
  const org = await buildRemoteOrg(k);
  const cases: Case[] = [];
  const keep = (name: string, value: unknown) => {
    fixtures[name] = value;
    return value;
  };
  for (const [name, state] of Object.entries(org.states)) keep(`remote ${name}`, state);
  keep('remote members', org.members);
  keep('remote certificates', org.certificates);
  const stateOf = (name: string): Arg => ({ $state: `remote ${name}` });
  const fixture = (name: string): Arg => ({ $fixture: name });

  // Actions (RL4).
  const action = (fields: Partial<Action> & Pick<Action, 'device' | 'action' | 'args'>): Action => ({
    v: 1,
    org: ORG_REMOTE,
    machine: REF_MINI,
    opId: `op-${fields.device}-${fields.action}`.replace(/[^A-Za-z0-9_-]/g, '-').padEnd(16, '0'),
    opCreated: at(2, 30),
    nonce: bytes(5, 16),
    created: at(2, 30),
    ...fields,
  });
  const answer = action({
    device: 'dev-a1',
    action: 'session.answer',
    session: SESSION,
    context: { lane: 'B', launchId: 'launch-0001', engineSessionId: 'engine-0001' },
    args: { appSessionId: SESSION, requestId: 'req-1', answer: { behavior: 'allow' } },
    requestDigest: { session: 'engine-0001', request: 'req-1', tool: 'Bash', input_sha256: '9'.repeat(64) },
  });
  const spawn = (device: string, machine = REF_MINI) => action({ device, action: 'sminos.spawn', machine, args: { checkout: '/Users/b/work', brief: 'fix the build', permission_mode: 'default' } });
  const actions: ActionEncoding[] = [];
  for (const [name, a] of [
    ['a lane B answer', answer],
    ['a lane A spawn', spawn('dev-b1')],
  ] as const) {
    actions.push({ name, action: a, input: new TextDecoder().decode(actionSigningInput(a)), digest: base64urlEncode(await actionDigest(a)), fingerprint: await actionFingerprint(a) });
  }
  const stepped = await signStepUp(answer, k.a1StepUp);
  keep("an action's step-up by its device's step-up key", stepped);
  cases.push({ name: "an action's step-up by its device's step-up key", call: 'verifyStepUp', args: [fixture("an action's step-up by its device's step-up key"), k.a1StepUp.pub], expect: ok() });
  cases.push({ name: "an action's step-up checked against another device's key", call: 'verifyStepUp', args: [fixture("an action's step-up by its device's step-up key"), k.b1StepUp.pub], expect: no('bad-signature') });
  for (const [name, opCreated, valid] of [
    ['an action whose opCreated is more than 60 s after its created', '2026-10-27T02:31:00.001Z', false],
    ['an action whose opCreated is 60 s after its created', at(2, 31), true],
  ] as const) {
    keep(name, { ...answer, opCreated });
    cases.push({ name, call: 'isAction', args: [fixture(name)], expect: { valid } });
  }

  // The web-cards answer's WebAuthn assertion, by a software authenticator holding the phone's passkey.
  const phoneAnswer = { ...answer, device: 'dev-a-phone' };
  const digest = await actionDigest(phoneAnswer);
  const phone = new SoftwareAuthenticator(k.aPasskey, org.passkey.credentialId, RP_ID, 4);
  const webauthnCase = async (name: string, assertion: Promise<Action['webauthn']>, last: number, expect: Verdict & { counter?: number }) => {
    keep(name, { ...phoneAnswer, webauthn: await assertion });
    cases.push({ name, call: 'verifyWebAuthn', args: [fixture(name), org.passkey, ORIGIN, last], expect });
  };
  await webauthnCase('a web-cards answer with its assertion', phone.assert(digest, ORIGIN), 4, { ok: true, counter: 5 });
  await webauthnCase('a web-cards assertion over another challenge', phone.assert(digest, ORIGIN, { challenge: new Uint8Array(32) }), 5, no('challenge'));
  await webauthnCase('a web-cards assertion from another origin', phone.assert(digest, ORIGIN, { origin: 'https://evil.example' }), 6, no('origin'));
  await webauthnCase("a web-cards assertion naming another rpId's hash", phone.assert(digest, ORIGIN, { rpId: 'evil.example' }), 7, no('rp-id'));
  await webauthnCase('a web-cards assertion with UV cleared', phone.assert(digest, ORIGIN, { flags: 0x01 }), 8, no('user-verification'));
  await webauthnCase('a web-cards assertion whose counter did not rise', phone.assert(digest, ORIGIN), 10, no('counter'));
  const counterless = new SoftwareAuthenticator(k.aPasskey, org.passkey.credentialId, RP_ID, 'none');
  await webauthnCase("a counterless authenticator's first assertion", counterless.assert(digest, ORIGIN), 0, { ok: true, counter: 0 });
  await webauthnCase("a counterless authenticator's second assertion", counterless.assert(digest, ORIGIN), 0, { ok: true, counter: 0 });

  // Owner attestations (RL9) on mini's and vm-1's events.
  const ctx = { org: ORG_REMOTE, project: PROJECT };
  const owned = (owners: string[], ownersProof: Action[]) => ({ owners, ownersProof, origin: { kind: 'spawn', requester: owners[0] ?? ALICE }, stateVersion: 3 });
  const say = (writer: string, attest: object) => ({ ts: at(4, 1), created: at(4), writer, seq: 1, kind: 'say', from: 'maws-45', to: '*', text: 'the build is green', attest });
  const spawnB = await signStepUp(spawn('dev-b1'), k.b1StepUp);
  const spawnC = await signStepUp(spawn('dev-c1'), k.c1StepUp);
  const addB = await signStepUp(action({ device: 'dev-a1', action: 'record.owners', session: SESSION, context: { lane: 'A', session: SESSION, launch: 'launch-a1' }, args: { add: true, member: BOB } }), k.a1StepUp);
  const addCByB = await signStepUp(action({ device: 'dev-b2', action: 'record.owners', session: SESSION, context: { lane: 'A', session: SESSION, launch: 'launch-a1' }, args: { add: true, member: CAROL } }), k.b2StepUp);
  const attestCase = async (name: string, attest: object, expect: Verdict & { owners?: string[] }, state = 'r3', writer = `mini/${SESSION}`, by: KeyName = 'mini', certs: Arg = { certs: [], retirements: [] }) => {
    keep(name, await signEvent(ctx, say(writer, attest), k[by].privateKey, k[by].pub));
    cases.push({ name, call: 'verifyAttestation', args: [stateOf(state), certs, fixture(name)], expect });
  };
  await attestCase('an attested owner who owns the sending machine', owned([ALICE], []), { ok: true, owners: [ALICE] });
  await attestCase('an attested owner proven by their spawn', owned([BOB], [spawnB]), { ok: true, owners: [BOB] });
  await attestCase('an attested owner proven by a spawn from a device retired after its created', owned([BOB], [spawnB]), { ok: true, owners: [BOB] }, 'r4');
  await attestCase('an attested owner with no proof', owned([BOB], []), no('not-owner'));
  await attestCase('an attested owner whose proof names another machine', owned([BOB], [await signStepUp(spawn('dev-b1', REF_BUILDER), k.b1StepUp)]), no('other-machine'));
  await attestCase('an attested owner whose proof is from a revoked device', owned([CAROL], [spawnC]), no('revoked'), 'r4');
  await attestCase("an attested owner whose proof's step-up signature fails", owned([BOB], [{ ...spawnB, args: { ...spawnB.args, brief: 'something else' } }]), no('bad-signature'));
  await attestCase("an attested owner proven by another member's spawn", owned([BOB], [spawnC]), no('not-owner'));
  await attestCase('owners added in a chain: Alice adds Bob, Bob adds Carol', owned([ALICE, BOB, CAROL], [addB, addCByB]), { ok: true, owners: [ALICE, BOB, CAROL] });
  await attestCase('an owner added by a member who is no owner', owned([ALICE, CAROL], [addCByB]), no('not-owner'));
  await attestCase('an attested owner of a certified VM, by its delegation', owned([BOB], []), { ok: true, owners: [BOB] }, 'r3', `vm-1/${SESSION}`, 'vm1', fixture('remote certificates'));
  await attestCase('an attestation on an event of no machine writer', owned([ALICE], []), no('malformed'), 'r3', `hub/${ALICE}`);

  // A recovery behind the head: a stolen admin key forged r5 on r4; the recovery key signs a transition from r3.
  const forged = await (async () => {
    const s = clone(org.states.r4.state);
    s.version = 5;
    s.prev = await stateHash(org.states.r4.state);
    s.issued = at(4);
    s.projects.push({ id: 'proj-forged', name: 'forged' });
    return signOrgState(s, [k.a1StepUp]);
  })();
  keep('remote forged r5', forged);
  const rewind: RootTransition = { org: ORG_REMOTE, fromVersion: 3, newRootKeys: [k.a3StepUp.pub], issued: at(6) };
  const rewindCase = async (name: string, t: Signed<RootTransition>, accepted: RootTransition[], expect: Verdict) => {
    keep(name, t);
    cases.push({ name, call: 'verifyRewind', args: [{ $signed: 'remote forged r5' }, fixture(name), k.recovery.pub, accepted as unknown as Arg[]], expect });
  };
  const signedRewind = await signTransition(rewind, k.recovery.privateKey, k.recovery.pub);
  await rewindCase('a rewind from a forged head by the pinned recovery key', signedRewind, [], ok());
  await rewindCase('a rewind by a transition older than one accepted', signedRewind, [{ ...rewind, fromVersion: 2, issued: at(7) }], no('rollback'));
  await rewindCase('a rewind replaying an accepted transition', signedRewind, [rewind], no('rollback'));
  await rewindCase('a rewind signed by an admin key', await signTransition(rewind, k.a1StepUp.privateKey, k.a1StepUp.pub), [], no('unknown-signer'));
  await rewindCase('a rewind from beyond the head', await signTransition({ ...rewind, fromVersion: 6 }, k.recovery.privateKey, k.recovery.pub), [], no('not-head'));
  {
    // The first state under the new root, taken against the state at `fromVersion`: Alice's lost devices revoked.
    const s = clone(org.states.r3.state);
    s.version = 4;
    s.prev = await stateHash(org.states.r3.state);
    s.issued = at(6);
    const a3: Device = { id: 'dev-a3', class: 'native-mac', keyStorage: 'software', channelPub: k.a3Channel.pub, stepUpPub: k.a3StepUp.pub };
    const lost = s.members[0].devices;
    s.members[0].devices = [a3];
    s.root.keys = [await keyId(k.a3StepUp.pub)];
    for (const d of lost) s.revoked.push(...(await Promise.all([d.channelPub, ...(d.stepUpPub ? [d.stepUpPub] : [])].map(async (pub) => ({ keyId: await keyId(pub), holder: { member: ALICE, device: d.id, class: d.class, key: pub === d.channelPub ? ('channel' as const) : ('step-up' as const) } })))));
    keep('remote r4 under the recovered root', await signOrgState(s, [k.a3StepUp]));
    cases.push({ name: 'the first state under the rewound root', call: 'verifySuccessor', args: [{ $signed: 'remote r3' }, { $signed: 'remote r4 under the recovered root' }, [fixture('a rewind from a forged head by the pinned recovery key')]], expect: ok() });
  }

  return { cases, channel: await channelVectors(k, org, fixtures), actions };
}

/** The handshakes, recorded live, and the frames under the first handshake's keys. */
async function channelVectors(k: Keys, org: RemoteOrg, fixtures: Record<string, unknown>): Promise<ChannelVectors> {
  const names = { r1: 'remote r1', r2: 'remote r2', r3: 'remote r3', r4: 'remote r4' } as const;
  const upTo = (head: keyof typeof names) => (['r1', 'r2', 'r3', 'r4'] as const).slice(0, Number(head.slice(1))).map((n) => names[n]);
  const viewOf = (chain: string[]) => memoryOrgView({ chain: chain.map((name) => fixtures[name] as SignedOrgState), certificates: org.certificates });
  const machine: MachineIdentity = { ref: REF_MINI, key: k.mini, build: 'mawsd-vectors', capabilities: ['rl3'] };
  const deviceOf = (id: 'dev-a1' | 'dev-b2' | 'dev-c1' | 'dev-unknown', clientClass: 'native-mac' | 'web-cards' = 'native-mac'): DeviceIdentity => {
    const [member, key] = ({ 'dev-a1': [ALICE, k.a1Channel], 'dev-b2': [BOB, k.b2Channel], 'dev-c1': [CAROL, k.c1Channel], 'dev-unknown': [ALICE, k.stranger] } as const)[id];
    return { org: ORG_REMOTE, member, device: id, clientClass, channelKey: key, build: 'device-vectors', capabilities: ['cards'] };
  };
  const keyNameOf = (id: string): KeyName => ({ 'dev-a1': 'a1Channel', 'dev-b2': 'b2Channel', 'dev-c1': 'c1Channel', 'dev-unknown': 'stranger' } as const)[id as 'dev-a1'];
  const runs: HandshakeRun[] = [];
  const transcripts: TranscriptVector[] = [];

  /** Records `count` connections between the two ends and adds a run for each side asked. */
  const scene = async (input: {
    name: string;
    endpoint: { head: keyof typeof names; pageBytes?: number };
    device: { id: Parameters<typeof deviceOf>[0]; clientClass?: 'native-mac' | 'web-cards'; head: keyof typeof names; pageBytes?: number };
    connections?: number;
    sides: Array<'device' | 'endpoint'>;
  }) => {
    const endpointChain = upTo(input.endpoint.head);
    const deviceChain = upTo(input.device.head);
    const endpointSide: Side = { view: viewOf(endpointChain), chain: endpointChain, pageBytes: input.endpoint.pageBytes, ephemeral: 'machineEphemeral', nonce: 0x22 };
    const deviceSide: Side = { view: viewOf(deviceChain), chain: deviceChain, pageBytes: input.device.pageBytes, ephemeral: 'deviceEphemeral', nonce: 0x11 };
    const device = deviceOf(input.device.id, input.device.clientClass);
    const recorded: Recorded[] = [];
    for (let i = 0; i < (input.connections ?? 1); i++) recorded.push(await recordConnection(k, machine, device, endpointSide, deviceSide));
    for (const side of input.sides) {
      const own = side === 'device' ? deviceSide : endpointSide;
      runs.push({
        name: `${input.name}, the ${side}'s end`,
        side,
        chain: own.chain,
        key: await jwkOf(k, side === 'device' ? keyNameOf(device.device) : 'mini'),
        identity: side === 'device' ? { org: ORG_REMOTE, member: device.member, device: device.device, clientClass: device.clientClass, machine: REF_MINI } : { ref: REF_MINI },
        build: side === 'device' ? device.build : machine.build,
        capabilities: side === 'device' ? device.capabilities : machine.capabilities,
        ...(own.pageBytes === undefined ? {} : { pageBytes: own.pageBytes }),
        now: NOW,
        connections: await Promise.all(
          recorded.map(async (r) => ({
            ephemeral: await jwkOf(k, own.ephemeral),
            nonce: bytes(own.nonce, 32),
            inbound: side === 'device' ? r.endpoint : r.device,
            outbound: side === 'device' ? r.device.slice(0, r.deviceSettled) : r.endpoint.slice(0, r.endpointSettled),
            expect: side === 'device' ? r.deviceResult : r.endpointResult,
          })),
        ),
        headAfter: own.view.head().state.version,
      });
    }
    return recorded;
  };

  const [basic] = await scene({ name: 'a handshake at one head', endpoint: { head: 'r3' }, device: { id: 'dev-a1', head: 'r3' }, sides: ['device', 'endpoint'] });
  await scene({ name: "a handshake carrying successors in h2", endpoint: { head: 'r3' }, device: { id: 'dev-a1', head: 'r1' }, sides: ['device', 'endpoint'] });
  await scene({ name: "a handshake carrying successors in h3", endpoint: { head: 'r2' }, device: { id: 'dev-b2', head: 'r3' }, sides: ['device', 'endpoint'] });
  const onePage = 1024 + Math.max(...(['r2', 'r3'] as const).map((n) => utf8(canonicalize(org.states[n])).length));
  await scene({ name: 'a catch-up over two pages', endpoint: { head: 'r1', pageBytes: onePage }, device: { id: 'dev-b2', head: 'r3', pageBytes: onePage }, connections: 2, sides: ['device', 'endpoint'] });
  await scene({ name: 'a device the state does not list', endpoint: { head: 'r3' }, device: { id: 'dev-unknown', head: 'r3' }, sides: ['endpoint'] });
  await scene({ name: 'a device claiming another class', endpoint: { head: 'r3' }, device: { id: 'dev-a1', clientClass: 'web-cards', head: 'r3' }, sides: ['endpoint'] });
  await scene({ name: 'a revoked device', endpoint: { head: 'r4' }, device: { id: 'dev-c1', head: 'r3' }, sides: ['endpoint'] });
  await scene({ name: 'an h3 over the page limit', endpoint: { head: 'r1', pageBytes: 2048 }, device: { id: 'dev-b2', head: 'r3' }, sides: ['endpoint'] });

  // The basic handshake's transcripts and key schedule, and two forged h2s for the device's end.
  const [h1, h2, h3] = [basic.device[0], basic.endpoint[0], basic.device[1]].map((b) => JSON.parse(text(b)) as Record<string, unknown>);
  const bare = (m: Record<string, unknown>) => {
    const out = { ...m };
    delete out.sig;
    delete out.mac;
    return out;
  };
  const deviceEphemeral = await jwkOf(k, 'deviceEphemeral');
  const z = await sharedSecret(await importEphemeral(deviceEphemeral), h2.e as string);
  const secrets = await handshakeSecrets(z, h1, bare(h2));
  transcripts.push({
    name: 'a handshake at one head',
    deviceEphemeral,
    h1: text(basic.device[0]),
    h2: text(basic.endpoint[0]),
    h3: text(basic.device[1]),
    machinePub: k.mini.pub,
    devicePub: k.a1Channel.pub,
    salt: base64urlEncode(secrets.salt),
    kmR: base64urlEncode(secrets.kmR),
    kmI: base64urlEncode(secrets.kmI),
    i2r: keysVector(secrets.i2r),
    r2i: keysVector(secrets.r2i),
    channelId: secrets.channelId,
    machineTranscript: new TextDecoder().decode(machineTranscript(h1, bare(h2))),
    deviceTranscript: new TextDecoder().decode(deviceTranscript(h1, bare(h2), bare(h3))),
    machineMacInput: new TextDecoder().decode(machineMacInput(REF_MINI, h2.keyId as string)),
    deviceMacInput: new TextDecoder().decode(deviceMacInput(ALICE, 'dev-a1')),
  });
  const basicDevice = runs.find((r) => r.name === "a handshake at one head, the device's end") as HandshakeRun;
  const forgedH2 = async (name: string, edit: (h2: Record<string, unknown>) => Promise<void>, reason: string) => {
    const altered = clone(h2);
    await edit(altered);
    runs.push({ ...basicDevice, name, connections: [{ ...basicDevice.connections[0], inbound: [base64urlEncode(utf8(canonicalize(altered)))], outbound: [basic.device[0]], expect: { ok: false, reason } }] });
  };
  await forgedH2('an h2 whose signature is over another exchange', async (m) => {
    m.sig = await signBody(SIGNING_DOMAINS.rl2, { role: 'machine', h1: { ...h1, n: bytes(0x33, 32) }, h2: bare(h2) }, k.mini.privateKey, k.mini.pub);
  }, 'bad-signature');
  await forgedH2('an h2 whose MAC is wrong', async (m) => {
    m.mac = bytes(0, 32);
  }, 'bad-mac');

  // Frames under the device's direction of the basic handshake.
  const keys = secrets.i2r;
  const json = (message: object) => {
    const body = utf8(JSON.stringify(message));
    const out = new Uint8Array(body.length + 1);
    out.set(body, 1);
    return out;
  };
  const frames: FrameVector[] = [];
  const frame = async (name: string, at: DirectionKeys, epoch: number, seq: number, plaintext: Uint8Array<ArrayBuffer>) => {
    const sealed = base64urlEncode(await sealFrame(at, epoch, seq, plaintext));
    frames.push({ name, keys: keysVector(at), epoch, seq, plaintext: base64urlEncode(plaintext), frame: sealed });
    return sealed;
  };
  const rekeyed = await rekeyDirection(keys);
  const f0 = await frame('the first frame', keys, 0, 0, json({ t: 'ping', at: 1 }));
  const f1 = await frame('a JSON message at sequence 1', keys, 0, 1, json({ t: 'call', id: '1', name: 'session.status', input: { appSessionId: SESSION } }));
  const f2 = await frame('a frame at sequence 2', keys, 0, 2, json({ t: 'ping', at: 2 }));
  const beforeLast = await frame("the frame before an epoch's last", keys, 0, REKEY_FRAMES - 2, json({ t: 'ping', at: 3 }));
  const last = await frame("an epoch's last frame", keys, 0, REKEY_FRAMES - 1, json({ t: 'ping', at: 4 }));
  const first = await frame("the next epoch's first frame, the sequence continuing", rekeyed, 1, REKEY_FRAMES, json({ t: 'ping', at: 5 }));
  const jump = await frame('a frame two epochs on', await rekeyDirection(rekeyed), 2, 0, json({ t: 'ping', at: 6 }));
  const altered = base64urlDecode(f0);
  altered[altered.length - 1] ^= 1;
  const receive = (name: string, frameList: string[], expect: ReceiveVector['expect'], start = { epoch: 0, seq: 0 }): ReceiveVector => ({ name, keys: keysVector(keys), start, frames: frameList, expect });
  return {
    transcripts,
    runs,
    frames,
    rekeys: [{ keys: keysVector(keys), next: keysVector(rekeyed) }],
    receives: [
      receive('frames in sequence', [f0, f1, f2], { opened: 3 }),
      receive('a sequence skipped', [f0, f2], { opened: 1, reason: 'sequence' }),
      receive('a sequence repeated', [f0, f0], { opened: 1, reason: 'sequence' }),
      receive('a sequence reordered', [f1, f0], { opened: 0, reason: 'sequence' }),
      receive('across a rekey at 2^20, the sequence continuing', [last, first], { opened: 2 }, { epoch: 0, seq: REKEY_FRAMES - 1 }),
      receive("an epoch's last frame dropped before the next epoch's first", [beforeLast, first], { opened: 1, reason: 'sequence' }, { epoch: 0, seq: REKEY_FRAMES - 2 }),
      receive('an epoch jump of two', [jump], { opened: 0, reason: 'epoch' }),
      receive('a tag altered', [base64urlEncode(altered)], { opened: 0, reason: 'tag' }),
    ],
  };
}
