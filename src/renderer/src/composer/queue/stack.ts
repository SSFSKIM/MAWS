// The stack's model (UX wave U4a, docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md, Interfaces G; decisions 12
// and 15): the rows above the composer, read from the host's queue and from the transcript's `unread` mark, so that a
// waiting message is a row here exactly while the transcript does not draw it. Pure: the component and the keys read it.
//
// The queue's snapshot and the transcript's row arrive on different channels. A message the transcript holds unread and
// the queue does not list (one sent now from an after-the-turn row until the engine starts it, or a steer whose row came
// before the snapshot) is a `handed` row, "Next step" with no controls; a pending steer the transcript already shows
// started is no row.
//
// A waiting message that is MAWS's answer envelope reads as the answer (UX wave U4b, X-049;
// docs/doperpowers/plans/2026-11-15-ux-wave-U4b-composer-integrations.md, decisions 2 and 3): whether it is one, from
// the reader's class, read as the split reads a person's message (`answerEnvelopeOf`; ticket 704); each question's
// title as its ask's capsule shows it, from the ask's row where the window holds it; each answer in the capsule's words
// (`askAnswerCopy`). Since board ticket 711 the host writes the envelope's new form (each question by its place, a pick
// by `option <k>`); with the ask's questions in hand it is read back through the one reader, `askAnswersFromSteer`, so
// the row says what the earlier form of the same answers said. Without them (the window holds no row of the ask) the
// row has no title and shows the bare words, a pick by its place, as every reader without the call shows it.
// A waiting message that holds an attachment beside the envelope is no answer row (the architect's rule, ticket 704): it
// stays an ordinary message, which the up-arrow can take, with its ordinary controls. A `handed` row is no waiting
// message and keeps its reading.
import type { SendContent } from '@shared/engine/session-state-store';
import { readConsents } from '@shared/engine/arrival'; // U1c
import { messageText } from '@shared/engine/peer-envelope';
import { answerEnvelopeOf, personsParts } from '@shared/engine/persons-message';
import type { ContentBlock } from '@shared/graph/events';
import type { MessageUuid } from '@shared/graph/ids';
import { askAnswersFromSteer } from '@shared/maws/ask';
import type { AskQuestion } from '@shared/maws/tools';
import type { SessionQueue } from '../../stores/queue';
import type { BlockedCall } from '../../transcript/model/blocked'; // UX wave U1c
import { askAnswerCopy, askQuestionTitle, CONSENT } from '../../transcript/model/copy';
import { entryDisplay } from './entry-text';

// a transcript row marked `unread`; `text` is what the row draws (the message with MAWS's answer envelopes taken out).
// U1c (Decision Log 53): `grant`, the call the transcript's reader found the message to grant, read from the row's own
// consent mark, set only where that grant is everything the message holds (Decision Log 44, 49)
export interface Unread { messageUuid: MessageUuid; text: string; at: string; grant?: BlockedCall }
export interface Read {
  unread: readonly Unread[];
  started(messageUuid: MessageUuid): boolean;
  /** The questions of the ask `call` names, from its row in the transcript's model; null where the window holds no such row. */
  questions(call: string): readonly AskQuestion[] | null;
}

// UX wave U1c (the U1c document, Interfaces §G; card 2): every row carries `grant`, the call its message grants when that
// message is exactly one "Approve and retry" sentence, else null; such a row reads as the line it becomes. A row with
// content reads it from the content; a handed row takes the transcript's reading (Decision Log 53).
export type StackRow =
  // the two waiting kinds: `answer` is the row's words when the message is an answer, else null; U1c: `grant` is the call
  // a message that is one grant sentence and nothing else approves, else null
  | { kind: 'next'; key: string; messageUuid: MessageUuid; content: SendContent; createdAt: string; answer: string | null; grant: BlockedCall | null }
  | { kind: 'after' | 'held'; key: string; queueId: string; content: SendContent; createdAt: string; answer: string | null; grant: BlockedCall | null }
  | { kind: 'uncertain'; key: string; queueId: string; content: SendContent; createdAt: string; grant: BlockedCall | null }
  | { kind: 'sending'; key: string; text: string; createdAt: string; grant: BlockedCall | null } // a submission on its way: "Sending…"
  | { kind: 'handed'; key: string; text: string; createdAt: string; grant: BlockedCall | null }; // the engine holds it and MAWS's queue does not list it: "Next step", no controls

