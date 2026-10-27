// The records signed beside the org state (RL5, RL6): grants, delegation-signed machine certificates, machine-signed
// listings and endpoint records. A machine's key is found in the state's `machines`, or in a live certificate of a
// delegation whose prefix covers the name; a certificate is live while its delegation is in the state and unexpired,
// and only for a name the state does not list itself (a delegation never speaks for a listed machine).
import { keyId, signBody, signingInput, verifyInput, type B64 } from './keys.ts';
import { machineNameKey } from './names.ts';
import { isEndpointRecord, isGrant, isListing, isMachineCert, isSigned } from './shapes.ts';
import { SIGNING_DOMAINS, type EndpointRecord, type Grant, type Listing, type MachineCert, type OrgState, type Signed } from './types.ts';
import { accept, refuse, type Verdict } from './verdict.ts';

type Domain = (typeof SIGNING_DOMAINS)[keyof typeof SIGNING_DOMAINS];

/** Signs a record under its kind's domain. */
export async function signRecord<T>(domain: Domain, body: T, key: CryptoKey, pub: B64): Promise<Signed<T>> {
  return { body, sig: await signBody(domain, body, key, pub) };
}

/** `sig` names one of `allowed` and verifies over `body`: `unknown-signer` or `bad-signature` otherwise. */
async function signedBy(domain: Domain, record: Signed<unknown>, allowed: Iterable<B64>): Promise<Verdict> {
  for (const pub of allowed) {
    if ((await keyId(pub)) !== record.sig.kid) continue;
    return (await verifyInput(signingInput(domain, record.body), record.sig, pub)) ? accept() : refuse('bad-signature');
  }
  return refuse('unknown-signer');
}

const listedMachine = (state: OrgState, name: string) => state.machines.find((m) => machineNameKey(m.name) === machineNameKey(name));

/** The `stepUpPub` of each device of `members` (machine-admin is a step-up action, RL §5.6). */
function stepUpKeys(state: OrgState, members: (id: string, role: string) => boolean): B64[] {
  return state.members.filter((m) => members(m.id, m.role)).flatMap((m) => m.devices.flatMap((d) => (d.stepUpPub === undefined ? [] : [d.stepUpPub])));
}

/**
 * A grant on a listed machine, signed by a device of one of its owners, or of an admin when the org owns it. Grants
 * are checked only by the hosting machine (RL §5.8); `version` orders a member's grants there.
 */
export async function verifyGrant(state: OrgState, g: Signed<Grant>): Promise<Verdict> {
  if (!isSigned(g, isGrant) || g.body.org !== state.org) return refuse('malformed');
  const machine = listedMachine(state, g.body.machine);
  if (machine === undefined || !state.members.some((m) => m.id === g.body.member)) return refuse('not-listed');
  const owners = machine.owners;
  const signers = stepUpKeys(state, (id, role) => (owners === 'org' ? role === 'admin' : owners.includes(id)));
  return signedBy(SIGNING_DOMAINS.grant, g, signers);
}

/**
 * A machine certificate, signed by its delegation's key: the delegation is in the state and unexpired at `now`, the
 * certificate's `use` is within `maxUses`, and its name sits under the prefix (compared without case) and is not a
 * machine the state lists.
 */
export async function verifyMachineCert(state: OrgState, c: Signed<MachineCert>, now: Date): Promise<Verdict> {
  if (!isSigned(c, isMachineCert) || c.body.org !== state.org) return refuse('malformed');
  const delegation = state.delegations.find((d) => d.id === c.body.delegation);
  if (delegation === undefined) return refuse('not-listed');
  if (now.getTime() >= Date.parse(delegation.expires) || c.body.use > delegation.maxUses) return refuse('expired');
  const name = machineNameKey(c.body.machine);
  if (!name.startsWith(machineNameKey(delegation.prefix)) || listedMachine(state, name) !== undefined) return refuse('unknown-signer');
  return signedBy(SIGNING_DOMAINS.machineCert, c, [delegation.pub]);
}

/** The keys that speak for machine `name`: its listed key, or else the keys of its live certificates among `certs`. */
export async function machineKeys(state: OrgState, name: string, certs: Signed<MachineCert>[], now: Date): Promise<B64[]> {
  const listed = listedMachine(state, name);
  if (listed !== undefined) return [listed.pub];
  const out: B64[] = [];
  for (const c of certs) {
    if (!isSigned(c, isMachineCert) || machineNameKey(c.body.machine) !== machineNameKey(name)) continue;
    if ((await verifyMachineCert(state, c, now)).ok && !out.includes(c.body.pub)) out.push(c.body.pub);
  }
  return out;
}

async function machineSigned(domain: Domain, state: OrgState, record: Signed<{ machine: string }>, certs: Signed<MachineCert>[], now: Date): Promise<Verdict> {
  const keys = await machineKeys(state, record.body.machine, certs, now);
  return keys.length === 0 ? refuse('not-listed') : signedBy(domain, record, keys);
}

/** A session's listing (RL6's projection), signed by its machine's key. The hub's revision rule is `stale-listing`. */
export async function verifyListing(state: OrgState, l: Signed<Listing>, certs: Signed<MachineCert>[], now: Date): Promise<Verdict> {
  if (!isSigned(l, isListing) || l.body.org !== state.org) return refuse('malformed');
  return machineSigned(SIGNING_DOMAINS.listing, state, l, certs, now);
}

/** A machine's endpoint record (RL6: its direct RL2 carriers), signed by its machine's key. */
export async function verifyEndpointRecord(state: OrgState, r: Signed<EndpointRecord>, certs: Signed<MachineCert>[], now: Date): Promise<Verdict> {
  if (!isSigned(r, isEndpointRecord) || r.body.org !== state.org) return refuse('malformed');
  return machineSigned(SIGNING_DOMAINS.endpoint, state, r, certs, now);
}
