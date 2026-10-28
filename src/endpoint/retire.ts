// A delegated machine's departure (O14 M1; RL §5.2): `mawsd endpoint retire` retires its own certificate with its
// delegation's key, frees its hub row, and destroys its keys. The retirement is trusted because the retired key is
// destroyed, so it can sign nothing backdated; the keys go only once both hub calls are marked done in
// `retirement.json`, which is written, with the signed record and its `notAfter`, before any hub call, so a rerun after
// any interruption reuses the same record. A lost answer is reconciled from the hub's next one: a 401 or 403 while the
// retirement is marked posted is the credential the `DELETE` ended, so the `DELETE` is taken as done. An enrolled
// machine's key is retired by an admin's state change, never by the machine itself (`not-delegated`).
import { importSigningKey, keyId, SIGNING_DOMAINS, signRecord, type CertRetirement, type MachineCert, type Signed } from 'org-protocol';
import { MACHINE_CERT_RETIREMENTS_PATH, MACHINE_ENROLLMENT_PATH } from 'desk-hub/protocol';
import { EnrollError, refuseIfRefused, type EnrollContext } from './enroll';
import { hubRequest, refusalOf, type Credentials } from './hub-http';
import { CertRefused, settle } from './provision';
import type { RetirementFile } from './state/store';

/** The skew margin `notAfter` takes past now when none is given (RL §5.2: set once the key is gone, with a margin). */
export const RETIRE_MARGIN_MS = 60_000;

export type Retired =
  /** Nothing was held: no certificate, no credential. */
  | { kind: 'nothing' }
  /** The certificate retired as `record` says, the hub row gone, the keys destroyed. */
  | { kind: 'retired'; name: string; keyId: string; notAfter: string }
  /** The hub never held the certificate (its post was refused), so only the row went; the keys are destroyed. */
  | { kind: 'uncertified'; name: string; reason: string }
  /** The hub no longer took the credential before anything was retired: the keys are destroyed, the hub side is an admin's. */
  | { kind: 'orphaned'; name: string };

/** The endpoint's own unenroll: links stopped, keys destroyed, the rest moved aside (Endpoint.unenroll). */
export type Unenroll = () => Promise<unknown>;

/** `mawsd endpoint retire` (see the header). Throws an EnrollError for a refusal, with nothing destroyed. */
export async function retireInto(ctx: EnrollContext, unenroll: Unenroll, input: { notAfter?: string }): Promise<Retired> {
  const { state } = ctx;
  refuseIfRefused(state);
  if (state.delegation === null) {
    // The keys went at an earlier run that ended before the rest was moved aside.
    if (state.retirement !== null) return finish(unenroll, retiredOf(state.retirement, state.enrollment?.name ?? state.retirement.record.body.keyId));
    if (state.enrolled || state.provisioning !== null) {
      throw new EnrollError('not-delegated: this machine is enrolled by a member\'s code; an admin retires its key in the org state (`machine drop`)');
    }
    return { kind: 'nothing' };
  }
  if (state.provisioning !== null && state.retirement === null) {
    const name = state.provisioning.redeemed.machine;
    const credentials = { clientId: state.provisioning.redeemed.client_id, clientSecret: state.provisioning.redeemed.client_secret };
    const hub = state.provisioning.hub;
    try {
      const pending = await settle(ctx, 'established');
      if (pending !== null) throw new EnrollError(`the provisioning of ${name} is not settled (${pending.refused}); nothing is retired yet: run \`retire\` again`);
    } catch (error) {
      if (!(error instanceof CertRefused)) throw error;
      if (error.credentialGone) return finish(unenroll, { kind: 'orphaned', name });
      await removeRow(ctx, hub, credentials, false);
      return finish(unenroll, { kind: 'uncertified', name, reason: error.message });
    }
  }
  const enrollment = state.enrollment;
  const cert = enrollment?.cert;
  if (enrollment === null || cert === undefined) {
    if (state.retirement !== null) return finish(unenroll, retiredOf(state.retirement, enrollment?.name ?? state.retirement.record.body.keyId));
    throw new EnrollError('not-delegated: this machine holds a delegation but no certificate; `mawsd endpoint unenroll` puts it aside');
  }
  let retirement = state.retirement ?? (await begin(ctx, enrollment.org, cert, input.notAfter));
  const credentials = enrollment.credentials;
  if (!retirement.posted) {
    const posted = await hubRequest(ctx.deps, enrollment.hub, MACHINE_CERT_RETIREMENTS_PATH, { credentials, body: retirement.record });
    if (posted.status !== 200 && posted.status !== 201) {
      const how = posted.status === 401 || posted.status === 403 ? ' (the hub no longer takes this machine\'s credential: an admin\'s `machine drop` from the Mac retires it)' : '';
      throw new EnrollError(`the hub refused the certificate's retirement: ${posted.status} ${await refusalOf(posted)}${how}; nothing is destroyed`);
    }
    await posted.body?.cancel();
    retirement = { ...retirement, posted: true };
    state.setRetirement(retirement);
  }
  if (!retirement.deleted) {
    await removeRow(ctx, enrollment.hub, credentials, true);
    retirement = { ...retirement, deleted: true };
    state.setRetirement(retirement);
  }
  return finish(unenroll, retiredOf(retirement, enrollment.name));
}

/** The record signed and kept before any hub call: `notAfter` now plus the margin, or as given. */
async function begin(ctx: EnrollContext, org: string, cert: Signed<MachineCert>, notAfter: string | undefined): Promise<RetirementFile> {
  const delegation = ctx.state.delegation!;
  const key = await importSigningKey(delegation.privateJwk);
  const body: CertRetirement = { org, keyId: await keyId(cert.body.pub), notAfter: notAfter ?? new Date(ctx.deps.now() + RETIRE_MARGIN_MS).toISOString() };
  const record = await signRecord(SIGNING_DOMAINS.certRetire, body, key.privateKey, key.pub);
  const retirement: RetirementFile = { version: 1, record, posted: false, deleted: false };
  ctx.state.setRetirement(retirement);
  return retirement;
}

/**
 * `DELETE /machine/enrollment`: the row and its credential go. A 401 or 403 is the `DELETE` already done when the
 * retirement was posted first (`afterPost`), or when no certificate was ever held; anything else is a refusal.
 */
async function removeRow(ctx: EnrollContext, hub: string, credentials: Credentials, afterPost: boolean): Promise<void> {
  const deleted = await hubRequest(ctx.deps, hub, MACHINE_ENROLLMENT_PATH, { credentials, method: 'DELETE' });
  if (deleted.status === 200 || deleted.status === 204) return void (await deleted.body?.cancel());
  if (deleted.status === 401 || deleted.status === 403) {
    await deleted.body?.cancel();
    ctx.log(`endpoint: the hub no longer takes this machine's credential (${deleted.status}): its row is gone${afterPost ? ', as the retirement\'s DELETE leaves it' : ''}`);
    return;
  }
  throw new EnrollError(`the hub did not remove the machine's row: ${deleted.status} ${await refusalOf(deleted)}; nothing is destroyed: run \`retire\` again`);
}

function retiredOf(retirement: RetirementFile, name: string): Retired {
  return { kind: 'retired', name, keyId: retirement.record.body.keyId, notAfter: retirement.record.body.notAfter };
}

/** Both hub calls are done (or were never needed): the keys are destroyed and the rest put aside. */
async function finish(unenroll: Unenroll, outcome: Retired): Promise<Retired> {
  await unenroll();
  return outcome;
}
