// The stack's model (UX wave U4a, docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md, Interfaces G; decisions 12
// and 15): the rows above the composer, read from the host's queue and from the transcript's `unread` mark, so that a
// waiting message is a row here exactly while the transcript does not draw it. Pure: the component and the keys read it.
//
// The queue's snapshot and the transcript's row arrive on different channels. A message the transcript holds unread and
// the queue does not list (one sent now from an after-the-turn row until the engine starts it, or a steer whose row came
// before the snapshot) is a `handed` row, "Next step" with no controls; a pending steer the transcript already shows
// started is no row.
import { readConsents } from '@shared/engine/arrival'; // UX wave U1c
import type { SendContent } from '@shared/engine/session-state-store';
import { messageText } from '@shared/engine/peer-envelope';
import type { ContentBlock } from '@shared/graph/events';
import type { MessageUuid } from '@shared/graph/ids';
import { parseAskSteer } from '@shared/maws/ask';
import type { SessionQueue } from '../../stores/queue';
import type { BlockedCall } from '../../transcript/model/blocked'; // UX wave U1c
import { CONSENT } from '../../transcript/model/copy'; // UX wave U1c
import { entryDisplay } from './entry-text';

export interface Unread { messageUuid: MessageUuid; text: string; at: string; attached?: true } // a transcript row marked `unread`; U1c (Decision Log 49): `attached` when an attachment rides beside its text
export interface Read { unread: readonly Unread[]; started(messageUuid: MessageUuid): boolean }

// UX wave U1c (the U1c document, Interfaces §G; card 2): a row that has content carries `grant`, the call its whole text
// grants when it is exactly one "Approve and retry" sentence, else null; such a row reads as the line it becomes.
export type StackRow =
  | { kind: 'next'; key: string; messageUuid: MessageUuid; content: SendContent; createdAt: string; answer: boolean; grant: BlockedCall | null }
  | { kind: 'after' | 'held'; key: string; queueId: string; content: SendContent; createdAt: string; answer: boolean; grant: BlockedCall | null }
  | { kind: 'uncertain'; key: string; queueId: string; content: SendContent; createdAt: string; grant: BlockedCall | null }
  | { kind: 'sending'; key: string; text: string; createdAt: string } // a submission on its way: "Sending…"
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
} as const;

const isAnswer = (content: SendContent): boolean => parseAskSteer(messageText(content as string | ContentBlock[])) !== null;
// UX wave U1c: the call a text grants, when the whole text is exactly one grant sentence
const grantOfText = (text: string): BlockedCall | null => {
  const grants = readConsents(text);
  return grants.length === 1 ? { kind: grants[0]!.kind, subject: grants[0]!.subject } : null;
};
// Decision Log 44: a row is a grant's only when the sentence is everything the message holds; a message with any block
// that is not text (an image, a PDF) is the person's own message, with its ordinary controls and its ordinary preview.
// A handed row knows it from its transcript row's attachments (`Unread.attached`, Decision Log 49)
const grantOf = (content: SendContent): BlockedCall | null =>
  typeof content === 'string' || (content as readonly ContentBlock[]).every((block) => block.type === 'text') ? grantOfText(messageText(content as string | ContentBlock[])) : null;

export function stackRows(queue: SessionQueue, lasting: ReadonlySet<string>, read: Read): StackRow[] {
  const steers = new Set<string>(queue.steers.map((steer) => steer.messageUuid));
  // a submission the queue still lists is drawn as its entry, never also as a handed row
  const listed = new Set<string>(queue.entries.flatMap((entry) => (entry.state !== 'released' && entry.messageUuid !== null ? [entry.messageUuid] : [])));
  const handed: StackRow[] = read.unread
    .filter((unread) => !steers.has(unread.messageUuid) && !listed.has(unread.messageUuid))
    .map((unread) => ({ kind: 'handed', key: unread.messageUuid, text: unread.text, createdAt: unread.at, grant: unread.attached === true ? null : grantOfText(unread.text) })); // Decision Log 49 (2)
  const next: StackRow[] = queue.steers
    .filter((steer) => !read.started(steer.messageUuid))
    .map((steer) => ({ kind: 'next', key: steer.messageUuid, messageUuid: steer.messageUuid, content: steer.content, createdAt: steer.createdAt, answer: isAnswer(steer.content), grant: grantOf(steer.content) }));
  const entries = queue.entries.flatMap((entry): StackRow[] => {
    if (entry.state === 'submitting') return lasting.has(entry.queueId) ? [{ kind: 'sending', key: entry.queueId, text: entryDisplay(entry.content), createdAt: entry.createdAt }] : [];
    if (entry.state !== 'queued') return []; // released: the running turn
    if (entry.uncertain) return [{ kind: 'uncertain', key: entry.queueId, queueId: entry.queueId, content: entry.content, createdAt: entry.createdAt, grant: grantOf(entry.content) }];
    return [{ kind: queue.paused ? 'held' : 'after', key: entry.queueId, queueId: entry.queueId, content: entry.content, createdAt: entry.createdAt, answer: isAnswer(entry.content), grant: grantOf(entry.content) }];
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
  for (const row of rows) if (isWaiting(row) && !row.answer && row.grant === null && (newest === null || row.createdAt > newest.createdAt)) newest = row;
  return newest;
}

/** The row's text: its content as the stack reads it, or what a row with no content carries; a grant's, the line it becomes (U1c). */
export function rowText(row: StackRow): string {
  const grant = 'grant' in row ? row.grant : grantOfText(row.text);
  if (grant !== null) return `${CONSENT.approved} ${grant.subject}`;
  return 'content' in row ? entryDisplay(row.content) : row.text;
}
