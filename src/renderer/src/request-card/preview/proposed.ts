// The proposed change of a file prompt (UX wave U1a, §I): from what the call asks and what was read of its file, the
// change as diff hunks against the file as read ("create" for a file that does not exist, "update" otherwise), or the
// input alone where no true diff can be drawn. Pure. A preview: the engine applies the edit to the file as it then stands.
import type { Hunk } from '../../transcript/model/rows';
import { field, filePaths } from '../tools';
import { lineDiff } from './line-diff';

export type ProposedFile = { text: string } | 'missing' | null; // null: not read yet, or not readable
export type Proposed =
  | { kind: 'diff'; change: 'create' | 'update'; hunks: Hunk[] } // against the file; three lines of context
  | { kind: 'input' }; // the input alone

export const INPUT_ALONE: Proposed = { kind: 'input' };

// The tools whose change can be drawn against the file they name.
const DIFFED = new Set(['Edit', 'MultiEdit', 'Write']);

// The file a prompt's diff is read from: the one file an Edit, a MultiEdit or a Write names; null for any other prompt,
// or for a call that names several files (its first line counts them).
export function proposedFilePath(toolName: string, input: unknown): string | null {
  if (!DIFFED.has(toolName)) return null;
  const paths = filePaths(input);
  return paths.length === 1 && field(input, 'file_path') === paths[0] ? paths[0]! : null;
}

// One replacement as the Edit tool makes it: the first occurrence of `old`, or every one; null when there is none to
// replace (an empty `old` replaces nothing in a file that exists).
function replaced(text: string, edit: unknown): string | null {
  const old = field(edit, 'old_string');
  const next = field(edit, 'new_string');
  if (old === null || next === null || old === '') return null;
  const at = text.indexOf(old);
  if (at < 0) return null;
  const all = edit !== null && typeof edit === 'object' && (edit as { replace_all?: unknown }).replace_all === true;
  return all ? text.split(old).join(next) : text.slice(0, at) + next + text.slice(at + old.length);
}

function after(toolName: string, input: unknown, text: string): string | null {
  switch (toolName) {
    case 'Edit':
      return replaced(text, input);
    case 'MultiEdit': {
      const edits = input !== null && typeof input === 'object' ? (input as { edits?: unknown }).edits : undefined;
      if (!Array.isArray(edits) || edits.length === 0) return null;
      let result: string | null = text;
      for (const edit of edits) if (result !== null) result = replaced(result, edit);
      return result;
    }
    case 'Write':
      return field(input, 'content');
    default:
      return null;
  }
}

export function proposedChange(toolName: string, input: unknown, file: ProposedFile): Proposed {
  if (!DIFFED.has(toolName) || file === null) return INPUT_ALONE;
  if (file === 'missing') {
    const content = toolName === 'Write' ? field(input, 'content') : null;
    return content === null ? INPUT_ALONE : { kind: 'diff', change: 'create', hunks: lineDiff('', content) };
  }
  const changed = after(toolName, input, file.text);
  return changed === null ? INPUT_ALONE : { kind: 'diff', change: 'update', hunks: lineDiff(file.text, changed) };
}
