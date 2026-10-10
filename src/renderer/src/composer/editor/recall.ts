// Text back into a document (C7 execution document, "History" and the Prefill of the composer's public surface): a
// history entry's `display` or a prefill's text, with its placeholders rebuilt as atoms and its `@` tokens as mention
// chips (the terminal reruns its providers on recall). A `[Pasted text #n +L lines]` placeholder becomes a pasted atom
// when its body is known and an unavailable atom otherwise; `[Image #n]` and `[PDF #n]` are always unavailable (history
// keeps no bytes; a prefill re-attaches its images beside the text). Each line is a paragraph. Pure.
import type { HistoryEntry } from '@shared/composer/history-entry';
import { pastedPlaceholder } from '@shared/composer/pasted-content';
import { parsePlaceholders, restorePastedTags, type Placeholder } from '@shared/composer/pasted-framing';
import type { JSONContent } from '@tiptap/core';
import type { Prefill } from '../../stores/composer';
import { atomId, docOf, mentionNode, paragraph, pastedNode, textNode, type Attachment, type ComposerDoc, type PastedAttrs } from './doc';
import { base64Bytes } from './attachments';

// `@"a b"`, `@agent-Name` or `@path`, at the start of a line or after whitespace (the terminal's trigger rule); a bare
// token leaves trailing punctuation to the sentence.
const MENTION_TOKEN = /(^|\s)@(?:"([^"\n]+)"|([^\s"]+?)(?=[,.;:!?)\]]*(?:\s|$)))/g;

export const mentionLabel = (path: string): string => path.split('/').filter(Boolean).slice(-2).join('/') || path;

function inlineNodes(text: string): JSONContent[] {
  const nodes: JSONContent[] = [];
  let at = 0;
  for (const match of text.matchAll(MENTION_TOKEN)) {
    const start = match.index + match[1].length;
    if (start > at) nodes.push(textNode(text.slice(at, start)));
    const quoted = match[2];
    const bare = match[3];
    if (quoted !== undefined) nodes.push(mentionNode({ id: quoted, label: mentionLabel(quoted), kind: 'file' }));
    else if (bare.startsWith('agent-') && bare.length > 'agent-'.length) nodes.push(mentionNode({ id: bare.slice('agent-'.length), label: bare.slice('agent-'.length), kind: 'agent' }));
    else nodes.push(mentionNode({ id: bare, label: mentionLabel(bare), kind: 'file' }));
    at = start + match[0].length - match[1].length;
  }
  if (at < text.length) nodes.push(textNode(text.slice(at)));
  return nodes;
}

function lineNodes(line: string, atomFor: (placeholder: Placeholder) => PastedAttrs): JSONContent[] {
  const nodes: JSONContent[] = [];
  let at = 0;
  for (const placeholder of parsePlaceholders(line)) {
    nodes.push(...inlineNodes(line.slice(at, placeholder.start)));
    nodes.push(pastedNode(atomFor(placeholder)));
    at = placeholder.end;
  }
  nodes.push(...inlineNodes(line.slice(at)));
  return nodes;
}

export function textToDoc(text: string, atomFor: (placeholder: Placeholder) => PastedAttrs, attachments: Attachment[] = []): ComposerDoc {
  return docOf(text.split('\n').map((line) => paragraph(...lineNodes(line, atomFor))), attachments);
}

const unavailable = (placeholder: Placeholder): PastedAttrs =>
  placeholder.kind === 'pasted'
    ? { id: atomId('pasted'), kind: 'text', name: `Pasted text #${placeholder.n}`, lines: placeholder.lines, text: null }
    : { id: atomId('pasted'), kind: placeholder.kind, name: `${placeholder.kind === 'image' ? 'Image' : 'PDF'} #${placeholder.n}`, lines: 0, text: null };

const available = (placeholder: Placeholder & { kind: 'pasted' }, body: string): PastedAttrs => ({
  id: atomId('pasted'),
  kind: 'text',
  name: `Pasted text #${placeholder.n}`,
  lines: body.split('\n').length,
  text: body,
});

export function historyEntryToDoc(entry: HistoryEntry): ComposerDoc {
  return textToDoc(entry.display, (placeholder) => {
    const body = placeholder.kind === 'pasted' ? entry.pastedContents[String(placeholder.n)] : undefined;
    return placeholder.kind === 'pasted' && body?.type === 'text' && typeof body.content === 'string' ? available(placeholder, body.content) : unavailable(placeholder);
  });
}

// The bodies a prefill's pasted placeholders name, keyed by the placeholder (`prefillToDoc`'s reading: the k-th takes
// `pasted[k-1]`; a placeholder written twice keeps its first). A bubble edited in place keeps these from when the edit
// began: its text is the human's to change, so a placeholder there resolves by what it says, not where it stands.
export function bodiesByPlaceholder(prefill: Prefill): Record<string, string> {
  const bodies: Record<string, string> = {};
  let k = 0;
  for (const placeholder of parsePlaceholders(prefill.text)) {
    if (placeholder.kind !== 'pasted') continue;
    const body = prefill.pasted?.[k];
    k++;
    const key = pastedPlaceholder(placeholder.n, placeholder.lines);
    if (body && !(key in bodies)) bodies[key] = body.text;
  }
  return bodies;
}

// A prefill's text: the k-th pasted placeholder takes `pasted[k-1]`, or with `bodies` the body keyed by the placeholder
// itself; a placeholder with no entry is unavailable.
export function prefillToDoc(prefill: Prefill): ComposerDoc {
  let k = 0;
  const { bodies } = prefill;
  const images: Attachment[] = (prefill.images ?? []).map((image) => ({
    id: atomId('attachment'),
    kind: 'image',
    name: image.name,
    mediaType: image.mediaType,
    bytes: base64Bytes(image.data),
    data: image.data,
    persisted: true,
  }));
  return textToDoc(
    prefill.text,
    (placeholder) => {
      if (placeholder.kind !== 'pasted') return unavailable(placeholder);
      const body = bodies ? bodies[pastedPlaceholder(placeholder.n, placeholder.lines)] : prefill.pasted?.[k]?.text;
      if (!bodies) k++;
      return body !== undefined ? available(placeholder, body) : unavailable(placeholder);
    },
    images,
  );
}

// A user row's text as the human typed it: the neutralised `<\pasted_content` restored, and the one newline C6 keeps
// before each pasted placeholder removed (the composer's framing opens every block after a blank line, which C6's
// extraction reduces to that newline; the newline after it is the paragraph join and stays).
export function typedFromRowText(text: string): string {
  return restorePastedTags(text).replace(/\n(?=\[Pasted text #\d+ \+\d+ lines\])/g, '');
}
