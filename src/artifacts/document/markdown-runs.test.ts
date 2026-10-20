// P4-R5 (P4 Decision Log 36): the serializer's escaping of text runs, sliced back into its runs, against the version it
// replaced (5980461f6, tracker L226), kept below as the oracle: that one rebuilt each run a code unit at a time, and on
// every serialization, which was the host's step in `e2e:document-scale`'s row 5. Generated run groups: marks and
// comment marks (a comment's edge splits a group, any other mark ends it), escapes at and across run edges, line starts
// after a hardBreak or a reader's line ending, line ends, table cells, a reader's Markdown, and surrogate pairs split
// across runs. The JSON walk each serialization starts with against master's: the same copy, made in one traversal.
import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { docMarkdown, escapeRuns, escapeText, mapStrings } from './markdown';
import { schemaFor } from './schema';

const ESC = '\uE005';
const NEWLINE = '\uE00E';
type Mark = NonNullable<JSONContent['marks']>[number];
const prng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

// ── the oracle: escapeRuns as 5980461f6 wrote it ──
const sameMark = (a: Mark, b: Mark): boolean => a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});
const restMarks = (node: JSONContent | undefined): Mark[] => (node?.marks ?? []).filter((mark) => mark.type !== 'comment');
const plain = (node: JSONContent | undefined) => node?.type === 'text' && !(node.marks ?? []).some((mark) => mark.type === 'code');
const together = (a: JSONContent, b: JSONContent) => {
  const [x, y] = [restMarks(a), restMarks(b)];
  return x.length === y.length && x.every((mark) => y.some((other) => sameMark(mark, other)));
};
function oracle(content: JSONContent[], tables: { forReaders: boolean }, { cell, lines }: { cell: boolean; lines: boolean }): (string | undefined)[] {
  const escaped: (string | undefined)[] = [];
  for (let start = 0, end = 1; start < content.length; start = end, end = start + 1) {
    if (!plain(content[start])) continue;
    while (end < content.length && plain(content[end]) && together(content[start], content[end])) end++;
    const runs = content.slice(start, end).map((node) => (lines ? (node.text ?? '') : (node.text ?? '').replace(/\n/g, NEWLINE)));
    const before = content[start - 1];
    const lineStart = start === 0 || before?.type === 'hardBreak' || (tables.forReaders && before?.type === 'text' && (before.text ?? '').endsWith('\n'));
    const lineEnd = end === content.length;
    const parts = runs.join('').split('\n');
    const text = parts.map((line, k) => escapeText(line, { lineStart: lineStart || k > 0, lineEnd: lineEnd || k < parts.length - 1, inCell: cell })).join('\n');
    let run = 0;
    let left = runs[0].length;
    const out = runs.map(() => '');
    for (let k = 0; k < text.length; k++) {
      while (left === 0 && run < runs.length - 1) left = runs[++run].length;
      out[run] += text[k];
      if (text[k] !== ESC) left--;
    }
    out.forEach((piece, k) => (escaped[start + k] = piece));
  }
  return escaped;
}

// ── run groups ──
// pieces that escape on their own or once joined with a neighbour (`=` `=`, `1` `. x`, `x ` `^ab`, `a.` `  b`), line
// starts' markers, a cell's pipe, line endings, and the two halves of an emoji
const PIECES = ['=', '==', '+', '$', '|', '#', '##', '-', '--', ':::', '^', '^ab', ' ^ab', '1', '12', '.', ')', '. x', ' ', '  ', '\t', 'a', 'IV', 'b.', 'x', 'word', '\n', '\n-', '\n#', 'ab ', '\uD83D', '\uDE00', '😀', 'é'];
const MARKS: Mark[][] = [
  [{ type: 'bold' }],
  [{ type: 'italic' }],
  [{ type: 'link', attrs: { href: 'https://a.example' } }, { type: 'link', attrs: { href: 'https://b.example' } }],
  [{ type: 'highlight', attrs: { color: null } }, { type: 'highlight', attrs: { color: '#fde68a' } }],
];
const THREADS = ['ta', 'tb'];
const pick = <T>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)];

