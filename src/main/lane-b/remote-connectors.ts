// O4's surfaces on another machine, main's half (P5 O7 M5c, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "O4's
// surfaces: the grade", "O4's surfaces: leases, the window, delivery on the machine", "Consent and the client port"):
// remote lane B's connectors and Send to, reached by the router through `routeLaneB` for the names ./remote.ts's
// `handles` takes.
//
// - A page's lease is its channel's: the endpoint keeps each lease per channel, and a channel's end ends its ref, which
//   closes every lease of it on the machine. So a lease command goes only on a channel that opened its machine's gate,
//   and never to another: the six lease reads (`MACHINE_CALLS`) as calls and the two that run the owner's connector tools
//   (`connectors.call`, `refresh`) as `machine` acts, each `oneChannel` (one in flight at a channel's end fails
//   `host_unavailable` and is never carried over). From a channel's end until its machine's reset every lease command is
//   refused `host_unavailable` here at once, nothing queued and nothing sent.
// - The reset. Each channel of a machine (its first included) opens that machine's gate once the machine holds the
//   device's window report there (./remote-windows.ts), and in the same synchronous step main tells its windows
//   `connectors.reset {machine}` as its own word (`emitOwn`, never `emitFrom`), so the renderer's connectors client
//   rebuilds that machine's leases, declarations, visibility and watches under new ids, and nothing a page sends before the
//   word reaches the new channel.
// - Every lease command runs under the device's window report (./remote-windows.ts), made before it when the machine
//   doesn't hold the latest.
// - Connect, Reconnect and Sign in carry a listener for their consent's redirect (./remote-port.ts).
// - `delivery.send` runs on the machine, its export and its delivery both (O5's `RenderService.exportForLibrary`, then
//   `deliver`): answered at its outcome within the command's own budget on the machine past the pending bound.
import type { ClientRef } from '@shared/ipc/client';
import { ipcError, type IpcErrorCode } from '@shared/ipc/errors';
import type { CommandName, CommandResult, EventPayload } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { LEASE_COMMANDS } from '../connectors/windows';
import { budgetedMs } from '../machines/budgets';
import { callOverLink } from '../machines/remote/dispatch';
import type { ActHandle, RemoteLink } from '../machines/remote/link';
import { CONSENT_COMMANDS, type RemotePort } from './remote-port';
import type { RemoteWindows, WindowReport } from './remote-windows';

/**
 * The calls whose row grade the endpoint reads otherwise than the registry's, sent through `link.call` by name
 * (`callOverLink`), since `dispatchOverLink` refuses every grade but a plain `list` or `view`: the six lease reads, graded
 * by effect on the artifact (`view`), which §L offers as calls (a by-effect command crosses as a call only when it is
 * here); and (P5 O7 M9) the remote setup's folder list and trust read, graded `spawn` in the registry and offered to the
 * machine's owners at `list` (./remote.ts sends them).
 */
export const MACHINE_CALLS: ReadonlySet<CommandName> = new Set<CommandName>(['connectors.open', 'connectors.declare', 'connectors.watch', 'connectors.unwatch', 'connectors.visibility', 'connectors.close', 'machine.folders.list', 'session.trust.check']);
const LEASES: ReadonlySet<CommandName> = new Set<CommandName>(LEASE_COMMANDS);

/** Options of the adapter's `machine` act (./remote.ts). */
export type MachineActOptions = { oneChannel?: true; answerMs?: number; onHandle?(handle: ActHandle): void };

export interface RemoteConnectorsDeps {
  remote(machine: MachineRef): RemoteLink | null;
  onRemote(listener: (machines: readonly MachineRef[]) => void): () => void;
  /** main's own `emit`, to every window. */
  emitOwn(name: 'connectors.reset', payload: EventPayload<'connectors.reset'>): void;
  windows: RemoteWindows;
  port: RemotePort;
  /** The adapter's `machine` act, answered at its outcome or at the pending bound (`answerMs` past it). */
  act(link: RemoteLink, name: CommandName, fields: Record<string, unknown>, options?: MachineActOptions): Promise<CommandResult<CommandName>>;
  log(line: string): void;
}

export interface RemoteConnectors {
  handles(name: CommandName): boolean;
  dispatch(link: RemoteLink, name: CommandName, fields: Record<string, unknown>, client: ClientRef | undefined): Promise<CommandResult<CommandName>>;
  /** Whether `machine`'s gate stands open on its current channel (tests). */
  open(machine: MachineRef): boolean;
  stop(): void;
}

/** P5 O7 M5c (the review's finding 3): a lease let go here (its page ended) closed on the current channel. */
export function closeLease(link: RemoteLink, leaseId: string, log: (line: string) => void): void {
  void callOverLink(link, 'connectors.close', { leaseId }, { oneChannel: true }).then((closed) => {
    if (!closed.ok) log(`lane B: the lease ${leaseId} on ${link.name} of a page that ended was not closed: ${closed.error.code}`);
  });
}

