// DX8 — the shell's slots, copied from MAWS's `src/renderer/src/app/slots.ts` (the survey's copy-and-adapt): components
// the shell renders at a fixed place with a fixed prop contract, whose real implementation a later child registers.
// Until DC6 registers them the fallbacks (`slot-fallbacks.tsx`) render. The names and props are the seam DC6 codes
// against; a change to them is a Decision Log entry that flags DC6. DC9 retired the `transcript` slot (the working
// record a fold unfolded in the center): a direct channel's center is the session view, the center's own.
import type { ComponentType } from 'react';
import { create } from 'zustand';
import type { SessionPlane } from './session-plane';
import type { DeskSession } from './sessions';
import { FALLBACKS } from './slot-fallbacks';

export type DepthSlotProps = {
  project: string;
  /** The selected direct channel's session; null while the group chat is selected. */
  session: DeskSession | null;
  plane: SessionPlane;
};

export interface Slots {
  /** The right column: the selected session's depth (subagents, jobs, diff, session info). DC6, DC9. */
  depth: ComponentType<DepthSlotProps>;
}

// A store rather than a plain map, so a registration after the first render still reaches the page.
const useRegistered = create<{ slots: Partial<Slots> }>()(() => ({ slots: {} }));

/** Called once from the app's composition (DC6's `connectDepth()`); the last registration wins. */
export function registerSlot<K extends keyof Slots>(name: K, component: Slots[K]): () => void {
  useRegistered.setState((s) => ({ slots: { ...s.slots, [name]: component } }));
  return () => useRegistered.setState((s) => (s.slots[name] === component ? { slots: { ...s.slots, [name]: undefined } } : s));
}

/** The registered component, or the shell's fallback. */
export function useSlot<K extends keyof Slots>(name: K): Slots[K] {
  const registered = useRegistered((s) => s.slots[name]);
  return registered ?? FALLBACKS[name];
}

/** Tests: back to the fallbacks. */
export function resetSlots(): void {
  useRegistered.setState({ slots: {} });
}
