// Delegated enrollment (O14 M1; RL §5.3): `mawsd endpoint provision` redeems a `smns-provision-v2.` code into a live
// certificate under the code's delegation. It is a resumable transaction in four states, each read from the state
// directory, so a boot step may rerun it after any interruption, no run redeems twice, and no hub row is created that
// the machine can't later remove (`retire`):
//
//   1. nothing held: `delegation.json` and the code's legacy key (`legacy.json`) and pins (`org.json`) are written before
//      any hub call; then the redemption, the machine key and the certificate the delegation key signs, all kept in
//      `provisioning.json` before the first authenticated request;
//   2. `provisioning.json` held: the org state read and verified against the pins, the certificate's delegation checked
//      against the head (its key is the code's, its prefix covers the name), the certificate posted (the hub answers an
//      identical one as held), and the write set `enrollAttended` writes rebuilt from the record alone, the record
//      deleted last; the endpoint's start completes the set before its key-without-ledger rule could move it aside;
//   3. `hub-confirmed` with a certificate: nothing redeemed; the state read until the certificate is live;
//   4. `org-listed`: nothing posted.
//
// The delegation key stays on the machine (RL §5.3): every VM under the delegation can read the secret store anyway, and
// the certificate's retirement at departure is signed with it (retire.ts).
import { hostname } from 'node:os';
import { generateSigningKey, importSigningKey, keyId, machineNameKey, SIGNING_DOMAINS, signRecord, type MachineCert, type ProvisioningCodeV2 } from 'org-protocol';
import { MACHINE_CERT_PATH } from 'desk-hub/protocol';
import { current, EnrollError, pinOrg, redeem, refuseIfRefused, refuseIfUnenrolled, refuseOtherOrg, syncAndPromote, type EnrollContext, type EnrollmentState } from './enroll';
import { ADMIT_MS, admittedRequest, fetchOrgState, hubRequest, refusalOf, type Credentials, type HubDeps, type HubError } from './hub-http';
import type { EndpointOrg } from './org-sync';
import type { EndpointState, ProvisioningFile } from './state/store';

/** What `provision` is given: the code's fields and the machine's name (`enrollDelegated`'s input, P5 Decision Log 35). */
export type DelegatedInput = ProvisioningCodeV2 & { name: string };

export type ProvisionResult = { result: EnrollmentState; refused?: string };

/** How often `--wait` reads the org state again. */
const LISTING_POLL_MS = 2000;

/** The name a provisioning takes when none is given: the host's, lower-cased (a devcloud VM's is its `DEVCLOUD_NAME`). */
export const defaultMachineName = () => hostname().toLowerCase();

/**
 * Runs the transaction (see the header) from whatever state the directory holds; resolves `org-listed`, or
 * `hub-confirmed` at the deadline (`waitMs` from the certificate's acceptance; 0 reads the state once) or while the hub
 * does not answer (`refused` says why). Throws an EnrollError, `<reason>: <what>`, for a refusal.
 */
export async function provisionInto(ctx: EnrollContext, input: DelegatedInput & { waitMs: number }): Promise<ProvisionResult> {
  const { state } = ctx;
  const settled = await ctx.lifecycle(() => provisionWithHub(ctx, input));
  if (settled !== null) return settled;
  const deadline = ctx.deps.now() + input.waitMs;
  for (;;) {
    const read = await syncAndPromote(ctx, deadline);
    refuseIfUnenrolled(state);
    if (read.listed) return { result: current(state) };
    if (ctx.deps.now() >= deadline) return { result: current(state), ...(read.refused === undefined ? {} : { refused: read.refused }) };
    await ctx.deps.sleep(Math.min(LISTING_POLL_MS, Math.max(0, deadline - ctx.deps.now())));
  }
}

/** States 1, 2 and 4, as one change of the enrollment (`lifecycle`): a result to return, or null for state 3's wait. */
async function provisionWithHub(ctx: EnrollContext, input: DelegatedInput): Promise<ProvisionResult | null> {
  const { state } = ctx;
  refuseIfRefused(state);
  const code = input;
  const id = code.delegation.id;
  const held = state.delegation;
  if (held !== null && (held.id !== id || held.privateJwk.d !== code.delegation.privateJwk.d)) {
    throw new EnrollError(`other-delegation: this machine was provisioned under the delegation ${held.id}; \`mawsd endpoint unenroll\` first`);
  }
  const enrollment = state.enrolled ? state.enrollment : null;
  if (enrollment !== null && enrollment.cert === undefined) {
    throw new EnrollError(`attended: this machine is enrolled as ${enrollment.name} by a member's code; \`mawsd endpoint unenroll\` first`);
  }
  if (enrollment?.cert !== undefined && enrollment.cert.body.delegation !== id) {
    throw new EnrollError(`other-delegation: this machine is certified under the delegation ${enrollment.cert.body.delegation}; \`mawsd endpoint unenroll\` first`);
  }
  if (!ctx.ref.startsWith(`${id}_`)) throw new EnrollError(`ref-prefix: the machine's ref was not minted under the delegation ${id} (\`mawsd install --delegation-id\` mints it so)`);

  if (enrollment?.state === 'org-listed' && state.provisioning === null) return { result: current(state) };
  if (enrollment === null && state.provisioning === null) await redeemInto(ctx, code, input.name);
  return state.provisioning === null ? null : settle(ctx, 'admitted');
}

