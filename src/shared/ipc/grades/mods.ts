// OX9 grades of `mods.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import type { CommandGrades } from '../grades';

export const grades = {
  'mods.list': 'view',
  'mods.setSessionOverride': 'manage', // changes what the session runs with
} as const satisfies CommandGrades<'mods'>;
