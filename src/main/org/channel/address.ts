// Whom the owner's words address (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's "People's
// words, sent"): a leading `@alias` addresses that session, and untagged words go to everyone. The grammar is `sminos
// say`'s (smns §4, `leading_tags` and `resolve_tags`), as desk-web reads it (apps/desk-web/src/conversation/address.ts):
// only the run of tags that opens the text addresses anyone (`@name`, `@"name with spaces"`, `@name#short`, `@short`,
// each optionally followed by `,:;`), and an @ later in the text is text. The text is sent as typed, tags and all.
//
// The project's sessions are what its log's lifecycle events say: each session's latest `joined` (its alias) or
// `retired`, from the session's own writer.
//
// Electron-free.
import { streamOf, writerMachine } from '../../../../apps/org-protocol/src/index.ts';
import type { ChannelRecipients } from '@shared/ipc/schema/org';

/** A session of the project as addressing sees it: its alias, and whether it is a member now (joined, not retired). */
export type Addressable = { session: string; alias: string; member: boolean };
export type Addressed = { ok: true; to: ChannelRecipients } | { ok: false; reason: 'no-member' | 'ambiguous'; detail: string };

type Logged = Record<string, unknown> & { writer: string };

/** Each session's latest membership, in the order the log first names it. */
export function projectSessions(events: Iterable<Logged>): Addressable[] {
  const sessions = new Map<string, Addressable>();
  for (const event of events) {
    if ((event.kind !== 'joined' && event.kind !== 'retired') || typeof event.session !== 'string') continue;
    const machine = writerMachine(event.writer);
    // a session's lifecycle is its own writer's (`<machine>/<session>`), or one of its streams
    if (machine === null || streamOf(event.writer).base !== `${machine}/${event.session}`) continue;
    const held = sessions.get(event.session);
    if (event.kind === 'joined' && typeof event.alias === 'string' && event.alias !== '') sessions.set(event.session, { session: event.session, alias: event.alias, member: true });
    else if (event.kind === 'retired' && held !== undefined) sessions.set(event.session, { ...held, member: false });
  }
  return [...sessions.values()];
}

// sminos's TAG_RE, with Python's Unicode `\w` spelled out.
const TAG = /@(?:"([^"\n]+)"|([\p{L}\p{N}_.-]+(?:\/[\p{L}\p{N}_.-]+)?))(?:#([0-9a-f]{1,8}))?/uy;
type Tag = { raw: string; name: string; short: string };

function leadingTags(text: string): Tag[] {
  const tags: Tag[] = [];
  let pos = 0;
  for (;;) {
    while (pos < text.length && /\s/u.test(text[pos])) pos++;
    TAG.lastIndex = pos;
    const m = TAG.exec(text);
    if (!m) return tags;
    let end = TAG.lastIndex;
    while (end < text.length && ',:;'.includes(text[end])) end++;
    if (end < text.length && !/\s/u.test(text[end])) return tags;
    const full = m[1] ?? m[2];
    tags.push({ raw: m[0], name: full.slice(full.lastIndexOf('/') + 1), short: m[3] ?? '' });
    pos = end;
  }
}

const shortId = (session: string) => session.slice(0, 8);

/** The recipients `text`'s leading tags name among `sessions`' members; everyone when it has none. */
export function addressOf(text: string, sessions: readonly Addressable[]): Addressed {
  const tags = leadingTags(text);
  if (tags.length === 0) return { ok: true, to: '*' };
  const to: Array<{ session: string; alias: string }> = [];
  for (const tag of tags) {
    const answers = (s: Addressable) => (tag.short ? s.alias === tag.name && shortId(s.session).startsWith(tag.short) : [s.alias, shortId(s.session), s.session].includes(tag.name));
    const found = sessions.filter((s) => s.member && answers(s));
    if (found.length === 0) return { ok: false, reason: 'no-member', detail: tag.raw };
    if (found.length > 1) return { ok: false, reason: 'ambiguous', detail: tag.raw };
    const [s] = found;
    if (!to.some((r) => r.session === s.session)) to.push({ session: s.session, alias: s.alias });
  }
  return { ok: true, to };
}
