// Renderer-sink chords bound to the element that owns them (C5 execution document, Keyboard runtime; charter §5.7).
// A component registers a handler for a renderer-sink action with the element it answers for (`within`); the key
// dispatcher (`dispatcher.ts`) runs it only when that element contains both the key's target and the element that
// holds focus, the innermost such binding winning. So a docked card answers only from its own pane, and of two
// Overview cards only the focused one can answer; a remembered pane index plays no part.
import { useEffect, useEffectEvent, type RefObject } from 'react';
import type { ActionId } from '@shared/keymap/actions';

export interface ChordBinding {
  id: ActionId;
  run(arg: number | null): void;
  within: RefObject<HTMLElement | null> | null; // required for scope 'pane' and 'composer'; ignored for scope 'app'
  order: number; // registration order: of two bindings on the same element the later one wins
}

const bindings = new Set<ChordBinding>();
let registered = 0;

export function bindChord(binding: Omit<ChordBinding, 'order'>): () => void {
  const entry = { ...binding, order: ++registered };
  bindings.add(entry);
  return () => void bindings.delete(entry);
}

export const bindingsOf = (id: ActionId): ChordBinding[] => [...bindings].filter((b) => b.id === id);

export function useKeyChord(
  id: ActionId,
  handler: (arg: number | null) => void,
  opts: { within?: RefObject<HTMLElement | null>; enabled?: boolean } = {},
): void {
  const { within = null, enabled = true } = opts;
  const onKey = useEffectEvent(handler);
  useEffect(() => {
    if (!enabled) return;
    return bindChord({ id, within, run: (arg) => onKey(arg) });
  }, [id, within, enabled]);
}
