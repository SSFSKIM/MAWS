// User-message text handling: the one place the reducer turns a `user.message`'s content into the user row's text
// and attachments, before anything markdown-shaped sees the text (C6 execution document, *Pasted content* under
// Derivation, C7's contract verbatim: extraction before sanitisation, because the remark stage deletes raw tags).
import { PASTED_BLOCK, PASTED_PLACEHOLDER, pastedPlaceholder } from '@shared/composer/pasted-content';
import type { ContentBlock } from '@shared/graph/events';
import type { Attachment } from './rows';

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

export interface UserText {
  text: string;
  attachments: Attachment[];
  lines: number;
}

// The n-th match becomes a `text` attachment; its place in the text is `[Pasted text #n +L lines]`, keeping one
// newline on each side when the match consumed any.
export function splitPastedSegments(text: string): { text: string; attachments: Attachment[] } {
  const attachments: Attachment[] = [];
  const replaced = text.replace(PASTED_BLOCK, (match, _id: string, body: string) => {
    attachments.push({ kind: 'text', name: `Pasted text #${attachments.length + 1}`, bytes: utf8Length(body), dataUrl: null, mediaType: 'text/plain', text: body });
    const placeholder = pastedPlaceholder(attachments.length, body.split('\n').length);
    return `${match.startsWith('\n') ? '\n' : ''}${placeholder}${match.endsWith('\n') ? '\n' : ''}`;
  });
  return { text: replaced, attachments };
}

// Copy and export: each placeholder replaced by its body, untagged (the engine's own behaviour).
export function untaggedUserText(text: string, attachments: Attachment[]): string {
  const bodies = attachments.filter((attachment) => attachment.kind === 'text');
  return text.replace(PASTED_PLACEHOLDER, (placeholder, n: string) => bodies[Number(n) - 1]?.text ?? placeholder);
}

const base64Bytes = (data: string) => Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);

// Content blocks that are not text become attachments: base64 images render inline from a data URL (nothing is
// loaded by path, §4.1), documents and unknown media become file chips.
function attachmentOf(block: ContentBlock, index: number): Attachment | null {
  const source = block.source as { type?: string; media_type?: string; data?: string } | undefined;
  if (block.type === 'image') {
    const data = source?.type === 'base64' && typeof source.data === 'string' ? source.data : null;
    const mediaType = source?.media_type ?? 'image/*';
    return { kind: 'image', name: `Image ${index + 1}`, bytes: data === null ? null : base64Bytes(data), dataUrl: data === null ? null : `data:${mediaType};base64,${data}`, mediaType, text: null };
  }
  if (block.type === 'document') {
    const data = typeof source?.data === 'string' ? source.data : null;
    return { kind: 'file', name: typeof block.title === 'string' ? block.title : `Document ${index + 1}`, bytes: data === null ? null : base64Bytes(data), dataUrl: null, mediaType: source?.media_type ?? null, text: null };
  }
  return null;
}

export function userTextOf(content: string | ContentBlock[]): UserText {
  const texts: string[] = [];
  const attachments: Attachment[] = [];
  if (typeof content === 'string') texts.push(content);
  else {
    content.forEach((block, index) => {
      if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
      else {
        const attachment = attachmentOf(block, index);
        if (attachment) attachments.push(attachment);
      }
    });
  }
  const split = splitPastedSegments(texts.join('\n\n'));
  const text = split.text;
  return { text, attachments: [...split.attachments, ...attachments], lines: text.length === 0 ? 0 : text.split('\n').length };
}

// The engine's local-command echo (`/model`, `/status` and the like arrive as replayed user frames wrapped in these
// tags; C3 tags the event `origin: 'local-command'`): a `local_command` row, never a bubble and never a turn. The
// wrapper is recognised too, so an untagged replay (disk backfill) reads the same way.
const LOCAL_COMMAND = /^\s*<local-command-(stdout|caveat)>([\s\S]*?)<\/local-command-\1>\s*$/;

export function localCommandOutput(content: string | ContentBlock[]): string | null {
  if (typeof content !== 'string') return null;
  const match = LOCAL_COMMAND.exec(content);
  return match ? match[2].trim() : null;
}

export const isLocalCommand = (origin: string | null, content: string | ContentBlock[]) => origin === 'local-command' || localCommandOutput(content) !== null;

// The engine's own marker for an interrupted request (C3 tags it `origin: 'interrupt-marker'`): no row and no turn; the
// divider's stopped state already says it.
export const INTERRUPT_MARKER = '[Request interrupted by user]';

export function isInterruptionMarker(origin: string | null, content: string | ContentBlock[]): boolean {
  if (origin === 'interrupt-marker') return true;
  const text = typeof content === 'string' ? content : content.length === 1 && content[0].type === 'text' ? String(content[0].text ?? '') : '';
  return text.trim() === INTERRUPT_MARKER; // the complete marker only: a prompt that begins with it and continues is a bubble
}
