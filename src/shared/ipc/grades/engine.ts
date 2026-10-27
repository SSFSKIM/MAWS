// OX9 grades of `engine.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import type { CommandGrades } from '../grades';

export const grades = {
  'engine.ping': 'list', // a machine-wide read with no session's content takes the lowest rank
  'engine.hostState': 'client', // main's own link to the engine host, as pty.hostState (survey §2)
  'engine.binaryInfo': 'spawn', // which engine a launch runs
  'engine.relayHealth': 'spawn', // the route a launch takes
  'engine.sessions': 'view', // every live session's full status (pending plan, task descriptions): kept to the sessions the caller views
  'engine.shutdown': 'machine-admin', // every session of the machine
  'engine.models': 'spawn',
  'engine.budget': 'list', // totals, and session ids with keep-alive reasons only: kept to the sessions the caller lists
  // main-only
  'engine.configure': 'internal',
  'engine.policy.set': 'internal',
  'engine.observedFacts': 'internal',
} as const satisfies CommandGrades<'engine'>;
