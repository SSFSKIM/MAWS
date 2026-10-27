// OX9 grades of `spaces.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md): the
// library's spaces, graded as artifacts are.
import type { CommandGrades } from '../grades';

export const grades = {
  'spaces.list': 'view',
  'spaces.create': 'manage',
  'spaces.update': 'manage',
  'spaces.delete': 'manage',
} as const satisfies CommandGrades<'spaces'>;
