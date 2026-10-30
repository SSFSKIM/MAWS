// OX9 grades of `machineSettings.*` (`../grades.ts`; P5 O3-D): the machine half of the settings, read and written as the
// settings are (`settings.*` is `machine-admin` throughout): what every launch on the machine reads.
import type { CommandGrades } from '../grades';

export const grades = {
  'machineSettings.get': 'machine-admin',
  'machineSettings.set': 'machine-admin',
} as const satisfies CommandGrades<'machineSettings'>;
