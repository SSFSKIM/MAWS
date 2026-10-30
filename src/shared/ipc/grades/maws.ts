// OX9 grades of `maws.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import type { CommandGrades } from '../grades';

export const grades = {
  'maws.asks.list': 'view',
  'maws.ask.answer': 'converse', // an agent's question to the human
  'maws.pane.answer': 'converse',
  // main-only
  'maws.artifact.datasetRefreshed': 'internal',
  'maws.artifact.exported': 'internal',
  'maws.artifact.captured': 'internal', // P5 O3-D (P5 Decision Log 36): main's capture and browser alone send these two
  'maws.download.recorded': 'internal',
} as const satisfies CommandGrades<'maws'>;
