// The React mirror of the terminal registry (C9 Interfaces *Terminal registry and store*): `TerminalInfo[]` and the
// PTY host's state (the lost bar's "New terminal" waits for `ready`), fed by `terminals.subscribe`. Handles, renderers
// and containers never enter React state; a component that shows a terminal asks the registry to mount it.
import { create } from 'zustand';
import type { HostState } from '@shared/ipc/schema';
import { terminals, type TerminalInfo, type TerminalRegistry } from '../terminal/registry';

export interface TerminalsState {
  terminals: TerminalInfo[];
  host: HostState | null;
}

export function createTerminalsStore(registry: Pick<TerminalRegistry, 'list' | 'host' | 'subscribe'>) {
  const store = create<TerminalsState>()(() => ({ terminals: registry.list(), host: registry.host() }));
  registry.subscribe((infos, host) => store.setState({ terminals: infos, host }));
  return store;
}

export const useTerminals = createTerminalsStore(terminals);
