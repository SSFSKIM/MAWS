// The fake machine's v2 enrollment (O11 M4, RL §5.3): a machine that holds its own P-256 key and a ref it minted itself,
// for the suites and for the staging acceptance run, as the endpoint module (O10) will enroll.
//   - An attended machine redeems the v2 code's token, then posts its key and ref with the MAC under the code's pairing
//     secret `k`, for the enrolling member's device to check before it signs the machine into the org state.
//   - An unattended VM redeems a provisioning key's secret, mints its ref under the key's delegation, and posts the
//     machine certificate it signed with the delegation's key; no org-state version is needed for it.
// Either then signs its listings and its endpoint record (RL6) with its machine key.
import {
  enrollmentMac,
  generateSigningKey,
  keyId,
  SIGNING_DOMAINS,
  signRecord,
  type CertRetirement,
  type EndpointRecord,
  type Listing,
  type MachineCert,
  type Signed,
  type SigningKey,
} from 'org-protocol';
import { base64urlDecode, base64urlEncode } from '../src/protocol/base64url';
import { decodeEnrollmentCodeV2, MACHINE_CERT_PATH, MACHINE_KEY_PATH, REDEEM_PATH, type Redeemed } from '../src/protocol/identity';
import { credentialHeaders, type Credentials } from './link';

/** A machine enrolled the v2 way: its hub, name, ref, key and service token, and what its redemption answered. */
export type V2Machine = {
  hub: string;
  org: string;
  name: string;
  ref: string;
  key: SigningKey;
  credentials: Credentials;
  enrollment: string;
  /** Through a provisioning key: which of its uses this machine is. */
  use?: number;
};

/** A fresh MachineRef (RL §2.3): 128 random bits as base64url, after `<delegation id>_` for a delegated machine. */
export function mintRef(delegation?: string): string {
  const random = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
  return delegation === undefined ? random : `${delegation}_${random}`;
}

/** A request to the hub as the machine: its service token's headers, a JSON body when given. */
export function machineFetch(hub: string, credentials: Credentials, path: string, body?: unknown, method?: string): Promise<Response> {
  return fetch(`${hub}${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...credentialHeaders(credentials), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function redeem(hub: string, token: string, name: string): Promise<Redeemed> {
  const response = await fetch(`${hub}${REDEEM_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, machine: name }) });
  if (response.status !== 200) throw new Error(`the enrollment was refused: ${response.status} ${await response.text()}`);
  const redeemed = (await response.json()) as Redeemed;
  if (redeemed.enrollment === undefined) throw new Error('the hub answered no enrollment id: it is older than O11 M4');
  return redeemed;
}

const ok = async (response: Response, what: string) => {
  if (response.status !== 200 && response.status !== 201) throw new Error(`${what}: ${response.status} ${await response.text()}`);
};

/**
 * `machineFetch` with a credential minted a moment ago: a deployed hub's Access refuses a fresh service token (401) until
 * it reaches the edge, a few seconds to a minute later (O11 M3, M7), so a 401 is tried again every 2 s for up to
 * `admitMs` (0, the default, tries once: the local hub admits at once).
 */
