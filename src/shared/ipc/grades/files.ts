// OX9 grades of `files.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import { TERMINAL_ACT } from '@shared/files/outside';
import type { CommandGrades } from '../grades';
import { grades as pty } from './pty';

// UX wave U6f (docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, decision 1): the four acts
// on a file outside a session's folders are each graded by the value it is handed, which the table below hands from
// `pty.spawn`'s own declaration, so a change of the terminal's grade moves them with it; no grade is written for them
export const outsideGrades = <G>(terminal: G) => ({ 'files.readOutside': terminal, 'files.listOutside': terminal, 'files.chooseOutside': terminal, 'files.writeOutside': terminal }) as const;

export const grades = {
  'files.list': 'view',
  'files.read': 'view',
  'files.watch': 'view',
  'files.unwatch': 'view',
  'files.openExternal': 'view', // opened on the asking client through the client port (OX4), never run on the machine
  'files.write': 'manage',
  'files.reveal': 'view',
  'files.readResolved': 'internal', // P5 O3-E: main's own read for library.read; P5 O4 M3: served for OX1's window, library.read reads in process
  'files.upload': 'manage', // P5 O3-E: a write into the session's attachments directory, claimed by machine.op
  'files.readUploads': 'internal', // P5 O7 M8: the endpoint's read of a send's uploads, before the send reaches the engine host
  'files.grant': 'internal', // UX wave U6e: main's record of the person's choice in its chooser
  // UX wave U6e's files.writeOutside, and U6f's readOutside, listOutside and chooseOutside: the terminal's grade
  ...outsideGrades(pty[TERMINAL_ACT]),
} as const satisfies CommandGrades<'files'>;
