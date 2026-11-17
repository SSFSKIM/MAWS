// The send side of pasted content (C7 execution document, Interfaces "Document model and serialisation", beside C6's
// grammar module `pasted-content.ts`, which C7 reads and never edits). The terminal's own framing (`cli.pretty.js` Xnt,
// SPEC 42 §42.15): a pasted block opens after a blank line, both tags carry the same four-hex id, and the block ends
// with a newline; typed text and pasted bodies are neutralised first by rewriting only the `<` of a `pasted_content`
// tag, so nothing the human typed can open or close a block. The engine's parser (`vmt`), which C6's `PASTED_BLOCK`
// reproduces, reads exactly this framing. Also the placeholder's line count and the recall parser for history.
import { framePasted } from './pasted-content';
import { sha256Hex } from './sha256';

// `<pasted_content` → `<\pasted_content`, `</pasted_content` → `<\/pasted_content`; an already neutralised tag is left
// alone (the tag name must follow the `<` directly). Ticket 733a (its document, Design 1): the tag is read in the
// compatibility fold too, a character at a time (NFKC, then lower case), so a look-alike spelling (a full-width or small
// bracket, a full-width slash or letters, a letter that folds to the name's) is neutralised as the ASCII one is, by a
// backslash after its bracket: after it, the NFKC lower-case fold of the text holds no `<pasted_content` and no
// `</pasted_content`, and a model reading a segment's body cannot take the block for ended. The engine's own parser reads
// the ASCII spelling; its writer also scrubs letters of other scripts that look alike, which MAWS does not reproduce.
const ASCII_TAG = /<(?!\\)(?=\/?pasted_content)/gi;
const ASCII_NEUTRALISED = /<\\(?=\/?pasted_content)/gi;
const BEYOND_ASCII = /[^\x00-\x7f]/;
const FOLDED_TAG = /<(?=\/?pasted_content)/g;
const FOLDED_NEUTRALISED = /<\\(?=\/?pasted_content)/g;

// The text folded a character at a time, and for each code unit of the fold the end in the text of the character it
// came from. Folding by character finds every spelling the whole text's fold holds: folding the whole composes a letter
// and a mark into a letter beyond ASCII, and never makes one of ASCII.
function foldByCharacter(text: string): { folded: string; ends: number[] } {
  let folded = '';
  const ends: number[] = [];
  for (let i = 0; i < text.length; ) {
    const point = text.codePointAt(i)!;
    const end = i + (point > 0xffff ? 2 : 1);
    const fold = point < 0x80 ? text[i]!.toLowerCase() : String.fromCodePoint(point).normalize('NFKC').toLowerCase();
    folded += fold;
    for (let k = 0; k < fold.length; k += 1) ends.push(end);
    i = end;
  }
  return { folded, ends };
}

export function neutralisePastedTags(text: string): string {
  if (!BEYOND_ASCII.test(text)) return text.replace(ASCII_TAG, '<\\');
  const { folded, ends } = foldByCharacter(text);
  let out = '';
  let from = 0;
  for (const match of folded.matchAll(FOLDED_TAG)) {
    const at = ends[match.index]!; // after the character that folds to the bracket
    out += `${text.slice(from, at)}\\`;
    from = at;
  }
  return from === 0 ? text : out + text.slice(from);
}

// The inverse, for recall: the text as typed from text that went on the wire (a user row's text). Lossy only for a
// typed `<\pasted_content` (in any spelling the neutraliser reads), which comes back as `<pasted_content`.
export function restorePastedTags(text: string): string {
  if (!BEYOND_ASCII.test(text)) return text.replace(ASCII_NEUTRALISED, '<');
  const { folded, ends } = foldByCharacter(text);
  let out = '';
  let from = 0;
  for (const match of folded.matchAll(FOLDED_NEUTRALISED)) {
    const slash = ends[match.index + 1]! - 1; // the backslash, a character of its own
    out += text.slice(from, slash);
    from = slash + 1;
  }
  return out + text.slice(from);
}

// The tag id: the first four lowercase hex digits of SHA-256 of the session id; four random hex digits when there is no
// session yet (an unstarted session's first send).
export function pastedTagId(sessionId: string | null, random: () => number = Math.random): string {
  if (sessionId !== null) return sha256Hex(sessionId).slice(0, 4);
  return Math.floor(random() * 0x10000).toString(16).padStart(4, '0');
}

// One pasted block as it goes on the wire, the blank line before it and the newline after it included; the body is
// neutralised and gains a trailing newline only when it lacks one.
export function wrapPasted(id: string, body: string): string {
  const neutral = neutralisePastedTags(body);
  return `\n\n${framePasted(id, neutral.endsWith('\n') ? neutral.slice(0, -1) : neutral)}\n`;
}

// The placeholder's line count, C6's rule (`body.split('\n').length`), so a recalled or derived placeholder agrees.
export function countLines(body: string): number {
  return body.split('\n').length;
}

// The placeholders of a history entry's `display`, in order, with their offsets: `[Pasted text #n +L lines]` (rebuilt
// from `pastedContents[n]` when its body resolved) and `[Image #n]`, `[PDF #n]` (history keeps no bytes).
export type Placeholder = { kind: 'pasted'; n: number; lines: number; start: number; end: number } | { kind: 'image' | 'pdf'; n: number; start: number; end: number };

const PLACEHOLDERS = /\[Pasted text #(\d+) \+(\d+) lines\]|\[Image #(\d+)\]|\[PDF #(\d+)\]/g;

export function parsePlaceholders(text: string): Placeholder[] {
  return [...text.matchAll(PLACEHOLDERS)].map((m) => {
    const start = m.index;
    const end = start + m[0].length;
    if (m[1] !== undefined) return { kind: 'pasted', n: Number(m[1]), lines: Number(m[2]), start, end };
    return { kind: m[3] !== undefined ? 'image' : 'pdf', n: Number(m[3] ?? m[4]), start, end };
  });
}
