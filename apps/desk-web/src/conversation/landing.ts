// Landing on a card from a tapped notification (§4): the push only pointed to it, so the channel finds the card among
// what it draws — and it draws only what verified — and otherwise says why it is not there: still checking, settled
// before the page opened, failed verification, or not in the log.
import type { ProjectLogState } from '../log/project-log';
import type { ConversationState } from '../project/conversation';
import type { Landing } from '../sw/notice';
import type { StreamItem } from './stream';

export type LandingStatus = { kind: 'shown' } | { kind: 'checking' | 'gone' | 'unverified' | 'missing'; text: string };

/** The key of the stream item the landing names, or null when the channel draws no such card. */
export function landedItem(landing: Landing, items: StreamItem[]): string | null {
  for (const item of items) {
    if (landing.kind === 'request') {
      if ((item.kind === 'request' || item.kind === 'question') && item.request === landing.request) return item.key;
    } else if ((item.kind === 'message' || item.kind === 'question') && item.event.writer === landing.writer && item.event.seq === landing.seq) {
      return item.key;
    }
  }
  return null;
}

/**
 * Whether a card missing from the channel is missing for good: the backlog is in (`caughtUp`), the pending set this
 * connection received has verified (`checked`), and no log entry is still being checked. The hub's caught-up alone
 * comes before the asynchronous checks finish, and a request still pending must not read "no longer waiting".
 */
export function landingReady(caughtUp: boolean, conversation: Pick<ConversationState, 'checked'>, log: ProjectLogState): boolean {
  return caughtUp && conversation.checked && (log.locked || !log.entries.some((e) => e.verdict === 'pending'));
}

export function landingStatus(input: { landing: Landing; found: boolean; ready: boolean; unverified: boolean }): LandingStatus {
  const what = input.landing.kind === 'request' ? 'request' : 'message';
  if (input.found) return { kind: 'shown' };
  if (input.unverified) return { kind: 'unverified', text: `This ${what} failed verification, so it is not shown.` };
  if (!input.ready) return { kind: 'checking', text: `Checking the ${what}…` };
  if (input.landing.kind === 'request') return { kind: 'gone', text: 'This request is no longer waiting: it was answered or withdrawn before you opened it.' };
  return { kind: 'missing', text: 'This message is not in the log this browser holds.' };
}
