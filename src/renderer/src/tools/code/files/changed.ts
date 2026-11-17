// UX wave U6b-3a: the Changed group's model (stub: the cases come first).
import type { GitStatus } from '@shared/ipc/schema/git';

export type ChangeLetter = 'M' | 'A' | 'U' | 'D' | 'R' | '!';
export interface ChangedRow {
  path: string;
  rel: string;
  oldRel: string | null;
  letter: ChangeLetter;
  folder: boolean;
  onDisk: boolean;
}
export interface Marks {
  letter(path: string): ChangeLetter | null;
  dot(dir: string): ChangeLetter | null;
}
export const LETTER_TONE: Record<ChangeLetter, 'text-danger' | 'text-warning' | 'text-success'> = { '!': 'text-success', D: 'text-success', M: 'text-success', A: 'text-success', U: 'text-success', R: 'text-success' };
export function changedRows(_status: GitStatus): ChangedRow[] {
  return [];
}
export function marksOf(_rows: readonly ChangedRow[]): Marks {
  return { letter: () => null, dot: () => null };
}
export function statusSet(_status: GitStatus): string {
  return '';
}
export function labelOf(_row: ChangedRow, _working: string | null): { name: string; folder: string; shown: string } {
  return { name: '', folder: '', shown: '' };
}
