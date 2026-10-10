// The comment card's thread, as pure readings (P2-E1 document, D6): where the thread's own rows begin, what the
// needs-you strip says, and how the human send seam's answer reads in the card.
import type { AttentionItem } from '@shared/graph/attention';
import type { Lineage, SessionRecord } from '@shared/graph/session';
import { waitingItem } from '../../attention/derive';
import type { HumanPromptResult } from '../../composer/submit/send-human-prompt';
import { RELAY_FIRST, TRUST_FIRST } from '../../sessions/acquire'; // P2-A
import { holderWords } from '../../sessions/holder-words';
import type { WaitingCard } from '../../sessions/store';
import type { Row } from '../../transcript/model/rows';
import { SIDE_COPY } from '../copy';

const NEEDS = SIDE_COPY.card.needs;

// The index of the first row the card shows: the last prompt framed as this thread's anchored comment (its anchor's
// kind, locator and label, its destination a thread). The last, because a thread of a thread copies its parent's
// anchored prompt first; a thread read from disk begins with the parent's copied history, which the card leaves out.
// Null while nothing is loaded and no such prompt has arrived; once loaded with none, everything from 0 (showing too
// much is recoverable, hiding the thread is not). A thread with no anchor (a promotion) starts at 0.
export function threadStartOf(lineage: Lineage | null): (rows: readonly Row[], loaded: boolean) => number | null {
  const anchor = lineage?.anchor;
  if (anchor === undefined) return () => 0;
  return (rows, loaded) => {
    const index = rows.findLastIndex(
      (row) => row.kind === 'user' && row.anchorFrame?.destination === 'thread' && row.anchor?.kind === anchor.kind && row.anchor.locator === anchor.locator && row.anchor.label === anchor.label,
    );
    if (index >= 0) return index;
    return loaded ? 0 : null;
  };
}

export type SessionHolder = SessionRecord['holder'];
export type NeedsYou = { kind: 'setup-card' | 'setup-failed' | 'held' | 'attention'; text: string; tabOnly: boolean } | null;

const ATTENTION_TEXT: Record<string, string> = {
  permission: NEEDS.permission,
  question: NEEDS.question,
  plan: NEEDS.plan,
  dialog: NEEDS.input,
  elicitation: NEEDS.input,
  error: NEEDS.error,
  interrupted: NEEDS.interrupted,
  auto_mode_unavailable: NEEDS.autoModeUnavailable,
};
// P2-C's kinds: the card's rows show an essential and its Reply answers a question, so neither raises the strip.
const CARRIED_BY_THE_CARD = new Set<string>(['async_input', 'essential_unread']);

// The one line above Reply when the thread waits on the person, first source first: a setup card (trust, relay) and a
// failed start, which live in the full view; a terminal or background job holding the thread (only a tab helps); the
// oldest tier-1 attention item, by kind. Tier 2 (held peer messages) raises none.
export function needsYouOf({ card, failed, holder, pending }: { card: WaitingCard | undefined; failed: boolean; holder: SessionHolder | null; pending: AttentionItem[] }): NeedsYou {
  if (card !== undefined) return { kind: 'setup-card', text: card.kind === 'trust' ? NEEDS.trust : NEEDS.relay, tabOnly: false };
  if (failed) return { kind: 'setup-failed', text: NEEDS.failed, tabOnly: false };
  if (holder !== null && (holder.kind === 'terminal' || holder.kind === 'background_job')) return { kind: 'held', text: NEEDS.held(holderWords(holder)), tabOnly: true };
  const waiting = waitingItem(pending.filter((i) => !CARRIED_BY_THE_CARD.has(i.kind)));
  if (waiting === null || waiting.tier !== 1) return null;
  return { kind: 'attention', text: ATTENTION_TEXT[waiting.oldest.kind] ?? NEEDS.other, tabOnly: false };
}

// What a Reply became, as the card shows it (D6's disposition table): delivered (the field clears; the transcript draws
// the user row, the pending steer or the held bubble) or refused (the field keeps the text, the reason under it). The one
// place that reads the seam's answer: a started send or queue reads by its disposition (since P2-A the seam starts a
// released thread before it sends, so no reply waits on a start), and `held` like a refusal.
export type ReplyOutcome = { kind: 'delivered' } | { kind: 'refused'; reason: string };
export function replyOutcomeOf(result: HumanPromptResult): ReplyOutcome {
  switch (result.disposition) {
    case 'sent':
    case 'steered':
    case 'queued':
      return { kind: 'delivered' }; // P2-A: `started` or not, the seam sent it once the thread was ready
    case 'held': // P2-A: a trust or relay card took the text (only a composer send's; the card's are refused)
      return { kind: 'refused', reason: result.reason === 'trust' ? TRUST_FIRST : result.reason === 'relay' ? RELAY_FIRST : SIDE_COPY.card.replyRefused };
    case 'refused':
      return { kind: 'refused', reason: result.reason ?? SIDE_COPY.card.replyRefused };
  }
}
