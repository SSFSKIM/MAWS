// User-message text handling: the one place the reducer turns a `user.message`'s content into the user row's text
// and attachments. The pasted-content rule (C7's ask; C6 execution document, Decision Log) is on hold while C7's
// review rewrites its contract, so `splitPastedSegments` is the seam: today it returns the text unchanged and no
// text attachments, and the exact grammar drops in here without touching the reducer.
import type { ContentBlock } from '@shared/graph/events';
import type { Attachment } from './rows';

export interface UserText {
  text: string;
  attachments: Attachment[];
  lines: number;
}

export function splitPastedSegments(text: string): { text: string; attachments: Attachment[] } {
  return { text, attachments: [] };
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
// tags); never a bubble and never a turn.
const LOCAL_COMMAND = /^\s*<local-command-(stdout|caveat)>([\s\S]*?)<\/local-command-\1>\s*$/;

export function localCommandOutput(content: string | ContentBlock[]): string | null {
  if (typeof content !== 'string') return null;
  const match = LOCAL_COMMAND.exec(content);
  return match ? match[2].trim() : null;
}

// The engine's own marker for an interrupted request; the divider says "You stopped", the marker is not a bubble.
export function isInterruptionMarker(content: string | ContentBlock[]): boolean {
  const text = typeof content === 'string' ? content : content.length === 1 && content[0].type === 'text' ? String(content[0].text ?? '') : '';
  return /^\[Request interrupted by user/.test(text.trim());
}