/** Text written under one set of marks, cut at up to three code units into runs that comment edges (ta, tb) separate. */
function group(r: () => number, marks: Mark[], threads: Set<string>): JSONContent[] {
  let text = '';
  for (let n = 1 + Math.floor(r() * 4); n > 0; n--) text += pick(r, PIECES);
  const cuts = [...new Set(Array.from({ length: Math.floor(r() * 4) }, () => Math.floor(r() * text.length)))].filter((at) => at > 0).sort((a, b) => a - b);
  return [0, ...cuts].map((at, k, starts) => {
    if (k > 0) {
      const thread = pick(r, THREADS);
      if (!threads.delete(thread)) threads.add(thread);
    }
    const on = [...marks, ...[...threads].map((threadId) => ({ type: 'comment', attrs: { threadId } }))];
    return { type: 'text', text: text.slice(at, starts[k + 1]), ...(on.length > 0 && { marks: on }) };
  });
}
/** Inline content: one to four groups, each under its own marks, or a hardBreak, an atom or inline code between them. */
function content(r: () => number): JSONContent[] {
  const out: JSONContent[] = [];
  let marks: Mark[] = [];
  const threads = new Set<string>(THREADS.filter(() => r() < 0.3));
  for (let n = 1 + Math.floor(r() * 4); n > 0; n--) {
    const kind = r();
    if (kind < 0.12) out.push({ type: 'hardBreak' });
    else if (kind < 0.17) out.push({ type: 'math', attrs: { latex: 'x^2' } });
    else if (kind < 0.22) out.push({ type: 'text', text: 'c=1', marks: [{ type: 'code' }] });
    else out.push(...group(r, marks, threads));
    if (r() < 0.5) {
      const mark = pick(r, pick(r, MARKS));
      const held = marks.findIndex((other) => other.type === mark.type);
      marks = held >= 0 && r() < 0.5 ? marks.filter((_, k) => k !== held) : [...marks.filter((_, k) => k !== held), mark];
    }
  }
  return out;
}

