// The shell's slots (C5 execution document, Slots; residue *Slots*): components the shell renders at a fixed place with
// a fixed prop contract, whose real implementation a later child registers from `App.tsx`. Until then C5's fallback
// (`slot-fallbacks.tsx`) renders. The names and props are the merge seam C6, C7, C8 and C10 code against.
import type { ComponentType } from 'react';
import { create } from 'zustand';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import type { TabRef } from '@shared/ipc/schema/layout';
import type { PanelHostProps } from '../panel/host-slot';
import { FALLBACKS } from './slot-fallbacks';

export interface Slots {
  transcript: ComponentType<{ appSessionId: AppSessionId; agentId: AgentId | null; paneIndex: 0 | 1 }>; // C6 registers <Transcript>
  composer: ComponentType<{ appSessionId: AppSessionId; paneIndex: 0 | 1 }>; // C7
  requestCard: ComponentType<{ item: AttentionItem; request: SessionEvent | null; placement: 'docked' | 'card' | 'hover'; paneIndex: 0 | 1 | null }>; // X4, C7
  panelHost: ComponentType<PanelHostProps>; // X5, C8
  fileTab: ComponentType<{ tab: Extract<TabRef, { kind: 'file' }> }>; // C8
  diffTab: ComponentType<{ tab: Extract<TabRef, { kind: 'diff' }> }>; // C8
  newSession: ComponentType<{ appSessionId: AppSessionId }>; // C10: an unstarted session's setup, in its pane above the composer (no modal sheet)
  settingsTab: ComponentType<{ section: Extract<TabRef, { kind: 'settings' }>['section'] }>; // C11: the Settings tab's content, at a section
  topBarEnd: ComponentType<Record<never, never>>; // the title-bar toolbar's right-side mount point, for W6's usage pill
  browserTab: ComponentType<{ tab: Extract<TabRef, { kind: 'browser' }> }>; // E4a: a session's browser tab as a main tab
  artifactsLibrary: ComponentType<Record<never, never>>; // P3-G (§D5): the Artifacts tab's content; P3-L registers the library
}

// A store rather than a plain map, so a registration after the first render still reaches the page.
const useRegistered = create<{ slots: Partial<Slots> }>()(() => ({ slots: {} }));

// Called from App.tsx composition; the last registration wins.
export function registerSlot<K extends keyof Slots>(name: K, component: Slots[K]): void {
  useRegistered.setState((s) => ({ slots: { ...s.slots, [name]: component } }));
}

// The registered component, or C5's fallback.
export function useSlot<K extends keyof Slots>(name: K): Slots[K] {
  const registered = useRegistered((s) => s.slots[name]);
  return registered ?? FALLBACKS[name];
}

// Tests: back to the fallbacks.
export function resetSlots(): void {
  useRegistered.setState({ slots: {} });
}
