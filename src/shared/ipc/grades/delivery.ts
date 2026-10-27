// OX9 grades of `delivery.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md): Send
// to signs in and publishes with the owner's connector accounts, as `connectors.*` does. Uniform, so a new command
// inherits it.
import type { GradeSpec } from '../grades';

export const grades = 'machine-admin' as const satisfies GradeSpec;
