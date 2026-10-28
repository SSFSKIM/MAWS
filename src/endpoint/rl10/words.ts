// Words are decided at delivery (O10 M6; RL §5.7; P5's O12 item 2). Before sminos delivers a `human` event as a
// person's words it asks `words? {id, project, session, event}` with the event exactly as it stored it, and delivers it
// as words only on `words`; no answer is no words. The endpoint answers `refuse` for one naming no project, `peer` for
// a session it holds no `member` for, and otherwise decides by where the event came from:
//
//   - an arriving event (stored with its `sig`): verified again against the head at this moment, and found in the
//     inbound index at its own position. A device-signed `hub/<member>` event is `words` when its member is in the
//     head and holds `converse` on the session (M5's rank); a revoked signer, a body that no longer verifies, or one
//     the index doesn't hold at this position (a replay) is `refuse`; a machine-signed event, one signed more than a day
//     ago, one whose member the head no longer holds (a retired key still verifies), or any while the head is past RL
//     §5.2's 30-day backstop, is `peer`: words into another machine's session need a device's signature, the inbound
//     index outlives a day, and a stale head can't vouch for a person's standing.
//   - this machine's own writer (the operator path; sminos stores it unsigned and asks only when its append receipt
//     matches): `words` when the session's owners, `@machine` resolved against the head, include one of the machine's
//     owners, `peer` otherwise; and `refuse` when the signature ledger holds another body at its position, which is
//     tampering. With no ledger entry there (a project the endpoint doesn't relay, or one asked while RL1 is down) the
//     record alone decides: the operator path's trust is the same uid's either way, and the ledger detects tampering,
//     granting nothing.
//   - anything else (unsigned, v1): `peer`.
//
// `words?` names the project whose log holds the event (`project`, required): sminos's `say` copies one message into
// two projects' logs, so the session's member's project is no stand-in. One without a project is `refuse`.
import { createHash } from 'node:crypto';
import { eventSigningInput, isHubWriter, isIsoMillis, isLogSeq, isSig, machineNameKey, verifyEvent, writerMachine, type Certificates, type LogEventV2, type OrgState } from 'org-protocol';
import { rankAtLeast, sessionRank } from '../grades';
import { BACKSTOP_MS } from '../org-sync';
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
  const project = frame.project;
  if (typeof project !== 'string' || project === '') return 'refuse';
  const member = typeof frame.session === 'string' ? ctx.members.get(frame.session) : null;
  if (member === null) return 'peer';
  const event = frame.event;
  if (!isObject(event) || typeof event.writer !== 'string' || !isLogSeq(event.seq)) return 'refuse';
  const org = ctx.org();
  if (org === null) return 'peer';
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
  // RL §5.2's backstop: a head this old can't vouch for a remote person's standing (the operator path, above, is the
  // same uid's and exempt).
  if (ctx.now() - Date.parse(org.head.issued) > BACKSTOP_MS) return 'peer';
  // A retired key still verifies its member's earlier words after they left; a member the head no longer holds has no
  // standing on any session, whatever a record's owners, shares or access say.
  const signer = event.writer.slice('hub/'.length);
  if (!org.head.members.some((m) => m.id === signer)) return 'peer';
  return rankAtLeast(sessionRank(record, signer, owners), 'converse') ? 'words' : 'peer';
}
