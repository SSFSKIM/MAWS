// OX9 grades of `attention.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import type { CommandGrades } from '../grades';

export const grades = {
  'attention.list': 'view', // every session's items and their requests: the endpoint keeps the sessions the caller views
  'attention.request': 'view',
  'attention.viewing': 'client',
  'attention.pendingNavigate': 'client',
  'attention.acknowledge': 'converse',
} as const satisfies CommandGrades<'attention'>;
