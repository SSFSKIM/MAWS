// The connection manager (P5 O6 M3, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "Machine links"; P5 §3):
// main reaches every machine through one link per machine. The local machine's is in-process (local-link.ts, main's own
// services through the router's local path); every other profile's machine on this Mac is reached over that profile's
// `mawsd` (socket-link.ts; P5 O3-D M6: the directory configured is the profile's). The links O7 and O10 add (RL2
// channels) plug in here the same way.
//
// - The router hands it every command whose target is another machine (`RouterOptions.remote`); a machine that is not
//   `up`, or not known, answers `host_unavailable` at once.
// - A link's events reach the windows with that link's machine (`emitFrom`), heard by none of main's own services.
// - `machines.list` and `machines.changed` (main-owned, graded `client`) report every machine with its state: the local
//   one first, always `up`, then each known machine. Every `up` of another machine is a new generation (+1 per welcome,
//   counted by its ref whichever directory carries it, never reset within the run), announced before any event of the new
//   connection is relayed (M4 resets that machine's counters on it).
// - Known machines persist (known-machines.ts): an entry of a configured directory is listed `connecting` from launch,
//   before its link is up, so a relaunch with that machine down keeps its tabs (acceptance 7); an entry whose directory is
//   no longer configured is dropped at launch. A directory whose far side answers another ref than the one known for it
//   now holds another profile: that is logged and adopted. A remembered ref is a hint: a directory answering it live takes
//   it over from one that is not up; only a machine another directory reaches while up is refused.
// - RL2 machines (P5 O7 M1, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Interfaces §C) come from a second
//   source: the org session's roster (remote/source.ts). Their entries are keyed by ref from creation, listed
//   `connecting` until their link first answers, closed and dropped when the roster drops them, renamed when the head
//   renames them; `known-machines.json` stays the socket links' file. One link up per ref spans both kinds: a link that
//   comes `up` while another entry already reaches its ref `up` is closed.
import type { AppSessionId } from '@shared/graph/ids';
import type { ClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName, CommandResult, EventName, EventPayload } from '@shared/ipc/schema';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { MachineRef } from '@shared/machine/ref';
import type { MainContext } from '../ipc/router';
import { readKnownMachines, writeKnownMachines, type KnownMachine } from './known-machines';
import type { RemoteSource } from './remote/source';

export type LinkState = 'connecting' | 'up' | 'down';

export interface MachineLink {
  readonly machine: MachineRef | null; // null until its identity is known
  readonly name: string | null; // the far machine's display name, with its identity
  state(): LinkState;
  // P5 O7 M4: `session`, the session a path-class command was made from (MainContext.session), for a link whose machine
  // bounds a path read by its session (an RL2 link's `call.session`); a socket link's machine reads the asker's ref instead.
  dispatch(name: CommandName, input: unknown, client: ClientRef, session?: AppSessionId): Promise<CommandResult<CommandName>>;
  onState(listener: (state: LinkState) => void): () => void;
  onEvent(listener: (name: EventName, payload: unknown) => void): () => void;
  close(): void; // stops reconnecting; never stops the far side
}

export interface ConnectionManager {
  local: MachineRef;
  dispatch(machine: MachineRef, name: CommandName, input: unknown, ctx: MainContext): Promise<CommandResult<CommandName>>; // host_unavailable when not up
  list(): MachineState[];
  onChanged(listener: (machines: MachineState[]) => void): () => void;
  close(): void; // every link stops; no far side is stopped
}

export interface ConnectionManagerDeps {
  local: MachineRef;
  localName: string;
  localLink: MachineLink;
  knownMachinesFile: string;
  configured: string[]; // the profile directories this app links to (config.ts)
  emitFrom: <N extends EventName>(machine: MachineRef, name: N, payload: EventPayload<N>) => boolean;
  connect(dir: string): MachineLink; // a socket link to the profile `dir`'s mawsd (socket-link.ts); a test's fake otherwise
  remote?: RemoteSource; // the RL2 machines (P5 O7 M1)
  log(line: string): void;
}

/** What a link of the second source says beyond its state: its carrier and its permanent refusal (remote/link.ts). */
type Described = MachineLink & { carrier?(): string | null; refusal?(): string | null };

