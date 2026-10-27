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
} as const satisfies CommandGrades<'pty'>;
