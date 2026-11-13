// A line diff of two texts as the transcript's hunks (UX wave U1a, §I): the engine's structuredPatch shape, each line
// prefixed ' ', '-' or '+', three lines of context around each change, and git's "\ No newline at end of file" after a
// last line that has none. Pure. Myers' algorithm over the lines between the two texts' common head and tail, bounded:
// past MAX_EDITS lines changed, that middle is shown as removed whole and added whole, a true diff that is not the
// shortest, so that no prompt can hold the window for the time a shortest diff of two large unlike files would take.
import type { Hunk } from '../../transcript/model/rows';

const CONTEXT = 3;
const MAX_EDITS = 1000;
const NO_NEWLINE = '\\ No newline at end of file';

// A line with its newline when it has one, so a last line that gains or loses it differs.
function linesOf(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n').map((line) => `${line}\n`);
  const last = lines.pop()!;
  if (last !== '\n') lines.push(last.slice(0, -1));
  return lines;
}

type Op = { sign: ' ' | '-' | '+'; line: string };

// The shortest edit script from `a` to `b`, or null when it is longer than `limit` lines.
function shortest(a: readonly string[], b: readonly string[], limit: number): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, limit);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        trace.push(v.slice());
        return backtrack(trace, a, b, off);
      }
    }
    trace.push(v.slice());
  }
  return null;
}

function backtrack(trace: Int32Array[], a: readonly string[], b: readonly string[], off: number): Op[] {
  const ops: Op[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d > 0; d--) {
    const v = trace[d - 1]!;
    const k = x - y;
    const down = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!);
    const prevX = v[off + (down ? k + 1 : k - 1)]!;
    const prevY = prevX - (down ? k + 1 : k - 1);
    while (x > prevX && y > prevY) {
      ops.push({ sign: ' ', line: a[x - 1]! });
      x -= 1;
      y -= 1;
    }
    ops.push(down ? { sign: '+', line: b[y - 1]! } : { sign: '-', line: a[x - 1]! });
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    ops.push({ sign: ' ', line: a[x - 1]! });
    x -= 1;
    y -= 1;
  }
  return ops.reverse();
}

function scriptOf(a: readonly string[], b: readonly string[]): Op[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const middle = shortest(midA, midB, MAX_EDITS) ?? [...midA.map((line) => ({ sign: '-' as const, line })), ...midB.map((line) => ({ sign: '+' as const, line }))];
  const same = (lines: readonly string[]) => lines.map((line) => ({ sign: ' ' as const, line }));
  return [...same(a.slice(0, head)), ...middle, ...same(a.slice(a.length - tail))];
}

// The hunks that turn `before` into `after`; none when the two are the same text.
export function lineDiff(before: string, after: string): Hunk[] {
  const ops = scriptOf(linesOf(before), linesOf(after));
  // the old and the new line number each op starts at
  const olds: number[] = [];
  const news: number[] = [];
  let old = 1;
  let next = 1;
  for (const op of ops) {
    olds.push(old);
    news.push(next);
    if (op.sign !== '+') old += 1;
    if (op.sign !== '-') next += 1;
  }
  const changes = ops.flatMap((op, i) => (op.sign === ' ' ? [] : [i]));
  const hunks: Hunk[] = [];
  let at = 0;
  while (at < changes.length) {
    let end = at;
    while (end + 1 < changes.length && changes[end + 1]! - changes[end]! - 1 <= 2 * CONTEXT) end += 1;
    const from = Math.max(0, changes[at]! - CONTEXT);
    const to = Math.min(ops.length - 1, changes[end]! + CONTEXT);
    const shown = ops.slice(from, to + 1);
    hunks.push({
      oldStart: olds[from]!,
      oldLines: shown.filter((op) => op.sign !== '+').length,
      newStart: news[from]!,
      newLines: shown.filter((op) => op.sign !== '-').length,
      lines: shown.flatMap(({ sign, line }) => (line.endsWith('\n') ? [`${sign}${line.slice(0, -1)}`] : [`${sign}${line}`, NO_NEWLINE])),
    });
    at = end + 1;
  }
  return hunks;
}
