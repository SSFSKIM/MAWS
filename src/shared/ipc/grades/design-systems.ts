// OX9 grades of `designSystems.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import type { CommandGrades } from '../grades';

export const grades = {
  'designSystems.house': 'view',
  // main-only
  'designSystems.governing': 'internal',
} as const satisfies CommandGrades<'designSystems'>;
