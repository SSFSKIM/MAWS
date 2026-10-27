// OX9 grades of `marketplaces.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import type { CommandGrades } from '../grades';

export const grades = {
  'marketplaces.list': 'spawn',
  'marketplaces.add': 'machine-admin',
  'marketplaces.update': 'machine-admin',
  'marketplaces.remove': 'machine-admin',
} as const satisfies CommandGrades<'marketplaces'>;
