// Serialisation (C7 execution document, "Document model and serialisation", the rules in order): the pure function
// from the composer's document to what `session.send` carries and to the one-line `display` history keeps. Typed text
// is neutralised and each pasted atom framed in the terminal's tags (`pasted-framing.ts`); an unavailable atom sends
// nothing and is counted; attachments become content blocks, images first. `display` is the text as typed with each
// atom's placeholder in place and the attachments' placeholders after it, under the one placeholder counter the
// terminal's `pastedContents` keys use.
import type { JSONContent } from '@tiptap/core';
import type { PastedContent } from '@shared/composer/history-entry';
import { countLines, neutralisePastedTags, pastedTagId, wrapPasted } from '@shared/composer/pasted-framing';
import type { ContentBlock } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import { attachmentsOf, MENTION, PASTED, type MentionAttrs, type PastedAttrs } from './doc';
import { atomPlaceholder, mentionText } from './schema';

export interface SerializeContext {
  sessionId: SessionId | string | null;
  cwd: string;
}

export interface Serialized {
  mode: 'send' | 'bash' | 'memory';
  text: string; // the wire text; for bash the command, for memory the note
  content: string | ContentBlock[];
  display: string;
  pastedContents: Record<string, PastedContent>;
  omitted: number; // unavailable atoms left out of `content`
  empty: boolean;
}

// One piece of the flattened document: typed text (wire form and typed form) or an atom.
type Piece = { kind: 'text'; wire: string; typed: string } | { kind: 'mention'; text: string } | { kind: 'pasted'; attrs: PastedAttrs };

function piecesOf(doc: JSONContent): { pieces: Piece[]; paragraphs: number } {
  const pieces: Piece[] = [];
  const paragraphs = doc.content ?? [];
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) pieces.push({ kind: 'text', wire: '\n', typed: '\n' });
    for (const node of paragraph.content ?? []) {
      if (node.type === 'text') pieces.push({ kind: 'text', wire: neutralisePastedTags(node.text ?? ''), typed: node.text ?? '' });
      else if (node.type === 'hardBreak') pieces.push({ kind: 'text', wire: '\n', typed: '\n' });
      else if (node.type === MENTION) pieces.push({ kind: 'mention', text: mentionText(node.attrs as MentionAttrs) });
      else if (node.type === PASTED) pieces.push({ kind: 'pasted', attrs: node.attrs as PastedAttrs });
    }
  });
  return { pieces, paragraphs: paragraphs.length };
}

// Trailing whitespace of the whole, trimmed from the typed text at the end (never from a framed block).
function trimTrailing(pieces: Piece[]): Piece[] {
  const out = [...pieces];
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last.kind !== 'text') break;
    const wire = last.wire.trimEnd();
    const typed = last.typed.trimEnd();
    if (typed === '') {
      out.pop();
      continue;
    }
    out[out.length - 1] = { kind: 'text', wire, typed };
    break;
  }
  return out;
}

const typedText = (pieces: Piece[]) => pieces.map((p) => (p.kind === 'text' ? p.typed : p.kind === 'mention' ? p.text : '')).join('');

export function serializeDraft(doc: JSONContent, ctx: SerializeContext): Serialized {
  const { pieces: raw, paragraphs } = piecesOf(doc);
  const pieces = trimTrailing(raw);
  const attachments = attachmentsOf(doc);
  const hasAtoms = pieces.some((p) => p.kind !== 'text');
  const hasPasted = pieces.some((p) => p.kind === 'pasted');
  const typed = typedText(pieces);

  // `!` and `#` at offset 0: a shell command is one paragraph of plain text; a memory note may name files.
  const lead = typed.charAt(0);
  if (attachments.length === 0 && ((lead === '!' && paragraphs === 1 && !hasAtoms) || (lead === '#' && !hasPasted))) {
    const text = typed.slice(1).trim();
    return { mode: lead === '!' ? 'bash' : 'memory', text, content: text, display: typed, pastedContents: {}, omitted: 0, empty: text === '' };
  }

  const tagId = hasPasted ? pastedTagId(ctx.sessionId) : '';
  const pastedContents: Record<string, PastedContent> = {};
  let n = 0;
  let omitted = 0;
  let wire = '';
  let display = '';
  for (const piece of pieces) {
    if (piece.kind === 'text') {
      wire += piece.wire;
      display += piece.typed;
    } else if (piece.kind === 'mention') {
      wire += piece.text;
      display += piece.text;
    } else {
      const { attrs } = piece;
      n += 1;
      if (attrs.kind === 'text' && attrs.text !== null) {
        wire += wrapPasted(tagId, attrs.text);
        display += atomPlaceholder({ kind: 'text', lines: countLines(attrs.text) }, n);
        pastedContents[String(n)] = { id: n, type: 'text', content: attrs.text, contentHash: null, mediaType: null, filename: null };
      } else {
        omitted += 1;
        display += atomPlaceholder(attrs, n);
      }
    }
  }

  const blocks: ContentBlock[] = [];
  const placeholders: string[] = [];
  for (const attachment of [...attachments.filter((a) => a.kind === 'image'), ...attachments.filter((a) => a.kind === 'document')]) {
    n += 1;
    blocks.push({ type: attachment.kind, source: { type: 'base64', media_type: attachment.mediaType, data: attachment.data } });
    if (attachment.kind === 'image') {
      placeholders.push(`[Image #${n}]`);
      pastedContents[String(n)] = { id: n, type: 'image', content: null, contentHash: null, mediaType: attachment.mediaType, filename: attachment.name };
    } else placeholders.push(`[PDF #${n}]`);
  }
  if (placeholders.length > 0) display = [display, ...placeholders].filter((part) => part !== '').join(' ');

  const content: string | ContentBlock[] = blocks.length === 0 ? wire : wire.trim() === '' ? blocks : [...blocks, { type: 'text', text: wire }];
  return { mode: 'send', text: wire, content, display, pastedContents, omitted, empty: wire.trim() === '' && blocks.length === 0 };
}
