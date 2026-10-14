// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Notes"; M4): a position in a plain text carried
// through a change of that text (another replica's edit to the speaker notes), by the same character diff the model
// writes notes with (fast-diff, S6's `patchNotes`).
import diff from 'fast-diff';

/** `pos` in `before`, as the position of the same place in `after`. */
export function mapCaret(before: string, after: string, pos: number): number {
  let from = 0; // position in `before`
  let to = 0; // position in `after`
  for (const [op, text] of diff(before, after)) {
    if (op === diff.INSERT) {
      to += text.length; // reached only while `from` ≤ `pos`: before the caret, or at it (the other writer typed there first)
      continue;
    }
    if (pos < from + text.length) return op === diff.EQUAL ? to + (pos - from) : to; // inside deleted text: where it was
    from += text.length;
    if (op === diff.EQUAL) to += text.length;
  }
  return to + (pos - from);
}

/**
 * The owner's change (`base` → `mine`) carried onto `current` (`base` with another writer's changes since): each of the
 * owner's edits applied at its place mapped into `current`. For a field that held remote changes back while the owner
 * composed, so writing the owner's text does not undo what arrived meanwhile.
 */
export function rebaseText(base: string, mine: string, current: string): string {
  const edits: { at: number; remove: number; insert: string }[] = [];
  let pos = 0;
  for (const [op, text] of diff(base, mine)) {
    const last = edits.at(-1);
    const touching = last !== undefined && last.at + last.remove === pos;
    if (op === diff.EQUAL) pos += text.length;
    else if (op === diff.DELETE) {
      if (touching && last.insert === '') last.remove += text.length;
      else edits.push({ at: pos, remove: text.length, insert: '' });
      pos += text.length;
    } else if (touching) last.insert += text;
    else edits.push({ at: pos, remove: 0, insert: text });
  }
  let out = current;
  for (const edit of edits.reverse()) {
    const start = mapCaret(base, current, edit.at);
    const end = Math.max(start, mapCaret(base, current, edit.at + edit.remove));
    out = out.slice(0, start) + edit.insert + out.slice(end);
  }
  return out;
}
