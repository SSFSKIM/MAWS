// P2-C (2026-10-09). What one assistant text says to the report (the P2-C document, Design §4 and §7): whether any of it
// is a mark, and whether any text stands outside the marks (the working record's). A streaming block reads as it
// streams, display only. UX wave U2b (M2's third fix wave): both answers are the one reading of a text's marks
// (`src/shared/owner/marked.ts`), which the presenter's drawings read too, so the mirror's class and live marks never
// disagree with what is drawn; that reading keeps the answers for the most recent texts.
import { readMarked } from '@shared/owner/marked';

export interface TextMarks {
  marked: boolean; // a part is a mark
  unmarked: boolean; // some text outside any mark is not blank
}

export function marksOfText(text: string, live = false): TextMarks {
  const reading = readMarked(text, live);
  return { marked: reading.spans.length > 0, unmarked: reading.hasRecord };
}
