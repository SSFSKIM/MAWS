// OX9 grades of `scm.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import type { CommandGrades } from '../grades';

export const grades = {
  'scm.status': 'view',
  'scm.stage': 'manage',
  'scm.unstage': 'manage',
  'scm.discard': 'manage',
  'scm.commit': 'manage',
  'scm.push.plan': 'view', // the plans read what a push or a pull request would do
  'scm.push': 'manage',
  'scm.pr.plan': 'view',
  'scm.pr.create': 'manage',
  'scm.remote.cancel': 'manage',
  'scm.remote.last': 'view',
  'scm.pr.state': 'view',
} as const satisfies CommandGrades<'scm'>;
