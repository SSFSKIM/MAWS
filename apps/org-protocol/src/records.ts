// The records signed beside the org state (RL5, RL6): grants, delegation-signed machine certificates with their
// delegations' retirements, machine-signed listings and endpoint records. Every `machine` field carries the machine's
// ref (RL §2.3), never its name.
//
// A certificate is authentic when its delegation is in the state, its use is within `maxUses`, its name sits under the
// prefix (compared by the lower-cased key), its ref starts with its delegation's id and `_` (RL DL 25: no delegation
// claims another's ref, judged on the certificate alone), and its delegation's key signed it. A delegation dropped
// from the state is revoked, and every certificate under it with it, history included. An authentic certificate is
//   - revoked when the state lists its key in `revoked`: nothing it signed counts, ever, whatever retired it;
//   - retired at the earliest of its delegation's `expires`, the `notAfter` of the state's `retired` entry for its key
//     (an admin's retirement), and that of each retirement record its own delegation's key signed for it (another
//     delegation's record retires only that delegation's certificates): its events stamped at or before then verify;
//   - live otherwise, while no retirement names its key and its delegation is unexpired.
// A live certificate whose ref a state entry holds contests the ref, refused for every claimant, the entry included.
// Among live certificates a ref claimed with two keys, or a name claimed under two refs, is contested too: within one
// delegation, since prefixes never nest and no enrolled name lies under a prefix (RL DL 25, org-state.ts), so a
// certificate's name never meets another delegation's or an entry's. A retired or expired certificate contests
// nothing, so a recreated VM under the same delegation can take its old name, and its history stands whatever the state
// enrolls later. The hub serving only certificates `verifyMachineCert` accepted on arrival (M4) is defence in depth.
import { keyId, signBody, signingInput, verifyInput, type B64 } from './keys.ts';
import { machineNameKey, type MemberId } from './names.ts';
import { isCertRetirement, isCertificates, isEndpointRecord, isGrant, isListing, isMachineCert, isSigned } from './shapes.ts';
import {
  SIGNING_DOMAINS,
  type CertRetirement,
  type Certificates,
  type EndpointRecord,
  type Grant,
  type Listing,
  type MachineCert,
  type OrgState,
  type Owners,
  type Signed,
} from './types.ts';
import { accept, refuse, type Verdict } from './verdict.ts';

type Domain = (typeof SIGNING_DOMAINS)[keyof typeof SIGNING_DOMAINS];

/** No delegated machines: what a verifier passes when it holds no certificates. */
export const NO_CERTIFICATES: Certificates = { certs: [], retirements: [] };

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
/** The ref `machineNames` gave `name`, if any version did. */
export const refOfName = (state: OrgState, name: string) => state.machineNames.find((p) => machineNameKey(p.name) === machineNameKey(name))?.ref;

/** The `stepUpPub` of each device of `members` (machine-admin is a step-up action, RL §5.6). */
function stepUpKeys(state: OrgState, members: (id: string, role: string) => boolean): B64[] {
  return state.members.filter((m) => members(m.id, m.role)).flatMap((m) => m.devices.flatMap((d) => (d.stepUpPub === undefined ? [] : [d.stepUpPub])));
}

/** `signedBy`, reading an unknown signer the state lists in `revoked` as `revoked`. */
async function signedByIn(state: OrgState, domain: Domain, record: Signed<unknown>, allowed: Iterable<B64>): Promise<Verdict> {
  const verdict = await signedBy(domain, record, allowed);
  if (!verdict.ok && verdict.code === 'unknown-signer' && state.revoked.some((r) => r.keyId === record.sig.kid)) return refuse('revoked');
  return verdict;
}

/**
 * A grant on a machine (by ref) for the key that speaks for it now (`machineKey`, by id): an enrolled machine's
 * current key, or its one live certificate's (`machineKeys`, judged at `now`). It is signed by a device of one of the
 * machine's owners, or of an admin when the org owns it; a certified machine's owners are its delegation's. Grants are
 * checked only by the hosting machine (RL §5.8); `version` orders a member's grants there, and its ledger (O10) keeps
 * the keys it has held.
 */
export async function verifyGrant(state: OrgState, g: Signed<Grant>, certs: Certificates = NO_CERTIFICATES, now: Date = new Date()): Promise<Verdict> {
  if (!isSigned(g, isGrant) || g.body.org !== state.org || !isCertificates(certs)) return refuse('malformed');
  if (!state.members.some((m) => m.id === g.body.member)) return refuse('not-listed');
  const { keys, contested } = await machineKeys(state, g.body.machine, certs, now);
  if (contested) return refuse('contested');
  let speaking = false;
  for (const pub of keys) if ((await keyId(pub)) === g.body.machineKey) speaking = true;
  if (!speaking) return refuse('not-listed');
  const owners = await machineOwners(state, g.body.machine, certs, now);
  if (owners === null) return refuse('not-listed');
  return signedByIn(state, SIGNING_DOMAINS.grant, g, stepUpKeys(state, (id, role) => (owners === 'org' ? role === 'admin' : owners.includes(id))));
}

