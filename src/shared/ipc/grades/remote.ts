// OX9 grades of `remote.*` (`../grades.ts`). P5 O7 M2 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// Interfaces §K): main's remote lane B adapter speaking to this app's own pages, answered by no machine, so the routing
// class `client`, as `machines.*`. Uniform, so a command M3 adds inherits it.
import type { GradeSpec } from '../grades';

export const grades = 'client' as const satisfies GradeSpec;
