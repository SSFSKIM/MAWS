// P4-A2 (X35; docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md R9): a tolerant reader of a tool call's input
// while it streams. The engine's `input_json_delta` pieces concatenate to a JSON document that is complete only at the
// block's end; the host wants to read `artifact`, the ops and their text as soon as they parse. The accumulated text is
// completed rather than parsed incrementally: an open string is closed (a cut escape dropped), a member cut before its
// value is dropped with its comma, a cut literal is dropped, open containers are closed, and the whole is parsed once.
// Run per batch tick (about 16 ms), never per delta. A text no completion makes parseable answers `undefined`.

interface Container {
  kind: '{' | '[';
  // what the container waits for next: an object's key, the colon after it, a value, or the comma or close after one
  expect: 'key' | 'colon' | 'value' | 'next';
  // where the member being read starts (the comma before it, or just after the open bracket): the cut point that
  // drops the member whole
  memberStart: number;
}

const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const LITERAL = /^(true|false|null)$/;

// A string cut inside an escape: a dangling backslash (an odd run of them: `\\\\` is an escaped backslash, whole) or a
// `\\u` with fewer than four digits whose backslash is itself unescaped; the cut escape is dropped, the rest kept.
function withoutCutEscape(text: string): string {
  const trailing = /\\+$/.exec(text)?.[0].length ?? 0;
  if (trailing % 2 === 1) return text.slice(0, -1);
  const unicode = /\\u[0-9a-fA-F]{0,3}$/.exec(text);
  if (!unicode) return text;
  const run = /\\+$/.exec(text.slice(0, unicode.index + 1))?.[0].length ?? 0; // the backslashes ending with the escape's own
  return run % 2 === 1 ? text.slice(0, unicode.index) : text;
}

