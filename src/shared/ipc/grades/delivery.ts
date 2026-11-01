// OX9 grades of `delivery.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md): Send
// to signs in and publishes with the owner's connector accounts, as `connectors.*` does. P5 O4 M2
// (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §C): per command, since `delivery.deliver` is main's
// own hand-off of its export (`internal`).
import type { CommandGrades } from '../grades';

export const grades = {
  'delivery.status': 'machine-admin',
  'delivery.connect': 'machine-admin',
  'delivery.send': 'machine-admin',
  'delivery.cancel': 'machine-admin',
  'delivery.receipts': 'machine-admin',
  'delivery.deliver': 'internal', // P5 O4 M2: main-only
} as const satisfies CommandGrades<'delivery'>;