/** State 1: what the code carries, kept before any hub call; the redemption; its record, before any other. */
async function redeemInto(ctx: EnrollContext, code: ProvisioningCodeV2, name: string): Promise<void> {
  const { state, deps } = ctx;
  if (!machineNameKey(name).startsWith(machineNameKey(code.delegation.prefix))) throw new EnrollError(`name-prefix: the name ${name} is outside the delegation's prefix ${code.delegation.prefix}`);
  if (code.legacy !== undefined && code.legacy.org !== code.org) throw new EnrollError(`legacy-org: the code's legacy key is the org ${code.legacy.org}'s, not ${code.org}'s`);
  const delegationKey = await importSigningKey(code.delegation.privateJwk).catch(() => {
    throw new EnrollError('delegation-key: the code\'s delegation key is no P-256 private key');
  });
  const pins = { roots: code.roots, recoveryPub: code.recoveryPub };
  await ctx.org.exclusive(async () => {
    refuseOtherOrg(state, code.org, pins);
    if (state.delegation === null) state.setDelegation({ version: 1, id: code.delegation.id, prefix: code.delegation.prefix, privateJwk: code.delegation.privateJwk });
    // Kept as RL10's handover keeps it, so the endpoint never asks for it and dual-codes from its first event.
    if (code.legacy !== undefined && state.legacyKey?.org !== code.legacy.org) state.setLegacy({ org: code.legacy.org, key: code.legacy.key });
    pinOrg(state, code.org, pins);
  });

  const redeemed = await redeem(deps, code.hub, code.token, name);
  if (redeemed.use === undefined || redeemed.enrollment === undefined) throw new EnrollError('not-delegation: the redemption counted no use: the token is not a provisioning key');
  const key = await generateSigningKey(true);
  const body: MachineCert = { org: redeemed.org, machine: ctx.ref, name: redeemed.machine, pub: key.pub, delegation: code.delegation.id, use: redeemed.use, issued: new Date(deps.now()).toISOString() };
  const cert = await signRecord(SIGNING_DOMAINS.machineCert, body, delegationKey.privateKey, delegationKey.pub);
  const jwk = (await crypto.subtle.exportKey('jwk', key.privateKey)) as JsonWebKey;
  const { org, machine, client_id, client_secret, enrollment, use } = redeemed;
  state.setProvisioning({ version: 1, redeemed: { org, machine, client_id, client_secret, enrollment, use }, machineKey: { keyId: await keyId(key.pub), jwk }, cert, pins, hub: code.hub });
  ctx.log(`endpoint: redeemed the delegation ${code.delegation.id} as ${machine} in ${org} (use ${use})`);
}

/**
 * How the redemption's credential is taken: `admitted` while it may be minutes old (Access refuses a fresh service
 * token for up to about a minute, so a 401 is tried again for `ADMIT_MS`, as `admittedRequest` does), `established`
 * once a later step relies on it (`retire`), where a 401 is the hub's answer.
 */
export type CredentialAge = 'admitted' | 'established';

/** The org state from `since` on, as `fetchOrgState` reads it, a 401 tried again within `ADMIT_MS` for an admitted credential. */
async function readState(deps: HubDeps, hub: string, credentials: Credentials, since: number, age: CredentialAge, admitUntil: number) {
  for (;;) {
    try {
      return await fetchOrgState(deps, hub, credentials, since);
    } catch (error) {
      if (age !== 'admitted' || (error as HubError).status !== 401 || deps.now() + 2000 > admitUntil) throw error;
      await deps.sleep(2000);
    }
  }
}

/** Why a pending provisioning's certificate went nowhere: the hub refused it, or no longer knows the credential. */
export class CertRefused extends EnrollError {
  constructor(
    message: string,
    readonly credentialGone: boolean,
  ) {
    super(message);
  }
}

/**
 * State 2: completes `provisioning.json`. Null once the set is whole (the record deleted); `hub-confirmed` with the
 * reason while the hub can't be read or doesn't answer (the record kept, so a rerun resumes here). Throws a CertRefused
 * for a refusal: the certificate was not posted, or the hub refused it (`credentialGone` when the hub no longer takes
 * the redemption's credential).
 */
