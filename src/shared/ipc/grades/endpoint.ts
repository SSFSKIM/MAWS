// OX9 grades of `endpoint.*` (`../grades.ts`; P5 O8 M6b): the local door is this machine's own app's alone (main-only), and
// no remote caller reaches it, the endpoint offering neither name (an act through it is authorized by the endpoint as a
// channel's is, src/endpoint/local-door.ts).
import type { CommandGrades } from '../grades';

export const grades = {
  'endpoint.local.act': 'internal',
  'endpoint.local.call': 'internal',
} as const satisfies CommandGrades<'endpoint'>;