/** `client.windowShown` on the current channel, as the windows read its answer. */
export async function reportWindow(link: RemoteLink, shown: boolean): Promise<WindowReport> {
  const answered = await link.call('client.windowShown', { shown }, { oneChannel: true });
  if (answered.ok) return 'taken';
  return answered.error.code === 'not-offered' ? 'not-offered' : 'failed';
}

type Gate = {
  link: RemoteLink;
  /** The channel (its peer list) whose reset was said: lease commands go on it alone. */
  openOn: readonly string[] | null;
  /** The channel whose report is being taken before its reset. */
  opening: readonly string[] | null;
  off(): void;
};

const failure = (code: IpcErrorCode, message: string, issues?: unknown): CommandResult<CommandName> => ({ ok: false, error: ipcError(code, message, issues) });
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const rebuilding = (name: string, machine: string) => `${name}: the connection to ${machine} is being made again; its dashboards rebuild once it is`;

export function createRemoteConnectors(deps: RemoteConnectorsDeps): RemoteConnectors {
  const gates = new Map<MachineRef, Gate>();
  let stopped = false;

  const isOpen = (gate: Gate) => gate.openOn !== null && gate.link.peerCapabilities() === gate.openOn;

  /** A channel the gate hasn't opened on: its report taken, then its reset said and the gate opened in one step. */
  function moved(gate: Gate): void {
    const on = gate.link.peerCapabilities();
    if (stopped || gates.get(gate.link.machine) !== gate || on === null || on === gate.openOn || on === gate.opening) return;
    gate.opening = on;
    void deps.windows.relinked(gate.link).then(() => {
      if (stopped || gates.get(gate.link.machine) !== gate || gate.opening !== on || gate.link.peerCapabilities() !== on) return;
      gate.opening = null;
      gate.openOn = on;
      deps.emitOwn('connectors.reset', { machine: gate.link.machine });
    });
  }

  function gateOf(link: RemoteLink): Gate {
    const held = gates.get(link.machine);
    if (held !== undefined && held.link === link) return held;
    held?.off();
    const gate: Gate = { link, openOn: null, opening: null, off: () => {} };
    gates.set(link.machine, gate);
    const offs = [link.onState(() => moved(gate)), link.onCaps(() => moved(gate))];
    gate.off = () => offs.forEach((off) => off());
    moved(gate);
    return gate;
  }

  const offRemote = deps.onRemote((machines) => {
    for (const [machine, gate] of [...gates]) {
      if (machines.includes(machine) && deps.remote(machine) === gate.link) continue;
      gate.off();
      gates.delete(machine);
      deps.windows.forget(machine);
    }
    for (const machine of machines) {
      const link = deps.remote(machine);
      if (link !== null) gateOf(link);
    }
  });

  async function lease(link: RemoteLink, name: CommandName, fields: Record<string, unknown>, client: ClientRef | undefined): Promise<CommandResult<CommandName>> {
    if (client === undefined) return failure('internal', `${name}: a lease is a page’s, and no page asked`);
    const gate = gateOf(link);
    if (!isOpen(gate)) return failure('host_unavailable', rebuilding(name, link.name));
    let leaseId: string | null = name === 'connectors.close' && typeof fields.leaseId === 'string' ? fields.leaseId : null;
    const on = gate.openOn!; // the channel the command is made on: it goes on this one or not at all
    const { ok: reported, ticket } = await deps.windows.before(link, client, name, on);
    try {
      // decided again after the wait: the channel may have ended (or been replaced) meanwhile, and the command goes in
      // this same step
      if (!isOpen(gate) || gate.openOn !== on) return failure('host_unavailable', rebuilding(name, link.name));
      if (!reported) return failure('host_unavailable', `${name}: ${link.name} has not taken this window’s report`);
      const result = MACHINE_CALLS.has(name) ? await callOverLink(link, name, fields, { oneChannel: true }) : await deps.act(link, name, fields, { oneChannel: true, ...answerMs(link, name) });
      const opened: unknown = result.ok ? result.value : null;
      if (name === 'connectors.open' && isObject(opened) && typeof opened.leaseId === 'string') leaseId = opened.leaseId;
      return result;
    } finally {
      deps.windows.after(ticket, name, leaseId);
    }
  }

  /** The command's own budget on the machine, past the pending bound, for one whose work outlasts it. */
  const answerMs = (link: RemoteLink, name: CommandName): Pick<MachineActOptions, 'answerMs'> => {
    const budget = budgetedMs(link.budgets, name);
    return budget === undefined ? {} : { answerMs: budget };
  };

  return {
    handles: (name) => LEASES.has(name) || CONSENT_COMMANDS.has(name) || name === 'delivery.send',
    dispatch(link, name, fields, client) {
      if (LEASES.has(name)) return lease(link, name, fields, client);
      if (CONSENT_COMMANDS.has(name)) return deps.port.consent(link, name, fields, (withCallback, onHandle) => deps.act(link, name, withCallback, { onHandle }));
      return deps.act(link, name, fields, answerMs(link, name)); // delivery.send
    },
    open: (machine) => {
      const gate = gates.get(machine);
      return gate !== undefined && isOpen(gate);
    },
    stop() {
      stopped = true;
      offRemote();
      for (const gate of gates.values()) gate.off();
      gates.clear();
    },
  };
}
