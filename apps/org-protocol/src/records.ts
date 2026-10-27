// The records signed beside the org state (RL5, RL6): grants, delegation-signed machine certificates with their
// retirements and revocations, machine-signed listings and endpoint records. Every `machine` field carries the
// machine's ref (RL §2.3), never its name.
//
// A certificate stands when its delegation is in the state, its use is within `maxUses`, its name sits under the
// prefix, neither its ref nor its name is the state's own (a delegation never speaks for an entry, nor takes a name
// `machineNames` gave another ref), and its delegation's key signed it. A standing certificate is
//   - revoked when an admin device revoked its key: nothing it signed counts, ever;
//   - retired when its delegation key or an admin device retired its key: it signs nothing new, and its events stamped
//     at or before the retirement's `notAfter` (and its delegation's `expires`) still verify;
//   - live otherwise, while its delegation is unexpired.
// Among live certificates a ref claimed with two keys, or a name claimed under two refs, is contested, and refused
// for every claimant. A retired certificate contests nothing, so a recreated VM can take its old name.
import { keyId, signBody, signingInput, verifyInput, type B64 } from './keys.ts';
import { machineNameKey } from './names.ts';
import { isCertRetirement, isCertRevocation, isCertificates, isEndpointRecord, isGrant, isListing, isMachineCert, isSigned } from './shapes.ts';
import {
  SIGNING_DOMAINS,
  type CertRetirement,
  type CertRevocation,
  type Certificates,
  type EndpointRecord,
  type Grant,
  type Listing,
  type MachineCert,
  type OrgState,
  type Signed,
} from './types.ts';
import { accept, refuse, type Verdict } from './verdict.ts';

type Domain = (typeof SIGNING_DOMAINS)[keyof typeof SIGNING_DOMAINS];

/** No delegated machines: what a verifier passes when it holds no certificates. */
export const NO_CERTIFICATES: Certificates = { certs: [], retirements: [], revocations: [] };

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
export const refOfName = (state: OrgState, name: string) => state.machineNames.find((p) => machineNameKey(p.name) === machineNameKey(name))?.ref;

/** The `stepUpPub` of each device of `members` (machine-admin is a step-up action, RL §5.6). */
function stepUpKeys(state: OrgState, members: (id: string, role: string) => boolean): B64[] {
  return state.members.filter((m) => members(m.id, m.role)).flatMap((m) => m.devices.flatMap((d) => (d.stepUpPub === undefined ? [] : [d.stepUpPub])));
}
const adminKeys = (state: OrgState) => stepUpKeys(state, (_, role) => role === 'admin');

/**
 * A grant on a listed machine (by ref), signed by a device of one of its owners, or of an admin when the org owns it.
 * Grants are checked only by the hosting machine (RL §5.8); `version` orders a member's grants there.
 */
export async function verifyGrant(state: OrgState, g: Signed<Grant>): Promise<Verdict> {
  if (!isSigned(g, isGrant) || g.body.org !== state.org) return refuse('malformed');
  const machine = entryByRef(state, g.body.machine);
  if (machine === undefined || !state.members.some((m) => m.id === g.body.member)) return refuse('not-listed');
  const owners = machine.owners;
  return signedBy(SIGNING_DOMAINS.grant, g, stepUpKeys(state, (id, role) => (owners === 'org' ? role === 'admin' : owners.includes(id))));
}

/** Whether a certificate stands (see the header), its liveness aside. */
async function certStanding(state: OrgState, c: Signed<MachineCert>): Promise<Verdict> {
  if (!isSigned(c, isMachineCert) || c.body.org !== state.org) return refuse('malformed');
  const delegation = state.delegations.find((d) => d.id === c.body.delegation);
  if (delegation === undefined) return refuse('not-listed');
  if (c.body.use > delegation.maxUses) return refuse('expired');
  if (entryByRef(state, c.body.machine) !== undefined) return refuse('contested');
  const given = refOfName(state, c.body.name);
  if (given !== undefined && given !== c.body.machine) return refuse('name-retired');
  if (!machineNameKey(c.body.name).startsWith(machineNameKey(delegation.prefix)) || entryByName(state, c.body.name) !== undefined) return refuse('unknown-signer');
  return signedBy(SIGNING_DOMAINS.machineCert, c, [delegation.pub]);
}

