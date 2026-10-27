// OX9 grades of `host.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import type { CommandGrades } from '../grades';

export const grades = {
  'host.supervisorStatus': 'list', // a machine-wide read with no session's content
  'host.status': 'client',
  'host.restart': 'client',
  'host.openLog': 'client',
  // main-only
  'host.configure': 'internal',
  'host.stopAll': 'internal',
  'host.exitWhenIdle': 'internal',
  'host.interest': 'internal', // P5 O2 M2: main's; a remote viewer's interest arrives through mawsd's seam
} as const satisfies CommandGrades<'host'>;
