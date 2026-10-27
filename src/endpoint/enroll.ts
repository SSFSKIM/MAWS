// Enrollment (O10 M2; RL §5.3). Attended: a member's app gives the machine a v2 code (`smns-enroll-v2.`: the hub, a
// one-time token, the org's root key ids and recovery key, and a pairing secret `k` that never reaches the hub). The
// endpoint mints its machine key, redeems the token for its Access service token, posts its key and ref with a MAC under
// `k` (which the member's device checks before it signs the machine into the state, so a hub that swaps the key is
// caught), writes its state, and is `org-listed` once a head it verified lists its ref with its key. Delegated: a VM
// redeems a provisioning token and certifies its own key with its delegation's key (`enrollDelegated`), live once
// `verifyMachineCert` accepts the certificate against the state. The code and `k` are never written anywhere.
import {
  base64urlDecode,
  enrollmentMac,
  generateSigningKey,
  importSigningKey,
  keyId,
  machineNameKey,
  NO_CERTIFICATES,
  SIGNING_DOMAINS,
  signRecord,
  verifyMachineCert,
  type MachineCert,
  type SignedOrgState,
  type SigningKey,
} from 'org-protocol';
import { decodeEnrollmentCodeV2, MACHINE_CERT_PATH, MACHINE_KEY_PATH, REDEEM_PATH, type Redeemed } from 'desk-hub/protocol';
import { admittedRequest, fetchOrgState, hubRequest, refusalOf, type Credentials, type HubDeps } from './hub-http';
import type { AdoptResult, EndpointOrg } from './org-sync';
import type { EndpointState, EnrollmentFile } from './state/store';

/** Where an enrollment lands: the endpoint's state and org view, the profile's ref, and the machine key it then holds. */
export type EnrollContext = {
  state: EndpointState;
  org: EndpointOrg;
  ref: string;
  deps: HubDeps;
  log: (line: string) => void;
  /** The machine key now in force: the endpoint reloads it from what was just written. */
  keyChanged(key: SigningKey): void;
};

export type EnrollmentState = { state: 'hub-confirmed' | 'org-listed'; name: string; org: string; ref: string };

/** A refusal the command line reports as it stands (exit 1). */
export class EnrollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnrollError';
  }
}

/** The fields O14's provisioning code carries (Interfaces §F; P5 Decision Log 35). */
export type DelegatedInput = {
  hub: string;
  org: string;
  roots: string[];
  recoveryPub: string;
  token: string;
  delegation: { id: string; prefix: string; privateJwk: JsonWebKey };
  name: string;
};

/** How long a redemption answered `busy` or `mint-failed` is retried: from 2 s, doubling, within 60 s in all. */
const REDEEM_BUDGET_MS = 60_000;
/** How often `--wait` reads the org state again. */
const LISTING_POLL_MS = 2000;

/**
 * `mawsd endpoint enroll`: steps 1–6 of M2's enrollment. Resolves `org-listed` once a verified head lists the machine,
 * else `hub-confirmed` at the deadline (`waitMs` from the key's acceptance; 0 reads the state once), with the refusal
 * of the last read when it was refused.
 */
