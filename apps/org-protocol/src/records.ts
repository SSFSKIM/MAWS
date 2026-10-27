// The records signed beside the org state (RL5, RL6): grants, delegation-signed machine certificates, machine-signed
// listings and endpoint records. Every `machine` field carries the machine's ref (RL §2.3), never its name.
//
// A machine's key is found by ref: the state entry holding the ref, or else the live certificates claiming it. A
// certificate is live while its delegation is in the state and unexpired, its use within `maxUses`, its name under the
// prefix, and neither its name nor its ref the state's own: a delegation never speaks for a listed machine, nor
// takes a name `machineNames` gave another ref. A ref is unique across entries and live certificates: one an entry
// holds, or two live certificates claim with different keys, is contested and refused for every claimant.
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

const entryByRef = (state: OrgState, ref: string) => state.machines.find((m) => m.ref === ref);
const entryByName = (state: OrgState, name: string) => state.machines.find((m) => machineNameKey(m.name) === machineNameKey(name));
/** The ref `machineNames` gave `name`, if any version did. */
const refOfName = (state: OrgState, name: string) => state.machineNames.find((p) => machineNameKey(p.name) === machineNameKey(name))?.ref;

/** The `stepUpPub` of each device of `members` (machine-admin is a step-up action, RL §5.6). */
function stepUpKeys(state: OrgState, members: (id: string, role: string) => boolean): B64[] {
  return state.members.filter((m) => members(m.id, m.role)).flatMap((m) => m.devices.flatMap((d) => (d.stepUpPub === undefined ? [] : [d.stepUpPub])));
}

/**
 * A grant on a listed machine (by ref), signed by a device of one of its owners, or of an admin when the org owns it.
 * Grants are checked only by the hosting machine (RL §5.8); `version` orders a member's grants there.
 */
export async function verifyGrant(state: OrgState, g: Signed<Grant>): Promise<Verdict> {
  if (!isSigned(g, isGrant) || g.body.org !== state.org) return refuse('malformed');
  const machine = entryByRef(state, g.body.machine);
  if (machine === undefined || !state.members.some((m) => m.id === g.body.member)) return refuse('not-listed');
  const owners = machine.owners;
  const signers = stepUpKeys(state, (id, role) => (owners === 'org' ? role === 'admin' : owners.includes(id)));
  return signedBy(SIGNING_DOMAINS.grant, g, signers);
}

/**
 * One machine certificate, signed by its delegation's key (see the header). It is judged alone: whether another live
 * certificate contests its ref is `contestedRefs`'s, and the listing, endpoint and writer checks apply it.
 */
export async function verifyMachineCert(state: OrgState, c: Signed<MachineCert>, now: Date): Promise<Verdict> {
  if (!isSigned(c, isMachineCert) || c.body.org !== state.org) return refuse('malformed');
  const delegation = state.delegations.find((d) => d.id === c.body.delegation);
  if (delegation === undefined) return refuse('not-listed');
  if (now.getTime() >= Date.parse(delegation.expires) || c.body.use > delegation.maxUses) return refuse('expired');
  if (entryByRef(state, c.body.machine) !== undefined) return refuse('contested-ref');
  const retiredTo = refOfName(state, c.body.name);
  if (retiredTo !== undefined && retiredTo !== c.body.machine) return refuse('name-retired');
  if (!machineNameKey(c.body.name).startsWith(machineNameKey(delegation.prefix)) || entryByName(state, c.body.name) !== undefined) return refuse('unknown-signer');
  return signedBy(SIGNING_DOMAINS.machineCert, c, [delegation.pub]);
}

/** The bodies of the certificates among `certs` that are live at `now`, judged one by one. */
async function liveCerts(state: OrgState, certs: unknown, now: Date): Promise<MachineCert[]> {
  if (!Array.isArray(certs)) return [];
  const out: MachineCert[] = [];
  for (const c of certs) if (isSigned(c, isMachineCert) && (await verifyMachineCert(state, c, now)).ok) out.push(c.body);
  return out;
}

/**
 * The refs that are contested at `now`, sorted: each claimed by a certificate among `certs` while a state entry holds
 * it, or claimed by live certificates with different keys. The hub names these in its refusal.
 */
export async function contestedRefs(state: OrgState, certs: Signed<MachineCert>[], now: Date): Promise<string[]> {
  const out = new Set<string>();
  if (Array.isArray(certs)) {
    for (const c of certs) if (isSigned(c, isMachineCert) && c.body.org === state.org && entryByRef(state, c.body.machine) !== undefined) out.add(c.body.machine);
  }
  const pubs = new Map<string, Set<B64>>();
  for (const c of await liveCerts(state, certs, now)) pubs.set(c.machine, (pubs.get(c.machine) ?? new Set()).add(c.pub));
  for (const [ref, keys] of pubs) if (keys.size > 1) out.add(ref);
  return [...out].sort();
}

/**
 * The key that speaks for machine `ref`: the state entry's, or else that of the live certificates claiming it, unless
 * they claim it with different keys.
 */
export async function machineKeys(state: OrgState, ref: string, certs: Signed<MachineCert>[], now: Date): Promise<{ keys: B64[]; contested: boolean }> {
  const entry = entryByRef(state, ref);
  if (entry !== undefined) return { keys: [entry.pub], contested: false };
  const keys = [...new Set((await liveCerts(state, certs, now)).filter((c) => c.machine === ref).map((c) => c.pub))];
  return keys.length > 1 ? { keys: [], contested: true } : { keys, contested: false };
}

/**
 * The key that speaks for the machine a log writer's `<name>/…` names: the ref `machineNames` gave the name, then that
 * ref's key; or, for a name no version gave, the live, uncontested certificates bearing it, when they agree on one ref.
 */
export async function machineKeysByName(state: OrgState, name: string, certs: Signed<MachineCert>[], now: Date): Promise<B64[]> {
  const given = refOfName(state, name);
  if (given !== undefined) return (await machineKeys(state, given, certs, now)).keys;
  const refs = new Set((await liveCerts(state, certs, now)).filter((c) => machineNameKey(c.name) === machineNameKey(name)).map((c) => c.machine));
  return refs.size === 1 ? (await machineKeys(state, [...refs][0], certs, now)).keys : [];
}

async function machineSigned(domain: Domain, state: OrgState, record: Signed<{ machine: string }>, certs: Signed<MachineCert>[], now: Date): Promise<Verdict> {
  const { keys, contested } = await machineKeys(state, record.body.machine, certs, now);
  if (contested) return refuse('contested-ref');
  return keys.length === 0 ? refuse('not-listed') : signedBy(domain, record, keys);
}

/** A session's listing (RL6's projection), signed by its machine's key. The hub's revision rule is `stale-listing`. */
export async function verifyListing(state: OrgState, l: Signed<Listing>, certs: Signed<MachineCert>[], now: Date): Promise<Verdict> {
  if (!isSigned(l, isListing) || l.body.org !== state.org || !Array.isArray(certs)) return refuse('malformed');
  return machineSigned(SIGNING_DOMAINS.listing, state, l, certs, now);
}

/** A machine's endpoint record (RL6: its direct RL2 carriers), signed by its machine's key. */
export async function verifyEndpointRecord(state: OrgState, r: Signed<EndpointRecord>, certs: Signed<MachineCert>[], now: Date): Promise<Verdict> {
  if (!isSigned(r, isEndpointRecord) || r.body.org !== state.org || !Array.isArray(certs)) return refuse('malformed');
  return machineSigned(SIGNING_DOMAINS.endpoint, state, r, certs, now);
}
