// The stack's model (UX wave U4a, docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md, Interfaces G; decisions 12
// and 15): the rows above the composer, read from the host's queue and from the transcript's `unread` mark, so that a
// waiting message is a row here exactly while the transcript does not draw it. Pure: the component and the keys read it.
//
// The queue's snapshot and the transcript's row arrive on different channels. A message the transcript holds unread and
// the queue does not list (one sent now from an after-the-turn row until the engine starts it, or a steer whose row came
// before the snapshot) is a `handed` row, "Next step" with no controls; a pending steer the transcript already shows
// started is no row.
import type { SendContent } from '@shared/engine/session-state-store';
import { messageText } from '@shared/engine/peer-envelope';
import type { ContentBlock } from '@shared/graph/events';
import type { MessageUuid } from '@shared/graph/ids';
import { parseAskSteer } from '@shared/maws/ask';
import type { SessionQueue } from '../../stores/queue';
import { entryDisplay } from './entry-text';

export interface Unread { messageUuid: MessageUuid; text: string; at: string } // a transcript row marked `unread`
export interface Read { unread: readonly Unread[]; started(messageUuid: MessageUuid): boolean }

export type StackRow =
  | { kind: 'next'; key: string; messageUuid: MessageUuid; content: SendContent; createdAt: string; answer: boolean }
  | { kind: 'after' | 'held'; key: string; queueId: string; content: SendContent; createdAt: string; answer: boolean }
  | { kind: 'uncertain'; key: string; queueId: string; content: SendContent; createdAt: string }
  | { kind: 'sending'; key: string; text: string; createdAt: string } // a submission on its way: "Sending…"
  | { kind: 'handed'; key: string; text: string; createdAt: string }; // the engine holds it and MAWS's queue does not list it: "Next step", no controls

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

export function stackRows(queue: SessionQueue, lasting: ReadonlySet<string>, read: Read): StackRow[] {
  const steers = new Set<string>(queue.steers.map((steer) => steer.messageUuid));
  // a submission the queue still lists is drawn as its entry, never also as a handed row
  const listed = new Set<string>(queue.entries.flatMap((entry) => (entry.state !== 'released' && entry.messageUuid !== null ? [entry.messageUuid] : [])));
  const handed: StackRow[] = read.unread
    .filter((unread) => !steers.has(unread.messageUuid) && !listed.has(unread.messageUuid))
    .map((unread) => ({ kind: 'handed', key: unread.messageUuid, text: unread.text, createdAt: unread.at }));
  const next: StackRow[] = queue.steers
    .filter((steer) => !read.started(steer.messageUuid))
    .map((steer) => ({ kind: 'next', key: steer.messageUuid, messageUuid: steer.messageUuid, content: steer.content, createdAt: steer.createdAt, answer: isAnswer(steer.content) }));
  const entries = queue.entries.flatMap((entry): StackRow[] => {
    if (entry.state === 'submitting') return lasting.has(entry.queueId) ? [{ kind: 'sending', key: entry.queueId, text: entryDisplay(entry.content), createdAt: entry.createdAt }] : [];
    if (entry.state !== 'queued') return []; // released: the running turn
    if (entry.uncertain) return [{ kind: 'uncertain', key: entry.queueId, queueId: entry.queueId, content: entry.content, createdAt: entry.createdAt }];
    return [{ kind: queue.paused ? 'held' : 'after', key: entry.queueId, queueId: entry.queueId, content: entry.content, createdAt: entry.createdAt, answer: isAnswer(entry.content) }];
  });
  return [...handed, ...next, ...entries];
}

export const isWaiting = (row: StackRow): row is WaitingRow => row.kind === 'next' || row.kind === 'after' || row.kind === 'held';

/** Esc: the first row of kind next, after or held. */
export function firstToSend(rows: readonly StackRow[]): WaitingRow | null {
  return rows.find(isWaiting) ?? null;
}

/** ↑: the newest by `createdAt` of kind next, after or held that is no answer. */
export function newestToTake(rows: readonly StackRow[]): WaitingRow | null {
  let newest: WaitingRow | null = null;
  for (const row of rows) if (isWaiting(row) && !row.answer && (newest === null || row.createdAt > newest.createdAt)) newest = row;
  return newest;
}

/** The row's text: its content as the stack reads it, or what a row with no content carries. */
export const rowText = (row: StackRow): string => ('content' in row ? entryDisplay(row.content) : row.text);
