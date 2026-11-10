// The org's projects, assembled from the machines' projects records (the project registry, Interfaces §A of
// docs/doperpowers/plans/2026-11-10-project-registry.md; its design §4 and §9). The endpoint (sminos's directory) and
// the app's main (the sidebar) both call `assembleProjects`, so every reader computes the same projects and the same
// names from the same records.
//
// A project is its id. Its locations are every record's locations naming that id; its `known` machines are those whose
// records list it among the projects with live sessions and no location there. A machine's own project is no project of
// the registry: a location or known entry carrying one sits under its machine's row, so it is left out here.
import { machineNameKey } from './names.ts';
import { verifyMachineCert } from './records.ts';
import { isMachineCert, isSigned } from './shapes.ts';
import type { Certificates, MachineRef, OrgState, ProjectLocation, ProjectsRecord } from './types.ts';

export type RegistryLocation = ProjectLocation & { machine: MachineRef };
export type RegistryProject = {
  id: string;
  name: string;
  /** False when any location says `hub: false`: its log is not on the hub. */
  hub: boolean;
  /** False when a location's project is decided by its `.smns`, which names it. */
  renamable: boolean;
  /** Ordered by machine ref, then path. */
  locations: RegistryLocation[];
  /** The machines with sessions of it and no location, ordered by ref. */
  known: MachineRef[];
};

/**
 * The names the endpoint's RL10 directory lists, each with its machine project and its `machines` entry: enrolled
 * machines' names, and those of certificates under a live, unrevoked delegation, so a devcloud VM that exists only by
 * its certificate is one of them. Sorted. A former name is not one: the directory would list it as a machine that is
 * enrolled and never online. A certificate whose key the head retired stays on purpose: `orgDirectory` marks its name
 * `retired`, so sminos reads the VM's machine project as retired rather than unknown (`directoryMachines` drops it).
 */
export function directoryMachineNames(state: OrgState, certificates: Certificates, now: Date): string[] {
  const names = new Map<string, string>();
  for (const m of state.machines) names.set(machineNameKey(m.name), m.name);
  const live = new Set(state.delegations.filter((d) => Date.parse(d.expires) > now.getTime()).map((d) => d.id));
  const revoked = new Set(state.revoked.flatMap((r) => ('delegation' in r.holder ? [r.holder.delegation] : [])));
  for (const c of certificates.certs) {
    if (isSigned(c, isMachineCert) && live.has(c.body.delegation) && !revoked.has(c.body.delegation)) names.set(machineNameKey(c.body.name), c.body.name);
  }
  return [...names.values()].sort();
}

/**
 * The machines a person aims at by name (`maws project add vm-1:/srv`), each with its ref: the enrolled machines, and
 * those of certificates under a live, unrevoked delegation whose key the head has not retired (`retired`), so a devcloud
 * VM that exists only by its certificate is one and a retired VM is none. A certificate names a target only once
 * `verifyMachineCert` accepts it at `now`: the hub's set is only shape-checked, and a copy of a genuine certificate with
 * its ref or `issued` altered would otherwise aim a VM's name at another machine. One per name as `directoryMachineNames`
 * keys it (`machineNameKey`): an enrolled machine before any certificate, and among live certificates of one name the
 * latest issued, so a VM retired and reissued under its name is its replacement. Its names are `directoryMachineNames`',
 * save a name only a certificate the head retired, or one that does not verify, bears, which that list keeps. Sorted by
 * name.
 */
export async function directoryMachines(state: OrgState, certificates: Certificates, now: Date): Promise<Array<{ ref: MachineRef; name: string }>> {
  const machines = new Map<string, { ref: MachineRef; name: string; issued: string | null }>();
  for (const m of state.machines) machines.set(machineNameKey(m.name), { ref: m.ref, name: m.name, issued: null });
  const live = new Set(state.delegations.filter((d) => Date.parse(d.expires) > now.getTime()).map((d) => d.id));
  const revoked = new Set(state.revoked.flatMap((r) => ('delegation' in r.holder ? [r.holder.delegation] : [])));
  const retired = new Set(state.retired.map((r) => r.pub));
  for (const c of certificates.certs) {
    if (!isSigned(c, isMachineCert) || !live.has(c.body.delegation) || revoked.has(c.body.delegation) || retired.has(c.body.pub)) continue;
    const key = machineNameKey(c.body.name);
    const held = machines.get(key);
    if (held !== undefined && (held.issued === null || held.issued >= c.body.issued)) continue; // enrolled, or issued no earlier
    if (!(await verifyMachineCert(state, c, now)).ok) continue;
    machines.set(key, { ref: c.body.machine, name: c.body.name, issued: c.body.issued });
  }
  return [...machines.values()].map(({ ref, name }) => ({ ref, name })).sort((a, b) => byText(a.name, b.name));
}

