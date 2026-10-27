// Words are decided at delivery (O10 M6; RL §5.7; P5's O12 item 2). Before sminos delivers a `human` event as a
// person's words it asks `words? {id, session, event}` with the event exactly as it stored it, and delivers it as words
// only on `words`; no answer is no words. The endpoint answers `peer` for a session it holds no `member` for, and
// otherwise decides by where the event came from:
//
//   - an arriving event (stored with its `sig`): verified again against the head at this moment, and found in the
//     inbound index at its own position. A device-signed `hub/<member>` event is `words` when its member holds
//     `converse` on the session (M5's rank); a revoked signer, a body that no longer verifies, or one the index doesn't
//     hold at this position (a replay) is `refuse`; a machine-signed event, or one signed more than a day ago, is
//     `peer`: words into another machine's session need a device's signature, and the inbound index outlives a day.
//   - this machine's own writer (the operator path; sminos stores it unsigned and asks only when its append receipt
//     matches): `words` when the session's owners, `@machine` resolved against the head, include one of the machine's
//     owners, `peer` otherwise; and `refuse` when the signature ledger holds another body at its position, which is
//     tampering. With no ledger entry there (a project the endpoint doesn't relay, or one asked while RL1 is down) the
//     record alone decides: the operator path's trust is the same uid's either way, and the ledger detects tampering,
//     granting nothing.
//   - anything else (unsigned, v1): `peer`.
//
// `words?` names no project; the event is the session's member's project's, unless sminos names one (`project`, which
// it may add): a session sminos lists in two projects is listed under the first.
import { createHash } from 'node:crypto';
import { eventSigningInput, isHubWriter, isIsoMillis, isLogSeq, isSig, machineNameKey, verifyEvent, writerMachine, type Certificates, type LogEventV2, type OrgState } from 'org-protocol';
import { rankAtLeast, sessionRank } from '../grades';
import { resolveOwners } from '../listings';
import type { InboundIndex } from './inbound-index';
import type { Members } from './members';
import { bodyHash, uploadForm, type SignatureLedger } from './signature-ledger';

export type Verdict = 'words' | 'peer' | 'refuse';

/** A `human` event signed longer ago than this is never words. */
export const WORDS_MAX_AGE_MS = 86_400_000;

export type WordsContext = {
  org(): { head: OrgState; certificates: Certificates; ref: string } | null;
  /** The machine's owners as member ids (its member owners, or the admins of an org-owned machine). */
  machineOwners(): Promise<string[]>;
  members: Members;
  ledger: SignatureLedger;
  index: InboundIndex;
  now(): number;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export async function decideWords(ctx: WordsContext, frame: Record<string, unknown>): Promise<Verdict> {
  const member = typeof frame.session === 'string' ? ctx.members.get(frame.session) : null;
  if (member === null) return 'peer';
  const event = frame.event;
  if (!isObject(event) || typeof event.writer !== 'string' || !isLogSeq(event.seq)) return 'refuse';
  const org = ctx.org();
  if (org === null) return 'peer';
  const project = typeof frame.project === 'string' ? frame.project : member.project;
  const record = ctx.members.recordOf(member.session);
  const owners = await ctx.machineOwners();
  const name = writerMachine(event.writer);
  if (name !== null && org.head.machineNames.some((p) => p.ref === org.ref && machineNameKey(p.name) === machineNameKey(name))) {
    const form = uploadForm(event);
    if (form === null) return 'refuse';
    const held = ctx.ledger.get(project, event.writer, event.seq);
    if (held !== null && held.hash !== bodyHash(form)) return 'refuse';
    const resolved = await resolveOwners(member.owners, org.head, org.ref, org.certificates, new Date(ctx.now()));
    return resolved.some((id) => owners.includes(id)) ? 'words' : 'peer';
  }
  if (!isSig(event.sig)) return 'peer';
  const ctxt = { org: org.head.org, project };
  const verdict = await verifyEvent(ctxt, org.head, event as LogEventV2, org.certificates, new Date(ctx.now()));
  if (!verdict.ok) return verdict.code === 'revoked' || verdict.code === 'bad-signature' ? 'refuse' : 'peer';
  const content = createHash('sha256').update(eventSigningInput(ctxt, event)).digest('base64url');
  if (ctx.index.at(project, event.writer, event.seq) !== content) return 'refuse';
  if (!isIsoMillis(event.created) || ctx.now() - Date.parse(event.created) > WORDS_MAX_AGE_MS) return 'peer';
  if (!isHubWriter(event.writer)) return 'peer';
  const signer = event.writer.slice('hub/'.length);
  return rankAtLeast(sessionRank(record, signer, owners), 'converse') ? 'words' : 'peer';
}
