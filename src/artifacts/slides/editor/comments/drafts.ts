// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; the prior art's V5; X36's draft rule): the deck
// editor's reply drafts, one map per editor, by thread: the pin popover's cards and the threads rail's reply fields read
// and write the same text, so a reply typed in one is there in the other, and closing the popover (Escape, a click on
// the stage, its pin going) keeps it. Outside React state, so a keystroke renders only the fields that read it.
import { useSyncExternalStore } from 'react';

export class ReplyDrafts {
  private map: ReadonlyMap<string, string> = new Map();
  private readonly listeners = new Set<() => void>();

  /** Every thread's draft; a new map on each change, so a render keyed on it sees the change. */
  snapshot = (): ReadonlyMap<string, string> => this.map;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get(threadId: string): string {
    return this.map.get(threadId) ?? '';
  }

  /** A thread's draft as typed; an empty one is no draft. */
  set(threadId: string, text: string): void {
    if (this.get(threadId) === text) return;
    const next = new Map(this.map);
    if (text === '') next.delete(threadId);
    else next.set(threadId, text);
    this.map = next;
    for (const listener of [...this.listeners]) listener();
  }
}

/** The editor's drafts as React reads them. */
export const useReplyDrafts = (drafts: ReplyDrafts): ReadonlyMap<string, string> => useSyncExternalStore(drafts.subscribe, drafts.snapshot);
