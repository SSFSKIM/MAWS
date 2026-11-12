// OX9 grades of `projects.*` (`../grades.ts`; the project registry's M12): the front's own, for a machine.sock client
// alone and never a forwarded caller (src/mawsd/front.ts), so none is a remote caller's to reach.
import type { CommandGrades } from '../grades';

export const grades = {
  'projects.registry': 'internal',
  'projects.forward': 'internal',
  'projects.act.answer': 'internal',
} as const satisfies CommandGrades<'projects'>;
