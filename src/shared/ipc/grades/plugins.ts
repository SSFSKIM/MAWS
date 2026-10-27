// OX9 grades of `plugins.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import type { CommandGrades } from '../grades';

export const grades = {
  // machine-wide reads that feed a spawn
  'plugins.env': 'spawn',
  'plugins.list': 'spawn',
  'plugins.available': 'spawn',
  'plugins.manifest': 'spawn',
  'plugins.marketplaceManifest': 'spawn',
  'plugins.directoryProvenance': 'spawn',
  // mutations
  'plugins.install': 'machine-admin',
  'plugins.update': 'machine-admin',
  'plugins.uninstall': 'machine-admin',
  'plugins.enable': 'machine-admin',
  'plugins.disable': 'machine-admin',
  'plugins.cancel': 'machine-admin',
} as const satisfies CommandGrades<'plugins'>;