// One configured directory, or one RL2 machine (`dir` null): its link, and what the manager knows of the machine behind it.
interface Entry {
  dir: string | null;
  link: Described;
  ref: MachineRef | null; // known from the file or learned from the link; null until either says
  name: string;
  state: LinkState;
  since: string;
}

export function createConnectionManager(deps: ConnectionManagerDeps): ConnectionManager {
  const { local, localName, localLink, knownMachinesFile, log } = deps;
  const started = new Date().toISOString();
  const listeners = new Set<(machines: MachineState[]) => void>();
  const configured = new Set(deps.configured);

  const known = readKnownMachines(knownMachinesFile, log);
  const kept = known.filter((machine) => configured.has(machine.carrier.dir) && machine.ref !== local);
  if (kept.length !== known.length) {
    log(`forgot ${known.length - kept.length} known machines whose directory is no longer configured`);
    persist(kept);
  }
  const knownByDir = new Map(kept.map((machine) => [machine.carrier.dir, machine]));
  const entries: Entry[] = [];
  // Each machine's welcomes this run, by its ref and never reset, so a machine that comes back through another directory is
  // still a new generation (M4 resets that machine's counters on one).
  const generations = new Map<MachineRef, number>();

  // Every ref once: the entry that is up, else the first (a socket entry before an RL2 one).
  function listed(): Entry[] {
    const byRef = new Map<MachineRef, Entry>();
    for (const entry of [...entries, ...remoteEntries.values()]) {
      if (entry.ref === null) continue;
      const held = byRef.get(entry.ref);
      if (held === undefined || (held.state !== 'up' && entry.state === 'up')) byRef.set(entry.ref, entry);
    }
    return [...byRef.values()];
  }

  function list(): MachineState[] {
    const machines: MachineState[] = [{ ref: local, name: localName, local: true, state: 'up', since: started, generation: 0 }];
    for (const entry of listed()) {
      const carrier = entry.state !== 'up' ? undefined : entry.dir !== null ? 'socket' : (entry.link.carrier?.() ?? undefined);
      const refusal = entry.dir === null ? (entry.link.refusal?.() ?? undefined) : undefined;
      machines.push({
        ref: entry.ref!,
        name: entry.name,
        local: false,
        state: entry.state,
        since: entry.since,
        generation: generations.get(entry.ref!) ?? 0,
        ...(carrier === undefined ? {} : { carrier: carrier as 'socket' | 'direct' | 'relay' }),
        ...(refusal === undefined ? {} : { refusal }),
      });
    }
    return machines;
  }

  function changed(): void {
    const machines = list();
    for (const listener of [...listeners]) listener(machines);
  }

  function persist(machines: KnownMachine[]): void {
    try {
      writeKnownMachines(knownMachinesFile, machines);
    } catch (error) {
      log(`could not write ${knownMachinesFile}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const knownNow = (): KnownMachine[] =>
    entries.flatMap((entry) => (entry.ref === null || entry.dir === null ? [] : [{ ref: entry.ref, name: entry.name, carrier: { kind: 'socket' as const, dir: entry.dir } }]));
  // The RL2 entries, by ref.
  const remoteEntries = new Map<MachineRef, Entry>();
  const upElsewhere = (entry: Entry, ref: MachineRef) => [...entries, ...remoteEntries.values()].find((other) => other !== entry && other.ref === ref && other.state === 'up');

  // The link said who it reaches: adopt it, unless it is this machine or one another directory reaches while up. A ref
  // remembered for another directory is a hint, not a claim: a directory that answers it live takes it over from an entry
  // that is not up, which is kept, with no ref, until its own link identifies (whatever it then holds).
  function learned(entry: Entry): boolean {
    const { machine: ref, name } = entry.link;
    if (ref === null) return false;
    const holder = entries.find((other) => other !== entry && other.ref === ref);
    const reaching = ref === local ? undefined : upElsewhere(entry, ref);
    if (ref === local || reaching !== undefined) {
      log(`${entry.dir} serves machine ${ref}, which ${ref === local ? 'is this one' : `${reaching!.dir ?? 'an RL2 link'} already reaches`}; closing that link`);
      entry.link.close();
      return false;
    }
    if (holder) {
      log(`${entry.dir} now reaches machine ${ref}, remembered at ${holder.dir}, which is ${holder.state}; ${holder.dir} is kept with no machine until it answers`);
      holder.ref = null;
      holder.name = holder.dir ?? holder.name;
    }
    if (entry.ref !== null && entry.ref !== ref) log(`${entry.dir} now serves machine ${ref} (it served ${entry.ref}): the directory holds another profile`);
    const differs = holder !== undefined || entry.ref !== ref || entry.name !== (name ?? entry.name);
    entry.ref = ref;
    entry.name = name ?? entry.name;
    if (differs) persist(knownNow());
    return true;
  }

  for (const dir of configured) {
    const remembered = knownByDir.get(dir);
    const link = deps.connect(dir);
    const entry: Entry = { dir, link, ref: remembered?.ref ?? null, name: remembered?.name ?? dir, state: 'connecting', since: started };
    entries.push(entry);
    link.onState((state) => {
      if (state === 'up' && !learned(entry)) return;
      if (state === entry.state) return;
      entry.state = state;
      entry.since = new Date().toISOString();
      if (state === 'up') generations.set(entry.ref!, (generations.get(entry.ref!) ?? 0) + 1); // learned() set the ref
      changed();
    });
    link.onEvent((name, payload) => {
      if (entry.ref !== null && entry.state === 'up') deps.emitFrom(entry.ref, name, payload as never);
    });
  }

  // ---- The second source: RL2 machines -------------------------------------------------------------------------------

  const remote = deps.remote;
  function reconcile(): void {
    if (remote === undefined || closed) return;
    const roster = remote.machines();
    let differs = false;
    for (const [ref, entry] of remoteEntries) {
      if (roster.some((machine) => machine.ref === ref)) continue;
      remoteEntries.delete(ref);
      entry.link.close();
      differs = true;
    }
    for (const machine of roster) {
      const held = remoteEntries.get(machine.ref);
      if (held !== undefined) {
        if (held.name !== machine.name) {
          held.name = machine.name;
          differs = true;
        }
        continue;
      }
      if (machine.ref === local) continue;
      const link = remote.connect(machine) as Described;
      const entry: Entry = { dir: null, link, ref: machine.ref, name: machine.name, state: 'connecting', since: new Date().toISOString() };
      remoteEntries.set(machine.ref, entry);
      differs = true;
      let described = '';
      link.onState((state) => {
        if (remoteEntries.get(machine.ref) !== entry) return;
        if (state === 'up' && entry.state !== 'up' && upElsewhere(entry, machine.ref) !== undefined) {
          log(`an RL2 link reached machine ${machine.ref}, which another link already reaches; closing the RL2 link`);
          return link.close();
        }
        const now = `${link.carrier?.() ?? ''}|${link.refusal?.() ?? ''}`;
        if (state === entry.state && now === described) return;
        described = now;
        if (state !== entry.state) {
          entry.state = state;
          entry.since = new Date().toISOString();
          if (state === 'up') generations.set(machine.ref, (generations.get(machine.ref) ?? 0) + 1);
        }
        changed();
      });
      link.onEvent((name, payload) => {
        if (remoteEntries.get(machine.ref) === entry && entry.state === 'up') deps.emitFrom(machine.ref, name, payload as never);
      });
    }
    if (differs) changed();
  }
  let closed = false;
  const unsubscribeRemote = remote?.onChanged(reconcile);
  reconcile();

  return {
    local,
    async dispatch(machine, name, input, ctx) {
      if (machine === local) return localLink.dispatch(name, input, ctx.client);
      const entry = [...entries, ...remoteEntries.values()].find((candidate) => candidate.ref === machine && candidate.state === 'up');
      if (!entry) return { ok: false, error: ipcError('host_unavailable', `${name}: machine ${machine} is not connected`) };
      return entry.link.dispatch(name, input, ctx.client, ctx.session);
    },
    list,
    onChanged(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close() {
      closed = true;
      unsubscribeRemote?.();
      for (const entry of entries) entry.link.close();
      for (const entry of remoteEntries.values()) entry.link.close();
    },
  };
}
