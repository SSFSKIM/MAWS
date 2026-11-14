// Org projects, assembled from every machine's checkouts (P5 O6 M5, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md,
// "Assembly", "What a checkout is", "Which sessions sit under their machine's project"; OX3, P5 Decision Logs 21, 27).
// Selectors over the sessions store's projects, every machine's in one map keyed by address: each machine derived the
// org project of its own directories (`ProjectRecord.org`), and the page groups them by key.
//
// - A checkout is a project someone opened on its machine (origin `user`: not `discovered`). A discovered directory is
//   no checkout, though it has a record and a key.
// - An org project is listed when one of its checkouts, on any machine, is not hidden; it is the sidebar's row.
// - A session sits under the org project of its directory's key when that is listed, else under its machine's own
//   project (`machine:<ref>`): sessions in the home directory, `/tmp` or any folder nobody opened, and those whose
//   directory has no project at all. A session of a hidden project shows nowhere, as before.
// - A project its machine has not derived yet is a row of its own, keyed by its address until its key arrives (an
//   address is never an org key, so the layout's keys migrate when it does: `layout-model.ts`'s `rekeySets`).
//
// The project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §J.1; design §2, §6): one row
// per project id. A record's row key is main's key table's entry for its project (`org.smnsId`, or for this Mac's row
// that carries none the id main computed, `ownIds`), else its own label (`org.key`), else its address, so two labels of
// one id are one row, one label of two ids two rows, and a record with no id (signed out, not enrolled) is grouped by
// its label as before. Other machines' locations are records in the same
// map (`stores/registry.ts`). A registry project is named as main assembled it (§A), and one the member sees only
// through a session of it (no location to show) is still a row, with its sessions and no checkout. A key that is no
// row's any more finds its successor (§J.2, `successorOf`).
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord } from '@shared/ipc/schema';
import type { MachineState } from '@shared/ipc/schema/machines';
import { isAddress, machineOf } from '@shared/machine/address';
import { idKey, machineKey, type OrgKey } from '@shared/machine/org-key';
import type { MachineRef } from '@shared/machine/ref';
import { EMPTY_REGISTRY, isRegistryRecord, type OrgProjects, type RegistryProject } from './registry';
import type { ListedSession, UnstartedSession } from './sessions';

// A row's key: an org project's, a machine's own project's, or the address of a project not derived yet.
export type RowKey = OrgKey | ProjectId;

// OX3's `OrgProject`, extended with the key as its id, its kind and sminos's id (the document's Interfaces); the
// registry's project (§I) when the row is one.
export interface OrgProject {
  id: RowKey;
  name: string;
  kind: 'project' | 'machine';
  smnsId: string | null;
  checkouts: { machine: MachineRef; path: string; projectId: ProjectId }[]; // opened projects only; none for a machine project
  registry?: RegistryProject;
}

/** This device's row keys, by project id (main's key table, `OrgProjects.keys`): one to one, never changed. */
export type RowKeys = Readonly<Record<string, OrgKey>>;

// A record's label: what its machine's files derive (`org.key`), or its address while it has none.
export const labelOf = (project: ProjectRecord): RowKey => project.org?.key ?? project.id;
/**
 * A record's project id: its own (`org.smnsId`), else the one main computed for this Mac's row that carries none
 * (`OrgProjects.ownIds`: a `remote:` label, signed in and not enrolled; panel scalpel-2#1); null for none.
 */
export const projectIdOf = (project: ProjectRecord, ownIds?: Readonly<Record<ProjectId, string>>): string | null =>
  project.org?.smnsId ?? (ownIds !== undefined && Object.hasOwn(ownIds, project.id) ? ownIds[project.id] : null);
// A record's row key (§J.1): the key table's entry for its project, else its label.
export const orgKeyOf = (project: ProjectRecord, keys: RowKeys, ownIds?: Readonly<Record<ProjectId, string>>): RowKey => {
  const id = projectIdOf(project, ownIds);
  return (id !== null && Object.hasOwn(keys, id) ? keys[id] : undefined) ?? labelOf(project);
};
export const isCheckout = (project: ProjectRecord): boolean => !project.discovered;

