// OX9 grades of `render.*` (`../grades.ts`; P5 O5 M3, the O5 document's OX9 line): the render host's answer is its own
// to `mawsd` (main-only), never a remote caller's.
import type { CommandGrades } from '../grades';

export const grades = {
  'render.answer': 'internal',
} as const satisfies CommandGrades<'render'>;