export async function enrollAttended(ctx: EnrollContext, input: { code: string; name?: string; replace: boolean; waitMs: number }): Promise<{ result: EnrollmentState; refused?: string }> {
  const { state, deps } = ctx;
  refuseIfRefused(state);
  const held = state.enrolled ? state.enrollment : null;
  if (held !== null && !input.replace) throw new EnrollError(`already enrolled as ${held.name} in ${held.org}: \`enroll --replace\` re-enrolls with a new key`);
  let code: ReturnType<typeof decodeEnrollmentCodeV2>;
  try {
    code = decodeEnrollmentCodeV2(input.code.trim());
  } catch (error) {
    throw new EnrollError(`not an enrollment code: ${(error as Error).message.replace(/^enrollment code: /, '')}`);
  }
  const name = input.name ?? code.machine ?? (input.replace ? held?.name : undefined);
  if (name === undefined) throw new EnrollError('the code names no machine: give its name with --name');

  const key = await generateSigningKey(true);
  const pins = { roots: code.roots, recoveryPub: code.recoveryPub };
  const redeemed = await redeem(deps, code.hub, code.token, name);
  if (redeemed.enrollment === undefined) throw new EnrollError('the hub answered no enrollment id: it is older than the v2 enrollment');
  refuseOtherOrg(state, redeemed.org, pins);
  const credentials = { clientId: redeemed.client_id, clientSecret: redeemed.client_secret };
  const mac = await enrollmentMac(base64urlDecode(code.k), { name: redeemed.machine, machinePub: key.pub, ref: ctx.ref, tokenId: redeemed.enrollment });
  const posted = await admittedRequest(deps, code.hub, MACHINE_KEY_PATH, credentials, { pub: key.pub, ref: ctx.ref, mac });
  if (posted.status !== 200 && posted.status !== 201) throw new EnrollError(`the hub refused the machine's key: ${posted.status} ${await refusalOf(posted)}`);
  await posted.body?.cancel();

  await writeEnrollment(ctx, key, input.replace && held !== null, {
    version: 1,
    state: 'hub-confirmed',
    name: redeemed.machine,
    ref: ctx.ref,
    org: redeemed.org,
    hub: code.hub,
    enrollment: redeemed.enrollment,
    credentials,
    at: new Date(deps.now()).toISOString(),
  }, pins);
  ctx.log(`endpoint: enrolled with the hub as ${redeemed.machine} in ${redeemed.org}${input.replace ? ' (a new key; the ref and the grants in force kept)' : ''}`);

  const deadline = deps.now() + input.waitMs;
  for (;;) {
    const read = await syncAndPromote(ctx, deadline);
    if (read.listed) return { result: current(state) };
    if (deps.now() >= deadline) return { result: current(state), ...(read.refused === undefined ? {} : { refused: read.refused }) };
    await deps.sleep(Math.min(LISTING_POLL_MS, Math.max(0, deadline - deps.now())));
  }
}

/**
 * Delegated enrollment (Interfaces §F): redeems the provisioning token for the service token and the delegation's
 * `use`, signs the machine's own certificate with the delegation's key, posts it, and reads the state once.
 */
export async function enrollDelegatedInto(ctx: EnrollContext, input: DelegatedInput): Promise<EnrollmentState> {
  const { state, deps } = ctx;
  refuseIfRefused(state);
  if (state.enrolled) throw new EnrollError(`already enrolled as ${state.enrollment?.name}`);
  if (!ctx.ref.startsWith(`${input.delegation.id}_`)) {
    throw new EnrollError(`the machine's ref was not minted under the delegation ${input.delegation.id} (\`mawsd install --delegation-id\` mints it so)`);
  }
  if (!machineNameKey(input.name).startsWith(machineNameKey(input.delegation.prefix))) throw new EnrollError(`the name ${input.name} is outside the delegation's prefix ${input.delegation.prefix}`);
  const delegationKey = await importSigningKey(input.delegation.privateJwk);
  const redeemed = await redeem(deps, input.hub, input.token, input.name);
  if (redeemed.use === undefined || redeemed.enrollment === undefined) throw new EnrollError('the redemption counted no use: the token is not a provisioning key');
  if (redeemed.org !== input.org) throw new EnrollError(`the hub enrolled the machine in ${redeemed.org}, not ${input.org}`);
  refuseOtherOrg(state, redeemed.org, { roots: input.roots, recoveryPub: input.recoveryPub });
  const key = await generateSigningKey(true);
  const body: MachineCert = { org: redeemed.org, machine: ctx.ref, name: redeemed.machine, pub: key.pub, delegation: input.delegation.id, use: redeemed.use, issued: new Date(deps.now()).toISOString() };
  const cert = await signRecord(SIGNING_DOMAINS.machineCert, body, delegationKey.privateKey, delegationKey.pub);
  const credentials = { clientId: redeemed.client_id, clientSecret: redeemed.client_secret };
  const posted = await admittedRequest(deps, input.hub, MACHINE_CERT_PATH, credentials, cert);
  if (posted.status !== 200 && posted.status !== 201) throw new EnrollError(`the hub refused the machine's certificate: ${posted.status} ${await refusalOf(posted)}`);
  await posted.body?.cancel();
  await writeEnrollment(ctx, key, false, {
    version: 1,
    state: 'hub-confirmed',
    name: redeemed.machine,
    ref: ctx.ref,
    org: redeemed.org,
    hub: input.hub,
    enrollment: redeemed.enrollment,
    credentials,
    at: new Date(deps.now()).toISOString(),
    cert,
  }, { roots: input.roots, recoveryPub: input.recoveryPub });
  ctx.log(`endpoint: enrolled under the delegation ${input.delegation.id} as ${redeemed.machine} in ${redeemed.org} (use ${redeemed.use})`);
  await syncAndPromote(ctx);
  return current(state);
}

