// OX9 grades of `settings.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md): the
// machine's settings, reads included, until O3 splits the client's fields out (P5 §"Settings split three ways"). Uniform,
// so a new command inherits it.
import type { GradeSpec } from '../grades';

export const grades = 'machine-admin' as const satisfies GradeSpec;
