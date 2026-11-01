// OX9 grades of `pty.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import type { CommandGrades } from '../grades';

export const grades = {
  'pty.hostState': 'client',
  'pty.ping': 'shell',
  'pty.spawn': 'shell',
  'pty.write': 'shell',
  'pty.resize': 'shell',
  'pty.kill': 'shell',
  'pty.ack': 'shell',
  'pty.checkpoint': 'shell',
  'pty.attach': 'shell',
  'pty.list': 'shell',
  'pty.foreground': 'shell',
  'pty.openLink': 'client',
  'pty.recaptureEnv': 'internal', // P5 O2 M4: main's and mawsd's, never a remote caller's
  // P5 O7 M3: `pty.listFor` is a terminal read, `shell` as `pty.list`, reached remotely only as an act; the ledger and the
  // ring's read are the endpoint's in `mawsd` (a remote caller reaches them only through an act and its stream), as `host.op`
  'pty.listFor': 'shell',
  'pty.op': 'internal',
  'pty.opQuery': 'internal',
  'pty.replay': 'internal',
} as const satisfies CommandGrades<'pty'>;
