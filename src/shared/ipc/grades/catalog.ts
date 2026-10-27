// OX9 grades of `catalog.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md): Discover
// reads the machine's installed inventory beside the directories; one grade until O4 gives the person's half (its
// sources) to the client. Uniform, so a new command inherits it.
import type { GradeSpec } from '../grades';

export const grades = 'machine-admin' as const satisfies GradeSpec;
