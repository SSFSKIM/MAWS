// The browser's sessions on another machine (P5 O7 M3, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "Forwarding"; its Decision Log on the in-app browser for a remote session). The in-app browser is this Mac's own
// surface: a remote session's panel holds local tabs, as the forward's listener is local. The router answers the Browser
// tool's commands for such a session here (src/main/ipc/router.ts, `BROWSER_TOOL_HERE_FOR_ANY_MACHINE`), with the bare id
// its address lowered to and the machine as `ctx.target`.
//
// A session is its full address: a bare id is its machine's to mint, and two machines may name the same one. So the
// browser keys its sessions (the tab store's `appSessionId`, its selection, tabs.json) by a session key: this machine's
// session by its bare id, as always (its tabs, the spine's record removal and the agent's reach unchanged), another
// machine's by its address (`addressOf(machine, bare)`), registered here with its machine and bare id. Each key's machine
// is fixed by the key itself: no command moves a session to another machine.
//
// Where the key leaves main it becomes the bare id again, said for its machine:
// - every browser event naming such a session goes to the windows from its machine (`emitFrom`), every place it names
//   the key (a field's value or a record's key, at any depth: a tab's `appSessionId` wherever the tab sits) said by the
//   bare id, so the renderer lifts them to the session's address; comment mode's pick likewise (comment/mode.ts, `away`).
//   An event naming sessions of two machines can't be said from one, and is not sent;
// - the handlers' answers (`browser.tabs.list`, `.open`) carry the bare id, lifted with the invoke's machine
//   (register.ts); a list of every session is the invoke machine's sessions only.
// tabs.json keeps the keys, and `machines` each remote key's machine, so a relaunch keeps the session's tabs (the spine
// knows no other machine's session).
import type { AppSessionId } from '@shared/graph/ids';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { addressOf, bareOf, isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import type { BrowserEmit } from './tabs';

export type EmitFrom = <N extends EventName>(machine: MachineRef, name: N, payload: EventPayload<N>) => unknown;
/** A remote session key's machine and the bare id its machine names it by. */
export type AwaySession = { machine: MachineRef; bare: AppSessionId };

export class SessionMachines {
  readonly #away = new Map<string, AwaySession>();

  constructor(
    readonly local: MachineRef,
    restored: Readonly<Record<string, MachineRef>> = {},
  ) {
    for (const [key, machine] of Object.entries(restored)) {
      if (machine !== local && isAddress(key) && machineOf(key) === machine) this.#away.set(key, { machine, bare: bareOf(key as AppSessionId) });
    }
  }

  /** The session key of `bare` on `machine` (the router's `ctx.target`): the bare id for this machine's. */
  keyOf(bare: AppSessionId, machine: MachineRef): AppSessionId {
    if (machine === this.local) return bare;
    const key = addressOf(machine, bare);
    if (!this.#away.has(key)) this.#away.set(key, { machine, bare });
    return key;
  }

  /** The machine and bare id of another machine's session key; null for this machine's. */
  away(key: string): AwaySession | null {
    return this.#away.get(key) ?? null;
  }

  machineOf(key: string): MachineRef {
    return this.#away.get(key)?.machine ?? this.local;
  }

  /** The id the key is said by on its machine. */
  bareOf(key: string): AppSessionId {
    return this.#away.get(key)?.bare ?? (key as AppSessionId);
  }

  /** What tabs.json keeps: the remote keys among those with tabs kept, with their machines; nothing when there are none. */
  kept(keys: Iterable<string>): { machines?: Record<AppSessionId, MachineRef> } {
    const machines: Record<AppSessionId, MachineRef> = {};
    for (const key of keys) {
      const away = this.#away.get(key);
      if (away !== undefined) machines[key as AppSessionId] = away.machine;
    }
    return Object.keys(machines).length === 0 ? {} : { machines };
  }

  /**
   * `emit`, but an event naming another machine's session goes from that machine, every mention of the session's key
   * (a value or a record's key, at any depth) said by its bare id.
   */
  stamped(emit: BrowserEmit, emitFrom: EmitFrom): BrowserEmit {
    return (name, payload) => {
      if (this.#away.size === 0) return emit(name, payload);
      const named = new Set<MachineRef>();
      const said = this.#said(payload, named);
      if (named.size === 0) return emit(name, payload);
      if (named.size > 1) {
        console.error(`[browser] ${name} names sessions of ${[...named].join(' and ')}: not sent`);
        return false;
      }
      return emitFrom([...named][0]!, name, said as typeof payload);
    };
  }

  /** `value` with each remote key it holds said by its bare id, the machines it named added to `named`. */
  #said(value: unknown, named: Set<MachineRef>): unknown {
    if (typeof value === 'string') {
      const away = this.#away.get(value);
      if (away === undefined) return value;
      named.add(away.machine);
      return away.bare;
    }
    if (Array.isArray(value)) return value.map((item) => this.#said(item, named));
    if (value === null || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [this.#said(key, named) as string, this.#said(item, named)]));
  }
}
