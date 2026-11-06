// Posting from the web follows `sminos say`'s grammar (smns §4; `leading_tags`, `resolve_tags` in sminos.py): only the
// run of tags that opens the text addresses anyone — `@name`, `@"name with spaces"`, `@name#short`, `@short`, each
// optionally followed by `,:;` — and an @ later in the text is just text. Untagged is a record to `*` that wakes no one;
// `@alias` delivers to that member; `@all` stands alone and is the members live at submission, recorded with `wake`.
// The text is sent as typed, tags and all, as sminos records it.
import type { Recipient } from 'desk-hub/protocol';

/**
 * A session as addressing sees it: its membership (latest `joined`/`retired`) and whether it is live now; and its title,
 * which `@` completion matches and shows (a tag always names the alias).
 */
export type Addressable = { session: string; alias: string; member: boolean; live: boolean; title?: string | null };

export type Tag = { raw: string; project: string; name: string; short: string };

export type Addressed = { ok: true; to: '*' | Recipient[]; wake: boolean } | { ok: false; reason: string };

// sminos's TAG_RE, with Python's Unicode `\w` spelled out.
const TAG = /@(?:"([^"\n]+)"|([\p{L}\p{N}_.-]+(?:\/[\p{L}\p{N}_.-]+)?))(?:#([0-9a-f]{1,8}))?/uy;

export function leadingTags(text: string): Tag[] {
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
    const slash = full.lastIndexOf('/');
    tags.push({ raw: m[0], project: slash < 0 ? '' : full.slice(0, slash), name: full.slice(slash + 1), short: m[3] ?? '' });
    pos = end;
  }
}

const short = (session: string) => session.slice(0, 8);
const isAll = (tag: Tag) => tag.name === 'all' && !tag.project && !tag.short;

/** `project`: this project's id and name; a tag qualified with either is this project's, as sminos reads it. */
export function address(text: string, sessions: readonly Addressable[], project?: { id: string; name: string }): Addressed {
  const tags = leadingTags(text);
  if (tags.length === 0) return { ok: true, to: '*', wake: false };
  if (tags.some(isAll)) {
    if (tags.length !== 1) return { ok: false, reason: '@all stands alone' };
    return { ok: true, to: sessions.filter((s) => s.member && s.live).map(({ session, alias }) => ({ session, alias })), wake: true };
  }
  const to: Recipient[] = [];
  for (const tag of tags) {
    if (tag.project && tag.project !== project?.id && tag.project !== project?.name) return { ok: false, reason: `the desk sends to this project only: ${tag.raw}` };
    const answers = (s: Addressable) => (tag.short ? s.alias === tag.name && short(s.session).startsWith(tag.short) : [s.alias, short(s.session), s.session].includes(tag.name));
    const found = sessions.filter((s) => s.member && answers(s));
    if (found.length > 1) return { ok: false, reason: `ambiguous ${tag.raw} matches: ${found.map((s) => `${s.alias}#${short(s.session)}`).sort().join(', ')}` };
    if (found.length === 0) {
      const retired = sessions.some((s) => !s.member && answers(s));
      return { ok: false, reason: retired ? `${tag.raw} is retired; say it untagged to leave a note, or resume it` : `no member ${tag.raw} in this project` };
    }
    const [s] = found;
    if (!to.some((r) => r.session === s.session)) to.push({ session: s.session, alias: s.alias });
  }
  return { ok: true, to, wake: false };
}
