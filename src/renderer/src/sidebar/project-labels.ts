import type { ProjectRecord } from '@shared/ipc/schema';

// Editors' duplicate-tab rule: only colliding names gain the shortest distinguishing parent suffix. UX wave U4a M6
// (l3-input-07): the suffix alone, for each project of those given, which the New chat chooser draws in a project's
// folder name's place; null where no other project given has its name.
export function projectSuffixes(projects: readonly ProjectRecord[]): Map<ProjectRecord['id'], string | null> {
  const parents = new Map(projects.map((p) => [p.id, p.directory.split('/').filter(Boolean).slice(0, -1)]));
  return new Map(projects.map((p) => {
    const peers = projects.filter((other) => other.id !== p.id && other.name === p.name);
    if (peers.length === 0) return [p.id, null];
    const parts = parents.get(p.id)!;
    let depth = 1;
    while (depth < parts.length && peers.some((other) => parents.get(other.id)!.slice(-depth).join('/') === parts.slice(-depth).join('/'))) depth++;
    return [p.id, parts.slice(-depth).join('/') || '/'];
  }));
}

export function projectLabels(projects: readonly ProjectRecord[]) {
  const suffixes = projectSuffixes(projects);
  return new Map(projects.map((p) => {
    const suffix = suffixes.get(p.id) ?? null;
    return [p.id, suffix === null ? p.name : `${p.name} · ${suffix}`];
  }));
}
