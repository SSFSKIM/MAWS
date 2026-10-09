// P2-C (2026-10-09). What one assistant text says to the report (the P2-C document, Design §4 and §7): its grammar-2 parts, whether any
// of them is a mark, and whether any text stands outside the marks (the working record's). A streaming block reads
// through `parseLive`, display only. The transcript's derivation and the report projection ask this of the same texts
// over and over, so the answers are kept for the most recent texts.
import { parse, parseLive, type Part } from '@shared/owner/to-human-parser';

export interface TextMarks {
  parts: readonly Part[];
  marked: boolean; // a part is a mark
  unmarked: boolean; // some text outside any mark is not blank
}

const KEPT = 512;
const kept = new Map<string, TextMarks>();

export function marksOfText(text: string, live = false): TextMarks {
  const key = `${live ? 'l' : 'f'}${text}`;
  const known = kept.get(key);
  if (known) return known;
  const parts = live ? parseLive(text) : parse(text);
  const marks: TextMarks = { parts, marked: parts.some((part) => part.kind !== 'plain'), unmarked: parts.some((part) => part.kind === 'plain' && part.text.trim() !== '') };
  if (kept.size >= KEPT) kept.delete(kept.keys().next().value!);
  kept.set(key, marks);
  return marks;
}
