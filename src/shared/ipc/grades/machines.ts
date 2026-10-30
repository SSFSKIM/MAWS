// OX9 grades of `machines.*` (`../grades.ts`). P5 O6 M3 (docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md):
// the app's own connection manager, the machines this app reaches, answered by the local app and by no machine, so the
// routing class `client`. Uniform, so a new command inherits it.
import type { GradeSpec } from '../grades';

export const grades = 'client' as const satisfies GradeSpec;
