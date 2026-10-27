// OX9 grades of `maws.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import type { CommandGrades } from '../grades';

export const grades = {
  'maws.asks.list': 'view',
  'maws.ask.answer': 'converse', // an agent's question to the human
  'maws.pane.answer': 'converse',
  'maws.artifact.captured': 'machine-admin', // captured and recorded: bridged, but only main's capture and browser send them
  'maws.download.recorded': 'machine-admin',
  // main-only
  'maws.artifact.datasetRefreshed': 'internal',
  'maws.artifact.exported': 'internal',
} as const satisfies CommandGrades<'maws'>;
