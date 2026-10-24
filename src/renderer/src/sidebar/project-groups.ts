import type { ProjectRecord } from '@shared/ipc/schema';

export const isSidebarProject = (project: ProjectRecord): boolean => !project.hidden && !project.discovered;

// The person's choices precede ambient discovery in both project destinations. Keep their sidebar order;
// hidden choices are recoverable next, and the remaining discovered folders are alphabetical.
export function projectGroups(projects: ProjectRecord[]) {
  const byName = (a: ProjectRecord, b: ProjectRecord) => a.name.localeCompare(b.name) || a.directory.localeCompare(b.directory);
  return [
    { label: 'Sidebar projects', projects: projects.filter(isSidebarProject).sort((a, b) => a.order - b.order || byName(a, b)) },
    { label: 'Hidden projects', projects: projects.filter((p) => p.hidden).sort(byName) },
    { label: 'Discovered projects', projects: projects.filter((p) => !p.hidden && p.discovered).sort(byName) },
  ];
}