/** The member ids `owners` names in `state`: its admins for `'org'`. */
export function ownerMembers(state: OrgState, owners: Owners): MemberId[] {
  return owners === 'org' ? state.members.filter((m) => m.role === 'admin').map((m) => m.id) : [...owners];
}

/**
 * Whose machine `ref` is at `now`: its state entry's owners, or else its delegation's, through an authentic,
 * unrevoked and uncontested certificate for the ref (live or retired: its history keeps its owners); null for none.
 */
export async function machineOwners(state: OrgState, ref: string, set: Certificates, now: Date): Promise<Owners | null> {
  const entry = entryByRef(state, ref);
  if (entry !== undefined) return entry.owners;
  const view = (await certViews(state, set, now)).find((v) => v.body.machine === ref && !v.contested);
  return view === undefined ? null : (delegationOf(state, view.body)?.owners ?? null);
}

/**
 * The machine that key `kid` speaks for as writer name `name` (RL8's rule, `machineSigners`): the ref `machineNames`
 * gives the name, by its entry's current key or one of the ref's retired keys, or an uncontested certificate bearing
 * the name with that key. Its owners are its entry's or its delegation's, none for a ref the state no longer lists.
 */
export async function machineOfSigner(state: OrgState, name: string, kid: string, set: Certificates, now: Date): Promise<{ ref: string; owners: Owners } | null> {
  const given = refOfName(state, name);
  if (given !== undefined) {
    const entry = entryByRef(state, given);
    if (entry !== undefined && (await keyId(entry.pub)) === kid) return { ref: given, owners: entry.owners };
    if (state.retired.some((r) => 'machine' in r.holder && r.holder.machine === given && r.keyId === kid)) return { ref: given, owners: entry?.owners ?? [] };
  }
  for (const v of await certViews(state, set, now)) {
    if (v.contested || machineNameKey(v.body.name) !== machineNameKey(name) || (await keyId(v.body.pub)) !== kid) continue;
    return { ref: v.body.machine, owners: delegationOf(state, v.body)?.owners ?? [] };
  }
  return null;
}

const delegationOf = (state: OrgState, cert: MachineCert) => state.delegations.find((d) => d.id === cert.delegation);

/** Whether a certificate is authentic (see the header): its delegation's, whatever its liveness and claims. */
async function certAuthentic(state: OrgState, c: Signed<MachineCert>): Promise<Verdict> {
  if (!isSigned(c, isMachineCert) || c.body.org !== state.org) return refuse('malformed');
  const delegation = delegationOf(state, c.body);
  if (delegation === undefined) return refuse('not-listed');
  if (c.body.use > delegation.maxUses) return refuse('expired');
  if (!machineNameKey(c.body.name).startsWith(machineNameKey(delegation.prefix))) return refuse('unknown-signer');
  const ref = c.body.machine;
  if (!ref.startsWith(`${delegation.id}_`) || ref.length < delegation.id.length + 1 + REF_RANDOM_CHARS) return refuse('unknown-signer');
  return signedBy(SIGNING_DOMAINS.machineCert, c, [delegation.pub]);
}

/** 128 random bits in base64url: what follows the delegation's id and `_` in a certificate's ref, at the least. */
const REF_RANDOM_CHARS = 22;

/** A live certificate's claim against the state's entries: a ref an entry holds is contested (see the header). */
const claimAgainstState = (state: OrgState, cert: MachineCert): Verdict => (entryByRef(state, cert.machine) !== undefined ? refuse('contested') : accept());

/**
 * One machine certificate as a live claim: authentic, unexpired at `now`, its ref no entry's, and its key neither
 * revoked nor retired in the state (see the header). It is judged alone: retirement records and contests among
 * certificates are the set's, which the listing, endpoint and writer checks apply. The hub admits a certificate only on
 * this verdict.
 */
export async function verifyMachineCert(state: OrgState, c: Signed<MachineCert>, now: Date): Promise<Verdict> {
  const authentic = await certAuthentic(state, c);
  if (!authentic.ok) return authentic;
  const kid = await keyId(c.body.pub);
  if (state.revoked.some((r) => r.keyId === kid)) return refuse('revoked');
  if (state.retired.some((r) => r.keyId === kid)) return refuse('expired');
  const claim = claimAgainstState(state, c.body);
  if (!claim.ok) return claim;
  return now.getTime() < Date.parse(delegationOf(state, c.body)?.expires as string) ? accept() : refuse('expired');
}

/**
 * A certificate's retirement record: signed by the delegation key of an authentic certificate in `certs` with that key.
 * It retires only that delegation's certificates of the key (see `certViews`). An admin retires a certificate in the
 * state instead (`retired`), so that no later change to the admins orphans it (RL DL 24).
 */
export async function verifyCertRetirement(state: OrgState, r: Signed<CertRetirement>, certs: Signed<MachineCert>[]): Promise<Verdict> {
  if (!isSigned(r, isCertRetirement) || r.body.org !== state.org || !Array.isArray(certs)) return refuse('malformed');
  const delegations = new Set<B64>();
  for (const c of certs) {
    if (!(await certAuthentic(state, c)).ok || (await keyId(c.body.pub)) !== r.body.keyId) continue;
    delegations.add((delegationOf(state, c.body) as { pub: B64 }).pub);
  }
  return signedBy(SIGNING_DOMAINS.certRetire, r, delegations);
}

