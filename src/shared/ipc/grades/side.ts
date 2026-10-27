// OX9 grades of `side.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import type { CommandGrades } from '../grades';

export const grades = {
  'side.thread.open': 'spawn', // a side thread is a new session
  'side.sendToMain': { floor: 'converse', byEffect: true }, // text into the main session's input, as session.send
  'side.screenshot.preview': 'view',
  'side.question.list': 'view',
  'side.question.clear': 'converse',
} as const satisfies CommandGrades<'side'>;
