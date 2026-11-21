// Message reach (P5 O18, docs/doperpowers/plans/2026-11-05-p5-o18-message-reach.md, Interfaces §A): what an event
// names of sessions, the `unlisted` transition notice, and the hub's tombstone of a position it withheld; and X8's
// machine's notice (`noticeOf`, `noticeSender`), which the endpoint's `words?` and the app's channel read alike. The stream
// names themselves (`audienceDigest`, `streamOf`, `isAudience`) are in names.ts, beside the writer grammar.
import { isAudience, isLogSeq, streamOf, writerMachine } from './names.ts';

/** A session an event names (D4): `addressing` joins its audience's intersection; `provenance` never widens what a
 * session's id reaches, and is redacted when that session's audience does not contain the event's. `path` names the
 * field, dot-separated (`to.0.session`), for redaction. */
export type EventSessionRef = { session: string; role: 'addressing' | 'provenance'; path: string };

/** The transition notice a session's machine writes when a change withdraws members from its audience (D6): content
 * free, under the session's own writer namespace, its audience the withdrawn members, at the new `policyRev`. */
export type UnlistedNotice = { kind: 'unlisted'; session: string; policyRev: number; audience: string[] };

/** What the hub stores in place of an event it withheld (`not-reachable`, D5), and serves in the writer's stream so the
 * writer continues at the next seq. */
export type WithheldTombstone = { writer: string; seq: number; withheld: true };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSessionId = (v: unknown): v is string => typeof v === 'string' && v !== '' && v.length <= 256;

/** The session a writer is a feed of (`<machine>/<session>` or its stream), or null for `hub/`, `legacy/` and a
 * machine's `human`. */
export function writerSession(writer: unknown): string | null {
  if (typeof writer !== 'string') return null;
  const base = streamOf(writer).base;
  const machine = writerMachine(base);
  if (machine === null) return null;
  const session = base.slice(machine.length + 1);
  return session === '' || session === 'human' ? null : session;
}

/** A machine's notice's program name as sminos shows it; one that doesn't fit is shown as `notice`. */
export const NOTICE_PROGRAM = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * The program a machine's notice names (X8), or null for any event that is no notice. A notice is a `human` event under
 * a machine's human writer (`<machine>/human`, or its audience stream `<machine>/human~<digest>`), never `hub/<member>`,
 * whose `notice` is a non-empty string. It is never a person's words: every reader of what a person said reads it as
 * the machine's notice. The field on any other kind or under any other writer marks nothing.
 */
export function noticeOf(event: unknown): string | null {
  if (!isObject(event) || event.kind !== 'human' || typeof event.notice !== 'string' || event.notice === '') return null;
  return humanWriterMachine(event.writer) === null ? null : event.notice;
}

/** Who a machine's notice says spoke: `<program>@<machine>`, `notice@<machine>` for a program outside the grammar; null for no notice. */
export function noticeSender(event: unknown): string | null {
  const program = noticeOf(event);
  if (program === null) return null;
  return `${NOTICE_PROGRAM.test(program) ? program : 'notice'}@${humanWriterMachine((event as { writer: string }).writer)}`;
}

/** The machine a machine's human writer (`<machine>/human` or its stream) names; null for any other writer. */
function humanWriterMachine(writer: unknown): string | null {
  if (typeof writer !== 'string') return null;
  const { base } = streamOf(writer);
  const machine = writerMachine(base);
  return machine !== null && base === `${machine}/human` ? machine : null;
}

/**
 * Every structured session reference `event` carries, its writing session aside (D4): each recipient's
 * `to[].session`, the `session` of an event written under another feed (an `in-charge` or a status set for a session),
 * the spawner in `origin` and in the attestation's `origin`, and a `continued` retirement's successor. A redacted one
 * (null, or left out) is none. Every reader of a session from an event goes through this one list.
 */
export function sessionRefs(event: unknown): EventSessionRef[] {
  if (!isObject(event)) return [];
  const out: EventSessionRef[] = [];
  const own = writerSession(event.writer);
  if (Array.isArray(event.to)) {
    event.to.forEach((r, i) => {
      if (isObject(r) && isSessionId(r.session)) out.push({ session: r.session, role: 'addressing', path: `to.${i}.session` });
    });
  }
  if (isSessionId(event.session) && event.session !== own) out.push({ session: event.session, role: 'addressing', path: 'session' });
  if (isObject(event.origin) && isSessionId(event.origin.spawnerSession)) out.push({ session: event.origin.spawnerSession, role: 'provenance', path: 'origin.spawnerSession' });
  const attest = event.attest;
  if (isObject(attest) && isObject(attest.origin) && isSessionId(attest.origin.spawnerSession)) {
    out.push({ session: attest.origin.spawnerSession, role: 'provenance', path: 'attest.origin.spawnerSession' });
  }
  if (event.kind === 'retired' && event.reason === 'continued' && isSessionId(event.to)) out.push({ session: event.to, role: 'provenance', path: 'to' });
  return out;
}

/** Whether `event` is an `unlisted` notice as D6 shapes it: the session, a `policyRev` from 1, its withdrawn members,
 * and no words (`text`) or recipients (`to`). Where it may sit is the hub's and the signer's to judge. */
export function isUnlistedNotice(event: unknown): event is UnlistedNotice & Record<string, unknown> {
  return (
    isObject(event) &&
    event.kind === 'unlisted' &&
    isSessionId(event.session) &&
    isLogSeq(event.policyRev) &&
    isAudience(event.audience) &&
    !('text' in event) &&
    !('to' in event)
  );
}

/** Whether `value` is the hub's tombstone of a withheld position, exactly. */
export function isWithheldTombstone(value: unknown): value is WithheldTombstone {
  return isObject(value) && Object.keys(value).length === 3 && typeof value.writer === 'string' && isLogSeq(value.seq) && value.withheld === true;
}
