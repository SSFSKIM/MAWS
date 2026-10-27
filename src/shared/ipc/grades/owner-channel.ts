// OX9 grades of `ownerChannel.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import type { CommandGrades } from '../grades';

export const grades = {
  'ownerChannel.state': 'view',
  'ownerChannel.answered': 'converse',
  'ownerChannel.cancel': 'converse',
  'ownerChannel.markRead': 'view', // a reader's act, as session.update's unread
} as const satisfies CommandGrades<'ownerChannel'>;
