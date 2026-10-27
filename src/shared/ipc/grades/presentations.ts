// OX9 grades of `presentations.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md):
// the presenter's windows, served by the app. Uniform, so a new command inherits it.
import type { GradeSpec } from '../grades';

export const grades = 'client' as const satisfies GradeSpec;
