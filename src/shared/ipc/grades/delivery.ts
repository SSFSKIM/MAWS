// OX9 grades of `delivery.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md): Send
// to signs in and publishes with the owner's connector accounts, as `connectors.*` does. P5 O4 M2
// (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §C): per command, since `delivery.deliver` is main's
// own hand-off of its export (`internal`).
// P5 O7 M5c (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "O4's surfaces: the grade"; A14): Send to is
// graded on its artifact: its reads at `view`, a send and its cancel at `manage` (its owners send it where the machine's
// credential allows, with no prompt); the sign-in keeps `machine-admin`.
import type { CommandGrades } from '../grades';

export const grades = {
  'delivery.status': 'view',
  'delivery.connect': 'machine-admin',
  'delivery.send': 'manage',
  'delivery.cancel': 'manage',
  'delivery.receipts': 'view',
  'delivery.deliver': 'internal', // P5 O4 M2: main-only
} as const satisfies CommandGrades<'delivery'>;
