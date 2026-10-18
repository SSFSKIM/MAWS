// `@` completion for the group composer (mockups/desk/05-phone.html, 4c): aliases with short ids are hard to type on
// glass, so typing an @ among the tags that open a post lists the project's live members matching what follows, and a
// pick inserts the exact tag `sminos say` resolves — `@alias`, `@alias#short` where it would reach another member too
// (an ended session that has not retired is still one), `@"alias"` for one with spaces — or `@all`. An @ later in the
// text is only text (address.ts), so nothing is offered there. A member is found by its title too, the name its human
// knows it by, and listed with it; the tag still names its alias, which is what `sminos say` resolves.
import { address, leadingTags, type Addressable } from './address';

export type Completion = { tag: string; alias: string; session: string | null; title: string | null };

/** The tag being typed at `caret`, when it is one of the tags that open the text: where it starts and what follows @. */
export function completionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@]*)$/u.exec(before);
  if (!m) return null;
  if (caret < text.length && !/\s/u.test(text[caret])) return null; // the caret is inside a word, not at a tag's end
  const start = m.index + m[1].length;
  // Everything before the tag must itself be opening tags (and their separators), or the @ is only text.
  let rest = text.slice(0, start);
  for (const tag of leadingTags(rest)) rest = rest.replace(tag.raw, '');
  if (rest.replace(/[\s,:;]/gu, '') !== '') return null;
  return { start, query: m[2] };
}

const short = (session: string) => session.slice(0, 8);

/**
 * The live members (and `@all`) whose alias starts with `query`, or whose title or a word of it does, each with the tag
 * that addresses exactly it.
 */
export function complete(query: string, sessions: readonly Addressable[]): Completion[] {
  const live = sessions.filter((s) => s.member && s.live);
  const q = query.toLowerCase();
  const titled = (title: string) => title.startsWith(q) || title.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(q));
  const found: Completion[] = live
    .filter((s) => s.alias.toLowerCase().startsWith(q) || (s.title ? titled(s.title.toLowerCase()) : false))
    .map((s) => ({ tag: tagFor(s, sessions), alias: s.alias, session: s.session, title: s.title || null }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
  if ('all'.startsWith(q)) found.push({ tag: '@all', alias: 'all', session: null, title: null });
  return found;
}

/** The tag that addresses exactly `s` as posting resolves it, against every member: the alias alone when it reaches only
 * `s`, else with `s`'s short id. */
function tagFor(s: Addressable, sessions: readonly Addressable[]): string {
  const name = /[\s"]/u.test(s.alias) ? `"${s.alias}"` : s.alias;
  const plain = address(`@${name} `, sessions);
  const alone = plain.ok && plain.to !== '*' && plain.to.length === 1 && plain.to[0].session === s.session;
  return alone ? `@${name}` : `@${name}#${short(s.session)}`;
}

/** The text with the tag at `start` (typed up to `caret`) replaced by `tag` and a space, and where the caret goes. */
export function insertTag(text: string, start: number, caret: number, tag: string): { text: string; caret: number } {
  const next = `${text.slice(0, start)}${tag} ${text.slice(caret).replace(/^ /u, '')}`;
  return { text: next, caret: start + tag.length + 1 };
}
