// OX9 grades of `sheet.*` (`../grades.ts`; the question sheet's C3, M2, docs/doperpowers/plans/
// 2026-11-23-question-sheet-c3-maws-app.md §D). Callable by a window on this machine, refused to every caller the
// endpoint carries, an owner's included, until C6 reads what each does for a remote caller: each is graded by effect,
// and src/endpoint/by-effect.ts holds an explicit `no-rule` row for each. Reading a sheet is `view`; appending an inbox
// line, or an image a line will name, `converse`. Neither routing class fits: `internal` and `client` are fixed sets.
import type { CommandGrades } from '../grades';

export const grades = {
  'sheet.list': { floor: 'view', byEffect: true },
  'sheet.read': { floor: 'view', byEffect: true },
  'sheet.body': { floor: 'view', byEffect: true },
  'sheet.put': { floor: 'converse', byEffect: true },
  'sheet.upload': { floor: 'converse', byEffect: true },
} as const satisfies CommandGrades<'sheet'>;
