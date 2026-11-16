// Board ticket 711: the consent sentence's opening and the one test of whether a string quotes it. A module of its own,
// importing nothing: the arrivals reader (./arrival.ts), the ask tool's guard (src/engine-host/tool-server/ask.ts) and the
// steer's writer (src/shared/maws/ask.ts, which the arrivals reader imports) all read it.

/**
 * The consent sentence's opening, the one definition (board ticket 711): the ask tool refuses an ask whose strings hold
 * it (src/engine-host/tool-server/ask.ts), so a model cannot put a grant before the person in an ask of its own.
 */
export const GRANT_OPENING = 'Permission granted for ';

// Board ticket 711: how a string is read. Letters and digits alone, after Unicode compatibility folding (NFKC: full-width
// letters and brackets, the no-break space) and case folding: Markdown's emphasis, code and strike marks, white space,
// zero-width characters and every other mark go. Each pair of angle brackets is read both ways by itself, whichever way
// the others are read: removed with its words (so a tag around a word does not hide the opening) and with its words
// kept (so words of the opening put inside a pair are not removed with it).
const folded = (text: string): string => text.replace(/[^\p{L}\p{N}]/gu, '');
const FOLDED_GRANT = folded(GRANT_OPENING.normalize('NFKC').toLowerCase());

// The lengths of the opening's beginnings that the letters read so far can end with (0 always among them), after
// `letters` more; null once the whole opening has been read
function after(reached: ReadonlySet<number>, letters: string): Set<number> | null {
  let now = reached;
  for (const letter of letters) {
    const next = new Set([0]);
    for (const length of now) {
      if (FOLDED_GRANT[length] !== letter) continue;
      if (length + 1 === FOLDED_GRANT.length) return null;
      next.add(length + 1);
    }
    now = next;
  }
  return new Set(now);
}

/**
 * Whether a string quotes the grant's opening, in any reading of it: the one test the ask tool's guard
 * (src/engine-host/tool-server/ask.ts) and the steer's writer (src/shared/maws/ask.ts) both call. One pass over the
 * string, whatever its number of bracket pairs. What it does not claim: a paraphrase of the grant, words put between the
 * opening's words by any means other than a pair of angle brackets (an entity, a link's target, a parenthesis), or
 * letters of another script that look alike. The steer's writer is the boundary (it writes no text the model wrote);
 * this test is the second layer.
 */
export function quotesGrant(text: string): boolean {
  let reached: ReadonlySet<number> = new Set([0]);
  // the split's odd parts are the pairs of angle brackets, each with its words
  for (const [index, part] of text.normalize('NFKC').toLowerCase().split(/(<[^>]*>)/).entries()) {
    const read = after(reached, folded(part));
    if (read === null) return true;
    reached = index % 2 === 1 ? new Set([...reached, ...read]) : read;
  }
  return false;
}
