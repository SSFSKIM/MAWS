// OX9 grades of `customization.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import type { CommandGrades } from '../grades';

export const grades = {
  'customization.inventory': 'spawn', // a machine-wide read that feeds a spawn
  // main-only
  'customization.serverEndpoints': 'internal',
} as const satisfies CommandGrades<'customization'>;
