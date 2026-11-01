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
  // P5 O10 M7: the endpoint's own route to lane B's ledger; a remote caller reaches it only through an `act`
  'host.op': 'internal',
  'host.artifactOp': 'internal', // P5 O7 M5a: an act on no session, the same route
  'host.opQuery': 'internal',
  'host.attachment': 'internal', // P5 O3-D: mawsd's alone
} as const satisfies CommandGrades<'host'>;
