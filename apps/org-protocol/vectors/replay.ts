// Replays a vector set through the package and returns what failed, one line each; an empty list is a pass. Every
// consumer's suite runs it in its own runtime and bundle (`replayVectors(VECTORS)`), so a hub, a machine and an app
// judge every case the same way. Runtime-neutral, as the package is.
import { actionDigest, actionFingerprint, actionSigningInput, isAction, verifyStepUp } from '../src/action.ts';
import { verifyAttestation } from '../src/attest.ts';
import { base64urlDecode, base64urlEncode } from '../src/base64url.ts';
import { canonicalize } from '../src/canonical.ts';
import { enrollmentMac, enrollmentMacInput } from '../src/enrollment.ts';
import { verifyEvent, signerFor } from '../src/events.ts';
import { keyId, signingInput } from '../src/keys.ts';
import { decodePairingCode, encodePairingCode, pairingFingerprint, pairingMac, pairingMacInput, verifyPairingMac } from '../src/pairing.ts';
import { decodeProvisioningCodeV2, encodeProvisioningCodeV2 } from '../src/provisioning.ts';
import { stateHash, verifyGenesis, verifyRewind, verifySuccessor, verifyTransition } from '../src/org-state.ts';
import { contestedRefs, machineKeys, verifyCertRetirement, verifyEndpointRecord, verifyGrant, verifyListing, verifyMachineCert } from '../src/records.ts';
import type { OrgState, SignedOrgState } from '../src/types.ts';
import { verifyWebAuthn } from '../src/webauthn.ts';
import { replayChannel } from './replay-channel.ts';
import { replayHistory } from './replay-history.ts';
import type { Case, VectorSet } from './scenario.ts';

export type { Case, DualCase, EnrollmentCase, PairingVector, ProvisioningVector, VectorSet } from './scenario.ts';

/** Resolves `{$signed}`, `{$state}` and `{$fixture}` references against the set's fixtures, at any depth. */
function resolve(set: VectorSet, arg: unknown): unknown {
  if (Array.isArray(arg)) return arg.map((a) => resolve(set, a));
  if (typeof arg !== 'object' || arg === null) return arg;
  const ref = arg as Record<string, unknown>;
  const name = ref.$signed ?? ref.$state ?? ref.$fixture;
  if (typeof name !== 'string' || Object.keys(ref).length !== 1) {
    return Object.fromEntries(Object.entries(ref).map(([key, value]) => [key, resolve(set, value)]));
  }
  if (!(name in set.fixtures)) throw new Error(`no fixture ${name}`);
  const value = set.fixtures[name];
  return '$state' in ref ? (value as SignedOrgState).state : value;
}

const date = (value: unknown) => new Date(value as string);

