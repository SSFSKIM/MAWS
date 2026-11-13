// OX9 grades of `connectors.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md): the
// owner's grants and accounts, `machine-admin` (OX9). P5 O7 M5c (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "O4's surfaces: the grade"; A13): a page's lease is graded on its artifact, as the page is: at least `view`, and by
// effect (src/endpoint/by-effect.ts) `converse` for the two that run the owner's connector tools (`call`, `refresh`),
// `view` for the rest; so a member who may view a shared dashboard uses its widgets as its owner granted them.
import type { CommandGrades, GradeSpec } from '../grades';

const lease = { floor: 'view', byEffect: true } as const satisfies GradeSpec;

export const grades = {
  'connectors.open': lease,
  'connectors.declare': lease,
  'connectors.call': lease,
  'connectors.watch': lease,
  'connectors.unwatch': lease,
  'connectors.refresh': lease,
  'connectors.visibility': lease,
  'connectors.close': lease,
  'connectors.servers': 'machine-admin',
  'connectors.connect': 'machine-admin',
  'connectors.reconnect': 'machine-admin',
  'connectors.disconnect': 'machine-admin',
  'connectors.add': 'machine-admin',
  'connectors.remove': 'machine-admin',
  'connectors.signIn': 'machine-admin',
  'connectors.signInCancel': 'machine-admin',
  'connectors.signInServer': 'machine-admin', // P5 O7 M8: connectors.signIn's, for the session's MCP widget
  'connectors.signInDynamicServer': 'machine-admin', // UX wave U11a M8: the two sign-ins' grade
  // main-only
  'connectors.grants': 'internal',
  'connectors.grant': 'internal',
  'connectors.revoke': 'internal',
  'connectors.check': 'internal',
  'connectors.resolve': 'internal',
  'connectors.start': 'internal',
  'connectors.take': 'internal',
  'connectors.cancel': 'internal',
  'connectors.directResolve': 'internal',
  'connectors.directStart': 'internal',
  'connectors.directDiscover': 'internal',
  'connectors.directTake': 'internal',
  'connectors.directCancel': 'internal',
  'connectors.directClose': 'internal',
  'connectors.directLocate': 'internal',
  'connectors.directSend': 'internal',
  'connectors.observe': 'internal',
  'connectors.windowShown': 'internal', // P5 O4 M2: main's report of a page's window
  'connectors.adoptGrant': 'internal', // P5 O4 M2: main's one-time adoption (U7)
  // P5 O7 M5c: a consent's redirect relayed from the asking device, run by the flow its own channel armed for the port
  'connectors.callback': 'list',
} as const satisfies CommandGrades<'connectors'>;