describe('the runs escaped as one text, sliced back into their runs (P4-R5)', () => {
  it('equals the version that rebuilt them a code unit at a time, on 40,000 generated groups', () => {
    const r = prng(226);
    const seen = { cases: 0, groups: 0, edgeEscapes: 0, splitPairs: 0, lineStarts: 0, cells: 0, readers: 0, readerLines: 0 };
    const failures: string[] = [];
    for (let n = 0; n < 40_000; n++) {
      const nodes = content(r);
      const forReaders = r() < 0.4;
      const cell = r() < 0.25;
      const heading = r() < 0.2;
      const lines = forReaders && !heading && !cell; // as prepareInline sets it
      const expected = oracle(nodes, { forReaders }, { cell, lines });
      const actual = escapeRuns(nodes, { forReaders }, { cell, lines });
      seen.cases++;
      if (JSON.stringify(actual) !== JSON.stringify(expected) || actual.length !== expected.length) {
        if (failures.length < 5) failures.push(JSON.stringify({ nodes, forReaders, cell, lines, expected, actual }));
        continue;
      }
      // what the cases exercised: an escape that went to a run after the first of its group (at the comment's edge), a
      // pair of surrogates across two runs of one group, an escaped line start after a hardBreak or a reader's line
      // ending, an escaped pipe in a cell, a reader's line ending kept
      nodes.forEach((node, k) => {
        const prev = nodes[k - 1];
        const grouped = plain(prev) && plain(node) && together(prev, node);
        if (grouped && expected[k]!.startsWith(ESC)) seen.edgeEscapes++;
        if (grouped && /[\uD800-\uDBFF]$/.test(prev.text!) && /^[\uDC00-\uDFFF]/.test(node.text!)) seen.splitPairs++;
        if (plain(node) && expected[k]!.includes(ESC) && (prev?.type === 'hardBreak' || (forReaders && plain(prev) && prev.text!.endsWith('\n')))) seen.lineStarts++;
      });
      if (expected.some((piece) => piece !== undefined)) seen.groups++;
      if (cell && expected.some((piece) => piece?.includes(`${ESC}|`))) seen.cells++;
      if (forReaders) seen.readers++;
      if (lines && expected.some((piece) => piece?.includes('\n'))) seen.readerLines++;
    }
    expect(failures).toEqual([]);
    for (const [what, count] of Object.entries(seen)) expect(count, what).toBeGreaterThan(200);
  });

  it('keeps the L226 cases: an escape goes with the character after it, inside or outside the comment', () => {
    const comment = [{ type: 'comment', attrs: { threadId: 'ta' } }];
    const cases: Array<[JSONContent[], { cell?: boolean; forReaders?: boolean }]> = [
      [[{ type: 'text', text: '1', marks: comment }, { type: 'text', text: '. x' }], {}],
      [[{ type: 'text', text: 'x ' }, { type: 'text', text: '^ab', marks: comment }], {}],
      [[{ type: 'text', text: 'a =' }, { type: 'text', text: '= b', marks: comment }], {}],
      [[{ type: 'text', text: 'a |', marks: comment }, { type: 'text', text: '| b' }], { cell: true }],
      [[{ type: 'text', text: 'x\uD83D', marks: comment }, { type: 'text', text: '\uDE00 ==' }], {}],
      [[{ type: 'text', text: 'one\n', marks: comment }, { type: 'text', text: '- two' }], { forReaders: true }],
    ];
    for (const [nodes, { cell = false, forReaders = false }] of cases) {
      const options = { cell, lines: forReaders && !cell };
      expect(escapeRuns(nodes, { forReaders }, options)).toEqual(oracle(nodes, { forReaders }, options));
    }
    expect(escapeRuns(cases[0][0], { forReaders: false }, { cell: false, lines: false })).toEqual(['1', `${ESC}. x`]);
    expect(escapeRuns(cases[1][0], { forReaders: false }, { cell: false, lines: false })).toEqual(['x ', `${ESC}^ab`]);
  });
});

// ── the JSON walk: master's (0f9c18d65), which copies every object and array ──
const copying = <T>(value: T, map: (text: string) => string): T => {
  if (typeof value === 'string') return map(value) as T;
  if (Array.isArray(value)) return value.map((item) => copying(item, map)) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [map(key), copying(item, map)])) as T;
};
// A value's structure: each object's prototype and its own properties in order (an array's holes and length, an own
// `__proto__`), with their flags.
const structure = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return [typeof value, value ?? null];
  const proto = Object.getPrototypeOf(value) as unknown;
  const kind = proto === Array.prototype ? 'array' : proto === Object.prototype ? 'object' : 'other';
  const properties = Reflect.ownKeys(value).map((key) => {
    const { value: item, get, set, ...flags } = Object.getOwnPropertyDescriptor(value, key)!;
    return [String(key), flags, get || set ? 'accessor' : structure(item)];
  });
  return [kind, properties];
};
// Every object and array a value holds, each time it is reached (a shared one as often as it is shared).
const objects = (value: unknown, into: object[] = []): object[] => {
  if (value === null || typeof value !== 'object') return into;
  into.push(value);
  for (const key of Object.keys(value)) objects((value as Record<string, unknown>)[key], into);
  return into;
};
// Its strings and its objects' keys (not an array's indices), each time it is reached.
const strings = (value: unknown): number => {
  if (typeof value === 'string') return 1;
  if (Array.isArray(value)) return value.reduce((n: number, item) => n + strings(item), 0);
  if (value === null || typeof value !== 'object') return 0;
  return Object.entries(value).reduce((n, [, item]) => n + 1 + strings(item), 0);
};
// A walk's calls of its map, in order.
const calls = (walk: typeof mapStrings, value: unknown, map: (text: string) => string): string[] => {
  const seen: string[] = [];
  walk(value, (text) => (seen.push(text), map(text)));
  return seen;
};

