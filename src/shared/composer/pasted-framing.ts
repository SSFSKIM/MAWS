// The send side of pasted content (C7 execution document, Interfaces "Document model and serialisation", beside C6's
// grammar module `pasted-content.ts`, which C7 reads and never edits). The terminal's own framing (`cli.pretty.js` Xnt,
// SPEC 42 §42.15): a pasted block opens after a blank line, both tags carry the same four-hex id, and the block ends
// with a newline; typed text and pasted bodies are neutralised first by rewriting only the `<` of a `pasted_content`
// tag, so nothing the human typed can open or close a block. The engine's parser (`vmt`), which C6's `PASTED_BLOCK`
// reproduces, reads exactly this framing. Also the placeholder's line count and the recall parser for history.
import { framePasted } from './pasted-content';
import { sha256Hex } from './sha256';

// `<pasted_content` → `<\pasted_content`, `</pasted_content` → `<\/pasted_content`; an already neutralised tag is left
// alone (the lookahead requires the tag name right after the `<`). The engine additionally matches Unicode look-alike
// spellings, which MAWS does not reproduce.
export function neutralisePastedTags(text: string): string {
  return text.replace(/<(?!\\)(?=\/?pasted_content)/gi, '<\\');
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