async function run(set: VectorSet, c: Case): Promise<unknown> {
  const a = c.args.map((arg) => resolve(set, arg)) as never[];
  switch (c.call) {
    case 'verifyGenesis':
      return verifyGenesis(a[0]);
    case 'verifySuccessor':
      return verifySuccessor(a[0], a[1], a[2]);
    case 'verifyTransition':
      return verifyTransition(a[0], a[1], a[2]);
    case 'verifyGrant':
      return a.length > 2 ? verifyGrant(a[0], a[1], a[2], date(a[3])) : verifyGrant(a[0], a[1]);
    case 'verifyMachineCert':
      return verifyMachineCert(a[0], a[1], date(a[2]));
    case 'verifyListing':
      return verifyListing(a[0], a[1], a[2], date(a[3]));
    case 'verifyEndpointRecord':
      return verifyEndpointRecord(a[0], a[1], a[2], date(a[3]));
    case 'verifyEvent':
      return verifyEvent(a[0], a[1], a[2], a[3], date(a[4]));
    case 'signerFor':
      return { signers: await signerFor(a[0], a[1], a[2], date(a[3])) };
    case 'verifyCertRetirement':
      return verifyCertRetirement(a[0], a[1], a[2]);
    case 'contestedRefs':
      return { refs: await contestedRefs(a[0], a[1], date(a[2])) };
    case 'machineKeys':
      return machineKeys(a[0], a[1], a[2], date(a[3]));
    case 'verifyRewind':
      return verifyRewind(a[0], a[1], a[2], a[3]);
    case 'verifyAttestation':
      return verifyAttestation(a[0], a[1], a[2]);
    case 'verifyStepUp':
      return verifyStepUp(a[0], a[1]);
    case 'verifyWebAuthn':
      return verifyWebAuthn(a[0], a[1], a[2], a[3]);
    case 'isAction':
      return { valid: isAction(a[0]) };
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function replayVectors(set: VectorSet): Promise<string[]> {
  const failures: string[] = [];
  for (const c of set.cases) {
    try {
      const got = await run(set, c);
      if (!same(got, c.expect)) failures.push(`${c.call}: ${c.name}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
    } catch (error) {
      failures.push(`${c.call}: ${c.name}: threw ${String(error)}`);
    }
  }
  for (const { pub, kid } of set.encodings.kids) if ((await keyId(pub)) !== kid) failures.push(`kid of ${pub}`);
  for (const { state, hash } of set.encodings.stateHashes) {
    if ((await stateHash(resolve(set, state) as OrgState)) !== hash) failures.push(`state hash of ${state.$state}`);
  }
  for (const { domain, body, input } of set.encodings.inputs) {
    if (new TextDecoder().decode(signingInput(domain, body)) !== input) failures.push(`signing input of ${domain}`);
  }
  for (const e of set.enrollment) {
    const fields = { name: e.name, machinePub: e.machinePub, ref: e.ref, tokenId: e.tokenId };
    if (base64urlEncode(enrollmentMacInput(fields)) !== e.input) failures.push(`enrollment input of ${e.name}/${e.ref}/${e.tokenId}`);
    if ((await enrollmentMac(base64urlDecode(e.k), fields)) !== e.mac) failures.push(`enrollment mac of ${e.name}/${e.ref}/${e.tokenId}`);
  }
  if (new Set(set.enrollment.map((e) => e.input)).size !== set.enrollment.length) failures.push('two enrollments encode alike');
  failures.push(...(await replayPairing(set.pairing)));
  failures.push(...replayProvisioning(set.provisioning));
  for (const { name, action, input, digest, fingerprint } of set.encodings.actions) {
    if (new TextDecoder().decode(actionSigningInput(action)) !== input) failures.push(`action input of ${name}`);
    if (base64urlEncode(await actionDigest(action)) !== digest) failures.push(`action digest of ${name}`);
    if ((await actionFingerprint(action)) !== fingerprint) failures.push(`action fingerprint of ${name}`);
  }
  failures.push(...(await replayChannel(set.channel, set.fixtures)));
  failures.push(...(await replayHistory(set.history)));
  return failures;
}

/** Each provisioning code decoded and encoded again, and each refused text refused by its name (provisioning.ts). */
function replayProvisioning(p: VectorSet['provisioning']): string[] {
  const failures: string[] = [];
  for (const { name, text, decoded } of p.codes) {
    try {
      if (canonicalize(decodeProvisioningCodeV2(text)) !== canonicalize(decoded)) failures.push(`provisioning code: ${name}: decoded`);
      if (encodeProvisioningCodeV2(decoded) !== text) failures.push(`provisioning code: ${name}: encoded`);
    } catch (error) {
      failures.push(`provisioning code: ${name}: threw ${String(error)}`);
    }
  }
  for (const { name, text, error } of p.refusals) {
    try {
      decodeProvisioningCodeV2(text);
      failures.push(`provisioning code: ${name}: decoded`);
    } catch (thrown) {
      if (!(thrown instanceof TypeError) || thrown.message !== error) failures.push(`provisioning code: ${name}: expected ${error}, got ${String(thrown)}`);
    }
  }
  return failures;
}

/** The pairing code decoded and encoded again, its MAC input, MAC and fingerprint, and the swapped entry's (pairing.ts). */
async function replayPairing(p: VectorSet['pairing']): Promise<string[]> {
  const failures: string[] = [];
  const k = base64urlDecode(p.decoded.k);
  const decoded = decodePairingCode(p.code);
  if (decoded === null || canonicalize(decoded) !== canonicalize(p.decoded)) failures.push('pairing code: decoded');
  if (encodePairingCode(p.decoded) !== p.code) failures.push('pairing code: encoded');
  if (base64urlEncode(pairingMacInput(p.fields)) !== p.input) failures.push('pairing mac: input');
  if ((await pairingMac(k, p.fields)) !== p.mac || !(await verifyPairingMac(k, p.fields, p.mac))) failures.push('pairing mac: the entry');
  if ((await pairingFingerprint(p.fields.org, p.fields.member, p.fields.device)) !== p.fingerprint) failures.push('pairing fingerprint: the entry');
  const { swapped } = p;
  if (swapped.fields.device.channelPub !== p.fields.device.channelPub) failures.push('pairing: the swapped entry keeps the channel key');
  if ((await pairingMac(k, swapped.fields)) !== swapped.mac || (await verifyPairingMac(k, swapped.fields, p.mac))) failures.push('pairing mac: the swapped entry');
  const print = await pairingFingerprint(swapped.fields.org, swapped.fields.member, swapped.fields.device);
  if (print !== swapped.fingerprint || print === p.fingerprint) failures.push('pairing fingerprint: the swapped entry');
  return failures;
}