/** An authentic, unrevoked certificate as the set judges it at `now` (see the header). */
type CertView = {
  body: MachineCert;
  live: boolean;
  /** The latest timestamp its events may carry: its delegation's `expires`, or its retirement's `notAfter` if sooner. */
  notAfter: string;
  contested: boolean;
};

async function certViews(state: OrgState, set: Certificates, now: Date): Promise<CertView[]> {
  const revoked = new Set(state.revoked.map((r) => r.keyId));
  const views: CertView[] = [];
  for (const c of set.certs) {
    if (!(await certAuthentic(state, c)).ok) continue;
    const kid = await keyId(c.body.pub);
    if (revoked.has(kid)) continue;
    const delegation = delegationOf(state, c.body) as { pub: B64; expires: string };
    // Its retirement: the earliest `notAfter` of the state's entry for its key and its own delegation's records.
    let retiredAt = state.retired.find((r) => r.keyId === kid)?.notAfter;
    for (const r of set.retirements) {
      if (!isSigned(r, isCertRetirement) || r.body.org !== state.org || r.body.keyId !== kid) continue;
      if (retiredAt !== undefined && r.body.notAfter >= retiredAt) continue;
      if ((await signedBy(SIGNING_DOMAINS.certRetire, r, [delegation.pub])).ok) retiredAt = r.body.notAfter;
    }
    const live = retiredAt === undefined && now.getTime() < Date.parse(delegation.expires);
    const claim = live ? claimAgainstState(state, c.body) : accept();
    const notAfter = retiredAt !== undefined && retiredAt < delegation.expires ? retiredAt : delegation.expires;
    views.push({ body: c.body, live, notAfter, contested: !claim.ok });
  }
  const live = views.filter((v) => v.live);
  for (const v of live) {
    v.contested ||= live.some(
      (w) => (w.body.machine === v.body.machine && w.body.pub !== v.body.pub) || (machineNameKey(w.body.name) === machineNameKey(v.body.name) && w.body.machine !== v.body.machine),
    );
  }
  return views;
}

const contestedIn = (views: CertView[]) => new Set(views.filter((v) => v.contested).map((v) => v.body.machine));

/**
 * The refs that are contested at `now`, sorted: each claimed by a live certificate while a state entry holds it, or by
 * live certificates with two keys, or by a live certificate whose name another live one claims under another ref. The
 * hub names these in its refusal.
 */
export async function contestedRefs(state: OrgState, set: Certificates, now: Date): Promise<string[]> {
  if (!isCertificates(set)) return [];
  return [...contestedIn(await certViews(state, set, now))].sort();
}

/**
 * The key that speaks now for machine `ref`: the state entry's, or else its one live certificate's; none for a
 * contested ref, whoever claims it.
 */
export async function machineKeys(state: OrgState, ref: string, set: Certificates, now: Date): Promise<{ keys: B64[]; contested: boolean }> {
  const live = (await certViews(state, set, now)).filter((v) => v.live && v.body.machine === ref);
  if (live.some((v) => v.contested)) return { keys: [], contested: true };
  const entry = entryByRef(state, ref);
  if (entry !== undefined) return { keys: [entry.pub], contested: false };
  return { keys: [...new Set(live.map((v) => v.body.pub))], contested: false };
}

/**
 * The keys allowed to sign as a machine writer `<name>/…` (RL8): those of the ref `machineNames` gives the name — its
 * entry's current key unless the ref is contested, and its retired keys — and those of every certificate bearing the
 * name, live and uncontested, or retired or expired, each bound to its own ref by its own certificate.
 */
export async function machineSigners(state: OrgState, name: string, set: Certificates, now: Date): Promise<Array<{ pub: B64; notAfter: string | null }>> {
  const out: Array<{ pub: B64; notAfter: string | null }> = [];
  const views = await certViews(state, set, now);
  const given = refOfName(state, name);
  if (given !== undefined) {
    const entry = entryByRef(state, given);
    if (entry !== undefined && !contestedIn(views).has(given)) out.push({ pub: entry.pub, notAfter: null });
    for (const r of state.retired) if ('machine' in r.holder && r.holder.machine === given) out.push({ pub: r.pub, notAfter: r.notAfter });
  }
  for (const v of views) {
    if (machineNameKey(v.body.name) === machineNameKey(name) && !v.contested) out.push({ pub: v.body.pub, notAfter: v.notAfter });
  }
  return out;
}

async function machineSigned(domain: Domain, state: OrgState, record: Signed<{ machine: string }>, set: Certificates, now: Date): Promise<Verdict> {
  const { keys, contested } = await machineKeys(state, record.body.machine, set, now);
  if (contested) return refuse('contested');
  if (keys.length === 0) return refuse(state.revoked.some((r) => r.keyId === record.sig.kid) ? 'revoked' : 'not-listed');
  return signedByIn(state, domain, record, keys);
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
