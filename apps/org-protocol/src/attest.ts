// RL9's owner attestation (Interfaces §C of docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md). An event a session
// writer (`<name>/<session>`) uploads carries `attest {owners, ownersProof, origin, stateVersion}`, covered by the
// event's own v2 signature, which is the machine key's: it needs no second signature, and the caller has verified the
// event (`verifyEvent`) before it reads the attestation.
//
// A claimed owner verifies when it is one of the sending machine's owners (its member owners, the admins for an
// org-owned machine, or its delegation's owners for a certificate), or when a proof in `ownersProof` proves it. A proof
// is a step-up-signed action that names the sending machine, its step-up key verifying by RL8's key rule against the
// action's `created`: the device's current key, or one retired at a `notAfter` no earlier, never a revoked one.
//   - a spawn (`sminos.spawn`, later `session.launch`) proves its signer's member;
//   - an owner-add (`record.owners` with `{ add: true, member }`, O8's) proves the member it names, provided its signer's
//     member is an owner by the machine or by an earlier proof in the list, so a chain of additions verifies in order.
// Grants play no part (RL §5.8). The machine's owners are judged at the event's (or the proof's) own `created`, with the
// verifier's state; `stateVersion`, the head the machine resolved `@machine` against, is the machine's statement and
// is not compared. An attestation verifies whole or not at all: its first failing proof or unproven owner refuses it.
import { isAction, verifyStepUp, type Action } from './action.ts';
import { isIsoMillis, isMemberId, writerMachine, type MemberId } from './names.ts';
import { machineOfSigner, machineOwners, ownerMembers } from './records.ts';
import { isSig } from './keys.ts';
import type { Certificates, LogEventV2, OrgState } from './types.ts';
import { accept, refuse, type Verdict } from './verdict.ts';

export type Attest = { owners: MemberId[]; ownersProof: Action[]; origin: { kind: string; requester?: string; spawnerSession?: string }; stateVersion: number };

/** The actions whose signer's member a spawn proof proves. */
export const SPAWN_ACTIONS: readonly string[] = ['sminos.spawn', 'session.launch'];
/** The owner-add action (O8): `args: { add: true, member }`. */
export const OWNER_ADD_ACTION = 'record.owners';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const exactly = (v: unknown, required: string[], optional: string[] = []): v is Record<string, unknown> =>
  isObject(v) && required.every((k) => k in v) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k));
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '' && v.length <= 512;

export function isAttest(value: unknown): value is Attest {
  if (!exactly(value, ['owners', 'ownersProof', 'origin', 'stateVersion'])) return false;
  const { owners, ownersProof, origin, stateVersion } = value;
  return (
    Array.isArray(owners) &&
    owners.every((m) => typeof m === 'string' && isMemberId(m)) &&
    new Set(owners).size === owners.length &&
    Array.isArray(ownersProof) &&
    ownersProof.every(isAction) &&
    exactly(origin, ['kind'], ['requester', 'spawnerSession']) &&
    isText(origin.kind) &&
    (origin.requester === undefined || isText(origin.requester)) &&
    (origin.spawnerSession === undefined || isText(origin.spawnerSession)) &&
    typeof stateVersion === 'number' &&
    Number.isSafeInteger(stateVersion) &&
    stateVersion >= 1
  );
}

/** The member an owner-add action names, or null for any other action. */
function ownerAdded(proof: Action): MemberId | null {
  const { add, member } = proof.args;
  return proof.action === OWNER_ADD_ACTION && add === true && typeof member === 'string' && isMemberId(member) ? member : null;
}

/**
 * Who signed `proof`: the member that held the step-up key whose signature verifies, among the keys the device id it
 * names has held that may sign at its `created` (its current one, and each retired no earlier). Each key keeps the
 * member that held it, so a device id given to another member later never inherits an earlier holder's signatures.
 * `unknown-signer` when the id names no such key, `revoked` when the id's step-up key is revoked and nothing verifies,
 * `bad-signature` when a key is found and none verifies.
 */
async function proofSigner(state: OrgState, proof: Action): Promise<{ member: MemberId } | { refused: 'unknown-signer' | 'revoked' | 'bad-signature' }> {
  const holds = (h: unknown): h is { member: MemberId; device: string; key: string } => isObject(h) && h.device === proof.device && h.key === 'step-up';
  const candidates: Array<{ member: MemberId; pub: string }> = [];
  for (const m of state.members) {
    for (const d of m.devices) if (d.id === proof.device && d.stepUpPub !== undefined) candidates.push({ member: m.id, pub: d.stepUpPub });
  }
  for (const r of state.retired) if (holds(r.holder) && r.notAfter >= proof.created) candidates.push({ member: r.holder.member, pub: r.pub });
  for (const { member, pub } of candidates) if ((await verifyStepUp(proof, pub)).ok) return { member };
  if (state.revoked.some((r) => holds(r.holder))) return { refused: 'revoked' };
  return { refused: candidates.length === 0 ? 'unknown-signer' : 'bad-signature' };
}

/**
 * One proof of `owner` on machine `machine` (a ref): a step-up-signed action naming that machine, by a key RL8's rule
 * allows at its `created`, that is a spawn by `owner`'s device, or an owner-add of `owner` whose signer's member is an
 * owner of the machine or among `proven` (members earlier proofs established).
 */
export async function verifyOwnersProof(
  state: OrgState,
  certificates: Certificates,
  proof: Action,
  owner: MemberId,
  machine: string,
  proven: readonly MemberId[] = [],
): Promise<Verdict> {
  if (!isAction(proof) || proof.stepUp === undefined || proof.org !== state.org) return refuse('malformed');
  if (proof.machine !== machine) return refuse('other-machine');
  const signer = await proofSigner(state, proof);
  if ('refused' in signer) return refuse(signer.refused);
  if (SPAWN_ACTIONS.includes(proof.action)) return signer.member === owner ? accept() : refuse('not-owner');
  if (ownerAdded(proof) !== owner) return refuse('not-owner');
  const owners = await machineOwners(state, machine, certificates, new Date(proof.created));
  const established = new Set([...(owners === null ? [] : ownerMembers(state, owners)), ...proven]);
  return established.has(signer.member) ? accept() : refuse('not-owner');
}

/**
 * `event.attest` verified against `state`: every claimed owner is the sending machine's or proven, in order, by
 * `ownersProof`. On success it answers the owners, which the receiving side may label as verified.
 */
export async function verifyAttestation(state: OrgState, certificates: Certificates, event: LogEventV2): Promise<Verdict & { owners?: MemberId[] }> {
  const attest = (event as { attest?: unknown }).attest;
  const name = typeof event.writer === 'string' ? writerMachine(event.writer) : null;
  if (!isAttest(attest) || name === null || !isSig(event.sig) || !isIsoMillis(event.created)) return refuse('malformed');
  const sender = await machineOfSigner(state, name, event.sig.kid, certificates, new Date(event.created));
  if (sender === null) return refuse('unknown-signer');
  const established = new Set(ownerMembers(state, sender.owners));
  for (const proof of attest.ownersProof) {
    const signer = isAction(proof) && proof.stepUp !== undefined ? await proofSigner(state, proof) : null;
    const target = ownerAdded(proof) ?? (signer !== null && 'member' in signer ? signer.member : '');
    const verdict = await verifyOwnersProof(state, certificates, proof, target, sender.ref, [...established]);
    if (!verdict.ok) return verdict;
    established.add(target);
  }
  return attest.owners.every((owner) => established.has(owner)) ? { ...accept(), owners: attest.owners } : refuse('not-owner');
}