/**
 * One machine certificate, signed by its delegation's key and unexpired at `now` (see the header). It is judged alone:
 * retirements, revocations and contests among certificates are the set's, which the listing, endpoint and writer
 * checks apply.
 */
export async function verifyMachineCert(state: OrgState, c: Signed<MachineCert>, now: Date): Promise<Verdict> {
  const standing = await certStanding(state, c);
  if (!standing.ok) return standing;
  const delegation = state.delegations.find((d) => d.id === c.body.delegation);
  return delegation !== undefined && now.getTime() < Date.parse(delegation.expires) ? accept() : refuse('expired');
}

/** A certificate's retirement: signed by the delegation key of a certificate with that key, or an admin device. */
export async function verifyCertRetirement(state: OrgState, r: Signed<CertRetirement>, certs: Signed<MachineCert>[]): Promise<Verdict> {
  if (!isSigned(r, isCertRetirement) || r.body.org !== state.org || !Array.isArray(certs)) return refuse('malformed');
  const delegations = new Set<B64>();
  for (const c of certs) {
    if (!isSigned(c, isMachineCert) || (await keyId(c.body.pub)) !== r.body.keyId) continue;
    const delegation = state.delegations.find((d) => d.id === c.body.delegation);
    if (delegation !== undefined) delegations.add(delegation.pub);
  }
  return signedBy(SIGNING_DOMAINS.certRetire, r, [...delegations, ...adminKeys(state)]);
}

/** A certificate's revocation: retroactive, so an admin device signs it, never a delegation key. */
export async function verifyCertRevocation(state: OrgState, r: Signed<CertRevocation>): Promise<Verdict> {
  if (!isSigned(r, isCertRevocation) || r.body.org !== state.org) return refuse('malformed');
  return signedBy(SIGNING_DOMAINS.certRevoke, r, adminKeys(state));
}

/** A standing, unrevoked certificate as the set judges it at `now`. */
type CertView = {
  body: MachineCert;
  live: boolean;
  /** The latest timestamp its events may carry: its delegation's `expires`, or the retirement's `notAfter` if sooner. */
  notAfter: string;
  contested: boolean;
};

async function certViews(state: OrgState, set: Certificates, now: Date): Promise<CertView[]> {
  const revoked = new Set<string>();
  for (const r of set.revocations) if ((await verifyCertRevocation(state, r)).ok) revoked.add(r.body.keyId);
  const retired = new Map<string, string>();
  for (const r of set.retirements) {
    if (!(await verifyCertRetirement(state, r, set.certs)).ok) continue;
    const held = retired.get(r.body.keyId);
    if (held === undefined || r.body.notAfter < held) retired.set(r.body.keyId, r.body.notAfter);
  }
  const views: CertView[] = [];
  for (const c of set.certs) {
    if (!(await certStanding(state, c)).ok) continue;
    const kid = await keyId(c.body.pub);
    if (revoked.has(kid)) continue;
    const expires = state.delegations.find((d) => d.id === c.body.delegation)?.expires as string;
    const retiredAt = retired.get(kid);
    const live = retiredAt === undefined && now.getTime() < Date.parse(expires);
    views.push({ body: c.body, live, notAfter: retiredAt !== undefined && retiredAt < expires ? retiredAt : expires, contested: false });
  }
  const live = views.filter((v) => v.live);
  for (const v of live) {
    v.contested = live.some(
      (w) => (w.body.machine === v.body.machine && w.body.pub !== v.body.pub) || (machineNameKey(w.body.name) === machineNameKey(v.body.name) && w.body.machine !== v.body.machine),
    );
  }
  return views;
}

