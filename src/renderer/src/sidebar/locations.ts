// A registry project's locations as the sidebar says them (docs/doperpowers/plans/2026-11-10-project-registry.md,
// Interfaces §J.3; design §6, §10): pure, so the words are testable without React.
//
// - A location's state, the first that holds: its machine off (`offline` on the row's line, and in the card since the
//   machine was last seen: main's `seen`, else when its link went down), its folder not there (`missing`), another folder at its path (`replaced`).
// - A suggestion (§J.3, design §2: nothing links unasked) is a line with one button, which sends `link` with the project
//   it names; none for a replaced location, nor where the member may not act on the machine. "Follow the file": a
//   location with a stored statement whose label is a `.smns` naming another id than its project. "Link": a minted
//   location whose observed remote derives another project of the registry (design §8's `uuid5`, which main computes
//   for the page as the location's `remoteProject`: the page has no node:crypto), whatever its clones' own files say.
import type { ProjectId } from '@shared/graph/ids';
import type { ProjectDecidedBy, ProjectOrg } from '@shared/ipc/schema/session';
import type { MachineRef } from '@shared/machine/ref';
import { formatDayTime } from '@shared/app/date-format';
import { locationAddress, type HeldRemoval, type OrgProjectLocation, type OrgProjects, type RegistryProject } from '../stores/registry';
import { REGISTRY } from './registry-copy';

export interface LocationView {
  // `offline`: the UX wave, U9 (O-39): whether its words say offline, by its link's phase; absent: whenever it is not up
  machine(ref: MachineRef): { name: string; local: boolean; up: boolean; since: string | null; offline?: boolean };
  seen: OrgProjects['seen'];
}

export type LocationState = { kind: 'offline'; words: string; card: string } | { kind: 'missing'; words: string } | { kind: 'replaced'; words: string } | null;

export interface Suggestion {
  words: string;
  button: string;
  into: string; // the project `link` names
}

export interface LocationLine {
  location: OrgProjectLocation;
  address: ProjectId;
  machine: string; // its name
  local: boolean;
  up: boolean;
  state: LocationState;
  suggestion: Suggestion | null;
}

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;
const SMNS = 'smns:';

/** When a machine was last seen, for "offline since": main's `seen` (the later of its link up and its record), else the roster's. */
export function lastSeen(view: LocationView, machine: MachineRef): string | null {
  const at = Date.parse(view.seen[machine] ?? view.machine(machine).since ?? '');
  return Number.isFinite(at) ? formatDayTime(at) : null;
}

export function locationState(location: OrgProjectLocation, view: LocationView): LocationState {
  const machine = view.machine(location.machine);
  if (machine.offline ?? !machine.up) { // the UX wave, U9 (O-39): by the link's phase, as the row's line reads it
    const since = lastSeen(view, location.machine);
    return { kind: 'offline', words: REGISTRY.offline, card: since === null ? REGISTRY.offline : REGISTRY.offlineSince(since) };
  }
  if (location.state === 'missing') return { kind: 'missing', words: REGISTRY.missing(machine.name) };
  if (location.state === 'replaced') return { kind: 'replaced', words: REGISTRY.replaced };
  return null;
}

/** The suggestion a location's files make against its stored statement (§J.3), or null. */
export function suggestionOf(location: OrgProjectLocation, project: RegistryProject, registry: OrgProjects, machine: string): Suggestion | null {
  if (!location.acts || location.state === 'replaced' || location.stated === undefined) return null;
  const nameOf = (id: string) => registry.projects.find((p) => p.id === id)?.name ?? id;
  const folder = basename(location.path);
  if (location.source === 'smns' && location.key.startsWith(SMNS)) {
    const named = location.key.slice(SMNS.length);
    if (named !== '' && named !== project.id) return { words: REGISTRY.followsFile(folder, machine, nameOf(named)), button: REGISTRY.follow, into: named };
  }
  if (location.stated === 'minted' && location.remoteProject !== undefined && location.remoteProject !== project.id) {
    const repository = registry.projects.find((p) => p.id === location.remoteProject);
    if (repository !== undefined) return { words: REGISTRY.clone(folder, machine, repository.name), button: REGISTRY.link, into: repository.id };
  }
  return null;
}

/** A project's locations in the card's order (this Mac's first, then the registry's: by machine ref, then path), each said. */
export function locationLines(project: RegistryProject, registry: OrgProjects, view: LocationView): LocationLine[] {
  const lines = project.locations.map((location): LocationLine => {
    const machine = view.machine(location.machine);
    return {
      location,
      address: locationAddress(location),
      machine: machine.name,
      local: machine.local,
      up: machine.up,
      state: locationState(location, view),
      suggestion: machine.up ? suggestionOf(location, project, registry, machine.name) : null,
    };
  });
  return [...lines.filter((l) => l.local), ...lines.filter((l) => !l.local)];
}

/**
 * The machines a row's folders are on, as its line says them, a machine that is off followed by `offline` (§J.3: the
 * card says since when); null where they are this Mac's alone (a row names no machine then, T4).
 */
export function machinesWords(machines: readonly MachineRef[], view: Pick<LocationView, 'machine'>): string | null {
  if (machines.every((m) => view.machine(m).local)) return null;
  return REGISTRY.machines(machines.map((ref) => {
    const machine = view.machine(ref);
    return (machine.offline ?? !machine.up) ? `${machine.name} ${REGISTRY.offline}` : machine.name;
  }));
}

/** A held removal's line (§J.3). */
export const pendingWords = (removal: HeldRemoval, view: Pick<LocationView, 'machine'>): string => REGISTRY.pending(view.machine(removal.machine).name);

// ---- Add project ---------------------------------------------------------------------------------------------------

/** What `session.projects.resolve` answered for the chosen folder (Interfaces §G). */
export interface Resolved {
  project: string | null;
  by: ProjectDecidedBy;
  at: string | null;
  label: ProjectOrg;
}

/** The project the folder lies inside (the rule decided at a folder above it), named as the registry names it; null otherwise. */
export function insideOf(resolved: Resolved | null, directory: string, registry: OrgProjects): string | null {
  if (resolved === null || resolved.project === null || resolved.by === 'machine' || resolved.at === null || resolved.at === directory) return null;
  const at = resolved.at.endsWith('/') ? resolved.at : `${resolved.at}/`;
  if (!directory.startsWith(at)) return null;
  return registry.projects.find((p) => p.id === resolved.project)?.name ?? resolved.label.name;
}

/**
 * The project Add project offers as its default for the folder (design §2, "Add project asks with the link as its
 * default"): a registry project with a minted location of the same remote the folder's repository derives, other than
 * the folder's own; null for none.
 */
export function defaultLinkOf(resolved: Resolved | null, registry: OrgProjects): string | null {
  if (resolved === null || resolved.label.source !== 'remote' || !resolved.label.key.startsWith('remote:')) return null;
  const remote = resolved.label.key.slice('remote:'.length);
  // design §10: a replaced location's remote is another folder's, never a source of the link (as `suggestionOf` holds)
  return registry.projects.find((p) => p.id !== resolved.project && p.hub && p.locations.some((l) => l.stated === 'minted' && l.state !== 'replaced' && l.remote === remote))?.id ?? null;
}

/** The registry projects a folder may be added to (a hub project: §G refuses another), by name. */
export function intoChoices(registry: OrgProjects): RegistryProject[] {
  return registry.projects.filter((p) => p.hub).sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
}