/** A read under `--wait` has at least this long for each page, however near the wait's end. */
const READ_FLOOR_MS = 10_000;

/**
 * Reads the hub's org state and adopts what verifies; promotes a `hub-confirmed` enrollment the head now lists. Each page
 * has the request deadline, or, under `--wait` (`until`), what is left of the wait and at least `READ_FLOOR_MS`.
 */
export async function syncAndPromote(ctx: EnrollContext, until?: number): Promise<{ listed: boolean; refused?: string }> {
  const enrollment = ctx.state.enrollment;
  if (enrollment === null) return { listed: false };
  let read: AdoptResult | null = null;
  const timeout = () => (until === undefined ? undefined : Math.max(READ_FLOOR_MS, until - ctx.deps.now()));
  try {
    read = await ctx.org.sync((since) => fetchOrgState(ctx.deps, enrollment.hub, enrollment.credentials, since, timeout()));
  } catch (error) {
    ctx.log(`endpoint: the org state could not be read: ${(error as Error).message}`);
  }
  const listed = await promoteIfListed(ctx);
  return { listed, ...(read?.refused === undefined ? {} : { refused: read.refused }) };
}

/**
 * Writes `org-listed` once the head lists the machine (attended) or accepts its certificate (delegated), for the key on
 * disk: the record and the key a re-enrollment writes are judged together, never the new record by the old key.
 */
export async function promoteIfListed(ctx: Pick<EnrollContext, 'state' | 'org' | 'deps' | 'log'>): Promise<boolean> {
  const { enrollment, machineKey } = ctx.state;
  if (enrollment === null || machineKey === null || !ctx.org.ready) return false;
  if (enrollment.state === 'org-listed') return true;
  if (!(await listedIn(ctx.org.head(), enrollment, machineKey.keyId, new Date(ctx.deps.now())))) return false;
  ctx.state.setEnrollment({ ...enrollment, state: 'org-listed' });
  ctx.log(`endpoint: ${enrollment.name} is listed in the org state at version ${ctx.org.head().state.version}`);
  return true;
}

async function listedIn(head: SignedOrgState, enrollment: EnrollmentFile, machineKey: string, now: Date): Promise<boolean> {
  if (enrollment.cert !== undefined) return (await keyId(enrollment.cert.body.pub)) === machineKey && (await verifyMachineCert(head.state, enrollment.cert, now)).ok;
  for (const m of head.state.machines) if (m.ref === enrollment.ref && (await keyId(m.pub)) === machineKey) return true;
  return false;
}

