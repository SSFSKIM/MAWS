// A subagent's glyph (residue *Subagent rows*): eight marks in the UI font, one chosen per child by a 32-bit hash of
// its task id (`SubagentRef.glyph`), so the same child carries the same mark wherever it is shown (the row, C8's
// summary).
import type { TaskId } from '@shared/graph/ids';

export const SUBAGENT_GLYPHS: readonly string[] = ['✻', '❋', '✿', '✦', '❖', '✺', '✹', '❉'];

export function glyphFor(taskId: TaskId | string): number {
  let hash = 0;
  for (let i = 0; i < taskId.length; i += 1) hash = (Math.imul(hash, 31) + taskId.charCodeAt(i)) | 0;
  return Math.abs(hash) % SUBAGENT_GLYPHS.length;
}
