// The reply an interrupt cut off, as the sminos bridge records it (sminos 1.27.16, the desk track's branch
// `sminos-interrupt-partial`; P5 O9, the M10 sitting). The engine keeps an assistant block only once it completes, so
// what the main turn streamed before `$.turn.abort` is in no row. From 1.27.16 the bridge appends, after the interrupt's
// marker and note and only when the turn streamed text no row kept, a third row of its own: a meta user row of one
// text block whose first line says what it is, then the cut-off text (the unkept text blocks in order, joined by a blank
// line). When the bridge kept only a block's tail, the first line says so too, and the text starts partway through.
// The row is the model's context, not the person's words, and not the turn's reply: the reader draws it marked cut off.
// Recognised by its first line's opening; the shape as the desk track sent it, built against before the release.

/** The first line's opening, which names the row. */
export const CUT_LINE = 'The interrupt cut off the reply you were writing.';
/** What the first line ends with when only a block's tail was kept. */
export const PARTWAY = ' Only its end was kept, so the text starts partway through.';

/** The cut-off text of the bridge's row (its one text block), and whether it starts partway through; null for any other text. */
export function parseInterruptCut(text: string): { text: string; partway: boolean } | null {
  if (!text.startsWith(CUT_LINE)) return null;
  const at = text.indexOf('\n');
  const first = at < 0 ? text : text.slice(0, at);
  return { text: at < 0 ? '' : text.slice(at + 1), partway: first.endsWith(PARTWAY) };
}

/** The origin MAWS's backfill gives the row's `user.message`: synthetic, in the turn it cut, drawn as cut-off text. */
export const INTERRUPT_CUT = 'interrupt-cut';
