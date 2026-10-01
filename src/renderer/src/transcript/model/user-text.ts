// User-message text handling: the one place the reducer turns a `user.message`'s content into the user row's text
// and attachments, before anything markdown-shaped sees the text (C6 execution document, *Pasted content* under
// Derivation, C7's contract verbatim: extraction before the markdown stage, which shows raw tags as written since W1).
// The engine's record of a slash command folds to the one line the human typed here too.
import { PASTED_BLOCK, PASTED_PLACEHOLDER, pastedPlaceholder } from '@shared/composer/pasted-content';
import type { ContentBlock } from '@shared/graph/events';
import type { Attachment } from './rows';

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

export interface UserText {
  text: string;
  attachments: Attachment[];
  placeholders: number[]; // where each pasted block's placeholder was put in `text`, the n-th block's at [n - 1]
  lines: number;
}

// The n-th match becomes a `text` attachment; its place in the text is `[Pasted text #n +L lines]`, keeping one
// newline on each side when the match consumed any. Where each placeholder went is recorded, so text the human typed
// in the same shape is never taken for one (copy, export and the bubble split only at the recorded places).
export function splitPastedSegments(text: string): { text: string; attachments: Attachment[]; placeholders: number[] } {
  const attachments: Attachment[] = [];
  const placeholders: number[] = [];
  let out = '';
  let from = 0;
  for (const match of text.matchAll(PASTED_BLOCK)) {
    const [whole, , body] = match;
    out += text.slice(from, match.index);
    if (whole.startsWith('\n')) out += '\n';
    attachments.push({ kind: 'text', name: `Pasted text #${attachments.length + 1}`, bytes: utf8Length(body), dataUrl: null, mediaType: 'text/plain', text: body });
    placeholders.push(out.length);
    out += pastedPlaceholder(attachments.length, body.split('\n').length);
    if (whole.endsWith('\n')) out += '\n';
    from = match.index + whole.length;
  }
  return { text: out + text.slice(from), attachments, placeholders };
}

// The recorded placeholders of a user row, in text order: each one's range and its pasted attachment.
export function placeholdersOf(text: string, attachments: Attachment[], placeholders: number[]): { from: number; to: number; n: number; lines: number; attachment: Attachment }[] {
  const pasted = attachments.filter((attachment) => attachment.kind === 'text');
  return placeholders.flatMap((at, i) => {
    const match = new RegExp(PASTED_PLACEHOLDER.source, 'y');
    match.lastIndex = at;
    const found = match.exec(text);
    const attachment = pasted[i];
    return found && attachment && Number(found[1]) === i + 1 ? [{ from: at, to: at + found[0].length, n: i + 1, lines: Number(/\+(\d+) lines/.exec(found[0])![1]), attachment }] : [];
  });
}

// Copy and export: each recorded placeholder replaced by its body, untagged (the engine's own behaviour); text typed
// in the placeholder's shape stays as typed.
export function untaggedUserText(text: string, attachments: Attachment[], placeholders: number[]): string {
  let out = '';
  let from = 0;
  for (const placeholder of placeholdersOf(text, attachments, placeholders)) {
    out += text.slice(from, placeholder.from) + (placeholder.attachment.text ?? '');
    from = placeholder.to;
  }
  return out + text.slice(from);
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

// The engine's record of a slash command (`<command-name>/compact</command-name>`, then `<command-message>` and
// `<command-args>` in either order; pass3/compact's replay at seq 46 and its disk record): the command and its
// arguments on one line, as typed. Null for anything else, including a record with text outside its tags.
const COMMAND_TAG = /<(command-name|command-message|command-args)>([\s\S]*?)<\/\1>/g;

export function slashCommandLine(text: string): string | null {
  if (!text.includes('<command-name>')) return null;
  const parts = new Map<string, string>();
  const rest = text.replace(COMMAND_TAG, (_whole, tag: string, body: string) => (parts.set(tag, body), ''));
  const name = parts.get('command-name')?.trim();
  if (!name || rest.trim() !== '') return null;
  const args = parts.get('command-args')?.trim() ?? '';
  return args ? `${name} ${args}` : name;
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
  const joined = texts.join('\n\n');
  const split = splitPastedSegments(slashCommandLine(joined) ?? joined);
  const text = split.text;
  return { text, attachments: [...split.attachments, ...attachments], placeholders: split.placeholders, lines: text.length === 0 ? 0 : text.split('\n').length };
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
export const INTERRUPT_MARKERS: readonly string[] = [INTERRUPT_MARKER, '[Request interrupted by user for tool use]']; // the engine's two (M6: the second, untagged, in `pass2/per-task-stop-off` seq 71)

export function isInterruptionMarker(origin: string | null, content: string | ContentBlock[]): boolean {
  if (origin === 'interrupt-marker') return true;
  const text = typeof content === 'string' ? content : content.length === 1 && content[0].type === 'text' ? String(content[0].text ?? '') : '';
  return INTERRUPT_MARKERS.includes(text.trim()); // a complete marker only: a prompt that begins with one and continues is a bubble
}
