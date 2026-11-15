// A person's message read apart where it becomes an event (the UX wave, board ticket 704;
// docs/doperpowers/plans/2026-11-15-envelope-split.md, Interfaces C). When MAWS's answer envelope and a message the
// person typed both wait for the engine's next step, the engine writes them to the model as one user message, the
// members in writing order, one newline between (or, beside a prompt with an image, the envelope's text block, ending
// with the newline, before the prompt's own blocks). Every place that makes or reads a person's `user.message` reads it
// here, so the person's message holds their own words and nothing else on every route, and each envelope is a message of
// its own, of the shape an envelope sent alone has. The split is by the text (decision 6), behind one gate (decision 5),
// which tells a person's message from what is not one and does not tell who typed it. Pure: it imports the reader and the
// event types, nothing of the renderer or the engine host.
import { PASTED_BLOCK } from '../composer/pasted-content';
import type { ContentBlock, EventPayload } from '../graph/events';
import { askSteerOpening, parseAskSteer } from '../maws/ask';
import { envelopeSlices } from './arrival';

export type UserMessage = Extract<EventPayload, { kind: 'user.message' }>;
type Content = string | ContentBlock[];

// One text read until a reading takes nothing out (decision 17): where an envelope's lines stand around another whole
// envelope, the first reading takes the inner one and leaves the outer one whole in the rest. The envelopes in the order
// they were taken, reading by reading. Each reading that takes something shortens the text by at least an envelope.
function readOut(text: string): { own: string; envelopes: string[] } {
  const envelopes: string[] = [];
  let own = text;
  for (;;) {
    const { members, rest } = envelopeSlices(own, askSteerOpening, PASTED_BLOCK, parseAskSteer);
    if (members.length === 0) return { own, envelopes };
    envelopes.push(...members.map((member) => member.text));
    own = rest;
  }
}

// What an envelope leaves of a text: nothing when only white space stands beside it (decision 7: the separating newline
// the engine appends to an envelope's text block, or puts between members)
const leftOf = (read: { own: string; envelopes: string[] }): string | null => (read.own === '' || (read.envelopes.length > 0 && read.own.trim() === '') ? null : read.own);

/** A person's content read apart: their own part, null when nothing of theirs is left, and the envelopes' texts in order. */
export function personsParts(content: Content): { own: Content | null; envelopes: string[] } {
  if (typeof content === 'string') {
    const read = readOut(content);
    return { own: leftOf(read), envelopes: read.envelopes };
  }
  // Each text block by itself; a block left empty goes, every other block stays, in place and unchanged (decision 7). An
  // envelope that spans two blocks is not read: the writer makes one text.
  const envelopes: string[] = [];
  const kept: ContentBlock[] = [];
  for (const block of content) {
    const read = block.type === 'text' && typeof block.text === 'string' ? readOut(block.text) : null;
    if (read === null || read.envelopes.length === 0) {
      kept.push(block);
      continue;
    }
    envelopes.push(...read.envelopes);
    const own = leftOf(read);
    if (own !== null) kept.push({ ...block, text: own });
  }
  return { own: kept.length === 0 ? null : kept, envelopes };
}

// The one gate (decision 5): a message that is not synthetic, has no shell part, has a uuid, and whose origin is the
// person's or none. A peer's, a coordinator's, a task's, a command's or a marker's message is never read.
const isPersons = (message: UserMessage): boolean => !message.isSynthetic && message.bash === null && message.messageUuid !== null && (message.origin === 'human' || message.origin === null);

// The message is one envelope and nothing else, as it was written: a text, or a single text block, that is the envelope
const isLoneEnvelope = (content: Content, envelope: string): boolean =>
  typeof content === 'string' ? content === envelope : content.length === 1 && content[0]!.type === 'text' && content[0]!.text === envelope;

/**
 * The one split: the messages to emit in a message's place. The message itself, the same object, when it splits nothing
 * (it fails the gate, holds no envelope, or is one envelope alone). Else the person's message holding their part, when
 * one is left, then one message per envelope under the same uuid, of the shape a lone envelope's has; `joined` and
 * `arrival` on the first and on no other. Every message it returns, split again, is returned as it is.
 */
export function splitPersonsMessage(message: UserMessage): UserMessage[] {
  if (!isPersons(message)) return [message];
  const { own, envelopes } = personsParts(message.content);
  if (envelopes.length === 0 || (own === null && envelopes.length === 1 && isLoneEnvelope(message.content, envelopes[0]!))) return [message];
  const { joined, arrival } = message;
  const answers = envelopes.map((text): UserMessage => ({ kind: 'user.message', messageUuid: message.messageUuid, content: text, isReplay: message.isReplay, isSynthetic: false, origin: message.origin, bash: null }));
  if (own !== null) return [{ ...message, content: own }, ...answers];
  const [first, ...rest] = answers;
  return [{ ...first!, ...(joined !== undefined && { joined }), ...(arrival !== undefined && { arrival }) }, ...rest];
}

/** The person's words in the engine's own copy of a message's whole text (a rewind's prefill); null when none are left. */
export function personsWords(text: string): string | null {
  const read = readOut(text);
  return leftOf(read);
}

/**
 * The same for the engine's one-line form (`last-prompt`): what stands before an envelope's opening sentence, trimmed.
 * The form is one line (each newline a space) cut near 200 characters and closed with `…`, so an envelope in it never
 * ends and nothing after its opening survives (decision 9). The opening is the writer's sentence for the id the tag
 * names, at the line's start or after a space; where the engine's cut falls inside that sentence (u704-rewind-1 L54), the
 * head of it that closes the line counts as the opening.
 */
export function flatPersonsWords(line: string): string | null {
  const tag = /(?:^| )(\[MAWS ask ([^\]\s]*)(\] )?)/g;
  for (const match of line.matchAll(tag)) {
    const at = match.index + match[0].length - match[1]!.length;
    if (!opensHere(line.slice(at), match[2]!, match[3] !== undefined)) continue;
    const words = line.slice(0, at).trim();
    return words === '' ? null : words;
  }
  return line;
}

// The writer's whole opening sentence for the id, or (the line cut and closed with `…` inside it) the head of it
function opensHere(from: string, id: string, closed: boolean): boolean {
  if (closed && from.startsWith(askSteerOpening(id))) return true;
  if (!from.endsWith('…')) return false;
  const head = from.slice(0, -1);
  return closed ? askSteerOpening(id).startsWith(head) : /^\[MAWS ask [^\]\s]*$/.test(head);
}

/** What an answer reads as outside the transcript: the search text and the resume preview (ruling A, its one place). It
 *  uses its argument alone: the search text's worker runs its source. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- ruling A: an answer reads as nothing; the argument is the one place's (Interfaces C)
export function answerOutsideTranscript(envelope: string): string {
  return '';
}