/**
 * The names whose machine projects (`machineProjectId(org, name)` maps one to its id) are no project of the registry:
 * the directory's (`directoryMachineNames`) and every former name the head binds to a ref it still enrolls, so a session
 * recorded under a renamed machine's old machine-project id stays that machine's own and registers nothing. Sorted. The
 * set `assembleProjects`' callers pass is built from them.
 */
export function machineProjectNames(state: OrgState, certificates: Certificates, now: Date): string[] {
  const names = new Map(directoryMachineNames(state, certificates, now).map((name) => [machineNameKey(name), name]));
  const enrolled = new Set(state.machines.map((m) => m.ref));
  for (const p of state.machineNames) if (enrolled.has(p.ref) && !names.has(machineNameKey(p.name))) names.set(machineNameKey(p.name), p.name);
  return [...names.values()].sort();
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inOrder = (a: RegistryLocation, b: RegistryLocation) => byText(a.machine, b.machine) || byText(a.path, b.path);

/**
 * A project's name (design §9), the first that applies over its locations in order: the name of the first whose
 * `.smns` decides (`source: 'smns'`, no `stated`); the name with the highest `nameRev`, a tie to the earlier; the name of
 * the first with a remote that is not `linked`; the name of the first, those not `linked` before those that are; with
 * no location, the known name from the lowest machine ref.
 */
function projectName(locations: readonly RegistryLocation[], known: ReadonlyArray<{ machine: MachineRef; name: string }>): string {
  const byFile = locations.find((l) => l.source === 'smns' && l.stated === undefined);
  if (byFile !== undefined) return byFile.name;
  let renamed: RegistryLocation | undefined;
  for (const l of locations) if (l.nameRev !== undefined && (renamed === undefined || l.nameRev > (renamed.nameRev as number))) renamed = l;
  if (renamed !== undefined) return renamed.name;
  const byRemote = locations.find((l) => l.remote !== undefined && l.stated !== 'linked');
  if (byRemote !== undefined) return byRemote.name;
  const first = locations.find((l) => l.stated !== 'linked') ?? locations[0];
  if (first !== undefined) return first.name;
  return [...known].sort((a, b) => byText(a.machine, b.machine))[0].name;
}

/**
 * The org's projects from verified records, ordered by id. A machine's records beyond its highest revision are passed
 * by; an id in `machineProjects` (each machine's own project) makes no project.
 */
export function assembleProjects(records: readonly ProjectsRecord[], machineProjects: ReadonlySet<string>): RegistryProject[] {
  const newest = new Map<MachineRef, ProjectsRecord>();
  for (const r of records) if ((newest.get(r.machine)?.revision ?? 0) < r.revision) newest.set(r.machine, r);
  const located = new Map<string, RegistryLocation[]>();
  const known = new Map<string, Array<{ machine: MachineRef; name: string }>>();
  const add = <T>(into: Map<string, T[]>, id: string, item: T) => {
    if (machineProjects.has(id)) return;
    into.set(id, [...(into.get(id) ?? []), item]);
  };
  for (const r of newest.values()) {
    for (const l of r.locations) add(located, l.id, { ...l, machine: r.machine });
    for (const p of r.known) add(known, p.id, { machine: r.machine, name: p.name });
  }
  const ids = [...new Set([...located.keys(), ...known.keys()])].sort(byText);
  return ids.map((id) => {
    const locations = (located.get(id) ?? []).sort(inOrder);
    const elsewhere = known.get(id) ?? [];
    return {
      id,
      name: projectName(locations, elsewhere),
      hub: !locations.some((l) => l.hub === false),
      renamable: !locations.some((l) => l.source === 'smns' && l.stated === undefined),
      locations,
      known: [...new Set(elsewhere.map((k) => k.machine))].sort(byText),
    };
  });
}