/** A row a key or a control can act on: one that waits at the next step or after the turn. */
export type WaitingRow = Extract<StackRow, { kind: 'next' | 'after' | 'held' }>;
/** A row a take-back can take: a waiting one, or the entry that may not have been delivered. */
export type TakenRow = WaitingRow | Extract<StackRow, { kind: 'uncertain' }>;

// Interfaces I: the stack's words
export const STACK_WORDS = {
  marks: { next: 'Next step', after: 'After the turn', held: 'Held', handed: 'Next step', sending: 'Sending…' },
  sendNowWhileRunning: 'Sends this now; what the agent is running keeps running',
  sendNowAll: (count: number) => `Sends the ${count} waiting messages now; what the agent is running keeps running`,
  sendNow: 'Sends this now',
  folded: (count: number, first: string) => `${count} queued · Next: ${first}`,
  readAlready: 'The agent has already read this message',
  boxHoldsDraft: 'The box holds a draft',
  answer: (title: string, words: string) => `Answer to ${title}: ${words}`,
  answerBare: (words: string) => `Answer: ${words}`,
  answers: (pairs: readonly string[]) => `Answers to ${pairs.length} questions: ${pairs.join('; ')}`, // a pair is `${title}: ${words}`, or the bare words
} as const;

/** A waiting answer's words, from the reader's class; null for any message that is no answer envelope. */
export function answerWords(text: string, questions: Read['questions']): string | null {
  return wordsOf(answerEnvelopeOf(text), questions);
}

function wordsOf(envelope: ReturnType<typeof answerEnvelopeOf>, questions: Read['questions']): string | null {
  if (envelope === null) return null;
  const asked = questions(envelope.call);
  // MAWS's own envelope always carries its answers; the class's null is another tool's shape. A new-form answer joins its
  // question by its place and comes back with the question's own id and the picked labels (board ticket 711); an earlier
  // build's comes back as it is
  const answers = asked === null ? (envelope.answers ?? []) : askAnswersFromSteer(asked, envelope.answers ?? []);
  // the asked order: the ask's questions where the window holds it, then any answer none of them holds; else the array's
  const ordered = asked === null ? answers : [...asked.flatMap((question) => answers.filter((answer) => answer.id === question.id)), ...answers.filter((answer) => !asked.some((question) => question.id === answer.id))];
  const pairs = ordered.map((answer) => {
    const question = asked?.find((candidate) => candidate.id === answer.id);
    return { title: question === undefined ? answer.question : askQuestionTitle(question), words: askAnswerCopy(answer) };
  });
  if (pairs.length === 1) {
    const { title, words } = pairs[0]!;
    return title === '' ? STACK_WORDS.answerBare(words) : STACK_WORDS.answer(title, words);
  }
  // an empty title (the capsule draws an empty label for it) gives the bare words
  return STACK_WORDS.answers(pairs.map(({ title, words }) => (title === '' ? words : `${title}: ${words}`)));
}

/** A waiting message's answer words: null for a message that is no answer envelope, or that holds an attachment beside one. */
function waitingAnswer(content: SendContent, questions: Read['questions']): string | null {
  return wordsOf(answerEnvelopeOf(content as string | ContentBlock[]), questions);
}