// The name a machine goes by, as its link reports it; before any roster answers, the local machine is this Mac.
export function machineName(machines: ReadonlyMap<MachineRef, Pick<MachineState, 'name'>>, machine: MachineRef, local: MachineRef): string {
  return machines.get(machine)?.name ?? (machine === local ? 'This Mac' : machine);
}

export interface OrgIndex {
  orgs: Map<RowKey, OrgProject>; // every key some project names (machine projects are `machineProject`'s)
  projects: Map<RowKey, ProjectRecord[]>; // each key's projects on every machine, hidden and discovered ones included
  listed: Set<RowKey>; // the keys with a checkout that is not hidden, and the registry's projects with no location shown
  keyOf(project: ProjectRecord): RowKey; // a record's row key (`orgKeyOf` over the registry's keys)
  registry: OrgProjects; // what the index was built from (EMPTY_REGISTRY signed out)
  local: MachineRef; // this Mac, the machine the index was built for
}

// Local first, then by ref: the order of a key's machines, its checkouts and the machine rows (`machineRows`).
const byMachine = (local: MachineRef) => (a: MachineRef, b: MachineRef) => (a === b ? 0 : a === local ? -1 : b === local ? 1 : a < b ? -1 : 1);

export function orgIndex(all: Iterable<ProjectRecord>, local: MachineRef, registry: OrgProjects = EMPTY_REGISTRY): OrgIndex {
  const order = byMachine(local);
  const keys = registry.keys;
  const idOf = (project: ProjectRecord) => projectIdOf(project, registry.ownIds);
  const keyOf = (project: ProjectRecord) => orgKeyOf(project, keys, registry.ownIds);
  const byId = new Map(registry.projects.map((p) => [p.id, p]));
  const projects = new Map<RowKey, ProjectRecord[]>();
  for (const project of all) {
    const key = keyOf(project);
    projects.set(key, [...(projects.get(key) ?? []), project]);
  }
  const orgs = new Map<RowKey, OrgProject>();
  const listed = new Set<RowKey>();
  for (const [key, list] of projects) {
    // checkouts first, so a machine's name for the key is its checkout's when it has one
    const sorted = [...list].sort((a, b) => order(machineOf(a.id), machineOf(b.id)) || Number(isCheckout(b)) - Number(isCheckout(a)));
    const named = sorted[0];
    // the id the key table gives this key, else the first a record carries
    const ids = sorted.map(idOf);
    const smnsId = ids.find((id) => id !== null && keys[id] === key) ?? ids.find((id) => id !== null) ?? null;
    const registered = smnsId === null ? undefined : byId.get(smnsId);
    orgs.set(key, {
      id: key,
      name: registered?.name ?? named.org?.name ?? named.name,
      kind: 'project',
      smnsId,
      checkouts: sorted.filter(isCheckout).map((p) => ({ machine: machineOf(p.id), path: p.directory, projectId: p.id })),
      ...(registered !== undefined && { registry: registered }),
    });
    if (list.some((p) => isCheckout(p) && !p.hidden)) listed.add(key);
  }
  // a registry project with no location the member may see (its sessions only, design §11): a row with no checkout. One
  // whose key a record here already gives a row is listed too (panel sweep#2: a discovered record lists nothing), unless
  // its checkouts here are all hidden, hiding being the owner's word on the project.
  for (const project of registry.projects) {
    if (project.locations.length > 0) continue;
    const key = keys[project.id] ?? idKey(project.id);
    if (!orgs.has(key)) orgs.set(key, { id: key, name: project.name, kind: 'project', smnsId: project.id, checkouts: [], registry: project });
    else if ((projects.get(key) ?? []).some(isCheckout)) continue;
    listed.add(key);
  }
  return { orgs, projects, listed, keyOf, registry, local };
}

// A machine's own project, where its sessions with no checkout sit (T3: named after the machine).
export function machineProject(machine: MachineRef, name: string): OrgProject {
  return { id: machineKey(machine), name, kind: 'machine', smnsId: null, checkouts: [] };
}

