// OX9 grades of `browserEngine.*` (`../grades.ts`; P5 O17, OX9 and D8): a tab engine's own wire to `mawsd`, never a
// remote caller's. Uniform, so a command M4 and M6 add inherits it.
import type { GradeSpec } from '../grades';

export const grades = 'internal' as const satisfies GradeSpec;
