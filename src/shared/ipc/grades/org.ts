// OX9 grades of `org.*` (`../grades.ts`). P5 O8 M1 (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// Interfaces §B): this app's own sign-in to the org, answered by the local app and by no machine, so the routing class
// `client`. Uniform, so a new command (M2's `org.rows`) inherits it.
import type { GradeSpec } from '../grades';

export const grades = 'client' as const satisfies GradeSpec;