// The row a session sits under (null: nowhere, its project being hidden). `alsoListed` names keys the sidebar lists
// for the moment though no checkout lists them (its project filter).
export function rowOfSession(index: OrgIndex, projects: ReadonlyMap<ProjectId, ProjectRecord>, record: SessionRecord, alsoListed?: ReadonlySet<RowKey>): RowKey | null {
  const project = record.projectId === null ? undefined : projects.get(record.projectId);
  if (project === undefined) return machineKey(machineOf(record.appId));
  if (project.hidden) return null;
  const key = index.keyOf(project);
  return index.listed.has(key) || alsoListed?.has(key) ? key : machineKey(machineOf(record.appId));
}

// P5 O8 M2 ("How a row is filed"): the row a listed session sits under: its `orgKey`'s when the index lists it; nowhere
// when that key's checkouts are all hidden (hiding is the owner's word on the project, and a remote checkout can't be
// hidden from here); else its machine's own row.
export function rowOfListed(index: OrgIndex, listed: ListedSession, alsoListed?: ReadonlySet<RowKey>): RowKey | null {
  const key = listed.orgKey;
  if (key !== null && (index.listed.has(key) || alsoListed?.has(key))) return key;
  if (key !== null && (index.projects.get(key) ?? []).some(isCheckout)) return null; // listed by none, so every checkout is hidden
  return machineKey(listed.machine);
}

// P5 O7 M2 (one row per address): the row a record at a listed address sits under: its listing's, so its row stands
// where the listed row stood, the one the person clicked. For another machine's record (a lane B session main read over
// that machine's link) the listing decides whether or not its project is known here (ticket 644): the project registry
// places that machine's locations among the projects (`registryRecords`), under the address the record names, and the
// key main gave the listing need not be that project's row's. For this Mac's record the listing decides only while its
// project is not known here. Undefined when no listing names its address, or this Mac's record has a known project:
// `rowOfSession` decides.
function rowOfListedRecord(index: OrgIndex, projects: ReadonlyMap<ProjectId, ProjectRecord>, record: SessionRecord, listed: ReadonlyMap<AppSessionId, ListedSession> | undefined, alsoListed?: ReadonlySet<RowKey>): RowKey | null | undefined {
  const listing = listed?.get(record.appId);
  if (listing === undefined) return undefined;
  if (machineOf(record.appId) === index.local && record.projectId !== null && projects.has(record.projectId)) return undefined;
  return rowOfListed(index, listing, alsoListed);
}

// The row a record sits under (null: nowhere, its project being hidden), the one answer every reader that files a
// record takes (the sidebar, a row's sessions, the resume chooser and `/resume`, a row's archived list, the channel's
// waiting): its listing's where `rowOfListedRecord` decides, else `rowOfSession`'s. `listed`: the other machines'
// listings (the sessions store's).
export function rowOfRecord(index: OrgIndex, projects: ReadonlyMap<ProjectId, ProjectRecord>, record: SessionRecord, listed: ReadonlyMap<AppSessionId, ListedSession> | undefined, alsoListed?: ReadonlySet<RowKey>): RowKey | null {
  const filed = rowOfListedRecord(index, projects, record, listed, alsoListed);
  return filed === undefined ? rowOfSession(index, projects, record, alsoListed) : filed;
}

// P5 O7 M2: the tab set a listing's session files into: its row's, or its org key's when every checkout of it is hidden
// (as a hidden project's sessions keep theirs).
const setKeyOfListed = (index: OrgIndex, listing: ListedSession): RowKey => rowOfListed(index, listing) ?? listing.orgKey ?? machineKey(listing.machine);

// The tab set a project's sessions file into (W12): its row's; a hidden project's keep its org key, which no row
// shows, as a hidden project's set was before.
export function setKeyOfProject(index: OrgIndex, project: ProjectRecord): RowKey {
  const key = index.keyOf(project);
  return project.hidden || index.listed.has(key) ? key : machineKey(machineOf(project.id));
}

// ---- memoised over the sessions store ----------------------------------------------------------------------------------

interface ProjectsHolder {
  projects: Map<ProjectId, ProjectRecord>;
  registry?: OrgProjects; // the project registry (§J.1): absent, none
}
const indexMemo = new WeakMap<Map<ProjectId, ProjectRecord>, { local: MachineRef; registry: OrgProjects; index: OrgIndex }>();