/** `POST /machine/enroll`, retrying `busy` and `mint-failed` from 2 s, doubling, within 60 s in all. */
async function redeem(deps: HubDeps, hub: string, token: string, name: string): Promise<Redeemed> {
  const started = deps.now();
  let delay = 2000;
  for (;;) {
    const response = await hubRequest(deps, hub, REDEEM_PATH, { body: { token, machine: name }, timeoutMs: started + REDEEM_BUDGET_MS - deps.now() });
    if (response.status === 200) return (await response.json()) as Redeemed;
    const error = await refusalOf(response);
    const transient = (response.status === 409 && error === 'busy') || (response.status === 502 && error === 'mint-failed');
    if (!transient || deps.now() + delay - started > REDEEM_BUDGET_MS) throw new EnrollError(`the hub refused the enrollment: ${response.status} ${error}`);
    await deps.sleep(delay);
    delay *= 2;
  }
}

type Pins = { roots: string[]; recoveryPub: string };

/**
 * Refuses a redemption whose org isn't the one the machine holds the state of, when the code's pins are the ones it was
 * enrolled under: the org name comes from the hub, and a new name would clear the head and the high-water mark for a
 * replayed older chain. The pins come from the member's app, so only a code with other pins starts another org's state.
 */
function refuseOtherOrg(state: EndpointState, org: string, pins: Pins): void {
  const held = state.org;
  if (held === null || !samePins(held.pinned, pins)) return;
  const heldOrg = held.head?.state.org ?? held.org;
  if (org !== heldOrg) throw new EnrollError(`the hub answered the org ${org}, but this machine holds the state of ${heldOrg} under the code's pins`);
}

const samePins = (a: Pins, b: Pins) => a.recoveryPub === b.recoveryPub && a.roots.length === b.roots.length && a.roots.every((r) => b.roots.includes(r));

/**
 * The state an enrollment leaves: the key, then the ledger (a crash between leaves the key alone, which the next start
 * moves aside, or, re-enrolling, the new key with a ledger that doesn't hold it, which refuses every grant), then the
 * enrollment record, then the org file with the code's pins, kept as it is when it is the same org's under the same
 * recovery key, so a re-enrollment never lowers the high-water mark. It runs in the org view's queue, the ledger it
 * keeps read there: a grant or an adoption that landed while the enrollment was at the hub is not written over.
 */
function writeEnrollment(ctx: EnrollContext, key: SigningKey, keepLedger: boolean, enrollment: EnrollmentFile, pins: Pins): Promise<void> {
  return ctx.org.exclusive(async () => {
    const { state } = ctx;
    refuseOtherOrg(state, enrollment.org, pins);
    const id = await keyId(key.pub);
    const jwk = (await crypto.subtle.exportKey('jwk', key.privateKey)) as JsonWebKey;
    const kept = keepLedger ? state.ledger : null;
    state.setMachineKey({ version: 1, keyId: id, jwk, created: new Date(ctx.deps.now()).toISOString() });
    state.setLedger(kept === null ? { version: 1, heldKeys: [id], grants: {}, highWater: {} } : { ...kept, heldKeys: [...kept.heldKeys.filter((k) => k !== id), id] });
    state.setEnrollment(enrollment);
    const org = state.org;
    if (org === null || (org.head?.state.org ?? org.org) !== enrollment.org || org.pinned.recoveryPub !== pins.recoveryPub) {
      state.setOrg({ version: 1, org: enrollment.org, pinned: pins, head: null, chain: [], certificates: NO_CERTIFICATES, acceptedTransitions: [], highWater: 0 });
    } else if (org.head === null) {
      state.setOrg({ ...org, pinned: pins });
    }
    ctx.keyChanged(await importSigningKey(jwk));
  });
}

function refuseIfRefused(state: EndpointState): void {
  if (state.refusing !== null) throw new EnrollError(`the endpoint's state directory is refused (${state.refusing}); its log names the path`);
}

function current(state: EndpointState): EnrollmentState {
  const e = state.enrollment as EnrollmentFile;
  return { state: e.state, name: e.name, org: e.org, ref: e.ref };
}

export type { Credentials };
