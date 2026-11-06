// What a browser's words are sealed with (P5 O18 D4, D8, M2b; docs/doperpowers/plans/2026-11-05-p5-o18-message-
// reach.md). A private session's words go into the member's stream of its audience, `hub/<member>~<digest>`, which
// the hub serves to that audience alone, so the browser seals the audience into the draft and the hub positions it
// there. The audience is the member's policy row of the session: the hub's registry holds every session's latest
// policy from its own machine's signed snapshots, and sends each member the rows of the private sessions whose
// audience holds them (`state/policies.ts`). That is the same registry the hub judges the words against at `takeHuman`,
// so a row gone stale is refused there `not-reachable`, never delivered.
//
// A say to several sessions becomes one event per audience: a listed recipient's words carry none, a private one's
// its row's. Each split carries only its own recipients' leading tags, in their order, and the body unchanged, so the
// listed event never names a private recipient; `@all` names no session and stays in every split. A private session
// the member holds no row of (shared once, since withdrawn) is refused here before anything is sent; with no row and
// nothing in the log saying it is private, a session is taken as listed, and the hub is the backstop.
import { streamOf, writerSession } from 'org-protocol';
import type { LogEvent, MemberPolicy, Recipient } from 'desk-hub/protocol';
import { isAll, leadingRun, tagNames } from '../conversation/address';

/** The member's policy rows, by session. */
export type PolicyRows = ReadonlyMap<string, MemberPolicy>;

/** One event to send: its recipients, its text, and the audience it is sealed with (none toward listed sessions). */
export type Send = { to: '*' | Recipient[]; text: string; audience?: string[] };

export type Planned = { ok: true; sends: Send[] } | { ok: false; reason: string };

/**
 * The events `member`'s words to `to` become: grouped by each recipient's audience (`rows`), in the order each group's
 * first recipient was named. `knownPrivate`: whether the log says a session with no row is private.
 */
export function planSay(member: string, to: '*' | Recipient[], text: string, rows: PolicyRows, knownPrivate: (session: string) => boolean): Planned {
  if (to === '*') return { ok: true, sends: [{ to, text }] };
  const groups = new Map<string, { to: Recipient[]; audience?: string[] }>();
  for (const recipient of to) {
    const row = rows.get(recipient.session);
    if (row ? !row.audience.includes(member) : knownPrivate(recipient.session)) {
      return { ok: false, reason: `@${recipient.alias} can't be reached from here: it is private, and not shared with you` };
    }
    const key = row ? row.audience.join(',') : '';
    const group = groups.get(key) ?? { to: [], ...(row ? { audience: row.audience } : {}) };
    group.to.push(recipient);
    groups.set(key, group);
  }
  if (groups.size === 1) {
    const [group] = groups.values();
    return { ok: true, sends: [{ ...group, text }] };
  }
  const { tags, end } = leadingRun(text);
  const body = text.slice(end).replace(/^\s+/u, '');
  const keepsAll = tags.some(isAll);
  return {
    ok: true,
    sends: [...groups.values()].map((group) => {
      if (keepsAll) return { ...group, text };
      const own = tags.filter((tag) => group.to.some((r) => tagNames(tag, r))).map((tag) => tag.raw);
      return { ...group, text: [...own, ...(body ? [body] : [])].join(' ') };
    }),
  };
}

const SNAPSHOTS = new Set(['joined', 'state']);

/**
 * Whether the log, as this browser holds it, says `session` is private: its newest snapshot (`joined`, `state`) under
 * its own writers is in a stream of an audience, or an `unlisted` notice withdrew this reader since.
 */
export function privateInLog(entries: ReadonlyArray<{ event: LogEvent }>, session: string): boolean {
  let held = false;
  for (const { event } of entries) {
    if (writerSession(event.writer) !== session || event.session !== session) continue;
    if (event.kind === 'unlisted') held = true;
    else if (SNAPSHOTS.has(event.kind)) held = streamOf(event.writer).digest !== null;
  }
  return held;
}