export async function settle(ctx: EnrollContext, age: CredentialAge): Promise<ProvisionResult | null> {
  const { state, deps } = ctx;
  const p = state.provisioning as ProvisioningFile;
  const credentials = { clientId: p.redeemed.client_id, clientSecret: p.redeemed.client_secret };
  const pending = (refused: string): ProvisionResult => ({ result: { state: 'hub-confirmed', name: p.redeemed.machine, org: p.redeemed.org, ref: ctx.ref }, refused });
  try {
    refuseOtherOrg(state, p.redeemed.org, p.pins);
  } catch (error) {
    throw new CertRefused((error as Error).message, false);
  }
  const admitUntil = deps.now() + ADMIT_MS;
  try {
    const read = await ctx.org.sync((since) => readState(deps, p.hub, credentials, since, age, admitUntil));
    if (read.refused !== undefined && !ctx.org.ready) return pending(read.refused);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403) throw new CertRefused(`the hub no longer takes the redemption's credential (${status})`, true);
    return pending(`the org state could not be read: ${(error as Error).message}`);
  }
  if (!ctx.org.ready) return pending('the hub served no org state');
  const head = ctx.org.head().state;
  const delegation = head.delegations.find((d) => d.id === p.cert.body.delegation);
  if (delegation === undefined) throw new CertRefused(`unknown-delegation: the org state at version ${head.version} holds no delegation ${p.cert.body.delegation}`, false);
  const ours = state.delegation === null ? null : (await importSigningKey(state.delegation.privateJwk)).pub;
  if (ours !== delegation.pub) throw new CertRefused(`delegation-key: the code's delegation key is not the delegation ${delegation.id}'s in the org state at version ${head.version}`, false);
  if (!machineNameKey(p.redeemed.machine).startsWith(machineNameKey(delegation.prefix))) {
    throw new CertRefused(`name-prefix: the name ${p.redeemed.machine} is outside the delegation's prefix ${delegation.prefix} in the org state`, false);
  }

  let posted: Response;
  try {
    posted = age === 'admitted' ? await admittedRequest(deps, p.hub, MACHINE_CERT_PATH, credentials, p.cert) : await hubRequest(deps, p.hub, MACHINE_CERT_PATH, { credentials, body: p.cert });
  } catch (error) {
    return pending(`the hub did not take the certificate: ${(error as Error).message}`);
  }
  if (posted.status >= 500) return pending(`the hub did not take the certificate: ${posted.status} ${await refusalOf(posted)}`);
  if (posted.status !== 200 && posted.status !== 201) {
    throw new CertRefused(`the hub refused the machine's certificate: ${posted.status} ${await refusalOf(posted)}`, posted.status === 401 || posted.status === 403);
  }
  await posted.body?.cancel();
  await writeProvisionedSet(state, ctx.org, p, () => ctx.recordsMoved());
  state.removeProvisioning();
  ctx.keyChanged(await importSigningKey(p.machineKey.jwk));
  ctx.log(`endpoint: certified under the delegation ${p.cert.body.delegation} as ${p.redeemed.machine} in ${p.redeemed.org} (use ${p.redeemed.use})`);
  return null;
}

/**
 * The endpoint's start with a pending provisioning: the write set completed from the record before anything judges the
 * directory, the record kept until a run of `provision` (or `retire`) has the certificate's post answered.
 */
export async function completeProvisioning(state: EndpointState, org: EndpointOrg, log: (line: string) => void, recordsMoved: () => void): Promise<void> {
  const p = state.provisioning;
  if (p === null) return;
  try {
    await writeProvisionedSet(state, org, p, recordsMoved);
    log(`endpoint: completed the provisioning of ${p.redeemed.machine} from its record; \`mawsd endpoint provision\` posts its certificate again`);
  } catch (error) {
    log(`endpoint: the pending provisioning of ${p.redeemed.machine} could not be completed: ${(error as Error).message}`);
  }
}

/**
 * The set `enrollAttended`'s writer writes, from the record alone: the machine key, the ledger holding its id, the
 * enrollment `hub-confirmed` with the certificate and the redemption's enrollment id, the org file's pins. Each file is
 * atomic and the set idempotent (what already holds its value is not written again, so a listed enrollment stays
 * listed), run in the org view's queue as an enrollment's writes are.
 */
function writeProvisionedSet(state: EndpointState, org: EndpointOrg, p: ProvisioningFile, recordsMoved: () => void): Promise<void> {
  return org.exclusive(async () => {
    refuseOtherOrg(state, p.redeemed.org, p.pins);
    if (state.claimRecords({ org: p.redeemed.org, hub: p.hub, recoveryPub: p.pins.recoveryPub }, Date.now())) recordsMoved();
    const { keyId: id, jwk } = p.machineKey;
    if (state.machineKey?.keyId !== id) state.setMachineKey({ version: 1, keyId: id, jwk, created: p.cert.body.issued });
    if (state.ledger === null || !state.ledger.heldKeys.includes(id)) state.setLedger({ version: 1, heldKeys: [id], grants: {}, highWater: {} });
    const held = state.enrollment;
    if (held === null || held.enrollment !== p.redeemed.enrollment || held.cert?.sig.value !== p.cert.sig.value) {
      state.setEnrollment({
        version: 1,
        state: 'hub-confirmed',
        name: p.redeemed.machine,
        ref: p.cert.body.machine,
        org: p.redeemed.org,
        hub: p.hub,
        enrollment: p.redeemed.enrollment,
        credentials: { clientId: p.redeemed.client_id, clientSecret: p.redeemed.client_secret },
        at: p.cert.body.issued,
        cert: p.cert,
      });
    }
    pinOrg(state, p.redeemed.org, p.pins);
  });
}
