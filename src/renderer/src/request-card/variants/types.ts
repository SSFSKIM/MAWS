// What the card hands each variant body: the request, the placement, whether an answer is in flight, `submit` (the
// card's one delivery path) and `bindKeys`, through which the body gives the card its Enter and Esc actions. The card
// owns the registration (or the docked frame does), so the keyboard rules exist once for every kind.
import type { AttentionItem } from '@shared/graph/attention';
import type { RequestAnswer } from '@shared/engine/answers';
import type { SessionEvent } from '@shared/graph/events';
import type { Capability } from '../../session/controls/types';

export type Placement = 'docked' | 'card' | 'hover' | 'inline';

export interface CardKeys {
  accept: (() => void) | null;
  decline: (() => void) | null;
  digit?: ((n: number) => void) | null; // 1–9 pressed on the card's focus owner (the permission's scope pick)
}

export interface VariantProps<K extends SessionEvent['kind']> {
  item: AttentionItem;
  request: Extract<SessionEvent, { kind: K }>;
  placement: Placement;
  busy: boolean;
  // `what` is the collapsed line's text once delivered (`Answered · <what>`); `delivered` runs after a delivered answer.
  submit(answer: RequestAnswer, what: string, delivered?: () => void): void;
  bindKeys(keys: CardKeys): void;
  // P5 O9 M6: whether the session's controls port carries this answer (`answerCapability`), and why not; an option it
  // can't carry is drawn disabled in place with its reason, never sent, and no key answers it.
  capability(answer: RequestAnswer): Capability;
}

// A control's disabled state and its reason on hover, from a capability.
export const gated = (capability: Capability): { disabled: boolean; title: string | undefined } =>
  capability.available ? { disabled: false, title: undefined } : { disabled: true, title: capability.reason };
