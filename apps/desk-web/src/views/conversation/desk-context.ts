// What every view of an open project's conversation shares: the project's connection, the signed-in member (who seals
// what the web sends), and the project's sessions as the shell knows them.
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { ProjectConnection } from '../../project/connection';
import type { DeskSession } from '../../shell/sessions';

export type DeskContextValue = { connection: ProjectConnection; member: string; sessions: Map<string, DeskSession> };

export const DeskContext = createContext<DeskContextValue | null>(null);

export function useDesk(): DeskContextValue {
  const value = useContext(DeskContext);
  if (!value) throw new Error('useDesk outside an open project');
  return value;
}

/** Whether the project socket is welcomed: while it is not, no control that issues an RPC acts (`capabilities`). */
export function useConnected(): boolean {
  return useStore(useDesk().connection.live, (s) => s.connected);
}
