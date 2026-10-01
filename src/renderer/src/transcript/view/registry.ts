// The transcript actions registry (C8's ask, Public surface), and beside it the request-card renderer C7 registers.
// C7 (`editAndResubmit`), C8b (`openSubagent`, `openFullLog`) and C8c (`reviewChanges`, `openFile`) land in different
// waves, and each contributes its callbacks from its own block. Registrations merge over DEFAULT_ACTIONS in order, so a
// later registration of a key wins; a disposer removes its own registration, which restores an earlier registration of
// the same key if one remains.
import { useSyncExternalStore, type ReactNode } from 'react';
import type { Row } from '../model/rows';
import { DEFAULT_ACTIONS, type TranscriptActions } from './context';
import type { TranscriptProps } from './Transcript';

const registrations: Partial<TranscriptActions>[] = [];
const listeners = new Set<() => void>();
let merged: TranscriptActions = DEFAULT_ACTIONS;

function changed() {
  merged = { ...DEFAULT_ACTIONS };
  for (const partial of registrations) {
    for (const [key, action] of Object.entries(partial) as [keyof TranscriptActions, TranscriptActions[keyof TranscriptActions] | undefined][]) {
      if (action !== undefined) (merged as unknown as Record<string, unknown>)[key] = action;
    }
  }
  for (const listener of listeners) listener();
}

export function registerTranscriptActions(partial: Partial<TranscriptActions>): () => void {
  const registration = { ...partial };
  registrations.push(registration);
  changed();
  return () => {
    const at = registrations.indexOf(registration);
    if (at < 0) return;
    registrations.splice(at, 1);
    changed();
  };
}

// The merged actions; the same object until a registration changes.
export const registeredActions = (): TranscriptActions => merged;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useRegisteredActions = (): TranscriptActions => useSyncExternalStore(subscribe, registeredActions);

// C7's request card (X4) for the shell transcript's pending request slots: the latest registration renders; its
// disposer restores the previous one, and with none registered the slot shows its placeholder.
type RequestRenderer = NonNullable<TranscriptProps['renderRequest']>;
const renderers: RequestRenderer[] = [];

export function registerRequestRenderer(render: TranscriptProps['renderRequest']): () => void {
  if (!render) return () => {};
  const registration: RequestRenderer = (slot) => render(slot); // its own identity, so the same function can register twice
  renderers.push(registration);
  for (const listener of listeners) listener();
  return () => {
    const at = renderers.indexOf(registration);
    if (at < 0) return;
    renderers.splice(at, 1);
    for (const listener of listeners) listener();
  };
}

const latestRenderer = () => renderers.at(-1);
export const useRegisteredRequestRenderer = (): RequestRenderer | undefined => useSyncExternalStore(subscribe, latestRenderer);

// W3 (B6): C7's in-place editor for a user bubble, rendered around every bubble of a session transcript with the bubble
// as its children; it shows the bubble unless that bubble is the one its session edits. The latest registration wins.
export type BubbleEditor = (props: { storeKey: string; row: Extract<Row, { kind: 'user' }>; children: ReactNode }) => ReactNode;
let bubbleEditor: BubbleEditor | null = null;

export function registerBubbleEditor(editor: BubbleEditor): () => void {
  bubbleEditor = editor;
  for (const listener of listeners) listener();
  return () => {
    if (bubbleEditor !== editor) return;
    bubbleEditor = null;
    for (const listener of listeners) listener();
  };
}

const latestBubbleEditor = () => bubbleEditor;
export const useRegisteredBubbleEditor = (): BubbleEditor | null => useSyncExternalStore(subscribe, latestBubbleEditor);