export function readPartialJson(text: string): unknown {
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // completed below
  }
  const stack: Container[] = [];
  let inString = false;
  let escape = false;
  let literalStart = -1;
  const top = (): Container | undefined => stack[stack.length - 1];
  const valueDone = () => {
    const container = top();
    if (container) container.expect = 'next';
  };
  const endLiteral = (at: number): boolean => {
    if (literalStart < 0) return true;
    const literal = trimmed.slice(literalStart, at);
    literalStart = -1;
    if (!NUMBER.test(literal) && !LITERAL.test(literal)) return false;
    valueDone();
    return true;
  };
  let i = 0;
  for (; i < trimmed.length; i += 1) {
    const ch = trimmed[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') {
        inString = false;
        const container = top();
        if (container?.expect === 'key') container.expect = 'colon';
        else valueDone();
      }
      continue;
    }
    if (literalStart >= 0) {
      if (ch === ',' || ch === '}' || ch === ']' || /\s/.test(ch)) {
        if (!endLiteral(i)) return undefined; // a malformed literal mid-text: not a cut, a broken input
      } else continue;
    }
    if (/\s/.test(ch)) continue;
    const container = top();
    switch (ch) {
      case '"':
        inString = true;
        escape = false;
        if (container && container.expect !== 'key') container.expect = 'value';
        break;
      case '{':
      case '[':
        stack.push({ kind: ch, expect: ch === '{' ? 'key' : 'value', memberStart: i + 1 });
        break;
      case '}':
      case ']':
        stack.pop();
        valueDone();
        break;
      case ':':
        if (container) container.expect = 'value';
        break;
      case ',':
        if (container) {
          container.memberStart = i;
          container.expect = container.kind === '{' ? 'key' : 'value';
        }
        break;
      default:
        literalStart = i;
        if (container) container.expect = 'value';
    }
  }
  let out = trimmed;
  let cut = -1;
  if (inString) {
    const container = top();
    if (container?.expect === 'key') cut = container.memberStart;
    else {
      out = withoutCutEscape(out) + '"';
      valueDone();
    }
  } else if (literalStart >= 0) {
    // a literal at the very end: `true`, `false` and `null` cannot grow, so they are whole; a number can (`1` of `12`),
    // so it is dropped until a delimiter follows it
    const literal = trimmed.slice(literalStart);
    if (LITERAL.test(literal)) valueDone();
    else cut = top()?.memberStart ?? 0;
  }
  const container = top();
  if (cut < 0 && container && container.expect !== 'next') {
    // a container waiting for a key after a comma, for a colon, or for a value with nothing of it yet: the member goes
    // whole (its comma with it); an empty container so far has nothing to drop
    if (container.expect !== 'key' || trimmed[container.memberStart] === ',') cut = container.memberStart;
  }
  if (cut >= 0) {
    out = out.slice(0, cut);
    // the cut dropped what the innermost containers after it held: recount them
    stack.length = 0;
    inString = false;
    escape = false;
    for (let k = 0; k < out.length; k += 1) {
      const ch = out[k]!;
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{' || ch === '[') stack.push({ kind: ch, expect: 'next', memberStart: k + 1 });
      else if (ch === '}' || ch === ']') stack.pop();
    }
    out = out.replace(/,\s*$/, '');
  }
  for (let k = stack.length - 1; k >= 0; k -= 1) out += stack[k]!.kind === '{' ? '}' : ']';
  try {
    return JSON.parse(out) as unknown;
  } catch {
    return undefined;
  }
}

/** A member's place in a JSON value: object keys and array indices from the root. */
export type JsonPath = (string | number)[];

// G2: the host's emitter's reading (src/engine-host/tool-server/provisional.ts, which holds its own copy until it
// imports this one), here so the renderer's core reads a streamed index (deck.json, canvas.json) the same way.
/**
 * The path of the member a streamed JSON text ends inside (`['ops', 2, 'new']` while that string streams), down to the
 * innermost container still open; null once the text is a whole value. Every value of the partial parse off this path
 * is whole: a string closed, a container closed. The partial parse cannot tell (it closes what is open), so a name is
 * read only once it is off the path.
 */
export function openPath(text: string): JsonPath | null {
  interface Level {
    object: boolean;
    key: string | number; // an object's last key; an array's index of its last value (-1 before one)
    open: boolean; // a value of the current member started and has not ended
    expectKey: boolean; // an object between members: the next string is a key
  }
  const stack: Level[] = [];
  let inString = false;
  let isKey = false;
  let escape = false;
  let from = 0;
  let inLiteral = false;
  const begin = (level: Level | undefined) => {
    if (!level) return;
    if (!level.object) level.key = (level.key as number) + 1;
    level.open = true;
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    const top = stack[stack.length - 1];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') {
        inString = false;
        if (isKey && top) top.key = JSON.parse(text.slice(from, i + 1)) as string;
        else if (top) top.open = false;
      }
      continue;
    }
    if (inLiteral) {
      if (ch !== ',' && ch !== '}' && ch !== ']' && !/\s/.test(ch)) continue;
      inLiteral = false;
      if (top) top.open = false;
    }
    if (/\s/.test(ch)) continue;
    switch (ch) {
      case '"':
        inString = true;
        escape = false;
        from = i;
        isKey = top?.object === true && top.expectKey;
        if (isKey) top!.expectKey = false;
        else begin(top);
        break;
      case '{':
      case '[':
        begin(top);
        stack.push({ object: ch === '{', key: ch === '{' ? '' : -1, open: false, expectKey: ch === '{' });
        break;
      case '}':
      case ']': {
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent) parent.open = false;
        break;
      }
      case ',':
        if (top) {
          top.open = false;
          top.expectKey = top.object;
        }
        break;
      case ':':
        break;
      default:
        begin(top);
        inLiteral = true;
    }
  }
  if (stack.length === 0) return null;
  const path: JsonPath = [];
  stack.forEach((level, k) => {
    if (k < stack.length - 1 || level.open) path.push(level.key);
  });
  return path;
}

/** Whether the value at `path` is whole: off the open path (or the text is whole). */
export const isWhole = (open: JsonPath | null, path: JsonPath): boolean => open === null || path.length > open.length || path.some((key, k) => open[k] !== key);
