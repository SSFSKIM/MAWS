// OX9 grades of `fs.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import type { CommandGrades } from '../grades';

export const grades = {
  'fs.sessionText': 'view',
  'fs.state': 'machine-admin', // the store's diagnostics: the config home and every holder
  'fs.scan': 'internal', // P5 O3-D (P5 Decision Log 36): scan, bind and unbind are main-only, the index source's alone
  'fs.bind': 'internal',
  'fs.unbind': 'internal',
  'fs.holders': 'view',
  'fs.unfollow': 'view',
  'fs.subagents': 'view',
  'fs.agentEvents': 'view',
  'fs.workflows': 'view',
  'fs.tasks': 'view',
  'fs.readSpill': 'view',
} as const satisfies CommandGrades<'fs'>;