/**
 * The refs that are contested at `now`, sorted: each claimed by a certificate while a state entry holds it, or by live
 * certificates with two keys, or by a live certificate whose name another live one claims under another ref. The hub
 * names these in its refusal.
 */
export async function contestedRefs(state: OrgState, set: Certificates, now: Date): Promise<string[]> {
  if (!isCertificates(set)) return [];
  const out = new Set<string>();
  for (const c of set.certs) if (isSigned(c, isMachineCert) && c.body.org === state.org && entryByRef(state, c.body.machine) !== undefined) out.add(c.body.machine);
  for (const v of await certViews(state, set, now)) if (v.contested) out.add(v.body.machine);
  return [...out].sort();
}

/** The key that speaks now for machine `ref`: the state entry's, or else its one live, uncontested certificate's. */
export async function machineKeys(state: OrgState, ref: string, set: Certificates, now: Date): Promise<{ keys: B64[]; contested: boolean }> {
  const entry = entryByRef(state, ref);
  if (entry !== undefined) return { keys: [entry.pub], contested: false };
  const live = (await certViews(state, set, now)).filter((v) => v.live && v.body.machine === ref);
  if (live.some((v) => v.contested)) return { keys: [], contested: true };
  return { keys: [...new Set(live.map((v) => v.body.pub))], contested: false };
}

/**
 * The keys allowed to sign as a machine writer `<name>/…` (RL8): those of the ref `machineNames` gives the name — its
 * entry's current key, and its retired keys — and those of every uncontested certificate bearing the name, live or
 * retired, each bound to its own ref by its own certificate.
 */
export async function machineSigners(state: OrgState, name: string, set: Certificates, now: Date): Promise<Array<{ pub: B64; notAfter: string | null }>> {
  const out: Array<{ pub: B64; notAfter: string | null }> = [];
  const given = refOfName(state, name);
  if (given !== undefined) {
    const entry = entryByRef(state, given);
    if (entry !== undefined) out.push({ pub: entry.pub, notAfter: null });
    for (const r of state.retired) if ('machine' in r.holder && r.holder.machine === given) out.push({ pub: r.pub, notAfter: r.notAfter });
  }
  for (const v of await certViews(state, set, now)) {
    if (machineNameKey(v.body.name) !== machineNameKey(name) || v.contested) continue;
    if (given !== undefined && v.body.machine !== given) continue;
    out.push({ pub: v.body.pub, notAfter: v.notAfter });
  }
  return out;
}

async function machineSigned(domain: Domain, state: OrgState, record: Signed<{ machine: string }>, set: Certificates, now: Date): Promise<Verdict> {
  const { keys, contested } = await machineKeys(state, record.body.machine, set, now);
  if (contested) return refuse('contested');
  return keys.length === 0 ? refuse('not-listed') : signedBy(domain, record, keys);
}

/** A session's listing (RL6's projection), signed by its machine's key. The hub's revision rule is `stale-listing`. */
export async function verifyListing(state: OrgState, l: Signed<Listing>, certs: Certificates, now: Date): Promise<Verdict> {
  if (!isSigned(l, isListing) || l.body.org !== state.org || !isCertificates(certs)) return refuse('malformed');
  return machineSigned(SIGNING_DOMAINS.listing, state, l, certs, now);
}

/** A machine's endpoint record (RL6: its direct RL2 carriers), signed by its machine's key. */
export async function verifyEndpointRecord(state: OrgState, r: Signed<EndpointRecord>, certs: Certificates, now: Date): Promise<Verdict> {
  if (!isSigned(r, isEndpointRecord) || r.body.org !== state.org || !isCertificates(certs)) return refuse('malformed');
  return machineSigned(SIGNING_DOMAINS.endpoint, state, r, certs, now);
}