async function freshFetch(hub: string, credentials: Credentials, path: string, body: unknown, admitMs: number): Promise<Response> {
  const deadline = Date.now() + admitMs;
  for (;;) {
    const response = await machineFetch(hub, credentials, path, body);
    if (response.status !== 401 || Date.now() >= deadline) return response;
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

/**
 * Enrolls with a v2 code (`smns-enroll-v2.`) under `name` (the code's own when it names one): redeems its token, then
 * posts the machine's key and ref with the MAC under the code's `k` and the enrollment's id. The ref and key are minted
 * here unless given (a re-enrollment keeps its ref). Against a deployed hub, `admitMs` waits out Access's refusal of the
 * fresh service token (`freshFetch`).
 */
export async function enrollV2(code: string, name?: string, keep: { ref?: string; key?: SigningKey } = {}, admitMs = 0): Promise<V2Machine> {
  const decoded = decodeEnrollmentCodeV2(code);
  const machine = name ?? decoded.machine;
  if (machine === undefined) throw new Error('the code names no machine: give its name');
  const redeemed = await redeem(decoded.hub, decoded.token, machine);
  const key = keep.key ?? (await generateSigningKey());
  const ref = keep.ref ?? mintRef();
  const credentials = { clientId: redeemed.client_id, clientSecret: redeemed.client_secret };
  const mac = await enrollmentMac(base64urlDecode(decoded.k), { name: redeemed.machine, machinePub: key.pub, ref, tokenId: redeemed.enrollment! });
  await ok(await freshFetch(decoded.hub, credentials, MACHINE_KEY_PATH, { pub: key.pub, ref, mac }, admitMs), 'the key was refused');
  return { hub: decoded.hub, org: redeemed.org, name: redeemed.machine, ref, key, credentials, enrollment: redeemed.enrollment! };
}

/** A delegation's side, as a VM's secret store holds it: its id and its key. */
export type DelegationKey = { id: string; key: SigningKey };

/**
 * A VM's redemption under a delegation: redeems the provisioning key's secret under `name` and mints its ref under the
 * delegation (or keeps `ref`) and its key (or keeps `key`). Its certificate is the caller's to post (`certify`).
 */
export async function redeemDelegated(hub: string, token: string, name: string, delegation: DelegationKey, keep: { ref?: string; key?: SigningKey } = {}): Promise<V2Machine> {
  const redeemed = await redeem(hub, token, name);
  if (redeemed.use === undefined) throw new Error('the redemption counted no use: the token is not a provisioning key');
  const key = keep.key ?? (await generateSigningKey());
  const ref = keep.ref ?? mintRef(delegation.id);
  const credentials = { clientId: redeemed.client_id, clientSecret: redeemed.client_secret };
  return { hub, org: redeemed.org, name: redeemed.machine, ref, key, credentials, enrollment: redeemed.enrollment!, use: redeemed.use };
}

/** Boots a VM under a delegation (`redeemDelegated`) and posts the certificate it signs with the delegation's key; the
 * hub's refusal is thrown with its answer. `admitMs` as `enrollV2`'s. */
export async function enrollDelegated(
  hub: string,
  token: string,
  name: string,
  delegation: DelegationKey,
  keep: { ref?: string; key?: SigningKey } = {},
  admitMs = 0,
): Promise<V2Machine & { cert: Signed<MachineCert> }> {
  const machine = await redeemDelegated(hub, token, name, delegation, keep);
  const cert = await certify(machine, delegation);
  await ok(await freshFetch(hub, machine.credentials, MACHINE_CERT_PATH, cert, admitMs), 'the certificate was refused');
  return { ...machine, cert };
}

/** The machine's certificate under `delegation`, signed now. */
export function certify(machine: Pick<V2Machine, 'org' | 'ref' | 'name' | 'key' | 'use'>, delegation: DelegationKey): Promise<Signed<MachineCert>> {
  const body: MachineCert = { org: machine.org, machine: machine.ref, name: machine.name, pub: machine.key.pub, delegation: delegation.id, use: machine.use ?? 1, issued: new Date().toISOString() };
  return signRecord(SIGNING_DOMAINS.machineCert, body, delegation.key.privateKey, delegation.key.pub);
}

/** A certificate's retirement, signed by its own delegation's key: what `devcloud vm delete` posts. */
export async function retirement(org: string, certified: SigningKey | string, delegation: DelegationKey, notAfter = new Date().toISOString()): Promise<Signed<CertRetirement>> {
  const kid = typeof certified === 'string' ? certified : await keyId(certified.pub);
  return signRecord(SIGNING_DOMAINS.certRetire, { org, keyId: kid, notAfter }, delegation.key.privateKey, delegation.key.pub);
}

/** One session's listing (RL6's projection), signed by the machine's key. */
export function listing(machine: Pick<V2Machine, 'org' | 'ref' | 'key'>, session: string, revision: number, fields: Listing['fields']): Promise<Signed<Listing>> {
  const body: Listing = { org: machine.org, machine: machine.ref, session, revision, issued: new Date().toISOString(), fields };
  return signRecord(SIGNING_DOMAINS.listing, body, machine.key.privateKey, machine.key.pub);
}

/** The machine's endpoint record (RL §4.1's direct carriers), signed by its key. */
export function endpointRecord(machine: Pick<V2Machine, 'org' | 'ref' | 'key'>, addresses: string[], issued = new Date().toISOString()): Promise<Signed<EndpointRecord>> {
  return signRecord(SIGNING_DOMAINS.endpoint, { org: machine.org, machine: machine.ref, addresses, issued }, machine.key.privateKey, machine.key.pub);
}
