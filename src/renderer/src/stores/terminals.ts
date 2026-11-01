// The React mirror of the terminal registry (C9 Interfaces *Terminal registry and store*): `TerminalInfo[]` and each
// machine's PTY host state (the lost bar's "New terminal" waits for its terminal's machine to be `ready`; P5 O7 M3), fed
// by `terminals.subscribe`. Handles, renderers and containers never enter React state; a component that shows a terminal
// asks the registry to mount it.
import { create } from 'zustand';
import type { HostState } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { terminals, type TerminalInfo, type TerminalRegistry } from '../terminal/registry';

export interface TerminalsState {
  terminals: TerminalInfo[];
  host: HostState | null; // this machine's (the harness pages show it)
  hosts: ReadonlyMap<MachineRef, HostState>;
}

export function createTerminalsStore(registry: Pick<TerminalRegistry, 'list' | 'host' | 'hosts' | 'subscribe'>) {
  const store = create<TerminalsState>()(() => ({ terminals: registry.list(), host: registry.host(), hosts: registry.hosts() }));
  registry.subscribe((infos, host) => store.setState({ terminals: infos, host, hosts: registry.hosts() }));
  return store;
}

export const useTerminals = createTerminalsStore(terminals);
