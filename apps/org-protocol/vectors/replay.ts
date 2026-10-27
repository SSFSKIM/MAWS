// Replays a vector set through the package and returns what failed, one line each; an empty list is a pass. Every
// consumer's suite runs it in its own runtime and bundle (`replayVectors(VECTORS)`), so a hub, a machine and an app
// judge every case the same way. Runtime-neutral, as the package is.
import { base64urlDecode, base64urlEncode } from '../src/base64url.ts';
import { enrollmentMac, enrollmentMacInput } from '../src/enrollment.ts';
import { verifyEvent, signerFor } from '../src/events.ts';
import { keyId, signingInput } from '../src/keys.ts';
import { stateHash, verifyGenesis, verifySuccessor, verifyTransition } from '../src/org-state.ts';
import { verifyEndpointRecord, verifyGrant, verifyListing, verifyMachineCert } from '../src/records.ts';
import type { OrgState, SignedOrgState } from '../src/types.ts';
import type { Case, VectorSet } from './scenario.ts';

export type { Case, DualCase, EnrollmentCase, VectorSet } from './scenario.ts';

/** Resolves `{$signed}`, `{$state}` and `{$fixture}` references against the set's fixtures, at any depth. */
function resolve(set: VectorSet, arg: unknown): unknown {
  if (Array.isArray(arg)) return arg.map((a) => resolve(set, a));
  if (typeof arg !== 'object' || arg === null) return arg;
  const ref = arg as Record<string, unknown>;
  const name = ref.$signed ?? ref.$state ?? ref.$fixture;
  if (typeof name !== 'string' || Object.keys(ref).length !== 1) return arg;
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
      return verifyGrant(a[0], a[1]);
    case 'verifyMachineCert':
      return verifyMachineCert(a[0], a[1], date(a[2]));
    case 'verifyListing':
      return verifyListing(a[0], a[1], a[2], date(a[3]));
    case 'verifyEndpointRecord':
      return verifyEndpointRecord(a[0], a[1], a[2], date(a[3]));
    case 'verifyEvent':
      return verifyEvent(a[0], a[1], a[2], a[3], date(a[4]));
    case 'signerFor':
      return { keys: await signerFor(a[0], a[1], a[2], date(a[3])) };
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
  return failures;
}
