// OX9 grades of `daemon.*` (`../grades.ts`; P5 O2 M5, settled with O10, P5 Decision Log 29). All three are main-only,
// yet O1's rubric line "every main-only command is internal" bends here: a main-only command a remote caller reaches
// through the endpoint takes its effect's grade. A status read of the machine is `list`, as O6's `machine.identity` (O1
// has no machine-scoped view, and a listing read is the nearest; its file paths are local-only, schema/daemon.ts); a
// restart is `machine-admin` (a remote restart drops its own channel, and the device resumes by cursor); the endpoint's
// own CLI passage stays `internal`.
import type { CommandGrades } from '../grades';

export const grades = {
  'daemon.status': 'list',
  'daemon.restart': 'machine-admin',
  'daemon.restartEngineHost': 'machine-admin', // P5 O16 M3b: a restart of the machine's engine host, its sessions kept
  'daemon.endpoint': 'internal',
  'daemon.e2eSeam': 'internal', // M5b fix round 2: the e2e's seams, never a remote caller's
  'daemon.e2eRender': 'internal', // P5 O5 M4: the render seam's e2e capture, likewise
} as const satisfies CommandGrades<'daemon'>;
