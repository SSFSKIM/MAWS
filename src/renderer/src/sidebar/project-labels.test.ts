import { expect, it } from 'vitest';
import { project } from '../../../../test/support/builders';
import { projectLabels } from './project-labels';

it('uses the shortest distinguishing parent path only for colliding names', () => {
  const projects = [
    project('one', 0, { name: 'repo', directory: '/work/a/team/repo' }),
    project('two', 1, { name: 'repo', directory: '/work/b/team/repo' }),
    project('three', 2, { name: 'notes', directory: '/work/notes' }),
  ];
  expect([...projectLabels(projects).values()]).toEqual(['repo · a/team', 'repo · b/team', 'notes']);
});
