// browser_eval's value (E4c execution document, Design §6 `browser_eval`): Playwright evaluates the expression in the
// page and hands back what it could serialise (a Date, a bigint, NaN, a cyclic object; a Map or a Set arrives as an
// empty object, as Playwright 1.63 serialises them); the result carries it as JSON, `undefined` as null and anything
// JSON cannot hold as its string, cut at BROWSER_EVAL_MAX_CHARS: a string by its own characters, any other value as its
// JSON text (the cut value is then that text, a string).
import { BROWSER_EVAL_MAX_CHARS } from '@shared/maws/browser';

export function evalValueOf(value: unknown, maxChars = BROWSER_EVAL_MAX_CHARS): { value: unknown; truncated: boolean } {
  const json = toJson(value);
  const text = typeof json === 'string' ? json : JSON.stringify(json);
  if (text.length <= maxChars) return { value: json, truncated: false };
  // a high surrogate left last would be half a character
  const end = /[\uD800-\uDBFF]/.test(text[maxChars - 1]!) ? maxChars - 1 : maxChars;
  return { value: text.slice(0, end), truncated: true };
}

function toJson(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value, replacer)) as unknown;
  } catch {
    return String(value); // a cycle
  }
}

const replacer = (_key: string, value: unknown): unknown => (typeof value === 'bigint' ? value.toString() : value);