// The org index of the store's projects, the same object until they or the registry change.
export function selectOrgIndex(state: ProjectsHolder, local: MachineRef): OrgIndex {
  const registry = state.registry ?? EMPTY_REGISTRY;
  const hit = indexMemo.get(state.projects);
  if (hit && hit.local === local && hit.registry === registry) return hit.index;
  const index = orgIndex(state.projects.values(), local, registry);
  indexMemo.set(state.projects, { local, registry, index });
  return index;
}

// The set a session's tabs belong in, by its record's project, else its unstarted intent's (`intentProject`: the
// project a New chat was made in, null for none, which keeps it in the no-project set); undefined for a session not
// known now. What `connectShell` hands the layout as its `projectOf`. The project registry (panel sweep#3): a New chat
// with no project here opened in a registry project (its unstarted entry's `registry`) is in that project's row's set
// while the project is a row.
export function sessionSetKey(
  state: ProjectsHolder & { records: ReadonlyMap<AppSessionId, SessionRecord>; listed?: ReadonlyMap<AppSessionId, ListedSession>; unstarted?: ReadonlyMap<AppSessionId, Pick<UnstartedSession, 'registry'>> },
  local: MachineRef,
  appSessionId: AppSessionId,
  intentProject: () => ProjectId | null | undefined,
): RowKey | null | undefined {
  const index = selectOrgIndex(state, local);
  const record = state.records.get(appSessionId);
  const listing = state.listed?.get(appSessionId); // P5 O7 M2
  if (record) {
    const project = record.projectId === null ? undefined : state.projects.get(record.projectId);
    // P5 O7 M2: where its listing is, by `rowOfListedRecord`'s rule (another machine's record whatever its project)
    if (listing !== undefined && (project === undefined || machineOf(appSessionId) !== local)) return setKeyOfListed(index, listing);
    return project === undefined ? machineKey(machineOf(appSessionId)) : setKeyOfProject(index, project);
  }
  // P5 O7 M2: a listed lane B session's tab goes where its row is from the click, before main has read its record
  if (listing?.lane === 'B') return setKeyOfListed(index, listing);
  const intent = intentProject();
  if (intent === null) return registryRowOf(index, state.unstarted?.get(appSessionId)?.registry);
  if (intent === undefined) return intent;
  const project = state.projects.get(intent);
  return project === undefined ? intent : setKeyOfProject(index, project);
}

// The row of a registry project (its id), while it is listed; null for none.
function registryRowOf(index: OrgIndex, id: string | undefined): RowKey | null {
  if (id === undefined) return null;
  for (const org of index.orgs.values()) if (org.smnsId === id && index.listed.has(org.id)) return org.id;
  return null;
}

// The listed checkouts of a row on the machines that are up, the ones an action on the row reaches ("Remove from
// sidebar" hides each of them; a checkout on an offline machine stays, and shows the row again when it returns).
export function reachableCheckouts(index: OrgIndex, key: RowKey, up: (machine: MachineRef) => boolean): ProjectRecord[] {
  return (index.projects.get(key) ?? []).filter((p) => isCheckout(p) && !p.hidden && up(machineOf(p.id)));
}

// The machine a machine's own row stands for (`machine:<ref>`); null for an org project's row.
const MACHINE_ROW = 'machine:';
export const machineOfRow = (key: string): MachineRef | null => (key.startsWith(MACHINE_ROW) ? (key.slice(MACHINE_ROW.length) as MachineRef) : null);

// A row's name: a machine's own row is its machine's (T3), an org project's row its org project's.
export function rowName(index: OrgIndex, key: RowKey, nameOf: (machine: MachineRef) => string): string | null {
  const machine = machineOfRow(key);
  return machine !== null ? nameOf(machine) : (index.orgs.get(key)?.name ?? null);
}

// Every project of a row on the machines that are up, discovered ones included, hidden ones not: where an action over the
// row's sessions reaches them ("Archive sessions older than a week").
export function rowProjects(index: OrgIndex, key: RowKey, up: (machine: MachineRef) => boolean): ProjectRecord[] {
  return (index.projects.get(key) ?? []).filter((p) => !p.hidden && up(machineOf(p.id)));
}

