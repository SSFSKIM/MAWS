// The connection manager (P5 O6 M3, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "Machine links"; P5 §3):
// main reaches every machine through one link per machine. The local machine's is in-process (local-link.ts, main's own
// services through the router's local path); every other profile's machine on this Mac is reached over its serve
// directory's socket (socket-link.ts). The links O7 and O10 add (RL2 channels) plug in here the same way.
//
// - The router hands it every command whose target is another machine (`RouterOptions.remote`); a machine that is not
//   `up`, or not known, answers `host_unavailable` at once.
// - A link's events reach the windows with that link's machine (`emitFrom`), heard by none of main's own services.
// - `machines.list` and `machines.changed` (main-owned, graded `client`) report every machine with its state: the local
//   one first, always `up`, then each known machine. Every `up` of another machine's link is a new generation (+1 per
//   welcome), announced before any event of the new connection is relayed (M4 resets that machine's counters on it).
// - Known machines persist (known-machines.ts): an entry of a configured directory is listed `connecting` from launch,
//   before its link is up, so a relaunch with that machine down keeps its tabs (acceptance 7); an entry whose directory is
//   no longer configured is dropped at launch. A directory whose far side answers another ref than the one known for it
//   now holds another profile: that is logged and adopted. A remembered ref is a hint: a directory answering it live takes
//   it over from one that is not up; only a machine another directory reaches while up is refused.
import type { ClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName, CommandResult, EventName, EventPayload } from '@shared/ipc/schema';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { MachineRef } from '@shared/machine/ref';
import type { MainContext } from '../ipc/router';
import { readKnownMachines, writeKnownMachines, type KnownMachine } from './known-machines';

export type LinkState = 'connecting' | 'up' | 'down';

export interface MachineLink {
  readonly machine: MachineRef | null; // null until its identity is known
  readonly name: string | null; // the far machine's display name, with its identity
  state(): LinkState;
  dispatch(name: CommandName, input: unknown, client: ClientRef): Promise<CommandResult<CommandName>>;
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
  configured: string[]; // the serve directories this app links to (config.ts)
  emitFrom: <N extends EventName>(machine: MachineRef, name: N, payload: EventPayload<N>) => boolean;
  connect(dir: string): MachineLink; // a socket link to `dir` (socket-link.ts); a test's fake otherwise
  log(line: string): void;
}

// One configured directory: its link, and what the manager knows of the machine behind it.
interface Entry {
  dir: string;
  link: MachineLink;
  ref: MachineRef | null; // known from the file or learned from the link; null until either says
  name: string;
  state: LinkState;
  since: string;
  generation: number;
}

export function createConnectionManager(deps: ConnectionManagerDeps): ConnectionManager {
  const { local, localName, localLink, knownMachinesFile, log } = deps;
  const started = new Date().toISOString();
  const listeners = new Set<(machines: MachineState[]) => void>();
  const configured = new Set(deps.configured);

  const known = readKnownMachines(knownMachinesFile, log);
  const kept = known.filter((machine) => configured.has(machine.carrier.dir) && machine.ref !== local);
  if (kept.length !== known.length) {
    log(`forgot ${known.length - kept.length} known machines whose serve directory is no longer configured`);
    persist(kept);
  }
  const knownByDir = new Map(kept.map((machine) => [machine.carrier.dir, machine]));
  const entries: Entry[] = [];

  function list(): MachineState[] {
    const machines: MachineState[] = [{ ref: local, name: localName, local: true, state: 'up', since: started, generation: 0 }];
    for (const entry of entries) {
      if (entry.ref !== null) machines.push({ ref: entry.ref, name: entry.name, local: false, state: entry.state, since: entry.since, generation: entry.generation });
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
    entries.flatMap((entry) => (entry.ref === null ? [] : [{ ref: entry.ref, name: entry.name, carrier: { kind: 'socket' as const, dir: entry.dir } }]));

  // The link said who it reaches: adopt it, unless it is this machine or one another directory reaches while up. A ref
  // remembered for another directory is a hint, not a claim: a directory that answers it live takes it over from an entry
  // that is not up, which is kept, with no ref, until its own link identifies (whatever it then holds).
  function learned(entry: Entry): boolean {
    const { machine: ref, name } = entry.link;
    if (ref === null) return false;
    const holder = entries.find((other) => other !== entry && other.ref === ref);
    if (ref === local || holder?.state === 'up') {
      log(`${entry.dir} serves machine ${ref}, which ${ref === local ? 'is this one' : `${holder!.dir} already reaches`}; closing that link`);
      entry.link.close();
      return false;
    }
    if (holder) {
      log(`${entry.dir} now reaches machine ${ref}, remembered at ${holder.dir}, which is ${holder.state}; ${holder.dir} is kept with no machine until it answers`);
      holder.ref = null;
      holder.name = holder.dir;
      holder.generation = 0;
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
    const entry: Entry = { dir, link, ref: remembered?.ref ?? null, name: remembered?.name ?? dir, state: 'connecting', since: started, generation: 0 };
    entries.push(entry);
    link.onState((state) => {
      if (state === 'up' && !learned(entry)) return;
      if (state === entry.state) return;
      entry.state = state;
      entry.since = new Date().toISOString();
      if (state === 'up') entry.generation += 1;
      changed();
    });
    link.onEvent((name, payload) => {
      if (entry.ref !== null && entry.state === 'up') deps.emitFrom(entry.ref, name, payload as never);
    });
  }

  return {
    local,
    async dispatch(machine, name, input, ctx) {
      if (machine === local) return localLink.dispatch(name, input, ctx.client);
      const entry = entries.find((candidate) => candidate.ref === machine);
      if (!entry || entry.state !== 'up') return { ok: false, error: ipcError('host_unavailable', `${name}: machine ${machine} is not connected`) };
      return entry.link.dispatch(name, input, ctx.client);
    },
    list,
    onChanged(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close() {
      for (const entry of entries) entry.link.close();
    },
  };
}