describe("the JSON walk makes master's copy in one traversal (P4-R5)", () => {
  const KEYS = ['type', 'attrs', 'text', 'id', '\uE001k', 'a\uE00Db', 'a\uE001', '__proto__', '0', '10'];
  const STRINGS = ['plain', '', 'x\uE005y', '\uE00Da', 'é😀', '\uE00F'];
  function value(r: () => number, depth: number, made: object[]): unknown {
    const kind = r();
    if (made.length && kind < 0.1) return made[Math.floor(r() * made.length)]; // shared, as one mark's attrs on two runs
    if (depth === 0 || kind < 0.3) return [STRINGS[Math.floor(r() * STRINGS.length)], 1, true, null, undefined][Math.floor(r() * 5)];
    if (kind < 0.6) {
      const out = Array.from({ length: Math.floor(r() * 4) }, () => value(r, depth - 1, made));
      if (out.length > 1 && r() < 0.3) delete out[Math.floor(r() * out.length)]; // a hole
      made.push(out);
      return out;
    }
    const out: Record<string, unknown> = {};
    for (let n = Math.floor(r() * 4); n > 0; n--) Object.defineProperty(out, KEYS[Math.floor(r() * KEYS.length)], { value: value(r, depth - 1, made), enumerable: true, writable: true, configurable: true });
    made.push(out);
    return out;
  }
  // the serializer's map and the parse's (markdown.ts's toLiteral and fromLiteral, which sends `a\uE00Db` and `a\uE001`
  // to one key), and one that sends keys to `__proto__` and to one another
  const toLiteral = (text: string) => text.replace(/[\uE000-\uE00F]/g, (char) => `\uE00D${String.fromCharCode(97 + char.charCodeAt(0) - 0xe000)}`);
  const fromLiteral = (text: string) => text.replace(/\uE00D([a-p])/g, (_, letter: string) => String.fromCharCode(0xe000 + letter.charCodeAt(0) - 97));
  const fold = (text: string) => (text === 'type' || text === 'id' ? '__proto__' : text.slice(0, 1));

  it("maps what master's walk maps, in its order, and every object and array it returns is a new one", () => {
    const r = prng(42);
    for (let n = 0; n < 5_000; n++) {
      const input = value(r, 4, []);
      const inputs = new Set(objects(input));
      for (const map of [toLiteral, fromLiteral, fold]) {
        const mapped = mapStrings(input, map);
        expect(structure(mapped)).toEqual(structure(copying(input, map)));
        expect(calls(mapStrings, input, map)).toEqual(calls(copying, input, map));
        // what reads the result compares attribute values by identity (Tiptap's attrsEqual): nothing of the input's is
        // handed on, and an object the input holds in two places is two objects
        const outputs = objects(mapped);
        expect(outputs.filter((object) => inputs.has(object))).toEqual([]);
        expect(new Set(outputs).size).toBe(outputs.length);
      }
    }
  });

  it('maps each key and string once when a deep leaf changes', () => {
    let node: Record<string, unknown> = { type: 'text', text: `x${ESC}` };
    for (let depth = 0; depth < 12; depth++) node = { type: depth % 2 ? 'listItem' : 'bulletList', attrs: { id: `b${depth}` }, content: [node] };
    expect(strings(node)).toBe(12 * 6 + 4);
    expect(calls(mapStrings, node, toLiteral)).toHaveLength(strings(node));
  });

  it("serializes runs that share one attribution mark as master did (the mark's attrs are not one object twice)", () => {
    const schema = schemaFor();
    const ins = schema.marks['y-attributed-insert'].create({ userIds: ['u1'] });
    const bold = schema.marks.bold.create();
    const paragraph = schema.nodes.paragraph.create({ id: 'pa' }, [schema.text('a', [ins]), schema.text('b', [ins, bold]), schema.text('c', [bold])]);
    expect(docMarkdown().block(paragraph)).toBe('a**bc** ^pa');
  });
});
