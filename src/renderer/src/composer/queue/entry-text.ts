// A queued entry's content read back for the queue list (C7 execution document, "Submit control and queue"): C3's entry
// carries what went on the wire and no display, so the row's one line and the inline editor's document are derived
// from it. The terminal's pasted blocks become `[Pasted text #n +L lines]` placeholders (their bodies kept for the
// editor), the neutralised `<\pasted_content` is restored to what was typed, and images and PDFs are named `[Image #n]`
// and `[PDF #n]` before the text, as they ride before it. Pure.
import type { ContentBlock } from '@shared/graph/events';
import { PASTED_BLOCK, pastedPlaceholder } from '@shared/composer/pasted-content';
import { countLines } from '@shared/composer/pasted-framing';
import type { Prefill } from '../../stores/composer';
import { atomId, attachmentsOf, type Attachment, type ComposerDoc } from '../editor/doc';
import { base64Bytes } from '../editor/attachments';
import { prefillToDoc, typedFromRowText } from '../editor/recall';

type Base64Block = ContentBlock & { source?: { type?: string; media_type?: string; data?: string } };
const base64Of = (block: Base64Block) => (block.source?.type === 'base64' && typeof block.source.data === 'string' ? block.source.data : null);

// The text with each pasted block as its placeholder (one newline kept on a side that consumed any, as C6 derives a
// row), and the bodies in placeholder order.
function extractPasted(text: string): { text: string; bodies: string[] } {
  const bodies: string[] = [];
  const replaced = text.replace(new RegExp(PASTED_BLOCK.source, 'g'), (match: string, _id: string, body: string) => {
    bodies.push(body);
    const before = match.startsWith('\n') ? '\n' : '';
    const after = match.endsWith('\n') ? '\n' : '';
    return `${before}${pastedPlaceholder(bodies.length, countLines(body))}${after}`;
  });
  return { text: typedFromRowText(replaced), bodies };
}

function partsOf(content: string | readonly ContentBlock[]) {
  if (typeof content === 'string') return { text: content, images: [] as Base64Block[], documents: [] as Base64Block[] };
  const blocks = content as Base64Block[];
  return {
    text: blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n'),
    images: blocks.filter((b) => b.type === 'image' && base64Of(b) !== null),
    documents: blocks.filter((b) => b.type === 'document' && base64Of(b) !== null),
  };
}

// One line for the row: attachments named, pasted blocks as placeholders, line breaks as spaces.
export function entryDisplay(content: string | readonly ContentBlock[]): string {
  const { text, images, documents } = partsOf(content);
  const named = [...images.map((_, i) => `[Image #${i + 1}]`), ...documents.map((_, i) => `[PDF #${i + 1}]`)];
  return [...named, extractPasted(text).text]
    .join(' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

// The editor's document for an entry: the typed text with pasted atoms carrying their bodies, and the images and PDFs
// as attachments, so an edit re-serialises to the same framing.
export function entryDoc(content: string | readonly ContentBlock[]): ComposerDoc {
  const { text, images, documents } = partsOf(content);
  const pasted = extractPasted(text);
  const prefill: Prefill = {
    text: pasted.text,
    pasted: pasted.bodies.map((body, i) => ({ name: `Pasted text #${i + 1}`, text: body })),
    images: images.map((b, i) => ({ name: `Image #${i + 1}`, mediaType: b.source?.media_type ?? 'image/png', data: base64Of(b)! })),
    editing: null,
  };
  const doc = prefillToDoc(prefill);
  const pdfs: Attachment[] = documents.map((b, i) => {
    const data = base64Of(b)!;
    return { id: atomId('attachment'), kind: 'document', name: `PDF #${i + 1}`, mediaType: 'application/pdf', bytes: base64Bytes(data), data, persisted: true };
  });
  return pdfs.length === 0 ? doc : { ...doc, attrs: { ...doc.attrs, attachments: [...attachmentsOf(doc), ...pdfs] } };
}
