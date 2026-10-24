import type { ProjectRecord } from '@shared/ipc/schema';

// Editors' duplicate-tab rule: only colliding names gain the shortest distinguishing parent suffix.
export function projectLabels(projects: readonly ProjectRecord[]) {
  const parents = new Map(projects.map((p) => [p.id, p.directory.split('/').filter(Boolean).slice(0, -1)]));
  return new Map(projects.map((p) => {
    const peers = projects.filter((other) => other.id !== p.id && other.name === p.name);
    if (peers.length === 0) return [p.id, p.name];
    const parts = parents.get(p.id)!;
    let depth = 1;
    while (depth < parts.length && peers.some((other) => parents.get(other.id)!.slice(-depth).join('/') === parts.slice(-depth).join('/'))) depth++;
    return [p.id, `${p.name} · ${parts.slice(-depth).join('/') || '/'}`];
  }));
}
