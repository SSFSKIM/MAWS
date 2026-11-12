// The project registry on the page (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §J; design §6):
// main's `org.projects` (§I) as the sessions store holds it, and the readings the sidebar takes of it.
//
// - Other machines' locations are project records in the sessions store's one projects map (M11's decision), their
//   address the machine and its row id there (`pid`), `directory` the path, `org` the folder's label with the project's
//   id, so every reader of that map (the hover card, "+ Session", the row's actions) reads them unchanged. This Mac's own
//   locations are its own index's records already; a machine that answers its own projects (a snapshot) keeps its own
//   records, which a registry record never replaces.
// - A project act's refusal is told by its message's `<code>: ` (Interfaces §G): `invalid_input` from this Mac's index,
//   `internal` from another machine's, as its endpoint forwards a failure (Decision Log 17 (5)); an older peer's is the
//   link's `not-offered` (Decision Log 17 (9)).
import type { ProjectId } from '@shared/graph/ids';
import type { IpcError } from '@shared/ipc/errors';
import type { ProjectRecord } from '@shared/ipc/schema';
import { PROJECT_REFUSALS, type ProjectRefusal } from '@shared/ipc/schema/session';
import type { HeldRemoval, OrgProject as RegistryProject, OrgProjectLocation, OrgProjects } from '@shared/ipc/schema/org';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';

export type { HeldRemoval, OrgProjectLocation, OrgProjects, RegistryProject };

/** What `org.projects` answers signed out: no project, no key. */
export const EMPTY_REGISTRY: OrgProjects = { projects: [], keys: {}, moved: {}, removals: [], seen: {} };

/** A location's address: its machine and the row's id there, by which a command to that machine names it. */
export const locationAddress = (location: Pick<OrgProjectLocation, 'machine' | 'pid'>): ProjectId => addressOf(location.machine, location.pid as ProjectId);

// The registry's records, told apart by identity: a record a machine wrote itself never is one.
const fromRegistry = new WeakSet<ProjectRecord>();
export const isRegistryRecord = (project: ProjectRecord): boolean => fromRegistry.has(project);

const NEVER = new Date(0).toISOString(); // a record carries no creation time; a row of them orders by name (§J, M11)

/**
 * The project records of the registry's locations on machines other than `local`, by address: declared folders (no
 * `discovered`), named by the location, the project's id as `org.smnsId`.
 */
export function registryRecords(registry: OrgProjects, local: MachineRef): Map<ProjectId, ProjectRecord> {
  const out = new Map<ProjectId, ProjectRecord>();
  for (const project of registry.projects) {
    for (const location of project.locations) {
      if (location.machine === local) continue;
      const record: ProjectRecord = {
        id: locationAddress(location),
        name: location.name,
        directory: location.path,
        order: 0,
        createdAt: NEVER,
        org: { key: location.key, name: location.name, source: location.source, smnsId: project.id },
        ...(location.stated !== undefined && { stated: location.stated }),
        ...(location.state !== undefined && { state: location.state }),
        ...(location.remote !== undefined && { remote: location.remote }),
      };
      fromRegistry.add(record);
      out.set(record.id, record);
    }
  }
  return out;
}

/** The registry's projects by id. */
export function registryById(registry: OrgProjects): Map<string, RegistryProject> {
  return new Map(registry.projects.map((project) => [project.id, project]));
}

/** A project act's refusal: its code, and for `statements-unavailable` its reason; null for any other failure. */
export function projectRefusal(error: Pick<IpcError, 'message' | 'issues'>): { code: ProjectRefusal | 'not-offered'; reason: string | null } | null {
  if ((error.issues as { refusal?: unknown } | undefined)?.refusal === 'not-offered') return { code: 'not-offered', reason: null };
  const words = /^([a-z-]+):(?: ([a-z-]+):)?/.exec(error.message);
  const code = words?.[1];
  if (code === undefined || !(PROJECT_REFUSALS as readonly string[]).includes(code)) return null;
  return { code: code as ProjectRefusal, reason: code === 'statements-unavailable' ? (words?.[2] ?? null) : null };
}
