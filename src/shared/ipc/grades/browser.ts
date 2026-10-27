// OX9 grades of `browser.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md): the
// app's Chromium tabs, served by the app (survey §2 item 11). Uniform, so a new command inherits it.
import type { GradeSpec } from '../grades';

export const grades = 'client' as const satisfies GradeSpec;
