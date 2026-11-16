// A person's message read apart where it becomes an event (the UX wave, board ticket 704;
// docs/doperpowers/plans/2026-11-15-envelope-split.md, Interfaces C). When MAWS's answer envelope and a message the
// person typed both wait for the engine's next step, the engine writes them to the model as one user message, the
// members in writing order, one newline between (or, beside a prompt with an image, the envelope's text block, ending
// with the newline, before the prompt's own blocks). Every place that makes or reads a person's `user.message` reads it
// here, so the person's message holds their own words and nothing else on every route, and each envelope is a message of
// its own, of the shape an envelope sent alone has. The split is by the text (decision 6), behind one gate (decision 5),
// which tells a person's message from what is not one and does not tell who typed it. Pure: it imports the reader and the
// event types, nothing of the renderer or the engine host.
import type { ContentBlock, EventPayload } from '../graph/events';
import { askSteerOpening } from '../maws/ask';
import { readAnswerEnvelope, readPersonsContent, type Arrival } from './arrival';

export type UserMessage = Extract<EventPayload, { kind: 'user.message' }>;
type Content = string | ContentBlock[];

/** A person's content read apart: their own part, null when nothing of theirs is left, and the envelopes' texts in order.
 *  The reading is the reader's one (`readPersonsContent`, arrival.ts); no grant reader reads it (rule R reads the whole
 *  joined text, ticket 704's ruling 1 of 2026-11-16). */
export function personsParts(content: Content): { own: Content | null; envelopes: string[] } {
  const { own, envelopes } = readPersonsContent(content);
  return { own, envelopes: envelopes.map((envelope) => envelope.text) };
}

// The one gate (decision 5): a message that is not synthetic, has no shell part, has a uuid, and whose origin is the
// person's or none. A peer's, a coordinator's, a task's, a command's or a marker's message is never read.
const isPersons = (message: UserMessage): boolean => !message.isSynthetic && message.bash === null && message.messageUuid !== null && (message.origin === 'human' || message.origin === null);

/**
 * The answer a person's content is, read exactly as the split reads it: a text, or a single text block, that is one
 * envelope whole, from the writer's first line to its closing block (`readAnswerEnvelope`). The split returns such a
 * message as it is, and every envelope it splits out is one; nothing else is: a content with any other block, an
 * envelope spread over two blocks, a text beside an envelope, a text that only opens with the tag. The one test of
 * "this content is an answer envelope" for every reader of a person's message: an answer is recorded, a message hidden
 * or passed over as an answer only where it holds (the Decision Log's ruling of 2026-11-16).
 */
export function answerEnvelopeOf(content: Content): Extract<Arrival, { class: 'answer' }> | null {
  const only = typeof content === 'string' || content.length !== 1 ? null : content[0]!;
  const text = typeof content === 'string' ? content : only?.type === 'text' && typeof only.text === 'string' ? only.text : null;
  return text === null ? null : readAnswerEnvelope(text);
}

/**
 * The one split: the messages to emit in a message's place. The message itself, the same object, when it splits nothing
 * (it fails the gate, holds no envelope, or is one envelope alone). Else the person's message holding their part, when
 * one is left, then one message per envelope under the same uuid, of the shape a lone envelope's has; `joined` and
 * `arrival` on the first and on no other. Every message it returns, split again, is returned as it is.
 */
export function splitPersonsMessage(message: UserMessage): UserMessage[] {
  if (!isPersons(message) || answerEnvelopeOf(message.content) !== null) return [message];
  const { own, envelopes } = personsParts(message.content);
  if (envelopes.length === 0) return [message];
  const { joined, arrival } = message;
  const answers = envelopes.map((text): UserMessage => ({ kind: 'user.message', messageUuid: message.messageUuid, content: text, isReplay: message.isReplay, isSynthetic: false, origin: message.origin, bash: null }));
  if (own !== null) return [{ ...message, content: own }, ...answers];
  const [first, ...rest] = answers;
  return [{ ...first!, ...(joined !== undefined && { joined }), ...(arrival !== undefined && { arrival }) }, ...rest];
}

/** The person's words in the engine's own copy of a message's whole text (a rewind's prefill); null when none are left. */
export function personsWords(text: string): string | null {
  return readPersonsContent(text).own as string | null;
}

/**
 * The same for the engine's one-line form (`last-prompt`): what stands before an envelope's opening sentence, trimmed.
 * The form is one line (each newline a space) cut near 200 characters and closed with `…`, so an envelope in it never
 * ends and nothing after its opening survives (decision 9). The opening is the writer's sentence for the id the tag
 * names, at the line's start or after a space; where the engine's cut falls inside that sentence (u704-rewind-1 L54), the
 * head of it that closes the line counts as the opening.
 */
export function flatPersonsWords(line: string): string | null {
  for (const match of line.matchAll(/(?:^| )\[/g)) {
    const at = match.index + match[0].length - 1; // the tag's bracket
    if (!opensHere(line.slice(at))) continue;
    const words = line.slice(0, at).trim();
    return words === '' ? null : words;
  }
  return line;
}

// The writer's whole opening sentence for the id its tag names; or, the line closed with `…`, a head of that sentence
// running to the `…`: the tag cut anywhere (inside its prefix, inside the id, at the bracket, at the space after it) or
// the sentence cut anywhere after it
function opensHere(from: string): boolean {
  const id = /^\[MAWS ask ([^\]\s]+)\] /.exec(from)?.[1];
  if (id !== undefined && from.startsWith(askSteerOpening(id))) return true;
  if (!from.endsWith('…')) return false;
  const head = from.slice(0, -1);
  const prefix = '[MAWS ask ';
  if (head.length <= prefix.length) return prefix.startsWith(head);
  if (!head.startsWith(prefix)) return false;
  const cutId = /^[^\]\s]*/.exec(head.slice(prefix.length))![0];
  if (prefix.length + cutId.length === head.length) return true; // the cut falls inside the id
  return cutId !== '' && askSteerOpening(cutId).startsWith(head);
}

/** What an answer reads as outside the transcript: the search text and the resume preview (ruling A, its one place). It
 *  uses its argument alone: the search text's worker runs its source. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- ruling A: an answer reads as nothing; the argument is the one place's (Interfaces C)
export function answerOutsideTranscript(envelope: string): string {
  return '';
}
