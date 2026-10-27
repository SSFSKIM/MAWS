// OX9 grades of `library.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md): the
// artifacts' reads, `view`.
import type { CommandGrades } from '../grades';

export const grades = {
  'library.list': 'view',
  'library.get': 'view',
  'library.spaces': 'view',
  'library.exportFormats': 'view',
  'library.content': 'view',
  'library.openExternally': 'view', // opened on the asking client through the client port (OX4)
  'library.reveal': 'view',
  'library.read': 'view',
  'library.saveAs': 'client',
  'library.testImport': 'machine-admin', // an e2e seam
  // main-only
  'library.snapshot': 'internal',
  'library.entry': 'internal',
  'library.text': 'internal',
} as const satisfies CommandGrades<'library'>;
