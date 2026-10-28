// OX9 grades of `laneA.*` (`../grades.ts`). P5 O9 M2 (docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, Interfaces §A):
// mirroring O10's lane A rows, so the namespace is graded when O3 moves it to `mawsd`. Reading a terminal session's
// bridge is `view`; a person's words and the conversation's verbs `converse`; an answer by its effect (a permission or a
// plan approved `approve`, a question `converse`) and a slash command by its own grade, as O10's `sminos.command`;
// compacting `manage`.
import type { CommandGrades } from '../grades';

export const grades = {
  'laneA.list': 'view',
  'laneA.state': 'view',
  'laneA.watch': 'view',
  'laneA.unwatch': 'view',
  'laneA.catalog': 'view',
  'laneA.read': 'view',
  'laneA.send': 'converse',
  'laneA.interrupt': 'converse',
  'laneA.answer': { floor: 'converse', byEffect: true },
  'laneA.model': 'converse',
  'laneA.command': { floor: 'converse', byEffect: true },
  'laneA.btw': 'converse',
  'laneA.compact': 'manage',
  'laneA.stopAgent': 'converse',
  'laneA.tell': 'converse',
  'laneA.stopTask': 'converse',
  'laneA.media': 'converse', // P5 O9 M7: an image or a PDF goes with a person's words
} as const satisfies CommandGrades<'laneA'>;
