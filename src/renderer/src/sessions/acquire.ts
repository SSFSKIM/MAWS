// P2-A (2026-10-09; X16, the execution document §5.3): the renderer's one way to make a session usable. Every surface
// calls it from an owner gesture's handler only (a click, a key, a typed command's Enter), never on mount, a switch, a
// refetch, a poll or a timer. Main answers after the launch it awaited, joining one already in flight, so each caller
// runs its own operation once afterwards. A trust or relay card the attempt meets docks in the session's composer; the
// words for every other refusal are the caller's to show where its "Starting…" was: nothing here toasts.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { AcquireReason, StartOptions } from '@shared/ipc/schema/session';
import type { FirstMessage } from '@shared/sessions/intent';
import type { AcquireOutcome, StartOutcome } from '@shared/sessions/setup';
import { ARCHIVED } from '../composer/submit/submit-state';
import { ipc } from '../ipc/client';
import { holderWords } from './holder-words';
import { useSetup } from './store';

// What a surface other than the composer says when the attempt docked a card in the session's composer (its own text
// never goes to that card, which would send it later out of its context)
export const TRUST_FIRST = 'Trust this folder in the session to continue';
export const RELAY_FIRST = 'The relay is unreachable · the session offers Run direct';

// `current`: whether the caller still wants the card the answer may dock (a card's continuation whose card the owner
// dismissed meanwhile docks nothing); absent, it always does.
export type AcquireOptions = StartOptions & { dockMessage?: FirstMessage; current?: () => boolean };

// Throws when the command itself fails (main or the host unreachable), as the send seam does, so a caller's Retry applies.
export async function acquireSession(appSessionId: AppSessionId, reason: AcquireReason, options: AcquireOptions = {}, client: MawsBridge = ipc): Promise<AcquireOutcome> {
  const { dockMessage, current, ...start } = options;
  const result = await client.invoke('session.acquire', { appSessionId, reason, ...(Object.keys(start).length > 0 && { options: start }) });
  if (!result.ok) throw new Error(result.error.message);
  if (current?.() ?? true) dockFor(appSessionId, result.value, dockMessage ?? null);
  return result.value;
}

// The words a surface shows for an attempt that did not end ready; null for ready and for a card, which explains itself.
export function acquisitionWords(outcome: AcquireOutcome): string | null {
  switch (outcome.status) {
    case 'ready':
    case 'needs_trust':
    case 'relay_unreachable':
      return null;
    case 'held':
      return `Held by ${holderWords(outcome.holder)}`;
    case 'missing_directory':
      return `Directory not found: ${outcome.directory}`;
    case 'archived':
      return ARCHIVED;
    case 'invalid':
    case 'refused':
    case 'failed':
      return outcome.message;
  }
}

// What a surface that never hands its text to a card says when the attempt docked one.
export const cardWords = (outcome: Extract<AcquireOutcome, { status: 'needs_trust' | 'relay_unreachable' }>): string => (outcome.status === 'needs_trust' ? TRUST_FIRST : RELAY_FIRST);

// Docks the card a start or an acquisition waits on, with the message its continuation will send (null: it only
// starts the session). The store keeps one card per session, and every joiner of one attempt gets the same card
// answer, so a card without a message never replaces a docked card of the same kind that carries one: the composer's
// card wins, the other surfaces' answers point at it.
export function dockFor(appSessionId: AppSessionId, outcome: StartOutcome | AcquireOutcome, message: FirstMessage | null): void {
  if (outcome.status !== 'needs_trust' && outcome.status !== 'relay_unreachable') return;
  const store = useSetup.getState();
  const kind = outcome.status === 'needs_trust' ? 'trust' : 'relay';
  const docked = store.cards.get(appSessionId);
  if (message === null && docked?.kind === kind && docked.message !== null) return;
  if (outcome.status === 'needs_trust') store.dock(appSessionId, { kind: 'trust', trust: outcome.trust, message });
  else store.dock(appSessionId, { kind: 'relay', health: outcome.health, message });
}
