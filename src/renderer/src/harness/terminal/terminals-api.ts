// `window.__maws_harness.terminals`, the same names on the `#probe` registry pane and the `#panel` page: what
// Playwright and `spikes/terminal-probe` read and drive of the registry's terminals. Each page supplies what opening,
// showing and closing a terminal means on it.
import type { PtyInfo } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';
import { terminals, type TerminalId, type TerminalInfo } from '../../terminal/registry';
import type { TerminalProbe } from '../../terminal/renderer';
import { countersOf, useSamples, wasPausedSeen, type Pings, type StreamCounters } from './debug-tap';

export interface TerminalsHarnessApi {
  ready(): Promise<TerminalId[]>; // resolves once the page has re-adopted its ptys (and opened what it opens on load)
  list(): TerminalInfo[];
  open(command?: string): TerminalId;
  select(id: TerminalId | null): void; // null shows none: every terminal hidden, as when another tab is selected
  probe(id: TerminalId): TerminalProbe | null;
  type(id: TerminalId, data: string): Promise<void>; // written to the pty as keystrokes would be
  simulateContextLoss(id: TerminalId): void;
  setCheckpoints(enabled: boolean): void;
  respawn(id: TerminalId): Promise<void>;
  close(id: TerminalId): Promise<void>;
  ptys(): Promise<PtyInfo[]>;
  selection(id: TerminalId): string;
  counters(id: TerminalId): StreamCounters | null; // every pty.data byte of the terminal's current pty since the page loaded
  pausedSeen(id: TerminalId): boolean; // the host reported the terminal's pty paused in at least one 10 ms sample
  pings(): Pings;
}

export interface HarnessPage {
  ready(): Promise<TerminalId[]>;
  open(command?: string): TerminalId;
  select(id: TerminalId | null): void;
  close(id: TerminalId): Promise<void>;
}

export function createTerminalsApi(page: HarnessPage): TerminalsHarnessApi {
  const handle = (id: TerminalId) => terminals.get(id);
  return {
    ...page,
    list: () => terminals.list(),
    probe: (id) => handle(id)?.renderer?.probe() ?? null,
    async type(id, data) {
      const ptyId = handle(id)?.info.ptyId;
      if (!ptyId) throw new Error(`${id} has no pty`);
      const result = await ipc.invoke('pty.write', { ptyId, data });
      if (!result.ok) throw new Error(`pty.write failed: ${result.error.message}`);
    },
    simulateContextLoss: (id) => handle(id)?.renderer?.simulateContextLoss?.(),
    setCheckpoints: (enabled) => terminals.setCheckpoints(enabled),
    respawn: (id) => terminals.respawn(id),
    async ptys() {
      const result = await ipc.invoke('pty.list', undefined);
      return result.ok ? result.value.ptys : [];
    },
    selection: (id) => handle(id)?.renderer?.getSelection() ?? '',
    counters: (id) => countersOf(handle(id)?.info.ptyId),
    pausedSeen: (id) => wasPausedSeen(handle(id)?.info.ptyId),
    pings: () => useSamples.getState().pings,
  };
}
