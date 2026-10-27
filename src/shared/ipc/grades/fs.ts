// OX9 grades of `fs.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import type { CommandGrades } from '../grades';

export const grades = {
  'fs.sessionText': 'view',
  'fs.state': 'machine-admin', // the store's diagnostics: the config home and every holder
  'fs.scan': 'machine-admin', // scan, bind and unbind: bridged, but only main's index sends them
  'fs.bind': 'machine-admin',
  'fs.unbind': 'machine-admin',
  'fs.holders': 'view',
  'fs.unfollow': 'view',
  'fs.subagents': 'view',
  'fs.agentEvents': 'view',
  'fs.workflows': 'view',
  'fs.tasks': 'view',
  'fs.readSpill': 'view',
} as const satisfies CommandGrades<'fs'>;
