// OX9 grades of `clientPort.*` (`../grades.ts`; P5 O3-D): the client port's answer is main's alone (main-only).
import type { CommandGrades } from '../grades';

export const grades = {
  'clientPort.answer': 'internal',
} as const satisfies CommandGrades<'clientPort'>;
