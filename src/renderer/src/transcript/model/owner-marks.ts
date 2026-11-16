// P2-C (2026-10-09). What one assistant text says to the report (the P2-C document, Design §4 and §7): its grammar-2
// parts, whether any of it is a mark, and whether any text stands outside the marks (the working record's). A
// streaming block reads as it streams, display only. The transcript's derivation and the report projection ask this
// of the same texts over and over, so the answers are kept for the most recent texts.
// UX wave U2b (M2's third fix wave): `marked` and `unmarked` are the one reading of a text's marks
// (`src/shared/owner/marked.ts`), which the presenter's drawings read too, so the mirror's class and live marks never
// disagree with what is drawn. `parts` stays the shared grammar's (`parse`, `parseLive`), as main reads a text; the
// desk web app counts a row's marked spans by it (`apps/desk-web/src/views/project/landed-message.ts`).
import { readMarked } from '@shared/owner/marked';
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
  const reading = readMarked(text, live);
  const marks: TextMarks = { parts: live ? parseLive(text) : parse(text), marked: reading.spans.length > 0, unmarked: reading.hasRecord };
  if (kept.size >= KEPT) kept.delete(kept.keys().next().value!);
  kept.set(key, marks);
  return marks;
}
