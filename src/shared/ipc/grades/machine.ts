// OX9 grades of `machine.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md). P5 O6 M1
// (docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md): `machine.identity` is a listing read, like
// `session.list`: the machine's ref, its display name and its own project, none of a session's content.
import type { CommandGrades } from '../grades';

export const grades = {
  'machine.identity': 'list',
} as const satisfies CommandGrades<'machine'>;
