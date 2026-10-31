// OX9 grades of `files.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import type { CommandGrades } from '../grades';

export const grades = {
  'files.list': 'view',
  'files.read': 'view',
  'files.watch': 'view',
  'files.unwatch': 'view',
  'files.openExternal': 'view', // opened on the asking client through the client port (OX4), never run on the machine
  'files.write': 'manage',
  'files.reveal': 'view',
  'files.readResolved': 'internal', // P5 O3-E: main's own read for library.read
  'files.upload': 'manage', // P5 O3-E: a write into the session's attachments directory, claimed by machine.op
} as const satisfies CommandGrades<'files'>;
