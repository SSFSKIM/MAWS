// The word diff under the patch writer (D1 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; copied and typed from
// P3-0's `s4/src/inline-diff.ts`). A textblock's content is a sequence of cells, one per Y slot: a UTF-16 unit of text
// (Yjs and ProseMirror both count text in UTF-16 units), or an inline node as one embed slot. Two cell sequences are
// diffed at word granularity (words, whitespace runs, single symbols, each embed) with fast-diff over a token alphabet,
// giving hunks in old coordinates. Hunks separated only by whitespace are merged (S5's A5: a token diff otherwise
// matches the spaces of a rewritten sentence and leaves comments on stray words). The spike refused text outside the
// BMP; tokens are matched by code point and measured in UTF-16 units here, so a surrogate pair is never split.
import fastDiff from 'fast-diff';

/** One slot: `ch` is one UTF-16 unit, or `EMBED` for an inline node whose identity is `key`. */
export interface DiffCell {
  ch: string;
  key?: string;
}

/** A change of old cells [from, to) into new cells [nFrom, nTo). Equal runs between hunks are implied. */
export interface Hunk {
  from: number;
  to: number;
  nFrom: number;
  nTo: number;
}

export const EMBED = '￼';

const TOKEN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
// fast-diff works on strings: each distinct token becomes one private-use code unit (U+E000 to U+F8FF).
const ALPHABET_SIZE = 0x1900;

export const textOf = (cells: readonly DiffCell[]): string => cells.map((cell) => cell.ch).join('');

/** Word-level hunks between two cell sequences; marks do not take part (the caller re-maps them). */
export function diffCells(a: readonly DiffCell[], b: readonly DiffCell[], { mergeWhitespace = true } = {}): Hunk[] {
  const sa = textOf(a);
  const sb = textOf(b);
  const alphabet = new Map<string, string>();
  const encode = (text: string, cells: readonly DiffCell[]): { out: string; lens: number[] } => {
    let out = '';
    const lens: number[] = [];
    let at = 0;
    for (const token of text.match(TOKEN) ?? []) {
      const key = token === EMBED ? `${EMBED}${cells[at].key ?? ''}` : token;
      let code = alphabet.get(key);
      if (code === undefined) {
        if (alphabet.size >= ALPHABET_SIZE) throw new Error('diffCells: more distinct words than the token alphabet holds');
        code = String.fromCharCode(0xe000 + alphabet.size);
        alphabet.set(key, code);
      }
      out += code;
      lens.push(token.length);
      at += token.length;
    }
    return { out, lens };
  };
  const ea = encode(sa, a);
  const eb = encode(sb, b);
  const span = (lens: number[], from: number, count: number): number => {
    let sum = 0;
    for (let k = from; k < from + count; k++) sum += lens[k];
    return sum;
  };
  const hunks: Hunk[] = [];
  let ia = 0; // cell cursors
  let ib = 0;
  let ta = 0; // token cursors
  let tb = 0;
  let open: Hunk | null = null;
  for (const [op, text] of fastDiff(ea.out, eb.out)) {
    const n = text.length;
    if (op === fastDiff.EQUAL) {
      if (open) {
        hunks.push(open);
        open = null;
      }
      ia += span(ea.lens, ta, n);
      ib += span(eb.lens, tb, n);
      ta += n;
      tb += n;
    } else {
      open ??= { from: ia, to: ia, nFrom: ib, nTo: ib };
      if (op === fastDiff.DELETE) {
        ia += span(ea.lens, ta, n);
        ta += n;
        open.to = ia;
      } else {
        ib += span(eb.lens, tb, n);
        tb += n;
        open.nTo = ib;
      }
    }
  }
  if (open) hunks.push(open);
  if (!mergeWhitespace) return hunks;
  const merged: Hunk[] = [];
  for (const hunk of hunks) {
    const prev = merged.at(-1);
    if (prev && /^\s*$/.test(sa.slice(prev.to, hunk.from))) {
      prev.to = hunk.to;
      prev.nTo = hunk.nTo;
    } else merged.push({ ...hunk });
  }
  return merged;
}

/** Old index → new index for the cells a diff leaves equal (undefined where the old cell changed). */
export function equalMap(aLen: number, hunks: readonly Hunk[]): (number | undefined)[] {
  const map: (number | undefined)[] = new Array<number | undefined>(aLen);
  let shift = 0;
  let i = 0;
  for (const hunk of hunks) {
    for (; i < hunk.from; i++) map[i] = i + shift;
    i = hunk.to;
    shift += hunk.nTo - hunk.nFrom - (hunk.to - hunk.from);
  }
  for (; i < aLen; i++) map[i] = i + shift;
  return map;
}
