import { expect, it } from 'vitest';
import type { ProjectId } from '@shared/graph/ids';
import { project } from '../../../../test/support/builders';
import { projectLabels, projectSuffixes } from './project-labels';

it('uses the shortest distinguishing parent path only for colliding names', () => {
  const projects = [
    project('one', 0, { name: 'repo', directory: '/work/a/team/repo' }),
    project('two', 1, { name: 'repo', directory: '/work/b/team/repo' }),
    project('three', 2, { name: 'notes', directory: '/work/notes' }),
  ];
  expect([...projectLabels(projects).values()]).toEqual(['repo · a/team', 'repo · b/team', 'notes']);
});

// UX wave U4a M6 (l3-input-07; decision 24): the part that tells a project apart, which the New chat chooser draws
it('answers the distinguishing part of each colliding project’s parent path, and null for a name no other listed project has', () => {
  const projects = [
    project('one', 0, { name: 'repo', directory: '/work/client-a/repo' }),
    project('two', 1, { name: 'repo', directory: '/work/client-b/repo' }),
    project('three', 2, { name: 'repo', directory: '/home/client-a/repo' }),
    project('four', 3, { name: 'notes', directory: '/work/notes' }),
    project('five', 4, { name: 'top', directory: '/top' }),
    project('six', 5, { name: 'top', directory: '/srv/top' }),
  ];
  expect(Object.fromEntries(projectSuffixes(projects))).toEqual({ one: 'work/client-a', two: 'client-b', three: 'home/client-a', four: null, five: '/', six: 'srv' });
  expect(projectSuffixes(projects.slice(1, 4)).get('two' as ProjectId)).toBe('client-b'); // only over the projects listed together
  expect(projectSuffixes([projects[0], projects[3]]).get('one' as ProjectId)).toBeNull();
});
