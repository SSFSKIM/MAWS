// Renderer-sink chords bound to the element that owns them (C5 execution document, Keyboard runtime; charter §5.7).
// A component registers a handler for a renderer-sink action with the element it answers for (`within`); the key
// dispatcher (`dispatcher.ts`) runs it only when that element contains both the key's target and the element that
// holds focus, the innermost such binding winning. So a docked card answers only from its own pane, and of two
// Overview cards only the focused one can answer; a remembered pane index plays no part.
import { useEffectEvent, useLayoutEffect, type RefObject } from 'react';
import type { ActionId } from '@shared/keymap/actions';

export type HoldRelease = 'keyup' | 'lost'; // E9: the hold ended by letting go of its chord, or the keyboard went away

export interface ChordBinding {
  id: ActionId;
  run(arg: number | null): void;
  release?(reason: HoldRelease): void; // E9: a hold action's end (the dispatcher's "Hold semantics")
  within: RefObject<HTMLElement | null> | null; // required for scope 'pane' and 'composer'; ignored for scope 'app'
  order: number; // registration order: of two bindings on the same element the later one wins
}

const bindings = new Set<ChordBinding>();
let registered = 0;
// E9: told when a binding goes away, so the dispatcher releases a hold whose binding unmounts mid-hold with 'lost'
let unbound: ((binding: ChordBinding) => void) | null = null;
export function onUnbind(listener: (binding: ChordBinding) => void): void {
  unbound = listener;
}

export function bindChord(binding: Omit<ChordBinding, 'order'>): () => void {
  const entry = { ...binding, order: ++registered };
  bindings.add(entry);
  return () => {
    bindings.delete(entry);
    unbound?.(entry);
  };
}

export const bindingsOf = (id: ActionId): ChordBinding[] => [...bindings].filter((b) => b.id === id);

export function useKeyChord(
  id: ActionId,
  handler: (arg: number | null) => void,
  opts: { within?: RefObject<HTMLElement | null>; enabled?: boolean; onRelease?(reason: HoldRelease): void } = {},
): void {
  const { within = null, enabled = true, onRelease } = opts;
  const onKey = useEffectEvent(handler);
  const onHoldEnd = useEffectEvent((reason: HoldRelease) => onRelease?.(reason));
  // Bound in the commit that mounts the element (debt wave 5): a passive effect runs after paint, and under load late
  // enough that a key pressed at a card that is already on screen found no binding.
  useLayoutEffect(() => {
    if (!enabled) return;
    return bindChord({ id, within, run: (arg) => onKey(arg), release: (reason) => onHoldEnd(reason) });
  }, [id, within, enabled]);
}
