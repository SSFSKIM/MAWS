// Cards another child docks in a session's composer (owner ruling 2026-09-28: C10's trust and relay-down cards dock
// where a permission would). The composer renders the oldest docked card before any pending request; each card
// renders itself inside `DockedCardFrame`. The disposer `dockCard` returns undocks that card only.
import { create } from 'zustand';
import type { ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';

export interface DockedCard {
  id: string;
  render: () => ReactNode;
}

const NONE: ReadonlyArray<DockedCard> = [];
const useDocked = create<{ bySession: ReadonlyMap<AppSessionId, ReadonlyArray<DockedCard>> }>()(() => ({ bySession: new Map() }));

export function dockCard(appSessionId: AppSessionId, card: DockedCard): () => void {
  const entry = { ...card }; // its own identity: the same card docked twice undocks one at a time
  useDocked.setState((s) => ({ bySession: new Map(s.bySession).set(appSessionId, [...(s.bySession.get(appSessionId) ?? NONE), entry]) }));
  return () =>
    useDocked.setState((s) => {
      const cards = s.bySession.get(appSessionId) ?? NONE;
      if (!cards.includes(entry)) return s;
      const rest = cards.filter((c) => c !== entry);
      const bySession = new Map(s.bySession);
      if (rest.length > 0) bySession.set(appSessionId, rest);
      else bySession.delete(appSessionId);
      return { bySession };
    });
}

// The session's docked cards, oldest first.
export const useDockedCards = (appSessionId: AppSessionId): ReadonlyArray<DockedCard> => useDocked((s) => s.bySession.get(appSessionId) ?? NONE);

export function resetDockedCards(): void {
  useDocked.setState({ bySession: new Map() });
}
