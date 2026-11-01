// The browser's sessions on another machine (P5 O7 M3, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "Forwarding"; its Decision Log on the in-app browser for a remote session). The in-app browser is this Mac's own
// surface: a remote session's panel holds local tabs, as the forward's listener is local. The router answers the Browser
// tool's commands for such a session here (src/main/ipc/router.ts, `BROWSER_TOOL_HERE_FOR_ANY_MACHINE`), with the bare id
// its address lowered to and the machine as `ctx.target`; the tab store keeps the bare id.
//
// What this keeps is the other half of the address: each session of another machine that has tabs here, by its bare id,
// with its machine. Noted at each such command, kept in tabs.json (`machines`) so a relaunch keeps the session's tabs (the
// spine knows no other machine's session), and read where the address is said again:
// - every browser event naming such a session goes to the windows from its machine (`emitFrom`), so the renderer's
//   per-address stores take it under the session's address;
// - `browser.tabs.list` for this machine (the boot's list of every session) leaves them out, since its answer is lifted
//   with this machine; each is listed when its own surface mounts, for its machine.
import type { AppSessionId } from '@shared/graph/ids';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import type { BrowserEmit } from './tabs';

export type EmitFrom = <N extends EventName>(machine: MachineRef, name: N, payload: EventPayload<N>) => unknown;

export class SessionMachines {
  readonly #machines = new Map<string, MachineRef>();

  constructor(
    readonly local: MachineRef,
    restored: Readonly<Record<string, MachineRef>> = {},
    private readonly changed: () => void = () => {},
  ) {
    for (const [appSessionId, machine] of Object.entries(restored)) if (machine !== local) this.#machines.set(appSessionId, machine);
  }

  /** A command of the Browser tool named the session for `machine` (the router's `ctx.target`). */
  note(appSessionId: AppSessionId, machine: MachineRef): void {
    if (this.#machines.get(appSessionId) === (machine === this.local ? undefined : machine)) return;
    if (machine === this.local) this.#machines.delete(appSessionId);
    else this.#machines.set(appSessionId, machine);
    this.changed();
  }

  of(appSessionId: string): MachineRef {
    return this.#machines.get(appSessionId) ?? this.local;
  }

  /** What tabs.json keeps: the sessions of another machine among those with tabs kept; nothing when there are none. */
  kept(sessions: Iterable<string>): { machines?: Record<AppSessionId, MachineRef> } {
    const machines: Record<AppSessionId, MachineRef> = {};
    for (const appSessionId of sessions) {
      const machine = this.#machines.get(appSessionId);
      if (machine !== undefined) machines[appSessionId as AppSessionId] = machine;
    }
    return Object.keys(machines).length === 0 ? {} : { machines };
  }

  /** `emit`, but an event naming a session of another machine goes from that machine. */
  stamped(emit: BrowserEmit, emitFrom: EmitFrom): BrowserEmit {
    return (name, payload) => {
      const appSessionId = (payload as { appSessionId?: unknown }).appSessionId;
      const machine = typeof appSessionId === 'string' ? this.#machines.get(appSessionId) : undefined;
      return machine === undefined ? emit(name, payload) : emitFrom(machine, name, payload);
    };
  }
}
