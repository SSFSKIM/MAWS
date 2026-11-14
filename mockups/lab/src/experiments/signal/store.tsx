import { createContext, useContext } from 'react';
import type { SessionState } from '../../content/fixtures';

export interface SignalCtx {
  /** The live state of each session; it starts as the fixture's and changes when the person acts. */
  stateOf(id: string, fallback: SessionState): SessionState;
  setState(id: string, state: SessionState): void;
  /** Step a session to its next state (the lab's way to watch the field change). */
  cycle(id: string, from: SessionState): void;
  /** Rows are about to move without the pane resizing: keep the field repainting for a while. */
  kick(): void;
  collapsed: boolean;
  setCollapsed(v: boolean): void;
}

export const Ctx = createContext<SignalCtx | null>(null);

export function useSignal(): SignalCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('signal context missing');
  return v;
}

export const ORDER: SessionState[] = ['running', 'approval', 'question', 'plan', 'unread', 'idle'];
