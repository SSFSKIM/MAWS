// OX9 grades of `channel.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md). P5 O8 M7b:
// a project's to-human entries are its sessions' content, so the read is `view`, as `attention.list` is: the endpoint
// keeps the entries of the sessions the caller views (O8 M7b Task 2's lane-aware filter).
import type { CommandGrades } from '../grades';

export const grades = {
  'channel.history': 'view',
} as const satisfies CommandGrades<'channel'>;
