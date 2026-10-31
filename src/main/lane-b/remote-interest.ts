// The tabs of RL2 machines (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Subscriptions follow
// the tabs"): main subscribes to a remote lane B session while any window's `main.tabs` holds its address, and lets it
// go UNSUBSCRIBE_LINGER_MS after its last tab closed, so a tab switched away and back keeps its one stream. The renderer
// asks for nothing: the layout is read as main's own interest reads it (src/main/layout/open-session-tabs.ts), here for
// the sessions of other machines, kept only for the machines an RL2 link reaches (a socket-linked profile's sessions
// take the manager's path, and their events come over that link).
//
// `open` is called for every address a tab holds at each read (opening is the adapter's to make idempotent, and a
// re-read is how a later click retries a session that could not be placed); `close` once, after the linger, or at once
// when the machine stops being reached over RL2 (`refresh`, after its link closed).
import { storedMainSchema } from '@shared/ipc/schema/layout';
import { bareOf, isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import type { LayoutFileStore } from '../layout/store';

/** The sessions of other machines that a session or agent tab holds, by machine, as bare ids. */
export function remoteSessionsInTabs(mainTabs: unknown, local: MachineRef): Map<MachineRef, Set<string>> {
  const parsed = storedMainSchema(local).safeParse(mainTabs);
  const held = new Map<MachineRef, Set<string>>();
  if (!parsed.success) return held;
  const main = parsed.data;
  for (const set of main.version === 3 ? Object.values(main.sets) : [main]) {
    for (const pane of set?.panes ?? []) {
      for (const tab of pane.tabs) {
        if ((tab.kind !== 'session' && tab.kind !== 'agent') || !isAddress(tab.appSessionId)) continue;
        const machine = machineOf(tab.appSessionId);
        if (machine === local) continue;
        let ids = held.get(machine);
        if (ids === undefined) held.set(machine, (ids = new Set()));
        ids.add(bareOf(tab.appSessionId));
      }
    }
  }
  return held;
}

export interface RemoteInterestDeps {
  layout: Pick<LayoutFileStore, 'get' | 'onChange'>;
  local: MachineRef;
  /** Whether an RL2 link reaches the machine now. */
  isRemote(machine: MachineRef): boolean;
  lingerMs: number;
  open(machine: MachineRef, app: string): void;
  close(machine: MachineRef, app: string): void;
}

export interface RemoteInterest {
  /** Reads the tabs again: the roster of RL2 machines changed. */
  refresh(): void;
  stop(): void;
}

export function createRemoteInterest(deps: RemoteInterestDeps): RemoteInterest {
  const held = new Map<string, { machine: MachineRef; app: string; linger: ReturnType<typeof setTimeout> | null }>();
  let stopped = false;

  function read(): void {
    if (stopped) return;
    const now = new Set<string>();
    for (const [machine, apps] of remoteSessionsInTabs(deps.layout.get('main.tabs'), deps.local)) {
      if (!deps.isRemote(machine)) continue;
      for (const app of apps) {
        const key = `${machine}/${app}`;
        now.add(key);
        const entry = held.get(key);
        if (entry === undefined) held.set(key, { machine, app, linger: null });
        else if (entry.linger !== null) {
          clearTimeout(entry.linger);
          entry.linger = null;
        }
        deps.open(machine, app);
      }
    }
    for (const [key, entry] of held) {
      if (now.has(key)) continue;
      if (!deps.isRemote(entry.machine)) {
        if (entry.linger !== null) clearTimeout(entry.linger);
        held.delete(key);
        deps.close(entry.machine, entry.app);
      } else if (entry.linger === null) {
        entry.linger = setTimeout(() => {
          if (held.get(key) !== entry) return;
          held.delete(key);
          deps.close(entry.machine, entry.app);
        }, deps.lingerMs);
      }
    }
  }

  const off = deps.layout.onChange((key) => {
    if (key === 'main.tabs') read();
  });
  read();
  return {
    refresh: read,
    stop() {
      stopped = true;
      off();
      for (const entry of held.values()) if (entry.linger !== null) clearTimeout(entry.linger);
      held.clear();
    },
  };
}
