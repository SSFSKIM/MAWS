// Text geometry without a DOM (P3-E2 M3, promoted from M1's spike): a label's width is estimated from per-character
// advances that err wide of SF Pro, Apple SD Gothic Neo, Segoe UI and Malgun Gothic (Hangul and CJK a full em, Latin by
// class), so a label placed by this estimate is never clipped by its neighbour or the frame. M1's e2e measured real
// glyph boxes in Chromium against these estimates (widest real to estimate 0.986; spikes/p3-dashboard/findings.txt).

const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힯豈-﫿︰-﹏＀-｠￠-￦]/;

/** The estimated advance of one character, in em. */
function advance(ch: string): number {
  if (WIDE.test(ch)) return 1;
  if (ch === ' ') return 0.3;
  if (/[0-9]/.test(ch)) return 0.66; // SF Pro's tabular digits measure 0.63 em in Chromium (e2e run 38890516278)
  if (/[il.,:;'|!]/.test(ch)) return 0.32;
  if (/[mwMW@%]/.test(ch)) return 0.95;
  if (/[A-Z]/.test(ch)) return 0.72;
  if (/[a-z]/.test(ch)) return 0.58;
  return 0.66;
}

export function textWidth(text: string, size: number, mono = false): number {
  let em = 0;
  for (const ch of text) em += mono && !WIDE.test(ch) ? 0.62 : advance(ch);
  return em * size;
}

/**
 * Lines of `text` no wider than `max`, at most `lines` of them: breaks between words (Hangul keeps its words whole, the
 * law's `keep-all`), a word wider than a line broken by character. When it cannot fit, the last line ends in `…` and
 * `shortened` is set; the caller keeps the full text reachable (the mark's tip and the source table). Always at least
 * one line: a text with no words (a whitespace-only cell is valid data) is one empty line (P3-F).
 */
export function wrap(text: string, size: number, max: number, lines: number): { lines: string[]; shortened: boolean } {
  const out: string[] = [];
  let line = '';
  const words = text.split(/\s+/).filter(Boolean);
  const pieces = words.flatMap((word) => (textWidth(word, size) <= max ? [word] : [...chunks(word, size, max)]));
  for (const piece of pieces) {
    const next = line === '' ? piece : `${line} ${piece}`;
    if (textWidth(next, size) <= max) line = next;
    else {
      if (line !== '') out.push(line);
      line = piece;
    }
  }
  if (line !== '') out.push(line);
  if (out.length === 0) out.push('');
  if (out.length <= lines) return { lines: out, shortened: false };
  const kept = out.slice(0, lines);
  let last = kept[lines - 1];
  while (last.length > 0 && textWidth(`${last}…`, size) > max) last = [...last].slice(0, -1).join('');
  kept[lines - 1] = `${last}…`;
  return { lines: kept, shortened: true };
}

function* chunks(word: string, size: number, max: number): Generator<string> {
  let part = '';
  for (const ch of word) {
    if (part !== '' && textWidth(part + ch, size) > max) {
      yield part;
      part = '';
    }
    part += ch;
  }
  if (part !== '') yield part;
}
