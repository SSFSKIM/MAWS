// Board ticket 711: the consent sentence's opening and the one test of whether a string quotes it. A module of its own,
// importing nothing: the arrivals reader (./arrival.ts), the ask tool's guard (src/engine-host/tool-server/ask.ts) and the
// steer's writer (src/shared/maws/ask.ts, which the arrivals reader imports) all read it.

/**
 * The consent sentence's opening, the one definition (board ticket 711): the ask tool refuses an ask whose strings hold
 * it (src/engine-host/tool-server/ask.ts), so a model cannot put a grant before the person in an ask of its own.
 */
export const GRANT_OPENING = 'Permission granted for ';

// Board ticket 711: a string read twice, letters and digits alone after Unicode compatibility folding (NFKC: full-width
// letters, the no-break space) and case folding: once with HTML tags removed (so a tag around a word does not hide the
// opening) and once with the brackets' words kept (so words put inside a pair of angle brackets are not removed with
// them). Markdown's emphasis, code and strike marks, white space, zero-width characters and every other mark go.
function foldedReadings(text: string): string[] {
  const folded = text.normalize('NFKC').toLowerCase();
  return [folded.replace(/<[^>]*>/g, ''), folded].map((reading) => reading.replace(/[^\p{L}\p{N}]/gu, ''));
}
const FOLDED_GRANT = foldedReadings(GRANT_OPENING)[0]!;

/**
 * Whether a string quotes the grant's opening, in either reading of it: the one test the ask tool's guard
 * (src/engine-host/tool-server/ask.ts) and the steer's writer (src/shared/maws/ask.ts) both call. What it does not claim:
 * a paraphrase of the grant, words put between the opening's words by any means, or letters of another script that
 * look alike. The steer's writer is the boundary (it writes no text the model wrote); this test is the second layer.
 */
export function quotesGrant(text: string): boolean {
  return foldedReadings(text).some((reading) => reading.includes(FOLDED_GRANT));
}
