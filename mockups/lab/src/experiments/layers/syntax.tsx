// Colour for code (DESIGN.md section 19). One small palette serves every place code is set: the file's card, the
// sheet an edit stands on in the transcript, and the file read on the field. A token is one of five things, and
// three of them carry a hue: the words of the language, values, and the names of types. Comments are the quiet
// ink; everything else is the ink.
//
// The tokenizer reads one line at a time and knows enough TypeScript for the fixtures: line and one-line block
// comments, quoted strings, regular expressions after an opening context, numbers, keywords, and names told apart
// by their case. It is the lab's stand-in; the app has a real grammar (section 19.4).
import { Fragment, type ReactNode } from 'react';

export type TokenKind = 'note' | 'value' | 'key' | 'type' | 'call' | '';

const KEYWORDS = new Set(
  'as async await break case catch class const continue default delete do else export extends finally for from function if implements import in instanceof interface let new of readonly return static super switch this throw try type typeof var while yield'.split(' '),
);
/** Values that are written as words. */
const ATOMS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);
/** The language's own type names. */
const BUILT_IN = new Set(['string', 'number', 'boolean', 'void', 'unknown', 'never', 'any', 'object', 'bigint', 'symbol']);
/** After one of these a slash opens a regular expression; after anything else it divides. */
const OPENS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '']);

export interface Token {
  kind: TokenKind;
  text: string;
}

export function tokensOf(line: string): Token[] {
  const out: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind && kind === '') last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  // The last character that was not a space, for telling a regular expression from a division.
  let before = '';
  while (i < line.length) {
    const c = line[i]!;
    const rest = line.slice(i);
    if (c === ' ' || c === '\t') {
      push('', c);
      i++;
      continue;
    }
    if (rest.startsWith('//')) {
      push('note', rest);
      break;
    }
    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/', 2);
      const text = end < 0 ? rest : rest.slice(0, end + 2);
      push('note', text);
      i += text.length;
      before = '/';
      continue;
    }
    if (c === "'" || c === '"' || c === '`' || (c === '/' && OPENS.has(before))) {
      let j = i + 1;
      let inClass = false;
      for (; j < line.length; j++) {
        const d = line[j]!;
        if (d === '\\') j++;
        else if (c === '/' && d === '[') inClass = true;
        else if (c === '/' && d === ']') inClass = false;
        else if (d === c && !inClass) break;
      }
      j = Math.min(line.length, j + 1);
      if (c === '/') while (j < line.length && /[a-z]/.test(line[j]!)) j++;
      push('value', line.slice(i, j));
      i = j;
      before = c;
      continue;
    }
    const number = /^(0x[\da-f_]+|\d[\d_]*(\.\d+)?)/i.exec(rest);
    if (number) {
      push('value', number[0]);
      i += number[0].length;
      before = '0';
      continue;
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (word) {
      const w = word[0];
      const called = line[i + w.length] === '(';
      // A name after a dot is a member whatever it is spelled like.
      const member = before === '.';
      const kind: TokenKind =
        !member && KEYWORDS.has(w) ? 'key' : !member && ATOMS.has(w) ? 'value' : !member && BUILT_IN.has(w) ? 'type' : /^[A-Z][A-Z\d_]+$/.test(w) ? 'value' : /^[A-Z]/.test(w) ? 'type' : called ? 'call' : '';
      push(kind, w);
      i += w.length;
      before = 'a';
      continue;
    }
    push('', c);
    before = c;
    i++;
  }
  return out;
}

/** One line of code, coloured. Plain runs stay bare text, so the line's own colour is theirs. */
export function Tokens({ text }: { text: string }): ReactNode {
  return tokensOf(text).map((t, i) => (t.kind === '' ? <Fragment key={i}>{t.text}</Fragment> : <span key={i} className={`xl-t-${t.kind}`}>{t.text}</span>));
}
