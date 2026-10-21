// P4-A3 (docs/doperpowers/plans/2026-10-21-p4-a3-edit-protocol.md, lever 2; the architect's ruling of 2026-10-21): a
// message the human sends that links an artifact (`maws-artifact:<id>`, any fragment X33's grammar allows) carries that
// artifact's read, so the agent edits from it without a read request first, as Claude Code attaches an @-mentioned
// file. The engine host attaches it when it writes the message (`engine-host/linked-reads.ts`); this module is the one
// place its text is made and recognised, so the transcript draws it as an attachment and no reader of the human's
// words takes it for them. The read is the `artifact_read` tool's own answer, whole, revision included: an edit from a
// read gone stale is refused by that revision as any read's is. Pure.
import { parseArtifactLink } from '../artifacts/link';

// The attached reads' total, in UTF-8 bytes of the blocks as sent. A token is at least one byte, so the reads cost the
// session's context at most this many tokens however token-dense the artifact (hex, Hangul, minified html), and about a
// quarter of it for English prose. 24,000 holds the bench's document (about 8,000 bytes) and deck (about 4,000) and a
// working document of some 3,500 words, and stays under the 25,000 tokens the engine allows one tool result, the most a
// read the agent made itself could cost. A read above what is left is not attached and the agent reads it as it would have.
export const LINKED_READ_CAP_BYTES = 24_000;

export const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

export interface LinkedArtifact {
  artifactId: string;
  tab?: string; // the first link's tab, when it names one: the read is of that tab
}

type Block = { type: string; text?: unknown };
const textsOf = (content: string | readonly Block[]): string[] =>
  typeof content === 'string' ? [content] : content.flatMap((b) => (b.type === 'text' && typeof b.text === 'string' && linkedReadOf(b.text) === null ? [b.text] : []));

// A link's href as it can appear in the text: up to whitespace or the characters that close a Markdown link or a tag.
const HREF = /maws-artifact:[^\s)\]>"'`]+/gi;

// The artifacts the human's words link, in link order, each once; a read already attached is not the human's words.
export function linkedArtifacts(content: string | readonly Block[]): LinkedArtifact[] {
  const out: LinkedArtifact[] = [];
  for (const text of textsOf(content)) {
    for (const [href] of text.matchAll(HREF)) {
      const target = parseArtifactLink(href);
      if (!target || out.some((a) => a.artifactId === target.artifactId)) continue;
      out.push({ artifactId: target.artifactId, ...(target.at?.tab !== undefined && { tab: target.at.tab }) });
    }
  }
  return out;
}

const OPEN = '<system-reminder>\n';
const CLOSE = '\n</system-reminder>';
const LEAD = "The user's message links the MAWS artifact ";
const READ_LINE = '. Its content as mcp__maws__artifact_read returns it, read when the message was sent:\n';
const linkText = (title: string) => title.replace(/[[\]\\]/g, (c) => `\\${c}`);

interface ReadHead {
  status: 'read';
  artifactId: string;
  kind: string;
  title: string;
  revision: number;
}
const headOf = (json: string): ReadHead | null => {
  try {
    const value = JSON.parse(json) as Partial<ReadHead>;
    return value.status === 'read' && typeof value.artifactId === 'string' && typeof value.kind === 'string' && typeof value.title === 'string' && typeof value.revision === 'number' ? (value as ReadHead) : null;
  } catch {
    return null;
  }
};

// The text the message carries for one read: `read` is the tool's result text, a `read` answer.
export function linkedReadBlock(read: string): string {
  const head = headOf(read);
  if (!head) throw new Error('a linked read is an artifact_read answer of status read');
  return `${OPEN}${LEAD}[${linkText(head.title)}](maws-artifact:${head.artifactId})${READ_LINE}${read}${CLOSE}`;
}

export interface LinkedReadSummary {
  artifactId: string;
  title: string;
  kind: string;
  revision: number;
}

// What an attached read names, or null for any other text (a near miss, words typed in its shape around it).
export function linkedReadOf(text: string): LinkedReadSummary | null {
  if (!text.startsWith(OPEN + LEAD) || !text.endsWith(CLOSE)) return null;
  const at = text.indexOf(READ_LINE);
  if (at < 0) return null;
  const head = headOf(text.slice(at + READ_LINE.length, text.length - CLOSE.length));
  if (!head || !text.startsWith(`${OPEN}${LEAD}[${linkText(head.title)}](maws-artifact:${head.artifactId})${READ_LINE}`)) return null;
  return { artifactId: head.artifactId, title: head.title, kind: head.kind, revision: head.revision };
}

// The message as the human wrote it: the attached reads taken out (a string message never carries one).
export function withoutLinkedReads<B extends Block>(content: readonly B[]): B[];
export function withoutLinkedReads<B extends Block>(content: string | readonly B[]): string | B[];
export function withoutLinkedReads<B extends Block>(content: string | readonly B[]): string | B[] {
  return typeof content === 'string' ? content : content.filter((b) => !(b.type === 'text' && typeof b.text === 'string' && linkedReadOf(b.text) !== null));
}
