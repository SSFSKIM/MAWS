// OX9 grades of `layout.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md): the
// window's own state and effects, served by the app (survey §2's "stay with the client"). Uniform, so a new command
// inherits it; one that reaches a machine's service turns this into a map.
import type { GradeSpec } from '../grades';

export const grades = 'client' as const satisfies GradeSpec;
