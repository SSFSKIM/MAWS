// Whom the owner's words address (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's "People's
// words, sent"): a leading `@alias` addresses that session, and untagged words go to everyone. The grammar is `sminos
// say`'s (smns §4, `leading_tags` and `resolve_tags`), as desk-web reads it (apps/desk-web/src/conversation/address.ts):
// only the run of tags that opens the text addresses anyone (`@name`, `@"name with spaces"`, `@name#short`, `@short`,
// each optionally followed by `,:;`), and an @ later in the text is text. The text is sent as typed, tags and all.
//
// The project's sessions are what its log's lifecycle events say (`projectSessions`): each session's latest `joined`
// (its alias, its machine; a member), `retired` (a member no more), `renamed` (its alias) and `titled` (its title), by
// offset, from the session's own writer. The held log keeps these past its bound (cache.ts), so a session whose `joined`
// was let go is still addressed and titled.
//
// Electron-free.
import { streamOf, writerMachine } from '../../../../apps/org-protocol/src/index.ts';
import type { ChannelRecipients, ChannelSession } from '@shared/ipc/schema/org';

/** A session of the project as addressing sees it: its alias, and whether it is a member now (joined, not retired). */
export type Addressable = Pick<ChannelSession, 'session' | 'alias' | 'member'>;
export type Addressed = { ok: true; to: ChannelRecipients } | { ok: false; reason: 'no-member' | 'ambiguous'; detail: string };

type Logged = Record<string, unknown> & { writer: string };
export const LIFECYCLE_KINDS = ['joined', 'retired', 'renamed', 'titled'] as const;
export type LifecycleKind = (typeof LIFECYCLE_KINDS)[number];

/** The session and kind of a lifecycle event from the session's own writer (`<machine>/<session>`, or a stream of it). */
export function lifecycleOf(event: Logged): { session: string; kind: LifecycleKind } | null {
  const kind = LIFECYCLE_KINDS.find((k) => k === event.kind);
  if (kind === undefined || typeof event.session !== 'string') return null;
  const machine = writerMachine(event.writer);
  if (machine === null || streamOf(event.writer).base !== `${machine}/${event.session}`) return null;
  return { session: event.session, kind };
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** Each session's latest lifecycle, read by offset, in the order the log first names it. */
export function projectSessions(entries: Iterable<{ offset: number; event: Logged }>): ChannelSession[] {
  const sessions = new Map<string, ChannelSession>();
  for (const { event } of [...entries].sort((a, b) => a.offset - b.offset)) {
    const lifecycle = lifecycleOf(event);
    if (lifecycle === null) continue;
    const { session } = lifecycle;
    const held = sessions.get(session) ?? { session, alias: session.slice(0, 8), machine: writerMachine(event.writer) ?? '', title: null, member: false };
    if (lifecycle.kind === 'joined') sessions.set(session, { ...held, alias: text(event.alias) ?? held.alias, machine: text(event.machine) ?? held.machine, member: true });
    else if (lifecycle.kind === 'retired') sessions.set(session, { ...held, member: false });
    else if (lifecycle.kind === 'renamed') sessions.set(session, { ...held, alias: text(event.alias) ?? held.alias });
    else sessions.set(session, { ...held, title: typeof event.title === 'string' ? event.title.trim() || null : null });
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