// UX wave U1c: the call a message's content grants, when its whole text is exactly one grant sentence. Decision Log 44: a
// row is a grant's only when the sentence is everything the message holds; a message with any block that is not text (an
// image, a PDF) is the person's own message, with its ordinary controls and its ordinary preview. Decision Log 53: read
// from the content, never from the text a row draws; a handed row has no content and takes `Unread.grant`. Ticket 704:
// what the message holds is the person's part, as the split reads it (`personsParts`), MAWS's answer envelopes beside it
// being answers of their own, as the transcript reads the message once the engine has it
const grantOf = (content: SendContent): BlockedCall | null => {
  const own = personsParts(content as string | ContentBlock[]).own;
  if (own === null || (typeof own !== 'string' && !own.every((block) => block.type === 'text'))) return null;
  const grants = readConsents(messageText(own));
  return grants.length === 1 ? { kind: grants[0]!.kind, subject: grants[0]!.subject } : null;
};

export function stackRows(queue: SessionQueue, lasting: ReadonlySet<string>, read: Read): StackRow[] {
  const steers = new Set<string>(queue.steers.map((steer) => steer.messageUuid));
  // a submission the queue still lists is drawn as its entry, never also as a handed row
  const listed = new Set<string>(queue.entries.flatMap((entry) => (entry.state !== 'released' && entry.messageUuid !== null ? [entry.messageUuid] : [])));
  const handed: StackRow[] = read.unread
    .filter((unread) => !steers.has(unread.messageUuid) && !listed.has(unread.messageUuid))
    .map((unread) => ({ kind: 'handed', key: unread.messageUuid, text: answerWords(unread.text, read.questions) ?? unread.text, createdAt: unread.at, grant: unread.grant ?? null })); // Decision Log 53
  const next: StackRow[] = queue.steers
    .filter((steer) => !read.started(steer.messageUuid))
    .map((steer) => ({ kind: 'next', key: steer.messageUuid, messageUuid: steer.messageUuid, content: steer.content, createdAt: steer.createdAt, answer: waitingAnswer(steer.content, read.questions), grant: grantOf(steer.content) }));
  const entries = queue.entries.flatMap((entry): StackRow[] => {
    if (entry.state === 'submitting') return lasting.has(entry.queueId) ? [{ kind: 'sending', key: entry.queueId, text: waitingAnswer(entry.content, read.questions) ?? entryDisplay(entry.content), createdAt: entry.createdAt, grant: grantOf(entry.content) }] : [];
    if (entry.state !== 'queued') return []; // released: the running turn
    if (entry.uncertain) return [{ kind: 'uncertain', key: entry.queueId, queueId: entry.queueId, content: entry.content, createdAt: entry.createdAt, grant: grantOf(entry.content) }];
    return [{ kind: queue.paused ? 'held' : 'after', key: entry.queueId, queueId: entry.queueId, content: entry.content, createdAt: entry.createdAt, answer: waitingAnswer(entry.content, read.questions), grant: grantOf(entry.content) }];
  });
  return [...handed, ...next, ...entries];
}

export const isWaiting = (row: StackRow): row is WaitingRow => row.kind === 'next' || row.kind === 'after' || row.kind === 'held';

/** Esc: the first row of kind next, after or held. */
export function firstToSend(rows: readonly StackRow[]): WaitingRow | null {
  return rows.find(isWaiting) ?? null;
}

/** ↑: the newest by `createdAt` of kind next, after or held that is no answer and no grant (an edited grant is no grant). */
export function newestToTake(rows: readonly StackRow[]): WaitingRow | null {
  let newest: WaitingRow | null = null;
  for (const row of rows) if (isWaiting(row) && row.answer === null && row.grant === null && (newest === null || row.createdAt > newest.createdAt)) newest = row;
  return newest;
}

/** The row's text: an answer's words; a grant's, the line it becomes (U1c); else its content as the stack reads it, or what a row with no content carries. */
export function rowText(row: StackRow): string {
  if ('answer' in row && row.answer !== null) return row.answer;
  if (row.grant !== null) return `${CONSENT.approved} ${row.grant.subject}`;
  return 'content' in row ? entryDisplay(row.content) : row.text;
}
