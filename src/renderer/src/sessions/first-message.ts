// A first message between C7's composer and C10's setup (C10 execution document, "The unstarted session"; M4b). The
// message C10 retains is C7's `start` argument (`{ content, display }`, the serialiser's output), so both directions
// read C7's rules: `display` is the text as typed with each pasted atom's placeholder in place and the attachments'
// placeholders after it; `content` frames each pasted body in the terminal's tags and carries the attachments as
// blocks, images first. Pure.
import { PASTED_BLOCK, pastedPlaceholder } from '@shared/composer/pasted-content';
import { countLines, parsePlaceholders, restorePastedTags } from '@shared/composer/pasted-framing';
import type { ContentBlock } from '@shared/graph/events';
import type { FirstMessage } from '@shared/sessions/intent';
import type { Prefill } from '../stores/composer';

type Base64Block = { type: 'image' | 'document'; source: { type: 'base64'; media_type: string; data: string } };

const wireOf = (content: FirstMessage['content']): string =>
  typeof content === 'string' ? content : content.flatMap((b) => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : [])).join('');

const base64Blocks = (content: FirstMessage['content']): Base64Block[] =>
  typeof content === 'string'
    ? []
    : content.filter((b): b is ContentBlock & Base64Block => (b.type === 'image' || b.type === 'document') && (b as Base64Block).source?.type === 'base64');

// The pasted bodies of a sent text, in order, as they were typed (the send neutralised a typed tag inside a body).
const pastedBodies = (wire: string): string[] => [...wire.matchAll(PASTED_BLOCK)].map((m) => restorePastedTags(m[2]!));

// What returns a retained first message to the editor (`prefillComposer`): its text as typed with the pasted bodies
// behind their placeholders, and its images re-attached (their `[Image #n]` placeholders dropped, since the attachment
// strip shows them). A PDF keeps its placeholder: a prefill carries no document, so it comes back as an unavailable
// atom, as history recall shows one.
export function messagePrefill(message: FirstMessage): Prefill {
  const blocks = base64Blocks(message.content).filter((b) => b.type === 'image');
  const images: NonNullable<Prefill['images']> = [];
  let text = message.display;
  const placeholders = parsePlaceholders(message.display).filter((p) => p.kind === 'image');
  // drop from the end so earlier offsets stay valid; each placeholder was joined to what precedes it with one space
  for (let i = Math.min(placeholders.length, blocks.length) - 1; i >= 0; i--) {
    const p = placeholders[i]!;
    const start = p.start > 0 && text[p.start - 1] === ' ' ? p.start - 1 : p.start;
    text = text.slice(0, start) + text.slice(p.end);
    images.unshift({ name: `Image #${p.n}`, mediaType: blocks[i]!.source.media_type, data: blocks[i]!.source.data });
  }
  const pasted = pastedBodies(wireOf(message.content)).map((body, i) => ({ name: `Pasted text #${i + 1}`, text: body }));
  return { text, pasted, images };
}

// A resubmit's content as the first message of the fork it starts (C7's `ResubmitProvider.forkFrom` passes content
// only): the display C7's serialiser keeps for the same document, the pasted blocks as their placeholders, numbered
// first, then the images and the documents.
export function firstMessageOf(content: FirstMessage['content']): FirstMessage {
  let n = 0;
  const typed = restorePastedTags(
    wireOf(content).replace(PASTED_BLOCK, (_block, _id: string, body: string) => {
      n += 1;
      return pastedPlaceholder(n, countLines(restorePastedTags(body)));
    }),
  );
  const attachments = base64Blocks(content);
  const placeholders = [...attachments.filter((b) => b.type === 'image'), ...attachments.filter((b) => b.type === 'document')].map((b) => {
    n += 1;
    return b.type === 'image' ? `[Image #${n}]` : `[PDF #${n}]`;
  });
  const display = [typed.trim() === '' ? '' : typed, ...placeholders].filter((part) => part !== '').join(' ');
  return { content, display };
}