// The sessions a row holds now, from every machine, archived ones included (the row's own filing, `rowOfRecord`).
export function sessionsOfRow(state: ProjectsHolder & { records: ReadonlyMap<AppSessionId, SessionRecord>; listed: ReadonlyMap<AppSessionId, ListedSession> }, local: MachineRef, key: RowKey): SessionRecord[] {
  const index = selectOrgIndex(state, local);
  return [...state.records.values()].filter((r) => rowOfRecord(index, state.projects, r, state.listed) === key);
}

// The checkout a row's own actions act on (New chat, Resume…, Reveal in Finder, Worktrees…, the hover card): the local
// machine's when it has a listed one, else the first listed one in ref order; else any of the row's projects (one the
// project filter lists). Null for a machine project.
export function primaryCheckout(index: OrgIndex, key: RowKey, local: MachineRef): ProjectRecord | null {
  const list = index.projects.get(key) ?? [];
  const order = byMachine(local);
  const ranked = [...list].sort((a, b) => order(machineOf(a.id), machineOf(b.id)));
  return ranked.find((p) => isCheckout(p) && !p.hidden) ?? ranked.find((p) => !p.hidden) ?? null;
}

// The project a tab set stands for on this machine (the strip's set: New chat's project, the title bar's chip,
// Customize's page): an org project's local checkout that is listed, else any local project of it, a hidden one last;
// a set keyed by a project's address, that project when it is local. None for a machine's row or the no-project set:
// a session starts on another machine from O7's picker.
export function localProjectOfSet(state: ProjectsHolder, key: string, local: MachineRef): ProjectRecord | undefined {
  if (key === NO_SET) return undefined;
  if (isAddress(key)) {
    const project = state.projects.get(key as ProjectId);
    return project !== undefined && machineOf(project.id) === local ? project : undefined;
  }
  const mine = (selectOrgIndex(state, local).projects.get(key as RowKey) ?? []).filter((p) => machineOf(p.id) === local);
  return mine.find((p) => isCheckout(p) && !p.hidden) ?? mine.find((p) => !p.hidden) ?? mine[0];
}
const NO_SET = 'none'; // the layout's NO_PROJECT

// The machine rows in their order: the local machine's first, then the rest by name (T3).
export function machineOrder(local: MachineRef, nameOf: (machine: MachineRef) => string) {
  return (a: MachineRef, b: MachineRef) => (a === b ? 0 : a === local ? -1 : b === local ? 1 : nameOf(a).localeCompare(nameOf(b)) || (a < b ? -1 : a > b ? 1 : 0));
}


// ---- the project registry: a row's successor (Interfaces §J.2) ---------------------------------------------------------

/**
 * Whether the row stands on the registry alone: it is a registry project, and no checkout of it that a machine of this
 * app answered itself (this Mac's included) is listed. Such rows order after the others, by name (M11, provisionally).
 */
export function registryOnly(index: OrgIndex, key: RowKey): boolean {
  if (index.orgs.get(key)?.registry === undefined) return false;
  return !(index.projects.get(key) ?? []).some((p) => isCheckout(p) && !p.hidden && !isRegistryRecord(p));
}

/**
 * Where an entry under `key` (a tab set, a panel context, an expanded row) belongs now (§J.2), for a key that is neither
 * a machine's row nor the no-project set: itself while it is a row's key; else main's `moved[key]` (a project whose
 * locations were linked into another, an `id:` key included); else the row key of the first record not hidden whose
 * label is `key` (this Mac's first, then by machine ref); else itself, as a hidden project's set stays.
 */
export function successorOf(index: OrgIndex, key: RowKey, local: MachineRef): RowKey {
  if (index.listed.has(key)) return key;
  const moved = Object.hasOwn(index.registry.moved, key) ? index.registry.moved[key] : undefined;
  if (moved !== undefined) return moved;
  const order = byMachine(local);
  const heir = [...index.projects.values()]
    .flat()
    .filter((p) => !p.hidden && labelOf(p) === key)
    .sort((a, b) => order(machineOf(a.id), machineOf(b.id)))[0];
  return heir === undefined ? key : index.keyOf(heir);
}
